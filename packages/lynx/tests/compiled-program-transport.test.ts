import type {
	UniversalHostTemplateProgram,
	UniversalProgramPlan,
	UniversalTransportIdentity,
} from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { installLynxCompiledProgramReceiver } from '../src/core/compiled-program-receiver.js';
import { createLynxCompiledProgramTransport } from '../src/core/compiled-program-transport.js';
import {
	decodeLynxCompiledProgramBackgroundMessage,
	decodeLynxCompiledProgramMainMessage,
	LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT,
	LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT,
} from '../src/core/compiled-program-wire.js';
import { encodeLynxDeltaMessage } from '../src/core/delta-protocol.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import type { LynxContextProxy, LynxContextProxyEvent } from '../src/core/protocol.js';
import { createFakePAPI, type FakeNode, shape } from './_fixtures/fake-element-papi.js';

const ROW: UniversalHostTemplateProgram = {
	nodes: [
		{
			type: 'view',
			parent: -1,
			props: {},
			bindings: [{ name: 'id', valueIndex: 0 }],
		},
		{ type: 'text', parent: 0, props: {} },
		{
			type: '#text',
			parent: 1,
			props: {},
			bindings: [{ name: 'value', valueIndex: 1 }],
		},
	],
	events: [],
};

function emittedPlan(): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(ROW, {
		name: 'createWireRow',
		slotUpdates: true,
	});
	return {
		kind: 'program',
		slots: ['p:id', 'c'],
		nodes: ROW.nodes.length,
		values: [0, 1],
		events: [],
		ranges: [],
		bind: new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'],
	};
}

function emittedHost(): LynxElementPAPI<FakeNode> {
	const base = createFakePAPI();
	return {
		...base,
		intrinsics: {
			view: (pageId) => base.createElement('view', pageId, ''),
			text: (pageId) => base.createElement('text', pageId, ''),
			rawText: (text) => base.createElement('#text', 0, text),
		},
		append: (parent, child) => base.insertBefore(parent, child, null),
	};
}

class RecordingContext implements LynxContextProxy {
	readonly events: LynxContextProxyEvent[] = [];
	private readonly listeners = new Map<string, Set<(event: LynxContextProxyEvent) => void>>();

	dispatchEvent(event: LynxContextProxyEvent): void {
		this.events.push(event);
		this.deliver(event);
	}

	protected deliver(event: LynxContextProxyEvent): void {
		for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
	}

	addEventListener(type: string, listener: (event: LynxContextProxyEvent) => void): void {
		let listeners = this.listeners.get(type);
		if (listeners === undefined) this.listeners.set(type, (listeners = new Set()));
		listeners.add(listener);
	}

	removeEventListener(type: string, listener: (event: LynxContextProxyEvent) => void): void {
		this.listeners.get(type)?.delete(listener);
	}
}

class HeldBackgroundContext extends RecordingContext {
	hold = false;
	private readonly held: LynxContextProxyEvent[] = [];

	override dispatchEvent(event: LynxContextProxyEvent): void {
		if (!this.hold || event.type !== LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT) {
			super.dispatchEvent(event);
			return;
		}
		this.events.push(event);
		this.held.push(event);
	}

	releaseNewestFirst(): void {
		for (const event of this.held.splice(0).reverse()) this.deliver(event);
	}
}

function identity(version: number): UniversalTransportIdentity {
	return { protocol: 1, renderer: 'lynx', root: 91, version };
}

function mountFrame(module = 'tests/WireRow.lynx.tsrx') {
	return encodeLynxDeltaMessage(
		[
			{
				op: 'run',
				templateId: 1,
				parent: { instance: 1, slot: 0 },
				before: null,
				firstInstance: 2,
				count: 1,
				values: ['row-2', 'ready'],
			},
		],
		[{ id: 1, address: { module, index: 0 } }],
	);
}

function setup(
	papi: LynxElementPAPI<FakeNode> = emittedHost(),
	module = 'tests/WireRow.lynx.tsrx',
	context = new RecordingContext(),
) {
	const page = papi.createPage('0', 0);
	const receiver = installLynxCompiledProgramReceiver({
		context,
		page,
		papi,
		resolveProgram: (name, index) => (name === module && index === 0 ? emittedPlan() : undefined),
	});
	const transport = createLynxCompiledProgramTransport(context);
	return { context, page, receiver, transport };
}

