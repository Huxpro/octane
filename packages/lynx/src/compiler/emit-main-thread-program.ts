/**
 * Issue-#163 C1 — the `target: 'lynx'` backend that turns a host template
 * program into straight-line main-thread source.
 *
 * ## What this is for
 *
 * Today the Lynx first screen interprets a program on the main thread:
 * `host-driver.ts`'s dense `mount-template-run` path walks a shape, dispatches
 * per node on a type string and a route number, and calls the Element PAPI.
 * That loop is correct, and it is the thing #157 measured on device — 10.52 s
 * of the 11.5 s native create-1k is host-driver interpreter dispatch and
 * bookkeeping on LepusNG, which has no JIT to recover it. A program is known at
 * build time, so its dispatch is too, and this emits the loop already unrolled:
 * one call per thing the interpreter would have decided to do.
 *
 * C0 priced the shape before this existed
 * (`benchmarks/lynx-table/mts-block/results/c0-first-screen.md`): a main-thread
 * program derived from the framework's own lowering lands within a few percent
 * of the hand-written `octane-direct` ceiling, and at 0.58–0.64x of today's FCP
 * on the web harness. This is that shape made a compiler backend, and made
 * provable rather than measured once: it differs from the spike in emitting
 * against the normalized PAPI and in what it hands back, both noted below.
 *
 * ## Why it emits against the normalized PAPI
 *
 * The obvious emission is bare `__CreateView(...)` globals, which is what the C0
 * spike wrote. This emits `papi.setClasses(...)` and friends instead, for one
 * reason that outweighs the property load: it makes the emitted program and the
 * interpreter two implementations of one interface, so a test can run one
 * program through both against the same host and compare the trees they paint.
 * An emission nothing can be differentially compared against is an emission
 * whose correctness is an argument.
 *
 * `intrinsics.view`/`text`/`rawText` and `append` are hoisted, and only those,
 * because those are the ones the interpreter resolves ahead of its loop and
 * calls unbound. Calling them any other way — bound, or reached through `papi`
 * per node — would be a difference in `this` between the two arms, which is
 * the one difference a differential test cannot see and cannot afford.
 * Unlike the interpreter it *requires* the intrinsics rather than falling back
 * to `createElement`: `normalizeLynxElementPAPI` in `papi.ts` freezes them onto
 * every host it builds, so the fallback exists there for hand-built hosts, and
 * reproducing it here would cost either a per-node branch or a wrapper call
 * frame per raw-text node — on the one path this whole campaign exists to
 * shrink. A host without them gets a named throw when the program is bound,
 * once, rather than a partial tree.
 *
 * ## What it refuses
 *
 * A subset of what the dense path accepts, chosen so that everything it does
 * emit is covered by the differential test rather than by an argument.
 *
 * The upper bound is `denseEligible` in `host-driver.ts`, which requires every
 * *bound* node to have a non-zero dynamic route:
 *
 *   * route 1 — a `#text` whose only prop and only bindings are `value`; its
 *     content is passed to `rawText()` at creation and never written again.
 *   * route 2 — a `view` or `text` whose only props and bindings are `class`,
 *     `className` and `id`, applied by `applyDenseScalarHostProps`.
 *
 * Two things the dense path allows are refused here anyway, and both are the
 * first slice's surface rather than the design's:
 *
 *   * **Unbound nodes.** The interpreter runs the general `applyProps` patch
 *     for them, which covers inline styles, datasets, attributes, CSS scope and
 *     more. Emitting a second, incomplete copy of that machinery is the failure
 *     to avoid: a prop silently not written paints a different tree, and a
 *     first screen that differs from the one the command path would have
 *     painted is worse than one that was never compiled. So an unbound node is
 *     held to the same scalar set as a bound one.
 *   * **Host types with no intrinsic factory** — `scroll-view`, `image` and
 *     anything else. The interpreter creates those through `createElement`, and
 *     so could this; what it could not yet do is *prove* it writes their props
 *     the way `applyProps` would. Widening is mechanical and cheap, because the
 *     differential harness extends to a new host type directly, one type at a
 *     time, with the applier as the oracle.
 *
 * Refused content is what #163's C3 routes back to the command path; until then
 * a refusal is a build error naming the prop, node or event site.
 *
 * The program invariants the applier enforces at mount time — pre-order nodes,
 * `parent === -1` at the root, raw text only under a text host, dense and
 * singly-bound value slots, no event on raw text, no repeated event on a node —
 * are re-checked here rather than assumed. This runs on a wire shape that no
 * applier has seen yet, and every one of them is a case where emitting would
 * produce something the command path would have refused to paint.
 */

