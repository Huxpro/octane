import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import type {
	UniversalHostTemplateProgram,
	UniversalProgramPlan,
	UniversalTransportIdentity,
} from 'octane/universal/native';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock(
	'../src/main-renderer-product.js',
	() => import('../src/main-renderer.compiled-program.js'),
);

import { installLynxCompiledProgramApplicationMainThread } from '../src/compiled-program-application.js';
import { installLynxElementTemplateCompiledProgramApplicationMainThread } from '../src/compiled-program-application.element-template.js';
import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { createLynxCompiledProgramTransport } from '../src/core/compiled-program-transport.js';
import { encodeLynxDeltaMessage } from '../src/core/delta-protocol.js';
import type { LynxDataLifecycleMessage } from '../src/core/lifecycle-types.js';
import { registerUniversalProgram } from '../src/core/program-registry.js';
import type { LynxContextProxy, LynxContextProxyEvent } from '../src/core/protocol.js';
import {
	markFirstScreenSyncReady,
	root as firstScreenRoot,
} from '../src/first-screen.compiled-program.js';
import {
	defineUniversalComponent,
	universalPlan,
	universalValue,
} from '../src/main-renderer-product.js';
import {
	defineUniversalComponent as defineCompiledUniversalComponent,
	universalPlan as compiledUniversalPlan,
	universalValue as compiledUniversalValue,
} from '../src/main-renderer.compiled-program.js';

const MODULE = 'tests/CompiledProgramApplication.lynx.tsrx';
const ADOPTION_MODULE = 'tests/CompiledProgramApplicationAdoption.lynx.tsrx';
const ELEMENT_TEMPLATE_ADOPTION_MODULE =
	'tests/CompiledProgramApplicationElementTemplateAdoption.lynx.tsrx';
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
		wire: ROW,
		bind: new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'],
	};
}

function identity(version: number): UniversalTransportIdentity {
	return { protocol: 1, renderer: 'lynx', root: 97, version };
}

function mountFrame(module = MODULE): readonly unknown[] {
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
		[{ id: 1, address: { module, index: 0 } }],
	);
}

