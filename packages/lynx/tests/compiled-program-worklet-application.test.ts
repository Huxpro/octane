import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import type { UniversalComponent } from 'octane/universal/native';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/application-selection.js', () => ({
	LYNX_COMPILED_PROGRAM_APPLICATION: true,
}));
vi.mock(
	'../src/core/main-renderer-selection.js',
	async () => import('../src/main-renderer.compiled-program.js'),
);

import { installLynxCompiledProgramApplicationMainThread } from '../src/compiled-program-application.js';
import * as CompilerBackend from '../src/compiler/index.js';
import { lynxBlockBackgroundRenderer, lynxMainThreadRenderer } from '../src/config.js';
import type { LynxActivatedMainThreadWorklet } from '../src/core/worklets.js';
import { unregisterBackgroundFunction, unregisterMainThreadWorklet } from '../src/core/worklets.js';
import * as firstScreenApi from '../src/first-screen.js';
import * as rootApi from '../src/index.js';
import * as mainRenderer from '../src/main-renderer.compiled-program.js';
import * as mainWorkletApi from '../src/main-worklets.js';
import * as backgroundRenderer from '../src/renderer.js';
import { createLynxRoot, type LynxRoot } from '../src/root.js';

const MODULE = 'tests/_fixtures/compiled-program-worklet-product.lynx.tsrx';
const SOURCE = readFileSync(
	fileURLToPath(new URL('./_fixtures/compiled-program-worklet-product.lynx.tsrx', import.meta.url)),
	'utf8',
);
const EXPORTS = ['CompiledProgramWorkletProduct', 'compactWorkletState'] as const;

interface Layer {
	readonly CompiledProgramWorkletProduct: UniversalComponent<{ readonly prefix: string }>;
	readonly compactWorkletState: {
		invoke: null | (() => Promise<string>);
		layout: null | string;
		background: string[];
	};
}

let dom: JSDOM | null = null;
let root: LynxRoot | null = null;
let application: ReturnType<typeof installLynxCompiledProgramApplicationMainThread> | null = null;
let threadIds: string[] = [];

function importBindings(specifiers: string): string {
	return specifiers
		.split(',')
		.map((specifier) => specifier.trim())
		.filter(Boolean)
		.map((specifier) => specifier.replace(/\s+as\s+/, ': '))
		.join(', ');
}