import type {
	UniversalHostTemplateProgram,
	UniversalHostTemplateProgramNode,
} from 'octane/universal/native';

import { parseLynxNativeEventProp } from '../core/native-events.js';

/** Host types this backend can construct, and the intrinsic factory for each. */
const INTRINSIC_FACTORY: Readonly<Record<string, 'view' | 'text' | 'rawText'>> = Object.freeze({
	view: 'view',
	text: 'text',
	'#text': 'rawText',
	'raw-text': 'rawText',
});

/** The props `applyDenseScalarHostProps` reads on a `view` or `text`. */
const SCALAR_HOST_PROPS: readonly string[] = Object.freeze(['class', 'className', 'id']);

/**
 * Names the emitted function may not take.
 *
 * A named function expression binds its own name inside its body, so a create
 * function called `append` would call *itself* where it meant to append, and one
 * called `papi` would read `setClasses` off itself. Neither is a type error or a
 * syntax error: both are a first screen that recurses or throws at run time, in
 * generated code, on the thread with the least debuggable stack. A reserved word
 * fails earlier but no better — it is a syntax error the bundler finds, three
 * steps downstream of the program that caused it.
 *
 * The caller picks this name, so both are its mistake and both are reported to
 * it as one, rather than being worked around by mangling what it asked for.
 */
const RESERVED_EMISSION_NAMES: ReadonlySet<string> = new Set([
	// The identifiers the emission itself binds.
	'papi',
	'intrinsics',
	'view',
	'text',
	'rawText',
	'append',
	'pageId',
	'parent',
	'child',
	// Reserved words, which an identifier regex happily accepts.
	'await',
	'break',
	'case',
	'catch',
	'class',
	'const',
	'continue',
	'debugger',
	'default',
	'delete',
	'do',
	'else',
	'enum',
	'export',
	'extends',
	'false',
	'finally',
	'for',
	'function',
	'if',
	'implements',
	'import',
	'in',
	'instanceof',
	'interface',
	'let',
	'new',
	'null',
	'package',
	'private',
	'protected',
	'public',
	'return',
	'static',
	'super',
	'switch',
	'this',
	'throw',
	'true',
	'try',
	'typeof',
	'var',
	'void',
	'while',
	'with',
	'yield',
]);

/** `n0`, `v3`, `e1`, `r0`, `c2` — the per-node, per-slot, per-listener and per-range locals. */
const EMISSION_LOCAL = /^[nvecr]\d+$/;

/**
 * A hole the reduced program does not describe, and the node standing in its
 * place.
 *
 * Structurally what `universalTemplateProgramWithoutRanges` returns, so a
 * derivation's own `ranges` array passes straight through. Only `node` is read
 * here: the create function takes range values positionally, in the order the
 * caller lists the sites, exactly as it takes `v0..vN` in the order the
 * derivation lists its values.
 */
export interface LynxMainThreadProgramRange {
	readonly node: number;
}

export interface LynxMainThreadProgramEmission {
	/**
	 * A function expression taking the normalized PAPI and returning the create
	 * function. Binding the host once per program rather than once per instance
	 * is the whole reason the emission is two functions instead of one.
	 *
	 * The create function takes `(pageId, v0..vN, e0..eM, r0..rK)` and returns
	 * the run's nodes in program order, because that is the map every consumer
	 * indexes by: #163's C2 adopts slot state by key against exactly these
	 * positions. The range values come last so that a caller with none passes
	 * exactly the arguments it passed before they existed.
	 *
	 * That array is one allocation per instance, and it is the one thing here
	 * that C0's priced spike did not do — it pushed into per-slot arrays the
	 * caller had already made. Which of the two a first screen should pay for
	 * depends on what C2 needs to retain, so it is C2's to settle and to
	 * re-measure; this slice pins what is emitted, not how it is kept.
	 */
	readonly source: string;
	/** How many `v<n>` parameters the create function takes, in slot order. */
	readonly valueCount: number;
	/** How many `e<n>` listener parameters follow them, in event-site order. */
	readonly eventCount: number;
	/**
	 * How many `r<n>` range parameters follow the listeners, in site order.
	 *
	 * One per site the caller declared, including the ones this emission
	 * compiles nothing for: the position is the caller's contract rather than
	 * this function's decision.
	 */
	readonly rangeCount: number;
}

