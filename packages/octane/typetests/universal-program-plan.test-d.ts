import {
	universalPlan,
	type UniversalPlan,
	type UniversalPlanNode,
	type UniversalProgramEvent,
	type UniversalProgramPlan,
	type UniversalProgramRange,
	type UniversalSlotKind,
} from 'octane/universal/native';

/**
 * The object the `target: 'lynx'` main-thread compile emits, transcribed from
 * what `tests/compiler/lynx-main-thread-program.test.ts` observes the compiler
 * produce for its card fixture: two bound props on the root, a tap beside a
 * static class, and two renderable holes declared as keyed ranges, both of which
 * this emission paints itself when the value arrives as a string.
 *
 * The emission is hand-built AST in a `.js` compiler with no type to disagree
 * with, so this is where the two are held against each other. If they diverge,
 * either the emitter changed shape or the declared type is wrong, and both are
 * things to go and look at.
 */
const card: UniversalProgramPlan = {
	kind: 'program',
	slots: ['p:class', 'p:id', 'e:bindtap', 'r', 'r'],
	nodes: 4,
	values: [0, 1],
	events: [{ slot: 2, node: 1, type: 'bindtap', priority: 'discrete' }],
	ranges: [
		{ slot: 3, node: 1, id: 2, paintsText: true },
		{ slot: 4, node: 3, id: 5, paintsText: true },
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
 * The create takes the page, then one argument per `values` entry, one per
 * `events` entry, and one per `ranges` entry — the last being the hole's value
 * when the caller has it as a string. There is no description of the subtree
 * anywhere — that is exactly what the main-thread chunk stops carrying — so
 * what comes back is the whole map: the run's nodes in program order, then one
 * entry per range saying what the program painted there.
 *
 * Both halves live in one array because the create function returns one value,
 * and the split is positional rather than typed: `nodes` entries of hosts
 * followed by `ranges` entries of host-or-`undefined`. That is why the length
 * is what a mount checks first — the type cannot say where the halves meet.
 */
function mount(
	node: UniversalPlanNode,
	host: unknown,
	page: number,
	texts: readonly string[],
): void {
	if (node.kind !== 'program') return;
	const slots: readonly (UniversalSlotKind | null)[] = node.slots;
	const ranges: readonly UniversalProgramRange[] = node.ranges;
	const values: readonly number[] = node.values;
	const events: readonly UniversalProgramEvent[] = node.events;
	const hosts: number = node.nodes;
	const paints: readonly (boolean | undefined)[] = ranges.map((site) => site.paintsText);
	const created: readonly unknown[] = node.bind(host)(
		page,
		...values.map((slot) => slot),
		...events.map((site) => site.slot),
		...ranges.map((site, index) => (site.paintsText === true ? texts[index] : undefined)),
	);
	const madeHosts: readonly unknown[] = created.slice(0, hosts);
	const painted: readonly unknown[] = created.slice(hosts);
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
	nodes: 0,
	values: [],
	events: [],
	ranges: [],
	// @ts-expect-error - `create(env, values)` is the interpreted ABI; a program binds a host.
	create: () => null,
};

const halfRange: UniversalProgramPlan = {
	...card,
	// @ts-expect-error - a range that names no node has nowhere to append its members.
	ranges: [{ slot: 3, id: 2 }],
};

const unplacedRange: UniversalProgramPlan = {
	...card,
	// @ts-expect-error - a range with no position cannot be numbered against the interpreted arm.
	ranges: [{ slot: 3, node: 1 }],
};

const untypedEvent: UniversalProgramPlan = {
	...card,
	// @ts-expect-error - a bare plan slot no longer says what the background must route.
	events: [2],
};

/**
 * A range that says nothing about painting is still a range.
 *
 * `paintsText` is one emission's report about itself, so an emitter that
 * compiles nothing at a site omits it rather than writing `false`, and a plan
 * built before C5 has no such member anywhere. Requiring it would make this
 * type reject both, which is why the optionality is load-bearing rather than
 * incidental.
 */
const silentRange: UniversalProgramPlan = {
	...card,
	ranges: [{ slot: 3, node: 1, id: 2 }],
};
