// Sizing measurement for #247's bucket-4 cut: how many first-screen host nodes
// could reuse a memoized prop clone and patch at all.
//
// `prepareStaticHostProps` already memoizes both on the props object's identity,
// and the steady-state `mount-template-run` path uses it (host-driver.ts:7323).
// The first-screen walk at :5040 does not — it calls `cloneProps` and
// `planLynxHostPropPatch` unconditionally, per node, on the critical path to
// first paint, where the profile puts 27.7 ms and 11.7 ms at 10,000 rows.
//
// Whether pointing the first-screen walk at the same memo is worth anything
// depends entirely on how many of its nodes are eligible, and the memo is
// deliberately narrow: a frozen props object with zero or one key, that key
// being `class`/`className` carrying a string. That is a question about what the
// main renderer hands the walk, so this counts it rather than reasoning about
// the shape of a table row. A census, not an ablation: it changes no host call
// and no painted output, it only tallies.
import fs from 'node:fs';
import path from 'node:path';

function replaceOnce(source, find, replacement, what) {
	const at = source.indexOf(find);
	if (at === -1) throw new Error(`census anchor missing: ${what}`);
	if (source.indexOf(find, at + find.length) !== -1) {
		throw new Error(`census anchor is ambiguous: ${what}`);
	}
	return source.slice(0, at) + replacement + source.slice(at + find.length);
}

const CENSUS_HELPER = `type FirstScreenPropsCensus = {
	hosts: number;
	eligible: number;
	textNodes: number;
	noProps: number;
	notFrozen: number;
	tooManyKeys: number;
	nonClassKey: number;
	nonStringValue: number;
	classOnly: number;
	distinctPropObjects: number;
	distinctClassKeys: number;
};

const FS_CENSUS_SEEN = new WeakSet<object>();
// \`prepareStaticHostProps\` keys its memo on the props object's identity. If the
// renderer allocates a fresh bag per node that memo can never hit, so the census
// counts distinct *values* too: for the class-only case the clone and the patch
// are both functions of (type, class string) alone, and a value-keyed memo would
// hit as often as those pairs repeat.
const FS_CENSUS_CLASS_KEYS = new Set<string>();

function fsCensus(): FirstScreenPropsCensus {
	const realm = globalThis as unknown as { __OCTANE_FS_PROPS?: FirstScreenPropsCensus };
	return (realm.__OCTANE_FS_PROPS ??= {
		hosts: 0,
		eligible: 0,
		textNodes: 0,
		noProps: 0,
		notFrozen: 0,
		tooManyKeys: 0,
		nonClassKey: 0,
		nonStringValue: 0,
		classOnly: 0,
		distinctPropObjects: 0,
		distinctClassKeys: 0,
	});
}

/**
 * Why this node is or is not memo-eligible, classified by the same tests
 * \`prepareStaticHostProps\` applies, in the same order. Reporting the reason
 * rather than a bare miss count is what makes the result actionable: "not
 * frozen" is a different follow-up from "carries an id as well as a class".
 */
function fsCensusNote(type: string, value: unknown): void {
	const census = fsCensus();
	census.hosts++;
	if (type === '#text') {
		census.textNodes++;
		return;
	}
	if (value === null || value === undefined || typeof value !== 'object') {
		census.noProps++;
		return;
	}
	if (!FS_CENSUS_SEEN.has(value as object)) {
		FS_CENSUS_SEEN.add(value as object);
		census.distinctPropObjects++;
	}
	if (!Object.isFrozen(value)) {
		census.notFrozen++;
		return;
	}
	const names = Object.keys(value as object);
	if (names.length > 1) {
		census.tooManyKeys++;
		return;
	}
	if (names.length === 1 && names[0] !== 'class' && names[0] !== 'className') {
		census.nonClassKey++;
		return;
	}
	if (names.length === 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value as object, names[0]!);
		if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
			census.nonStringValue++;
			return;
		}
		census.classOnly++;
		const key = type + '\u0000' + (descriptor.value as string);
		if (!FS_CENSUS_CLASS_KEYS.has(key)) {
			FS_CENSUS_CLASS_KEYS.add(key);
			census.distinctClassKeys = FS_CENSUS_CLASS_KEYS.size;
		}
	}
	census.eligible++;
}

`;

const HELPER_ANCHOR = 'function createPhysicalTree<Node extends LynxElementRef>(';

const WALK_ANCHOR = `\t\tconst props =
\t\t\tnode.props == null ? EMPTY_HOST_PROPS : cloneProps(node.props, 'first-screen host props');`;

const WALK_REPLACEMENT = `\t\tfsCensusNote(type, node.props);
\t\tconst props =
\t\t\tnode.props == null ? EMPTY_HOST_PROPS : cloneProps(node.props, 'first-screen host props');`;

/**
 * Patch the driver on disk for exactly one build and hand back the restore.
 * The same shape `stages/instrument-source.mjs` and `stages/e1-ablation-source.mjs`
 * use: anchors are unambiguous or the call throws, so a reflow that moves them
 * fails the build rather than producing an uninstrumented bundle that looks fine.
 */
export function instrumentFirstScreenPropsCensus(repositoryRoot) {
	const file = path.join(repositoryRoot, 'packages/lynx/src/core/host-driver.ts');
	const original = fs.readFileSync(file, 'utf8');
	let next = replaceOnce(original, HELPER_ANCHOR, CENSUS_HELPER + HELPER_ANCHOR, 'census helper');
	next = replaceOnce(next, WALK_ANCHOR, WALK_REPLACEMENT, 'first-screen walk prop site');
	fs.writeFileSync(file, next);
	return () => fs.writeFileSync(file, original);
}
