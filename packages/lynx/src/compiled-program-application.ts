declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import { installLynxFirstScreenHost } from './core/first-screen-host.js';
import { paintLynxCompiledProgramFirstScreen } from './core/compiled-program-first-screen.js';
import { compactLynxLifecycleMessages, snapshotLynxLifecycleData } from './core/lifecycle-data.js';
import type { LynxDataLifecycleMessage } from './core/lifecycle-types.js';
import { installLynxCompiledProgramProductReceiver } from './core/compiled-program-product-receiver.js';
import { createLynxElementPAPI, type LynxElementRef } from './core/papi.js';
import { resolveUniversalProgram } from './core/program-registry.js';
import type { LynxCompiledProgramAdoptionSource } from './core/compiled-program-store.js';
import { type LynxContextProxy, type LynxContextProxyEvent } from './core/protocol.js';
import { localizeLynxHostValue } from './core/transport-codec.js';
import {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
} from './core/transport-identity.js';
import {
	renderLynxFirstScreen,
	type LynxFirstScreenRenderResult,
} from './main-renderer-product.js';
import type { UniversalComponent } from 'octane/universal/native';

const RENDER_PAGE = '__RenderPage';
const UPDATE_PAGE = '__UpdatePage';
const UPDATE_GLOBAL_PROPS = '__UpdateGlobalProps';
const DESTROY_LIFETIME = '__DestroyLifetime';
const MAX_QUEUED_LIFECYCLE_MESSAGES = 128;
const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const CODE = 'Octane Lynx OL496';

interface LynxCompiledProgramMainGlobals {
	readonly lynx: {
		getJSContext(): LynxContextProxy;
		getEngine?(): LynxContextProxy;
		getNative?(): LynxContextProxy;
	};
}

export interface InstallLynxCompiledProgramApplicationOptions {
	/** Web is ready during evaluation; Native waits for decoded PageConfig. */
	readonly pageReady?: boolean;
	/** Install the generated entry's one-shot, main-painted first-screen facade. */
	readonly firstScreen?: boolean;
	readonly onDiagnostic?: (error: Error) => void;
}

export interface LynxCompiledProgramApplicationController {
	/** Authored main-thread imports have evaluated and registered every program. */
	markProgramsReady(): void;
	close(): void;
}

function normalizedError(value: unknown): Error {
	return value instanceof Error ? value : new Error(value === undefined ? CODE : String(value));
}

function lifecycleTuple(
	event: LynxContextProxyEvent,
	type: string,
	length: number,
): readonly unknown[] {
	if (event.type !== type) throw new TypeError(DEVELOPMENT ? `Expected ${type}.` : CODE);
	const value = localizeLynxHostValue(event.data);
	if (!Array.isArray(value) || value.length !== length) {
		throw new TypeError(DEVELOPMENT ? `${type} must carry an exact ${length}-item tuple.` : CODE);
	}
	return value;
}

function lifecycleOptions(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(DEVELOPMENT ? 'Lynx lifecycle options must be an object.' : CODE);
	}
	return value as Record<string, unknown>;
}

function booleanOption(options: Record<string, unknown>, name: string): boolean {
	const descriptor = Object.getOwnPropertyDescriptor(options, name);
	if (descriptor === undefined) return false;
	if (
		!Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
		typeof descriptor.value !== 'boolean'
	) {
		throw new TypeError(DEVELOPMENT ? `Lynx lifecycle option ${name} must be boolean.` : CODE);
	}
	return descriptor.value;
}

/**
 * Install the generated-product main owner for a statically proven compiled-program app.
 *
 * On Web the generated first-screen facade paints the addressed program tree
 * synchronously and the first Block frame adopts those exact nodes. Native queues the
 * same paint until `PageConfig` publishes page/global data, then transfers ownership
 * after the checked frame agrees with every program/value. Later frames mount normally;
 * no second synchronous tree is painted. Lifecycle data remain held until the compact
 * readiness reply proves the background listener exists.
 */
export function installLynxCompiledProgramApplicationMainThread<
	Node extends LynxElementRef = LynxElementRef,
