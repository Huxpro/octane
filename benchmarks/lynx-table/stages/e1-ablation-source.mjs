// Issue #246 §7: the falsification ablation for E1, as a build-time source patch.
//
// §7 says what would kill E1 before it is built: "an ablation that stubs the MTS
// descriptor walk out of a steady-state create and shows the create cell
// unmoved." It also says E1 "does not reduce host calls" — a compact
// `mount-template-run` is real work no addressing removes. So an ablation that
// deletes host calls prices something E1 could never buy, and would greenlight
// it on a number it cannot deliver. Everything here is therefore
// work-preserving at the Element PAPI boundary: the same calls, with the same
// arguments, in the same order; only the interpretation that decides them is
// removed.
//
// Two patches, both applied to `packages/lynx/src/core/host-driver.ts`:
//
//   census   which applier served a run, and how many rows and hosts it built.
//            Published on the main-thread realm's global, which
//            `web/driver-client.mjs applyMainRealmProbe` already exposes to the
//            page. Per run, not per row, so an arm carrying it is still an arm
//            whose wall clock means something.
//
//   ablate   the stub itself. Applied only to the candidate arm.
//
// Restore is the caller's, exactly as `instrument-source.mjs` hands it back: the
// patch lives on disk only for the length of one `rspeedy build`.
import fs from 'node:fs';
import path from 'node:path';

function replaceOnce(source, search, replacement, file) {
	const first = source.indexOf(search);
	if (first === -1) throw new Error(`e1 ablation anchor missing in ${file}.`);
	if (source.indexOf(search, first + search.length) !== -1) {
		throw new Error(`e1 ablation anchor is ambiguous in ${file}.`);
	}
	return source.slice(0, first) + replacement + source.slice(first + search.length);
}

/** The census helper, injected once beside the appliers it counts. */
const CENSUS_HELPER = `type E1Census = {
	denseRuns: number;
	denseRows: number;
	denseHosts: number;
	slowRuns: number;
	slowRows: number;
	slowHosts: number;
	ablatedRuns: number;
	fallbackProps: number;
};

function e1census(): E1Census {
	const realm = globalThis as unknown as { __OCTANE_E1_PATHS?: E1Census };
	return (realm.__OCTANE_E1_PATHS ??= {
		denseRuns: 0,
		denseRows: 0,
		denseHosts: 0,
		slowRuns: 0,
		slowRows: 0,
		slowHosts: 0,
		ablatedRuns: 0,
		fallbackProps: 0,
	});
}

`;

export function instrumentE1AblationSources(
	repositoryRoot,
	{ ablate = false, aggressive = false } = {},
) {
	const originals = new Map();
	const update = (relative, transform) => {
		const file = path.join(repositoryRoot, relative);
		if (originals.has(file)) throw new Error(`e1 ablation patched ${relative} twice.`);
		const source = fs.readFileSync(file, 'utf8');
		originals.set(file, source);
		fs.writeFileSync(file, transform(source, relative));
	};

	try {
		update('packages/lynx/src/core/host-driver.ts', (source, file) => {
			let next = replaceOnce(
				source,
				'function createPhysicalTree<Node extends LynxElementRef>(',
				`${CENSUS_HELPER}function createPhysicalTree<Node extends LynxElementRef>(`,
				file,
			);
			next = replaceOnce(
				next,
				`									const dense = operation.dense;
									const program = dense.program;
									const width = program.shape.types.length;`,
				`									const dense = operation.dense;
									const program = dense.program;
									const width = program.shape.types.length;
									{
										const census = e1census();
										census.denseRuns++;
										census.denseRows += dense.count;
										census.denseHosts += dense.count * width;
									}`,
				file,
			);
			next = replaceOnce(
				next,
				`								const records = operation.records;
								const firstId = compactHostCount === undefined ? undefined : operation.firstId;
								const rows = operation.count ?? 1;
								const width = operation.parents.length;`,
				`								const records = operation.records;
								const firstId = compactHostCount === undefined ? undefined : operation.firstId;
								const rows = operation.count ?? 1;
								const width = operation.parents.length;
								{
									const census = e1census();
									census.slowRuns++;
									census.slowRows += rows;
									census.slowHosts += rows * width;
								}`,
				file,
			);
			return ablate ? applyDenseAblation(next, file, aggressive) : next;
		});
	} catch (error) {
		for (const [file, original] of originals) fs.writeFileSync(file, original);
		throw error;
	}

	return () => {
		for (const [file, original] of originals) fs.writeFileSync(file, original);
	};
}

