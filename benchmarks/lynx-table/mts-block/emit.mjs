/**
 * Issue-#163 C0 — turn a derived block program into straight-line main-thread
 * code.
 *
 * This is the C1 backend, prototyped for one fixture and kept in `benchmarks/`
 * rather than in the compiler: C0 exists to price the shape before any compiler
 * work, so the emission has to be real enough to measure and disposable enough
 * that measuring it costs nothing to undo.
 *
 * What "straight-line" means here is what `prototype/lepus-root.js` already
 * demonstrates by hand: one `var` per host node, a create call, its static
 * props written inline, an append to its parent, and nothing walked at run
 * time. The difference — the whole point of C0 — is that every line below is
 * derived from the program the framework's own lowering produced for
 * `App.lynx.tsrx`, not written by someone who had the fixture in front of them.
 *
 * ## What it refuses
 *
 * The Lynx template-run applier writes exactly `id` and `class` for a host
 * node's static and bound props (`host-driver.ts`), and gives a `#text` its
 * content at creation. So those are what this emits, and anything else in a
 * program is refused by name rather than skipped. A silently unwritten prop
 * would paint a different tree and quietly invalidate the comparison this
 * exists to make, which is the one failure a measurement fixture must not have.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Element PAPI constructor per program node type, as `papi.ts` declares them. */
const CREATE = {
	view: '__CreateView(pageId)',
	text: '__CreateText(pageId)',
	'scroll-view': '__CreateScrollView(pageId)',
	image: '__CreateImage(pageId)',
};

function refuse(what) {
	throw new Error(`[mts-block] cannot emit straight-line code: ${what}.`);
}

function literal(value) {
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return JSON.stringify(value);
	}
	return refuse(`a static prop whose value is ${typeof value}`);
}

/**
 * Which expression feeds a node's `class`, `id`, or `#text` content: a literal
 * from the program's static props, or the parameter carrying its bound slot.
 */
function propSource(node, name, valueParam) {
	for (const binding of node.bindings ?? []) {
		if (binding.name === name) return valueParam(binding.valueIndex);
	}
	return Object.prototype.hasOwnProperty.call(node.props, name) ? literal(node.props[name]) : null;
}

/**
 * Emit one program as a function body.
 *
 * `parentExpr` is where the root node is appended — the page for the chrome,
 * the range site for a row. `retain` names the wire value indices whose node
 * the caller keeps, which is what a slot table is: everything else is written
 * once at create time and never addressed again.
 */
