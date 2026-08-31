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
		// The `.find` predicate the per-site loop runs over the announced events.
		// It is called from the mount and carries no literal, so it fell through
		// to the `compiled program create` fallback and was reported as emitted
		// code — exactly the overstatement `isProgramMountFrame` predicted below
		// and could not bound. Named here, it is the mount's own.
		bucket: 'program mount',
		probe: '([e])=>e===',
		where: 'core/host-driver.ts mountProgram event-site lookup',
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
		// `pushChildren` first, and by property names alone. Its window contains
		// `denseSpan` too — it initialises the field it pushes — so the broader
		// probe below would swallow it and the walk's two functions would report
		// as one site. Property names are what the minifier leaves alone; the
		// order is the source's own.
		bucket: 'applier walk',
		probe: 'papiNode:null,listRecord:null,denseSpan:null',
		where: 'core/host-driver.ts pushChildren',
	},
	{
		// This bucket read 0.0 ms while 111.5 ms of its two functions sat in
		// `unmatched` — 93.5 at `visit` and 18.0 at `pushChildren`, the two
		// largest unnamed frames in the whole run. The probe was `physicalParent`,
		// taken from a `visit` that destructured its frame at the top. `visit`
		// still destructures and still has that name in it, but the dense-span
		// fast path now runs first, so the destructuring — and the probe — moved
		// past the 160-character window. The bucket did not stop being entered;
		// its probe stopped being reachable, which is the drift the `unmatched`
		// report exists to make visible, and this is it being read.
		//
		// `denseSpan` is what `visit` reads on its first line, so it is inside any
		// window this table can afford. Deliberately not `denseSpan;if(null!==`,
		// which would also pin the minifier's choice to write the comparison with
		// the constant first — a rewrite that changes nothing about the source
		// would empty the bucket again.
		bucket: 'applier walk',
		probe: 'denseSpan',
		where: 'core/host-driver.ts visit',
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
		// `setCssId(` used to be this probe, and it named the PAPI facade's own
		// `setClasses` wrapper as well: the facade declares `setCssId` 161
		// characters into the same object literal, so a sample in `setClasses`
		// carried `setCssId(` in its window. In the program cell that wrapper was
		// the whole of `host record building` — a bucket the program empties,
		// reading 2.5 ms of a function in another file. `cssScope.value` occurs
		// twice in the bundle and both are this function's own arguments.
		bucket: 'host record building',
		probe: 'cssScope.value',
		where: 'core/host-driver.ts emitHostNode',
	},
	{
		bucket: 'host record building',
		probe: 'Octane Lynx NodesRef ',
		where: 'core/nodes-ref.ts assertPositiveSafeInteger',
	},
	// The facade `createLynxPapi` returns: one-line wrappers forwarding to the
	// host functions. Three are sampled. Two of them, `setClasses` and `setEvent`,
	// sit 161 characters apart in one object literal, which is past the window, so
	// they take a probe each and share a `where`, the way two entrances to one
	// function do. The third is `createPage`, which is adjacent to a function in
	// another bucket and is handled below.
	{
		bucket: 'papi facade',
		probe: ',setInlineStyles(',
		where: 'core/papi.ts papi facade methods',
	},
	{
		bucket: 'papi facade',
		probe: ',setId(e',
		where: 'core/papi.ts papi facade methods',
	},
	// `createPage` is a third wrapper, and it is adjacent: it forwards to
	// `__CreatePage` from the property declared immediately before
	// `createElement`, 27 characters ahead of it. So `case"raw-text":` — the
	// `element factory dispatch` probe below — reached backwards into it, and
	// that bucket was a total shared between the page factory and the type
	// switch. In the program cell it was worse than shared: the only frame the
	// bucket ever sampled there was this wrapper, so its 0.0 was read as "the
	// switch is free" when the switch was never entered at all. `,createElement(`
	// occurs once in the bundle and cannot be reached from the switch's own
	// window, which starts after it; the reverse is not true, so this entry has
	// to precede `element factory dispatch` and a test pins that it does.
	{
		bucket: 'papi facade',
		probe: ',createElement(',
		where: 'core/papi.ts createPage',
	},
	// Issue-#215 D3 stopped the mount writing a journal entry per event site, so
	// in the paint window this probe should find nothing on a program cell: the
	// functions that derive those entries run at hand-over and at terminal
	// cleanup, and the paint window closes before either. That is the A/B this
	// bucket reads.
	//
	// It used to close before *every* window, and this comment used to conclude
	// from that that those functions could not carry probes of their own — a
	// frame from them would be a claim about the window rather than about them.
	// D7 opened the second window and removed the premise: they are sampled now,
	// so they are named now, under `deferred event journal` at the end of this
	// table. `materializeProgramEvents` still has no probe and would still land
	// here if a frame from it ever appeared, because it asks the same question
	// this entry names.
	{
		bucket: 'event bookkeeping',
		probe: '.nativeEvents.get(',
		where: 'core/host-driver.ts nativeEventMap',
	},
	{
		bucket: 'event bookkeeping',
		probe: 'octane-lynx:event:',
		where: 'core/native-events.ts encodePrevalidatedLynxNativeEventToken',
	},
	{
		bucket: 'event bookkeeping',
		probe: ' is not a Lynx event prop.',
		where: 'core/host-driver.ts installNativeEvent',
	},
	// Both are called from a program mount and neither carried a probe, so both
	// fell through to the `compiled program create` fallback below and were
	// reported as emitted code. They are the two halves of the event token the
	// mount builds per site: the prop name parsed, then the token encoded.
	{
		bucket: 'event bookkeeping',
		probe: '98!==r&&99!==r',
		where: 'core/native-events.ts parseLynxNativeEventProp',
	},
	{
		// `native-events.ts` has an assert of its own, distinct from the
		// `nodes-ref.ts` one above, and it is declared 99 characters before the
		// encode that calls it — inside the window, so `"identity.root"` named it
		// too. That probe is C16's, and this is C16's own defect: the run that
		// added it is the run whose record showed the site at two frames.
		bucket: 'event bookkeeping',
		probe: 'e<=0)throw y(',
		where: 'core/native-events.ts assertPositiveSafeInteger',
	},
	{
		bucket: 'event bookkeeping',
		probe: '"identity.root"',
		where: 'core/native-events.ts encodeCheckedLynxNativeEventToken',
	},
	// Issue-#215 D1 gave the mount a second question to ask per program — does
	// this run start after the previous one ended — and its answer comes from a
	// helper `mountProgram` calls. Without a probe that lands in the
	// `compiled program create` fallback below, which would report D1's own cost
	// as emitted program code. The helper is shared with the adoption-side
	// readers precisely so this probe names one function; a first screen never
	// adopts, so in this instrument only the mount's call can appear, and a
	// second frame here would say otherwise.
	{
		bucket: 'program mount',
		probe: '.rangeIds.length-1',
		where: 'core/first-screen.ts programRunLastId',
	},
	{
		bucket: 'element factory dispatch',
		probe: 'case"raw-text":',
		where: 'core/papi.ts createElement type switch',
	},
	// `kind:"host",key:null,id:0,type:` used to be one probe here, folding two
	// factories and, in both cells, a third frame that is neither: the thunk
	// `renderComponent` hands to `withOwner`, which sits 67 characters before
	// `TEMPLATE_ENV` and reached it. Order matters between the thunk and the `h`
	// factory for that reason, and only between those two.
	{
		bucket: 'renderer pre-passes',
		probe: ',null))}finally{',
		where: 'main-renderer.ts renderComponent',
	},
	{
		bucket: 'renderer pre-passes',
		probe: 'type:"#text",props:',
		where: 'main-renderer.ts textNode',
	},
	{
		bucket: 'renderer pre-passes',
		probe: 'props:{},events:new Map',
		where: 'main-renderer.ts TEMPLATE_ENV.h',
	},
	// `"template"===` used to be one probe here, named `template create and prop
	// freeze`, and it folded three functions that share nothing but that test:
	// the plan constructor, the plan validator it calls, and the render that
	// executes a compiled create. C15 saw two of them; C16's own window entered
	// the third, which is why the run that split this bucket is also the run that
	// found this. Ordered constructor, validator, render: the constructor's
	// window reaches the validator's probe 68 characters ahead of it, and the
	// render's reaches the nested freeze below it 53 characters ahead.
	{
		bucket: 'renderer pre-passes',
		probe: ',renderer:e,root:',
		where: 'main-renderer.ts universalPlan',
	},
	{
		bucket: 'renderer pre-passes',
		probe: '!Array.isArray(r.slots)',
		where: 'main-renderer.ts freezePlanNode',
	},
	{
		bucket: 'renderer pre-passes',
		probe: 'var n;return function e(',
		where: 'main-renderer.ts renderTemplate',
	},
	{
		bucket: 'renderer pre-passes',
		probe: 'Object.isFrozen(',
		where: 'main-renderer.ts recursive prop freeze',
	},
	// The three functions the single `.plan.` probe used to fold into one site.
	// `assignIds` and `assignProgramIds` sit 67 characters apart in the measured
	// bundle — the minifier inlines the second into the first's comma sequence —
	// so a probe either separates them on text unique to each or reports a total
	// belonging to both. `.plan.` did the latter: 26 occurrences in the bundle,
	// three of them reachable from a sampled frame. Each probe below occurs
	// exactly once in the whole bundle, and none reaches either of the others.
	{
		bucket: 'renderer pre-passes',
		probe: '.nextId,',
		where: 'main-renderer.ts assignIds',
	},
	{
		bucket: 'renderer pre-passes',
		probe: '.plan.nodes+',
		where: 'main-renderer.ts assignProgramIds',
	},
	{
		bucket: 'renderer pre-passes',
		probe: '.plan.nodes,',
		where: 'main-renderer.ts collectFirstScreenEvents',
	},
	// `TEMPLATE_ENV`'s three child appenders, declared back to back so that each
	// one's window contains the ones after it. They must therefore be checked in
	// source order — `t`, then `s`, then `a` — which is the same ordering rule as
	// the template create and its nested freeze, three deep instead of two.
	//
	// Until this split they were not a site of their own at all: the last of them
	// runs 39 characters into `renderableKey`, so `.$$kind)===` reached all three
	// and reported them as `node normalization`.
	{
		bucket: 'renderer pre-passes',
		probe: 'push(er(String(',
		where: 'main-renderer.ts TEMPLATE_ENV.t',
	},
	{
		bucket: 'renderer pre-passes',
		probe: 'push(...eo(',
		where: 'main-renderer.ts TEMPLATE_ENV.s',
	},
	{
		bucket: 'renderer pre-passes',
		probe: 'push(r)}});',
		where: 'main-renderer.ts TEMPLATE_ENV.a',
	},
	// The two functions `node normalization` folded. They are not one pass over
	// the tree: one normalizes a props argument into a prop bag, the other turns
	// a render result into first-screen nodes, and only the second recurses.
	{
		bucket: 'renderer pre-passes',
		probe: '[["spread",e]]',
		where: 'main-renderer.ts normalizeProps',
	},
	{
		bucket: 'renderer pre-passes',
		probe: '!1===e||!0===e',
		where: 'main-renderer.ts materialize',
	},
	{
		bucket: 'renderer pre-passes',
		probe: '"spread"===',
		where: 'main-renderer.ts prop bag builder',
	},
	// --- the adoption window (issue #215 D7) --------------------------------
	//
	// Everything above is reachable while the main thread paints. Everything
	// below runs after it, in the second window a profile cell now opens: the
	// background's commit arrives, is validated, prepared, compared against what
	// was painted, adopted, and handed over. None of it could be sampled before
	// this slice, so none of it carried a probe; all of it is the same code the
	// paint window already had no reason to enter.
	//
	// They sit here, at the end, for a reason that is checked rather than
	// assumed: `probeOf` returns the first match, so an entry appended after
	// every existing one cannot take a frame an existing one already named. A
	// discovery run bucketed all 96 frames it sampled twice, once against the
	// table as it stood and once against the table with these appended, and no
	// frame changed hands — 31 were named that had been unnamed, and nothing
	// else moved.
	{
		bucket: 'inbound validation',
		probe: '"commit.batch"',
		where: 'core/protocol.ts assertBatch',
	},
	{
		// `fail(label, 'must be an object.', …)` — the double quote and the comma
		// are what separate the transport's own asserts from the host driver's,
		// which spell the same words inside a template literal and end with a
		// backtick. Three sampled frames share it: the general `record`, the
		// per-command one `assertBatch` inlines with a constant label, and the
		// loop body that wraps it. All three are this bucket, so the reach is
		// between entries that agree rather than between buckets that do not.
		bucket: 'inbound validation',
		probe: 'must be an object.",',
		where: 'core/protocol.ts record and the assertBatch command loop',
	},
	{
		bucket: 'inbound validation',
		probe: 'is missing field ${JSON.stringify(',
		where: 'core/protocol.ts exactKeys',
	},
	{
		bucket: 'inbound validation',
		probe: 'validatedStaticProps',
		where: 'core/protocol.ts assertProps',
	},
	{
		// The trailing comma again, and for the same reason: the host driver
		// throws these words too, from a template, and `native-events.ts` has its
		// own already named above under `event bookkeeping`.
		bucket: 'inbound validation',
		probe: 'must be a positive safe integer.",',
		where: 'core/protocol.ts assertPositiveSafeInteger',
	},
	{
		bucket: 'inbound validation',
		probe: 'Octane Lynx transport ',
		where: 'core/protocol.ts fail',
	},
	{
		bucket: 'main-thread receive',
		probe: 'was already disposed.',
		where: 'main-thread.ts handleCommitExclusive',
	},
	// What the main thread computes so the background can learn what its handles
	// became: the public state of each one, the create/upsert deltas built from
	// it, and the list the ack carries. It is the largest thing in this window
	// that is neither validation nor preparation, and it is work the paint window
	// never does, because nothing has asked yet.
	{
		bucket: 'handle delta',
		probe: 'listDescendant:!1}',
		where: 'core/host-driver.ts getLynxHostPublicState',
	},
	{
		bucket: 'handle delta',
		probe: '{op:"create",handle:',
		where: 'core/host-driver.ts materializeHandleDelta',
	},
	{
		bucket: 'handle delta',
		probe: '{op:"upsert",id:',
		where: 'main-thread.ts publicHandleUpsert',
	},
	{
		bucket: 'handle delta',
		probe: '.handleDelta)',
		where: 'main-thread.ts the ack handle list',
	},
	{
		bucket: 'batch preparation',
		probe: 'cannot prepare a batch for a disposed root.',
		where: 'core/host-driver.ts prepareLynxHostBatch',
	},
	{
		bucket: 'batch preparation',
		probe: '"mount-template-range"!==',
		where: 'core/host-driver.ts prepareLynxHostBatch command loop',
	},
	{
		// The adoption filter itself: on `adopt` the loop runs only the
		// `ensure-public-instance` operations, because the rest of the tree is
		// already on screen. `compareFirstTree` names the same string, but with
		// `!==`, so the comparator cannot be reached from this probe.
		bucket: 'batch preparation',
		probe: '"ensure-public-instance"===',
		where: 'core/host-driver.ts prepareLynxHostBatch adoption replay',
	},
	{
		bucket: 'batch preparation',
		probe: '.portalChildren.keys()',
		where: 'core/host-driver.ts prepareLynxHostBatch portal pass',
	},
	{
		bucket: 'batch preparation',
		probe: 'for #text must contain a string value',
		where: 'core/host-driver.ts assertTextProps',
	},
	{
		bucket: 'batch preparation',
		probe: 'references unavailable host ',
		where: 'core/host-driver.ts nodeFor',
	},
	{
		bucket: 'batch preparation',
		probe: 'would create a cycle.',
		where: 'core/host-driver.ts assertNoCycle',
	},
	// The question D5 made answerable and D7 makes measurable: does the tree the
	// background described match the one the main thread painted. Both probes are
	// `compareFirstTree`'s own — the format check it opens with, and the node
	// path it composes seventeen times while walking. Nothing else in the bundle
	// spells either.
	{
		bucket: 'first-tree comparator',
		probe: '"snapshot.format"',
		where: 'core/host-driver.ts compareFirstTree',
	},
	{
		bucket: 'first-tree comparator',
		probe: 'snapshot.nodes[${',
		where: 'core/host-driver.ts compareFirstTree node walk',
	},
	{
		bucket: 'adoption apply',
		probe: 'cannot apply a batch while root cleanup',
		where: 'core/host-driver.ts prepared.apply(), both prepare paths',
	},
	{
		bucket: 'adoption apply',
		probe: '.logicalNodes.has(',
		where: 'core/host-driver.ts transferFirstTree',
	},
	{
		// D3's moved work, and the only bucket here that exists to be re-priced
		// rather than to account for a window. D3 stopped the mount writing a
		// journal entry per event site and left three accessors to answer from
		// the plan when something finally asks; this is what they cost when it
		// does. One probe names all three because they are one accounting line,
		// not three: `programNodeEvents` in the host driver, and
		// `programRunEventCount` and `programRunEventToken` in `first-screen.ts`.
		//
		// The semicolon is load-bearing. `.plan.events` also appears in the
		// renderer's announce pass and in `materializeProgramEvents`, which
		// continue `)` and `.length`; only the three accessors open a statement
		// with it. `programEventBindings`, which `programNodeEvents` calls, is
		// named by `event bookkeeping` above and is reached before this entry.
		bucket: 'deferred event journal',
		probe: '.plan.events;',
		where:
			'core/host-driver.ts programNodeEvents, core/first-screen.ts programRunEventCount and programRunEventToken',
	},
	// The by-ID lookups the comparator and the journal both address a run
	// through. Their own bucket rather than either caller's, because a total
	// folded into one of them would be a claim about who asked, and this
	// instrument cannot see that.
	{
		bucket: 'program index',
		probe: '.rangeIds.length;',
		where: 'core/first-screen.ts programRunNode',
	},
	{
		bucket: 'program index',
		probe: 'this.cursorLastId',
		where: 'core/first-screen.ts LynxDisjointProgramIndex.runFor',
	},
	{
		bucket: 'hand-over',
		probe: 'is malformed.',
		where: 'core/native-events.ts decodeLynxNativeEventToken',
	},
	// Not the framework: the profile build's own counter, injected by
	// `stages/instrument-source.mjs` and present in no shipping build. It is
	// named so that the part of a profile cell's window belonging to the
	// instrument is a row rather than a share of `unnamed`. The PAPI method
	// wrappers the same patch installs are not named — they are one-expression
	// closures with no literal of their own — so this row is a floor on the
	// instrument's cost, not its total, and the unnamed list shows the rest.
	{
		bucket: 'stage instrument',
		probe: '.papiCreateMs=',
		where: 'stages/instrument-source.mjs profilePapiCreate',
	},
]);

