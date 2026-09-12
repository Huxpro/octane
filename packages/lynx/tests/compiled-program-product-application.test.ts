/**
 * Issue #376: execute the normal authored application through the complete
 * specialized product loop. The build suite separately proves that Rspeedy
 * selects these exact modules; this suite joins their runtime contracts without
 * replacing the compiler output with hand-authored plans or frames.
 */
import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import type { UniversalComponent, UniversalPreparedAttempt } from 'octane/universal/native';
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
import { preparedLynxBlockDeltaBatch } from '../src/core/block-delta-producer.js';
import { LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT } from '../src/core/compiled-program-wire.js';
import type { LynxContextProxy, LynxContextProxyEvent } from '../src/core/protocol.js';
import {
	markFirstScreenSyncReady,
	root as firstScreenRoot,
} from '../src/first-screen.compiled-program.js';
import * as mainRenderer from '../src/main-renderer.compiled-program.js';
import * as backgroundRenderer from '../src/renderer.js';
import { createLynxRoot, type LynxRoot } from '../src/root.js';

const MODULE = 'tests/_fixtures/compiled-program-product.lynx.tsrx';
const SOURCE = readFileSync(
	fileURLToPath(new URL('./_fixtures/compiled-program-product.lynx.tsrx', import.meta.url)),
	'utf8',
);
const EXPORT_NAMES = ['CompiledProgramProductFixture'] as const;

interface ProductRow {
	readonly id: number;
	readonly label: string;
	readonly image: string;
}

interface ProductProps {
	readonly title: string;
	readonly tone: string;
	readonly rows: readonly ProductRow[];
	readonly onRowTap: (id: number, previousTaps: number) => void;
}

interface ProductLayer {
	readonly CompiledProgramProductFixture: UniversalComponent<ProductProps>;
}

interface CompiledProductLayers {
	readonly backgroundCode: string;
	readonly mainCode: string;
	readonly background: ProductLayer;
	readonly main: ProductLayer;
}

interface InboundGate {
	readonly context: LynxContextProxy;
	hold(): void;
	held(): number;
	release(): void;
}

let dom: JSDOM | null = null;
let backgroundRoot: LynxRoot | null = null;
let application: ReturnType<typeof installLynxCompiledProgramApplicationMainThread> | null = null;

function importBindings(specifiers: string): string {
	return specifiers
		.split(',')
		.map((specifier) => specifier.trim())
		.filter(Boolean)
		.map((specifier) => specifier.replace(/\s+as\s+/, ': '))
		.join(', ');
}

function evaluateCompiledLayer(
	code: string,
	modules: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): ProductLayer {
	const withoutImports = code.replace(
		/import\s*\{([\s\S]*?)\}\s*from\s*(["'])([^"']+)\2\s*;/g,
		(_statement, specifiers: string, _quote: string, request: string) =>
			`const { ${importBindings(specifiers)} } = modules[${JSON.stringify(request)}];`,
	);
	const executable = withoutImports.replace(/\bexport\s+(const|let|var|function|class)\s+/g, '$1 ');
	if (/\b(?:import|export)\b/.test(executable)) {
		throw new Error(`Unexpected module syntax in compiled product output:\n${executable}`);
	}
	return Function(
		'modules',
		`"use strict";\n${executable}\nreturn { ${EXPORT_NAMES.join(', ')} };`,
	)(modules) as ProductLayer;
}

async function compileProductLayers(): Promise<CompiledProductLayers> {
	// A static import would make the Lynx Vitest project's application transform
	// parse the compiler implementation itself. Use Node's native loader for this
	// source-only test dependency, matching the compiler subprocess suites.
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
		});
	const backgroundResult = compileLayer(lynxBlockBackgroundRenderer, 'background');
	const mainResult = compileLayer(lynxMainThreadRenderer, 'main-thread');
	expect(
		backgroundResult.mainThreadProgramCoverage,
		`background compile:\n${backgroundResult.code}`,
	).toEqual({ total: 2, addressed: 2 });
	expect(mainResult.mainThreadProgramCoverage, `main compile:\n${mainResult.code}`).toEqual({
		total: 2,
		addressed: 2,
	});
	const backgroundCode = backgroundResult.code;
	const mainCode = mainResult.code;
	return {
		backgroundCode,
		mainCode,
		background: evaluateCompiledLayer(backgroundCode, {
			'@octanejs/lynx/renderer': backgroundRenderer,
		}),
		main: evaluateCompiledLayer(mainCode, {
			'@octanejs/lynx/main-renderer': mainRenderer,
		}),
	};
}

