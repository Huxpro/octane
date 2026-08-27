// Build-flag-gated wire-cost counters for the dual-thread commit pipeline.
//
// The Lynx transport's dominant costs are proportional to the serialized
// command stream: the background self-check and structured clone, and the
// main-thread validate/prepare/apply/acknowledge stages. Wall-clock timing of
// those stages is host-bound, but the command count and serialized byte size
// of each commit are deterministic for a fixed app and interaction, which
// makes them gateable (see benchmarks/lynx-table). This module is the one
// permanent home for those counters so measurement never needs an ad-hoc
// patch.
//
// `__OCTANE_LYNX_PROFILE__` is substituted by the build (Rspeedy/Rspack/Vite
// `define`, see benchmarks/lynx-table). Production bundles that do not define
// it fold `LYNX_PROFILE` to false and every guarded branch disappears; the
// hot dispatch/receive paths pay nothing. Node-hosted source tests keep the
// `typeof` guard, which reads as disabled.
declare const __OCTANE_LYNX_PROFILE__: boolean | undefined;

export const LYNX_PROFILE: boolean =
	typeof __OCTANE_LYNX_PROFILE__ !== 'undefined' && __OCTANE_LYNX_PROFILE__ === true;

/**
 * The phases of a synchronous first screen, in the order `renderFirstScreenNow`
 * runs them. `render` is the only one that never crosses the host boundary:
 * `renderLynxFirstScreen` takes no PAPI at all, so its whole cost is framework
 * script by construction rather than by subtraction.
 */
export type LynxFirstScreenPhase = 'render' | 'publish' | 'capture' | 'announce';

/**
 * What adoption did with a painted first screen, mirroring
 * `LynxPreparedHostBatch['firstTreeAction']`. Restated here rather than
 * imported because this module is the one thing every realm loads and it owes
 * nothing to the host driver, and because the assignment in `main-thread.ts` is
 * what type-checks the two spellings against each other: a member added there
 * and not here fails at the publish site.
 */
export type LynxFirstTreeAction = 'none' | 'adopt' | 'repair';

/**
 * Per-realm commit-pipeline counters. The background and main threads run in
 * separate realms, so each accumulates its own record under the same global
 * name: background fills the dispatch-side fields, main the receive-side ones.
 * Milliseconds are informational (host-bound); `commits`, `commands`, and
 * `bytes` are deterministic for a fixed app and interaction sequence.
 */
export interface LynxWireProfile {
	/** Commit messages dispatched (background) or applied (main). */
	commits: number;
	/** Host commands across those commits. */
	commands: number;
	/**
	 * Commits that carried no host command at all. `commits` on its own cannot
	 * tell one large batch split into chunks from a stream that ran a render pass
	 * per state change and found nothing to say — both read as "more commits than
	 * changes", and they are opposite facts about a core. Separating them is what
	 * makes a storm's commit count readable.
	 */
	emptyCommits: number;
	/** Serialized commit size, as JSON bytes — a structured-clone-cost proxy. */
	bytes: number;
	/** Background: dev-mode outbound self-check time. */
	selfcheckMs: number;
	/** Background: ContextProxy dispatch (structured clone + delivery) time. */
	dispatchMs: number;
	/** Main: inbound protocol validation time. */
	validateMs: number;
	/** Main: prepareLynxHostBatch staging time. */
	prepareMs: number;
	/** Main: prepared.apply() time, including the Element PAPI flush. */
	applyMs: number;
	/** Main: acknowledgement handle computation + dispatch time. */
	ackMs: number;
	/** Profiling-only shadow commits fully expressible by the typed delta ABI. */
	deltaCommits: number;
	/** Profiling-only shadow commits that still require the command ABI. */
	deltaMisses: number;
	/** Typed delta operations produced by expressible shadow commits. */
	deltaOps: number;
	/** Encoded typed-delta JSON bytes, excluding the unchanged transport envelope. */
	deltaBytes: number;
	/**
	 * Main: the first-screen phase currently running, or null outside one.
	 *
	 * This is the only counter here that is published for something else to read
	 * rather than accumulated for a report. A host-boundary instrument that wraps
	 * the Element PAPI sees every call but not which part of the first screen
	 * issued it, and the first screen is one uninterrupted synchronous run, so
	 * there is no other moment at which the two can be joined. Reading this marker
	 * at call time is what lets such an instrument attribute host time to a phase.
	 * The direction matters: the framework publishes, and never reads back.
	 */
	firstScreenPhase: LynxFirstScreenPhase | null;
	/**
	 * Main: wall time inside each first-screen phase. The first screen runs once
	 * per root and goes through none of the commit stages above — it is
	 * `renderFirstScreenNow`, not a commit — so these are the only counters that
	 * describe it at all.
	 */
	firstScreenRenderMs: number;
	firstScreenPublishMs: number;
	firstScreenCaptureMs: number;
	firstScreenAnnounceMs: number;
	/**
	 * Main: what the comparator decided for the first-tree commit, or null until
	 * one has been prepared.
	 *
	 * Published for something else to read, like `firstScreenPhase` and for the
	 * same reason one step later (issue #215 D7). A first screen the main thread
	 * painted is either adopted by the background that describes it or repaired
	 * over the command path, and the two cost wildly different things while
	 * looking identical from outside: both end with a correct page. An
	 * instrument measuring the window after paint without reading this would
	 * report a repaint as an adoption and never know.
	 */
	firstTreeAction: LynxFirstTreeAction | null;
	/**
	 * Main: 1 once the first-tree lifecycle has ended, and 0 before that.
	 *
	 * The end is not one moment for every outcome: an adoption ends at
	 * hand-over, a repair or a run that carried no first tree at all ends with
	 * the commit that decided so. This is the single answer to "is any of it
	 * still coming", which is what a window that has to close on it needs, and
	 * it is deliberately not a wall clock — a profiler owns the milliseconds.
	 */
	firstTreeSettled: number;
	/**
	 * Main: hand-over time — draining the events the adoption gated, releasing
	 * the first-screen journal, and reopening background calls. The counterpart
	 * to `prepareMs` and `applyMs` for the half of adoption that runs a message
	 * later, and 0 for a run that never adopted.
	 */
	handOverMs: number;
}

