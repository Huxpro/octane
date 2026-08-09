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
 * Per-realm commit-pipeline counters. The background and main threads run in
 * separate realms, so each accumulates its own record under the same global
 * name: background fills the dispatch-side fields, main the receive-side ones.
 * Milliseconds are informational (host-bound); `commits`, `commands`, and
 * `bytes` are deterministic for a fixed app and interaction sequence.
 */
export interface LynxWireProfile {
	/** Commit messages dispatched (background) or applied (main). */
	commits: number;
	/**
	 * Background only: dispatched commits carrying `pace: true`. Each of these
	 * asks main for a frame-pulse and therefore consumes one main-thread frame;
	 * empty-batch commits cross unpaced and are excluded. Deterministic for a
	 * fixed app and interaction, so benchmarks/lynx-table gates "at most one
	 * frame-consuming commit per frame" on it.
	 */
	pacedCommits: number;
	/** Host commands across those commits. */
	commands: number;
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
	/**
	 * Main: the development-only validation share of `prepareMs` — the final
	 * whole-tree check pass (lynx-perf #6). Production builds compile those
	 * checks out, so this stays 0 there; `prepareMs - prepareCheckMs` is the
	 * staging cost both builds share.
	 */
	prepareCheckMs: number;
	/** Main: prepared.apply() time, including the Element PAPI flush. */
	applyMs: number;
	/** Main: acknowledgement handle computation + dispatch time. */
	ackMs: number;
}

interface LynxProfileGlobals {
	__OCTANE_LYNX_PROF?: LynxWireProfile;
}

/** The realm's counter record, created on first use. */
export function lynxWireProfile(): LynxWireProfile {
	const globals = globalThis as LynxProfileGlobals;
	return (globals.__OCTANE_LYNX_PROF ??= {
		commits: 0,
		pacedCommits: 0,
		commands: 0,
		bytes: 0,
		selfcheckMs: 0,
		dispatchMs: 0,
		validateMs: 0,
		prepareMs: 0,
		prepareCheckMs: 0,
		applyMs: 0,
		ackMs: 0,
	});
}

/** Count one outbound message; commits also add commands and JSON bytes. */
export function profileOutboundMessage(profile: LynxWireProfile, message: unknown): void {
	const record = message as {
		type?: unknown;
		pace?: unknown;
		batch?: { commands?: readonly unknown[] };
	};
	if (record.type !== 'commit') return;
	profile.commits += 1;
	if (record.pace === true) profile.pacedCommits += 1;
	profile.commands += record.batch?.commands?.length ?? 0;
	try {
		profile.bytes += JSON.stringify(message).length;
	} catch {
		// Wire messages are serializable by contract; a failure here must not
		// turn a measurement run into a commit failure.
	}
}