/**
 * The window a probe is matched against, in characters from a frame's own
 * position. Every probe above sits inside its own function's first 160
 * characters, which is what the window has to be wide enough for.
 *
 * It is *not* wide enough to be safe on its own, and an earlier version of this
 * comment claimed otherwise: it cited the applier's `visit` and `mountProgram`,
 * 258 characters apart, as the closest neighbouring pair in the bundle, and
 * concluded that 160 could not cross a function boundary. That was measured on
 * two functions rather than on the bundle, and the bundle is far denser. The
 * real spacing between sampled frames goes down to 27 characters — the PAPI
 * facade's `createPage` wrapper and the `createElement` type switch declared
 * next to it — and 39 characters between three `children.push` methods and the
 * key reader that follows them, with a 53-character pair between a template
 * render and the recursive freeze nested inside it, and a 67-character pair
 * between `assignIds` and `assignProgramIds` where the minifier inlines the
 * second into the first's comma sequence.
 *
 * So no window can carry the guarantee. What carries it is each probe being
 * text that appears in its own function and in no neighbour reachable from a
 * sampled frame, and the record printing every site's frame count and the
 * source at each frame, so a probe that does reach past its function shows up
 * as a site holding more than one function rather than as a clean number.
 *
 * Where that is impossible the table falls back on order, because `probeOf`
 * returns the first entry that matches: when one function's window necessarily
 * contains a neighbour's text — a nested function, or a run of one-line methods
 * declared back to back — the enclosing or earlier one is listed first, so each
 * frame is claimed by its own entry before a later entry can reach it. Several
 * runs in the table depend on this and say so where they sit: the plan
 * constructor before the validator it encloses, the render before the freeze
 * nested in it, the component thunk before the template env it abuts,
 * `TEMPLATE_ENV`'s `t`, `s`, `a` in source order, the assert before the encode
 * that calls it, and the `createPage` wrapper before the type switch declared
 * after it.
 * Order is the weaker tool — it is invisible at the call site and a reordering
 * edit silently breaks it — so it is used only where uniqueness cannot be had,
 * and every such run is a comment as well as a sequence.
 * Widening the window is still the worse failure — at 420 characters every
 * `visit` sample was credited to `mountProgram`, and the cell carrying no
 * compiled program at all reported the run's largest program-mount cost.
 */