/**
 * The stub, on the dense applier.
 *
 * The product loop reads `program.shape.types[index]`, `program.props[index]`,
 * `program.bindings[index]`, `program.dynamicRoutes[index]` and
 * `program.patches[index]` once per host per row and branches on each, then
 * hands the scalar route to `applyDenseScalarHostProps`, which walks the
 * bindings again comparing `binding.name` against `'id'`, `'text'` and
 * `'className'` per host per row. Every one of those decisions is a property of
 * the *shape*: identical on row 999 and row 0. Re-taking them per row is
 * precisely the interpretation E1 promises to compile away.
 *
 * This resolves all of it once per run into flat per-node tables and then runs a
 * row loop that only issues host calls. It is deliberately more generous than
 * E1 itself: a compiled create is still a function called once per row, and it
 * still has to write the ids its own run record addresses by; this pays
 * neither. If the create cell does not move under a stub that removes strictly
 * more than the design could, the design cannot move it — which is the shape of
 * falsification §7 asks for.
 *
 * What it does not touch is the boundary. Same `createElement` or intrinsic
 * factory, same `setId`/`setAttribute('text')`/`setClasses` with the same
 * values under the same emptiness rules, same prepared event installs, same
 * appends in the same order. `dense.setNode` stays, because that is the store's
 * id table rather than interpretation, and so does `applyProps` for a node the
 * program left unbound — its patch is already a per-program constant, and
 * replacing the generic applier would take a recorder this ablation does not
 * need. Both are ablated *less* than E1 would ablate them, which can only make
 * the measured delta smaller than E1's ceiling, never larger.
 */
