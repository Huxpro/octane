declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalTransportIdentity } from 'octane/universal/native';

import { applyLynxCompiledProgramFrame } from './compiled-program-frame.js';
import {
	decodeLynxCompiledProgramBackgroundMessage,
	encodeLynxCompiledProgramMainMessage,
	LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT,
	LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT,
} from './compiled-program-wire.js';
import { createLynxCompiledProgramStore } from './compiled-program-store.js';
import type {
	LynxCompiledProgramAdoptionSource,
	LynxCompiledProgramStore,
} from './compiled-program-store.js';
import type { LynxElementRef } from './papi.js';
import {
	createReplaceableLynxMainThreadWorkletRegistry,
	createUnavailableLynxMainThreadWorkletRegistry,
	subscribeLynxMainThreadWorkletFeature,
	type LynxMainThreadWorkletFeature,
} from './main-thread-worklet-feature.js';
import type {
	LynxActivatedMainThreadWorklet,
	LynxBackgroundFunctionDescriptor,
	LynxMainThreadWorkletDescriptor,
	LynxMainThreadWorkletRegistry,
	LynxWorkletValue,
} from './worklets.js';
import type {
	InstallLynxCompiledProgramReceiverOptions,
	LynxCompiledProgramReceiver,
} from './compiled-program-receiver.js';
import type { LynxContextProxyEvent } from './protocol.js';
import {
	acceptLynxTransportFrame,
	createLynxTransportFrameState,
	frameLynxTransportValue,
} from './transport-codec.js';

const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const CODE = 'Octane Lynx OL495';
const MAX_CLOSE_CLEANUP_ATTEMPTS = 3;

interface PendingBackgroundCall {
	readonly identity: UniversalTransportIdentity;
	readonly promise: Promise<unknown>;
	resolve(value: unknown): void;
	reject(error: unknown): void;
}

interface RunningMainCall {
	readonly identity: UniversalTransportIdentity;
	readonly active: LynxActivatedMainThreadWorklet;
	cancelled: boolean;
}

/** Native-owner seam for compact stores that do not operate on ordinary ElementRefs. */
export interface InstallLynxCompiledProgramProductHostOptions<Node extends object> {
	readonly context: InstallLynxCompiledProgramReceiverOptions<object>['context'];
	readonly page: Node;
	readonly resolveProgram: InstallLynxCompiledProgramReceiverOptions<object>['resolveProgram'];
	readonly adoption?: Pick<
		LynxCompiledProgramAdoptionSource<Node>,
		'firstListener' | 'verify' | 'finish' | 'dispose'
	>;
	readonly pageReady?: boolean;
	readonly onReady?: () => void;
	readonly onDiagnostic?: (error: Error) => void;
	createStore(
		root: number,
		onCallbackFault: (error: unknown) => void,
		worklets: LynxMainThreadWorkletRegistry,
	): LynxCompiledProgramStore<Node>;
	flush(): void;
}

