import type {
	UniversalHostTemplateProgram,
	UniversalProgramPlan,
	UniversalTransportIdentity,
} from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { installLynxCompiledProgramReceiver } from '../src/core/compiled-program-receiver.js';
import { createLynxCompiledProgramTransport } from '../src/core/compiled-program-transport.js';
import { encodeLynxDeltaMessage } from '../src/core/delta-protocol.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import type { LynxContextProxy, LynxContextProxyEvent } from '../src/core/protocol.js';
import { createFakePAPI, type FakeNode } from './_fixtures/fake-element-papi.js';

const MODULE = 'tests/HostRefList.lynx.tsrx';

const LIST_SHELL: UniversalHostTemplateProgram = {
	nodes: [
		{ type: 'view', parent: -1, props: {} },
		{ type: 'list', parent: 0, props: { 'list-type': 'single' } },
	],
	events: [],
};

const LIST_ROW: UniversalHostTemplateProgram = {
	nodes: [
		{
			type: 'list-item',
			parent: -1,
			props: { 'reuse-identifier': 'host-ref-row' },
			bindings: [{ name: 'item-key', valueIndex: 0 }],
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

class RecordingContext implements LynxContextProxy {
	private readonly listeners = new Map<string, Set<(event: LynxContextProxyEvent) => void>>();

	dispatchEvent(event: LynxContextProxyEvent): void {
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

function emittedHost(): LynxElementPAPI<FakeNode> & {
	readonly lists: ReturnType<typeof createFakePAPI>['lists'];
} {
	const base = createFakePAPI({ list: true });
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

function emittedPlan(index: number): UniversalProgramPlan {
	const program = index === 0 ? LIST_SHELL : LIST_ROW;
	const ranges = index === 0 ? [{ slot: 0, node: 1, id: 1 }] : [];
	const emission = emitLynxMainThreadProgram(program, {
		name: index === 0 ? 'createHostRefList' : 'createHostRefListRow',
		slotUpdates: true,
		structuralRuns: true,
		ranges: ranges.map((range) => ({ node: range.node })),
	});
	return {
		kind: 'program',
		slots: index === 0 ? ['r'] : ['p:item-key', 'c'],
		nodes: program.nodes.length,
		values: index === 0 ? [] : [0, 1],
		events: [],
		ranges,
		...(index === 0 ? null : { refs: [1] }),
		wire: program,
		bind: new Function('return (' + emission.source + ');')() as UniversalProgramPlan['bind'],
	};
}

function identity(version: number): UniversalTransportIdentity {
	return { protocol: 1, renderer: 'lynx', root: 91, version };
}

function mountFrame(): readonly unknown[] {
	return encodeLynxDeltaMessage(
		[
			{
				op: 'run',
				templateId: 1,
				parent: { instance: 1, slot: 0 },
				before: null,
				firstInstance: 2,
				count: 1,
				values: [],
			},
			{
				op: 'run',
				templateId: 2,
				parent: { instance: 2, slot: 0 },
				before: null,
				firstInstance: 3,
				count: 1,
				values: ['row-0', 'Row 0'],
			},
			{ op: 'ref-run', firstInstance: 3, firstId: 4, stride: 3 },
		],
		[
			{ id: 1, address: { module: MODULE, index: 0 } },
			{ id: 2, address: { module: MODULE, index: 1 } },
		],
	);
}

describe('@octanejs/lynx compact host-ref transport', () => {
	it('delivers physical attachment only for an accepted owner and after its ACK', async () => {
		const context = new RecordingContext();
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const receiver = installLynxCompiledProgramReceiver({
			context,
			page,
			papi,
			resolveProgram: (module, index) => (module === MODULE ? emittedPlan(index) : undefined),
		});
		let acknowledged = 0;
		const observed: string[] = [];
		const transport = createLynxCompiledProgramTransport(context, {
			onHostAttachments(changes) {
				for (const change of changes) {
					observed.push(`${change.id}:${change.attached ? 'attach' : 'detach'}:ack${acknowledged}`);
				}
			},
		});
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;

		await transport.commit(identity(1), mountFrame(), () => {
			acknowledged = 1;
			observed.push('ack1');
		}).promise;
		expect(observed).toEqual(['ack1']);

		const nativeList = papi.lists[0]!;
		const sign = nativeList.componentAtIndex(nativeList.node, nativeList.node.uid, 0);
		expect(sign).toBeGreaterThan(0);
		expect(observed).toEqual(['ack1', '5:attach:ack1']);

		await transport.commit(
			identity(2),
			encodeLynxDeltaMessage([{ op: 'remove', firstInstance: 3, count: 1 }]),
			() => {
				acknowledged = 2;
				observed.push('ack2');
			},
		).promise;
		expect(observed).toEqual(['ack1', '5:attach:ack1', 'ack2', '5:detach:ack2']);

		await transport.dispose(identity(2));
		transport.close();
		receiver.close();
	});
});
