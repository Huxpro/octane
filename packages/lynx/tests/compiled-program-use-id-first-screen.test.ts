/**
 * `useId` across the compiled-program first-screen handoff.
 *
 * The main thread paints the authored component before the background Block
 * core renders it. Both layers must name every mounted instance with the same
 * opaque id, or the first background frame rewrites each painted `id`, and an
 * early native selector or accessibility relation bound to the painted value
 * stops matching. This suite drives the real compiled layers through first-
 * screen paint, compact adoption, and later updates.
 */
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
import {
	markFirstScreenSyncReady,
	root as firstScreenRoot,
} from '../src/first-screen.compiled-program.js';
import * as completeMainRenderer from '../src/main-renderer.js';
import * as mainRenderer from '../src/main-renderer.compiled-program.js';
import * as backgroundRenderer from '../src/renderer.js';
import { createLynxRoot, type LynxRoot } from '../src/root.js';

const MODULE = 'tests/_fixtures/compiled-program-use-id.lynx.tsrx';
const SOURCE = readFileSync(
	fileURLToPath(new URL('./_fixtures/compiled-program-use-id.lynx.tsrx', import.meta.url)),
	'utf8',
);

interface UseIdRow {
	readonly id: number;
	readonly label: string;
}

interface UseIdProps {
	readonly rows: readonly UseIdRow[];
	readonly showBadge: boolean;
	readonly failBoundary: boolean;
	readonly observe: (owner: string, id: string) => void;
}

type UseIdComponent = UniversalComponent<UseIdProps>;

let dom: JSDOM | null = null;
let backgroundRoot: LynxRoot | null = null;
let application: ReturnType<typeof installLynxCompiledProgramApplicationMainThread> | null = null;

