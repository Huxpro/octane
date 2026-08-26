// Which framework function owns a main-thread script sample.
//
// The boundary instrument (`stages/papi-run.mjs`) measures everything above the
// Element PAPI as one number per first-screen phase. Issue #163 needs one level
// finer: `publish` holds most of what a compiled main-thread program still
// spends, and the question is what that script is doing while it issues exactly
// the calls a hand-written emitter issues. A CPU profile answers it, but a
// profile of a minified production bundle names nothing — every function is one
// mangled letter.
//
// So the frames are bucketed by what the minifier cannot rename: the string
// literals in the code itself. Every probe below is a diagnostic message, a
// wire-format property name, or a public identifier prefix, taken from the
// source that produces it. A probe that stops matching is a probe whose message
// changed, which is a source edit rather than a silent drift — and `unmatched`
// is reported rather than folded away, so a bucket that quietly stopped
// catching its function shows up as a large unnamed frame instead of a small
// bucket.

/**
 * Ordered: the first probe whose text appears in the window at a frame's
 * position wins, so a narrower probe must precede a broader one. `where` names
 * the source the probe was taken from, because that is what a reader has to
 * open when a probe stops matching.
 */
export const BUCKETS = Object.freeze([
	{
		bucket: 'program mount',
		probe: 'first-screen program binds an event on node ',
		where: 'core/host-driver.ts mountProgram',
	},
	{
		// The same function, entered from its other end. Which of these two is
		// within reach of `mountProgram`'s entry is decided by the minifier, not by
		// the source: when the per-site loop body closes over its site the minifier
		// hoists it into a helper at the function's start, and the event message
		// lands 82 characters in; when it does not, the function starts with its
		// own validation and the event message is 1051 characters in — past any
		// window this table can afford. An ablation that removed the closure moved
		// it, and the bucket read 0.0 ms with 154 ms of new `unmatched`, which is
		// how this was found (issue #163 C11). So a bucket needs a probe near the
		// entry in every shape the minifier produces, not only in the one that
		// happened to be measured first.
		bucket: 'program mount',
		probe: 'first-screen program node carries no plan',
		where: 'core/host-driver.ts mountProgram',
	},
	{
		bucket: 'program mount',
		probe: 'first-screen program appends a keyed range into node ',
		where: 'core/host-driver.ts mountProgram range members',
	},
	{
		bucket: 'applier entry and pre-walk',
		probe: 'first-screen container is not accepting an initial tree.',
		where: 'core/host-driver.ts applyLynxFirstScreenDirect',
	},
	{
		bucket: 'applier entry and pre-walk',
		probe: '"list-item"===',
		where: 'core/host-driver.ts firstScreenTreeHasList',
	},
	{
		bucket: 'first tree capture',
		probe: 'first tree can only be captured from a stable accepted root.',
		where: 'core/host-driver.ts captureLynxFirstTree',
	},
	{
		bucket: 'first-screen entry',
		probe: 'Octane Lynx first-screen root rendered after receiver close.',
		where: 'main-thread.ts renderFirstScreenNow',
	},
	{
		bucket: 'applier walk',
		probe: 'physicalParent',
		where: 'core/host-driver.ts visit and pushChildren',
	},
	{
		bucket: 'host record building',
		probe: 'octane.lynx.element',
		where: 'core/host-driver.ts createHandle',
	},
	{
		bucket: 'host record building',
		probe: ' must be a plain object.',
		where: 'core/host-driver.ts cloneProps',
	},
	{
		bucket: 'host record building',
		probe: 'selectorInstalled',
		where: 'core/host-driver.ts selector install',
	},
	{
		bucket: 'host record building',
		probe: '"view"===',
		where: 'core/host-driver.ts planLynxHostPropPatch',
	},
	{
		bucket: 'host record building',
		probe: '?e.value:"string"==typeof e.text',
		where: 'core/host-driver.ts textValue',
	},
	{
		bucket: 'host record building',
		probe: 'setCssId(',
		where: 'core/host-driver.ts emitHostNode',
	},
	{
		bucket: 'host record building',
		probe: 'Octane Lynx NodesRef ',
		where: 'core/selectors.ts handle-selector guards',
	},
	{
		bucket: 'event bookkeeping',
		probe: '.nativeEvents.get(',
		where: 'core/host-driver.ts nativeEventMap',
	},
	{
		bucket: 'event bookkeeping',
		probe: 'octane-lynx:event:',
		where: 'core/events.ts token encode',
	},
	{
		bucket: 'event bookkeeping',
		probe: ' is not a Lynx event prop.',
		where: 'core/host-driver.ts parseLynxNativeEventProp',
	},
	{
		bucket: 'element factory dispatch',
		probe: 'case"raw-text":',
		where: 'core/papi.ts createElement type switch',
	},
	{
		bucket: 'renderer pre-passes',
		probe: 'kind:"host",key:null,id:0,type:',
		where: 'main-renderer.ts first-screen host and text factories',
	},
	{
		bucket: 'renderer pre-passes',
		probe: 'Object.isFrozen(',
		where: 'main-renderer.ts recursive prop freeze',
	},
	{
		bucket: 'renderer pre-passes',
		probe: '.plan.',
		where: 'main-renderer.ts program id count and assignment',
	},
	{
		bucket: 'renderer pre-passes',
		probe: '"template"===',
		where: 'main-renderer.ts template create and prop freeze',
	},
	{
		bucket: 'renderer pre-passes',
		probe: '.$$kind)===',
		where: 'main-renderer.ts node normalization',
	},
	{
		bucket: 'renderer pre-passes',
		probe: '"spread"===',
		where: 'main-renderer.ts prop bag builder',
	},
]);

