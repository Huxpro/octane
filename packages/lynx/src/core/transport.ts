import {
	UNIVERSAL_TRANSPORT_PROTOCOL_VERSION,
	type UniversalAsyncCommitTransport,
	type UniversalAsyncPreparedHostBatch,
	type UniversalHostBatch,
	type UniversalPlan,
	type UniversalRoot,
	type UniversalTransportAcknowledgement,
	type UniversalEventPriority,
	type UniversalTransportEventDelivery,
	type UniversalTransportIdentity,
	type UniversalSerializableValue,
} from 'octane/universal/native';
import { LYNX_PROFILE, lynxWireProfile, profileOutboundMessage } from './profiling.js';
import {
	applyLynxHostAttachments,
	invalidateLynxClientContainer,
	isLynxClientEventTarget,
	prepareLynxHandleDeltas,
	type LynxClientContainer,
} from './client-driver.js';
import {
	LYNX_BACKGROUND_TO_MAIN_EVENT,
	LYNX_MAIN_TO_BACKGROUND_EVENT,
	LYNX_READY_ANNOUNCEMENT_REQUEST,
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	sameLynxTransportIdentity,
	selfCheckLynxBackgroundOutboundMessage,
	validateLynxBackgroundInboundMessage,
	validateLynxBackgroundOutboundMessage,
	type LynxBackgroundInboundMessage,
	type LynxBackgroundFunctionWireDescriptor,
	type LynxCallBackgroundMessage,
	type LynxCallMainErrorMessage,
	type LynxCallMainResultMessage,
	type LynxContextProxy,
	type LynxContextProxyEvent,
	type LynxCommitWireMessage,
	type LynxDisposeAcknowledgement,
	type LynxDisposeRetryMessage,
	type LynxFramePulseMessage,
	type LynxHostAttachmentMessage,
	type LynxHostFaultMessage,
	type LynxMainReadyReply,
	type LynxMainReadyRequest,
	type LynxMainThreadWorkletWireDescriptor,
	type LynxTransportAcknowledgement,
} from './protocol.js';
import type { LynxBackgroundNativeEventDelivery } from './native-event-receiver.js';
import { foldLynxPlanInstances, isLynxPlanInstanceEligible } from './plan-wire.js';
import {
	isLynxMainThreadWorkletDescriptor,
	isolateLynxWorkletValue,
	type LynxWorkletValue,
} from './worklets.js';

export interface LynxBackgroundTransportOptions {
	readonly onDiagnostic?: (error: Error) => void;
	/**
	 * Commit dispatch pacing toward the main thread. `frame` (the default) sends
	 * at most one commit per main-thread frame: the first commit after idle
	 * dispatches immediately, and a commit prepared before the previous one's
	 * frame ended is held until main's `frame-pulse` answers that apply. Renders
	 * scheduled while a commit is held keep folding through the existing
	 * awaiting-acknowledgement contract, so held time turns into batching, never
	 * extra intermediate commits. Empty-command batches always cross unpaced —
	 * they mutate nothing on main and must not spend frames. `immediate`
	 * restores unpaced dispatch; hosts with no frame source behave as
	 * `immediate` because main answers paced commits synchronously.
	 */
	readonly commitPacing?: 'immediate' | 'frame';
	/** Page-lifetime tombstone checked after receiver attachment and before readiness. */
	readonly isPageDestroyed?: () => boolean;
	/** Transactionally bind renderer-local worklet handles at the complete-batch boundary. */
	readonly prepareWorkletBatch?: (batch: UniversalHostBatch) => UniversalHostBatch;
	/** Release or publish background execution lifetimes at the host acceptance boundary. */
	readonly onWorkletBatchAccepted?: (batch: UniversalHostBatch) => void;
	readonly onWorkletBatchRejected?: (batch: UniversalHostBatch) => void;
	readonly executeBackgroundFunction?: (
		fn: LynxBackgroundFunctionWireDescriptor,
		args: readonly UniversalSerializableValue[],
	) => unknown;
}

export interface LynxThreadCall<Result = UniversalSerializableValue> {
	readonly promise: Promise<Result>;
	cancel(reason?: unknown): void;
}

export interface LynxBackgroundTransport extends UniversalAsyncCommitTransport<LynxClientContainer> {
	readonly mode: 'async';
	readonly ready: Promise<void>;
	bindRoot(root: Pick<UniversalRoot, 'dispatchTransportEvent'>): void;
	/** Deliver one native propagation path received on the background thread. */
	dispatchNativeEventBatch(deliveries: readonly LynxBackgroundNativeEventDelivery[]): void;
	/** Bind logical background cleanup to the native page lifetime broadcast. */
	bindPageDestroy(handler: () => void | Promise<void>): void;
	acceptedIdentity(): UniversalTransportIdentity | null;
	/**
	 * Root this transport serves, known from its first commit — before any
	 * acknowledgement, and therefore before main can install a native token.
	 */
	ownedRoot(): number | null;
	/** Cancel commits that have not crossed the readiness/send boundary. */
	cancelPendingBeforeReady(reason?: unknown): Promise<boolean>;
	/** Internal facade state used to classify teardown without probing the host. */
	preparationCount(): number;
	closedReason(): Error | null;
	enableLogicalTeardown(): void;
	dispose(): Promise<void>;
	callMain(
		worklet: LynxMainThreadWorkletWireDescriptor,
		args: readonly UniversalSerializableValue[],
	): LynxThreadCall;
	close(reason?: unknown): void;
	diagnostics(): readonly Error[];
}

interface Deferred<T> {
	readonly promise: Promise<T>;
	readonly settled: boolean;
	resolve(value: T): void;
	reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
	let resolvePromise!: (value: T) => void;
	let rejectPromise!: (error: unknown) => void;
	let settled = false;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		get settled() {
			return settled;
		},
		resolve(value) {
			if (settled) return;
			settled = true;
			resolvePromise(value);
		},
		reject(error) {
			if (settled) return;
			settled = true;
			rejectPromise(error);
		},
	};
}

interface PreparedTokenState {
	status: 'prepared' | 'applying' | 'settled' | 'aborted';
	entry: PendingCommit | null;
}

interface PendingCommit {
	readonly identity: UniversalTransportIdentity;
	readonly batch: UniversalHostBatch;
	readonly acknowledge: (message: UniversalTransportAcknowledgement) => void;
	readonly deferred: Deferred<void>;
	readonly token: PreparedTokenState;
	state: 'waiting-ready' | 'sent' | 'acknowledged';
	abortRequested: boolean;
	deferredResponse: CommitSettlement | null;
}

type CommitSettlement = Extract<
	LynxBackgroundInboundMessage,
	{ readonly type: 'complete' | 'reject' | 'fault' }
>;

interface PendingMainThreadCall {
	readonly call: number;
	readonly worklet: LynxMainThreadWorkletWireDescriptor;
	readonly args: readonly UniversalSerializableValue[];
	readonly deferred: Deferred<UniversalSerializableValue>;
	identity: UniversalTransportIdentity | null;
	state: 'queued' | 'sent';
}

interface RunningBackgroundCall {
	readonly identity: UniversalTransportIdentity;
	cancelled: boolean;
}

let NEXT_READY_REQUEST = 1;
const MAX_DISPOSE_ATTEMPTS = 3;
const MAX_QUEUED_THREAD_CALLS = 128;
/**
 * Liveness valve for a held paced commit. Main's frame source can stall
 * entirely (a hidden Lynx-for-Web page throttles rAF to nothing), and a
 * commit held forever would freeze acknowledgement-driven effects, so a held
 * dispatch force-opens after ~4 frames even if no pulse arrives. The valve
 * never fires in the steady state: a live frame source answers within one
 * frame.
 */
const PACE_SAFETY_MS = 64;

function isRootIndependentDataMessage(value: unknown): boolean {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
		return (
			descriptor !== undefined &&
			Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
			(descriptor.value === 'page-data' || descriptor.value === 'global-props')
		);
	} catch {
		return false;
	}
}

function errorFrom(value: unknown, fallback: string): Error {
	if (value instanceof Error) return value;
	return new Error(value === undefined ? fallback : String(value));
}

function remoteError(error: { readonly name: string; readonly message: string }): Error {
	const result = new Error(error.message);
	result.name = error.name;
	return result;
}

