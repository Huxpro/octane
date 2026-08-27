import {
	createUniversalRoot,
	type UniversalComponent,
	type UniversalHostBatch,
	type UniversalPreparedAttempt,
	type UniversalTransportIdentity,
} from 'octane/universal/native';
import type { LynxComponent } from './intrinsics.js';
import {
	createLynxClientContainer,
	createLynxClientDriver,
	getLynxClientWorkletBatchExecutions,
	prepareLynxClientWorkletBatch,
	type LynxClientContainer,
	type LynxPublicHandle,
} from './core/client-driver.js';
import { prepareLynxBackgroundLifecycleReceiver } from './core/background-lifecycle.js';
import { installLynxNativeEventReceiver } from './core/native-event-receiver.js';
import { createLynxBackgroundTransport, type LynxBackgroundTransport } from './core/transport.js';
import type { LynxContextProxy, LynxMainThreadWorkletWireDescriptor } from './core/protocol.js';
import type { LynxCreateSelectorQuery } from './core/nodes-ref.js';
import {
	LYNX_BLOCK_BACKGROUND_CORE,
	lynxEnvironmentIsInjected,
	readAmbientQueueMicrotask,
	readLynxEnvironment,
} from './core/environment.js';
import { createLynxBlockBackgroundCore, type LynxBackgroundCore } from './core/block-background.js';
import {
	createLynxBackgroundFunctionRegistry,
	installBackgroundCallBridge,
	type LynxBackgroundFunctionDescriptor,
	type LynxWorkletValue,
} from './core/worklets.js';
import type { Lynx } from './platform.js';

interface LynxBackgroundGlobals {
	readonly lynx?: {
		getCoreContext?(): LynxContextProxy;
		getJSModule?(name: string): unknown;
		queueMicrotask?(callback: () => void): void;
		createSelectorQuery?: LynxCreateSelectorQuery;
	};
	readonly queueMicrotask?: (callback: () => void) => void;
}

export interface CreateLynxRootOptions {
	/** Background-thread global object. Defaults to the current Lynx wrapper environment. */
	readonly target?: object;
	/** Explicit public ContextProxy, primarily for framework bootstrap and tests. */
	readonly context?: LynxContextProxy;
	/** Explicit scheduler when neither Lynx nor the JS runtime supplies one. */
	readonly scheduleMicrotask?: (callback: () => void) => void;
	readonly onDiagnostic?: (error: Error) => void;
}

export interface LynxRoot {
	readonly renderer: 'lynx';
	readonly ready: Promise<void>;
	render<Props>(component: LynxComponent<Props>, props?: Props): Promise<UniversalPreparedAttempt>;
	flushTransport(): Promise<void>;
	unmount(): Promise<void>;
}

interface LynxRootState {
	readonly transport: LynxBackgroundTransport;
	closeWorklets(): void;
	status: 'active' | 'unmounting' | 'unmounted';
	unmount: Promise<void> | null;
}

function readBackgroundGlobals(target: object): LynxBackgroundGlobals {
	if (target === null || typeof target !== 'object') {
		throw new TypeError('Octane Lynx root target must be a background-thread global object.');
	}
	const globals = target as LynxBackgroundGlobals;
	if (typeof globals.lynx?.getJSModule !== 'function') {
		throw new Error('Octane Lynx roots are available only in the Lynx background runtime.');
	}
	return globals;
}

function defaultBackgroundTarget(): object {
	// An ordinary global host keeps globalThis as the target: nothing is
	// allocated, every ambient binding stays reachable, and ambient functions
	// keep their original receiver. Only the official wrapper's lexical-only
	// injection needs a synthetic target.
	if (!lynxEnvironmentIsInjected()) return globalThis;
	const queueMicrotask = readAmbientQueueMicrotask();
	const lynx = readLynxEnvironment();
	return queueMicrotask === undefined ? { lynx } : { lynx, queueMicrotask };
}

function resolveContext(
	target: LynxBackgroundGlobals,
	explicit?: LynxContextProxy,
): LynxContextProxy {
	if (explicit !== undefined) return explicit;
	const getCoreContext = target.lynx?.getCoreContext;
	if (typeof getCoreContext !== 'function') {
		throw new Error('Octane Lynx requires the public background-thread lynx.getCoreContext() API.');
	}
	return getCoreContext.call(target.lynx);
}