export function emitProgram(
	program,
	{ name, parentExpr, retain, tokenPrefixes, slotArrays, prologue = [], expose = {} },
) {
	const nodes = program.wire.nodes;
	const events = program.wire.events;
	const valueParam = (index) => `v${index}`;
	const arity = Math.max(
		0,
		...nodes.flatMap((node) => (node.bindings ?? []).map((binding) => binding.valueIndex + 1)),
	);
	const params = [];
	for (let index = 0; index < arity; index++) params.push(valueParam(index));
	for (let index = 0; index < events.length; index++) {
		if (tokenPrefixes === undefined) params.push(`e${index}`);
	}

	const lines = [...prologue];
	const eventsByNode = new Map();
	for (let index = 0; index < events.length; index++) {
		const list = eventsByNode.get(events[index].node);
		if (list === undefined) eventsByNode.set(events[index].node, [index]);
		else list.push(index);
	}

	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index];
		if (node.type === '#text') {
			const text = propSource(node, 'value', valueParam);
			if (text === null) refuse(`a #text node with neither a static value nor a bound one`);
			// `value` is the whole of a raw text node, so anything else on one is a
			// prop this does not write. Refused here for the same reason as below:
			// the allowlist is what makes the painted tree comparable, and an
			// allowlist that only covers elements has a hole in it.
			for (const key of Object.keys(node.props)) {
				if (key !== 'value') refuse(`static prop ${JSON.stringify(key)} on a #text node`);
			}
			for (const binding of node.bindings ?? []) {
				if (binding.name !== 'value') {
					refuse(`bound prop ${JSON.stringify(binding.name)} on a #text node`);
				}
			}
			lines.push(`\t\tvar n${index} = __CreateRawText(${text});`);
		} else {
			const create = CREATE[node.type];
			if (create === undefined) refuse(`host type ${JSON.stringify(node.type)}`);
			lines.push(`\t\tvar n${index} = ${create};`);
			const classes =
				propSource(node, 'class', valueParam) ?? propSource(node, 'className', valueParam);
			if (classes !== null) lines.push(`\t\t__SetClasses(n${index}, ${classes});`);
			const id = propSource(node, 'id', valueParam);
			if (id !== null) lines.push(`\t\t__SetID(n${index}, String(${id}));`);
			for (const key of Object.keys(node.props)) {
				if (key === 'class' || key === 'className' || key === 'id') continue;
				refuse(
					`static prop ${JSON.stringify(key)} on a ${node.type}, which the template-run applier does not write`,
				);
			}
			for (const binding of node.bindings ?? []) {
				if (binding.name !== 'class' && binding.name !== 'className' && binding.name !== 'id') {
					refuse(
						`bound prop ${JSON.stringify(binding.name)}, which the template-run applier does not write`,
					);
				}
			}
		}
		for (const eventIndex of eventsByNode.get(index) ?? []) {
			const event = events[eventIndex];
			const type = event.type.startsWith('bind')
				? event.type.slice(4)
				: refuse(`event ${event.type}`);
			const token =
				tokenPrefixes === undefined
					? `e${eventIndex}`
					: `${JSON.stringify(tokenPrefixes[eventIndex])}`;
			lines.push(`\t\t__AddEvent(n${index}, 'bindEvent', ${JSON.stringify(type)}, ${token});`);
		}
		// A child is attached to its parent as soon as it exists, but the root is
		// attached last, so the whole subtree is assembled detached and enters the
		// live tree in one append. That is what `prototype/lepus-root.js` does by
		// hand, and it is not a stylistic match: attaching the root first would
		// make every later append touch a node the engine already owns, which is a
		// different cost. C0 compares where a program came from, so an emission
		// detail like this one must not be the variable.
		if (node.parent !== -1) lines.push(`\t\t__AppendElement(n${node.parent}, n${index});`);
	}
	lines.push(`\t\t__AppendElement(${parentExpr}, n0);`);

	// A node the runtime half addresses by name rather than by slot — the range
	// site is the only one for this app, and it is the parent every row appends
	// to, so the range hole the lowering removed becomes a variable here.
	for (const [index, variable] of Object.entries(expose)) {
		if (Number(index) >= nodes.length) refuse(`an exposed node ${index} the program does not have`);
		lines.push(`\t\t${variable} = n${index};`);
	}

	for (let slot = 0; slot < retain.length; slot++) {
		// A hole here would emit `push(nundefined)`, which is a syntax error in the
		// bundle rather than a wrong number — but it would be a syntax error found
		// by the browser, three steps downstream of the program that caused it.
		if (retain[slot] === undefined) refuse(`wire value ${slot} with no node to retain`);
		lines.push(`\t\t${slotArrays[slot]}.push(n${retain[slot]});`);
	}

	return `\tfunction ${name}(${params.join(', ')}) {\n${lines.join('\n')}\n\t}`;
}

/** Which host node each wire value writes, in wire-value order. */
export function retainedNodes(program) {
	const byIndex = [];
	for (let index = 0; index < program.wire.nodes.length; index++) {
		for (const binding of program.wire.nodes[index].bindings ?? []) {
			byIndex[binding.valueIndex] = index;
		}
	}
	return byIndex;
}

if (import.meta.filename === process.argv[1]) {
	const programs = JSON.parse(
		fs.readFileSync(path.join(import.meta.dirname, 'programs.json'), 'utf8'),
	);
	const retain = retainedNodes(programs.row);
	console.log(
		emitProgram(programs.row, {
			name: 'createRow',
			parentExpr: 'rowsParent',
			retain,
			slotArrays: retain.map((_, index) => `rowSlot${index}`),
		}),
	);
}
