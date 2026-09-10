declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type {
	UniversalTransportAcknowledgement,
	UniversalTransportCompleteMessage,
	UniversalTransportError,
	UniversalTransportFaultMessage,
	UniversalTransportIdentity,
	UniversalTransportRejectMessage,
} from 'octane/universal/native';

import {
	applyLynxCompiledProgramFrame,
	type LynxCompiledProgramResolver,
} from './compiled-program-frame.js';
import {
	createLynxCompiledProgramStore,
	type LynxCompiledProgramAdoptionSource,
	type LynxCompiledProgramStore,
} from './compiled-program-store.js';
import type { LynxElementPAPI, LynxElementRef } from './papi.js';

const MAX_ABORT_TOMBSTONES = 128;
const MAX_DISPOSED_ROOT_TOMBSTONES = 128;
const CONTROLLER_DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const CONTROLLER_ERROR = 'Octane Lynx OL490';

export interface LynxCompiledProgramDisposeAcknowledgement extends UniversalTransportIdentity {
	readonly type: 'dispose-ack';
}

export interface LynxCompiledProgramDisposeRetry extends UniversalTransportIdentity {
	readonly type: 'dispose-retry';
	readonly error: UniversalTransportError;
}

export type LynxCompiledProgramControllerResponse =
	| UniversalTransportAcknowledgement
	| UniversalTransportCompleteMessage
	| UniversalTransportRejectMessage
	| UniversalTransportFaultMessage
	| LynxCompiledProgramDisposeAcknowledgement
	| LynxCompiledProgramDisposeRetry;

export interface LynxCompiledProgramControllerOptions<Node extends LynxElementRef> {
	readonly page: Node;
	readonly papi: LynxElementPAPI<Node>;
	readonly resolveProgram: LynxCompiledProgramResolver;
	/** Send one already-local response to the paired background transport. */
	readonly respond: (message: LynxCompiledProgramControllerResponse) => void;
	readonly onDiagnostic?: (error: Error) => void;
}

export interface LynxCompiledProgramController {
	apply(identity: UniversalTransportIdentity, frame: unknown): void;
	abort(identity: UniversalTransportIdentity): void;
	dispose(identity: UniversalTransportIdentity, terminal?: boolean): void;
	activeIdentity(): UniversalTransportIdentity | null;
	size(): number;
	diagnostics(): readonly Error[];
	close(): void;
}

export function normalizeLynxCompiledProgramError(value: unknown, fallback: string): Error {
	if (value instanceof Error) return value;
	return new Error(value === undefined ? fallback : String(value));
}

function wireError(error: Error): UniversalTransportError {
	return Object.freeze({ name: error.name || 'Error', message: error.message });
}

function frozenIdentity(identity: UniversalTransportIdentity): UniversalTransportIdentity {
	return Object.freeze({
		protocol: identity.protocol,
		renderer: identity.renderer,
		root: identity.root,
		version: identity.version,
	});
}

function abortKey(identity: UniversalTransportIdentity): string {
	return `${identity.protocol}:${identity.renderer}:${identity.root}:${identity.version}`;
}

/**
 * Own the page-local compact program store across frame settlements.
 *
 * This is deliberately below ContextProxy framing and above the frame decoder:
 * a product receiver validates one small outer envelope, then gives this
 * controller the recovered identity and flat v2 frame. The general host
 * container is never created, so there is exactly one owner for every native
 * node on this path.
 *
 * Host publication follows the universal transport boundary. A frame either
 * rolls back and receives `reject`, or commits once and receives `ack` followed
 * by `complete`. Failure while sending either accepted response faults the
 * controller but never rolls accepted host state back; the sender can then use
 * its terminal-dispose recovery without two peers disagreeing about ownership.
 */
