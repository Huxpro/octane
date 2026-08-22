// Issue-#135 item 1b: a compiled component driving the Block core.
//
// Every earlier Block-core test drove the core by hand, from a program written
// in the test file. That proves the core, and it deliberately proves nothing
// about a *component*: a hand-written program is an architecture floor, and a
// number produced through one carries that label. This is the test that removes
// the label for the shapes it covers — the same compiled component, rendered
// through both cores, compared on what the host actually received.
//
// The oracle is the one `block-core-update-differential.test.ts` established,
// for the same reason: an application is a stream of states, so all three
// artifacts are compared after *every* step of a ladder rather than once at the
// end.
//
//   physical tree    what the shared applier painted, including event sites.
//   handle journal   the clone-safe public handle changes main publishes before
//                    acknowledging, which is what the background adopts.
//   event journal    every `setEvent` the applier issued, in order.
//
// The two cores are independent allocators that never had to agree about a
// number, so every integer identity is replaced by its rank in first-appearance
// order before comparing. That is a bijection or the comparison fails, so what
// survives is the claim worth making: the same tree, the same handles, the same
// events over the same nodes in the same order.
//
// What this does not cover is refused by name rather than half-rendered, and
// the refusals are asserted here too: a hooked setup and a keyed range site are
// the two seams item 1b leaves open.
import { describe, expect, it } from 'vitest';

import {
	createUniversalRoot,
	defineUniversalComponent,
	universalFor,
	universalPlan,
	universalValue,
	useState,
} from 'octane/universal/native';

import { createLynxBlockBackgroundCore } from '../src/core/block-background.js';
import { createLynxBlockCore, type LynxBlockCore } from '../src/core/block-core.js';
import { withLynxBlockProgram } from '../src/core/block-program.js';
import { createLynxClientContainer, createLynxClientDriver } from '../src/core/client-driver.js';
import {
	createLynxHostContainer,
	prepareLynxHostBatch,
	resolveLynxHostNativeEvent,
	type LynxResolvedNativeEvent,
} from '../src/core/host-driver.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	type LynxTransportCommitMessage,
} from '../src/core/protocol.js';
import { createLynxBackgroundTransport } from '../src/core/transport.js';
import type { LynxComponent } from '../src/intrinsics.js';
import {
	createFakePAPI,
	shape,
	withoutAllocatorIdentity,
	type FakeNode,
} from './_fixtures/fake-element-papi.js';
import { FakeContextProxy, flushMicrotasks, installMainSide } from './_fixtures/fake-lynx-wire.js';

interface CardProps {
	readonly label: string;
	readonly detail: string;
	readonly active: boolean;
	readonly onTap: () => void;
}

// Deliberately range-free: a keyed range is item 1c, and a test that mixed the
// two could not say which seam a failure came from. Everything else a component
// has is here — a bound class, two text holes at different depths, a static
// prop that must survive as static, and an event site.
const CARD_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			// A template program refuses an event on its root — the root is the node
			// a parent inserts — so the tap sits where a real card's tap sits anyway.
			props: { class: 'card-label' },
			bindings: [['bindtap', 3]],
			children: [{ kind: 'text', slot: 1 }],
		},
		{
			kind: 'host',
			type: 'view',
			bindings: [['class', 2]],
			children: [{ kind: 'host', type: 'text', props: {}, children: [{ kind: 'text', slot: 4 }] }],
		},
	],
});

const Card = defineUniversalComponent(
	LYNX_TRANSPORT_RENDERER,
	({ label, detail, active, onTap }: CardProps) =>
		universalValue(CARD_PLAN, [
			active ? 'card active' : 'card',
			label,
			active ? 'card-meta on' : 'card-meta',
			onTap,
			detail,
		]),
);

/**
 * Rename every integer to its rank in first-appearance order.
 *
 * Applied to each column's artifact independently, so it can only make two
 * artifacts equal when one allocator's numbers map onto the other's one for
 * one. Two distinct ids collapsing to one rank is impossible: a rank is
 * assigned per distinct value.
 */
function withoutAllocatorNumbers(text: string): string {
	const ranks = new Map<string, number>();
	return text.replace(/\d+/g, (digits) => {
		if (!ranks.has(digits)) ranks.set(digits, ranks.size);
		return `#${ranks.get(digits)}`;
	});
}

