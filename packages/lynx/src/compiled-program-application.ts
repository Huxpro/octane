import { installLynxCompiledProgramProductReceiver } from './core/compiled-program-product-receiver.js';
import { createLynxElementPAPI, type LynxElementRef } from './core/papi.js';
import { resolveUniversalProgram } from './core/program-registry.js';
import type { LynxContextProxy, LynxContextProxyEvent } from './core/protocol.js';

const RENDER_PAGE = '__RenderPage';
const DESTROY_LIFETIME = '__DestroyLifetime';

interface LynxCompiledProgramMainGlobals {
	readonly lynx: {
		getJSContext(): LynxContextProxy;
		getEngine(): LynxContextProxy;
		getNative?(): LynxContextProxy;
	};
}

export interface LynxCompiledProgramApplicationController {
	/** Authored main-thread imports have evaluated and registered every program. */
	markProgramsReady(): void;
	close(): void;
}

/**
 * Install the real generated-product main owner without the general receiver.
 *
 * This owns only compact program readiness and page lifetime. Page/global data
 * delivery remains a separate capability seam, so the build plugin does not
 * select this bootstrap until that semantic channel and its static fallback
 * have been paired too.
 */
export function installLynxCompiledProgramApplicationMainThread<
	Node extends LynxElementRef = LynxElementRef,
>(
	/** Web is ready during evaluation; Native waits for decoded PageConfig. */
	pageReady = false,
): LynxCompiledProgramApplicationController {
	const target = globalThis as unknown as LynxCompiledProgramMainGlobals;
	const lynx = target.lynx;
	const engine = pageReady ? undefined : lynx.getEngine();
	const native = lynx.getNative?.();
	const papi = createLynxElementPAPI<Node>(target);
	const receiver = installLynxCompiledProgramProductReceiver({
		context: lynx.getJSContext(),
		page: papi.createPage('0', 0),
		papi,
		resolveProgram: resolveUniversalProgram,
		pageReady,
	});
	let listeners = 0;
	const remove = (
		context: LynxContextProxy,
		type: string,
		listener: (event: LynxContextProxyEvent) => void,
	): void => {
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				context.removeEventListener(type, listener);
				return;
			} catch {}
		}
	};
	const detach = (): void => {
		if (listeners & 1) remove(engine!, RENDER_PAGE, onRenderPage);
		if (listeners & 2) remove(native!, DESTROY_LIFETIME, onDestroy);
		listeners = 0;
	};
	const onRenderPage = (): void => {
		listeners &= ~1;
		remove(engine!, RENDER_PAGE, onRenderPage);
		receiver.markPageReady();
	};
	const onDestroy = (): void => {
		detach();
		try {
			receiver.destroyPage();
		} catch {}
	};
	try {
		if (engine) {
			listeners |= 1;
			engine.addEventListener(RENDER_PAGE, onRenderPage);
			if (!(listeners & 1)) remove(engine, RENDER_PAGE, onRenderPage);
		}
		if (native) {
			listeners |= 2;
			native.addEventListener(DESTROY_LIFETIME, onDestroy);
			if (!(listeners & 2)) remove(native, DESTROY_LIFETIME, onDestroy);
		}
	} catch (error) {
		onDestroy();
		throw error;
	}
	const close = receiver.close;
	receiver.close = () => {
		detach();
		close();
	};
	return receiver;
}
