// Issue-#103 B0: the compile-time core switch, and the Block core standing
// where the universal core stands.
//
// Two things are under test and they fail differently. The first is the switch
// itself — `@octanejs/rspeedy-plugin` substitutes `__OCTANE_LYNX_BACKGROUND_CORE__`
// and `createLynxRoot` binds one core for the life of the bundle — so it is
// exercised the way a bundle exercises it: define the constant, re-evaluate the
// module graph, and build a real root. The second is what that core does, which
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

function scene() {
	const context = new FakeContextProxy();
	const main = installMainSide(context);
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(context, container);
	const core = createLynxBlockCore();
	const background = createLynxBlockBackgroundCore({
		container,
		transport,
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
	it('refuses a component that carries no block program, naming the missing layer', async () => {
		const { background } = scene();
		await expect(background.renderAsync(plainComponent as never, { labels: [] })).rejects.toThrow(
			/no component layer yet/,
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
	const globals = globalThis as unknown as Record<string, unknown>;

	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		delete globals.__OCTANE_LYNX_BACKGROUND_CORE__;
		vi.resetModules();
	});

	it('reads universal when the build plugin substituted nothing', async () => {
		const environment = await import('../src/core/environment.js');
		expect(environment.LYNX_BLOCK_BACKGROUND_CORE).toBe(false);
	});

	it('reads block only for the exact substituted value', async () => {
		globals.__OCTANE_LYNX_BACKGROUND_CORE__ = 'universal';
		expect((await import('../src/core/environment.js')).LYNX_BLOCK_BACKGROUND_CORE).toBe(false);
		vi.resetModules();
		globals.__OCTANE_LYNX_BACKGROUND_CORE__ = 'block';
		expect((await import('../src/core/environment.js')).LYNX_BLOCK_BACKGROUND_CORE).toBe(true);
	});

	it('binds the block core into a real root when the bundle selects it', async () => {
		globals.__OCTANE_LYNX_BACKGROUND_CORE__ = 'block';
		const { createLynxRoot } = await import('../src/root.js');
		const context = new FakeContextProxy();
		installMainSide(context);
		const root = createLynxRoot({
			target: { lynx: { getJSModule: () => undefined, getCoreContext: () => context } },
			context: context as unknown as LynxContextProxy,
			scheduleMicrotask: (callback) => void Promise.resolve().then(callback),
		});
		try {
			// The switch is what is under test: a universal root would render this
			// component, and a block root cannot, because it has no component layer.
			await expect(root.render(plainComponent, { labels: [] })).rejects.toThrow(
				/no component layer yet/,
			);
		} finally {
			await root.unmount().catch(() => undefined);
		}
	});
});