export function createLynxCompiledProgramController<Node extends LynxElementRef>(
	options: LynxCompiledProgramControllerOptions<Node>,
	adoption?: LynxCompiledProgramAdoptionSource<Node>,
): LynxCompiledProgramController {
	const { page, papi, resolveProgram, respond } = options;
	const reported: Error[] = [];
	const aborted = new Set<string>();
	const disposedRoots = new Map<number, number>();
	let store: LynxCompiledProgramStore<Node> | null = null;
	let active: UniversalTransportIdentity | null = null;
	let applying: UniversalTransportIdentity | null = null;
	let disposing = false;
	let faulted = false;
	let closed = false;

	const report = (value: unknown, fallback = CONTROLLER_ERROR): Error => {
		const error = normalizeLynxCompiledProgramError(value, fallback);
		reported.push(error);
		try {
			options.onDiagnostic?.(error);
		} catch (diagnosticError) {
			reported.push(normalizeLynxCompiledProgramError(diagnosticError, CONTROLLER_ERROR));
		}
		return error;
	};

	const send = (message: LynxCompiledProgramControllerResponse): boolean => {
		try {
			respond(Object.freeze(message));
			return true;
		} catch (error) {
			faulted = true;
			report(
				error,
				CONTROLLER_DEVELOPMENT
					? `Octane Lynx compact receiver could not send ${message.type}.`
					: CONTROLLER_ERROR,
			);
			return false;
		}
	};

	const reject = (identity: UniversalTransportIdentity, value: unknown): void => {
		const error = report(
			value,
			CONTROLLER_DEVELOPMENT ? 'Octane Lynx compact frame was rejected.' : CONTROLLER_ERROR,
		);
		send({ ...identity, type: 'reject', error: wireError(error) });
	};
	const rememberDisposed = (identity: UniversalTransportIdentity): void => {
		disposedRoots.set(identity.root, identity.version);
		if (disposedRoots.size > MAX_DISPOSED_ROOT_TOMBSTONES) {
			const oldest = disposedRoots.keys().next().value;
			if (oldest !== undefined) disposedRoots.delete(oldest);
		}
	};

	const requireAvailable = (identity: UniversalTransportIdentity): Error | null => {
		if (closed) {
			return new Error(
				CONTROLLER_DEVELOPMENT ? 'Octane Lynx compact receiver is closed.' : CONTROLLER_ERROR,
			);
		}
		if (faulted) {
			return new Error(
				CONTROLLER_DEVELOPMENT
					? 'Octane Lynx compact receiver is faulted after an accepted response failure.'
					: CONTROLLER_ERROR,
			);
		}
		if (disposing) {
			return new Error(
				CONTROLLER_DEVELOPMENT
					? 'Octane Lynx compact receiver is disposing its native ownership.'
					: CONTROLLER_ERROR,
			);
		}
		if (applying !== null) {
			return new Error(
				CONTROLLER_DEVELOPMENT
					? `Octane Lynx compact receiver is already applying root ${applying.root} version ${applying.version}.`
					: CONTROLLER_ERROR,
			);
		}
		if (disposedRoots.has(identity.root)) {
			return new Error(
				CONTROLLER_DEVELOPMENT
					? `Octane Lynx compact receiver root ${identity.root} was already disposed.`
					: CONTROLLER_ERROR,
			);
		}
		if (active === null) {
			if (identity.version !== 1) {
				return new Error(
					CONTROLLER_DEVELOPMENT
						? `Octane Lynx compact receiver expected initial version 1, received ${identity.version}.`
						: CONTROLLER_ERROR,
				);
			}
			return null;
		}
		if (identity.root !== active.root || identity.renderer !== active.renderer) {
			return new Error(
				CONTROLLER_DEVELOPMENT
					? 'Octane Lynx compact receiver received a foreign root.'
					: CONTROLLER_ERROR,
			);
		}
		if (identity.version !== active.version + 1) {
			return new Error(
				CONTROLLER_DEVELOPMENT
					? `Octane Lynx compact receiver expected version ${active.version + 1}, received ${identity.version}.`
					: CONTROLLER_ERROR,
			);
		}
		return null;
	};

	const controller: LynxCompiledProgramController = {
		apply(identity, frame) {
			const unavailable = requireAvailable(identity);
			if (unavailable !== null) {
				reject(identity, unavailable);
				return;
			}
			const key = abortKey(identity);
			if (aborted.delete(key)) {
				reject(
					identity,
					new Error(
						CONTROLLER_DEVELOPMENT
							? `Octane Lynx compact frame ${identity.version} was aborted before apply.`
							: CONTROLLER_ERROR,
					),
				);
				return;
			}
			const candidate = frozenIdentity(identity);
			const candidateStore =
				store ??
				createLynxCompiledProgramStore(
					papi,
					papi.getUniqueId(page),
					candidate.root,
					adoption?.[0],
					adoption?.[1],
				);
			applying = candidate;
			try {
				applyLynxCompiledProgramFrame(candidateStore, page, resolveProgram, frame, () => {
					if (aborted.delete(key)) {
						throw new Error(
							CONTROLLER_DEVELOPMENT
								? `Octane Lynx compact frame ${identity.version} was aborted during apply.`
								: CONTROLLER_ERROR,
						);
					}
				});
			} catch (error) {
				applying = null;
				if (candidateStore.isFaulted()) {
					// Rollback itself left native ownership uncertain. Retain the
					// faulted store so terminal disposal can finish cleanup; a reject
					// would incorrectly invite an ordinary same-identity retry.
					store = candidateStore;
					active = candidate;
					faulted = true;
					const normalized = report(
						error,
						CONTROLLER_DEVELOPMENT
							? 'Octane Lynx compact frame rollback was incomplete.'
							: CONTROLLER_ERROR,
					);
					send({ ...candidate, type: 'fault', error: wireError(normalized) });
					return;
				}
				reject(identity, error);
				return;
			}
			applying = null;
			store = candidateStore;
			active = candidate;
			if (!send({ ...candidate, type: 'ack' })) return;
			send({ ...candidate, type: 'complete' });
		},

		abort(identity) {
			if (closed || faulted) return;
			if (
				active !== null &&
				(identity.root !== active.root ||
					identity.renderer !== active.renderer ||
					identity.version <= active.version)
			) {
				report(
					new Error(
						CONTROLLER_DEVELOPMENT
							? 'Octane Lynx compact receiver received a stale or foreign abort.'
							: CONTROLLER_ERROR,
					),
				);
				return;
			}
			aborted.add(abortKey(identity));
			if (aborted.size > MAX_ABORT_TOMBSTONES) {
				const oldest = aborted.values().next().value;
				if (oldest !== undefined) aborted.delete(oldest);
			}
		},

		dispose(identity, terminal = false) {
			if (closed) return;
			if (applying !== null || disposing) {
				report(
					new Error(
						CONTROLLER_DEVELOPMENT
							? 'Octane Lynx compact receiver cannot dispose during frame apply.'
							: CONTROLLER_ERROR,
					),
				);
				return;
			}
			if (active === null) {
				if (terminal || disposedRoots.get(identity.root) === identity.version) {
					send({ ...identity, type: 'dispose-ack' });
				} else {
					report(
						new Error(
							CONTROLLER_DEVELOPMENT
								? 'Octane Lynx compact receiver received a dispose without an active root.'
								: CONTROLLER_ERROR,
						),
					);
				}
				return;
			}
			if (
				identity.root !== active.root ||
				identity.renderer !== active.renderer ||
				(terminal ? identity.version < active.version : identity.version !== active.version)
			) {
				report(
					new Error(
						CONTROLLER_DEVELOPMENT
							? 'Octane Lynx compact receiver received a stale or foreign dispose.'
							: CONTROLLER_ERROR,
					),
				);
				return;
			}
			disposing = true;
			try {
				store!.dispose();
			} catch (error) {
				disposing = false;
				const normalized = report(error);
				send({ ...identity, type: 'dispose-retry', error: wireError(normalized) });
				return;
			}
			disposing = false;
			store = null;
			active = null;
			aborted.clear();
			rememberDisposed(identity);
			send({ ...identity, type: 'dispose-ack' });
		},

		activeIdentity() {
			return active;
		},

		size() {
			return store?.size() ?? 0;
		},

		diagnostics() {
			return Object.freeze([...reported]);
		},

		close() {
			if (closed || disposing) return;
			aborted.clear();
			if (store === null) {
				closed = true;
				return;
			}
			disposing = true;
			try {
				store.dispose();
			} catch (error) {
				disposing = false;
				throw report(error);
			}
			disposing = false;
			store = null;
			active = null;
			closed = true;
		},
	};

	return Object.freeze(controller);
}
