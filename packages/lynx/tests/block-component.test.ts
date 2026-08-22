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
	universalComponent,
	universalFor,
	universalPlan,
	universalProps,
	universalValue,
	useState,
	type UniversalRenderable,
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
import {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	type LynxTransportCommitMessage,
} from '../src/core/protocol.js';
import { createLynxBackgroundTransport } from '../src/core/transport.js';
import type { LynxComponent } from '../src/intrinsics.js';
import { createFakePAPI } from './_fixtures/fake-element-papi.js';
import { FakeContextProxy, flushMicrotasks, installMainSide } from './_fixtures/fake-lynx-wire.js';
import { paint } from './_fixtures/painted-commits.js';

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

const noop = () => undefined;

interface TableRow {
	readonly id: number;
	readonly label: string;
}

interface TableProps {
	readonly rows: readonly TableRow[];
	readonly selected: number | undefined;
	readonly onSelect: (id: number) => void;
}

// One row of the keyed range, in the shape the compiler emits for an inline
// `@for` body: a bound class so a selection is a scoped slot write, a text hole
// per column, and a tap on a child rather than on the row's own root, which a
// template program refuses to bind.
const ROW_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'col-id' },
			children: [{ kind: 'slot', slot: 1 }],
		},
		{
			kind: 'host',
			type: 'text',
			props: { class: 'col-label' },
			bindings: [['bindtap', 2]],
			children: [{ kind: 'slot', slot: 3 }],
		},
	],
});

// The page: a static title, then a container whose only child is the range
// hole. A renderable hole is one plan node whatever it holds, so this is the
// same `slot` node a text hole would be — which is the whole reason the value
// has to be what decides.
const TABLE_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	props: { class: 'page' },
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'title' },
			children: [{ kind: 'text', value: 'rows' }],
		},
		{
			kind: 'host',
			type: 'view',
			props: { class: 'rows' },
			children: [{ kind: 'slot', slot: 0 }],
		},
	],
});

const Table = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Table(props: TableProps) {
	return universalValue(TABLE_PLAN, [
		universalFor(
			props.rows,
			(row: TableRow) => row.id,
			(row: TableRow) =>
				universalValue(ROW_PLAN, [
					row.id === props.selected ? 'row danger' : 'row',
					String(row.id),
					() => props.onSelect(row.id),
					row.label,
				]),
		),
	]);
});

const table = (
	ids: readonly number[],
	selected?: number,
	onSelect: (id: number) => void = noop,
): TableProps => ({
	rows: ids.map((id) => ({ id, label: `row ${id}` })),
	selected,
	onSelect,
});

/**
 * One state per rung, and every structural shape a keyed range has: fill from
 * empty, a scoped write that moves one slot of one row, a reorder, a label
 * edit, a removal, an insertion, emptying, and refilling afterwards.
 */
const TABLE_LADDER: readonly TableProps[] = [
	table([]),
	table([1, 2, 3]),
	table([1, 2, 3], 2),
	table([3, 1, 2], 2),
	{
		rows: [
			{ id: 3, label: 'row 3' },
			{ id: 1, label: 'row one, edited' },
			{ id: 2, label: 'row 2' },
		],
		selected: 2,
		onSelect: noop,
	},
	table([3, 2], 2),
	table([3, 2, 4], 2),
	table([]),
	table([5]),
];

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

/**
 * The tap site the nth painted row bound, resolved through the host.
 *
 * Rows are addressed by painted position rather than by key on purpose: a
 * survivor keeps its hosts through a reorder, so "the second row on screen" and
 * "the row that was second last render" are different questions, and a test
 * that could not ask the first one could not tell a rebind from a re-mount.
 */