function gateBackgroundInbound(): InboundGate {
	const inner = (
		globalThis as typeof globalThis & { lynx: { getCoreContext(): LynxContextProxy } }
	).lynx.getCoreContext();
	const wrappers = new Map<
		(event: LynxContextProxyEvent) => void,
		(event: LynxContextProxyEvent) => void
	>();
	let holding = false;
	let queue: Array<() => void> = [];
	const context: LynxContextProxy = {
		dispatchEvent: (event) => inner.dispatchEvent(event),
		addEventListener(type, listener) {
			if (type !== LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT) {
				inner.addEventListener(type, listener);
				return;
			}
			const gated = (event: LynxContextProxyEvent): void => {
				if (holding) queue.push(() => listener(event));
				else listener(event);
			};
			wrappers.set(listener, gated);
			inner.addEventListener(type, gated);
		},
		removeEventListener(type, listener) {
			const gated = wrappers.get(listener);
			inner.removeEventListener(type, gated ?? listener);
			wrappers.delete(listener);
		},
	};
	return {
		context,
		hold() {
			holding = true;
		},
		held() {
			return queue.length;
		},
		release() {
			holding = false;
			const pending = queue;
			queue = [];
			for (const deliver of pending) deliver();
		},
	};
}

function tap(selector: string): void {
	const element = dom!.window.document.querySelector(selector);
	if (element === null) throw new Error(`no element matched ${selector}`);
	const event = new dom!.window.Event('bindEvent:tap', { bubbles: true, cancelable: true });
	const target = { id: element.id, uid: 1, dataset: {} };
	for (const [name, value] of [
		['type', 'tap'],
		['target', target],
		['currentTarget', target],
	] as const) {
		Object.defineProperty(event, name, { configurable: true, value });
	}
	Object.assign(event, { timestamp: 1, detail: {} });
	element.dispatchEvent(event);
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn++) await Promise.resolve();
	await backgroundRoot!.flushTransport();
	for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

function directOperations(attempt: UniversalPreparedAttempt) {
	expect(attempt.batch.commands).toEqual([]);
	const prepared = preparedLynxBlockDeltaBatch(attempt.batch);
	expect(prepared).not.toBeNull();
	return prepared!.operations;
}

afterEach(async () => {
	if (backgroundRoot !== null) {
		try {
			await backgroundRoot.unmount();
		} catch {
			// Failed assertions can leave a compact transport already closed.
		}
		backgroundRoot = null;
	}
	if (application !== null) {
		globalThis.lynxTestingEnv.switchToMainThread();
		application.close();
		application = null;
	}
	if (dom !== null) {
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
		dom.window.close();
		dom = null;
	}
});

