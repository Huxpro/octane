import {
	universalPlan,
	type UniversalPlan,
	type UniversalPlanNode,
	type UniversalProgramPlan,
	type UniversalProgramRange,
	type UniversalSlotKind,
} from 'octane/universal/native';

/**
 * The object the `target: 'lynx'` main-thread compile emits, transcribed from
 * what `tests/compiler/lynx-main-thread-program.test.ts` observes the compiler
 * produce for its card fixture: two bound props on the root, a tap beside a
 * static class, and two text holes left as keyed ranges.
 *
 * The emission is hand-built AST in a `.js` compiler with no type to disagree
 * with, so this is where the two are held against each other. If they diverge,
 * either the emitter changed shape or the declared type is wrong, and both are
 * things to go and look at.
 */
const card: UniversalProgramPlan = {
	kind: 'program',
	slots: ['p:class', 'p:id', 'e:bindtap', 'r', 'r'],
	values: [0, 1],
	events: [2],
	ranges: [
		{ slot: 3, node: 1 },
		{ slot: 4, node: 3 },
	],
	bind: () => () => [],
};

/**
 * A program is a plan node, not a thing a cast smuggles past one.
 *
 * `universalPlan` is the single gate every plan passes, and it is where both
 * cores refuse a program by name. That refusal is only reachable — and only
 * testable — because the call typechecks.
 */
const asNode: UniversalPlanNode = card;
const plan: UniversalPlan = universalPlan('lynx', card);

/**
 * What a mount recovers from a program, and the only thing it recovers.
 *
 * The create takes the page and the parent, then one argument per `values`
 * entry followed by one per `events` entry, and hands back the run's nodes in
 * program order. There is no description of the subtree anywhere — that is
 * exactly what the main-thread chunk stops carrying — so this array is the
 * whole map.
 */
function mount(node: UniversalPlanNode, host: unknown, page: number, parent: unknown): void {
	if (node.kind !== 'program') return;
	const slots: readonly (UniversalSlotKind | null)[] = node.slots;
	const ranges: readonly UniversalProgramRange[] = node.ranges;
	const values: readonly number[] = node.values;
	const events: readonly number[] = node.events;
	const nodes: readonly unknown[] = node.bind(host)(page, parent, ...values, ...events);
}

/**
 * Once every other kind is narrowed away, what remains is a program — by type
 * rather than by a widened read of `.kind`.
 *
 * This is the tail of `freezePlanNode` in both cores, stated as a type. Before
 * #163's C2a that tail was an unguarded `kind: 'text'` return, so a kind a core
 * did not recognize became a text node with neither a value nor a slot and
 * painted an empty string.
 *
 * A tenth kind added to the union does break the cores' own compile, so most of
 * the time this says nothing new. It earns its place against the one repair that
 * silences that break without answering it: asserting the tail is a host instead
 * of proving it. Do both — add a kind, cast the tail — and the core compiles
 * clean again while this stays red, which is the same shape of mistake C2a was.
 */
function tail(node: UniversalPlanNode): UniversalProgramPlan {
	switch (node.kind) {
		case 'host':
		case 'text':
		case 'slot':
		case 'range':
		case 'component':
		case 'if':
		case 'switch':
		case 'template':
			throw new TypeError('handled before the tail');
	}
	return node;
}

/** A slot kind names the operation allowed to write the slot, so it is closed. */
const kinds: readonly (UniversalSlotKind | null)[] = ['c', 'r', 'p:class', 'e:bindtap', null];

const unwritable: UniversalProgramPlan = {
	...card,
	// @ts-expect-error - `x` is not an operation any writer dispatches on.
	slots: ['x'],
};

const widened: readonly (string | null)[] = ['whatever'];
const unchecked: UniversalProgramPlan = {
	...card,
	// @ts-expect-error - a bare string table would put back the undecidable dispatch.
	slots: widened,
};

const interpreted: UniversalProgramPlan = {
	kind: 'program',
	slots: [],
	values: [],
	events: [],
	ranges: [],
	// @ts-expect-error - `create(env, values)` is the interpreted ABI; a program binds a host.
	create: () => null,
};

const halfRange: UniversalProgramPlan = {
	...card,
	// @ts-expect-error - a range that names no node has nowhere to append its members.
	ranges: [{ slot: 3 }],
};
