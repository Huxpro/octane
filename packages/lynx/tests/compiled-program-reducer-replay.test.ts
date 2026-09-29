/**
 * A Block dirty replay updates state-derived slots without rerunning the
 * component. `useReducer` retains its reducer from the last component render,
 * so a reducer that reads other state must stay on the component path: the
 * dispatch after a replayed update has to reduce with the latest reducer.
 */
import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import type { UniversalComponent } from 'octane/universal/native';
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
import * as mainRenderer from '../src/main-renderer.compiled-program.js';
import * as backgroundRenderer from '../src/renderer.js';
import { createLynxRoot, type LynxRoot } from '../src/root.js';

const MODULE = 'tests/ReducerReplay.lynx.tsrx';

function source(reducer: string): string {
	return `/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useReducer, useState } from 'octane';

export function ReducerReplay() @{
	const [n, setN] = useState('a');
	const [t, dispatch] = useReducer(${reducer}, '');
	<view>
		<text id="n" bindtap={() => setN(n + 'b')}>{('n-' + n) as string}</text>
		<text id="t" bindtap={() => dispatch('x')}>{('t-' + t) as string}</text>
	</view>
}
`;
}

let dom: JSDOM | null = null;
let root: LynxRoot | null = null;
let application: ReturnType<typeof installLynxCompiledProgramApplicationMainThread> | null = null;

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
): UniversalComponent<Record<string, never>> {
	const withoutImports = code.replace(
		/import\s*\{([\s\S]*?)\}\s*from\s*(["'])([^"']+)\2\s*;/g,
		(_statement, specifiers: string, _quote: string, request: string) =>
			`const { ${importBindings(specifiers)} } = modules[${JSON.stringify(request)}];`,
	);
	const executable = withoutImports.replace(/\bexport\s+(const|let|var|function|class)\s+/g, '$1 ');
	if (/\b(?:import|export)\b/.test(executable)) {
		throw new Error(`Unexpected module syntax in compiled output:\n${executable}`);
	}
	return Function(
		'modules',
		`"use strict";\n${executable}\nreturn ReducerReplay;`,
	)(modules) as UniversalComponent<Record<string, never>>;
}

function compileLayers(text: string): { readonly background: string; readonly main: string } {
	// Load the compiler through Node so the Lynx project's transform does not
	// parse the compiler implementation itself.
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
		compile(text, `/${MODULE}`, {
			hmr: false,
			renderer: { ...renderer, id: 'lynx' },
			universalRuntime: { runtime: 'lynx', thread },
			mainThreadProgramBackend: CompilerBackend,
			programModuleId: MODULE,
		}).code;
	return {
		background: compileLayer(lynxBlockBackgroundRenderer, 'background'),
		main: compileLayer(lynxMainThreadRenderer, 'main-thread'),
	};
}

function tap(id: string): void {
	const element = dom!.window.document.querySelector(`#${id}`);
	if (element === null) throw new Error(`no element #${id}`);
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

function text(id: string): string | null | undefined {
	return dom!.window.document.querySelector(`#${id}`)?.textContent;
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn++) await Promise.resolve();
	await root!.flushTransport();
	for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

/** Mount, replay a state update, then dispatch; return the painted texts. */
async function runLadder(reducer: string): Promise<{ code: string; steps: string[][] }> {
	const code = compileLayers(source(reducer));
	dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	globalThis.lynxTestingEnv.switchToMainThread();
	application = installLynxCompiledProgramApplicationMainThread({ pageReady: true });
	evaluate(code.main, { '@octanejs/lynx/main-renderer': mainRenderer });
	application.markProgramsReady();

	globalThis.lynxTestingEnv.switchToBackgroundThread();
	const component = evaluate(code.background, { '@octanejs/lynx/renderer': backgroundRenderer });
	root = createLynxRoot();
	await root.ready;
	await root.render(component, {});
	await settle();
	const steps = [[text('n')!, text('t')!]];
	tap('n');
	await settle();
	steps.push([text('n')!, text('t')!]);
	tap('t');
	await settle();
	steps.push([text('n')!, text('t')!]);
	return { code: code.background, steps };
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
	if (dom !== null) {
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
		dom.window.close();
		dom = null;
	}
});

describe.sequential('@octanejs/lynx Block reducer replay', () => {
	it('dispatches with the reducer from the latest render after a state update', async () => {
		const { steps } = await runLadder(`(acc: string, x: string) => acc + x + n`);
		expect(steps).toEqual([
			['n-a', 't-'],
			['n-ab', 't-'],
			['n-ab', 't-xab'],
		]);
	});

	it('still replays state beside a reducer that captures no state', async () => {
		const { code, steps } = await runLadder(`(acc: string, x: string) => acc + x`);
		expect(code).toContain('component-render');
		expect(steps).toEqual([
			['n-a', 't-'],
			['n-ab', 't-'],
			['n-ab', 't-x'],
		]);
	});
});