/**
 * Rank each column of the event journal in its own namespace.
 *
 * A native event token carries a host id and a listener id in different fields,
 * drawn from independent counters, so ranking the whole journal in one
 * namespace conflates them and reports a difference that is not one. The
 * token's shape — how many fields, which are numeric, what the tail says — is
 * still compared literally.
 */
function withoutAllocatorColumns(rows: readonly (readonly string[])[]): string {
	const ranks: Map<string, number>[] = [];
	return JSON.stringify(
		rows.map((row) =>
			row.map((field, column) => {
				if (!/^\d+$/.test(field)) return field;
				const namespace = (ranks[column] ??= new Map());
				if (!namespace.has(field)) namespace.set(field, namespace.size);
				return `#${namespace.get(field)}`;
			}),
		),
	);
}

interface EventJournalPAPI {
	readonly papi: LynxElementPAPI<FakeNode> & { readonly pages: FakeNode[]; flushes(): number };
	readonly journal: string[][];
}

/** The shared fake host, plus an ordered record of what it was told about events. */
function journallingPAPI(): EventJournalPAPI {
	const papi = createFakePAPI();
	const journal: string[][] = [];
	const seen = new Map<FakeNode, number>();
	const rank = (node: FakeNode): number => {
		if (!seen.has(node)) seen.set(node, seen.size);
		return seen.get(node)!;
	};
	return {
		papi: {
			...papi,
			setEvent(node: FakeNode, kind: string, name: string, listener: unknown) {
				journal.push([
					String(rank(node)),
					kind,
					name,
					...(listener === undefined
						? ['cleared']
						: typeof listener === 'string'
							? listener.split(':')
							: ['worklet']),
				]);
				papi.setEvent(node, kind, name, listener as never);
			},
		},
		journal,
	};
}

interface Painted {
	readonly tree: string;
	readonly handles: string;
	readonly events: string;
}

/** Replay every accepted commit through the real applier onto a fake host. */
function paint(commits: readonly LynxTransportCommitMessage[]): Painted {
	const { papi, journal } = journallingPAPI();
	const container = createLynxHostContainer(papi, { root: 1 });
	const handles: unknown[] = [];
	for (const commit of commits) {
		const prepared = prepareLynxHostBatch(container, commit.batch);
		handles.push(...prepared.handleDelta);
		prepared.apply();
	}
	return {
		tree: withoutAllocatorNumbers(JSON.stringify(withoutAllocatorIdentity(shape(papi.pages[0]!)))),
		handles: withoutAllocatorNumbers(JSON.stringify(handles)),
		events: withoutAllocatorColumns(journal),
	};
}

/**
 * The event site the background actually bound, resolved through the host.
 *
 * Painting the commits and asking the applier what a token means is the honest
 * way to name a listener: it is the id the main thread would send back, rather
 * than one assumed from how the allocator happens to count.
 */
function boundListener(commits: readonly LynxTransportCommitMessage[]): LynxResolvedNativeEvent {
	const papi = createFakePAPI();
	const host = createLynxHostContainer(papi, { root: 1 });
	for (const commit of commits) prepareLynxHostBatch(host, commit.batch).apply();
	const label = papi.pages[0]!.children[0]!.children[0]!;
	const resolved = resolveLynxHostNativeEvent(host, [...label.events.values()][0]);
	if (resolved === null) throw new Error('the card bound no event site');
	return resolved;
}

/** Send one delivery back, as the main thread would. */
function deliverTo(
	block: { readonly main: { readonly commits: readonly LynxTransportCommitMessage[] } },
	listener: LynxResolvedNativeEvent,
): unknown {
	return (block as ReturnType<typeof blockColumn>).background.dispatchTransportEvent({
		protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
		renderer: LYNX_TRANSPORT_RENDERER,
		root: 1,
		// A delivery names the batch it was painted against, so a stale event is
		// refused rather than run against post-commit state.
		version: block.main.commits.at(-1)!.version,
		type: 'event',
		priority: listener.priority,
		deliveries: [{ listener: listener.listener, payload: null }],
	} as never);
}

/** A root driven by the universal core, over the transport a real page uses. */
function universalColumn() {
	const context = new FakeContextProxy();
	const main = installMainSide(context);
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(context, container);
	const root = createUniversalRoot(container, createLynxClientDriver(container), {
		transport,
		scheduleMicrotask: (callback) => callback(),
	});
	transport.bindRoot(root);
	let acknowledged = 0;
	return {
		main,
		async render(props: CardProps): Promise<void> {
			const rendering = root.renderAsync(Card, props);
			await flushMicrotasks();
			while (acknowledged < main.commits.length) {
				main.acknowledge(main.commits[acknowledged++]!);
			}
			await rendering;
			await flushMicrotasks();
		},
	};
}