function rowListener(
	commits: readonly LynxTransportCommitMessage[],
	row: number,
): LynxResolvedNativeEvent {
	const papi = createFakePAPI();
	const host = createLynxHostContainer(papi, { root: 1 });
	for (const commit of commits) prepareLynxHostBatch(host, commit.batch).apply();
	// page > rows container > the nth row > its label column.
	const rows = papi.pages[0]!.children[0]!.children[1]!;
	const label = rows.children[row]!.children[1]!;
	const resolved = resolveLynxHostNativeEvent(host, [...label.events.values()][0]);
	if (resolved === null) throw new Error(`row ${row} bound no event site`);
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
function universalColumn<Props>(component: LynxComponent<Props>) {
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
		async render(props: Props): Promise<void> {
			const rendering = root.renderAsync(component as never, props as never);
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
function blockColumn<Props = CardProps>(core?: LynxBlockCore) {
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
		async render(component: LynxComponent<Props>, props: Props): Promise<void> {
			await settle(background.renderAsync(component as never, props as never));
		},
	};
}

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
		const universal = universalColumn(Card as LynxComponent<CardProps>);
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

	it("leaves a conditional handler's site unbound until a render supplies one", async () => {
		const block = blockColumn();
		const taps: string[] = [];
		const conditional = (handler: (() => void) | undefined): CardProps => ({
			label: 'alpha',
			detail: 'one',
			active: false,
			onTap: handler as never,
		});

		// An empty hole is how a template expresses a conditional handler — the
		// same shape `block-root.ts` documents a `null` listener entry for — so a
		// render that has no handler yet must mount rather than be refused.
		await block.render(Card as LynxComponent<CardProps>, conditional(undefined));
		await block.render(
			Card as LynxComponent<CardProps>,
			conditional(() => taps.push('later')),
		);
		const listener = boundListener(block.main.commits);
		deliverTo(block, listener);
		expect(taps).toEqual(['later']);

		// And a render that withdraws the handler unbinds the site: a delivery
		// must not reach a closure the current render no longer returns.
		await block.render(Card as LynxComponent<CardProps>, conditional(undefined));
		expect(() => deliverTo(block, listener)).toThrow(/listener/i);
		expect(taps).toEqual(['later']);
	});

	it('still prefers a program a component carries over deriving one', async () => {
		const block = blockColumn();
		let mounted = 0;
		// A wrapper rather than the shared Card: `withLynxBlockProgram` defines
		// the program on the component it is given, and the suite's other cases
		// must keep exercising the derivation.
		const CarrierCard = (props: CardProps, context: Parameters<typeof Card>[1]) =>
			Card(props, context);
		const carrier = withLynxBlockProgram(CarrierCard as LynxComponent<CardProps>, {
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

/**
 * Item 1c: the hole that holds a keyed range.
 *
 * The oracle is the one above, for the same reason — the same compiled
 * component through both cores, compared on the painted tree, the handle
 * journal and the event journal after every rung. What a range adds is that
 * the rungs are structural: rows arrive, move, change, leave, and the list
 * empties and refills, and each of those is a different path through
 * `fillForSlot` / `reconcileForSlot` / `clearForSlot`.
 */
describe('Lynx compiled component with a keyed range on the Block core', () => {
	it('paints what the universal core paints, at every step of a structural ladder', async () => {
		const universal = universalColumn(Table as LynxComponent<TableProps>);
		const block = blockColumn<TableProps>();

		for (const [step, props] of TABLE_LADDER.entries()) {
			await universal.render(props);
			await block.render(Table as LynxComponent<TableProps>, props);

			const left = paint(universal.main.commits);
			const right = paint(block.main.commits);
			expect(right.tree, `tree after step ${step}`).toBe(left.tree);
			expect(right.handles, `handles after step ${step}`).toBe(left.handles);
			expect(right.events, `events after step ${step}`).toBe(left.events);
		}

		// The ladder has to have painted rows, or every assertion above compared
		// two trees that agreed about nothing. Row text is not asserted literally
		// because the tree has had every integer replaced by its rank.
		const painted = paint(block.main.commits).tree;
		expect(painted).toContain('col-label');
		expect(painted.match(/"classes":"row"/g)).toHaveLength(1);
	});

	it('reconciles the range instead of re-mounting it', async () => {
		// The Block model's claim about a keyed list: a survivor keeps its hosts,
		// so a re-render that changes one row's label neither creates nor destroys
		// anything. `counters()` is where the core states that about itself.
		const core = createLynxBlockCore();
		const block = blockColumn<TableProps>(core);
		await block.render(Table as LynxComponent<TableProps>, table([1, 2, 3]));

		const step = async (props: TableProps) => {
			const before = core.counters();
			await block.render(Table as LynxComponent<TableProps>, props);
			const after = core.counters();
			return after.commands - before.commands;
		};

		// Selecting row 2 rewrites one row's class and nothing else, however many
		// rows the range holds.
		expect(await step(table([1, 2, 3], 2))).toBe(1);
		// A pure reorder writes no props: every survivor is patched with the values
		// it already holds, so the only commands are the moves the LIS could not
		// avoid — here one, because rows 1 and 2 stay in relative order.
		expect(await step(table([3, 1, 2], 2))).toBe(1);
		// And a re-render that produces the same list costs nothing at all.
		expect(await step(table([3, 1, 2], 2))).toBe(0);
	});

	it('routes a native delivery to the handler this render gave that row', async () => {
		const taps: string[] = [];
		const block = blockColumn<TableProps>();
		await block.render(
			Table as LynxComponent<TableProps>,
			table([1, 2, 3], undefined, (id) => taps.push(`first ${id}`)),
		);

		const second = rowListener(block.main.commits, 1);
		deliverTo(block, second);
		expect(taps).toEqual(['first 2']);

		// A survivor keeps its hosts through a reorder, so this site is still row
		// 2's — but every row's handler is a fresh closure over this render's item
		// and props, so what the site reaches must be the second render's.
		await block.render(
			Table as LynxComponent<TableProps>,
			table([3, 1, 2], undefined, (id) => taps.push(`second ${id}`)),
		);
		deliverTo(block, second);
		expect(taps).toEqual(['first 2', 'second 2']);

		// And a site is addressed by the block that owns it rather than by where
		// it sits: row 2 moved, so the second row on screen is now row 1.
		deliverTo(block, rowListener(block.main.commits, 1));
		expect(taps).toEqual(['first 2', 'second 2', 'second 1']);
	});

	it('releases a row that leaves the range', async () => {
		const taps: number[] = [];
		const block = blockColumn<TableProps>();
		await block.render(
			Table as LynxComponent<TableProps>,
			table([1, 2, 3], undefined, (id) => taps.push(id)),
		);
		const departing = rowListener(block.main.commits, 2);

		await block.render(
			Table as LynxComponent<TableProps>,
			table([1, 2], undefined, (id) => taps.push(id)),
		);

		// A departed row's listener run is the program's to release: nothing else
		// holds it, and a run left bound keeps that row's closure — and the item it
		// closed over — reachable for as long as the root lives.
		expect(() => deliverTo(block, departing)).toThrow(/listener/i);
		expect(taps).toEqual([]);
	});

	it('releases every row when the range empties', async () => {
		const taps: number[] = [];
		const block = blockColumn<TableProps>();
		await block.render(
			Table as LynxComponent<TableProps>,
			table([1, 2, 3], undefined, (id) => taps.push(id)),
		);
		const rows = [0, 1, 2].map((index) => rowListener(block.main.commits, index));

		await block.render(
			Table as LynxComponent<TableProps>,
			table([], undefined, (id) => taps.push(id)),
		);

		// Emptying is the one departure an owner cannot see coming row by row, and
		// it is the path a `Clear` button takes.
		for (const row of rows) expect(() => deliverTo(block, row)).toThrow(/listener/i);
		expect(taps).toEqual([]);
	});

	it('releases every row the range still holds when the root unmounts', async () => {
		const taps: number[] = [];
		const block = blockColumn<TableProps>();
		await block.render(
			Table as LynxComponent<TableProps>,
			table([1, 2], undefined, (id) => taps.push(id)),
		);
		const rows = [0, 1].map((index) => rowListener(block.main.commits, index));

		await block.settle(block.background.unmountAsync());

		for (const row of rows) expect(() => deliverTo(block, row)).toThrow(/listener/i);
		expect(taps).toEqual([]);
	});

	it('renders a row authored as a component', async () => {
		// `@for (…) { <Row … /> }` is a component invocation per row rather than a
		// template, which is what the compiler emits for the shape the benchmark
		// page is written in. The row's plan is inside the component, so the
		// lowering calls it.
		const Row = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Row(props: { readonly row: TableRow; readonly onSelect: (id: number) => void }) {
				return universalValue(ROW_PLAN, [
					'row',
					String(props.row.id),
					() => props.onSelect(props.row.id),
					props.row.label,
				]);
			},
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([
									['set', 'row', row],
									['set', 'onSelect', props.onSelect],
								]),
							),
					),
				]);
			},
		);

		const universal = universalColumn(Listed as LynxComponent<TableProps>);
		const block = blockColumn<TableProps>();
		const taps: number[] = [];
		for (const ids of [[1, 2], [2, 1, 3], []]) {
			const props = table(ids, undefined, (id: number) => taps.push(id));
			await universal.render(props);
			await block.render(Listed as LynxComponent<TableProps>, props);
			expect(paint(block.main.commits).tree).toBe(paint(universal.main.commits).tree);
		}

		await block.render(
			Listed as LynxComponent<TableProps>,
			table([7], undefined, (id) => taps.push(id)),
		);
		deliverTo(block, rowListener(block.main.commits, 0));
		expect(taps).toEqual([7]);
	});

	it('keeps a static sibling authored before the range ahead of every row', async () => {
		// A range appends its rows to its host element, so the rule it has to obey
		// is that it is that element's *last* child — not its only one. A sibling
		// authored before it stays where it was authored, and this is the case
		// that tells "last child" apart from "only child".
		const HEADED_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'page' },
			children: [
				{
					kind: 'host',
					type: 'text',
					props: { class: 'header' },
					children: [{ kind: 'text', value: 'head' }],
				},
				{ kind: 'slot', slot: 0 },
			],
		});
		const Headed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Headed(props: TableProps) {
				return universalValue(HEADED_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) => universalValue(ROW_PLAN, ['row', String(row.id), noop, row.label]),
					),
				]);
			},
		);
		// What the page element holds, in painted order.
		const pageChildren = (commits: readonly LynxTransportCommitMessage[]): string[] => {
			const papi = createFakePAPI();
			const host = createLynxHostContainer(papi, { root: 1 });
			for (const commit of commits) prepareLynxHostBatch(host, commit.batch).apply();
			return papi.pages[0]!.children[0]!.children.map((child) => child.classes);
		};
		const universal = universalColumn(Headed as LynxComponent<TableProps>);
		const block = blockColumn<TableProps>();

		for (const [props, expected] of [
			[table([1, 2]), ['header', 'row', 'row']],
			[table([2, 3, 1]), ['header', 'row', 'row', 'row']],
			[table([]), ['header']],
		] as const) {
			await universal.render(props);
			await block.render(Headed as LynxComponent<TableProps>, props);
			// Said directly as well as differentially, because two cores that both
			// painted the header last would satisfy the comparison alone.
			expect(pageChildren(block.main.commits)).toEqual(expected);
			expect(paint(block.main.commits).tree).toBe(paint(universal.main.commits).tree);
		}
	});

	it("leaves a row's empty handler hole unbound and unbinds one a render withdraws", async () => {
		const taps: string[] = [];
		// The selected row withdraws its own tap. An empty event hole is how a
		// template expresses a conditional handler, and a row is a template, so a
		// range has to accept one — including on the very first row, which is the
		// row the range derives its template from.
		const Conditional = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Conditional(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalValue(ROW_PLAN, [
								row.id === props.selected ? 'row danger' : 'row',
								String(row.id),
								row.id === props.selected ? undefined : () => props.onSelect(row.id),
								row.label,
							]),
					),
				]);
			},
		);
		const block = blockColumn<TableProps>();

		await block.render(
			Conditional as LynxComponent<TableProps>,
			table([1, 2], 1, (id) => taps.push(`first ${id}`)),
		);
		expect(() => deliverTo(block, rowListener(block.main.commits, 0))).toThrow(/listener/i);
		deliverTo(block, rowListener(block.main.commits, 1));
		expect(taps).toEqual(['first 2']);

		// The selection moves, so one survivor gains a handler and the other
		// loses one. The row that lost it must stop reaching the closure of the
		// render that last supplied one, which is why a rebind releases first.
		await block.render(
			Conditional as LynxComponent<TableProps>,
			table([1, 2], 2, (id) => taps.push(`second ${id}`)),
		);
		deliverTo(block, rowListener(block.main.commits, 0));
		expect(() => deliverTo(block, rowListener(block.main.commits, 1))).toThrow(/listener/i);
		expect(taps).toEqual(['first 2', 'second 1']);
	});
});