/** A program this backend declines, naming what it could not emit. */
export class LynxMainThreadEmitRefusal extends Error {
	override readonly name = 'LynxMainThreadEmitRefusal';
}

function refuse(what: string): never {
	throw new LynxMainThreadEmitRefusal(
		`Octane cannot compile this host template program into main-thread code: ${what}.`,
	);
}

/**
 * The dynamic route `host-driver.ts` would assign this node, or `0` for the
 * general patch path.
 *
 * Deliberately re-derived from the node rather than read off a compiled
 * program: this backend runs at build time, on the wire shape, before any
 * runtime program object exists. Note that `raw-text` is not route 1 here for
 * the same reason it is not there — only `#text` is — so every `raw-text` is
 * refused, carrying anything or nothing, rather than half-written.
 */
function dynamicRoute(node: UniversalHostTemplateProgramNode): 0 | 1 | 2 {
	const bindings = node.bindings ?? [];
	const names = Object.keys(node.props);
	if (
		node.type === '#text' &&
		names.every((name) => name === 'value') &&
		bindings.every((binding) => binding.name === 'value')
	) {
		return 1;
	}
	if (
		(node.type === 'view' || node.type === 'text') &&
		names.every((name) => SCALAR_HOST_PROPS.includes(name)) &&
		bindings.every((binding) => SCALAR_HOST_PROPS.includes(binding.name))
	) {
		return 2;
	}
	return 0;
}

/**
 * Where one of a node's scalar props comes from: a value the emission can fold
 * at build time, a create-function parameter it cannot, or nothing.
 *
 * A binding wins over a static prop of the same name, which is what
 * `applyDenseScalarHostProps` does by reading the props first and letting the
 * binding loop overwrite them.
 */
type ScalarSource =
	| { readonly kind: 'static'; readonly value: unknown }
	| { readonly kind: 'slot'; readonly expression: string };

function scalarSource(
	node: UniversalHostTemplateProgramNode,
	name: string,
): ScalarSource | undefined {
	for (const binding of node.bindings ?? []) {
		if (binding.name === name) return { kind: 'slot', expression: `v${binding.valueIndex}` };
	}
	if (!Object.prototype.hasOwnProperty.call(node.props, name)) return undefined;
	return { kind: 'static', value: node.props[name] };
}

/** `applyDenseScalarHostProps`'s class coercion, run at build time. */
function coerceClasses(candidate: unknown): string {
	if (typeof candidate === 'string') return candidate;
	if (typeof candidate === 'number' && candidate) return String(candidate);
	return '';
}

/**
 * Emit `applyDenseScalarHostProps` for one node, specialized to what that node
 * actually carries.
 *
 * The coercion is copied from it rather than simplified, because the two have
 * to agree on the cases that look like details: `className` shadows `class`
 * whenever it is present *at all* — including as an explicit `undefined`, which
 * is why presence is asked with `hasOwnProperty` rather than by comparing the
 * value — a numeric class is stringified only when truthy, and an empty result
 * writes nothing rather than writing `""`. A statically known value settles all
 * of that at build time, so the common case emits one call or no call at all
 * rather than a branch no instance will ever take differently.
 */
function emitScalarProps(
	node: UniversalHostTemplateProgramNode,
	index: number,
	lines: string[],
): void {
	const id = scalarSource(node, 'id');
	if (id !== undefined) {
		if (id.kind === 'static') {
			if (id.value !== null && id.value !== undefined) {
				lines.push(`\t\tpapi.setId(n${index}, ${JSON.stringify(String(id.value))});`);
			}
		} else {
			const read = id.expression;
			lines.push(
				`\t\tif (${read} !== null && ${read} !== undefined) papi.setId(n${index}, String(${read}));`,
			);
		}
	}
	const hasAliasedClass =
		Object.prototype.hasOwnProperty.call(node.props, 'className') ||
		(node.bindings ?? []).some((binding) => binding.name === 'className');
	const candidate = scalarSource(node, hasAliasedClass ? 'className' : 'class');
	if (candidate === undefined) return;
	if (candidate.kind === 'static') {
		const classes = coerceClasses(candidate.value);
		if (classes !== '') lines.push(`\t\tpapi.setClasses(n${index}, ${JSON.stringify(classes)});`);
		return;
	}
	const read = candidate.expression;
	lines.push(
		`\t\tvar c${index} = typeof ${read} === 'string' ? ${read}` +
			` : typeof ${read} === 'number' && ${read} ? String(${read}) : '';`,
	);
	lines.push(`\t\tif (c${index} !== '') papi.setClasses(n${index}, c${index});`);
}

