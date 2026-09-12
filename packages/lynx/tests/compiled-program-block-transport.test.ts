import {
	defineUniversalComponent,
	universalFor,
	universalPlan,
	type UniversalHostTemplateProgram,
	type UniversalProgramPlan,
} from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { deriveLynxProgramIR } from '../src/compiler/derive-program.js';
import { compileLynxBlockTemplate, createLynxBlockCore } from '../src/core/block-core.js';
import { createLynxBlockBackgroundCore } from '../src/core/block-background.js';
import { createLynxBlockRoot } from '../src/core/block-root.js';
import {
	createLynxBlockDeltaProducer,
	preparedLynxBlockDeltaBatch,
} from '../src/core/block-delta-producer.js';
import { createLynxClientContainer } from '../src/core/client-driver.js';
import { createLynxCompiledProgramBlockTransport } from '../src/core/compiled-program-block-transport.js';
import { installLynxCompiledProgramReceiver } from '../src/core/compiled-program-receiver.js';
import { LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT } from '../src/core/compiled-program-wire.js';
import { lynxProgram, lynxProgramValue } from '../src/core/compiler-program.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import type { LynxContextProxy, LynxContextProxyEvent } from '../src/core/protocol.js';
import type { LynxComponent } from '../src/intrinsics.js';
import { createFakePAPI, type FakeNode, shape } from './_fixtures/fake-element-papi.js';

const MODULE = 'tests/CompactBlockRow.lynx.tsrx';
const ADDRESS = Object.freeze({ module: MODULE, index: 0 });
const PROGRAM: UniversalHostTemplateProgram = Object.freeze({
	nodes: Object.freeze([
		Object.freeze({
			type: 'view',
			parent: -1,
			props: Object.freeze({}),
			bindings: Object.freeze([Object.freeze({ name: 'class', valueIndex: 0 })]),
		}),
		Object.freeze({ type: 'text', parent: 0, props: Object.freeze({}) }),
		Object.freeze({
			type: '#text',
			parent: 1,
			props: Object.freeze({}),
			bindings: Object.freeze([Object.freeze({ name: 'value', valueIndex: 1 })]),
		}),
	]),
	events: Object.freeze([
		Object.freeze({ node: 0, type: 'bindtap', priority: 'discrete' as const }),
	]),
});

function emittedPlan(): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(PROGRAM, {
		name: 'createCompactBlockRow',
		slotUpdates: true,
	});
	return {
		kind: 'program',
		slots: ['p:class', 'c', 'e:bindtap'],
		nodes: PROGRAM.nodes.length,
		values: [0, 1],
		events: [{ node: 0, slot: 2, type: 'bindtap', priority: 'discrete' }],
		ranges: [],
		bind: new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'],
	};
}
const APPLICATION_MODULE = 'tests/CompactBlockApplication.lynx.tsrx';
const APPLICATION_PLAN = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			props: {},
			children: [{ kind: 'text', slot: 1 }],
		},
	],
});
const APPLICATION_IR = deriveLynxProgramIR(APPLICATION_PLAN.root as never)!;
const APPLICATION_PROGRAM = lynxProgram('lynx', {
	...APPLICATION_IR,
	address: {
		module: APPLICATION_MODULE,
		index: 0,
		digest: '0123456789abcdef',
	},
});
const CompilerApplication = defineUniversalComponent(
	'lynx',
	({ className, label }: { readonly className: string; readonly label: string }) =>
		lynxProgramValue(APPLICATION_PROGRAM, [className, label]) as never,
);

function emittedApplicationPlan(): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(APPLICATION_IR.wire, {
		name: 'createCompactBlockApplication',
		ranges: APPLICATION_IR.ranges,
		slotUpdates: true,
		structuralRuns: true,
	});
	return {
		kind: 'program',
		slots: ['p:class', 'c'],
		nodes: APPLICATION_IR.wire.nodes.length,
		values: [0, 1],
		events: [],
		ranges: [],
		wire: APPLICATION_IR.wire,
		bind: new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'],
	};
}
interface RangeRow {
	readonly id: number;
	readonly label: string;
}