function applyDenseAblation(source, file, aggressive) {
	// The applier sits nine tabs deep, so the patch is written flat and indented
	// on the way in: an anchor that hard-codes the depth breaks on any reflow of
	// the surrounding block, and this one has to survive them.
	const pad = '\t'.repeat(9);
	const indent = (text) =>
		text
			.split('\n')
			.map((line) => (line === '' ? line : pad + line))
			.join('\n');

	const anchor = indent(`for (let row = 0; row < dense.count; row++) {
	const rowOffset = row * width;
	const valueOffset = row * program.valueCount;
	for (let index = 0; index < width; index++) {`);
	const head = source.indexOf(anchor);
	if (head === -1) throw new Error(`e1 ablation row-loop anchor missing in ${file}.`);
	const terminator = `${pad}continue;\n${'\t'.repeat(8)}}`;
	const tail = source.indexOf(terminator, head);
	if (tail === -1) throw new Error(`e1 ablation row-loop terminator missing in ${file}.`);

	const replacement =
		indent(`// Issue #246 §7 ablation arm: the descriptor walk, resolved once.
e1census().ablatedRuns++;
const e1Type: string[] = [];
const e1Raw: boolean[] = [];
const e1Scalar: boolean[] = [];
const e1Props: boolean[] = [];
// Slot indices into the run's value block, or -1 for "not bound here"; the
// paired \`e1Static*\` entry then carries what the shape already fixed. This is
// the whole of what the scalar route decides per host per row in the product,
// taken once per run instead.
const e1TextSlot: number[] = [];
const e1IdSlot: number[] = [];
const e1ClassSlot: number[] = [];
const e1StaticText: string[] = [];
const e1StaticId: (string | null)[] = [];
const e1StaticClass: string[] = [];
// Aggressive arm only: an unbound node whose whole creation patch is id,
// classes and plain attributes writes the same calls with the same constants
// on every row, so those hoist too. Anything else — a CSS scope, inline
// styles, a dataset, a main-thread event or ref, a \`hidden\` attribute whose
// value depends on the record — keeps \`applyProps\` and is counted, so the arm
// reports its own coverage instead of asserting it.
const e1Direct: boolean[] = [];
// \`undefined\` means "no setId call at all"; \`null\` means the patch writes
// null, which \`applyProps\` does and this arm may not skip.
const e1DirectId: (string | null | undefined)[] = [];
const e1DirectClass: (string | undefined)[] = [];
const e1Attributes: { name: string; value: unknown }[][] = [];
for (let index = 0; index < width; index++) {
	const type = program.shape.types[index]!;
	const props = program.props[index]!;
	const bindings = program.bindings[index];
	const rawText = type === '#text' || type === 'raw-text';
	e1Type.push(type);
	e1Raw.push(rawText);
	const scalar = bindings !== undefined && program.dynamicRoutes[index] === 2;
	e1Scalar.push(scalar);
	const patch = program.patches[index]!;
	let wantsProps = bindings === undefined && patch !== EMPTY_RAW_TEXT_CREATE_PATCH;
	let direct = false;
	const attributes: { name: string; value: unknown }[] = [];
	if (${aggressive} && wantsProps) {
		direct =
			type !== '#text' &&
			patch.cssScope === undefined &&
			patch.inlineStyles === undefined &&
			patch.dataset === undefined &&
			patch.mainThreadRef === undefined &&
			patch.mainThreadEvents.length === 0 &&
			patch.attributes.every((attribute) => attribute.name !== 'hidden');
		if (direct) {
			wantsProps = false;
			for (const attribute of patch.attributes) {
				attributes.push({ name: attribute.name, value: attribute.value });
			}
		}
	}
	e1Direct.push(direct);
	e1Attributes.push(attributes);
	e1Props.push(wantsProps);
	// The create-time text a raw-text host is made with: a bound slot when the
	// program has one, otherwise whichever static carrier the props hold.
	let createSlot = -1;
	let createText = '';
	if (rawText) {
		if (bindings === undefined) {
			createText =
				typeof props.value === 'string'
					? props.value
					: typeof props.text === 'string'
						? props.text
						: '';
		} else createSlot = bindings[0]!.valueIndex;
	}
	// \`applyDenseScalarHostProps\`, unrolled: its \`props\` reads and its
	// binding-name comparisons answer the same way for every row, so they
	// answer here instead.
	let idSlot = -1;
	let textSlot = -1;
	let classSlot = -1;
	let staticId: string | null = null;
	let staticText = '';
	let staticClass = '';
	if (scalar) {
		const id = props.id;
		const text = props.text;
		const ordinaryClass = props.class;
		const aliasedClass = props.className;
		let ordinarySlot = -1;
		let aliasedSlot = -1;
		let hasAliased = Object.prototype.hasOwnProperty.call(props, 'className');
		for (const binding of bindings!) {
			if (binding.name === 'id') idSlot = binding.valueIndex;
			else if (binding.name === 'text') textSlot = binding.valueIndex;
			else if (binding.name === 'className') {
				aliasedSlot = binding.valueIndex;
				hasAliased = true;
			} else ordinarySlot = binding.valueIndex;
		}
		if (idSlot === -1 && id !== null && id !== undefined) staticId = String(id);
		if (textSlot === -1 && typeof text === 'string') staticText = text;
		classSlot = hasAliased ? aliasedSlot : ordinarySlot;
		if (classSlot === -1) {
			const candidate = hasAliased ? aliasedClass : ordinaryClass;
			staticClass =
				typeof candidate === 'string'
					? candidate
					: typeof candidate === 'number' && candidate
						? String(candidate)
						: '';
		}
	}
	// \`applyProps\` writes \`patch.id.value\` even when it is null, and writes
	// classes only when the patch carries them; both are reproduced rather than
	// approximated, because a skipped or added call is a different number of
	// host calls and this arm may not change that.
	e1DirectId.push(direct && patch.id !== undefined ? patch.id.value : undefined);
	e1DirectClass.push(direct && patch.classes !== undefined ? patch.classes.value : undefined);
	e1TextSlot.push(rawText ? createSlot : textSlot);
	e1StaticText.push(rawText ? createText : staticText);
	e1IdSlot.push(idSlot);
	e1StaticId.push(staticId);
	e1ClassSlot.push(classSlot);
	e1StaticClass.push(staticClass);
}
const e1Papi = state.papi;
const e1PageId = container.pageComponentUniqueId;
const e1Parents = program.shape.parents;
const e1Values = dense.values;
for (let row = 0; row < dense.count; row++) {
	const rowOffset = row * width;
	const valueOffset = row * program.valueCount;
	for (let index = 0; index < width; index++) {
		const rawText = e1Raw[index]!;
		const createSlot = e1TextSlot[index]!;
		const createText = !rawText
			? ''
			: createSlot === -1
				? e1StaticText[index]!
				: (e1Values[valueOffset + createSlot] as string);
		const factory = intrinsicFactories?.[index];
		const node =
			factory === undefined
				? e1Papi.createElement(e1Type[index]!, e1PageId, createText)
				: rawText
					? (factory as (value: string) => Node)(createText)
					: (factory as (value: number) => Node)(e1PageId);
		state.ownedNodes.add(node);
		dense.setNode(rowOffset + index, node);
		if (e1Direct[index]!) {
			const directId = e1DirectId[index];
			if (directId !== undefined) e1Papi.setId(node, directId);
			const directClass = e1DirectClass[index];
			if (directClass !== undefined) e1Papi.setClasses(node, directClass);
			for (const attribute of e1Attributes[index]!) {
				e1Papi.setAttribute(node, attribute.name, attribute.value);
			}
		} else if (e1Scalar[index]!) {
			const idSlot = e1IdSlot[index]!;
			if (idSlot === -1) {
				const staticId = e1StaticId[index]!;
				if (staticId !== null) e1Papi.setId(node, staticId);
			} else {
				const value = e1Values[valueOffset + idSlot];
				if (value !== null && value !== undefined) e1Papi.setId(node, String(value));
			}
			const textSlot = e1TextSlot[index]!;
			const text =
				textSlot === -1 ? e1StaticText[index]! : e1Values[valueOffset + textSlot];
			if (typeof text === 'string' && text !== '')
				e1Papi.setAttribute(node, 'text', text);
			const classSlot = e1ClassSlot[index]!;
			if (classSlot === -1) {
				const classes = e1StaticClass[index]!;
				if (classes !== '') e1Papi.setClasses(node, classes);
			} else {
				const candidate = e1Values[valueOffset + classSlot];
				const classes =
					typeof candidate === 'string'
						? candidate
						: typeof candidate === 'number' && candidate
							? String(candidate)
							: '';
				if (classes !== '') e1Papi.setClasses(node, classes);
			}
		} else if (e1Props[index]!) {
			e1census().fallbackProps++;
			applyProps(
				state,
				node,
				e1Type[index]!,
				EMPTY_HOST_PROPS,
				program.props[index]!,
				program.patches[index]!,
				true,
				true,
				false,
			);
		}
	}
	if (dense.firstListenerId !== null) {
		const rowListener = dense.firstListenerId + row * program.eventCount;
		for (const site of program.eventSites) {
			installPreparedNativeEvent(
				state,
				dense.nodes[rowOffset + site.node]!,
				container.root,
				dense.firstId + rowOffset + site.node,
				rowListener,
				site,
			);
		}
	}
	for (let index = 1; index < width; index++) {
		append(dense.nodes[rowOffset + e1Parents[index]!]!, dense.nodes[rowOffset + index]!);
	}
	const root = dense.nodes[rowOffset]!;
	if (dense.parent === null) state.ownedPageRoots.add(root);
	append(parent, root);
}
continue;`) + `\n${'\t'.repeat(8)}}`;

	return source.slice(0, head) + replacement + source.slice(tail + terminator.length);
}