/** The same component through `core: 'block'`, entered exactly as a bundle enters it. */
function blockColumn(core?: LynxBlockCore) {
	const context = new FakeContextProxy();
	const main = installMainSide(context);
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(context, container);
	const background = createLynxBlockBackgroundCore({
		container,
		transport,
		transportRoot: 1,
		core,
	});
	transport.bindRoot(background);
	let acknowledged = 0;
	const settle = async (work: Promise<unknown>): Promise<unknown> => {
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
			while (acknowledged < main.commits.length) {
				main.acknowledge(main.commits[acknowledged++]!);
			}
		}
		return tracked;
	};
	return {
		main,
		background,
		settle,
		async render(component: LynxComponent<CardProps>, props: CardProps): Promise<void> {
			await settle(background.renderAsync(component as never, props));
		},
	};
}

const noop = () => undefined;

/** One state per rung; the ladder moves one thing, then the other, then both. */
const LADDER: readonly CardProps[] = [
	{ label: 'alpha', detail: 'one', active: false, onTap: noop },
	{ label: 'beta', detail: 'one', active: false, onTap: noop },
	{ label: 'beta', detail: 'one', active: true, onTap: noop },
	{ label: 'beta', detail: 'two', active: true, onTap: noop },
	{ label: 'gamma', detail: 'three', active: false, onTap: noop },
	// A render that moves nothing. The wire must agree that nothing moved.
	{ label: 'gamma', detail: 'three', active: false, onTap: noop },
];

describe('Lynx compiled component on the Block core', () => {
	it('paints what the universal core paints, at every step of a ladder', async () => {
		const universal = universalColumn();
		const block = blockColumn();

		for (const [step, props] of LADDER.entries()) {
			await universal.render(props);
			await block.render(Card as LynxComponent<CardProps>, props);

			const left = paint(universal.main.commits);
			const right = paint(block.main.commits);
			expect(right.tree, `tree after step ${step}`).toBe(left.tree);
			expect(right.handles, `handles after step ${step}`).toBe(left.handles);
			expect(right.events, `events after step ${step}`).toBe(left.events);
		}

		// The ladder has to have painted something, or every assertion above
		// compared two empty artifacts and agreed.
		expect(paint(block.main.commits).tree).toContain('card-label');
		expect(paint(block.main.commits).tree).toContain('gamma');
	});

	it('sends a frame only for the renders that changed something', async () => {
		const block = blockColumn();
		const frames: number[] = [];
		for (const props of LADDER) {
			const before = block.main.commits.length;
			await block.render(Card as LynxComponent<CardProps>, props);
			frames.push(block.main.commits.length - before);
		}
		// Mount, then one frame per rung that moved a value, then nothing for the
		// rung that repeated the previous state: a re-render that changes no slot
		// is not a commit the far side has to process.
		expect(frames).toEqual([1, 1, 1, 1, 1, 0]);
	});

	it('visits only the slots a re-render moved', async () => {
		// `counters()` is the core's published account of its own claim, and this is
		// the derived path's version of it: the work an update does is a function of
		// what changed, not of how big the component's template is.
		const core = createLynxBlockCore();
		const block = blockColumn(core);
		const base: CardProps = { label: 'alpha', detail: 'one', active: false, onTap: noop };
		await block.render(Card as LynxComponent<CardProps>, base);

		const step = async (props: CardProps) => {
			const before = core.counters();
			await block.render(Card as LynxComponent<CardProps>, props);
			const after = core.counters();
			return {
				lookups: after.blockLookups - before.blockLookups,
				commands: after.commands - before.commands,
			};
		};

		// One of the card's four value slots moved.
		expect(await step({ ...base, label: 'beta' })).toEqual({ lookups: 1, commands: 1 });
		// `active` drives two classes, on two different nodes.
		expect(await step({ ...base, label: 'beta', active: true })).toEqual({
			lookups: 2,
			commands: 2,
		});
		// And a render that moves nothing costs nothing, however many slots the
		// template has.
		expect(await step({ ...base, label: 'beta', active: true })).toEqual({
			lookups: 0,
			commands: 0,
		});
	});

	it('routes a native delivery back to the handler this render returned', async () => {
		const block = blockColumn();
		const taps: string[] = [];
		await block.render(Card as LynxComponent<CardProps>, {
			label: 'alpha',
			detail: 'one',
			active: false,
			onTap: () => taps.push('first'),
		});

		const listener = boundListener(block.main.commits);
		const deliver = () => deliverTo(block, listener);

		deliver();
		expect(taps).toEqual(['first']);

		// A handler is a fresh closure every render. The same site must reach the
		// second render's closure, without the wire changing: a rebind moves which
		// function an id reaches, never the id.
		await block.render(Card as LynxComponent<CardProps>, {
			label: 'beta',
			detail: 'one',
			active: false,
			onTap: () => taps.push('second'),
		});
		deliver();
		expect(taps).toEqual(['first', 'second']);
	});

	it('releases the listeners it bound when the root unmounts', async () => {
		const block = blockColumn();
		const taps: string[] = [];
		await block.render(Card as LynxComponent<CardProps>, {
			label: 'alpha',
			detail: 'one',
			active: false,
			onTap: () => taps.push('tapped'),
		});
		const listener = boundListener(block.main.commits);

		await block.settle(block.background.unmountAsync());

		// The root outlives the program's unmount, so a listener the program left
		// bound would keep this render's closure — and its props — reachable on a
		// root that no longer paints, and would still run for a late delivery.
		expect(() => deliverTo(block, listener)).toThrow(/listener/i);
		expect(taps).toEqual([]);
	});

	it('still prefers a program a component carries over deriving one', async () => {
		const block = blockColumn();
		let mounted = 0;
		const carrier = withLynxBlockProgram(Card as LynxComponent<CardProps>, {
			mount() {
				mounted++;
			},
		});

		await block.render(carrier, LADDER[0]!);

		// The attached program ran and the derivation did not: a component that
		// says what it is on the Block core is never second-guessed.
		expect(mounted).toBe(1);
		expect(block.main.commits).toHaveLength(0);
	});
});