const RANGE_PARENT_MODULE = 'tests/CompactRangePage.lynx.tsrx';
const RANGE_ROW_MODULE = 'tests/CompactRangeRow.lynx.tsrx';
const RANGE_PARENT_SOURCE = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	props: { class: 'rows' },
	children: [{ kind: 'slot', slot: 0 }],
});
const RANGE_ROW_SOURCE = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			props: {},
			children: [{ kind: 'text', slot: 1 }],
		},
	],
});
const RANGE_PARENT_IR = deriveLynxProgramIR(RANGE_PARENT_SOURCE.root as never)!;
const RANGE_ROW_IR = deriveLynxProgramIR(RANGE_ROW_SOURCE.root as never)!;
const RANGE_PARENT_PROGRAM = lynxProgram('lynx', {
	...RANGE_PARENT_IR,
	address: {
		module: RANGE_PARENT_MODULE,
		index: 0,
		digest: '1111111111111111',
	},
});
const RANGE_ROW_PROGRAM = lynxProgram('lynx', {
	...RANGE_ROW_IR,
	address: {
		module: RANGE_ROW_MODULE,
		index: 0,
		digest: '2222222222222222',
	},
});
const RangeApplication = defineUniversalComponent(
	'lynx',
	({ rows }: { readonly rows: readonly RangeRow[] }) =>
		lynxProgramValue(RANGE_PARENT_PROGRAM, [
			universalFor(
				rows,
				(row: RangeRow) => row.id,
				(row: RangeRow) => lynxProgramValue(RANGE_ROW_PROGRAM, ['row', row.label]) as never,
			),
		]) as never,
	{ hookScope: false },
);

function emittedRangeParentPlan(): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(RANGE_PARENT_IR.wire, {
		name: 'createCompactRangePage',
		ranges: RANGE_PARENT_IR.ranges,
		slotUpdates: true,
		structuralRuns: true,
	});
	return {
		kind: 'program',
		slots: ['r'],
		nodes: RANGE_PARENT_IR.wire.nodes.length,
		values: [],
		events: [],
		ranges: RANGE_PARENT_IR.ranges,
		wire: RANGE_PARENT_IR.wire,
		bind: new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'],
	};
}