interface LynxProfileGlobals {
	__OCTANE_LYNX_PROF?: LynxWireProfile;
}

/** The realm's counter record, created on first use. */
export function lynxWireProfile(): LynxWireProfile {
	const globals = globalThis as LynxProfileGlobals;
	return (globals.__OCTANE_LYNX_PROF ??= {
		commits: 0,
		commands: 0,
		emptyCommits: 0,
		bytes: 0,
		selfcheckMs: 0,
		dispatchMs: 0,
		validateMs: 0,
		prepareMs: 0,
		applyMs: 0,
		ackMs: 0,
		deltaCommits: 0,
		deltaMisses: 0,
		deltaOps: 0,
		deltaBytes: 0,
		firstScreenPhase: null,
		firstScreenRenderMs: 0,
		firstScreenPublishMs: 0,
		firstScreenCaptureMs: 0,
		firstScreenAnnounceMs: 0,
		firstTreeAction: null,
		firstTreeSettled: 0,
		handOverMs: 0,
	});
}

/** Count one outbound message; commits also add commands and JSON bytes. */
export function profileOutboundMessage(profile: LynxWireProfile, message: unknown): void {
	const record = message as { type?: unknown; batch?: { commands?: readonly unknown[] } };
	if (record.type !== 'commit') return;
	profile.commits += 1;
	if ((record.batch?.commands?.length ?? 0) === 0) profile.emptyCommits += 1;
	profile.commands += record.batch?.commands?.length ?? 0;
	try {
		profile.bytes += JSON.stringify(message).length;
	} catch {
		// Wire messages are serializable by contract; a failure here must not
		// turn a measurement run into a commit failure.
	}
}

/**
 * Close the first-screen phase that is open and start `phase`; `null` ends the
 * sequence.
 *
 * One statement between existing statements, rather than a wrapper that takes
 * the phase body as a callback. `renderFirstScreenNow` returns early when a
 * rendered tree turns out to be unadoptable, and settles the source through a
 * `catch` and a `finally` when it faults — control flow the first screen's own
 * cleanup contract depends on, and which threading four closures through it
 * would rewrite. Marking is not allowed to be the reason any of that changes.
 *
 * Closing on `null` from a `finally` is what keeps a faulted or declined first
 * screen from leaving a phase open for whatever runs next in the realm.
 */
export function markFirstScreenPhase(phase: LynxFirstScreenPhase | null): void {
	if (!LYNX_PROFILE) return;
	const profile = lynxWireProfile();
	const now = performance.now();
	const open = profile.firstScreenPhase;
	if (open !== null) {
		const elapsed = now - firstScreenPhaseStart;
		if (open === 'render') profile.firstScreenRenderMs += elapsed;
		else if (open === 'publish') profile.firstScreenPublishMs += elapsed;
		else if (open === 'capture') profile.firstScreenCaptureMs += elapsed;
		else profile.firstScreenAnnounceMs += elapsed;
	}
	profile.firstScreenPhase = phase;
	firstScreenPhaseStart = now;
}

// Realm-local, not a profile field: the open phase's start is scratch for the
// next `markFirstScreenPhase` call, where every field on the record is either
// accumulated across the run or published for an instrument to read.
let firstScreenPhaseStart = 0;