describe('Lynx compiled component the Block core refuses', () => {
	it('names the missing hook layer rather than half-rendering a hooked setup', async () => {
		const block = blockColumn();
		const Hooked = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Hooked(props: CardProps) {
				const [label] = useState(props.label);
				return universalValue(CARD_PLAN, ['card', label, 'card-meta', props.onTap, props.detail]);
			},
		);

		await expect(
			block.settle(block.background.renderAsync(Hooked as never, LADDER[0]!)),
		).rejects.toThrow(/Hooked.*calls a hook.*item 1b/s);
	});

	it('names the missing range lowering rather than dropping the rows', async () => {
		const block = blockColumn();
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: CardProps) {
				return universalValue(CARD_PLAN, [
					'card',
					universalFor(
						[props.label],
						(row: string) => row,
						(row: string) => universalValue(CARD_PLAN, ['card', row, 'card-meta', noop, row]),
					),
					'card-meta',
					props.onTap,
					props.detail,
				]);
			},
		);

		await expect(
			block.settle(block.background.renderAsync(Listed as never, LADDER[0]!)),
		).rejects.toThrow(/Listed.*range site.*item 1c/s);
	});

	it('names a template that is not rooted at a host element', async () => {
		const block = blockColumn();
		const TEXT_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, { kind: 'text', value: 'bare' });
		const Bare = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Bare() {
			return universalValue(TEXT_PLAN, []);
		});

		await expect(
			block.settle(block.background.renderAsync(Bare as never, LADDER[0]!)),
		).rejects.toThrow(/Bare.*rooted at a "text" node/s);
	});

	it('names what a component that was never compiled is missing', async () => {
		const block = blockColumn();
		const Plain = (() => null) as unknown as LynxComponent<CardProps>;
		await expect(
			block.settle(block.background.renderAsync(Plain as never, LADDER[0]!)),
		).rejects.toThrow(/did not return a compiled template/);
	});

	it('refuses a later render that returns a different template', async () => {
		const block = blockColumn();
		const OTHER_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'other' },
		});
		const Switching = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Switching(props: CardProps) {
				return props.active
					? universalValue(OTHER_PLAN, [])
					: universalValue(CARD_PLAN, [
							'card',
							props.label,
							'card-meta',
							props.onTap,
							props.detail,
						]);
			},
		);

		await block.render(Switching as LynxComponent<CardProps>, LADDER[0]!);
		await expect(
			block.settle(
				block.background.renderAsync(Switching as never, { ...LADDER[0]!, active: true }),
			),
		).rejects.toThrow(/different compiled template/);
	});
});
