declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type {
	UniversalTransportAcknowledgement,
	UniversalTransportIdentity,
} from 'octane/universal/native';

import {
	decodeLynxCompiledProgramMainMessage,
	encodeLynxCompiledProgramBackgroundMessage,
	LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT,
	LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT,
} from './compiled-program-wire.js';
import {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	type LynxContextProxy,
	type LynxContextProxyEvent,
} from './protocol.js';
import {
	acceptLynxTransportFrame,
	createLynxTransportFrameState,
	frameLynxTransportValue,
} from './transport-codec.js';

const TRANSPORT_DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const TRANSPORT_ERROR = 'Octane Lynx OL493';
const MAX_DISPOSE_ATTEMPTS = 3;
let NEXT_READY_REQUEST = 1;

interface Deferred<T> {
	readonly promise: Promise<T>;
	readonly settled: boolean;
	resolve(value: T): void;
	reject(error: unknown): void;
}

interface PendingCommit {
	readonly identity: UniversalTransportIdentity;
	readonly frame: readonly unknown[];
	readonly acknowledge: (message: UniversalTransportAcknowledgement) => void;
	readonly deferred: Deferred<void>;
	state: 'waiting-ready' | 'sent' | 'acknowledged';
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

function normalizedError(value: unknown, fallback: string): Error {
	return value instanceof Error ? value : new Error(value === undefined ? fallback : String(value));
}

function remoteError(input: { readonly name: string; readonly message: string }): Error {
	const error = new Error(input.message);
	error.name = input.name;
	return error;
}

export interface LynxCompiledProgramTransportOptions {
	readonly onDiagnostic?: (error: Error) => void;
}

export interface LynxCompiledProgramCommitAttempt {
	readonly promise: Promise<void>;
	abort(): void;
}

export interface LynxCompiledProgramTransport {
	readonly ready: Promise<void>;
	commit(
		identity: UniversalTransportIdentity,
		frame: readonly unknown[],
		acknowledge: (message: UniversalTransportAcknowledgement) => void,
	): LynxCompiledProgramCommitAttempt;
	dispose(identity: UniversalTransportIdentity, terminal?: boolean): Promise<void>;
	diagnostics(): readonly Error[];
	close(error?: unknown): void;
}

function validateContext(context: LynxContextProxy): void {
	if (
		context === null ||
		typeof context !== 'object' ||
		typeof context.dispatchEvent !== 'function' ||
		typeof context.addEventListener !== 'function' ||
		typeof context.removeEventListener !== 'function'
	) {
		throw new TypeError(
			TRANSPORT_DEVELOPMENT
				? 'Octane Lynx compact transport requires ContextProxy dispatchEvent/addEventListener/removeEventListener.'
				: TRANSPORT_ERROR,
		);
	}
}

/** Create the background half of the isolated compact compiled-program wire. */
export function createLynxCompiledProgramTransport(
	context: LynxContextProxy,
	options: LynxCompiledProgramTransportOptions = {},
): LynxCompiledProgramTransport {
	validateContext(context);
	const readyRequest = NEXT_READY_REQUEST++;
	if (!Number.isSafeInteger(readyRequest)) {
		throw new Error(
			TRANSPORT_DEVELOPMENT
				? 'Octane Lynx compact ready request identities are exhausted.'
				: TRANSPORT_ERROR,
		);
	}
	const reported: Error[] = [];
	const pending = new Map<number, PendingCommit>();
	const ready = createDeferred<void>();
	void ready.promise.catch(() => {});
	const inbound = createLynxTransportFrameState();
	let sequence = 1;
	let root: number | null = null;
	let faulted: Error | null = null;
	let closed: Error | null = null;
	let disposeDeferred: Deferred<void> | null = null;
	let disposeIdentity: UniversalTransportIdentity | null = null;
	let disposeTerminal = false;
	let disposeAttempts = 0;

	const report = (value: unknown, fallback = TRANSPORT_ERROR): Error => {
		const error = normalizedError(value, fallback);
		reported.push(error);
		try {
			options.onDiagnostic?.(error);
		} catch (diagnosticError) {
			reported.push(normalizedError(diagnosticError, TRANSPORT_ERROR));
		}
		return error;
	};

	const dispatch = (
		message: Parameters<typeof encodeLynxCompiledProgramBackgroundMessage>[0],
	): void => {
		if (closed !== null) throw closed;
		const encoded = encodeLynxCompiledProgramBackgroundMessage(message);
		const frames = frameLynxTransportValue(encoded, sequence++);
		for (const data of frames) {
			context.dispatchEvent({ type: LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT, data });
		}
	};

	const failPending = (error: Error): void => {
		for (const entry of pending.values()) entry.deferred.reject(error);
		pending.clear();
	};

	const fault = (value: unknown): Error => {
		const error = report(value);
		faulted ??= error;
		ready.reject(error);
		failPending(error);
		return error;
	};

	const sendDispose = (): void => {
		if (disposeIdentity === null || disposeDeferred === null || disposeDeferred.settled) return;
		disposeAttempts++;
		try {
			dispatch({
				...disposeIdentity,
				type: disposeTerminal ? 'terminal-dispose' : 'dispose',
			});
		} catch (error) {
			disposeDeferred.reject(fault(error));
		}
	};

	const onMessage = (event: LynxContextProxyEvent): void => {
		if (closed !== null) return;
		let message;
		try {
			const encoded = acceptLynxTransportFrame(event.data, inbound);
			if (encoded === null) return;
			message = decodeLynxCompiledProgramMainMessage(encoded);
		} catch (error) {
			fault(error);
			return;
		}
		if (message.type === 'ready') {
			if (message.request !== readyRequest) {
				report(
					new Error(
						TRANSPORT_DEVELOPMENT
							? 'Octane Lynx compact transport received a foreign ready identity.'
							: TRANSPORT_ERROR,
					),
				);
				return;
			}
			ready.resolve(undefined);
			return;
		}
		if (message.type === 'dispose-ack' || message.type === 'dispose-retry') {
			if (
				disposeDeferred === null ||
				disposeIdentity === null ||
				message.root !== disposeIdentity.root ||
				message.version !== disposeIdentity.version
			) {
				report(
					new Error(
						TRANSPORT_DEVELOPMENT
							? 'Octane Lynx compact transport received a foreign dispose response.'
							: TRANSPORT_ERROR,
					),
				);
				return;
			}
			if (message.type === 'dispose-ack') {
				disposeDeferred.resolve(undefined);
				return;
			}
			if (disposeAttempts < MAX_DISPOSE_ATTEMPTS) sendDispose();
			else disposeDeferred.reject(remoteError(message.error));
			return;
		}
		const entry = pending.get(message.version);
		if (entry === undefined || message.root !== entry.identity.root) {
			report(
				new Error(
					TRANSPORT_DEVELOPMENT
						? 'Octane Lynx compact transport received a foreign settlement.'
						: TRANSPORT_ERROR,
				),
			);
			return;
		}
		if (message.type === 'ack') {
			if (entry.state !== 'sent') {
				fault(
					new Error(
						TRANSPORT_DEVELOPMENT
							? 'Octane Lynx compact transport received an out-of-order acknowledgement.'
							: TRANSPORT_ERROR,
					),
				);
				return;
			}
			try {
				entry.acknowledge(message);
				entry.state = 'acknowledged';
			} catch (error) {
				entry.deferred.reject(fault(error));
			}
			return;
		}
		pending.delete(message.version);
		if (message.type === 'complete') {
			if (entry.state !== 'acknowledged') {
				entry.deferred.reject(
					fault(
						new Error(
							TRANSPORT_DEVELOPMENT
								? 'Octane Lynx compact transport received completion before acknowledgement.'
								: TRANSPORT_ERROR,
						),
					),
				);
			} else entry.deferred.resolve(undefined);
			return;
		}
		const error = remoteError(message.error);
		entry.deferred.reject(message.type === 'fault' ? fault(error) : error);
	};

	context.addEventListener(LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT, onMessage);
	try {
		dispatch({ type: 'ready', request: readyRequest });
	} catch (error) {
		fault(error);
	}

	const transport: LynxCompiledProgramTransport = {
		ready: ready.promise,
		commit(
			identity: UniversalTransportIdentity,
			frame: readonly unknown[],
			acknowledge: (message: UniversalTransportAcknowledgement) => void,
		) {
			const deferred = createDeferred<void>();
			void deferred.promise.catch(() => {});
			if (closed !== null || faulted !== null) {
				deferred.reject(closed ?? faulted);
				return { promise: deferred.promise, abort() {} };
			}
			if (
				identity.protocol !== LYNX_TRANSPORT_PROTOCOL_VERSION ||
				identity.renderer !== LYNX_TRANSPORT_RENDERER ||
				!Number.isSafeInteger(identity.root) ||
				identity.root <= 0 ||
				!Number.isSafeInteger(identity.version) ||
				identity.version <= 0 ||
				!Array.isArray(frame)
			) {
				deferred.reject(
					new TypeError(
						TRANSPORT_DEVELOPMENT
							? 'Octane Lynx compact transport received an invalid commit.'
							: TRANSPORT_ERROR,
					),
				);
				return { promise: deferred.promise, abort() {} };
			}
			if ((root !== null && root !== identity.root) || pending.has(identity.version)) {
				deferred.reject(
					new Error(
						TRANSPORT_DEVELOPMENT
							? 'Octane Lynx compact transport received a foreign or duplicate commit.'
							: TRANSPORT_ERROR,
					),
				);
				return { promise: deferred.promise, abort() {} };
			}
			root ??= identity.root;
			const entry: PendingCommit = {
				identity: Object.freeze({ ...identity }),
				frame,
				acknowledge,
				deferred,
				state: 'waiting-ready',
			};
			pending.set(identity.version, entry);
			void ready.promise.then(
				() => {
					if (pending.get(identity.version) !== entry || entry.state !== 'waiting-ready') return;
					entry.state = 'sent';
					try {
						dispatch({ ...entry.identity, type: 'frame', frame: entry.frame });
					} catch (error) {
						pending.delete(identity.version);
						entry.deferred.reject(fault(error));
					}
				},
				(error) => entry.deferred.reject(error),
			);
			return {
				promise: deferred.promise,
				abort() {
					if (pending.get(identity.version) !== entry || entry.state === 'acknowledged') return;
					if (entry.state === 'waiting-ready') {
						pending.delete(identity.version);
						entry.deferred.reject(
							new Error(
								TRANSPORT_DEVELOPMENT
									? 'Octane Lynx compact commit was aborted before readiness.'
									: TRANSPORT_ERROR,
							),
						);
						return;
					}
					try {
						dispatch({ ...entry.identity, type: 'abort' });
					} catch (error) {
						pending.delete(identity.version);
						entry.deferred.reject(fault(error));
					}
				},
			};
		},
		dispose(identity: UniversalTransportIdentity, terminal = false) {
			if (disposeDeferred !== null && !disposeDeferred.settled) return disposeDeferred.promise;
			disposeDeferred = createDeferred<void>();
			void disposeDeferred.promise.catch(() => {});
			disposeIdentity = Object.freeze({ ...identity });
			disposeTerminal = terminal;
			disposeAttempts = 0;
			if (closed !== null || (faulted !== null && !terminal)) {
				disposeDeferred.reject(closed ?? faulted);
			} else {
				void ready.promise.then(sendDispose, (error) => disposeDeferred?.reject(error));
			}
			return disposeDeferred.promise;
		},
		diagnostics: () => Object.freeze([...reported]),
		close(value?: unknown) {
			if (closed !== null) return;
			closed = normalizedError(value, TRANSPORT_ERROR);
			context.removeEventListener(LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT, onMessage);
			ready.reject(closed);
			failPending(closed);
			disposeDeferred?.reject(closed);
		},
	};
	return Object.freeze(transport);
}