function resolveMicrotaskScheduler(
	target: LynxBackgroundGlobals,
	explicit?: (callback: () => void) => void,
): (callback: () => void) => void {
	if (explicit !== undefined) {
		if (typeof explicit !== 'function') {
			throw new TypeError('Octane Lynx scheduleMicrotask must be a function.');
		}
		return explicit;
	}
	const lynxScheduler = target.lynx?.queueMicrotask;
	if (typeof lynxScheduler === 'function') {
		return (callback) => lynxScheduler.call(target.lynx, callback);
	}
	if (typeof target.queueMicrotask === 'function') {
		return (callback) => target.queueMicrotask!(callback);
	}
	throw new Error(
		'Octane Lynx requires lynx.queueMicrotask() or createLynxRoot({ scheduleMicrotask }).',
	);
}

function identityAdvanced(
	previous: UniversalTransportIdentity | null,
	next: UniversalTransportIdentity | null,
): boolean {
	return (
		next !== null &&
		(previous === null || previous.root !== next.root || previous.version !== next.version)
	);
}

/** Create one background-owned root and its isolated async transport state. */
export function createLynxRoot(options: CreateLynxRootOptions = {}): LynxRoot {
	const target = readBackgroundGlobals(options.target ?? defaultBackgroundTarget());
	const context = resolveContext(target, options.context);
	const scheduleMicrotask = resolveMicrotaskScheduler(target, options.scheduleMicrotask);
	const createSelectorQuery = target.lynx?.createSelectorQuery;
	const worklets = createLynxBackgroundFunctionRegistry();
	const acceptedWorklets = new Map<number, ReadonlySet<string>>();
	const acceptedExecutionCounts = new Map<string, number>();
	const retainAcceptedExecution = (execution: string): void => {
		acceptedExecutionCounts.set(execution, (acceptedExecutionCounts.get(execution) ?? 0) + 1);
	};
	const releaseAcceptedExecution = (execution: string): void => {
		const count = acceptedExecutionCounts.get(execution);
		if (count === undefined) return;
		if (count === 1) acceptedExecutionCounts.delete(execution);
		else acceptedExecutionCounts.set(execution, count - 1);
	};
	const acceptWorkletBatch = (batch: UniversalHostBatch): void => {
		const executions = getLynxClientWorkletBatchExecutions(batch);
		if (executions === undefined && acceptedWorklets.size === 0) return;
		let releaseCandidates: Set<string> | undefined;
		// Ownership is per host, so one template run assigns to as many hosts as it
		// installed callbacks on and each is replaced or destroyed on its own.
		const assign = (id: number, ids: ReadonlySet<string> | undefined): void => {
			const previous = acceptedWorklets.get(id);
			if (previous !== undefined) {
				for (const execution of previous) {
					releaseAcceptedExecution(execution);
					(releaseCandidates ??= new Set()).add(execution);
				}
			}
			if (ids === undefined) {
				if (previous !== undefined) acceptedWorklets.delete(id);
				return;
			}
			acceptedWorklets.set(id, ids);
			for (const execution of ids) {
				retainAcceptedExecution(execution);
				(releaseCandidates ??= new Set()).add(execution);
			}
		};
		for (let index = 0; index < batch.commands.length; index++) {
			const command = batch.commands[index]!;
			if (command.op === 'create' || command.op === 'update' || command.op === 'recreate') {
				assign(command.id, executions?.get(index)?.get(command.id));
			} else if (command.op === 'mount-template-run' || command.op === 'mount-template-range') {
				const owners = executions?.get(index);
				if (owners !== undefined) for (const [id, ids] of owners) assign(id, ids);
			} else if (command.op === 'destroy') {
				assign(command.id, undefined);
			} else if (command.op === 'destroy-run') {
				// A run retires as one command and ships no per-host `destroy` for the
				// hosts inside it: the driver derives their teardown from the program
				// it already holds. Ownership here is still per host, so the release
				// those absent commands would have driven has to be found another way,
				// or every callback the row installed outlives the row.
				//
				// Walking the id range would put back the per-host loop this command
				// exists to remove, and at a thousand rows that is the loop that
				// matters. Worklet owners are usually the thinner side, so the walk
				// goes whichever way is shorter; deleting the current key mid-iteration
				// is the one Map mutation the iterator is defined to tolerate.
				const end = command.firstId + command.count * command.width;
				if (end - command.firstId <= acceptedWorklets.size) {
					for (let id = command.firstId; id < end; id++) assign(id, undefined);
				} else {
					for (const id of acceptedWorklets.keys()) {
						if (id >= command.firstId && id < end) assign(id, undefined);
					}
				}
			}
		}
		if (releaseCandidates !== undefined) {
			for (const execution of releaseCandidates) {
				if (!acceptedExecutionCounts.has(execution)) worklets.release(execution);
			}
		}
	};
	const rejectWorkletBatch = (batch: UniversalHostBatch): void => {
		const executions = getLynxClientWorkletBatchExecutions(batch);
		if (executions === undefined) return;
		for (const owners of executions.values()) {
			for (const ids of owners.values()) {
				for (const execution of ids) {
					if (!acceptedExecutionCounts.has(execution)) worklets.release(execution);
				}
			}
		}
	};
	const container = createLynxClientContainer({
		createSelectorQuery:
			typeof createSelectorQuery === 'function'
				? () => createSelectorQuery.call(target.lynx)
				: undefined,
		worklets,
	});
	const lifecycleInstallation = (() => {
		try {
			return prepareLynxBackgroundLifecycleReceiver(
				target.lynx as unknown as Lynx,
				context,
				options.onDiagnostic,
			);
		} catch (error) {
			worklets.close();
			throw error;
		}
	})();
	const transport = (() => {
		try {
			return createLynxBackgroundTransport(context, container, {
				onDiagnostic: options.onDiagnostic,
				isPageDestroyed: lifecycleInstallation.isPageDestroyed,
				prepareWorkletBatch: (batch) => prepareLynxClientWorkletBatch(container, batch),
				onWorkletBatchAccepted: acceptWorkletBatch,
				onWorkletBatchRejected: rejectWorkletBatch,
				executeBackgroundFunction(fn, args) {
					return worklets.run(fn as LynxBackgroundFunctionDescriptor, args);
				},
			});
		} catch (error) {
			lifecycleInstallation.rollback();
			worklets.close();
			throw error;
		}
	})();
	// The compile-time core switch (issue #103 B0). `LYNX_BLOCK_BACKGROUND_CORE`
	// folds to a literal from the build plugin's `core` option, so exactly one
	// arm survives in a production bundle and the other core's whole closure
	// tree-shakes out. Everything around this — container, worklets, transport,
	// lifecycle, native events — is shared, because only the core differs.
	const backgroundCore: LynxBackgroundCore = (() => {
		try {
			const root = LYNX_BLOCK_BACKGROUND_CORE
				? createLynxBlockBackgroundCore({ container, transport })
				: createUniversalRoot<LynxClientContainer, LynxPublicHandle>(
						container,
						createLynxClientDriver(container),
						{ scheduleMicrotask, transport },
					);
			transport.bindRoot(root);
			return root;
		} catch (error) {
			lifecycleInstallation.rollback();
			transport.close(error);
			worklets.close();
			throw error;
		}
	})();
	let uninstallCallBridge: (() => void) | null = null;
	let uninstallNativeEvents: (() => void) | null = null;
	let workletsClosed = false;
	const closeWorklets = (): void => {
		if (workletsClosed) return;
		workletsClosed = true;
		uninstallNativeEvents?.();
		uninstallNativeEvents = null;
		uninstallCallBridge?.();
		uninstallCallBridge = null;
		acceptedWorklets.clear();
		acceptedExecutionCounts.clear();
		worklets.close();
	};
	try {
		uninstallCallBridge = installBackgroundCallBridge({
			callMain<Result>(
				worklet: import('./core/worklets.js').LynxMainThreadWorkletDescriptor,
				args: readonly LynxWorkletValue[],
			) {
				const call = transport.callMain(
					worklet as LynxMainThreadWorkletWireDescriptor,
					args as never,
				);
				return { promise: call.promise as Promise<Result>, cancel: call.cancel };
			},
		});
	} catch (error) {
		lifecycleInstallation.rollback();
		transport.close(error);
		closeWorklets();
		throw error;
	}

	// A native `bind*` handler is delivered by the engine straight to this
	// thread, so the root that owns the listener table must be the thing
	// listening for it. Installing this is what makes taps reach handlers at all.
	try {
		uninstallNativeEvents = installLynxNativeEventReceiver(target as object, {
			claims(root) {
				// The transport knows its root from its first commit, which is
				// necessarily earlier than main installing a token for it. Claiming on
				// the accepted identity instead would drop every tap that lands before
				// this thread processes the first acknowledgement.
				return transport.ownedRoot() === root;
			},
			deliver(deliveries) {
				transport.dispatchNativeEventBatch(deliveries);
			},
			report(error) {
				options.onDiagnostic?.(error);
			},
			scheduleMicrotask,
		});
	} catch (error) {
		lifecycleInstallation.rollback();
		transport.close(error);
		closeWorklets();
		throw error;
	}

	const state: LynxRootState = {
		transport,
		closeWorklets,
		status: 'active',
		unmount: null,
	};

	const facade: LynxRoot = {
		render<Props>(component: LynxComponent<Props>, props?: Props) {
			if (state.status !== 'active') {
				return Promise.reject(new Error('Cannot render an unmounting or unmounted Lynx root.'));
			}
			if (typeof component !== 'function') {
				return Promise.reject(new TypeError('Lynx root render() requires a component function.'));
			}
			return backgroundCore.renderAsync(
				component as UniversalComponent<Props>,
				props === undefined ? ({} as Props) : props,
			);
		},
		flushTransport() {
			return backgroundCore.flushTransport();
		},
		get ready() {
			return transport.ready;
		},
		get renderer() {
			return 'lynx' as const;
		},
		unmount() {
			if (state.unmount !== null) return state.unmount;
			state.status = 'unmounting';
			state.unmount = (async () => {
				const acceptedBefore = transport.acceptedIdentity();
				if (acceptedBefore === null) {
					await transport.cancelPendingBeforeReady(
						new Error('Octane Lynx root was unmounted before main became ready.'),
					);
				}
				if (transport.closedReason() !== null) transport.enableLogicalTeardown();
				const preparationBeforeUnmount = transport.preparationCount();
				let unmountFailed = false;
				let unmountError: unknown;
				try {
					await backgroundCore.unmountAsync();
				} catch (error) {
					unmountFailed = true;
					unmountError = error;
				}
				if (unmountFailed && transport.closedReason() !== null) {
					transport.enableLogicalTeardown();
					try {
						await backgroundCore.unmountAsync();
					} catch (cleanupError) {
						if (unmountError === undefined) unmountError = cleanupError;
					}
				}

				const acceptedAfter = transport.acceptedIdentity();
				const transportPreparedTeardown = transport.preparationCount() !== preparationBeforeUnmount;
				const hostAccepted =
					!unmountFailed ||
					identityAdvanced(acceptedBefore, acceptedAfter) ||
					!transportPreparedTeardown ||
					transport.closedReason() !== null;
				if (!hostAccepted) {
					state.status = 'active';
					state.unmount = null;
					throw unmountError;
				}

				let disposeFailed = false;
				let disposeError: unknown;
				try {
					if (acceptedAfter !== null && transport.closedReason() === null) {
						await transport.dispose();
					}
				} catch (error) {
					disposeFailed = true;
					disposeError = error;
				} finally {
					transport.close(disposeFailed ? disposeError : unmountFailed ? unmountError : undefined);
					lifecycleInstallation.release();
					state.closeWorklets();
					state.status = 'unmounted';
				}
				if (unmountFailed) throw unmountError;
				if (disposeFailed) throw disposeError;
			})();
			return state.unmount;
		},
	};
	transport.bindPageDestroy(() => facade.unmount());
	lifecycleInstallation.commit();
	return Object.freeze(facade);
}

let defaultRoot: LynxRoot | null = null;

function getDefaultRoot(): LynxRoot {
	return (defaultRoot ??= createLynxRoot());
}

/** Lazy background page root used by the standard Rspeedy entry. */
export const root: LynxRoot = Object.freeze({
	get renderer() {
		return 'lynx' as const;
	},
	get ready() {
		return getDefaultRoot().ready;
	},
	render<Props>(component: LynxComponent<Props>, props?: Props) {
		return getDefaultRoot().render(component, props);
	},
	flushTransport() {
		return getDefaultRoot().flushTransport();
	},
	unmount() {
		return getDefaultRoot().unmount();
	},
});