/**
 * The text a raw-text node is created with.
 *
 * `assertTextProps` requires a `#text`'s static value to be a string, and the
 * interpreter's own read coerces a non-string to `''` rather than passing it
 * on, so a program that declares one is a program whose painted tree would
 * differ from its source. Refuse it here instead of silently agreeing with one
 * of the two.
 */
function rawTextSource(node: UniversalHostTemplateProgramNode, where: string): string {
	const source = scalarSource(node, 'value');
	if (source === undefined) {
		if (node.type === '#text') refuse(`${where} declares no value to render`);
		return "''";
	}
	if (source.kind === 'slot') return source.expression;
	if (typeof source.value !== 'string') {
		refuse(`${where} declares a non-string static value the applier would render as empty`);
	}
	return JSON.stringify(source.value);
}

/** Every value slot the program binds, checked for the density the applier requires. */
function bindingSlots(program: UniversalHostTemplateProgram): number {
	const owners: (number | undefined)[] = [];
	for (let index = 0; index < program.nodes.length; index++) {
		const node = program.nodes[index]!;
		const seen = new Set<string>();
		for (const binding of node.bindings ?? []) {
			if (seen.has(binding.name)) {
				refuse(`node ${index} binds ${JSON.stringify(binding.name)} more than once`);
			}
			seen.add(binding.name);
			if (!Number.isSafeInteger(binding.valueIndex) || binding.valueIndex < 0) {
				refuse(
					`node ${index} binds ${JSON.stringify(binding.name)} to a value slot that is not an index`,
				);
			}
			if (owners[binding.valueIndex] !== undefined) {
				refuse(`value slot ${binding.valueIndex} is bound by more than one host node`);
			}
			owners[binding.valueIndex] = index;
		}
	}
	for (let slot = 0; slot < owners.length; slot++) {
		if (owners[slot] === undefined) refuse(`value slot ${slot} is declared but never bound`);
	}
	return owners.length;
}

/**
 * Compile one host template program into main-thread source.
 *
 * The emitted create function performs the dense applier's work in the dense
 * applier's order — every node created and given its props, then every event
 * site whose listener the caller supplied installed, then every child appended
 * to its parent. It returns the run's nodes in program order and touches
 * nothing outside them.
 *
 * What it deliberately does not do is attach. The subtree is assembled fully
 * detached, and the caller performs the single append that puts it in the
 * page — because the caller has more to add: a keyed range's members are the
 * renderer's to materialize, not the program's to paint, and they go into a
 * node this function made. The one exception is a declared range site whose
 * value arrives as a string, which the create function paints itself; the
 * comment over that emission says why that is the same node the command path
 * would have painted rather than a second opinion about it.
 *
 * Attaching here would put that node in the page first and make every member
 * its own insertion, which is precisely the cost assembling detached exists to
 * avoid. Comparing painted trees cannot see any of this — two orders reach the
 * same tree — so it is asserted directly in `main-thread-emit.test.ts` rather
 * than assumed to follow from the trees agreeing.
 */
