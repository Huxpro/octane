import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import type {
	UniversalHostTemplateProgram,
	UniversalProgramPlan,
	UniversalTransportIdentity,
} from 'octane/universal/native';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

import { installLynxCompiledProgramApplicationMainThread } from '../src/compiled-program-application.js';
import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { createLynxCompiledProgramTransport } from '../src/core/compiled-program-transport.js';
import { encodeLynxDeltaMessage } from '../src/core/delta-protocol.js';
import { registerUniversalProgram } from '../src/core/program-registry.js';
import type { LynxContextProxy, LynxContextProxyEvent } from '../src/core/protocol.js';

const MODULE = 'tests/CompiledProgramApplication.lynx.tsrx';
const ROW: UniversalHostTemplateProgram = {
	nodes: [
		{
			type: 'view',
			parent: -1,
			props: {},
			bindings: [{ name: 'id', valueIndex: 0 }],
		},
		{ type: 'text', parent: 0, props: {} },
		{
			type: '#text',
			parent: 1,
			props: {},
			bindings: [{ name: 'value', valueIndex: 1 }],
		},
	],
	events: [],
};

function emittedPlan(): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(ROW, {
		name: 'createApplicationRow',
		slotUpdates: true,
	});
	return {
		kind: 'program',
		slots: ['p:id', 'c'],
		nodes: ROW.nodes.length,
		values: [0, 1],
		events: [],
		ranges: [],
		bind: new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'],
	};
}

function identity(version: number): UniversalTransportIdentity {
	return { protocol: 1, renderer: 'lynx', root: 97, version };
}

function mountFrame(): readonly unknown[] {
	return encodeLynxDeltaMessage(
		[
			{
				op: 'run',
				templateId: 1,
				parent: { instance: 1, slot: 0 },
				before: null,
				firstInstance: 2,
				count: 1,
				values: ['compact-row', 'ready'],
			},
		],
		[{ id: 1, address: { module: MODULE, index: 0 } }],
	);
}

class RecordingContext implements LynxContextProxy {
	readonly listeners = new Map<string, Set<(event: LynxContextProxyEvent) => void>>();

	dispatchEvent(event: LynxContextProxyEvent): void {
		for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
	}

	addEventListener(type: string, listener: (event: LynxContextProxyEvent) => void): void {
		let entries = this.listeners.get(type);
		if (entries === undefined) this.listeners.set(type, (entries = new Set()));
		entries.add(listener);
	}

	removeEventListener(type: string, listener: (event: LynxContextProxyEvent) => void): void {
		this.listeners.get(type)?.delete(listener);
	}
}

class ReentrantRegistrationContext extends RecordingContext {
	override addEventListener(type: string, listener: (event: LynxContextProxyEvent) => void): void {
		listener({ type, data: [{}, {}] });
		super.addEventListener(type, listener);
	}
}

class TransientRemovalContext extends RecordingContext {
	removalAttempts = 0;

	override removeEventListener(
		type: string,
		listener: (event: LynxContextProxyEvent) => void,
	): void {
		this.removalAttempts++;
		if (this.removalAttempts < 3) throw new Error('transient lifecycle removal failure');
		super.removeEventListener(type, listener);
	}
}

let dom: JSDOM | null = null;

function installEnvironment(): typeof globalThis.lynxTestingEnv {
	dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	return globalThis.lynxTestingEnv;
}

afterEach(() => {
	if (dom !== null) {
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
		dom.window.close();
		dom = null;
	}
});

