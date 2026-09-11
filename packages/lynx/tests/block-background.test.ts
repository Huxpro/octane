// Issue-#103 B0: the compile-time core switch, and the Block core standing
// where the universal core stands.
//
// Two things are under test and they fail differently. The first is the switch
// itself — `@octanejs/rspeedy-plugin` statically replaces the selection module
// and `createLynxRoot` binds one core for the life of the bundle — so it is
// exercised by replacing that exact module and building a real root. The second
// is what that core does, which
// runs over the same `createLynxBackgroundTransport` a production root builds,
// as `block-root.test.ts` does, so a frame that would fault a real page faults
// here.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { compileLynxBlockTemplate, createLynxBlockCore } from '../src/core/block-core.js';
import { createLynxBlockBackgroundCore } from '../src/core/block-background.js';
import { withLynxBlockProgram, type LynxBlockProgram } from '../src/core/block-program.js';
import { createLynxClientContainer } from '../src/core/client-driver.js';
import { createLynxHostContainer, prepareLynxHostBatch } from '../src/core/host-driver.js';
import { createLynxBackgroundTransport } from '../src/core/transport.js';
import {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	type LynxContextProxy,
	type LynxTransportCommitMessage,
} from '../src/core/protocol.js';
import type { LynxComponent } from '../src/intrinsics.js';
import { createFakePAPI } from './_fixtures/fake-element-papi.js';
import { FakeContextProxy, flushMicrotasks, installMainSide } from './_fixtures/fake-lynx-wire.js';

const PAGE_TEMPLATE = compileLynxBlockTemplate({
	nodes: [
		{ type: 'view', parent: -1, props: { class: 'page' } },
		{ type: 'view', parent: 0, props: { class: 'rows' } },
	],
	events: [],
});