export function emitLynxMainThreadProgram(
	program: UniversalHostTemplateProgram,
	options: {
		readonly name: string;
		/**
		 * The holes the program dropped, in the order their values are passed.
		 *
		 * Omitted or empty emits exactly what it emitted before this parameter
		 * existed, which is what keeps every caller that does not supply range
		 * values on byte-identical output.
		 */
		readonly ranges?: readonly LynxMainThreadProgramRange[];
	},
): LynxMainThreadProgramEmission {
	if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(options.name)) {
		throw new TypeError(
			`Octane main-thread emission needs a JavaScript identifier for its name, received ${JSON.stringify(options.name)}.`,
		);
	}
	if (RESERVED_EMISSION_NAMES.has(options.name) || EMISSION_LOCAL.test(options.name)) {
		throw new TypeError(
			`Octane main-thread emission cannot name its function ${JSON.stringify(options.name)}: that identifier is one the emitted code binds itself.`,
		);
	}
	if (program.nodes.length === 0) refuse('the program has no nodes');

	const valueCount = bindingSlots(program);
	const body: string[] = [];

	for (let index = 0; index < program.nodes.length; index++) {
		const node = program.nodes[index]!;
		const where = `node ${index} (${node.type})`;
		const factory = INTRINSIC_FACTORY[node.type];
		if (factory === undefined) refuse(`${where} is a host type this backend cannot construct`);
		if (index === 0) {
			if (node.parent !== -1)
				refuse(`${where} names parent ${node.parent} rather than being the root`);
		} else if (!Number.isSafeInteger(node.parent) || node.parent < 0 || node.parent >= index) {
			refuse(`${where} names parent ${node.parent}, which is not an earlier node`);
		} else if (factory === 'rawText' && program.nodes[node.parent]!.type !== 'text') {
			refuse(
				`${where} sits under ${JSON.stringify(program.nodes[node.parent]!.type)} rather than a text host`,
			);
		}
		if (dynamicRoute(node) === 0) {
			const offending = [
				...Object.keys(node.props),
				...(node.bindings ?? []).map((binding) => binding.name),
			].find((name) =>
				node.type === '#text' ? name !== 'value' : !SCALAR_HOST_PROPS.includes(name),
			);
			// A node carrying nothing at all still reaches this: `raw-text` is the
			// one type with an intrinsic factory that takes neither route, because
			// only `#text` is route 1. Name the type rather than a prop that does
			// not exist.
			if (offending === undefined) {
				refuse(`${where} is raw text this backend only emits when the program spells it \`#text\``);
			}
			refuse(`${where} carries ${JSON.stringify(offending)}, which only the command path writes`);
		}
		if (factory === 'rawText') {
			body.push(`\t\tvar n${index} = rawText(${rawTextSource(node, where)});`);
		} else {
			body.push(`\t\tvar n${index} = ${factory}(pageId);`);
			emitScalarProps(node, index, body);
		}
	}

	// Event-index order, which is the order `program.eventSites` puts them in and
	// therefore the order the interpreter installs them.
	const installed = new Map<number, Set<string>>();
	for (let index = 0; index < program.events.length; index++) {
		const event = program.events[index]!;
		if (!Number.isSafeInteger(event.node) || event.node < 0 || event.node >= program.nodes.length) {
			refuse(`an event site names node ${event.node}, which the program does not have`);
		}
		const owner = program.nodes[event.node]!.type;
		if (owner === '#text' || owner === 'raw-text') {
			refuse(
				`raw-text node ${event.node} cannot own the native event ${JSON.stringify(event.type)}`,
			);
		}
		const binding = parseLynxNativeEventProp(event.type);
		// The same parser the command path uses, rather than a second reading of
		// the prefix grammar: `catch`, `capture-bind`, `capture-catch` and
		// `global-bind` all map to PAPI kinds a `bind`-only check would emit
		// wrongly, and it is the parser that decides what a malformed name is.
		if (binding === null)
			refuse(`event site ${JSON.stringify(event.type)} is not a Lynx event prop`);
		const seen = installed.get(event.node);
		if (seen === undefined) installed.set(event.node, new Set([event.type]));
		else if (seen.has(event.type)) {
			refuse(`node ${event.node} repeats the event ${JSON.stringify(event.type)}`);
		} else seen.add(event.type);
		// Guarded, not unconditional. A site's handler is a plan slot the caller
		// resolves per render, and an authored `onTap?` that is not passed leaves
		// it undefined. Installing regardless would not misroute a tap — a host
		// reads an undefined listener as *remove this event*, which on a node one
		// statement old is a no-op — it would spend a PAPI crossing saying so.
		// This is the one path whose whole purpose is that the first screen costs
		// the crossings it needs and no others, so an optional handler nobody
		// passed costs none. One local comparison replaces one crossing, per
		// event site per run.
		body.push(
			`\t\tif (e${index} !== undefined) papi.setEvent(n${event.node}, ${JSON.stringify(binding.type)}, ${JSON.stringify(binding.name)}, e${index});`,
		);
	}

	for (let index = 1; index < program.nodes.length; index++) {
		body.push(`\t\tappend(n${program.nodes[index]!.parent}, n${index});`);
	}

	// A range site's value is the one thing a build cannot know and a run cannot
	// avoid knowing, so the decision is emitted rather than made.
	//
	// `deriveLynxMainThreadProgram` answers "every renderable hole is a keyed
	// range", because a plan the compiler produced lowers a `@for`, a component
	// and a `{row.label as string}` to the same `kind: 'slot'` node. The
	// run-time lowering answers the same question by looking at the value, and
	// when that value is a string the hole stays in the program as a `#text`
	// bound on `value` — the applier's route 1, created with `rawText(value)`
	// and never written again. That is the node these lines paint, admitted by
	// the same test route 1 admits itself by: the applier *throws* on a route-1
	// value that is not a string rather than coercing it, so `typeof === 'string'`
	// is its own entry condition rather than a second opinion about one. Every
	// other value is left exactly where it is today — a hole the renderer fills
	// by key.
	//
	// Emitted after the appends, because a range hole is its host's last child
	// by construction: `universalTemplateProgramWithoutRanges` declines a program
	// where a dropped hole is not the last entry naming its parent, so appending
	// behind everything the node loop just placed *is* the position the command
	// path would have given it.
	//
	// The created node is deliberately not returned. `mountProgram` pairs the
	// returned array with the ids `assignProgramIds` handed out and refuses any
	// other length, so a position for a compiled text is an id assignment rather
	// than an emission, and it belongs to the consumer that needs one (#163 C2)
	// instead of being guessed here. Until that exists, a caller that passes
	// range values gets painted nodes its container does not own — which is why
	// no caller passes them yet.
	const ranges = options.ranges ?? [];
	const ranged = new Set<number>();
	for (let index = 0; index < ranges.length; index++) {
		const node = ranges[index]!.node;
		if (!Number.isSafeInteger(node) || node < 0 || node >= program.nodes.length) {
			refuse(`a keyed range names node ${node}, which the program does not have`);
		}
		// The reduction cannot produce two on one host — only one child can be
		// the last one — so a program that says otherwise was not reduced from a
		// shape, and appending both would put them in an order neither arm chose.
		if (ranged.has(node)) refuse(`node ${node} holds more than one keyed range`);
		ranged.add(node);
		const host = program.nodes[node]!.type;
		if (host === '#text' || host === 'raw-text') {
			refuse(`raw-text node ${node} cannot hold a keyed range`);
		}
		// Only a text host compiles. A range under a `view` is the ordinary keyed
		// list and never becomes raw text at any value, so there is nothing to
		// decide: the site keeps its parameter and stays a range. Emitting the
		// branch anyway would put a `rawText` under a `view`, which is the one
		// thing the node loop above already refuses to do.
		if (host !== 'text') continue;
		body.push(`\t\tif (typeof r${index} === 'string') append(n${node}, rawText(r${index}));`);
	}

	const params = ['pageId'];
	for (let index = 0; index < valueCount; index++) params.push(`v${index}`);
	for (let index = 0; index < program.events.length; index++) params.push(`e${index}`);
	for (let index = 0; index < ranges.length; index++) params.push(`r${index}`);
	const nodes = program.nodes.map((_node, index) => `n${index}`).join(', ');

	const source = [
		`function (papi) {`,
		`\tvar intrinsics = papi.intrinsics;`,
		`\tif (intrinsics === undefined) {`,
		`\t\tthrow new TypeError('Octane main-thread programs need a host with intrinsic element factories.');`,
		`\t}`,
		`\tvar view = intrinsics.view, text = intrinsics.text, rawText = intrinsics.rawText;`,
		`\tvar append = papi.append !== undefined`,
		`\t\t? papi.append`,
		`\t\t: function (parent, child) { papi.insertBefore(parent, child, null); };`,
		`\treturn function ${options.name}(${params.join(', ')}) {`,
		...body,
		`\t\treturn [${nodes}];`,
		`\t};`,
		`}`,
	].join('\n');

	return { source, valueCount, eventCount: program.events.length, rangeCount: ranges.length };
}
