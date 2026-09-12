declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import {
	type UniversalAsyncCommitTransport,
	type UniversalAsyncPreparedHostBatch,
	type UniversalEventPriority,
	type UniversalHostBatch,
	type UniversalTransportEventDelivery,
	type UniversalTransportEventMessage,
	type UniversalTransportAcknowledgement,
	type UniversalTransportIdentity,
} from 'octane/universal/native';

import type { LynxBlockRoot } from './block-root.js';
import {
	setLynxClientCapabilities,
	setLynxClientProgramManifests,
	type LynxClientContainer,
} from './client-driver.js';
import { createLynxCompiledProgramTransport } from './compiled-program-transport.js';
import { createLynxDeltaShadow } from './delta-shadow.js';
import type { LynxBackgroundNativeEventDelivery } from './native-event-receiver.js';
import type { LynxDataLifecycleMessage } from './lifecycle-types.js';
import { LYNX_TRANSPORT_PROTOCOL_VERSION, LYNX_TRANSPORT_RENDERER } from './transport-identity.js';
import type { LynxContextProxy } from './protocol.js';

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
	bindRoot(root: Pick<LynxBlockRoot, 'acceptsNativeEvent' | 'dispatchTransportEvent'>): void;
	bindPageDestroy(handler: () => void | Promise<void>): void;
	dispatchNativeEventBatch(deliveries: readonly LynxBackgroundNativeEventDelivery[]): void;
	acceptedIdentity(): UniversalTransportIdentity | null;
	ownedRoot(): number | null;
	cancelPendingBeforeReady(reason?: unknown): Promise<boolean>;
	preparationCount(): number;
	closedReason(): Error | null;
	enableLogicalTeardown(): void;
	dispose(): Promise<void>;
	diagnostics(): readonly Error[];
	close(error?: unknown): void;
}

export interface LynxCompiledProgramBlockTransportOptions {
	readonly onDiagnostic?: (error: Error) => void;
	readonly isPageDestroyed?: () => boolean;
	readonly onLifecycle?: (message: LynxDataLifecycleMessage) => void;
	readonly onPageDestroy?: () => void;
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
	// This transport is itself the paired capability proof: unlike the general
	// handshake there is no legacy first-tree frame to carry, so the first Block
	// render must emit its addressed run rather than expanding it to host commands.
	setLynxClientCapabilities(container, {
		compactAck: 1,
		templateMount: 1,
		templateProgram: 1,
		templateRuns: 1,
		addressedProgramRuns: 1,
	});
	setLynxClientProgramManifests(container, false);
	const reported: Error[] = [];
	const shadow = createLynxDeltaShadow();
	const wire = createLynxCompiledProgramTransport(context, {
		isPageDestroyed: options.isPageDestroyed,
		onLifecycle: options.onLifecycle,
		onPageDestroy: options.onPageDestroy,
		onDiagnostic(error) {
			reported.push(error);
			try {
				options.onDiagnostic?.(error);
			} catch (diagnosticError) {
				reported.push(normalizedError(diagnosticError));
			}
		},
	});
	let boundRoot: Pick<LynxBlockRoot, 'acceptsNativeEvent' | 'dispatchTransportEvent'> | null = null;
	let ownedRoot: number | null = null;
	let accepted: UniversalTransportIdentity | null = null;
	let commitPending = false;
	let closed: Error | null = null;
	let preparations = 0;
	let logicalTeardownEnabled = false;
	let pageDestroyReceived = false;
	let pageDestroyHandler: (() => void | Promise<void>) | null = null;
	let pageDestroyHandlerInvoked = false;
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

	const queuePageDestroyHandler = (): void => {
		if (!pageDestroyReceived || pageDestroyHandler === null || pageDestroyHandlerInvoked) return;
		pageDestroyHandlerInvoked = true;
		const handler = pageDestroyHandler;
		void Promise.resolve()
			.then(() => handler())
			.catch((error) => {
				report(error);
			});
	};

	const handlePageDestroy = (): void => {
		if (pageDestroyReceived) return;
		pageDestroyReceived = true;
		logicalTeardownEnabled = true;
		closed ??= new Error(
			BLOCK_TRANSPORT_DEVELOPMENT
				? 'Octane Lynx native page lifetime was destroyed.'
				: BLOCK_TRANSPORT_ERROR,
		);
		commitPending = false;
		dropDeferredNativeEvents();
		queuePageDestroyHandler();
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
			preparations++;
			if (closed !== null) {
				if (!logicalTeardownEnabled || !isLogicalTeardownBatch(batch)) throw closed;
				if (
					identity.protocol !== LYNX_TRANSPORT_PROTOCOL_VERSION ||
					identity.renderer !== LYNX_TRANSPORT_RENDERER ||
					identity.version !== batch.version ||
					!Number.isSafeInteger(identity.root) ||
					identity.root <= 0
				) {
					throw new Error(
						BLOCK_TRANSPORT_DEVELOPMENT
							? 'Octane Lynx compact logical teardown received a foreign identity.'
							: BLOCK_TRANSPORT_ERROR,
					);
				}
				let state: 'prepared' | 'applied' | 'aborted' = 'prepared';
				return Object.freeze({
					apply(acknowledge: (message: UniversalTransportAcknowledgement) => void) {
						if (state !== 'prepared') {
							return Promise.reject(
								new Error(
									BLOCK_TRANSPORT_DEVELOPMENT
										? 'Octane Lynx compact logical teardown apply() may only run once.'
										: BLOCK_TRANSPORT_ERROR,
								),
							);
						}
						state = 'applied';
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
						if (state === 'prepared') state = 'aborted';
					},
				});
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
			const draft = shadow.prepare(batch);
			if (draft === null) {
				throw new Error(
					BLOCK_TRANSPORT_DEVELOPMENT
						? `Octane Lynx compact Block transport requires a fully addressed scalar program batch; received ${batch.commands
								.map((command) => command.op)
								.join(', ')}.`
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
		bindPageDestroy(handler) {
			if (typeof handler !== 'function') {
				throw new TypeError(
					BLOCK_TRANSPORT_DEVELOPMENT
						? 'Octane Lynx compact page-destroy handler must be a function.'
						: BLOCK_TRANSPORT_ERROR,
				);
			}
			if (pageDestroyHandler !== null && pageDestroyHandler !== handler) {
				throw new Error(
					BLOCK_TRANSPORT_DEVELOPMENT
						? 'Octane Lynx compact transport already has a page-destroy handler.'
						: BLOCK_TRANSPORT_ERROR,
				);
			}
			pageDestroyHandler = handler;
			queuePageDestroyHandler();
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
		async cancelPendingBeforeReady(value?: unknown) {
			if (closed !== null || accepted !== null || !commitPending) return false;
			const reason = normalizedError(
				value,
				BLOCK_TRANSPORT_DEVELOPMENT
					? 'Octane Lynx root was unmounted before compact main became ready.'
					: BLOCK_TRANSPORT_ERROR,
			);
			const cancelled = await wire.cancelPendingBeforeReady(reason);
			if (!cancelled) return false;
			closed = reason;
			commitPending = false;
			dropDeferredNativeEvents();
			return true;
		},
		preparationCount: () => preparations,
		closedReason: () => closed,
		enableLogicalTeardown() {
			logicalTeardownEnabled = true;
		},
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
	void wire.pageDestroyed.then(handlePageDestroy);
	return Object.freeze(transport);
}