/**
 * The window a probe is matched against, in characters from a frame's own
 * position. Calibrated rather than guessed: every probe above sits inside its
 * function's first 160 characters, and 160 is short enough that the closest
 * pair of neighbouring functions in the measured bundle — the applier's `visit`
 * and `mountProgram`, 258 characters apart — cannot reach each other. A wider
 * window credited every `visit` sample to `mountProgram`, which made the cell
 * carrying no compiled program at all report the run's largest program-mount
 * cost.
 */
export const PROBE_WINDOW = 160;

/**
 * Bucket one frame. `text` is the source at the frame's position. A frame the
 * table does not name is `null`, which the caller reports rather than hides —
 * except for a frame the compiled program itself owns, which carries no
 * literal of its own and is named by its caller instead.
 */
export function bucketOf(text) {
	for (const entry of BUCKETS) {
		if (text.includes(entry.probe)) return entry.bucket;
	}
	return null;
}

/**
 * True for the frame that mounts a program, whose unnamed callees are its create.
 *
 * Both entry probes, for the reason above: identifying the mount by only one of
 * them makes the compiled program's own time depend on which shape the minifier
 * chose, and in the shape that misses it the create reads as 0.0 ms rather than
 * as anything a reader would question.
 *
 * In the hoisted shape this is also true of the helper the minifier lifted out
 * of the per-site loop, whose one unnamed callee is the `.find` predicate rather
 * than a create. That predicate's self time is therefore inside
 * `compiled program create` in that shape, which overstates it — by at most the
 * predicate, which the shape without the closure bounds directly.
 */
export function isProgramMountFrame(text) {
	return (
		text.includes('first-screen program binds an event on node ') ||
		text.includes('first-screen program node carries no plan')
	);
}

/**
 * Fold one CPU profile into `{buckets, unmatched, samples}`, in microseconds.
 *
 * Only frames in `scriptUrl` are counted: the page realm runs the harness's own
 * predicate walker, which is measurement rather than framework and would swamp
 * everything if it were folded in. `sourceAt(line, column)` returns the window
 * to match, so the caller owns how the script text was obtained.
 */
export function foldProfile(profile, scriptUrl, sourceAt) {
	const byId = new Map(profile.nodes.map((node) => [node.id, node]));
	const parentOf = new Map();
	for (const node of profile.nodes) {
		for (const child of node.children ?? []) parentOf.set(child, node.id);
	}
	const selfUs = new Map();
	const deltas = profile.timeDeltas ?? [];
	for (let index = 0; index < profile.samples.length; index++) {
		const id = profile.samples[index];
		selfUs.set(id, (selfUs.get(id) ?? 0) + (deltas[index] ?? 0));
	}
	const buckets = new Map();
	const unmatched = new Map();
	let samples = 0;
	const add = (map, key, us, hits) => {
		const cell = map.get(key) ?? { us: 0, hits: 0 };
		cell.us += us;
		cell.hits += hits;
		map.set(key, cell);
	};
	for (const [id, us] of selfUs) {
		const node = byId.get(id);
		if (node === undefined || node.callFrame.url !== scriptUrl) continue;
		samples += node.hitCount ?? 0;
		const frame = node.callFrame;
		const text = sourceAt(frame.lineNumber, frame.columnNumber);
		const named = bucketOf(text);
		if (named !== null) {
			add(buckets, named, us, node.hitCount ?? 0);
			continue;
		}
		// A compiled program's create function is emitted code: it carries no
		// diagnostic of its own, and its name is whatever the minifier chose. What
		// identifies it is its caller — `mountProgram` calls exactly one thing the
		// table does not already name.
		const parent = parentOf.get(id);
		const parentFrame = parent === undefined ? undefined : byId.get(parent)?.callFrame;
		if (
			parentFrame !== undefined &&
			parentFrame.url === scriptUrl &&
			isProgramMountFrame(sourceAt(parentFrame.lineNumber, parentFrame.columnNumber))
		) {
			add(buckets, 'compiled program create', us, node.hitCount ?? 0);
			continue;
		}
		add(unmatched, `${frame.lineNumber}:${frame.columnNumber}`, us, node.hitCount ?? 0);
	}
	return { buckets, unmatched, samples };
}
