declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import {
	type UniversalAsyncCommitTransport,
	type UniversalAsyncPreparedHostBatch,
	type UniversalEventPriority,
	type UniversalTransportEventDelivery,
	type UniversalTransportEventMessage,
	type UniversalTransportAcknowledgement,
	type UniversalTransportIdentity,
} from 'octane/universal/native';

import type { LynxBlockRoot } from './block-root.js';
import type { LynxClientContainer } from './client-driver.js';
import { createLynxCompiledProgramTransport } from './compiled-program-transport.js';
import { createLynxDeltaShadow } from './delta-shadow.js';
import type { LynxBackgroundNativeEventDelivery } from './native-event-receiver.js';
import {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	type LynxContextProxy,
} from './protocol.js';

const BLOCK_TRANSPORT_DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const BLOCK_TRANSPORT_ERROR = 'Octane Lynx OL494';
const MAX_DEFERRED_NATIVE_EVENT_DELIVERIES = 64;

interface DeferredNativeEventBatch {
	readonly deliveries: readonly LynxBackgroundNativeEventDelivery[];
	readonly priority: UniversalEventPriority;
}

export interface LynxCompiledProgramBlockTransport extends UniversalAsyncCommitTransport<LynxClientContainer> {
	readonly mode: 'async';
	readonly ready: Promise<void>;
	bindRoot(root: LynxBlockRoot): void;
	dispatchNativeEventBatch(deliveries: readonly LynxBackgroundNativeEventDelivery[]): void;
	acceptedIdentity(): UniversalTransportIdentity | null;
	ownedRoot(): number | null;
	dispose(): Promise<void>;
	diagnostics(): readonly Error[];
	close(error?: unknown): void;
}

export interface LynxCompiledProgramBlockTransportOptions {
	readonly onDiagnostic?: (error: Error) => void;
}

function normalizedError(value: unknown, fallback = BLOCK_TRANSPORT_ERROR): Error {
	return value instanceof Error ? value : new Error(value === undefined ? fallback : String(value));
}

function frozenIdentity(identity: UniversalTransportIdentity): UniversalTransportIdentity {
	return Object.freeze({
		protocol: identity.protocol,
		renderer: identity.renderer,
		root: identity.root,
		version: identity.version,
	});
}

/**
 * Adapt Block command batches to the compact compiled-program wire.
 *
 * The delta shadow is the capability boundary: a batch it cannot represent is
 * refused before any ContextProxy crossing. Its draft publishes only inside the
 * main-thread ACK callback, at the same irreversible point as the Block root's
 * listener journal. Native events may arrive after main installs a token but
 * before that ACK reaches background, so an unknown listener gets one in-flight
 * acknowledgement of grace rather than being run against the old tree or lost.
 */