function evaluateCompiledLayer(
	code: string,
	modules: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): UseIdComponent {
	const executable = code
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*(["'])([^"']+)\2\s*;/g,
			(_statement, specifiers: string, _quote: string, request: string) =>
				`const { ${specifiers
					.split(',')
					.map((specifier) => specifier.trim())
					.filter(Boolean)
					.map((specifier) => specifier.replace(/\s+as\s+/, ': '))
					.join(', ')} } = modules[${JSON.stringify(request)}];`,
		)
		.replace(/\bexport\s+(const|let|var|function|class)\s+/g, '$1 ');
	if (/\b(?:import|export)\b/.test(executable)) {
		throw new Error(`Unexpected module syntax in compiled output:\n${executable}`);
	}
	return Function(
		'modules',
		`"use strict";\n${executable}\nreturn CompiledProgramUseIdFixture;`,
	)(modules) as UseIdComponent;
}

interface UseIdLayers {
	readonly background: UseIdComponent;
	readonly main: UseIdComponent;
	/** The same main-thread output, linked to the complete first-screen renderer. */
	readonly completeMain: UseIdComponent;
}

let compiledLayers: UseIdLayers | null = null;

// Compile once per file: the main thread resolves a background program by its
// module/index identity, so every test must paint with the same plan objects.
function compileLayers(): UseIdLayers {
	if (compiledLayers !== null) return compiledLayers;
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
	const mainCode = compileLayer(lynxMainThreadRenderer, 'main-thread');
	return (compiledLayers = {
		background: evaluateCompiledLayer(compileLayer(lynxBlockBackgroundRenderer, 'background'), {
			'@octanejs/lynx/renderer': backgroundRenderer,
		}),
		main: evaluateCompiledLayer(mainCode, { '@octanejs/lynx/main-renderer': mainRenderer }),
		completeMain: evaluateCompiledLayer(mainCode, {
			'@octanejs/lynx/main-renderer': completeMainRenderer,
		}),
	});
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn++) await Promise.resolve();
	await backgroundRoot!.flushTransport();
	for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

function recorder(): {
	readonly observe: (owner: string, id: string) => void;
	readonly latest: Map<string, string>;
} {
	const latest = new Map<string, string>();
	return { observe: (owner, id) => latest.set(owner, id), latest };
}

function paintedIds(): {
	readonly shell: string;
	readonly rows: string[];
	readonly badge: string[];
	readonly boundary: string[];
} {
	const document = dom!.window.document;
	const ids = (selector: string) =>
		[...document.querySelectorAll(selector)].map((element) => element.id);
	return {
		shell: document.querySelector('.use-id-shell')!.id,
		rows: ids('.use-id-row'),
		badge: ids('.use-id-branch .use-id-badge'),
		boundary: ids('.use-id-boundary .use-id-badge, .use-id-boundary-body'),
	};
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

describe.sequential('@octanejs/lynx useId across the compiled-program first-screen handoff', () => {
	async function paintAndAdopt(props: Omit<UseIdProps, 'observe'>) {
		const layers = compileLayers();
		dom = new JSDOM('<!doctype html><html><body></body></html>');
		installLynxTestingEnv(globalThis, {
			window: dom.window as unknown as Window & typeof globalThis,
		});
		globalThis.lynxTestingEnv.switchToMainThread();
		const diagnostics: Error[] = [];
		application = installLynxCompiledProgramApplicationMainThread({
			firstScreen: true,
			pageReady: true,
			onDiagnostic: (error) => diagnostics.push(error),
		});
		const main = recorder();
		firstScreenRoot.render(layers.main, { ...props, observe: main.observe });
		markFirstScreenSyncReady();
		const painted = paintedIds();
		const shell = dom.window.document.querySelector('.use-id-shell')!;
		const rowElements = [...dom.window.document.querySelectorAll('.use-id-row')];

		const idWrites: string[] = [];
		const watcher = new dom.window.MutationObserver((records) => {
			for (const record of records) {
				idWrites.push(`${record.oldValue} -> ${(record.target as Element).id}`);
			}
		});
		watcher.observe(dom.window.document.body, {
			subtree: true,
			attributes: true,
			attributeFilter: ['id'],
			attributeOldValue: true,
		});

		globalThis.lynxTestingEnv.switchToBackgroundThread();
		const background = recorder();
		backgroundRoot = createLynxRoot({ onDiagnostic: (error) => diagnostics.push(error) });
		await backgroundRoot.ready;
		await backgroundRoot.render(layers.background, { ...props, observe: background.observe });
		await settle();
		globalThis.lynxTestingEnv.switchToMainThread();
		for (const record of watcher.takeRecords()) {
			idWrites.push(`${record.oldValue} -> ${(record.target as Element).id}`);
		}
		watcher.disconnect();
		globalThis.lynxTestingEnv.switchToBackgroundThread();
		return { layers, main, background, painted, shell, rowElements, idWrites, diagnostics };
	}

	it('names every first-screen instance with the id its background Block scope adopts', async () => {
		const rows = [
			{ id: 1, label: 'one' },
			{ id: 2, label: 'two' },
			{ id: 3, label: 'three' },
		];
		const { main, background, painted, shell, rowElements, idWrites, diagnostics } =
			await paintAndAdopt({ rows, showBadge: true, failBoundary: true });

		// The painted values are the main thread's own ids, all distinct.
		const paintedAll = [painted.shell, ...painted.rows, ...painted.badge, ...painted.boundary];
		expect(paintedAll).toHaveLength(6);
		expect(new Set(paintedAll).size).toBe(6);
		expect(painted.shell).toBe(main.latest.get('shell'));
		expect(painted.rows).toEqual(['row-1', 'row-2', 'row-3'].map((key) => main.latest.get(key)));
		expect(painted.badge).toEqual([main.latest.get('badge')]);
		// The discarded try body never joined the tree, so its catch arm took the
		// position it had drawn.
		expect(painted.boundary).toEqual([main.latest.get('caught')]);
		expect(main.latest.get('caught')).toBe(main.latest.get('boundary-body'));

		// Every instance's background id equals the one it painted with.
		expect([...background.latest]).toEqual([...main.latest]);
		// Adoption kept the painted nodes and never rewrote an id attribute.
		expect(dom!.window.document.querySelector('.use-id-shell')).toBe(shell);
		expect([...dom!.window.document.querySelectorAll('.use-id-row')]).toEqual(rowElements);
		expect(paintedIds()).toEqual(painted);
		expect(idWrites).toEqual([]);
		expect(diagnostics).toEqual([]);
	});

	it('gives instances mounted after the first screen fresh ids and keeps survivors', async () => {
		const { layers, background, painted, diagnostics } = await paintAndAdopt({
			rows: [
				{ id: 1, label: 'one' },
				{ id: 2, label: 'two' },
			],
			showBadge: false,
			failBoundary: false,
		});
		const firstIds = new Set([painted.shell, ...painted.rows, ...painted.boundary]);
		expect(firstIds.size).toBe(4);
		const adopted = new Map(background.latest);

		await backgroundRoot!.render(layers.background, {
			rows: [
				{ id: 2, label: 'two' },
				{ id: 4, label: 'four' },
				{ id: 1, label: 'one' },
			],
			showBadge: true,
			failBoundary: false,
			observe: background.observe,
		});
		await settle();

		// Survivors keep their painted ids through the move.
		expect(background.latest.get('shell')).toBe(adopted.get('shell'));
		expect(background.latest.get('row-1')).toBe(adopted.get('row-1'));
		expect(background.latest.get('row-2')).toBe(adopted.get('row-2'));
		expect(background.latest.get('boundary-body')).toBe(adopted.get('boundary-body'));
		// New instances receive ids that no first-screen instance used.
		const fresh = [background.latest.get('row-4')!, background.latest.get('badge')!];
		expect(fresh.every((id) => typeof id === 'string' && !firstIds.has(id))).toBe(true);
		expect(new Set(fresh).size).toBe(2);
		const now = paintedIds();
		expect(now.rows).toEqual(['row-2', 'row-4', 'row-1'].map((key) => background.latest.get(key)));
		expect(now.badge).toEqual([background.latest.get('badge')]);

		// A remounted key is a new instance and never reuses a live or painted id.
		await backgroundRoot!.render(layers.background, {
			rows: [{ id: 2, label: 'two' }],
			showBadge: false,
			failBoundary: false,
			observe: background.observe,
		});
		await settle();
		await backgroundRoot!.render(layers.background, {
			rows: [
				{ id: 2, label: 'two' },
				{ id: 1, label: 'one' },
			],
			showBadge: true,
			failBoundary: false,
			observe: background.observe,
		});
		await settle();
		const remountedRow = background.latest.get('row-1')!;
		const remountedBadge = background.latest.get('badge')!;
		expect(remountedRow).not.toBe(adopted.get('row-1'));
		expect(remountedBadge).not.toBe(fresh[1]);
		const live = [
			background.latest.get('shell')!,
			background.latest.get('row-2')!,
			background.latest.get('boundary-body')!,
			remountedRow,
			remountedBadge,
		];
		expect(new Set(live).size).toBe(live.length);
		expect(firstIds.has(remountedRow)).toBe(false);
		expect(firstIds.has(remountedBadge)).toBe(false);
		expect(diagnostics).toEqual([]);
	});

	it('paints the same ids from the complete main-thread first-screen renderer', () => {
		// The Block background adopts either main-thread renderer's first screen,
		// so both must name the same instances with the same positional ids.
		const layers = compileLayers();
		const props = {
			rows: [
				{ id: 1, label: 'one' },
				{ id: 2, label: 'two' },
			],
			showBadge: true,
			failBoundary: true,
		};
		const compact = recorder();
		const complete = recorder();
		mainRenderer.renderLynxFirstScreen(layers.main, { ...props, observe: compact.observe });
		completeMainRenderer.renderLynxFirstScreen(layers.completeMain, {
			...props,
			observe: complete.observe,
		});
		expect(compact.latest.size).toBe(6);
		expect([...complete.latest]).toEqual([...compact.latest]);
	});
});