describe.sequential('@octanejs/lynx ordinary compiled-program product application', () => {
	it('runs IFR, adoption, an early tap, keyed updates, and unmount from one authored component', async () => {
		const layers = await compileProductLayers();
		expect(layers.backgroundCode).toContain('lynxProgram');
		expect(layers.mainCode).toContain('universalPlan');

		dom = new JSDOM('<!doctype html><html><body></body></html>');
		installLynxTestingEnv(globalThis, {
			window: dom.window as unknown as Window & typeof globalThis,
		});
		globalThis.lynxTestingEnv.switchToMainThread();
		application = installLynxCompiledProgramApplicationMainThread({
			firstScreen: true,
			pageReady: true,
		});

		const paintedRows: readonly ProductRow[] = [
			{ id: 1, label: 'painted-one', image: 'painted-one.png' },
			{ id: 2, label: 'painted-two', image: 'painted-two.png' },
			{ id: 3, label: 'painted-three', image: 'painted-three.png' },
		];
		firstScreenRoot.render(layers.main.CompiledProgramProductFixture, {
			title: 'painted title',
			tone: 'painted',
			rows: paintedRows,
			onRowTap() {},
		});
		markFirstScreenSyncReady();
		const shell = dom.window.document.querySelector('#product-shell');
		const title = dom.window.document.querySelector('#product-title');
		const row1 = dom.window.document.querySelector('#row-1');
		const row2 = dom.window.document.querySelector('#row-2');
		const row3 = dom.window.document.querySelector('#row-3');
		expect([shell, title, row1, row2, row3].every(Boolean)).toBe(true);

		globalThis.lynxTestingEnv.switchToBackgroundThread();
		const gate = gateBackgroundInbound();
		const diagnostics: Error[] = [];
		const taps: string[] = [];
		backgroundRoot = createLynxRoot({
			context: gate.context,
			onDiagnostic: (error) => diagnostics.push(error),
		});
		await backgroundRoot.ready;

		const adoptedRows: readonly ProductRow[] = [
			{ id: 1, label: 'one', image: 'one.png' },
			{ id: 2, label: 'two', image: 'two.png' },
			{ id: 3, label: 'three', image: 'three.png' },
		];
		gate.hold();
		const adopting = backgroundRoot.render(layers.background.CompiledProgramProductFixture, {
			title: 'adopted title',
			tone: 'ready',
			rows: adoptedRows,
			onRowTap: (id, previous) => taps.push(`${id}:${previous}`),
		});
		for (let turn = 0; turn < 8; turn++) await Promise.resolve();

		// Main has repaired the painted scalar mismatch and installed the compact
		// generation, but the background has not accepted its ACK yet. The painted
		// nodes survive that gap, and a native event in it must wait for the
		// background generation rather than run an IFR placeholder closure.
		expect(gate.held()).toBeGreaterThan(0);
		expect(dom.window.document.querySelector('#product-shell')).toBe(shell);
		expect(dom.window.document.querySelector('#product-title')).toBe(title);
		expect(dom.window.document.querySelector('#row-1')).toBe(row1);
		expect(dom.window.document.querySelector('#row-2')).toBe(row2);
		expect(dom.window.document.querySelector('#row-3')).toBe(row3);
		expect(title!.textContent).toBe('adopted title');

		tap('#row-1');
		for (let turn = 0; turn < 8; turn++) await Promise.resolve();
		expect(taps).toEqual([]);

		gate.release();
		const adopted = await adopting;
		await settle();
		expect(directOperations(adopted).map((operation) => operation.op)).toEqual(['run', 'run']);
		expect(taps).toEqual(['1:0']);
		expect(title!.textContent).toBe('adopted title');
		expect(row1!.textContent).toContain('one:1');
		expect(diagnostics).toEqual([]);

		const updated = await backgroundRoot.render(layers.background.CompiledProgramProductFixture, {
			title: 'updated title',
			tone: 'updated',
			rows: [
				{ id: 3, label: 'three', image: 'three.png' },
				{ id: 1, label: 'one-edited', image: 'one-edited.png' },
				{ id: 4, label: 'four', image: 'four.png' },
			],
			onRowTap: (id, previous) => taps.push(`${id}:${previous}`),
		});
		await settle();
		const updateOps = directOperations(updated).map((operation) => operation.op);
		expect(updateOps).toEqual(expect.arrayContaining(['set', 'remove', 'run', 'move']));
		expect(dom.window.document.querySelector('#row-3')).toBe(row3);
		expect(dom.window.document.querySelector('#row-1')).toBe(row1);
		expect(dom.window.document.querySelector('#row-2')).toBeNull();
		expect(dom.window.document.querySelector('#row-4')).not.toBeNull();
		expect(row1!.textContent).toContain('one-edited:1');

		tap('#row-1');
		await settle();
		expect(taps).toEqual(['1:0', '1:1']);
		expect(row1!.textContent).toContain('one-edited:2');

		await backgroundRoot.unmount();
		backgroundRoot = null;
		expect(dom.window.document.querySelector('#product-shell')).toBeNull();
		const late = new dom.window.Event('bindEvent:tap', { bubbles: true });
		Object.defineProperty(late, 'type', { configurable: true, value: 'tap' });
		row1!.dispatchEvent(late);
		for (let turn = 0; turn < 8; turn++) await Promise.resolve();
		expect(taps).toEqual(['1:0', '1:1']);
		expect(diagnostics).toEqual([]);
	});
});