describe('Lynx compiled component with a keyed range the Block core refuses', () => {
	const listedPlan = (children: readonly unknown[]) =>
		universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'page' },
			children: children as never,
		});

	const listing = (plan: ReturnType<typeof listedPlan>, row: (id: number) => UniversalRenderable) =>
		defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Listed(props: TableProps) {
			return universalValue(plan, [
				universalFor(
					props.rows,
					(item: TableRow) => item.id,
					(item: TableRow) => row(item.id),
				),
			]);
		});

	it('names a range that is not the last child of its host element', async () => {
		// A range appends its rows to the element that holds it, so a sibling
		// authored after it would be painted before every row it was written
		// after. Refused rather than silently reordered.
		const Listed = listing(
			listedPlan([
				{ kind: 'slot', slot: 0 },
				{ kind: 'host', type: 'text', props: { class: 'footer' }, children: [] },
			]),
			(id) => universalValue(ROW_PLAN, ['row', String(id), noop, `row ${id}`]),
		);

		const block = blockColumn<TableProps>();
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1]))),
		).rejects.toThrow(/Listed.*last child of its host element/s);
	});

	it('names a row that is not a compiled template', async () => {
		const Listed = listing(listedPlan([{ kind: 'slot', slot: 0 }]), (id) => `row ${id}`);
		const block = blockColumn<TableProps>();
		// The defect is the row's output, not the page's: Listed did return a
		// compiled template, so the diagnostic must say which level failed.
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1]))),
		).rejects.toThrow(/a row of one of its keyed ranges is not a compiled template/);
	});

	it('mounts nothing when a duplicate key rejects the first render, so a retry paints once', async () => {
		const block = blockColumn<TableProps>();
		const duplicated: TableProps = {
			rows: [
				{ id: 7, label: 'row 7' },
				{ id: 7, label: 'row 7 again' },
			],
			selected: undefined,
			onSelect: noop,
		};
		await expect(
			block.settle(block.background.renderAsync(Table as never, duplicated)),
		).rejects.toThrow(/duplicate key/);
		expect(block.main.commits).toHaveLength(0);

		// The application fixes its data and renders again. A rejection that had
		// already mounted the page block would make this paint the page twice.
		await block.render(Table as LynxComponent<TableProps>, table([1, 2]));
		const retried = paint(block.main.commits);

		const fresh = blockColumn<TableProps>();
		await fresh.render(Table as LynxComponent<TableProps>, table([1, 2]));
		expect(retried.tree).toEqual(paint(fresh.main.commits).tree);
	});

	it('names two rows that returned different templates', async () => {
		const OTHER_ROW = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'other' },
		});
		const Listed = listing(listedPlan([{ kind: 'slot', slot: 0 }]), (id) =>
			id === 1
				? universalValue(ROW_PLAN, ['row', String(id), noop, `row ${id}`])
				: universalValue(OTHER_ROW, []),
		);
		const block = blockColumn<TableProps>();
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1, 2]))),
		).rejects.toThrow(/two rows of one keyed range/);
	});

	it('names a row that is not rooted at a host element', async () => {
		const TEXT_ROW = universalPlan(LYNX_TRANSPORT_RENDERER, { kind: 'text', value: 'bare' });
		const Listed = listing(listedPlan([{ kind: 'slot', slot: 0 }]), () =>
			universalValue(TEXT_ROW, []),
		);
		const block = blockColumn<TableProps>();
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1]))),
		).rejects.toThrow(/row of one of its keyed ranges is rooted at a "text" node/);
	});

	it('names a row that is not entirely compile-time host structure', async () => {
		const NESTED_ROW = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'row' },
			children: [{ kind: 'component', slot: 0 } as never],
		});
		const Listed = listing(listedPlan([{ kind: 'slot', slot: 0 }]), () =>
			universalValue(NESTED_ROW, [noop]),
		);
		const block = blockColumn<TableProps>();
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1]))),
		).rejects.toThrow(/not entirely compile-time host structure/);
	});

	it('names a row whose event site sits on its own root', async () => {
		// A template program's root is the node its parent inserts, and it refuses
		// to bind an event there. That is a real limit on what a row may be
		// authored as, so it is named rather than silently dropping the handler.
		const TAPPED_ROOT = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			bindings: [['bindtap', 0]],
			children: [{ kind: 'host', type: 'text', props: { class: 'col-id' }, children: [] }],
		});
		const Listed = listing(listedPlan([{ kind: 'slot', slot: 0 }]), () =>
			universalValue(TAPPED_ROOT, [noop]),
		);
		const block = blockColumn<TableProps>();
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1]))),
		).rejects.toThrow(/static prop or event site of one of its keyed range rows/);
	});

	it('names a range nested inside a range', async () => {
		const Listed = listing(listedPlan([{ kind: 'slot', slot: 0 }]), (id) =>
			universalValue(TABLE_PLAN, [
				universalFor(
					[{ id, label: `row ${id}` }],
					(item: TableRow) => item.id,
					(item: TableRow) => universalValue(ROW_PLAN, ['row', String(item.id), noop, item.label]),
				),
			]),
		);
		const block = blockColumn<TableProps>();
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1]))),
		).rejects.toThrow(/nested inside a range/);
	});

	it('names an @empty branch it has no site for', async () => {
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(item: TableRow) => item.id,
						(item: TableRow) =>
							universalValue(ROW_PLAN, ['row', String(item.id), noop, item.label]),
						() => universalValue(ROW_PLAN, ['row', '0', noop, 'nothing here']),
					),
				]);
			},
		);
		const block = blockColumn<TableProps>();
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1]))),
		).rejects.toThrow(/@empty block/);
	});

	it('writes nothing when a later render refuses inside a range', async () => {
		// A refusal has to leave the block as the last render left it. The rows are
		// rendered before the first slot is written for exactly this reason, and
		// the root's own slots are held back with them — otherwise a refused render
		// would leave its title on the core, to be flushed by whichever frame came
		// next.
		const TITLED_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			bindings: [['class', 1]],
			children: [
				{
					kind: 'host',
					type: 'view',
					props: { class: 'rows' },
					children: [{ kind: 'slot', slot: 0 }],
				},
			],
		});
		const OTHER_ROW = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'other' },
		});
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TITLED_PLAN, [
					universalFor(
						props.rows,
						(item: TableRow) => item.id,
						(item: TableRow) =>
							props.selected === undefined
								? universalValue(ROW_PLAN, ['row', String(item.id), noop, item.label])
								: universalValue(OTHER_ROW, []),
					),
					props.selected === undefined ? 'page' : 'page selected',
				]);
			},
		);

		const core = createLynxBlockCore();
		const block = blockColumn<TableProps>(core);
		await block.render(Listed as LynxComponent<TableProps>, table([1]));
		const before = core.counters();
		const frames = block.main.commits.length;

		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1], 1))),
		).rejects.toThrow(/two rows of one keyed range|different compiled templates/);

		expect(core.counters().commands).toBe(before.commands);
		expect(block.main.commits).toHaveLength(frames);
	});

	it('refuses a hole that mounted a keyed range and later held something else', async () => {
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					props.selected === undefined
						? universalFor(
								props.rows,
								(item: TableRow) => item.id,
								(item: TableRow) =>
									universalValue(ROW_PLAN, ['row', String(item.id), noop, item.label]),
							)
						: 'not a range any more',
				]);
			},
		);
		const block = blockColumn<TableProps>();
		await block.render(Listed as LynxComponent<TableProps>, table([1]));
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1], 1))),
		).rejects.toThrow(/mounted a keyed range later held something else/);
	});
});