describe.sequential('@octanejs/lynx compiled-program application bootstrap', () => {
	it('uses real contexts, waits for PageConfig, mounts a resident program, and destroys the page', async () => {
		const env = installEnvironment();
		env.switchToMainThread();
		const engine = new TransientRemovalContext();
		const lynx = (
			globalThis as typeof globalThis & {
				lynx: {
					getCoreContext(): LynxContextProxy;
					getEngine?(): LynxContextProxy;
					getNative(): LynxContextProxy;
				};
			}
		).lynx;
		Object.defineProperty(lynx, 'getEngine', { configurable: true, value: () => engine });
		registerUniversalProgram(MODULE, 0, emittedPlan());
		const application = installLynxCompiledProgramApplicationMainThread();
		application.markProgramsReady();

		env.switchToBackgroundThread();
		const transport = createLynxCompiledProgramTransport(lynx.getCoreContext());
		let ready = false;
		void transport.ready.then(() => {
			ready = true;
		});
		await Promise.resolve();
		expect(ready).toBe(false);

		engine.dispatchEvent({ type: '__RenderPage', data: [{}, {}] });
		await transport.ready;
		await transport.commit(identity(1), mountFrame(), () => {}).promise;
		expect(dom!.window.document.querySelector('#compact-row')?.textContent).toBe('ready');

		lynx.getNative().dispatchEvent({ type: '__DestroyLifetime', data: [1] });
		await transport.pageDestroyed;
		expect(dom!.window.document.querySelector('#compact-row')).toBeNull();
		expect(engine.listeners.get('__RenderPage')?.size ?? 0).toBe(0);
		expect(engine.removalAttempts).toBe(3);
		application.close();
	});

	it('releases a Web bootstrap during evaluation without consulting an engine context', async () => {
		const env = installEnvironment();
		env.switchToMainThread();
		const lynx = (
			globalThis as typeof globalThis & {
				lynx: { getCoreContext(): LynxContextProxy; getEngine?: () => LynxContextProxy };
			}
		).lynx;
		Object.defineProperty(lynx, 'getEngine', {
			configurable: true,
			value: () => {
				throw new Error('Web bootstrap must not request an engine context');
			},
		});
		const application = installLynxCompiledProgramApplicationMainThread(true);
		application.markProgramsReady();

		env.switchToBackgroundThread();
		const transport = createLynxCompiledProgramTransport(lynx.getCoreContext());
		await transport.ready;
		transport.close();
		application.close();
	});

	it('removes an engine listener whose registration publishes PageConfig reentrantly', async () => {
		const env = installEnvironment();
		env.switchToMainThread();
		const engine = new ReentrantRegistrationContext();
		const lynx = (
			globalThis as typeof globalThis & {
				lynx: { getCoreContext(): LynxContextProxy; getEngine?: () => LynxContextProxy };
			}
		).lynx;
		Object.defineProperty(lynx, 'getEngine', { configurable: true, value: () => engine });
		const application = installLynxCompiledProgramApplicationMainThread();
		application.markProgramsReady();
		expect(engine.listeners.get('__RenderPage')?.size ?? 0).toBe(0);

		env.switchToBackgroundThread();
		const transport = createLynxCompiledProgramTransport(lynx.getCoreContext());
		await transport.ready;
		transport.close();
		application.close();
	});

	it('rolls back partial lifecycle registration and tombstones a waiting background on failure', async () => {
		const env = installEnvironment();
		env.switchToBackgroundThread();
		const backgroundContext = (
			globalThis as typeof globalThis & {
				lynx: {
					getCoreContext(): LynxContextProxy;
				};
			}
		).lynx.getCoreContext();
		const transport = createLynxCompiledProgramTransport(backgroundContext);
		const registrationError = new Error('injected compact lifetime registration failure');

		env.switchToMainThread();
		const engine = new RecordingContext();
		const lynx = (
			globalThis as typeof globalThis & {
				lynx: { getEngine?: () => LynxContextProxy; getNative(): LynxContextProxy };
			}
		).lynx;
		const native = lynx.getNative();
		Object.defineProperties(lynx, {
			getEngine: { configurable: true, value: () => engine },
			getNative: {
				configurable: true,
				value: () => ({
					dispatchEvent: native.dispatchEvent.bind(native),
					addEventListener(type: string, listener: (event: LynxContextProxyEvent) => void) {
						if (type === '__DestroyLifetime') throw registrationError;
						native.addEventListener(type, listener);
					},
					removeEventListener: native.removeEventListener.bind(native),
				}),
			},
		});

		expect(() => installLynxCompiledProgramApplicationMainThread()).toThrow(registrationError);
		await transport.pageDestroyed;
		expect(engine.listeners.get('__RenderPage')?.size ?? 0).toBe(0);
	});
});