function emittedRangeRowPlan(): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(RANGE_ROW_IR.wire, {
		name: 'createCompactRangeRow',
		ranges: RANGE_ROW_IR.ranges,
		slotUpdates: true,
		structuralRuns: true,
	});
	return {
		kind: 'program',
		slots: ['p:class', 'c'],
		nodes: RANGE_ROW_IR.wire.nodes.length,
		values: [0, 1],
		events: [],
		ranges: [],
		wire: RANGE_ROW_IR.wire,
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

class HeldReplyContext implements LynxContextProxy {
	holdReplies = false;
	readonly events: LynxContextProxyEvent[] = [];
	private readonly held: LynxContextProxyEvent[] = [];
	private readonly listeners = new Map<string, Set<(event: LynxContextProxyEvent) => void>>();

	dispatchEvent(event: LynxContextProxyEvent): void {
		this.events.push(event);
		if (this.holdReplies && event.type === LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT) {
			this.held.push(event);
			return;
		}
		this.deliver(event);
	}

	addEventListener(type: string, listener: (event: LynxContextProxyEvent) => void): void {
		let listeners = this.listeners.get(type);
		if (listeners === undefined) this.listeners.set(type, (listeners = new Set()));
		listeners.add(listener);
	}

	removeEventListener(type: string, listener: (event: LynxContextProxyEvent) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	releaseReplies(): void {
		for (const event of this.held.splice(0)) this.deliver(event);
	}

	private deliver(event: LynxContextProxyEvent): void {
		for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
	}
}

function setup(
	resolveProgram: (module: string, index: number) => UniversalProgramPlan | undefined = (
		module,
		index,
	) => (module === MODULE && index === ADDRESS.index ? emittedPlan() : undefined),
) {
	const context = new HeldReplyContext();
	const papi = emittedHost();
	const page = papi.createPage('0', 0);
	const receiver = installLynxCompiledProgramReceiver({
		context,
		page,
		papi,
		resolveProgram,
	});
	const container = createLynxClientContainer();
	const transport = createLynxCompiledProgramBlockTransport(context, container);
	const core = createLynxBlockCore({
		templateRuns: () => true,
		deltaProducer: transport.blockDeltaProducer,
	});
	const root = createLynxBlockRoot({ container, transport, transportRoot: 91, core });
	transport.bindRoot(root);
	return { context, page, receiver, container, transport, core, root };
}

describe('Lynx compact compiled-program Block transport', () => {
	it('drives an ordinary compiler component through producer-native frames', async () => {
		const context = new HeldReplyContext();
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const receiver = installLynxCompiledProgramReceiver({
			context,
			page,
			papi,
			resolveProgram: (module, index) =>
				module === APPLICATION_MODULE && index === 0 ? emittedApplicationPlan() : undefined,
		});
		const container = createLynxClientContainer();
		const transport = createLynxCompiledProgramBlockTransport(context, container);
		const background = createLynxBlockBackgroundCore({
			container,
			transport,
			scheduleMicrotask: (callback) => void Promise.resolve().then(callback),
			transportRoot: 92,
		});
		transport.bindRoot(background);
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;

		const first = await background.renderAsync(
			CompilerApplication as LynxComponent<{
				readonly className: string;
				readonly label: string;
			}>,
			{ className: 'row', label: 'before' },
		);
		expect(first.batch.commands).toEqual([]);
		expect(preparedLynxBlockDeltaBatch(first.batch)?.operations).toEqual([
			expect.objectContaining({
				op: 'run',
				parent: { instance: 1, slot: 0 },
				firstInstance: 2,
				count: 1,
				values: ['row', 'before'],
			}),
		]);
		expect(shape(page)).toMatchObject({
			type: 'page',
			children: [
				{
					type: 'view',
					classes: 'row',
					children: [{ type: 'text', children: [{ type: 'raw-text', text: 'before' }] }],
				},
			],
		});

		const second = await background.renderAsync(
			CompilerApplication as LynxComponent<{
				readonly className: string;
				readonly label: string;
			}>,
			{ className: 'row', label: 'after' },
		);
		expect(second.batch.commands).toEqual([]);
		expect(preparedLynxBlockDeltaBatch(second.batch)?.operations).toEqual([
			{ op: 'set', instance: 2, slot: 1, value: 'after' },
		]);
		expect(page.children[0]!.children[0]!.children[0]!.text).toBe('after');
		expect(transport.preparationCount()).toBe(2);
		expect(transport.directPreparationCount()).toBe(2);

		await background.unmountAsync();
		expect(page.children).toEqual([]);
		transport.close();
		receiver.close();
	});
	it('applies mixed keyed range deltas while retaining survivor identity', async () => {
		const context = new HeldReplyContext();
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const receiver = installLynxCompiledProgramReceiver({
			context,
			page,
			papi,
			resolveProgram: (module, index) => {
				if (index !== 0) return undefined;
				if (module === RANGE_PARENT_MODULE) return emittedRangeParentPlan();
				if (module === RANGE_ROW_MODULE) return emittedRangeRowPlan();
				return undefined;
			},
		});
		const container = createLynxClientContainer();
		const transport = createLynxCompiledProgramBlockTransport(context, container);
		const background = createLynxBlockBackgroundCore({
			container,
			transport,
			scheduleMicrotask: (callback) => void Promise.resolve().then(callback),
			transportRoot: 93,
		});
		transport.bindRoot(background);
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;

		const render = (rows: readonly RangeRow[]) =>
			background.renderAsync(
				RangeApplication as LynxComponent<{ readonly rows: readonly RangeRow[] }>,
				{ rows },
			);
		const mounted = await render([
			{ id: 1, label: 'one' },
			{ id: 2, label: 'two' },
			{ id: 3, label: 'three' },
		]);
		const mountOperations = preparedLynxBlockDeltaBatch(mounted.batch)!.operations;
		expect(mountOperations.map((operation) => operation.op)).toEqual(['run', 'run']);
		expect(mountOperations[1]).toMatchObject({
			op: 'run',
			parent: { instance: 2, slot: 0 },
			firstInstance: 3,
			count: 3,
		});
		const rowsHost = page.children[0]!;
		const initial = new Map(
			rowsHost.children.map((row) => [row.children[0]!.children[0]!.text, row.uid]),
		);

		const updated = await render([
			{ id: 3, label: 'three' },
			{ id: 1, label: 'one edited' },
			{ id: 4, label: 'four' },
		]);
		const updateOperations = preparedLynxBlockDeltaBatch(updated.batch)!.operations;
		expect(updateOperations.map((operation) => operation.op)).toEqual(
			expect.arrayContaining(['remove', 'run', 'set', 'move']),
		);
		expect(updateOperations).toEqual(
			expect.arrayContaining([
				{ op: 'remove', firstInstance: 4, count: 1 },
				expect.objectContaining({
					op: 'run',
					parent: { instance: 2, slot: 0 },
					firstInstance: 6,
					count: 1,
					values: ['row', 'four'],
				}),
				{ op: 'set', instance: 3, slot: 1, value: 'one edited' },
			]),
		);
		expect(rowsHost.children.map((row) => row.children[0]!.children[0]!.text)).toEqual([
			'three',
			'one edited',
			'four',
		]);
		expect(rowsHost.children[0]!.uid).toBe(initial.get('three'));
		expect(rowsHost.children[1]!.uid).toBe(initial.get('one'));
		expect([...initial.values()]).not.toContain(rowsHost.children[2]!.uid);

		const cleared = await render([]);
		expect(preparedLynxBlockDeltaBatch(cleared.batch)?.operations).toEqual([
			{ op: 'clear', parent: { instance: 2, slot: 0 } },
		]);
		expect(rowsHost.children).toEqual([]);

		await background.unmountAsync();
		expect(page.children).toEqual([]);
		expect(transport.directPreparationCount()).toBe(4);
		transport.close();
		receiver.close();
	});
	it('cancels an unsent root while compact readiness is pending', async () => {
		const { receiver, transport, core, root } = setup();
		root.beginAttempt();
		core.mount(null, null, compileLynxBlockTemplate(PROGRAM, ADDRESS), ['row', 'pending']);
		const rendering = root.commit();
		const reason = new Error('test root ended before compact readiness');

		expect(await transport.cancelPendingBeforeReady(reason)).toBe(true);
		await expect(rendering).rejects.toBe(reason);
		expect(transport.preparationCount()).toBe(1);
		expect(transport.closedReason()).toBe(reason);
		expect(root.abortAttempt()).toBe(true);
		receiver.close();
	});

	it('delivers a pre-ready page tombstone to a handler bound after construction', async () => {
		const context = new HeldReplyContext();
		const container = createLynxClientContainer();
		const reason = { destroyed: true };
		const transport = createLynxCompiledProgramBlockTransport(context, container, {
			isPageDestroyed: () => reason.destroyed,
		});
		await expect(transport.ready).rejects.toThrow('page lifetime was destroyed');

		let deliveries = 0;
		transport.bindPageDestroy(() => {
			deliveries++;
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(deliveries).toBe(1);
		expect(transport.closedReason()?.message).toContain('page lifetime was destroyed');
	});

	it('settles logical teardown locally after native page destroy', async () => {
		const { context, page, receiver, container, transport, core, root } = setup();
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;

		root.beginAttempt();
		const block = core.mount(null, null, compileLynxBlockTemplate(PROGRAM, ADDRESS), [
			'row',
			'child',
		]);
		await root.commit();
		expect(root.acceptedVersion()).toBe(1);
		expect(page.children).toHaveLength(1);

		let teardownAcknowledged = false;
		transport.bindPageDestroy(async () => {
			const batch = {
				renderer: 'lynx' as const,
				version: 2,
				commands: [
					{ op: 'remove' as const, parent: null, id: block.firstId },
					{ op: 'destroy' as const, id: block.firstId + 2 },
					{ op: 'destroy' as const, id: block.firstId + 1 },
					{ op: 'destroy' as const, id: block.firstId },
				],
			};
			await transport
				.prepareBatch(container, batch, {
					protocol: 1,
					renderer: 'lynx',
					root: 91,
					version: 2,
				})
				.apply(() => {
					teardownAcknowledged = true;
				});
		});
		receiver.destroyPage();
		const crossingsAtDestroy = context.events.length;
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(page.children).toEqual([]);
		expect(context.events).toHaveLength(crossingsAtDestroy);
		expect(teardownAcknowledged).toBe(true);
		expect(transport.acceptedIdentity()?.version).toBe(2);
		expect(transport.preparationCount()).toBe(2);
		expect(transport.closedReason()?.message).toContain('page lifetime was destroyed');
	});

	it('publishes one addressed Block run at ACK and carries sparse updates', async () => {
		const { context, page, receiver, transport, core, root } = setup();
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;

		const calls: unknown[] = [];
		root.beginAttempt();
		const block = core.mount(null, null, compileLynxBlockTemplate(PROGRAM, ADDRESS), [
			'row',
			'before',
		]);
		root.bindListeners(block, [(payload) => calls.push(payload)]);
		context.holdReplies = true;
		const mounting = root.commit();
		await Promise.resolve();
		await Promise.resolve();

		expect(page.children).toHaveLength(1);
		expect(root.acceptedVersion()).toBe(0);
		transport.dispatchNativeEventBatch([
			{
				identity: {
					root: 91,
					id: 2,
					generation: 1,
					listener: block.firstListenerId!,
					priority: 'discrete',
				},
				payload: { type: 'tap-before-ack' },
			},
		]);
		expect(calls).toEqual([]);

		context.holdReplies = false;
		context.releaseReplies();
		await mounting;
		expect(root.acceptedVersion()).toBe(1);
		expect(calls).toEqual([{ type: 'tap-before-ack' }]);
		expect(shape(page)).toMatchObject({
			type: 'page',
			children: [
				{
					type: 'view',
					classes: 'row',
					children: [{ type: 'text', children: [{ type: 'raw-text', text: 'before' }] }],
				},
			],
		});

		root.beginAttempt();
		expect(core.setSlotValue(block, 1, 'after')).toBe(true);
		context.holdReplies = true;
		const updating = root.commit();
		await Promise.resolve();
		await Promise.resolve();
		transport.dispatchNativeEventBatch([
			{
				identity: {
					root: 91,
					id: 2,
					generation: 1,
					listener: block.firstListenerId!,
					priority: 'discrete',
				},
				payload: { type: 'tap-old-tree-during-ack' },
			},
		]);
		expect(calls).toEqual([{ type: 'tap-before-ack' }, { type: 'tap-old-tree-during-ack' }]);
		context.holdReplies = false;
		context.releaseReplies();
		await updating;
		expect(root.acceptedVersion()).toBe(2);
		expect(page.children[0]!.children[0]!.children[0]!.text).toBe('after');

		transport.dispatchNativeEventBatch([
			{
				identity: {
					root: 91,
					id: 2,
					generation: 1,
					listener: block.firstListenerId!,
					priority: 'discrete',
				},
				payload: { type: 'tap-after-ack' },
			},
		]);
		expect(calls).toEqual([
			{ type: 'tap-before-ack' },
			{ type: 'tap-old-tree-during-ack' },
			{ type: 'tap-after-ack' },
		]);

		await transport.dispose();
		expect(page.children).toEqual([]);
		expect(transport.ownedRoot()).toBeNull();
		transport.close();
		receiver.close();
	});

	it('aborts a prepared commit while compact readiness is still pending', async () => {
		const { receiver, container, transport, core } = setup();
		core.mount(null, null, compileLynxBlockTemplate(PROGRAM, ADDRESS), ['row', 'aborted']);
		const batch = core.flush()!;
		const identity = { protocol: 1 as const, renderer: 'lynx', root: 91, version: 1 };
		const prepared = transport.prepareBatch(container, batch, identity);
		const applying = prepared.apply(() => {
			throw new Error('An aborted commit must not acknowledge.');
		});
		prepared.abort();

		await expect(applying).rejects.toThrow('aborted before readiness');
		expect(transport.acceptedIdentity()).toBeNull();
		transport.close();
		receiver.close();
	});

	it('publishes producer state before accepted lifecycle prepares a reentrant commit', async () => {
		const { page, receiver, transport, core, root } = setup();
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;

		root.beginAttempt();
		const block = core.mount(null, null, compileLynxBlockTemplate(PROGRAM, ADDRESS), [
			'row',
			'first',
		]);
		let reentrant: Promise<unknown> | null = null;
		await root.commit(() => {
			root.beginAttempt();
			expect(core.setSlotValue(block, 1, 'reentrant')).toBe(true);
			reentrant = root.commit();
		});
		await reentrant;

		expect(root.acceptedVersion()).toBe(2);
		expect(page.children[0]!.children[0]!.children[0]!.text).toBe('reentrant');
		await transport.dispose();
		transport.close();
		receiver.close();
	});

	it('terminally disposes accepted main state after local ACK publication faults', async () => {
		const { page, receiver, container, transport, core } = setup();
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;

		core.mount(null, null, compileLynxBlockTemplate(PROGRAM, ADDRESS), ['row', 'accepted']);
		const batch = core.flush()!;
		const identity = { protocol: 1 as const, renderer: 'lynx', root: 91, version: 1 };
		await expect(
			transport.prepareBatch(container, batch, identity).apply(() => {
				throw new Error('local ACK publication failed');
			}),
		).rejects.toThrow('local ACK publication failed');

		expect(page.children).toHaveLength(1);
		expect(transport.acceptedIdentity()).toEqual(identity);
		await transport.dispose();
		expect(page.children).toEqual([]);
		expect(transport.ownedRoot()).toBeNull();
		transport.close();
		receiver.close();
	});

	it("refuses another transport's producer-native batch before crossing ContextProxy", () => {
		const { context, receiver, container, transport } = setup();
		const foreign = createLynxBlockDeltaProducer();
		foreign.run({
			address: ADDRESS,
			parent: { instance: 1, slot: 0 },
			before: null,
			count: 1,
			values: ['row', 'foreign'],
		});
		const batch = foreign.flush(1)!;
		const before = context.events.length;

		expect(() =>
			transport.prepareBatch(container, batch, {
				protocol: 1,
				renderer: 'lynx',
				root: 91,
				version: 1,
			}),
		).toThrow('producer-native delta batch');
		expect(context.events).toHaveLength(before);

		transport.close();
		receiver.close();
	});
	it('refuses an unaddressed Block batch before it crosses ContextProxy', async () => {
		const { context, receiver, transport, core, root } = setup();
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;
		const before = context.events.length;

		root.beginAttempt();
		expect(() =>
			core.mount(null, null, compileLynxBlockTemplate(PROGRAM), ['row', 'unaddressed']),
		).toThrow('requires an addressed program');
		expect(context.events).toHaveLength(before);
		expect(root.abortAttempt()).toBe(true);

		transport.close();
		receiver.close();
	});

	it('keeps the delta draft unpublished when main rejects and retries the exact batch', async () => {
		let resolvable = false;
		const { page, receiver, container, transport, core, root } = setup((module, index) =>
			resolvable && module === MODULE && index === ADDRESS.index ? emittedPlan() : undefined,
		);
		receiver.markProgramsReady();
		receiver.markPageReady();
		await transport.ready;

		root.beginAttempt();
		core.mount(null, null, compileLynxBlockTemplate(PROGRAM, ADDRESS), ['row', 'retry']);
		const batch = core.flush()!;
		const identity = { protocol: 1 as const, renderer: 'lynx', root: 91, version: 1 };
		await expect(
			transport.prepareBatch(container, batch, identity).apply(() => {}),
		).rejects.toThrow();
		expect(page.children).toEqual([]);
		expect(transport.acceptedIdentity()).toBeNull();

		resolvable = true;
		let acknowledged = false;
		await transport.prepareBatch(container, batch, identity).apply(() => {
			acknowledged = true;
		});
		expect(acknowledged).toBe(true);
		expect(transport.acceptedIdentity()).toEqual(identity);
		expect(page.children).toHaveLength(1);

		await transport.dispose();
		transport.close();
		receiver.close();
	});
});