describe('@octanejs/lynx compact compiled-program transport', () => {
	it('withholds negotiated readiness until programs and PageConfig are both ready', async () => {
		const { context, page, receiver, transport } = setup();
		let ready = false;
		void transport.ready.then(() => {
			ready = true;
		});
		await Promise.resolve();
		expect(ready).toBe(false);

		receiver.markProgramsReady();
		await Promise.resolve();
		expect(ready).toBe(false);
		receiver.markPageReady();
		await transport.ready;
		expect(ready).toBe(true);

		const acknowledgements: UniversalTransportIdentity[] = [];
		await transport.commit(identity(1), mountFrame(), (message) => {
			acknowledgements.push(message);
		}).promise;

		expect(acknowledgements).toEqual([{ ...identity(1), type: 'ack' }]);
		expect(shape(page)).toMatchObject({
			type: 'page',
			children: [
				{
					type: 'view',
					id: 'row-2',
					children: [{ type: 'text', children: [{ type: 'raw-text', text: 'ready' }] }],
				},
			],
		});
		expect(
			context.events
				.filter((event) => event.type === LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT)
				.map((event) => decodeLynxCompiledProgramMainMessage(event.data).type),
		).toEqual(['ready', 'ack', 'complete']);

		await transport.dispose(identity(1));
		transport.close();
		receiver.close();
	});

	it('rejects a malformed frame and permits the exact identity to retry', async () => {
		const { page, receiver, transport } = setup();
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;

		await expect(
			transport.commit(identity(1), [...mountFrame(), 99, 0], () => {}).promise,
		).rejects.toThrow('opcode');
		expect(page.children).toEqual([]);

		await transport.commit(identity(1), mountFrame(), () => {}).promise;
		expect(page.children).toHaveLength(1);
		await transport.dispose(identity(1));
		transport.close();
		receiver.close();
	});

	it('carries a racing abort before the frame and preserves exact-identity retry', async () => {
		const context = new HeldBackgroundContext();
		const { page, receiver, transport } = setup(emittedHost(), 'tests/WireRow.lynx.tsrx', context);
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;

		context.hold = true;
		const attempt = transport.commit(identity(1), mountFrame(), () => {});
		await Promise.resolve();
		attempt.abort();
		context.releaseNewestFirst();
		await expect(attempt.promise).rejects.toThrow('aborted before apply');
		expect(page.children).toEqual([]);

		context.hold = false;
		await transport.commit(identity(1), mountFrame(), () => {}).promise;
		expect(page.children).toHaveLength(1);
		await transport.dispose(identity(1));
		transport.close();
		receiver.close();
	});

	it('frames oversized scalar payloads as strings and reassembles before apply', async () => {
		const module = `tests/${'long-'.repeat(8_000)}WireRow.lynx.tsrx`;
		const { context, page, receiver, transport } = setup(emittedHost(), module);
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;

		await transport.commit(identity(1), mountFrame(module), () => {}).promise;
		const crossings = context.events.filter(
			(event) => event.type === LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT,
		);
		expect(crossings.length).toBeGreaterThan(2);
		expect(crossings.every((event) => typeof event.data === 'string')).toBe(true);
		expect(page.children).toHaveLength(1);

		await transport.dispose(identity(1));
		transport.close();
		receiver.close();
	});

	it('retries disposal on the wire and acknowledges only after native cleanup', async () => {
		const base = emittedHost();
		let failRemove = true;
		const papi: typeof base = {
			...base,
			remove(parent, child) {
				if (failRemove) {
					failRemove = false;
					throw new Error('transient cleanup failure');
				}
				base.remove(parent, child);
			},
		};
		const { context, page, receiver, transport } = setup(papi);
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;
		await transport.commit(identity(1), mountFrame(), () => {}).promise;

		await transport.dispose(identity(1));
		expect(page.children).toEqual([]);
		expect(
			context.events
				.filter((event) => event.type === LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT)
				.map((event) => decodeLynxCompiledProgramBackgroundMessage(event.data).type)
				.filter((type) => type === 'dispose'),
		).toEqual(['dispose', 'dispose']);

		transport.close();
		receiver.close();
	});
});