export const PROBE_WINDOW = 160;

/**
 * The probe-table entry that names one frame, or `null` for a frame the table
 * does not name. `text` is the source at the frame's position.
 */
export function probeOf(text) {
	for (const entry of BUCKETS) {
		if (text.includes(entry.probe)) return entry;
	}
	return null;
}

/**
 * Bucket one frame. `text` is the source at the frame's position. A frame the
 * table does not name is `null`, which the caller reports rather than hides —
 * except for a frame the compiled program itself owns, which carries no
 * literal of its own and is named by its caller instead.
 */
export function bucketOf(text) {
	return probeOf(text)?.bucket ?? null;
}

/**
 * The site name given to the compiled program's create, which has no probe of
 * its own because it is emitted code. Spelled once here so the report and the
 * fold cannot disagree about it.
 */
export const COMPILED_CREATE_SITE = 'emitted main-thread program create';

/**
 * Every bucket's source sites, in probe order. Derived from the table rather
 * than restated beside it, so a probe added above cannot leave a report
 * describing a split that no longer holds.
 *
 * `compiled program create` is here too, carrying the one site the probe table
 * cannot: its frames are named by their caller, not by a literal of their own,
 * so without this entry the map would be missing a bucket the fold does
 * produce. A caller rendering only the buckets that fold several functions
 * filters on `length > 1`; a caller checking that the split accounts for
 * everything needs all of them.
 */