function evaluate(
	code: string,
	modules: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Layer {
	const withoutImports = code.replace(
		/import\s*\{([\s\S]*?)\}\s*from\s*(["'])([^"']+)\2\s*;/g,
		(_statement, specifiers: string, _quote: string, request: string) =>
			`const { ${importBindings(specifiers)} } = modules[${JSON.stringify(request)}];`,
	);
	const executable = withoutImports.replace(/\bexport\s+(const|let|var|function|class)\s+/g, '$1 ');
	if (/\b(?:import|export)\b/.test(executable)) {
		throw new Error(`Unexpected module syntax in compact worklet output:\n${executable}`);
	}
	return Function(
		'modules',
		`"use strict";\n${executable}\nreturn { ${EXPORTS.join(', ')} };`,
	)(modules) as Layer;
}

function compileLayers(): { readonly background: string; readonly main: string } {
	const compilerPath = fileURLToPath(
		new URL('../../octane/src/compiler/compile.js', import.meta.url),
	);
	const { compile } = createRequire(import.meta.url)(
		compilerPath,
	) as typeof import('../../octane/src/compiler/compile.js');
	const compileLayer = (
		renderer: typeof lynxBlockBackgroundRenderer | typeof lynxMainThreadRenderer,
		thread: 'background' | 'main-thread',
	) =>
		compile(SOURCE, `/${MODULE}`, {
			hmr: false,
			renderer: { ...renderer, id: 'lynx' },
			universalRuntime: { runtime: 'lynx', thread },
			mainThreadProgramBackend: CompilerBackend,
			programModuleId: MODULE,
		}).code;
	const background = compileLayer(lynxBlockBackgroundRenderer, 'background');
	const main = compileLayer(lynxMainThreadRenderer, 'main-thread');
	threadIds = [...new Set(`${background}\n${main}`.match(/tf_[a-z0-9]+/g) ?? [])];
	return { background, main };
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn++) await Promise.resolve();
	await root!.flushTransport();
	for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

afterEach(async () => {
	if (root !== null) {
		globalThis.lynxTestingEnv.switchToBackgroundThread();
		try {
			await root.unmount();
		} catch {}
		root = null;
	}
	if (application !== null) {
		globalThis.lynxTestingEnv.switchToMainThread();
		application.close();
		application = null;
	}
	for (const id of threadIds) {
		unregisterMainThreadWorklet(id);
		unregisterBackgroundFunction(id);
	}
	threadIds = [];
	if (dom !== null) {
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
		dom.window.close();
		dom = null;
	}
});

describe.sequential('@octanejs/lynx compact authored worklet application', () => {
	it('runs ACK-layout, event, update, and teardown calls through retained native descriptors', async () => {
		const code = compileLayers();
		expect(code.background).toContain("'background'");
		expect(code.main).toContain("'main-thread'");

		dom = new JSDOM('<!doctype html><html><body></body></html>');
		installLynxTestingEnv(globalThis, {
			window: dom.window as unknown as Window & typeof globalThis,
		});
		globalThis.lynxTestingEnv.switchToMainThread();
		const listeners: LynxActivatedMainThreadWorklet[] = [];
		const target = globalThis as unknown as Record<string, unknown>;
		const addEvent = target.__AddEvent as (
			node: object,
			kind: string,
			name: string,
			listener: unknown,
		) => void;
		target.__AddEvent = (node: object, kind: string, name: string, listener: unknown) => {
			if (
				listener !== null &&
				typeof listener === 'object' &&
				(listener as { readonly type?: unknown }).type === 'worklet'
			) {
				listeners.push((listener as { readonly value: LynxActivatedMainThreadWorklet }).value);
			}
			addEvent.call(target, node, kind, name, listener);
		};
		application = installLynxCompiledProgramApplicationMainThread({ pageReady: true });
		evaluate(code.main, {
			'@octanejs/lynx/main-renderer': mainRenderer,
			'@octanejs/lynx/main-worklets': mainWorkletApi,
			'@octanejs/lynx': firstScreenApi,
		});
		application.markProgramsReady();

		globalThis.lynxTestingEnv.switchToBackgroundThread();
		const background = evaluate(code.background, {
			'@octanejs/lynx/renderer': backgroundRenderer,
			'@octanejs/lynx': rootApi,
		});
		root = createLynxRoot();
		await root.ready;
		await root.render(background.CompiledProgramWorkletProduct, { prefix: 'one' });
		await settle();
		expect(background.compactWorkletState.layout).toBe('reply:one:true');
		expect(background.compactWorkletState.background).toEqual(['one:true']);
		await expect(background.compactWorkletState.invoke!()).resolves.toBe('reply:one:true');
		expect(listeners).toHaveLength(1);
		const first = listeners[0]!;

		await root.render(background.CompiledProgramWorkletProduct, { prefix: 'two' });
		await settle();
		expect(background.compactWorkletState.layout).toBe('reply:two:true');
		expect(listeners.length).toBeGreaterThan(1);
		const runWorklet = (
			globalThis as typeof globalThis & {
				runWorklet(value: LynxActivatedMainThreadWorklet): unknown;
			}
		).runWorklet;
		globalThis.lynxTestingEnv.switchToMainThread();
		expect(() => runWorklet(first)).toThrow(/stale or foreign/);

		globalThis.lynxTestingEnv.switchToBackgroundThread();
		await root.unmount();
		root = null;
		globalThis.lynxTestingEnv.switchToMainThread();
		expect(() => runWorklet(listeners.at(-1)!)).toThrow(/stale or foreign/);
	});
});