export function createLynxCompiledProgramBlockTransport(
	context: LynxContextProxy,
	container: LynxClientContainer,
	options: LynxCompiledProgramBlockTransportOptions = {},
): LynxCompiledProgramBlockTransport {
	const reported: Error[] = [];
	const shadow = createLynxDeltaShadow();
	const wire = createLynxCompiledProgramTransport(context, {
		onDiagnostic(error) {
			reported.push(error);
			try {
				options.onDiagnostic?.(error);
			} catch (diagnosticError) {
				reported.push(normalizedError(diagnosticError));
			}
		},
	});
	let boundRoot: LynxBlockRoot | null = null;
	let ownedRoot: number | null = null;
	let accepted: UniversalTransportIdentity | null = null;
	let commitPending = false;
	let closed: Error | null = null;
	let deferredNativeEvents: DeferredNativeEventBatch[] = [];

	const report = (value: unknown): Error => {
		const error = normalizedError(value);
		reported.push(error);
		try {
			options.onDiagnostic?.(error);
		} catch (diagnosticError) {
			reported.push(normalizedError(diagnosticError));
		}
		return error;
	};

	const dispatchEvent = (batch: DeferredNativeEventBatch): boolean => {
		if (accepted === null || boundRoot === null) return false;
		for (const delivery of batch.deliveries) {
			if (!boundRoot.acceptsNativeEvent(delivery.identity.listener, batch.priority)) return false;
		}
		const deliveries: UniversalTransportEventDelivery[] = batch.deliveries.map((delivery) =>
			Object.freeze({ listener: delivery.identity.listener, payload: delivery.payload }),
		);
		const message: UniversalTransportEventMessage = Object.freeze({
			...accepted,
			type: 'event',
			priority: batch.priority,
			deliveries: Object.freeze(deliveries),
		});
		try {
			boundRoot.dispatchTransportEvent(message);
		} catch (error) {
			report(error);
		}
		return true;
	};

	const reportStale = (batch: DeferredNativeEventBatch): void => {
		const first = batch.deliveries[0]!.identity;
		report(
			new Error(
				BLOCK_TRANSPORT_DEVELOPMENT
					? `Octane Lynx compact transport received a stale native event for ${first.listener}.`
					: BLOCK_TRANSPORT_ERROR,
			),
		);
	};

	const flushDeferredNativeEvents = (): void => {
		const held = deferredNativeEvents;
		deferredNativeEvents = [];
		for (const batch of held) if (!dispatchEvent(batch)) reportStale(batch);
	};

	const dropDeferredNativeEvents = (): void => {
		const held = deferredNativeEvents;
		deferredNativeEvents = [];
		for (const batch of held) reportStale(batch);
	};

	const transport: LynxCompiledProgramBlockTransport = {
		mode: 'async',
		ready: wire.ready,
		prepareBatch(target, batch, identity): UniversalAsyncPreparedHostBatch {
			if (target !== container) {
				throw new Error(
					BLOCK_TRANSPORT_DEVELOPMENT
						? 'Octane Lynx compact Block transport received a foreign client container.'
						: BLOCK_TRANSPORT_ERROR,
				);
			}
			if (
				identity.protocol !== LYNX_TRANSPORT_PROTOCOL_VERSION ||
				identity.renderer !== LYNX_TRANSPORT_RENDERER ||
				identity.version !== batch.version
			) {
				throw new Error(
					BLOCK_TRANSPORT_DEVELOPMENT
						? 'Octane Lynx compact Block transport received a foreign batch identity.'
						: BLOCK_TRANSPORT_ERROR,
				);
			}
			if (closed !== null) throw closed;
			const draft = shadow.prepare(batch);
			if (draft === null) {
				throw new Error(
					BLOCK_TRANSPORT_DEVELOPMENT
						? 'Octane Lynx compact Block transport requires a fully addressed scalar program batch.'
						: BLOCK_TRANSPORT_ERROR,
				);
			}
			let state: 'prepared' | 'applying' | 'accepted' | 'aborted' = 'prepared';
			let attempt: ReturnType<typeof wire.commit> | null = null;
			return Object.freeze({
				apply(acknowledge: (message: UniversalTransportAcknowledgement) => void) {
					if (state !== 'prepared') {
						return Promise.reject(
							new Error(
								BLOCK_TRANSPORT_DEVELOPMENT
									? 'Octane Lynx compact Block batch apply() may only run once.'
									: BLOCK_TRANSPORT_ERROR,
							),
						);
					}
					state = 'applying';
					if (ownedRoot === null) ownedRoot = identity.root;
					else if (ownedRoot !== identity.root) {
						return Promise.reject(
							new Error(
								BLOCK_TRANSPORT_DEVELOPMENT
									? 'Octane Lynx compact Block transport cannot serve a foreign root.'
									: BLOCK_TRANSPORT_ERROR,
							),
						);
					}
					commitPending = true;
					attempt = wire.commit(identity, draft.encoded, (message) => {
						// Main publishes native ownership before it sends ACK. Publish the
						// matching shadow first too: `acknowledge` runs accepted lifecycle
						// work synchronously, and that work may prepare the next commit.
						// If local publication then faults, this identity still names real
						// main state and must remain available for terminal disposal.
						draft.commit();
						accepted = frozenIdentity(identity);
						state = 'accepted';
						commitPending = false;
						acknowledge(message);
						flushDeferredNativeEvents();
					});
					return attempt.promise.catch((error) => {
						commitPending = false;
						dropDeferredNativeEvents();
						throw error;
					});
				},
				abort() {
					if (state === 'prepared') state = 'aborted';
					else if (state === 'applying') attempt?.abort();
				},
			});
		},
		bindRoot(root) {
			if (boundRoot !== null && boundRoot !== root) {
				throw new Error(
					BLOCK_TRANSPORT_DEVELOPMENT
						? 'Octane Lynx compact Block transport is already bound to another root.'
						: BLOCK_TRANSPORT_ERROR,
				);
			}
			boundRoot = root;
		},
		dispatchNativeEventBatch(deliveries) {
			if (deliveries.length === 0) return;
			if (closed !== null) {
				report(closed);
				return;
			}
			const priority = deliveries[0]!.identity.priority;
			for (const delivery of deliveries) {
				if (delivery.identity.root !== ownedRoot || delivery.identity.priority !== priority) {
					report(
						new Error(
							BLOCK_TRANSPORT_DEVELOPMENT
								? 'Octane Lynx compact Block native event has a foreign root or mixed priority.'
								: BLOCK_TRANSPORT_ERROR,
						),
					);
					return;
				}
			}
			const batch = { deliveries: Object.freeze([...deliveries]), priority };
			if (dispatchEvent(batch)) return;
			if (!commitPending) {
				reportStale(batch);
				return;
			}
			const queued = deferredNativeEvents.reduce(
				(count, pending) => count + pending.deliveries.length,
				0,
			);
			if (queued + deliveries.length > MAX_DEFERRED_NATIVE_EVENT_DELIVERIES) {
				report(
					new Error(
						BLOCK_TRANSPORT_DEVELOPMENT
							? `Octane Lynx compact Block transport exceeded ${MAX_DEFERRED_NATIVE_EVENT_DELIVERIES} deferred native event deliveries.`
							: BLOCK_TRANSPORT_ERROR,
					),
				);
				return;
			}
			deferredNativeEvents.push(batch);
		},
		acceptedIdentity: () => accepted,
		ownedRoot: () => ownedRoot,
		async dispose() {
			if (accepted === null) {
				throw new Error(
					BLOCK_TRANSPORT_DEVELOPMENT
						? 'Octane Lynx compact Block transport cannot dispose before acceptance.'
						: BLOCK_TRANSPORT_ERROR,
				);
			}
			// Terminal disposal is also valid for a healthy active root and remains
			// available after an accepted ACK callback faults the background side.
			await wire.dispose(accepted, true);
			accepted = null;
			ownedRoot = null;
			dropDeferredNativeEvents();
		},
		diagnostics: () => Object.freeze([...reported]),
		close(value?: unknown) {
			if (closed !== null) return;
			closed = normalizedError(value);
			dropDeferredNativeEvents();
			wire.close(closed);
		},
	};
	return Object.freeze(transport);
}