function appendFrame(firstInstance: number, id: string, text: string): readonly unknown[] {
	return encodeLynxDeltaMessage(
		[
			{
				op: 'run',
				templateId: 1,
				parent: { instance: 1, slot: 0 },
				before: null,
				firstInstance,
				count: 1,
				values: [id, text],
			},
		],
		[],
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
	for (const name of [
		'__CreateElementTemplate',
		'__CreateTypedElementTemplate',
		'__SetAttributeOfElementTemplate',
		'__InsertNodeToElementTemplate',
		'__RemoveNodeFromElementTemplate',
		'__SerializeElementTemplate',
		'__FlushElementTree',
	]) {
		delete (globalThis as unknown as Record<string, unknown>)[name];
	}
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
		const lifecycle: LynxDataLifecycleMessage[] = [];
		const transport = createLynxCompiledProgramTransport(lynx.getCoreContext(), {
			onLifecycle: (message) => lifecycle.push(message),
		});
		let ready = false;
		void transport.ready.then(() => {
			ready = true;
		});
		await Promise.resolve();
		expect(ready).toBe(false);

		engine.dispatchEvent({ type: '__RenderPage', data: [{ boot: 'ready' }, {}] });
		await transport.ready;
		engine.dispatchEvent({
			type: '__UpdatePage',
			data: [{ next: 1 }, { resetPageData: false }],
		});
		engine.dispatchEvent({ type: '__UpdateGlobalProps', data: [{ locale: 'en' }] });
		expect(lifecycle).toEqual([
			{
				protocol: 1,
				renderer: 'lynx',
				type: 'page-data',
				operation: 'replace',
				data: { boot: 'ready' },
			},
			{
				protocol: 1,
				renderer: 'lynx',
				type: 'page-data',
				operation: 'update',
				data: { next: 1 },
			},
			{
				protocol: 1,
				renderer: 'lynx',
				type: 'global-props',
				patch: { locale: 'en' },
			},
		]);
		await transport.commit(identity(1), mountFrame(), () => {}).promise;
		expect(dom!.window.document.querySelector('#compact-row')?.textContent).toBe('ready');

		lynx.getNative().dispatchEvent({ type: '__DestroyLifetime', data: [1] });
		await transport.pageDestroyed;
		expect(dom!.window.document.querySelector('#compact-row')).toBeNull();
		expect(engine.listeners.get('__RenderPage')?.size ?? 0).toBe(0);
		// Two injected failures, followed by one successful removal for each of
		// the three engine lifecycle listeners.
		expect(engine.removalAttempts).toBe(5);
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

	it('hands the painted Web first screen over once and mounts later runs normally', async () => {
		const env = installEnvironment();
		env.switchToMainThread();
		const plan = universalPlan('lynx', emittedPlan(), {
			module: ADOPTION_MODULE,
			index: 0,
			digest: 'compiled-program-application-test',
		});
		const App = defineUniversalComponent('lynx', () =>
			universalValue(plan, ['compact-row', 'ready']),
		);
		const application = installLynxCompiledProgramApplicationMainThread({
			firstScreen: true,
			pageReady: true,
		});
		firstScreenRoot.render(App);
		markFirstScreenSyncReady();

		env.switchToBackgroundThread();
		const lynx = (
			globalThis as typeof globalThis & {
				lynx: { getCoreContext(): LynxContextProxy };
			}
		).lynx;
		const transport = createLynxCompiledProgramTransport(lynx.getCoreContext());
		await transport.ready;
		await transport.commit(identity(1), mountFrame(ADOPTION_MODULE), () => {}).promise;
		expect(dom!.window.document.querySelectorAll('#compact-row')).toHaveLength(1);

		await transport.commit(identity(2), appendFrame(3, 'later-row', 'later'), () => {}).promise;
		expect(dom!.window.document.querySelector('#later-row')?.textContent).toBe('later');

		await transport.dispose(identity(2), true);
		transport.close();
		application.close();
	});

	it('hands a whole-root Element Template first screen to the same compact frame', async () => {
		const env = installEnvironment();
		env.switchToMainThread();
		type Handle = {
			uid: number;
			attributes: unknown[];
			parent: Handle | null;
			parentSlot: number | null;
			children: Map<number, Handle[]>;
		};
		const created: Handle[] = [];
		const make = (uid: number, attributes: readonly unknown[] = []): Handle => ({
			uid,
			attributes: [...attributes],
			parent: null,
			parentSlot: null,
			children: new Map(),
		});
		const page = make(0);
		const globals = globalThis as unknown as Record<string, unknown>;
		globals.__CreateTypedElementTemplate = () => page;
		globals.__CreateElementTemplate = (
			_key: string,
			_bundle: null,
			attributes: readonly unknown[],
			_slots: null,
			uid: number,
		) => {
			const value = make(uid, attributes);
			created.push(value);
			return value;
		};
		globals.__SetAttributeOfElementTemplate = (value: Handle, slot: number, next: unknown) => {
			value.attributes[slot] = next;
		};
		globals.__InsertNodeToElementTemplate = (
			parent: Handle,
			slot: number,
			child: Handle,
			before: Handle | null = null,
		) => {
			if (child.parent !== null) {
				const prior = child.parent.children.get(child.parentSlot!)!;
				prior.splice(prior.indexOf(child), 1);
			}
			const children = parent.children.get(slot) ?? [];
			if (!parent.children.has(slot)) parent.children.set(slot, children);
			const index = before === null ? children.length : children.indexOf(before);
			children.splice(index, 0, child);
			child.parent = parent;
			child.parentSlot = slot;
		};
		globals.__RemoveNodeFromElementTemplate = (parent: Handle, slot: number, child: Handle) => {
			const children = parent.children.get(slot)!;
			children.splice(children.indexOf(child), 1);
			child.parent = null;
			child.parentSlot = null;
		};
		globals.__SerializeElementTemplate = (value: Handle) => ({ uid: value.uid });
		globals.__FlushElementTree = () => {};

		const plan = compiledUniversalPlan(
			'lynx',
			{
				...emittedPlan(),
				elementTemplate: {
					templateId: '_octane_et_application_row',
					attributeSlots: 3,
					childSlots: 0,
					visibilitySlot: 2,
				},
			},
			{
				module: ELEMENT_TEMPLATE_ADOPTION_MODULE,
				index: 0,
				digest: 'element-template-application-test',
			},
		);
		const App = defineCompiledUniversalComponent('lynx', () =>
			compiledUniversalValue(plan, ['compact-row', 'ready']),
		);
		const application = installLynxElementTemplateCompiledProgramApplicationMainThread({
			firstScreen: true,
			pageReady: true,
		});
		firstScreenRoot.render(App);
		markFirstScreenSyncReady();
		expect(created.map((value) => value.uid)).toEqual([-1]);
		expect(page.children.get(0)?.map((value) => value.uid)).toEqual([-1]);

		env.switchToBackgroundThread();
		const lynx = (
			globalThis as typeof globalThis & { lynx: { getCoreContext(): LynxContextProxy } }
		).lynx;
		const transport = createLynxCompiledProgramTransport(lynx.getCoreContext());
		await transport.ready;
		await transport.commit(
			{ ...identity(1), root: 1 },
			mountFrame(ELEMENT_TEMPLATE_ADOPTION_MODULE),
			() => {},
		).promise;
		expect(created.map((value) => value.uid)).toEqual([-1]);

		await transport.commit({ ...identity(2), root: 1 }, appendFrame(3, 'later', 'row'), () => {})
			.promise;
		expect(created.map((value) => value.uid)).toEqual([-1, 3]);
		await transport.dispose({ ...identity(2), root: 1 }, true);
		expect(page.children.get(0)).toEqual([]);
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