>(
	input: boolean | InstallLynxCompiledProgramApplicationOptions = false,
): LynxCompiledProgramApplicationController {
	const options = typeof input === 'boolean' ? { pageReady: input } : input;
	const target = globalThis as unknown as LynxCompiledProgramMainGlobals;
	const lynx = target.lynx;
	const context = lynx.getJSContext();
	const engine = options.pageReady === true ? undefined : lynx.getEngine?.();
	const native = lynx.getNative?.();
	if (options.pageReady !== true && engine === undefined) {
		throw new Error(DEVELOPMENT ? 'Compact Native application requires lynx.getEngine().' : CODE);
	}
	const papi = createLynxElementPAPI<Node>(target);
	const page = papi.createPage('0', 0);
	let compactReady = false;
	let lifecycleClosed = false;
	let lifecycleDraining = false;
	let screenOpen = options.firstScreen === true;
	let programsReady = false;
	let queued: LynxDataLifecycleMessage[] = [];
	let uninstallFirstScreen: (() => void) | null = null;
	let paintedFirstScreen: LynxCompiledProgramAdoptionSource<Node> | null = null;
	let firstScreenTransferred = false;
	let pendingFirstScreen: readonly [UniversalComponent<unknown>, unknown] | null = null;
	const registered: Array<
		readonly [LynxContextProxy, string, (event: LynxContextProxyEvent) => void]
	> = [];

	const report = (value: unknown): Error => {
		const error = normalizedError(value);
		try {
			options.onDiagnostic?.(error);
		} catch {}
		return error;
	};
	const dispatchLifecycle = (message: LynxDataLifecycleMessage): void => {
		if (!receiver.publishLifecycle(message)) {
			throw new Error(DEVELOPMENT ? 'Compact lifecycle receiver is unavailable.' : CODE);
		}
	};
	const drain = (): void => {
		if (!compactReady || lifecycleClosed || lifecycleDraining) return;
		lifecycleDraining = true;
		try {
			while (!lifecycleClosed && queued.length !== 0) dispatchLifecycle(queued.shift()!);
		} catch (error) {
			lifecycleClosed = true;
			queued = [];
			report(error);
		} finally {
			lifecycleDraining = false;
		}
	};
	const enqueue = (message: LynxDataLifecycleMessage): void => {
		if (lifecycleClosed) return;
		if (compactReady && !lifecycleDraining) {
			try {
				dispatchLifecycle(message);
			} catch (error) {
				lifecycleClosed = true;
				report(error);
			}
			return;
		}
		if (queued.length >= MAX_QUEUED_LIFECYCLE_MESSAGES) {
			queued = [...compactLynxLifecycleMessages([...queued, message])];
			return;
		}
		queued.push(message);
	};

	const adoption: LynxCompiledProgramAdoptionSource<Node> | undefined =
		options.firstScreen === true
			? {
					firstListener: 1,
					resolveSeed(input) {
						if (firstScreenTransferred) return undefined;
						if (paintedFirstScreen === null) {
							throw new Error(
								DEVELOPMENT ? 'Compact frame arrived before first-screen paint.' : CODE,
							);
						}
						return paintedFirstScreen.resolveSeed(input);
					},
					verify() {
						if (firstScreenTransferred) return;
						if (paintedFirstScreen === null) {
							throw new Error(
								DEVELOPMENT ? 'Compact frame verified before first-screen paint.' : CODE,
							);
						}
						paintedFirstScreen.verify();
					},
					finish() {
						if (firstScreenTransferred) return;
						if (paintedFirstScreen === null) {
							throw new Error(
								DEVELOPMENT ? 'Compact frame finished before first-screen paint.' : CODE,
							);
						}
						paintedFirstScreen.finish();
						paintedFirstScreen = null;
						firstScreenTransferred = true;
					},
					dispose() {
						paintedFirstScreen?.dispose();
						paintedFirstScreen = null;
						pendingFirstScreen = null;
					},
				}
			: undefined;
	const receiver = installLynxCompiledProgramProductReceiver({
		context,
		page,
		papi,
		resolveProgram: resolveUniversalProgram,
		adoption,
		pageReady: options.pageReady,
		onDiagnostic: options.onDiagnostic,
		onReady() {
			compactReady = true;
			drain();
		},
	});
	const paintFirstScreen = <Props>(
		component: UniversalComponent<Props>,
		props: Props,
	): LynxFirstScreenRenderResult => {
		const result = renderLynxFirstScreen(component, props);
		paintedFirstScreen = paintLynxCompiledProgramFirstScreen(result, papi, page);
		return result;
	};
	const releaseFirstScreen = (): void => {
		const pending = pendingFirstScreen;
		pendingFirstScreen = null;
		if (pending === null || lifecycleClosed) return;
		try {
			paintFirstScreen(pending[0], pending[1]);
		} catch (error) {
			report(error);
		}
	};
	const onRenderPage = (event: LynxContextProxyEvent): void => {
		try {
			const tuple = lifecycleTuple(event, RENDER_PAGE, 2);
			lifecycleOptions(tuple[1]);
			enqueue({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'page-data',
				operation: 'replace',
				data: snapshotLynxLifecycleData(tuple[0], '__RenderPage data'),
			});
		} catch (error) {
			report(error);
		} finally {
			if (engine !== undefined) unlisten(engine, RENDER_PAGE, onRenderPage);
			releaseFirstScreen();
			receiver.markPageReady();
		}
	};
	const onUpdatePage = (event: LynxContextProxyEvent): void => {
		try {
			const tuple = lifecycleTuple(event, UPDATE_PAGE, 2);
			const update = lifecycleOptions(tuple[1]);
			if (booleanOption(update, 'reloadTemplate')) {
				report(
					new Error(DEVELOPMENT ? 'Compact application cannot reload a native template.' : CODE),
				);
				return;
			}
			enqueue({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'page-data',
				operation: booleanOption(update, 'resetPageData') ? 'reset' : 'update',
				data: snapshotLynxLifecycleData(tuple[0], '__UpdatePage data'),
			});
		} catch (error) {
			report(error);
		}
	};
	const onUpdateGlobalProps = (event: LynxContextProxyEvent): void => {
		try {
			const tuple = lifecycleTuple(event, UPDATE_GLOBAL_PROPS, 1);
			enqueue({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'global-props',
				patch: snapshotLynxLifecycleData(tuple[0], '__UpdateGlobalProps patch'),
			});
		} catch (error) {
			report(error);
		}
	};
	const removeListener = (
		owner: LynxContextProxy,
		type: string,
		listener: (event: LynxContextProxyEvent) => void,
	): void => {
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				owner.removeEventListener(type, listener);
				return;
			} catch (error) {
				if (attempt === 2) report(error);
			}
		}
	};
	const unlisten = (
		owner: LynxContextProxy,
		type: string,
		listener: (event: LynxContextProxyEvent) => void,
	): void => {
		const index = registered.findIndex(
			(entry) => entry[0] === owner && entry[1] === type && entry[2] === listener,
		);
		if (index >= 0) registered.splice(index, 1);
		removeListener(owner, type, listener);
	};
	const detach = (): void => {
		for (let index = registered.length - 1; index >= 0; index--) {
			const [owner, type, listener] = registered[index]!;
			removeListener(owner, type, listener);
		}
		registered.length = 0;
		uninstallFirstScreen?.();
		uninstallFirstScreen = null;
		pendingFirstScreen = null;
	};
	const onDestroy = (): void => {
		lifecycleClosed = true;
		queued = [];
		detach();
		try {
			receiver.destroyPage();
		} catch (error) {
			report(error);
		}
	};
	const listen = (
		owner: LynxContextProxy | undefined,
		type: string,
		listener: (event: LynxContextProxyEvent) => void,
	): void => {
		if (owner === undefined) return;
		const registration = [owner, type, listener] as const;
		registered.push(registration);
		owner.addEventListener(type, listener);
		// ContextProxy may publish PageConfig synchronously from registration.
		// If that callback detached the application, undo the listener that the
		// host installed only after invoking it.
		if (!registered.includes(registration)) removeListener(owner, type, listener);
	};

	try {
		listen(engine, RENDER_PAGE, onRenderPage);
		listen(engine, UPDATE_PAGE, onUpdatePage);
		listen(engine, UPDATE_GLOBAL_PROPS, onUpdateGlobalProps);
		listen(native, DESTROY_LIFETIME, onDestroy);
		if (options.firstScreen === true) {
			uninstallFirstScreen = installLynxFirstScreenHost({
				render(component, props) {
					if (!screenOpen)
						throw new Error(DEVELOPMENT ? 'Compact first screen is one-shot.' : CODE);
					screenOpen = false;
					if (options.pageReady === true) return paintFirstScreen(component, props);
					pendingFirstScreen = [component as UniversalComponent<unknown>, props];
					return null;
				},
				markSyncReady() {
					if (programsReady) return;
					programsReady = true;
					receiver.markProgramsReady();
				},
				unmount() {
					screenOpen = false;
					pendingFirstScreen = null;
					paintedFirstScreen?.dispose();
					paintedFirstScreen = null;
				},
			});
		}
	} catch (error) {
		detach();
		try {
			receiver.destroyPage();
		} catch (destroyError) {
			report(destroyError);
		}
		receiver.close();
		throw error;
	}

	const close = receiver.destroyPage;
	receiver.close = () => {
		lifecycleClosed = true;
		queued = [];
		detach();
		close();
	};
	return receiver;
}