export const SITES_BY_BUCKET = Object.freeze(
	Object.fromEntries(
		[
			...BUCKETS.reduce((byBucket, entry) => {
				const seen = byBucket.get(entry.bucket) ?? [];
				if (!seen.includes(entry.where)) seen.push(entry.where);
				return byBucket.set(entry.bucket, seen);
			}, new Map()),
			['compiled program create', [COMPILED_CREATE_SITE]],
		].map(([bucket, sites]) => [bucket, Object.freeze(sites)]),
	),
);

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
 * than a create. That used to put the predicate's self time inside
 * `compiled program create`, overstating it by however much the predicate cost;
 * the predicate now carries a probe of its own, so the fallback reaches only
 * frames that really are emitted code.
 */
export function isProgramMountFrame(text) {
	return (
		text.includes('first-screen program binds an event on node ') ||
		text.includes('first-screen program node carries no plan')
	);
}

/**
 * Fold one CPU profile into `{buckets, sites, unmatched, samples}`, in
 * microseconds.
 *
 * Only frames in `scriptUrl` are counted: the page realm runs the harness's own
 * predicate walker, which is measurement rather than framework and would swamp
 * everything if it were folded in. `sourceAt(line, column)` returns the window
 * to match, so the caller owns how the script text was obtained.
 *
 * `sites` is the same time keyed by each probe's `where` rather than its
 * bucket. Several buckets fold more than one function, and a bucket that large
 * says where the script is without saying what it is doing, which is the
 * question an attribution slice has to answer next. Two probes sharing one `where` are two entrances to one
 * function, so keying by `where` folds them back together, which is what makes
 * a site total readable as a function's cost. The bucket totals are unchanged
 * by construction: every named frame lands in exactly one of each.
 *
 * A site cell also carries `positions`, the distinct frame positions folded
 * into it, because a `where` is a claim about the source and not a measurement
 * of it. A probe wide enough to match two neighbouring functions names both,
 * and the site then reads as one function's cost while holding several — the
 * same failure as an over-broad bucket, one level down. Counting the positions
 * puts that in the record instead of leaving it to a debugger, in the same
 * spirit as reporting `unmatched` rather than folding it away. A site over one
 * position is a probe to narrow, not a number to read as one function's.
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
	const sites = new Map();
	const unmatched = new Map();
	let samples = 0;
	const add = (map, key, us, hits) => {
		const cell = map.get(key) ?? { us: 0, hits: 0 };
		cell.us += us;
		cell.hits += hits;
		map.set(key, cell);
	};
	const addSite = (key, us, hits, frame) => {
		add(sites, key, us, hits);
		const cell = sites.get(key);
		(cell.positions ??= new Set()).add(`${frame.lineNumber}:${frame.columnNumber}`);
	};
	for (const [id, us] of selfUs) {
		const node = byId.get(id);
		if (node === undefined || node.callFrame.url !== scriptUrl) continue;
		samples += node.hitCount ?? 0;
		const frame = node.callFrame;
		const text = sourceAt(frame.lineNumber, frame.columnNumber);
		const entry = probeOf(text);
		if (entry !== null) {
			add(buckets, entry.bucket, us, node.hitCount ?? 0);
			addSite(entry.where, us, node.hitCount ?? 0, frame);
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
			addSite(COMPILED_CREATE_SITE, us, node.hitCount ?? 0, frame);
			continue;
		}
		add(unmatched, `${frame.lineNumber}:${frame.columnNumber}`, us, node.hitCount ?? 0);
	}
	return { buckets, sites, unmatched, samples };
}
