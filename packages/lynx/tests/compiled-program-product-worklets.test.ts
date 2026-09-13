import type {
	UniversalHostTemplateProgram,
	UniversalProgramPlan,
	UniversalTransportIdentity,
} from 'octane/universal/native';
import { afterEach, describe, expect, it } from 'vitest';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { installLynxCompiledProgramProductReceiver } from '../src/core/compiled-program-product-receiver.js';
import { createLynxCompiledProgramTransport } from '../src/core/compiled-program-transport.js';
import { decodeLynxDeltaMessage, encodeLynxDeltaMessage } from '../src/core/delta-protocol.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import type { LynxContextProxy, LynxContextProxyEvent } from '../src/core/protocol.js';
import {
	createLynxMainThreadRefDescriptor,
	registerMainThreadWorklet,
	unregisterMainThreadWorklet,
	type LynxActivatedMainThreadWorklet,
} from '../src/core/worklets.js';
import '../src/main-worklets.js';
import { createFakePAPI, type FakeNode } from './_fixtures/fake-element-papi.js';

const MODULE = 'tests/ProductWorklet.lynx.tsrx';
const WORKLET = 'compact-product:tap';

const PROGRAM: UniversalHostTemplateProgram = Object.freeze({
	nodes: Object.freeze([
		Object.freeze({
			type: 'view',
			parent: -1,
			props: Object.freeze({}),
			bindings: Object.freeze([
				Object.freeze({ name: 'main-thread:bindtap', valueIndex: 0 }),
				Object.freeze({ name: 'main-thread:ref', valueIndex: 1 }),
			]),
		}),
	]),
	events: Object.freeze([]),
});

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

function host(): LynxElementPAPI<FakeNode> {
	const base = createFakePAPI();
	return {
		...base,
		intrinsics: {
			view: (pageId) => base.createElement('view', pageId, ''),
			text: (pageId) => base.createElement('text', pageId, ''),
			rawText: (value) => base.createElement('#text', 0, value),
		},
		append: (parent, child) => base.insertBefore(parent, child, null),
	};
}

function residentPlan(): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(PROGRAM, {
		name: 'createProductWorklet',
		slotUpdates: true,
	});
	return Object.freeze({
		kind: 'program',
		slots: Object.freeze([
			'p:main-thread:bindtap',
			'p:main-thread:ref',
		]) as UniversalProgramPlan['slots'],
		nodes: 1,
		values: Object.freeze([0, 1]),
		events: Object.freeze([]),
		ranges: Object.freeze([]),
		bind: new Function('return (' + emission.source + ');')() as UniversalProgramPlan['bind'],
		wire: PROGRAM,
	});
}

function identity(version: number): UniversalTransportIdentity {
	return { protocol: 1, renderer: 'lynx', root: 73, version };
}

afterEach(() => unregisterMainThreadWorklet(WORKLET));

describe('@octanejs/lynx compact product worklets', () => {
	it('activates transported descriptors through native runWorklet and tears them down', async () => {
		const ref = createLynxMainThreadRefDescriptor('compact-product:ref');
		const background = { _jsFnId: 'compact-product:background', _execId: 'compact-product:exec' };
		let resolveMainHeld!: (value: unknown) => void;
		let resolveBackgroundHeld!: (value: unknown) => void;
		const mainHeld = new Promise<unknown>((resolve) => {
			resolveMainHeld = resolve;
		});
		const backgroundHeld = new Promise<unknown>((resolve) => {
			resolveBackgroundHeld = resolve;
		});
		const descriptor = registerMainThreadWorklet(WORKLET, { ref, background }, function (mode) {
			if (mode === 'background' || mode === 'background-held') {
				return (this._c!.background as unknown as (value: string) => Promise<unknown>)(
					mode === 'background' ? 'payload' : 'held',
				);
			}
			if (mode === 'main-held') return mainHeld;
			return (this._c!.ref as unknown as { current: unknown }).current;
		});
		const papi = host();
		const page = papi.createPage('entry', 0);
		const context = new RecordingContext();
		const diagnostics: Error[] = [];
		const receiver = installLynxCompiledProgramProductReceiver({
			context,
			page,
			papi,
			onDiagnostic: (error) => diagnostics.push(error),
			resolveProgram: (module, index) =>
				module === MODULE && index === 0 ? residentPlan() : undefined,
		});
		const transport = createLynxCompiledProgramTransport(context, {
			executeBackgroundFunction: (fn, args) =>
				args[0] === 'held' ? backgroundHeld : { id: fn._jsFnId, value: args[0] },
		});
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;

		const frame = encodeLynxDeltaMessage(
			[
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 1,
					values: [descriptor as never, ref as never],
				},
			],
			[{ id: 1, address: { module: MODULE, index: 0 } }],
		);
		expect(decodeLynxDeltaMessage(frame).operations[0]).toMatchObject({
			values: [descriptor as never, ref as never],
		});
		await transport.commit(identity(1), frame, () => {}).promise;

		const node = page.children[0]!;
		const active = (
			node.events.get('bindEvent:tap') as {
				readonly type: 'worklet';
				readonly value: LynxActivatedMainThreadWorklet;
			}
		).value;
		const runWorklet = (
			globalThis as typeof globalThis & {
				runWorklet(value: LynxActivatedMainThreadWorklet, args?: readonly unknown[]): unknown;
			}
		).runWorklet;
		expect(runWorklet(active)).toBe(node);
		await expect(runWorklet(active, ['background']) as Promise<unknown>).resolves.toEqual({
			id: 'compact-product:background',
			value: 'payload',
		});
		await expect(transport.callMain(descriptor as never, ['background']).promise).resolves.toEqual({
			id: 'compact-product:background',
			value: 'payload',
		});

		const pendingBackground = runWorklet(active, ['background-held']) as Promise<unknown>;
		const pendingMain = transport.callMain(descriptor as never, ['main-held']).promise;
		const backgroundCancelled = expect(pendingBackground).rejects.toThrow(/disposed/);
		const mainCancelled = expect(pendingMain).rejects.toThrow(/disposed/);
		await transport.dispose(identity(1), true);
		await Promise.all([backgroundCancelled, mainCancelled]);
		resolveBackgroundHeld('late-background');
		resolveMainHeld('late-main');
		for (let turn = 0; turn < 4; turn++) await Promise.resolve();
		expect(transport.diagnostics()).toEqual([]);
		expect(diagnostics).toEqual([]);
		expect(page.children).toEqual([]);
		expect(() => runWorklet(active)).toThrow(/stale or foreign/);
		transport.close();
		receiver.close();
	});
});