const ROW_TEMPLATE = compileLynxBlockTemplate({
	nodes: [
		{ type: 'view', parent: -1, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
		{ type: 'text', parent: 0, props: {} },
		{
			type: '#text',
			parent: 1,
			props: { value: '' },
			bindings: [{ name: 'value', valueIndex: 1 }],
		},
	],
	events: [{ node: 0, type: 'bindtap', priority: 'discrete' }],
});

const ROW_CLASS = 0;

interface ProgramProps {
	readonly labels: readonly string[];
	readonly taps?: (id: number) => void;
}

/**
 * The smallest thing a compiler lowering will emit: a page shell, a keyed range
 * over its rows, and a scoped write for the state that changes. Hand-written,
 * which is the whole reason it lives in a test rather than in an app.
 */
function tableProgram(): LynxBlockProgram<ProgramProps> {
	let slot: ReturnType<ReturnType<typeof createLynxBlockCore>['openForSlot']> | null = null;
	let released = 0;
	const rows = (props: ProgramProps) =>
		props.labels.map((label, index) => ({ id: index + 1, label }));
	return {
		mount(context, props) {
			const page = context.core.mount(null, null, PAGE_TEMPLATE, []);
			slot = context.core.openForSlot(page, 1);
			context.core.fillForSlot(
				slot,
				ROW_TEMPLATE,
				rows(props),
				(row) => row.id,
				(row) => ['row', row.label],
			);
			for (const row of rows(props)) {
				const block = slot.items.get(row.id)!;
				context.root.bindListeners(block, [() => props.taps?.(row.id)]);
			}
		},
		update(context, props) {
			context.core.reconcileForSlot(
				slot!,
				ROW_TEMPLATE,
				rows(props),
				(row) => row.id,
				(row) => ['row', row.label],
				(block) => {
					released++;
					context.root.releaseListeners(block);
				},
			);
		},
		unmount(context) {
			context.core.clearForSlot(slot!, (block) => {
				released++;
				context.root.releaseListeners(block);
			});
		},
		// Exposed for assertions; not part of the contract.
		...({ releases: () => released } as object),
	} as LynxBlockProgram<ProgramProps> & { releases(): number };
}

function scene(
	scheduleMicrotask: (task: () => void) => void = (task) => void Promise.resolve().then(task),
) {
	const context = new FakeContextProxy();
	const main = installMainSide(context);
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(context, container);
	const core = createLynxBlockCore();
	const background = createLynxBlockBackgroundCore({
		container,
		transport,
		scheduleMicrotask,
		core,
		transportRoot: 1,
	});
	transport.bindRoot(background);
	// How many of `main.commits` have been acknowledged. Kept on the scene rather
	// than inside `settle`, because acknowledging one commit twice is a protocol
	// fault the transport correctly refuses.
	return { context, main, container, transport, core, background, acknowledged: 0 };
}

type Scene = ReturnType<typeof scene>;

/** Let a render reach the wire, acknowledge every commit it produced, settle. */
async function settle(scene: Scene, work: Promise<unknown>) {
	let settled = false;
	const tracked = work.then(
		(value) => {
			settled = true;
			return value;
		},
		(error) => {
			settled = true;
			throw error;
		},
	);
	tracked.catch(() => undefined);
	for (let guard = 0; guard < 20 && !settled; guard++) {
		await flushMicrotasks();
		while (scene.acknowledged < scene.main.commits.length) {
			scene.main.acknowledge(scene.main.commits[scene.acknowledged++]!);
		}
	}
	return tracked;
}

function paint(commits: readonly LynxTransportCommitMessage[]) {
	const papi = createFakePAPI();
	const container = createLynxHostContainer(papi, { root: 1 });
	for (const commit of commits) prepareLynxHostBatch(container, commit.batch).apply();
	return papi;
}

function rowLabels(papi: ReturnType<typeof createFakePAPI>): string[] {
	const page = papi.pages[0]!.children[0]!;
	return page.children[0]!.children.map((row) => row.children[0]!.children[0]!.text ?? '');
}

const plainComponent = (() => null) as unknown as LynxComponent<ProgramProps>;

describe('Lynx block background core', () => {
	it('refuses a component that is neither carrying a program nor compiled', async () => {
		const { background } = scene();
		// A component that carries no program is derived from what it renders
		// (`block-component.ts`), so this is what is left once that path exists:
		// a plain function the compiler never lowered has nothing to derive from.
		// The derivation itself is covered end to end in `block-component.test.ts`.
		await expect(background.renderAsync(plainComponent as never, { labels: [] })).rejects.toThrow(
			/did not return a compiled template/,
		);
	});

	it('mounts a block program over the real transport and paints it', async () => {
		const harness = scene();
		const { main, background } = harness;
		const component = withLynxBlockProgram(
			(() => null) as unknown as LynxComponent<ProgramProps>,
			tableProgram(),
		);

		const attempt = await settle(
			harness,
			background.renderAsync(component as never, { labels: ['a', 'b', 'c'] }),
		);

		expect((attempt as { status: string }).status).toBe('committed');
		expect(rowLabels(paint(main.commits))).toEqual(['a', 'b', 'c']);
	});

	it('tracks a render on the ES2015 Lynx background Promise surface', async () => {
		const harness = scene();
		const component = withLynxBlockProgram(
			(() => null) as unknown as LynxComponent<ProgramProps>,
			tableProgram(),
		);
		const descriptor = Object.getOwnPropertyDescriptor(Promise, 'allSettled');
		Object.defineProperty(Promise, 'allSettled', {
			configurable: true,
			value: undefined,
			writable: true,
		});

		let rendering: Promise<unknown>;
		try {
			rendering = harness.background.renderAsync(component as never, { labels: ['native'] });
		} finally {
			if (descriptor === undefined) delete (Promise as { allSettled?: unknown }).allSettled;
			else Object.defineProperty(Promise, 'allSettled', descriptor);
		}

		await settle(harness, rendering!);
		await harness.background.flushTransport();
		expect(rowLabels(paint(harness.main.commits))).toEqual(['native']);
	});

	it('publishes afterCommit work only after the host acknowledges the frame', async () => {
		const harness = scene();
		let published = 0;
		const component = withLynxBlockProgram((() => null) as unknown as LynxComponent<ProgramProps>, {
			mount(context) {
				context.core.mount(null, null, PAGE_TEMPLATE, []);
				context.afterCommit(() => published++);
			},
		});

		const rendering = harness.background.renderAsync(component as never, { labels: [] });
		await flushMicrotasks();
		expect(harness.main.commits).toHaveLength(1);
		expect(published).toBe(0);

		harness.main.acknowledge(harness.main.commits[0]!);
		harness.acknowledged++;
		await rendering;
		expect(published).toBe(1);
	});

	it('schedules passive work only after acknowledgement and flushes it before the next render', async () => {
		const microtasks: (() => void)[] = [];
		const harness = scene((task) => microtasks.push(task));
		const lifecycle: string[] = [];
		const component = withLynxBlockProgram((() => null) as unknown as LynxComponent<ProgramProps>, {
			mount(context) {
				context.core.mount(null, null, PAGE_TEMPLATE, []);
				context.afterPassiveCommit(() => lifecycle.push('passive'));
			},
			update() {
				lifecycle.push('update');
			},
		});

		const mounting = harness.background.renderAsync(component as never, { labels: [] });
		await flushMicrotasks();
		expect(lifecycle).toEqual([]);
		expect(microtasks).toEqual([]);

		harness.main.acknowledge(harness.main.commits[0]!);
		harness.acknowledged++;
		await mounting;
		expect(lifecycle).toEqual([]);
		expect(microtasks).toHaveLength(1);

		await harness.background.renderAsync(component as never, { labels: [] });
		expect(lifecycle).toEqual(['passive', 'update']);
		// The already-scheduled callback is now a harmless empty flush.
		microtasks.shift()!();
		expect(lifecycle).toEqual(['passive', 'update']);
	});

	it('discards afterCommit work from a render that throws before commit', async () => {
		const harness = scene();
		let fail = true;
		let published = 0;
		const component = withLynxBlockProgram((() => null) as unknown as LynxComponent<ProgramProps>, {
			mount(context) {
				context.afterCommit(() => published++);
				if (fail) throw new Error('render failed');
				context.core.mount(null, null, PAGE_TEMPLATE, []);
			},
		});

		await expect(
			harness.background.renderAsync(component as never, { labels: [] }),
		).rejects.toThrow('render failed');
		expect(published).toBe(0);
		fail = false;
		await settle(harness, harness.background.renderAsync(component as never, { labels: [] }));
		expect(published).toBe(1);
	});

	it('rolls back a carried program mutation that calls commit outside renderAsync', async () => {
		const harness = scene();
		let update: ((label: string) => Promise<unknown>) | null = null;
		const component = withLynxBlockProgram((() => null) as unknown as LynxComponent<ProgramProps>, {
			mount(context) {
				const page = context.core.mount(null, null, PAGE_TEMPLATE, []);
				const slot = context.core.openForSlot(page, 1);
				context.core.fillForSlot(
					slot,
					ROW_TEMPLATE,
					['alpha'],
					() => 1,
					(label) => ['row', label],
				);
				const row = slot.items.get(1)!;
				update = (label) => {
					context.core.setSlotValue(row, 1, label);
					return context.commit();
				};
			},
		});
		await settle(harness, harness.background.renderAsync(component as never, { labels: [] }));

		const rejected = update!('beta');
		await flushMicrotasks();
		expect(harness.main.commits).toHaveLength(2);
		harness.main.reject(harness.main.commits[1]!, 'injected carried-program rejection');
		await expect(rejected).rejects.toThrow('injected carried-program rejection');

		const retried = update!('beta');
		await flushMicrotasks();
		expect(harness.main.commits).toHaveLength(3);
		harness.main.acknowledge(harness.main.commits[2]!);
		await retried;
		expect(rowLabels(paint([harness.main.commits[0]!, harness.main.commits[2]!] as never))).toEqual(
			['beta'],
		);
	});

	it('keeps a carried program mounted when its unmount frame is rejected', async () => {
		const harness = scene();
		const component = withLynxBlockProgram(
			(() => null) as unknown as LynxComponent<ProgramProps>,
			tableProgram(),
		);
		const props = { labels: ['alpha'] };
		await settle(harness, harness.background.renderAsync(component as never, props));

		const rejected = harness.background.unmountAsync();
		await flushMicrotasks();
		expect(harness.main.commits).toHaveLength(2);
		harness.main.reject(harness.main.commits[1]!, 'injected unmount rejection');
		harness.acknowledged++;
		await expect(rejected).rejects.toThrow('injected unmount rejection');

		// The accepted program and its logical range survived. Rendering the
		// same props is an empty update rather than a duplicate first mount.
		await settle(harness, harness.background.renderAsync(component as never, props));
		expect(harness.main.commits).toHaveLength(2);
		await settle(harness, harness.background.unmountAsync());
		expect(harness.main.commits).toHaveLength(3);
	});

	it('routes a native delivery back to the listener the program bound', async () => {
		const harness = scene();
		const { main, background } = harness;
		const taps: number[] = [];
		const component = withLynxBlockProgram(
			(() => null) as unknown as LynxComponent<ProgramProps>,
			tableProgram(),
		);
		await settle(
			harness,
			background.renderAsync(component as never, {
				labels: ['a', 'b'],
				taps: (id: number) => taps.push(id),
			}),
		);

		background.dispatchTransportEvent({
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			root: 1,
			version: 1,
			type: 'event',
			priority: 'discrete',
			deliveries: [{ listener: 2, payload: null }],
		} as never);

		expect(taps).toEqual([2]);
	});

	it('serializes overlapping renders: the second becomes an update, never a second mount', async () => {
		const harness = scene();
		const { main, background } = harness;
		const program = tableProgram();
		let mounts = 0;
		const baseMount = program.mount.bind(program);
		const counting: typeof program = {
			...program,
			mount(context, props) {
				mounts++;
				return baseMount(context, props);
			},
		};
		const component = withLynxBlockProgram(
			(() => null) as unknown as LynxComponent<ProgramProps>,
			counting,
		);

		// Issued back to back without awaiting — the pattern the universal core
		// supports and coalesces. Both must succeed, the program must mount once,
		// and the painted page must be the second render's rows.
		const first = background.renderAsync(component as never, { labels: ['a', 'b'] });
		const second = background.renderAsync(component as never, { labels: ['a', 'b', 'c'] });
		await settle(harness, Promise.all([first, second]));

		expect(mounts).toBe(1);
		expect(rowLabels(paint(main.commits))).toEqual(['a', 'b', 'c']);
	});

	it('re-renders through update() and refuses a program that has none', async () => {
		const harness = scene();
		const { main, background } = harness;
		const component = withLynxBlockProgram(
			(() => null) as unknown as LynxComponent<ProgramProps>,
			tableProgram(),
		);
		await settle(harness, background.renderAsync(component as never, { labels: ['a', 'b', 'c'] }));
		await settle(harness, background.renderAsync(component as never, { labels: ['a', 'c'] }));
		expect(rowLabels(paint(main.commits))).toEqual(['a', 'c']);

		const mountOnly = withLynxBlockProgram((() => null) as unknown as LynxComponent<ProgramProps>, {
			mount: () => undefined,
		});
		const second = scene();
		await settle(second, second.background.renderAsync(mountOnly as never, { labels: [] }));
		await expect(second.background.renderAsync(mountOnly as never, { labels: [] })).rejects.toThrow(
			/no update\(\)/,
		);
	});

	it('refuses to swap the program it mounted', async () => {
		const harness = scene();
		const { main, background } = harness;
		const first = withLynxBlockProgram(
			(() => null) as unknown as LynxComponent<ProgramProps>,
			tableProgram(),
		);
		const other = withLynxBlockProgram(
			(() => null) as unknown as LynxComponent<ProgramProps>,
			tableProgram(),
		);
		await settle(harness, background.renderAsync(first as never, { labels: ['a'] }));
		await expect(background.renderAsync(other as never, { labels: ['a'] })).rejects.toThrow(
			/cannot swap the program/,
		);
	});
});

describe('Lynx background core switch', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.doUnmock('../src/core/background-core-selection.js');
		vi.resetModules();
	});

	it('keeps source consumers universal and exposes a literal Block replacement', async () => {
		expect(
			(await import('../src/core/background-core-selection.js')).LYNX_BLOCK_BACKGROUND_CORE,
		).toBe(false);
		expect(
			(await import('../src/core/background-core-selection.block.js')).LYNX_BLOCK_BACKGROUND_CORE,
		).toBe(true);
	});

	it('binds the block core into a real root when the bundle selects it', async () => {
		vi.doMock('../src/core/background-core-selection.js', () => ({
			LYNX_BLOCK_BACKGROUND_CORE: true,
		}));
		const { createLynxRoot } = await import('../src/root.js');
		const context = new FakeContextProxy();
		installMainSide(context);
		const root = createLynxRoot({
			target: { lynx: { getJSModule: () => undefined, getCoreContext: () => context } },
			context: context as unknown as LynxContextProxy,
			scheduleMicrotask: (callback) => void Promise.resolve().then(callback),
		});
		try {
			// The switch is what is under test, so the distinguisher is a component
			// the two cores answer differently: a universal root renders one that
			// returns `null`, and the Block core has nothing to lower it from.
			await expect(root.render(plainComponent, { labels: [] })).rejects.toThrow(
				/cannot lower component plainComponent onto the Block core/,
			);
		} finally {
			await root.unmount().catch(() => undefined);
		}
	});
});