function frozenIdentity(identity: UniversalTransportIdentity): UniversalTransportIdentity {
	return Object.freeze({
		protocol: identity.protocol,
		renderer: identity.renderer,
		root: identity.root,
		version: identity.version,
	});
}

function isLogicalTeardownBatch(batch: UniversalHostBatch): boolean {
	if (batch.commands.length === 0) return false;
	for (const command of batch.commands) {
		if (command.op === 'remove' || command.op === 'destroy') continue;
		if (
			(command.op === 'event' || command.op === 'lifecycle' || command.op === 'local-callback') &&
			command.listener === null
		) {
			continue;
		}
		return false;
	}
	return true;
}

export function createLynxBackgroundTransport(
	context: LynxContextProxy,
	container: LynxClientContainer,
	options: LynxBackgroundTransportOptions = {},
): LynxBackgroundTransport {
	if (UNIVERSAL_TRANSPORT_PROTOCOL_VERSION !== LYNX_TRANSPORT_PROTOCOL_VERSION) {
		throw new Error('Octane Lynx transport protocol does not match the universal runtime.');
	}
	if (
		context === null ||
		typeof context !== 'object' ||
		typeof context.dispatchEvent !== 'function' ||
		typeof context.addEventListener !== 'function' ||
		typeof context.removeEventListener !== 'function'
	) {
		throw new TypeError(
			'Octane Lynx background transport requires ContextProxy dispatchEvent/addEventListener/removeEventListener.',
		);
	}
	if (container.renderer !== LYNX_TRANSPORT_RENDERER) {
		throw new Error('Octane Lynx background transport received a foreign client container.');
	}
	if (
		options.commitPacing !== undefined &&
		options.commitPacing !== 'immediate' &&
		options.commitPacing !== 'frame'
	) {
		throw new TypeError('Octane Lynx commitPacing must be "immediate" or "frame".');
	}
	const commitPacing = options.commitPacing ?? 'frame';

	const reported: Error[] = [];
	const pending = new Map<number, PendingCommit>();
	const pendingMainCalls = new Map<number, PendingMainThreadCall>();
	const runningBackgroundCalls = new Map<number, RunningBackgroundCall>();
	const readyRequest = NEXT_READY_REQUEST++;
	const readinessRequest: LynxMainReadyRequest = Object.freeze({
		protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
		renderer: LYNX_TRANSPORT_RENDERER,
		type: 'main-ready-request',
		request: readyRequest,
	});
	const readyDeferred = createDeferred<void>();
	// A transport can be synchronously closed before a root observes `ready`.
	void readyDeferred.promise.catch(() => {});
	// Plan IDs main announced from its registry (in the ready reply, then via
	// plan-registry messages as lazy chunks register more). Folding is limited
	// to this set, so registry skew degrades to per-node commands.
	const announcedPlans = new Map<string, string>();
	const isPlanAnnounced = (planId: string, canonical: string): boolean =>
		announcedPlans.get(planId) === canonical;
	// Two acceptance watermarks (protocol 2). `accepted` is what this thread and
	// its root have accepted, including zero-command batches settled locally
	// without crossing the wire; the root stamps and validates against it.
	// `mainAccepted` is the newest batch main actually applied — the only
	// versions main can stamp on the messages it originates (events, host
	// attachments, host faults) or accept on the calls this thread sends it.
	// Elision never lets `mainAccepted` pass `accepted`, so
	// mainAccepted.version <= accepted.version always holds.
	let accepted: UniversalTransportIdentity | null = null;
	let mainAccepted: UniversalTransportIdentity | null = null;
	let boundRoot: Pick<UniversalRoot, 'dispatchTransportEvent'> | null = null;
	let closedError: Error | null = null;
	let transportRoot: number | null = null;
	let readyReceived = false;
	let readinessRetrySent = false;
	let disposeDeferred: Deferred<void> | null = null;
	let disposeIdentity: UniversalTransportIdentity | null = null;
	let disposeAttempts = 0;
	let disposeRetryQueued = false;
	let dispatchingCommit: PendingCommit | null = null;
	let terminalDisposeIdentity: UniversalTransportIdentity | null = null;
	let terminalDisposeAttempts = 0;
	let terminalDisposeRetryQueued = false;
	let receiverAttached = false;
	let publishingAcknowledgement = false;
	let drainingMainThreadCalls = false;
	let mainThreadCallsNeedDrain = false;
	let preparationCount = 0;
	let logicalTeardownEnabled = false;
	let nextThreadCall = 1;
	let lastBackgroundCall = 0;
	let pageDestroyReceived = false;
	let pageDestroyHandler: (() => void | Promise<void>) | null = null;
	let pageDestroyHandlerInvoked = false;
	// The version whose main-thread frame has not yet ended. Non-null closes the
	// dispatch gate; main's frame-pulse for that version (or the safety valve)
	// reopens it. One commit is in flight at a time, so at most one release is
	// ever held, but releases re-queue themselves, so this stays a list.
	let paceGateVersion: number | null = null;
	let paceWaiters: (() => void)[] = [];
	let paceSafetyTimer: ReturnType<typeof setTimeout> | null = null;
	const finalizedWorkletBatches = new WeakSet<object>();

	const report = (error: unknown, fallback = 'Octane Lynx transport protocol error.') => {
		const normalized = errorFrom(error, fallback);
		reported.push(normalized);
		try {
			options.onDiagnostic?.(normalized);
		} catch (diagnosticError) {
			reported.push(errorFrom(diagnosticError, 'Octane Lynx diagnostic callback failed.'));
		}
		return normalized;
	};

	const finalizeWorkletBatch = (batch: UniversalHostBatch, acceptedByHost: boolean): void => {
		if (finalizedWorkletBatches.has(batch)) return;
		finalizedWorkletBatches.add(batch);
		try {
			(acceptedByHost ? options.onWorkletBatchAccepted : options.onWorkletBatchRejected)?.(batch);
		} catch (error) {
			report(error, 'Octane Lynx could not finalize background worklet lifetimes.');
		}
	};

	const dispatch = (message: Parameters<typeof validateLynxBackgroundOutboundMessage>[0]) => {
		if (closedError !== null) throw closedError;
		if (LYNX_PROFILE) {
			const profile = lynxWireProfile();
			const startedSelfCheck = performance.now();
			const validated = selfCheckLynxBackgroundOutboundMessage(message);
			const startedDispatch = performance.now();
			context.dispatchEvent({ type: LYNX_BACKGROUND_TO_MAIN_EVENT, data: validated });
			profile.dispatchMs += performance.now() - startedDispatch;
			profile.selfcheckMs += startedDispatch - startedSelfCheck;
			profileOutboundMessage(profile, message);
			return;
		}
		const validated = selfCheckLynxBackgroundOutboundMessage(message);
		context.dispatchEvent({ type: LYNX_BACKGROUND_TO_MAIN_EVENT, data: validated });
	};

	const wireError = (value: unknown, fallback: string) => {
		const error = errorFrom(value, fallback);
		return Object.freeze({
			name: error.name.length === 0 ? 'Error' : error.name,
			message: error.message,
		});
	};

	const callIdentityMatches = (
		identity: UniversalTransportIdentity | null,
		message: UniversalTransportIdentity,
	): boolean => identity !== null && sameLynxTransportIdentity(identity, message);

	const sendMainThreadCall = (entry: PendingMainThreadCall): void => {
		// Stamp the newest version main has applied: an identity from a locally
		// settled batch would read as foreign on main.
		if (mainAccepted === null || entry.state !== 'queued') return;
		entry.identity = frozenIdentity(mainAccepted);
		entry.state = 'sent';
		try {
			dispatch({
				...entry.identity,
				type: 'call-main',
				call: entry.call,
				worklet: entry.worklet,
				args: entry.args,
			});
		} catch (error) {
			// ContextProxy delivery may settle synchronously before dispatchEvent throws.
			// First settlement wins; never overwrite that result with the delivery error.
			if (pendingMainCalls.get(entry.call) !== entry) return;
			pendingMainCalls.delete(entry.call);
			entry.deferred.reject(report(error, 'Octane Lynx could not deliver a main-thread call.'));
		}
	};

	const drainMainThreadCalls = (): void => {
		if (
			mainAccepted === null ||
			closedError !== null ||
			publishingAcknowledgement ||
			drainingMainThreadCalls ||
			!mainThreadCallsNeedDrain
		) {
			return;
		}
		drainingMainThreadCalls = true;
		try {
			// Map iterators preserve insertion order and include entries appended while
			// dispatch synchronously re-enters the background thread. Keeping one drain
			// active therefore prevents a newer call from overtaking queued lower IDs.
			for (const entry of pendingMainCalls.values()) {
				if (entry.state === 'queued') sendMainThreadCall(entry);
			}
			mainThreadCallsNeedDrain = false;
		} finally {
			drainingMainThreadCalls = false;
		}
	};

	const settleMainThreadCall = (
		message: LynxCallMainResultMessage | LynxCallMainErrorMessage,
	): void => {
		const entry = pendingMainCalls.get(message.call);
		if (entry === undefined) {
			report(
				new Error(
					`Octane Lynx received a late or duplicate main-thread call result ${message.call}.`,
				),
			);
			return;
		}
		if (!callIdentityMatches(entry.identity, message)) {
			report(
				new Error(
					`Octane Lynx received a stale or foreign main-thread call result ${message.call}.`,
				),
			);
			return;
		}
		pendingMainCalls.delete(message.call);
		if (message.type === 'call-main-result') {
			try {
				entry.deferred.resolve(
					isolateLynxWorkletValue(
						message.value as LynxWorkletValue,
						'main-thread call result',
					) as UniversalSerializableValue,
				);
			} catch (error) {
				entry.deferred.reject(report(error, 'Octane Lynx received an invalid main-thread result.'));
			}
		} else entry.deferred.reject(remoteError(message.error));
	};

	const dispatchBackgroundCallError = (
		message: LynxCallBackgroundMessage,
		error: unknown,
	): void => {
		try {
			dispatch({
				...frozenIdentity(message),
				type: 'call-background-error',
				call: message.call,
				error: wireError(error, 'Octane Lynx background function failed.'),
			});
		} catch (dispatchError) {
			report(dispatchError, 'Octane Lynx could not deliver a background call error.');
		}
	};

	const handleBackgroundCall = (message: LynxCallBackgroundMessage): void => {
		if (
			accepted === null ||
			message.root !== accepted.root ||
			message.version > accepted.version ||
			transportRoot !== message.root
		) {
			report(new Error(`Octane Lynx received a stale or foreign background call ${message.call}.`));
			dispatchBackgroundCallError(message, new Error('Octane Lynx background call is stale.'));
			return;
		}
		// The main side allocates call IDs monotonically and ContextProxy preserves
		// sender order. A scalar high-water mark rejects in-flight and settled
		// replays while keeping transport memory bounded for long-lived roots.
		if (message.call <= lastBackgroundCall) {
			report(new Error(`Octane Lynx received duplicate background call ${message.call}.`));
			return;
		}
		lastBackgroundCall = message.call;
		const running: RunningBackgroundCall = {
			identity: frozenIdentity(message),
			cancelled: false,
		};
		runningBackgroundCalls.set(message.call, running);
		let result: unknown;
		try {
			if (options.executeBackgroundFunction === undefined) {
				throw new Error('Octane Lynx has no background function registry installed.');
			}
			result = options.executeBackgroundFunction(message.fn, message.args);
		} catch (error) {
			runningBackgroundCalls.delete(message.call);
			dispatchBackgroundCallError(message, error);
			return;
		}
		void Promise.resolve(result).then(
			(value) => {
				if (
					runningBackgroundCalls.get(message.call) !== running ||
					running.cancelled ||
					closedError !== null
				) {
					return;
				}
				runningBackgroundCalls.delete(message.call);
				try {
					const isolated = isolateLynxWorkletValue(
						value as LynxWorkletValue,
						'background call result',
					);
					dispatch({
						...running.identity,
						type: 'call-background-result',
						call: message.call,
						value: isolated as UniversalSerializableValue,
					});
				} catch (error) {
					dispatchBackgroundCallError(message, error);
				}
			},
			(error) => {
				if (
					runningBackgroundCalls.get(message.call) !== running ||
					running.cancelled ||
					closedError !== null
				) {
					return;
				}
				runningBackgroundCalls.delete(message.call);
				dispatchBackgroundCallError(message, error);
			},
		);
	};

	const openPaceGate = (): void => {
		if (paceSafetyTimer !== null) {
			clearTimeout(paceSafetyTimer);
			paceSafetyTimer = null;
		}
		if (paceGateVersion === null) return;
		paceGateVersion = null;
		if (paceWaiters.length === 0) return;
		const released = paceWaiters;
		paceWaiters = [];
		// The first live release dispatches and closes the gate again; any release
		// that finds the gate closed re-holds itself.
		for (const release of released) release();
	};

	const holdForPaceGate = (release: () => void): void => {
		paceWaiters.push(release);
		if (paceSafetyTimer !== null || typeof setTimeout !== 'function') return;
		paceSafetyTimer = setTimeout(() => {
			paceSafetyTimer = null;
			openPaceGate();
		}, PACE_SAFETY_MS);
	};

	const handleFramePulse = (message: LynxFramePulseMessage): void => {
		// A pulse answers the apply of a specific paced commit. One for an older
		// version can trail in after the safety valve already opened the gate and
		// a newer commit dispatched; the newer commit's frame has not ended, so
		// that pulse must not open its gate.
		if (
			paceGateVersion === null ||
			transportRoot === null ||
			message.root !== transportRoot ||
			message.version < paceGateVersion
		) {
			return;
		}
		openPaceGate();
	};

	const closeEntry = (entry: PendingCommit, error: unknown) => {
		if (pending.get(entry.identity.version) !== entry) return;
		pending.delete(entry.identity.version);
		if (entry.state !== 'acknowledged') finalizeWorkletBatch(entry.batch, false);
		entry.token.entry = null;
		entry.token.status = 'settled';
		entry.deferred.reject(error);
	};

	const completeEntry = (entry: PendingCommit) => {
		if (pending.get(entry.identity.version) !== entry) return;
		pending.delete(entry.identity.version);
		entry.token.entry = null;
		entry.token.status = 'settled';
		entry.deferred.resolve(undefined);
	};

	const entryFor = (message: UniversalTransportIdentity, label: string): PendingCommit | null => {
		const entry = pending.get(message.version);
		if (entry === undefined) {
			report(
				new Error(`Octane Lynx transport received late or duplicate ${label} ${message.version}.`),
			);
			return null;
		}
		if (!sameLynxTransportIdentity(entry.identity, message)) {
			report(
				new Error(`Octane Lynx transport received stale or foreign ${label} ${message.version}.`),
			);
			return null;
		}
		return entry;
	};

	const detachReceiver = (): void => {
		if (!receiverAttached) return;
		receiverAttached = false;
		try {
			context.removeEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, receive);
		} catch (removeError) {
			report(removeError, 'Octane Lynx failed to remove its transport listener.');
		}
	};

	const closeThreadCalls = (error: Error, notifyMain = true): void => {
		for (const entry of [...pendingMainCalls.values()]) {
			pendingMainCalls.delete(entry.call);
			if (notifyMain && entry.state === 'sent' && entry.identity !== null) {
				try {
					dispatch({ ...entry.identity, type: 'cancel-main', call: entry.call });
				} catch (cancelError) {
					report(cancelError, 'Octane Lynx could not cancel a closing main-thread call.');
				}
			}
			entry.deferred.reject(error);
		}
		for (const running of runningBackgroundCalls.values()) running.cancelled = true;
		runningBackgroundCalls.clear();
	};

	const closeClientState = (
		error: Error,
		preserveDisposeResolution: boolean,
		notifyMain = true,
	): boolean => {
		if (closedError !== null) return false;
		closeThreadCalls(error, notifyMain);
		// Nothing will acknowledge a held native event once the transport closes.
		dropDeferredNativeEvents();
		// Held paced dispatches settle through their pending entries below; the
		// gate state itself must not outlive the transport.
		if (paceSafetyTimer !== null) {
			clearTimeout(paceSafetyTimer);
			paceSafetyTimer = null;
		}
		paceGateVersion = null;
		paceWaiters = [];
		closedError = error;
		readyDeferred.reject(error);
		for (const entry of [...pending.values()]) closeEntry(entry, error);
		if (!preserveDisposeResolution) disposeDeferred?.reject(error);
		try {
			invalidateLynxClientContainer(container);
		} catch (invalidationError) {
			report(invalidationError, 'Octane Lynx failed to invalidate its public handles.');
		}
		return true;
	};

	const closeInternal = (error: Error, preserveDisposeResolution: boolean) => {
		if (!closeClientState(error, preserveDisposeResolution)) return;
		detachReceiver();
	};

	const queuePageDestroyHandler = (): void => {
		if (!pageDestroyReceived || pageDestroyHandler === null || pageDestroyHandlerInvoked) return;
		pageDestroyHandlerInvoked = true;
		const handler = pageDestroyHandler;
		// Let a synchronously rejected commit unwind before universal teardown stages
		// its logical remove batch. This keeps a destroy fired during PAPI work from
		// racing the transaction that was active when the lifetime ended.
		void Promise.resolve()
			.then(() => handler())
			.catch((error) => {
				report(error, 'Octane Lynx background page-destroy cleanup failed.');
			});
	};

	const handlePageDestroy = (): void => {
		if (pageDestroyReceived) return;
		pageDestroyReceived = true;
		terminalDisposeIdentity = null;
		terminalDisposeRetryQueued = false;
		logicalTeardownEnabled = true;
		closeClientState(new Error('Octane Lynx native page lifetime was destroyed.'), false, false);
		detachReceiver();
		queuePageDestroyHandler();
	};

	const finishTerminalDispose = (): void => {
		terminalDisposeIdentity = null;
		terminalDisposeRetryQueued = false;
		detachReceiver();
	};

	function queueTerminalDisposeRetry(error: Error): void {
		if (terminalDisposeIdentity === null) return;
		if (terminalDisposeAttempts >= MAX_DISPOSE_ATTEMPTS) {
			report(error, 'Octane Lynx terminal cleanup exhausted its retry budget.');
			finishTerminalDispose();
			return;
		}
		if (terminalDisposeRetryQueued) return;
		terminalDisposeRetryQueued = true;
		void Promise.resolve().then(() => {
			terminalDisposeRetryQueued = false;
			sendTerminalDisposeRequest();
		});
	}

	function sendTerminalDisposeRequest(): void {
		const identity = terminalDisposeIdentity;
		if (identity === null) return;
		terminalDisposeAttempts++;
		try {
			const message = validateLynxBackgroundOutboundMessage({
				...identity,
				type: 'terminal-dispose',
			});
			context.dispatchEvent({ type: LYNX_BACKGROUND_TO_MAIN_EVENT, data: message });
		} catch (disposeError) {
			queueTerminalDisposeRetry(
				report(
					disposeError,
					`Octane Lynx terminal cleanup attempt ${terminalDisposeAttempts} could not be delivered.`,
				),
			);
		}
	}

	const terminalCloseAfterHostAcceptance = (
		identity: UniversalTransportIdentity,
		error: Error,
	): void => {
		if (closedError !== null) return;
		const terminalIdentity = frozenIdentity(identity);
		terminalDisposeIdentity = terminalIdentity;
		terminalDisposeAttempts = 0;
		terminalDisposeRetryQueued = false;
		// Reject logical work and invalidate handles immediately, while retaining
		// only the inbound listener needed for asynchronous cleanup ACK/retry.
		closeClientState(error, false);
		sendTerminalDisposeRequest();
	};

	const publishAcknowledgementMainCalls = (message: LynxTransportAcknowledgement): boolean => {
		let hasQueuedCall = false;
		if (mainThreadCallsNeedDrain) {
			for (const entry of pendingMainCalls.values()) {
				if (entry.state !== 'queued') continue;
				hasQueuedCall = true;
				break;
			}
		}
		if (!hasQueuedCall) {
			mainThreadCallsNeedDrain = false;
			publishingAcknowledgement = false;
			return true;
		}

		let phase: 'open' | 'calls' | 'close' = 'open';
		try {
			// Keep acknowledgement publication closed to direct sends until main has
			// opened the matching ref-owner lifetime window. ContextProxy sender order
			// then places every queued call before the close marker, even when the two
			// runtimes take a microtask checkpoint between individual messages.
			dispatch({ ...frozenIdentity(message), type: 'main-call-publication', phase: 'open' });
			phase = 'calls';
			publishingAcknowledgement = false;
			drainMainThreadCalls();
			phase = 'close';
			dispatch({ ...frozenIdentity(message), type: 'main-call-publication', phase: 'close' });
			return true;
		} catch (error) {
			terminalCloseAfterHostAcceptance(
				message,
				report(error, `Octane Lynx could not publish acknowledgement-time main-thread ${phase}.`),
			);
			return false;
		} finally {
			publishingAcknowledgement = false;
		}
	};

	const handleReady = (message: LynxMainReadyReply) => {
		if (message.request === LYNX_READY_ANNOUNCEMENT_REQUEST) {
			if (readyReceived || readyDeferred.settled || readinessRetrySent) return;
			// Request 0 is only an availability hint. Re-send this transport's
			// correlation ID so main can order queued page data before the reply.
			readinessRetrySent = true;
			try {
				dispatch(readinessRequest);
			} catch (error) {
				closeInternal(report(error, 'Octane Lynx failed to retry main readiness.'), false);
			}
			return;
		}
		if (message.request !== readyRequest) {
			report(
				new Error(`Octane Lynx transport received foreign main-ready request ${message.request}.`),
			);
			return;
		}
		if (readyReceived || readyDeferred.settled) {
			return;
		}
		readyReceived = true;
		readyDeferred.resolve(undefined);
	};

	const handleAcknowledgement = (message: LynxTransportAcknowledgement) => {
		const entry = entryFor(message, 'acknowledgement');
		if (entry === null) return;
		if (entry.state !== 'sent') {
			report(
				new Error(
					`Octane Lynx transport received an acknowledgement while batch ${message.version} was ${entry.state}.`,
				),
			);
			return;
		}
		let handles;
		const previousAccepted = accepted;
		const previousMainAccepted = mainAccepted;
		try {
			handles = prepareLynxHandleDeltas(container, entry.batch, message.handles, message);
			// Applying handle deltas and acceptance callbacks can invoke user code.
			// Queue any resulting calls until all older pre-acceptance IDs can drain.
			publishingAcknowledgement = true;
			handles.apply();
			entry.state = 'acknowledged';
			accepted = frozenIdentity(message);
			mainAccepted = accepted;
			finalizeWorkletBatch(entry.batch, true);
			entry.acknowledge(message);
		} catch (error) {
			publishingAcknowledgement = false;
			accepted = previousAccepted;
			mainAccepted = previousMainAccepted;
			handles?.rollback();
			const terminalError = report(
				error,
				`Octane Lynx could not accept acknowledgement ${message.version}.`,
			);
			// Main emits ACK only after crossing the physical mutation boundary. If
			// background validation fails here, neither side can safely continue.
			terminalCloseAfterHostAcceptance(message, terminalError);
			return;
		}
		if (message.adoption === 'adopted') {
			try {
				dispatch({ ...frozenIdentity(message), type: 'adoption-ready' });
			} catch (error) {
				publishingAcknowledgement = false;
				terminalCloseAfterHostAcceptance(
					message,
					report(error, `Octane Lynx could not confirm adoption ${message.version}.`),
				);
				return;
			}
		}
		publishAcknowledgementMainCalls(message);
		// The acknowledgement just published this batch's hosts, which is what a
		// tap racing main's apply was waiting for.
		flushDeferredNativeEvents();
		if (message.complete === true) {
			// Main merged the completion into this acknowledgement (protocol 2):
			// no attachment or adoption work remained, so no separate `complete`
			// message follows. Settle through the same deferral the wire message
			// would use, so a merged acknowledgement delivered re-entrantly inside
			// dispatch() settles after dispatch returns, exactly like its
			// two-message predecessor.
			const settlement: CommitSettlement = { ...frozenIdentity(message), type: 'complete' };
			if (dispatchingCommit === entry) entry.deferredResponse = settlement;
			else settleCommitResponse(entry, settlement);
		}
	};

	const settleCommitResponse = (entry: PendingCommit, message: CommitSettlement): void => {
		if (message.type === 'complete') {
			completeEntry(entry);
			return;
		}
		if (message.type === 'reject') {
			// A pre-acknowledgement rejection consumed no main-thread frame and
			// main will never pulse for it, so the paced gate it closed reopens.
			if (paceGateVersion === entry.identity.version) openPaceGate();
			closeEntry(entry, remoteError(message.error));
			return;
		}
		closeEntry(entry, remoteError(message.error));
	};

	const handleCommitResponse = (message: LynxBackgroundInboundMessage) => {
		if (message.type === 'ack') {
			handleAcknowledgement(message);
			return;
		}
		if (
			message.type === 'call-background' ||
			message.type === 'cancel-background' ||
			message.type === 'call-main-result' ||
			message.type === 'call-main-error' ||
			message.type === 'frame-pulse' ||
			message.type === 'event' ||
			message.type === 'host-attachment' ||
			message.type === 'host-fault' ||
			message.type === 'dispose-ack' ||
			message.type === 'dispose-retry' ||
			message.type === 'main-ready' ||
			message.type === 'page-destroy' ||
			message.type === 'page-data' ||
			message.type === 'global-props' ||
			message.type === 'plan-registry'
		) {
			return;
		}
		const entry = entryFor(message, message.type);
		if (entry === null) return;
		if (message.type === 'complete') {
			if (entry.state !== 'acknowledged') {
				const error = report(
					new Error(
						`Octane Lynx transport completed batch ${message.version} before acknowledgement.`,
					),
				);
				terminalCloseAfterHostAcceptance(message, error);
				return;
			}
			if (dispatchingCommit === entry) entry.deferredResponse = message;
			else settleCommitResponse(entry, message);
			return;
		}
		if (message.type === 'reject') {
			if (entry.state === 'acknowledged') {
				const error = report(
					new Error(
						`Octane Lynx transport received pre-ACK rejection after batch ${message.version} was accepted.`,
					),
				);
				terminalCloseAfterHostAcceptance(message, error);
				return;
			}
			if (dispatchingCommit === entry) entry.deferredResponse = message;
			else settleCommitResponse(entry, message);
			return;
		}
		if (entry.state !== 'acknowledged') {
			const error = report(
				new Error(`Octane Lynx transport faulted batch ${message.version} before acknowledgement.`),
			);
			terminalCloseAfterHostAcceptance(message, error);
			return;
		}
		if (dispatchingCommit === entry) entry.deferredResponse = message;
		else settleCommitResponse(entry, message);
	};

	/**
	 * A native tap can land between main applying a commit and this thread
	 * accepting its acknowledgement.
	 *
	 * Main installs `__AddEvent` tokens while it applies a commit, so the element
	 * is tappable the moment that apply lands. The acknowledgement that teaches
	 * this thread the host's generation and attachment is still in flight, and a
	 * tap is an engine call rather than a ContextProxy message, so it can arrive
	 * first. Such a delivery is early, not stale: it names a host that genuinely
	 * exists on main. Hold it for the acknowledgement it is racing, then dispatch
	 * or diagnose it. `acknowledgements` is the grace it has left; one is exact,
	 * because main sends the acknowledgement immediately after the apply that
	 * installed the token.
	 */
	interface DeferredNativeEventBatch {
		readonly deliveries: readonly LynxBackgroundNativeEventDelivery[];
		readonly priority: UniversalEventPriority;
		acknowledgements: number;
	}

	const MAX_DEFERRED_NATIVE_EVENT_DELIVERIES = 64;
	let deferredNativeEvents: DeferredNativeEventBatch[] = [];

	const resolveNativeEventBatch = (
		batch: DeferredNativeEventBatch,
	): readonly UniversalTransportEventDelivery[] | null => {
		if (accepted === null) return null;
		const transported: UniversalTransportEventDelivery[] = [];
		for (const delivery of batch.deliveries) {
			const { identity } = delivery;
			// The background owns the listener table but main owns the physical
			// tree, so the generation and attachment recorded at acknowledgement
			// are what prove this token still names a live, mounted host.
			if (
				identity.root !== accepted.root ||
				!isLynxClientEventTarget(container, identity.root, identity.id, identity.generation)
			) {
				return null;
			}
			transported.push({ listener: identity.listener, payload: delivery.payload });
		}
		return Object.freeze(transported);
	};

	const dispatchNativeEventBatchNow = (
		batch: DeferredNativeEventBatch,
		transported: readonly UniversalTransportEventDelivery[],
	): void => {
		handleEvent({
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			root: accepted!.root,
			// An engine-delivered tap names hosts main installed, so it carries
			// main's watermark — the one `handleEvent` validates. Elided batches can
			// put `accepted` ahead of it; `handleEvent` restamps the delivery up to
			// `accepted` for the root either way. `mainAccepted` is non-null
			// whenever `accepted` is: both acceptance paths require it.
			version: mainAccepted!.version,
			type: 'event',
			priority: batch.priority,
			deliveries: transported,
		});
	};

	const reportUnresolvedNativeEventBatch = (batch: DeferredNativeEventBatch): void => {
		const first = batch.deliveries[0]!.identity;
		report(
			new Error(
				`Octane Lynx received a stale native event for host ${first.id}:${first.generation}.`,
			),
		);
	};

	const deferNativeEventBatch = (batch: DeferredNativeEventBatch): void => {
		const transported = resolveNativeEventBatch(batch);
		if (transported !== null) {
			dispatchNativeEventBatchNow(batch, transported);
			return;
		}
		const queued = deferredNativeEvents.reduce((count, held) => count + held.deliveries.length, 0);
		if (queued + batch.deliveries.length > MAX_DEFERRED_NATIVE_EVENT_DELIVERIES) {
			report(
				new Error(
					`Octane Lynx dropped a native event batch after ${MAX_DEFERRED_NATIVE_EVENT_DELIVERIES} deliveries awaiting acknowledgement.`,
				),
			);
			return;
		}
		deferredNativeEvents.push(batch);
	};

	/** Retry deliveries held for an acknowledgement, once that acknowledgement lands. */
	const flushDeferredNativeEvents = (): void => {
		if (deferredNativeEvents.length === 0) return;
		const held = deferredNativeEvents;
		deferredNativeEvents = [];
		for (const batch of held) {
			const transported = resolveNativeEventBatch(batch);
			if (transported !== null) {
				dispatchNativeEventBatchNow(batch, transported);
				continue;
			}
			if (--batch.acknowledgements <= 0) {
				reportUnresolvedNativeEventBatch(batch);
				continue;
			}
			deferredNativeEvents.push(batch);
		}
	};

	/** Fail deliveries that can no longer be acknowledged by anything. */
	const dropDeferredNativeEvents = (): void => {
		if (deferredNativeEvents.length === 0) return;
		const held = deferredNativeEvents;
		deferredNativeEvents = [];
		for (const batch of held) reportUnresolvedNativeEventBatch(batch);
	};

	const handleEvent = (message: Extract<LynxBackgroundInboundMessage, { type: 'event' }>) => {
		// Main stamps the newest version it applied; validate against that, then
		// restamp to the root's watermark — locally settled batches can put the
		// root ahead of main, and the root validates events against its own.
		if (mainAccepted === null || !sameLynxTransportIdentity(mainAccepted, message)) {
			report(
				new Error(`Octane Lynx transport received a stale or foreign event ${message.version}.`),
			);
			return;
		}
		if (boundRoot === null) {
			report(new Error('Octane Lynx transport received an event before the root was bound.'));
			return;
		}
		try {
			boundRoot.dispatchTransportEvent(
				accepted !== null && accepted.version !== message.version
					? { ...message, version: accepted.version }
					: message,
			);
		} catch (error) {
			report(error, 'Octane Lynx transported event failed.');
		}
	};

	const handleHostAttachment = (message: LynxHostAttachmentMessage): void => {
		if (mainAccepted === null || !sameLynxTransportIdentity(mainAccepted, message)) {
			report(
				new Error(
					`Octane Lynx transport received a stale or foreign host attachment ${message.version}.`,
				),
			);
			return;
		}
		try {
			applyLynxHostAttachments(container, message.changes);
		} catch (error) {
			terminalCloseAfterHostAcceptance(
				message,
				report(error, 'Octane Lynx transported host attachment failed.'),
			);
		}
	};

	const handleHostFault = (message: LynxHostFaultMessage): void => {
		if (mainAccepted === null || !sameLynxTransportIdentity(mainAccepted, message)) {
			report(
				new Error(
					`Octane Lynx transport received a stale or foreign host fault ${message.version}.`,
				),
			);
			return;
		}
		terminalCloseAfterHostAcceptance(message, remoteError(message.error));
	};

	const handleCancelBackgroundCall = (
		message: Extract<LynxBackgroundInboundMessage, { type: 'cancel-background' }>,
	): void => {
		const running = runningBackgroundCalls.get(message.call);
		if (running === undefined) {
			report(
				new Error(
					`Octane Lynx received a late or duplicate background cancellation ${message.call}.`,
				),
			);
			return;
		}
		if (!sameLynxTransportIdentity(running.identity, message)) {
			report(
				new Error(
					`Octane Lynx received a stale or foreign background cancellation ${message.call}.`,
				),
			);
			return;
		}
		runningBackgroundCalls.delete(message.call);
		running.cancelled = true;
	};

	function queueDisposeRetry(error: Error): void {
		if (disposeDeferred === null || disposeDeferred.settled || closedError !== null) return;
		if (disposeAttempts >= MAX_DISPOSE_ATTEMPTS) {
			closeInternal(error, false);
			return;
		}
		if (disposeRetryQueued) return;
		disposeRetryQueued = true;
		void Promise.resolve().then(() => {
			disposeRetryQueued = false;
			sendDisposeRequest();
		});
	}

	function sendDisposeRequest(): void {
		const deferred = disposeDeferred;
		const identity = disposeIdentity;
		if (deferred === null || deferred.settled || identity === null || closedError !== null) {
			return;
		}
		disposeAttempts++;
		try {
			dispatch({ ...identity, type: 'dispose' });
		} catch (error) {
			queueDisposeRetry(
				report(error, `Octane Lynx dispose attempt ${disposeAttempts} could not be delivered.`),
			);
		}
	}

	const handleDisposeAcknowledgement = (message: LynxDisposeAcknowledgement) => {
		if (
			terminalDisposeIdentity !== null &&
			sameLynxTransportIdentity(terminalDisposeIdentity, message)
		) {
			finishTerminalDispose();
			return;
		}
		const deferred = disposeDeferred;
		if (
			deferred === null ||
			deferred.settled ||
			disposeIdentity === null ||
			!sameLynxTransportIdentity(disposeIdentity, message)
		) {
			report(
				new Error('Octane Lynx transport received a late or foreign dispose acknowledgement.'),
			);
			return;
		}
		deferred.resolve(undefined);
		closeInternal(new Error('Octane Lynx background transport was disposed.'), true);
	};

	const handleDisposeRetry = (message: LynxDisposeRetryMessage): void => {
		if (
			terminalDisposeIdentity !== null &&
			sameLynxTransportIdentity(terminalDisposeIdentity, message)
		) {
			queueTerminalDisposeRetry(
				report(
					remoteError(message.error),
					'Octane Lynx main thread requested terminal cleanup retry.',
				),
			);
			return;
		}
		if (
			disposeDeferred === null ||
			disposeDeferred.settled ||
			disposeIdentity === null ||
			!sameLynxTransportIdentity(disposeIdentity, message)
		) {
			report(new Error('Octane Lynx transport received a late or foreign dispose retry.'));
			return;
		}
		queueDisposeRetry(
			report(remoteError(message.error), 'Octane Lynx main thread requested a dispose retry.'),
		);
	};

	const rejectExpectedMalformed = (value: unknown, error: Error) => {
		if (value === null || typeof value !== 'object') return;
		const raw = value as Record<string, unknown>;
		if (
			(raw.type === 'call-main-result' || raw.type === 'call-main-error') &&
			Number.isSafeInteger(raw.call) &&
			(raw.call as number) > 0
		) {
			const entry = pendingMainCalls.get(raw.call as number);
			if (
				entry?.identity !== null &&
				entry?.identity !== undefined &&
				raw.protocol === entry.identity.protocol &&
				raw.renderer === entry.identity.renderer &&
				raw.root === entry.identity.root &&
				raw.version === entry.identity.version
			) {
				pendingMainCalls.delete(entry.call);
				entry.deferred.reject(error);
				return;
			}
		}
		if (
			raw.type === 'call-background' &&
			accepted !== null &&
			Number.isSafeInteger(raw.call) &&
			(raw.call as number) > 0 &&
			raw.protocol === accepted.protocol &&
			raw.renderer === accepted.renderer &&
			raw.root === accepted.root &&
			raw.root === transportRoot &&
			Number.isSafeInteger(raw.version) &&
			(raw.version as number) > 0 &&
			(raw.version as number) <= accepted.version
		) {
			try {
				dispatch({
					protocol: accepted.protocol,
					renderer: accepted.renderer,
					root: accepted.root,
					version: raw.version as number,
					type: 'call-background-error',
					call: raw.call as number,
					error: wireError(error, 'Octane Lynx received a malformed background call.'),
				});
			} catch (dispatchError) {
				closeInternal(
					report(dispatchError, 'Octane Lynx could not reject a malformed background call.'),
					false,
				);
			}
			return;
		}
		if (
			raw.type === 'main-ready' &&
			(raw.request === readyRequest || raw.request === LYNX_READY_ANNOUNCEMENT_REQUEST) &&
			!readyDeferred.settled
		) {
			closeInternal(error, false);
			return;
		}
		if (
			(raw.type === 'dispose-ack' || raw.type === 'dispose-retry') &&
			terminalDisposeIdentity !== null &&
			raw.protocol === terminalDisposeIdentity.protocol &&
			raw.renderer === terminalDisposeIdentity.renderer &&
			raw.root === terminalDisposeIdentity.root &&
			raw.version === terminalDisposeIdentity.version
		) {
			queueTerminalDisposeRetry(error);
			return;
		}
		if (
			(raw.type === 'dispose-ack' || raw.type === 'dispose-retry') &&
			disposeDeferred !== null &&
			!disposeDeferred.settled &&
			disposeIdentity !== null &&
			raw.protocol === disposeIdentity.protocol &&
			raw.renderer === disposeIdentity.renderer &&
			raw.root === disposeIdentity.root &&
			raw.version === disposeIdentity.version
		) {
			queueDisposeRetry(error);
			return;
		}
		if (
			(raw.type === 'host-fault' || raw.type === 'host-attachment') &&
			mainAccepted !== null &&
			raw.protocol === mainAccepted.protocol &&
			raw.renderer === mainAccepted.renderer &&
			raw.root === mainAccepted.root &&
			raw.version === mainAccepted.version
		) {
			// These unsolicited messages are emitted only for an already-mutated
			// accepted root, and main stamps the newest version it applied. A
			// malformed exact identity is therefore fail-stop; a stale or foreign
			// identity remains diagnostic-only.
			terminalCloseAfterHostAcceptance(mainAccepted, error);
			return;
		}
		if (!Number.isSafeInteger(raw.version)) return;
		const entry = pending.get(raw.version as number);
		if (
			entry !== undefined &&
			raw.protocol === entry.identity.protocol &&
			raw.renderer === entry.identity.renderer &&
			raw.root === entry.identity.root
		) {
			if (
				(entry.state === 'sent' &&
					(raw.type === 'ack' || raw.type === 'complete' || raw.type === 'fault')) ||
				(entry.state === 'acknowledged' &&
					(raw.type === 'ack' ||
						raw.type === 'complete' ||
						raw.type === 'fault' ||
						raw.type === 'reject'))
			) {
				// These responses are emitted only after main has already mutated.
				terminalCloseAfterHostAcceptance(entry.identity, error);
			} else {
				closeEntry(entry, error);
			}
		}
	};

	function receive(event: LynxContextProxyEvent): void {
		if (isRootIndependentDataMessage(event.data)) return;
		if (closedError !== null && terminalDisposeIdentity === null) return;
		let message: LynxBackgroundInboundMessage;
		try {
			message = validateLynxBackgroundInboundMessage(event.data);
		} catch (error) {
			const normalized = report(error, 'Octane Lynx received a malformed inbound message.');
			rejectExpectedMalformed(event.data, normalized);
			return;
		}
		if (message.type === 'page-destroy') {
			handlePageDestroy();
			return;
		}
		if (closedError !== null) {
			if (message.type === 'dispose-ack') handleDisposeAcknowledgement(message);
			else if (message.type === 'dispose-retry') handleDisposeRetry(message);
			return;
		}
		if (message.type === 'page-data' || message.type === 'global-props') {
			// Root-independent data is owned by the page-lifetime background receiver.
			return;
		}
		if (message.type === 'main-ready') {
			if (message.plans !== undefined) {
				for (const plan of message.plans) announcedPlans.set(plan.id, plan.canonical);
			}
			handleReady(message);
			return;
		}
		if (message.type === 'plan-registry') {
			for (const plan of message.plans) announcedPlans.set(plan.id, plan.canonical);
			return;
		}
		if (message.type === 'call-main-result' || message.type === 'call-main-error') {
			settleMainThreadCall(message);
			return;
		}
		if (message.type === 'call-background') {
			handleBackgroundCall(message);
			return;
		}
		if (message.type === 'cancel-background') {
			handleCancelBackgroundCall(message);
			return;
		}
		if (message.type === 'frame-pulse') {
			handleFramePulse(message);
			return;
		}
		if (message.type === 'event') {
			handleEvent(message);
			return;
		}
		if (message.type === 'host-attachment') {
			handleHostAttachment(message);
			return;
		}
		if (message.type === 'host-fault') {
			handleHostFault(message);
			return;
		}
		if (message.type === 'dispose-ack') {
			handleDisposeAcknowledgement(message);
			return;
		}
		if (message.type === 'dispose-retry') {
			handleDisposeRetry(message);
			return;
		}
		handleCommitResponse(message);
	}

	receiverAttached = true;
	try {
		context.addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, receive);
	} catch (error) {
		const registrationError = report(
			error,
			'Octane Lynx failed to install its background transport listener.',
		);
		closeInternal(registrationError, false);
		throw registrationError;
	}
	let pageDestroyedBeforeReady = false;
	try {
		pageDestroyedBeforeReady = options.isPageDestroyed?.() === true;
	} catch (error) {
		const tombstoneError = report(
			error,
			'Octane Lynx failed to read its native page-lifetime tombstone.',
		);
		closeInternal(tombstoneError, false);
		throw tombstoneError;
	}
	if (pageDestroyedBeforeReady) {
		handlePageDestroy();
	} else if (closedError === null && !readyReceived && !readinessRetrySent) {
		try {
			dispatch(readinessRequest);
		} catch (error) {
			closeInternal(report(error, 'Octane Lynx failed to request main readiness.'), false);
		}
	}

	const transport: LynxBackgroundTransport = {
		mode: 'async',
		planInstantiation(plan: UniversalPlan, values: readonly unknown[]) {
			return isLynxPlanInstanceEligible(plan, values, isPlanAnnounced);
		},
		ready: readyDeferred.promise,
		prepareBatch(target, batch, identity): UniversalAsyncPreparedHostBatch {
			if (target !== container) {
				throw new Error('Octane Lynx transport received a foreign client container.');
			}
			preparationCount++;
			if (closedError !== null) {
				if (!logicalTeardownEnabled || !isLogicalTeardownBatch(batch)) throw closedError;
				if (
					identity.protocol !== LYNX_TRANSPORT_PROTOCOL_VERSION ||
					identity.renderer !== LYNX_TRANSPORT_RENDERER ||
					identity.version !== batch.version ||
					!Number.isSafeInteger(identity.root) ||
					identity.root <= 0
				) {
					throw new Error('Octane Lynx logical teardown received a foreign identity.');
				}
				let status: 'prepared' | 'applied' | 'aborted' = 'prepared';
				return Object.freeze({
					apply(acknowledge: (message: UniversalTransportAcknowledgement) => void) {
						if (status !== 'prepared') {
							return Promise.reject(
								new Error('Octane Lynx logical teardown apply() may only run once.'),
							);
						}
						status = 'applied';
						logicalTeardownEnabled = false;
						const previousAccepted = accepted;
						accepted = frozenIdentity(identity);
						try {
							acknowledge({ ...identity, type: 'ack' });
							return Promise.resolve();
						} catch (error) {
							accepted = previousAccepted;
							return Promise.reject(error);
						}
					},
					abort() {
						if (status === 'prepared') status = 'aborted';
					},
				});
			}
			const preparedWithProvenance = options.prepareWorkletBatch?.(batch) ?? batch;
			// Fold provable plan instances into instantiate commands for the wire
			// message only. Background bookkeeping — handle-delta validation against
			// main's acknowledgement and worklet lifetimes — keeps reading the
			// per-node `preparedBatch`, which mirrors the commands main regenerates
			// when it expands each instantiate. Only plans main announced from its
			// registry are folded, so an unannounced plan (registry skew, lazy
			// chunk, or locally detected collision) degrades to the per-node commands
			// staged here.
			const wireBatch = foldLynxPlanInstances(preparedWithProvenance, isPlanAnnounced);
			// Provenance is consumed by the fold above. Handle validation and worklet
			// ownership need only the original per-node commands, so do not retain the
			// per-instance plan/value/ID snapshots through acknowledgement.
			const preparedBatch: UniversalHostBatch =
				preparedWithProvenance.planInstances === undefined
					? preparedWithProvenance
					: Object.freeze({
							renderer: preparedWithProvenance.renderer,
							version: preparedWithProvenance.version,
							commands: preparedWithProvenance.commands,
						});
			// An empty batch mutates nothing on main, so it never rides the frame
			// budget, and once a batch has crossed it does not cross the wire at
			// all — see the elision branch in dispatchThroughPaceGate below.
			const paceThisCommit = commitPacing === 'frame' && wireBatch.commands.length > 0;
			let commit: LynxCommitWireMessage | null = paceThisCommit
				? { ...identity, type: 'commit', batch: wireBatch, pace: true }
				: { ...identity, type: 'commit', batch: wireBatch };
			try {
				selfCheckLynxBackgroundOutboundMessage(commit);
			} catch (error) {
				finalizeWorkletBatch(preparedBatch, false);
				throw error;
			}
			const token: PreparedTokenState = { status: 'prepared', entry: null };
			return {
				apply(acknowledge) {
					if (token.status !== 'prepared') {
						return Promise.reject(
							new Error('Octane Lynx prepared batch apply() may only run once.'),
						);
					}
					if (closedError !== null) {
						finalizeWorkletBatch(preparedBatch, false);
						return Promise.reject(closedError);
					}
					if (transportRoot === null) transportRoot = identity.root;
					else if (transportRoot !== identity.root) {
						finalizeWorkletBatch(preparedBatch, false);
						return Promise.reject(new Error('Octane Lynx transport cannot serve a foreign root.'));
					}
					if (pending.has(identity.version)) {
						finalizeWorkletBatch(preparedBatch, false);
						return Promise.reject(
							new Error(`Octane Lynx transport already has batch ${identity.version}.`),
						);
					}
					token.status = 'applying';
					const entry: PendingCommit = {
						identity: frozenIdentity(identity),
						batch: preparedBatch,
						acknowledge,
						deferred: createDeferred<void>(),
						token,
						state: 'waiting-ready',
						abortRequested: false,
						deferredResponse: null,
					};
					token.entry = entry;
					pending.set(identity.version, entry);
					const dispatchThroughPaceGate = (): void => {
						// Stale by abort or transport close while ready/pacing gated.
						if (pending.get(identity.version) !== entry) return;
						// Zero-command elision (protocol 2): once a batch has crossed —
						// main knows this root — an empty batch settles here without
						// touching the wire. Main would stage nothing, publish no
						// handles, and answer with a bare acknowledgement, so this
						// thread runs the same acceptance locally. Renders folded
						// behind a held commit leave a tail of such no-op batches;
						// shipping each spent a structured clone and two response
						// messages to learn nothing. Local acceptance advances
						// `accepted` — the root's watermark — but never
						// `mainAccepted`: main's staleness check is `<=`, so the
						// version gap is legal, and the very first batch still
						// crosses even when empty so activation is never elided. The
						// deferred-native-event grace is not decremented: no handles
						// were published, so a held tap learned nothing either way.
						if (wireBatch.commands.length === 0 && mainAccepted !== null) {
							entry.state = 'acknowledged';
							const previousAccepted = accepted;
							try {
								publishingAcknowledgement = true;
								accepted = frozenIdentity(identity);
								finalizeWorkletBatch(preparedBatch, true);
								entry.acknowledge({ ...identity, type: 'ack' });
							} catch (error) {
								publishingAcknowledgement = false;
								accepted = previousAccepted;
								terminalCloseAfterHostAcceptance(
									identity,
									report(error, `Octane Lynx could not accept elided batch ${identity.version}.`),
								);
								return;
							}
							// Publication markers and calls are main-facing, so they
							// carry main's watermark, not the elided identity.
							if (!publishAcknowledgementMainCalls({ ...mainAccepted, type: 'ack' })) return;
							settleCommitResponse(entry, { ...frozenIdentity(identity), type: 'complete' });
							return;
						}
						if (paceGateVersion !== null && paceThisCommit) {
							holdForPaceGate(dispatchThroughPaceGate);
							return;
						}
						const outbound = commit;
						if (outbound === null) return;
						entry.state = 'sent';
						// Close the gate before dispatching: a synchronous ContextProxy
						// delivers main's frame pulse re-entrantly inside dispatch(), and
						// that pulse must find this commit's gate already closed.
						if (paceThisCommit) paceGateVersion = identity.version;
						let dispatchError: Error | null = null;
						dispatchingCommit = entry;
						try {
							dispatch(outbound);
						} catch (error) {
							dispatchError = report(
								error,
								`Octane Lynx could not deliver commit ${identity.version}.`,
							);
						} finally {
							dispatchingCommit = null;
							// ContextProxy consumes/clones the message during dispatch. The
							// settled transaction must not retain the large instantiate payload.
							commit = null;
						}
						if (dispatchError !== null) {
							terminalCloseAfterHostAcceptance(entry.identity, dispatchError);
							return;
						}
						const response = entry.deferredResponse;
						entry.deferredResponse = null;
						if (response !== null && pending.get(identity.version) === entry) {
							settleCommitResponse(entry, response);
						}
					};
					void readyDeferred.promise.then(dispatchThroughPaceGate, (error) =>
						closeEntry(entry, error),
					);
					return entry.deferred.promise;
				},
				abort() {
					if (token.status === 'aborted' || token.status === 'settled') return;
					if (token.status === 'prepared') {
						token.status = 'aborted';
						finalizeWorkletBatch(preparedBatch, false);
						return;
					}
					const entry = token.entry;
					if (entry === null || entry.state === 'acknowledged') return;
					if (entry.state === 'waiting-ready') {
						token.status = 'aborted';
						closeEntry(
							entry,
							new Error(`Octane Lynx transport batch ${entry.identity.version} was aborted.`),
						);
						return;
					}
					if (entry.abortRequested) return;
					entry.abortRequested = true;
					try {
						dispatch({ ...entry.identity, type: 'abort' });
					} catch (error) {
						terminalCloseAfterHostAcceptance(
							entry.identity,
							report(error, 'Octane Lynx failed to send an abort.'),
						);
					}
				},
			};
		},
		bindRoot(root) {
			if (boundRoot !== null && boundRoot !== root) {
				throw new Error('Octane Lynx transport is already bound to another root.');
			}
			boundRoot = root;
		},
		bindPageDestroy(handler) {
			if (typeof handler !== 'function') {
				throw new TypeError('Octane Lynx page-destroy handler must be a function.');
			}
			if (pageDestroyHandler !== null && pageDestroyHandler !== handler) {
				throw new Error('Octane Lynx transport already has a page-destroy handler.');
			}
			pageDestroyHandler = handler;
			queuePageDestroyHandler();
		},
		acceptedIdentity() {
			return accepted;
		},
		ownedRoot() {
			return transportRoot;
		},
		dispatchNativeEventBatch(deliveries) {
			if (deliveries.length === 0) return;
			if (closedError !== null) {
				report(closedError, 'Octane Lynx received a native event after the transport closed.');
				return;
			}
			const priority = deliveries[0]!.identity.priority;
			for (const delivery of deliveries) {
				const { identity } = delivery;
				if (transportRoot !== null && identity.root !== transportRoot) {
					report(
						new Error(`Octane Lynx received a foreign native event for root ${identity.root}.`),
					);
					return;
				}
				if (identity.priority !== priority) {
					report(new Error('Octane Lynx native event batch mixes listener priorities.'));
					return;
				}
			}
			deferNativeEventBatch({ deliveries, priority, acknowledgements: 1 });
		},
		async cancelPendingBeforeReady(reason) {
			if (closedError !== null || accepted !== null || pending.size === 0) return false;
			const entries = [...pending.values()];
			if (entries.some((entry) => entry.state !== 'waiting-ready')) return false;
			const settlements = entries.map((entry) => entry.deferred.promise.then(undefined, () => {}));
			closeInternal(
				errorFrom(reason, 'Octane Lynx root was unmounted before main became ready.'),
				false,
			);
			await Promise.all(settlements);
			return true;
		},
		preparationCount() {
			return preparationCount;
		},
		closedReason() {
			return closedError;
		},
		enableLogicalTeardown() {
			logicalTeardownEnabled = true;
		},
		dispose() {
			if (disposeDeferred !== null) return disposeDeferred.promise;
			if (closedError !== null) return Promise.reject(closedError);
			if (mainAccepted === null) {
				return Promise.reject(
					new Error('Octane Lynx transport cannot dispose before a batch is accepted.'),
				);
			}
			// The dispose handshake is validated by main against the versions it
			// applied, so it carries main's watermark, never an elided version.
			disposeIdentity = mainAccepted;
			disposeDeferred = createDeferred<void>();
			const deferred = disposeDeferred;
			void readyDeferred.promise.then(
				() => {
					if (deferred.settled || disposeIdentity === null) return;
					sendDisposeRequest();
				},
				(error) => deferred.reject(error),
			);
			return deferred.promise;
		},
		callMain(worklet, args) {
			if (closedError !== null) {
				const deferred = createDeferred<UniversalSerializableValue>();
				deferred.reject(closedError);
				return Object.freeze({ promise: deferred.promise, cancel() {} });
			}
			if (pendingMainCalls.size >= MAX_QUEUED_THREAD_CALLS) {
				const deferred = createDeferred<UniversalSerializableValue>();
				deferred.reject(
					new Error(
						`Octane Lynx main-thread call queue is limited to ${MAX_QUEUED_THREAD_CALLS} entries.`,
					),
				);
				return Object.freeze({ promise: deferred.promise, cancel() {} });
			}
			if (nextThreadCall > Number.MAX_SAFE_INTEGER) {
				const deferred = createDeferred<UniversalSerializableValue>();
				deferred.reject(new Error('Octane Lynx main-thread call identity space is exhausted.'));
				return Object.freeze({ promise: deferred.promise, cancel() {} });
			}
			const isolatedWorklet = isolateLynxWorkletValue(
				worklet as LynxWorkletValue,
				'main-thread call target',
			);
			if (!isLynxMainThreadWorkletDescriptor(isolatedWorklet)) {
				throw new TypeError('Octane Lynx main-thread call target is invalid.');
			}
			const isolatedArgs = isolateLynxWorkletValue(
				args as unknown as LynxWorkletValue[],
				'main-thread call arguments',
			);
			const entry: PendingMainThreadCall = {
				call: nextThreadCall++,
				worklet: isolatedWorklet as LynxMainThreadWorkletWireDescriptor,
				args: isolatedArgs as readonly UniversalSerializableValue[],
				deferred: createDeferred<UniversalSerializableValue>(),
				identity: null,
				state: 'queued',
			};
			pendingMainCalls.set(entry.call, entry);
			if (mainAccepted !== null && !publishingAcknowledgement && !drainingMainThreadCalls) {
				sendMainThreadCall(entry);
			} else {
				mainThreadCallsNeedDrain = true;
			}
			return Object.freeze({
				promise: entry.deferred.promise,
				cancel(reason?: unknown) {
					if (pendingMainCalls.get(entry.call) !== entry) return;
					pendingMainCalls.delete(entry.call);
					if (entry.state === 'sent' && entry.identity !== null && closedError === null) {
						try {
							dispatch({ ...entry.identity, type: 'cancel-main', call: entry.call });
						} catch (error) {
							report(error, 'Octane Lynx could not deliver a main-thread cancellation.');
						}
					}
					const cancellation = errorFrom(reason, 'Octane Lynx main-thread call was cancelled.');
					if (reason === undefined) cancellation.name = 'AbortError';
					entry.deferred.reject(cancellation);
				},
			});
		},
		close(reason) {
			closeInternal(errorFrom(reason, 'Octane Lynx background transport was closed.'), false);
		},
		diagnostics() {
			return Object.freeze([...reported]);
		},
	};
	return Object.freeze(transport);
}