/** Generated-build receiver with framing, settlement, and page ownership in one closure. */
export function installLynxCompiledProgramProductReceiver<Node extends object>(
	options:
		| InstallLynxCompiledProgramReceiverOptions<Node>
		| InstallLynxCompiledProgramProductHostOptions<Node>,
): LynxCompiledProgramReceiver {
	const { context, page } = options;
	const ordinaryPapi = 'papi' in options ? options.papi : null;
	const flush =
		'flush' in options ? options.flush : () => ordinaryPapi!.flush(page as Node & LynxElementRef);
	if (
		context === null ||
		typeof context !== 'object' ||
		typeof context.dispatchEvent !== 'function' ||
		typeof context.addEventListener !== 'function' ||
		typeof context.removeEventListener !== 'function'
	) {
		throw new TypeError(DEVELOPMENT ? 'Invalid compact ContextProxy.' : CODE);
	}
	const inbound = createLynxTransportFrameState();
	let sequence = 1;
	let readiness = options.pageReady === true ? 1 : 0;
	let readyRequest: number | null = null;
	let store = null as LynxCompiledProgramStore<Node> | null;
	let active: UniversalTransportIdentity | null = null;
	let aborted: UniversalTransportIdentity | null = null;
	let disposed: UniversalTransportIdentity | null = null;
	let busy = false;
	let faulted = false;
	let closed = false;
	let pendingAdoption = options.adoption;
	let workletFeature: LynxMainThreadWorkletFeature | null = null;
	let worklets: LynxMainThreadWorkletRegistry = createUnavailableLynxMainThreadWorkletRegistry();
	const hostWorklets = createReplaceableLynxMainThreadWorkletRegistry(worklets);
	let uninstallWorkletRegistry: (() => void) | null = null;
	let uninstallCallBridge: (() => void) | null = null;
	let unsubscribeWorkletFeature: (() => void) | null = null;
	const hostGlobals = globalThis as unknown as Record<string, unknown>;
	const previousRunWorklet = hostGlobals.runWorklet;
	const hostOwnedRunWorklet = Object.prototype.hasOwnProperty.call(hostGlobals, 'runWorklet');
	const installedRunWorklet = (
		descriptor: LynxMainThreadWorkletDescriptor,
		args?: readonly unknown[],
	): unknown => hostWorklets.runWorklet(descriptor, args);
	const pendingBackgroundCalls = new Map<number, PendingBackgroundCall>();
	const runningMainCalls = new Map<number, RunningMainCall>();
	let nextCall = 1;

	const report = (value: unknown): Error => {
		const error =
			value instanceof Error ? value : new Error(value === undefined ? CODE : String(value));
		try {
			options.onDiagnostic?.(error);
		} catch {}
		return error;
	};
	const release = (candidate: NonNullable<typeof store>): void => {
		for (let attempt = 0; attempt < MAX_CLOSE_CLEANUP_ATTEMPTS; attempt++) {
			try {
				candidate.dispose();
				flush();
				return;
			} catch (error) {
				report(error);
			}
		}
	};
	const send = (message: Parameters<typeof encodeLynxCompiledProgramMainMessage>[0]): boolean => {
		try {
			const encoded = encodeLynxCompiledProgramMainMessage(message);
			const frames = frameLynxTransportValue(encoded, sequence++);
			for (const data of frames) {
				context.dispatchEvent({ type: LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT, data });
			}
			return true;
		} catch (error) {
			faulted = true;
			report(error);
			return false;
		}
	};
	// The compact decoder has already replaced protocol/renderer with this wire's
	// constants; only the two transmitted identity fields can differ here.
	const same = (left: UniversalTransportIdentity, right: UniversalTransportIdentity): boolean =>
		left.root === right.root && left.version === right.version;
	const reject = (identity: UniversalTransportIdentity, value: unknown): void => {
		const error = report(value);
		send({ ...identity, type: 'reject', error });
	};
	const publishReady = (): void => {
		if (!closed && readyRequest !== null && readiness === 3) {
			if (send({ type: 'ready', request: readyRequest })) {
				readiness = 4;
				try {
					options.onReady?.();
				} catch (error) {
					report(error);
				}
			}
		}
	};
	const onStoreCallbackFault = (value: unknown): void => {
		if (closed || faulted) return;
		faulted = true;
		const error = report(value);
		if (active !== null) send({ ...active, type: 'fault', error });
	};
	function callBackground<Result>(
		fn: LynxBackgroundFunctionDescriptor,
		args: readonly LynxWorkletValue[],
	): { readonly promise: Promise<Result>; cancel(reason?: unknown): void } {
		let resolve!: (value: unknown) => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<unknown>((onResolve, onReject) => {
			resolve = onResolve;
			reject = onReject;
		});
		void promise.catch(() => {});
		if (active === null || closed || faulted) {
			reject(new Error(DEVELOPMENT ? 'Compact background call requires an active root.' : CODE));
			return { promise: promise as Promise<Result>, cancel() {} };
		}
		const call = nextCall++;
		if (!Number.isSafeInteger(call)) {
			reject(new Error(DEVELOPMENT ? 'Compact background call ids are exhausted.' : CODE));
			return { promise: promise as Promise<Result>, cancel() {} };
		}
		const entry: PendingBackgroundCall = {
			identity: Object.freeze({ ...active }),
			promise,
			resolve,
			reject,
		};
		pendingBackgroundCalls.set(call, entry);
		if (
			!send({
				...entry.identity,
				type: 'call-background',
				call,
				fn: fn as never,
				args: args as never,
			})
		) {
			pendingBackgroundCalls.delete(call);
			reject(new Error(CODE));
		}
		return {
			promise: promise as Promise<Result>,
			cancel(reason?: unknown) {
				if (pendingBackgroundCalls.get(call) !== entry) return;
				pendingBackgroundCalls.delete(call);
				send({ ...entry.identity, type: 'cancel-background', call });
				const error =
					reason instanceof Error
						? reason
						: new Error(
								reason === undefined ? 'Compact background call was cancelled.' : String(reason),
							);
				if (reason === undefined) error.name = 'AbortError';
				reject(error);
			},
		};
	}
	const installWorkletFeature = (feature: LynxMainThreadWorkletFeature): void => {
		if (workletFeature === feature) return;
		if (workletFeature !== null)
			throw new Error(DEVELOPMENT ? 'Compact worklet feature changed after install.' : CODE);
		const registry = feature.createRegistry({
			callBackground: (fn, args) => callBackground(fn, args).promise,
		});
		let uninstall: (() => void) | null = null;
		let uninstallBridge: (() => void) | null = null;
		try {
			uninstall = feature.installRegistry(registry);
			uninstallBridge = feature.installCallBridge({ callBackground });
			workletFeature = feature;
			worklets = registry;
			hostWorklets.replace(registry);
			uninstallWorkletRegistry = uninstall;
			uninstallCallBridge = uninstallBridge;
		} catch (error) {
			uninstallBridge?.();
			uninstall?.();
			registry.close();
			throw error;
		}
	};
	const cancelCalls = (reason: Error, notifyBackground: boolean): void => {
		for (const [call, entry] of pendingBackgroundCalls) {
			if (notifyBackground) send({ ...entry.identity, type: 'cancel-background', call });
			entry.reject(reason);
		}
		pendingBackgroundCalls.clear();
		for (const entry of runningMainCalls.values()) {
			entry.cancelled = true;
			worklets.release(entry.active);
		}
		runningMainCalls.clear();
	};
	const closeWorklets = (): void => {
		unsubscribeWorkletFeature?.();
		unsubscribeWorkletFeature = null;
		cancelCalls(new Error(DEVELOPMENT ? 'Compact worklet receiver closed.' : CODE), false);
		uninstallCallBridge?.();
		uninstallCallBridge = null;
		uninstallWorkletRegistry?.();
		uninstallWorkletRegistry = null;
		worklets.close();
		if (hostGlobals.runWorklet === installedRunWorklet) {
			if (hostOwnedRunWorklet) hostGlobals.runWorklet = previousRunWorklet;
			else delete hostGlobals.runWorklet;
		}
	};

	const onMessage = (event: LynxContextProxyEvent): void => {
		if (closed) return;
		let message;
		try {
			const encoded = acceptLynxTransportFrame(event.data, inbound);
			if (encoded === null) return;
			message = decodeLynxCompiledProgramBackgroundMessage(encoded);
		} catch (error) {
			report(error);
			return;
		}
		if (message.type === 'ready') {
			if (readyRequest !== null && readyRequest !== message.request) report(CODE);
			else {
				readyRequest = message.request;
				publishReady();
			}
			return;
		}
		if (readiness !== 4) {
			report(CODE);
			return;
		}
		if (message.type === 'call-background-result' || message.type === 'call-background-error') {
			const entry = pendingBackgroundCalls.get(message.call);
			if (
				entry === undefined ||
				message.root !== entry.identity.root ||
				message.version !== entry.identity.version
			) {
				report(CODE);
				return;
			}
			pendingBackgroundCalls.delete(message.call);
			if (message.type === 'call-background-result') entry.resolve(message.value);
			else {
				const error = new Error(message.error.message);
				error.name = message.error.name;
				entry.reject(error);
			}
			return;
		}
		if (message.type === 'cancel-main') {
			const running = runningMainCalls.get(message.call);
			if (
				running !== undefined &&
				message.root === running.identity.root &&
				message.version === running.identity.version
			) {
				running.cancelled = true;
				runningMainCalls.delete(message.call);
				worklets.release(running.active);
			}
			return;
		}
		if (message.type === 'call-main') {
			if (active === null || !same(active, message) || runningMainCalls.has(message.call)) {
				report(
					DEVELOPMENT
						? new Error(
								active === null
									? 'Compact main call requires an active root.'
									: runningMainCalls.has(message.call)
										? 'Compact main call id is already running.'
										: 'Compact main call targets ' +
											message.root +
											':' +
											message.version +
											', but ' +
											active.root +
											':' +
											active.version +
											' is active.',
							)
						: CODE,
				);
				return;
			}
			let activated: LynxActivatedMainThreadWorklet;
			try {
				activated = worklets.activate(message.worklet as LynxMainThreadWorkletDescriptor);
			} catch (error) {
				const failure = report(error);
				send({
					...message,
					type: 'call-main-error',
					error: { name: failure.name, message: failure.message },
				});
				return;
			}
			const running: RunningMainCall = {
				identity: Object.freeze({ ...active }),
				active: activated,
				cancelled: false,
			};
			runningMainCalls.set(message.call, running);
			let result: unknown;
			try {
				result = worklets.runWorklet(activated, message.args);
			} catch (error) {
				runningMainCalls.delete(message.call);
				worklets.release(activated);
				const failure = report(error);
				send({
					...running.identity,
					type: 'call-main-error',
					call: message.call,
					error: { name: failure.name, message: failure.message },
				});
				return;
			}
			void Promise.resolve(result).then(
				(value) => {
					if (runningMainCalls.get(message.call) !== running || running.cancelled || closed) return;
					runningMainCalls.delete(message.call);
					worklets.release(activated);
					try {
						const isolated = workletFeature!.isolateValue(
							value as LynxWorkletValue,
							'compact main call result',
						);
						send({
							...running.identity,
							type: 'call-main-result',
							call: message.call,
							value: isolated as never,
						});
					} catch (error) {
						const failure = report(error);
						send({
							...running.identity,
							type: 'call-main-error',
							call: message.call,
							error: { name: failure.name, message: failure.message },
						});
					}
				},
				(error) => {
					if (runningMainCalls.get(message.call) !== running || running.cancelled || closed) return;
					runningMainCalls.delete(message.call);
					worklets.release(activated);
					const failure = report(error);
					send({
						...running.identity,
						type: 'call-main-error',
						call: message.call,
						error: { name: failure.name, message: failure.message },
					});
				},
			);
			return;
		}
		if (message.type === 'abort') {
			if (
				faulted ||
				(active !== null && (message.root !== active.root || message.version <= active.version))
			) {
				report(CODE);
			} else aborted = message;
			return;
		}
		if (message.type === 'dispose' || message.type === 'terminal-dispose') {
			if (busy) {
				report(CODE);
				return;
			}
			if (active === null) {
				if (
					message.type !== 'terminal-dispose' &&
					(disposed === null || !same(disposed, message))
				) {
					report(CODE);
					return;
				}
			} else if (
				message.root !== active.root ||
				(message.type === 'terminal-dispose'
					? message.version < active.version
					: message.version !== active.version)
			) {
				report(CODE);
				return;
			}
			busy = true;
			try {
				if (store !== null) {
					store.dispose();
					flush();
				}
			} catch (error) {
				busy = false;
				const failure = report(error);
				send({
					...message,
					type: 'dispose-retry',
					error: failure,
				});
				return;
			}
			busy = false;
			cancelCalls(new Error(DEVELOPMENT ? 'Compact root was disposed.' : CODE), true);
			store = null;
			active = null;
			aborted = null;
			disposed = message;
			send({ ...message, type: 'dispose-ack' });
			return;
		}
		if (message.type !== 'frame') return;
		if (
			faulted ||
			busy ||
			disposed?.root === message.root ||
			(active === null
				? message.version !== 1
				: message.root !== active.root || message.version !== active.version + 1)
		) {
			reject(message, CODE);
			return;
		}
		if (aborted !== null && same(aborted, message)) {
			aborted = null;
			reject(message, CODE);
			return;
		}
		const candidate =
			store ??
			('createStore' in options
				? options.createStore(message.root, onStoreCallbackFault, hostWorklets)
				: createLynxCompiledProgramStore(
						ordinaryPapi!,
						ordinaryPapi!.getUniqueId(page),
						message.root,
						pendingAdoption?.firstListener,
						options.adoption?.resolveSeed,
						onStoreCallbackFault,
						undefined,
						hostWorklets,
					));
		busy = true;
		try {
			applyLynxCompiledProgramFrame(candidate, page, options.resolveProgram, message.frame, () => {
				if (closed) throw new Error(CODE);
				if (aborted !== null && same(aborted, message)) {
					aborted = null;
					throw new Error(CODE);
				}
				pendingAdoption?.verify();
				// ContextProxy delivery does not publish Element PAPI writes. Flush
				// before committing so a failed publication remains retryable.
				flush();
				if (closed) throw new Error(CODE);
				if (aborted !== null && same(aborted, message)) {
					aborted = null;
					throw new Error(CODE);
				}
			});
		} catch (error) {
			busy = false;
			let rollbackFlushError: unknown = null;
			try {
				flush();
			} catch (flushError) {
				rollbackFlushError = flushError;
			}
			if (closed) {
				release(candidate);
				store = null;
				active = null;
				aborted = null;
				if (candidate.isFaulted()) report(error);
				return;
			}
			if (candidate.isFaulted() || rollbackFlushError !== null) {
				store = candidate;
				active = message;
				faulted = true;
				const failure = report(
					rollbackFlushError === null
						? error
						: new AggregateError(
								[error, rollbackFlushError],
								'Compact frame rollback flush failed.',
							),
				);
				send({
					...message,
					type: 'fault',
					error: failure,
				});
			} else reject(message, error);
			return;
		}
		busy = false;
		if (closed) {
			release(candidate);
			store = null;
			active = null;
			aborted = null;
			return;
		}
		pendingAdoption?.finish();
		pendingAdoption = undefined;
		store = candidate;
		active = message;
		if (send({ ...message, type: 'ack' })) send({ ...message, type: 'complete' });
	};

	const mark = (gate: number): void => {
		if (!closed && readiness <= 3 && (readiness & gate) === 0) {
			readiness |= gate;
			publishReady();
		}
	};
	try {
		unsubscribeWorkletFeature = subscribeLynxMainThreadWorkletFeature(installWorkletFeature);
		hostGlobals.runWorklet = installedRunWorklet;
	} catch (error) {
		closeWorklets();
		throw error;
	}
	context.addEventListener(LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT, onMessage);
	return {
		markProgramsReady: () => mark(2),
		markPageReady: () => mark(1),
		publishLifecycle: (message) => !closed && readiness === 4 && send(message),
		destroyPage() {
			if (closed) return;
			send({ type: 'page-destroy' });
			closed = true;
			if (!busy && store !== null) release(store);
			store = null;
			pendingAdoption?.dispose();
			pendingAdoption = undefined;
			active = null;
			aborted = null;
			context.removeEventListener(LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT, onMessage);
			closeWorklets();
		},
		close() {
			if (closed || busy) return;
			if (store !== null) {
				store.dispose();
				flush();
			}
			pendingAdoption?.dispose();
			pendingAdoption = undefined;
			closed = true;
			context.removeEventListener(LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT, onMessage);
			closeWorklets();
		},
	};
}
