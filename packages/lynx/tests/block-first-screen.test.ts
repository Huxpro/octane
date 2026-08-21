// Issue-#103 B0: the Block core behind a main-painted first screen.
//
// `block-root.test.ts` and `block-background.test.ts` stand the core on a real
// transport, but against a fake main thread that acknowledges whatever it is
// sent. A real main thread negotiates, and while it still owns a first screen
// it painted, it keeps every optional wire behaviour dormant — a first tree is
// compared against a legacy batch, so intrinsic template runs are off for
// exactly one commit. Two defects hid in that gap, both of which left the
// benchmark page frozen on its first screen with a rejected commit:
//
//   1. the core mounted with `mount-template-run` on its first commit, which
//      main rejected as an unnegotiated template run; and
//   2. its template program was the caller's object rather than a frozen copy,
//      so the compact acknowledgement main sent for the *second* commit was one
//      the transport would only accept in its incremental form, which requires
//      a frozen run.
//
// The oracle is the painted tree, on the real main thread, after both commits.
import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it } from 'vitest';

import { root as firstScreenRoot } from '../src/first-screen.js';
import * as firstScreen from '../src/main-renderer.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import { compileLynxBlockTemplate } from '../src/block.js';
import { withLynxBlockProgram, type LynxBlockProgram } from '../src/block.js';
import { createLynxBlockBackgroundCore } from '../src/core/block-background.js';
import { createLynxClientContainer } from '../src/core/client-driver.js';
import { createLynxBackgroundTransport } from '../src/core/transport.js';
import type { LynxContextProxy } from '../src/core/protocol.js';
import type { LynxComponent } from '../src/intrinsics.js';

// Well above LYNX_COMPACT_ACKNOWLEDGEMENT_MIN_HOSTS (16) once multiplied by the
// row template's host count, so main does offer a compact acknowledgement for
// the second commit rather than the plain one that would hide defect 2.
const ROWS = 24;

const PAGE_TEMPLATE = compileLynxBlockTemplate({
	nodes: [
		{ type: 'view', parent: -1, props: { class: 'page' } },
		{ type: 'view', parent: 0, props: { class: 'rows' } },
	],
	events: [],
});

const ROW_TEMPLATE = compileLynxBlockTemplate({
	nodes: [
		{ type: 'view', parent: -1, props: { class: 'row' } },
		{ type: 'text', parent: 0, props: { class: 'col-label' } },
		{
			type: '#text',
			parent: 1,
			props: { value: '' },
			bindings: [{ name: 'value', valueIndex: 0 }],
		},
	],
	events: [{ node: 1, type: 'bindtap', priority: 'default' }],
});

// The same shell main paints, written for the first-screen renderer.
const FIRST_SCREEN_PLAN = firstScreen.universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	props: { class: 'page' },
	children: [{ kind: 'host', type: 'view', props: { class: 'rows' } }],
});

const FirstScreenApp = firstScreen.defineUniversalComponent('lynx', () =>
	firstScreen.universalValue(FIRST_SCREEN_PLAN, []),
) as unknown as LynxComponent<Record<string, never>>;

interface Installed {
	readonly dom: JSDOM;
	readonly main: LynxMainThreadController;
}

let installed: Installed | null = null;

function mainContext(): LynxContextProxy {
	return (
		globalThis as typeof globalThis & { lynx: { getJSContext(): LynxContextProxy } }
	).lynx.getJSContext();
}

function backgroundContext(): LynxContextProxy {
	return (
		globalThis as typeof globalThis & { lynx: { getCoreContext(): LynxContextProxy } }
	).lynx.getCoreContext();
}

function install(): Installed {
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	globalThis.lynxTestingEnv.switchToMainThread();
	const main = installLynxMainThread({
		firstScreen: true,
		firstScreenSync: 'manual',
		context: mainContext(),
	});
	installed = { dom, main };
	return installed;
}

afterEach(async () => {
	if (installed === null) return;
	globalThis.lynxTestingEnv.switchToMainThread();
	await firstScreenRoot.unmount();
	installed.main.close();
	globalThis.lynxTestingEnv.clearGlobal();
	uninstallLynxTestingEnv(globalThis);
	installed.dom.window.close();
	installed = null;
});

async function settle(): Promise<void> {
	for (let index = 0; index < 12; index++) await Promise.resolve();
}

function rowLabels(dom: JSDOM): string[] {
	const rows = dom.window.document.querySelector('page')?.querySelector('.rows');
	return [...(rows?.children ?? [])].map((row) => row.textContent ?? '');
}

it('paints through the Block core behind a first screen main already painted', async () => {
	const { dom, main } = install();

	firstScreenRoot.render(FirstScreenApp, {});
	expect(dom.window.document.querySelector('page')?.querySelector('.rows')).not.toBeNull();

	globalThis.lynxTestingEnv.switchToBackgroundThread();
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(backgroundContext(), container);
	const background = createLynxBlockBackgroundCore({ container, transport });
	transport.bindRoot(background);

	// Mount is commit 1: it has to adopt or repair main's first screen, so it
	// may not use template runs. Filling the range is commit 2, which may.
	let fill: (() => Promise<void>) | null = null;
	const program: LynxBlockProgram<Record<string, never>> = {
		mount(context) {
			const page = context.core.mount(null, null, PAGE_TEMPLATE, []);
			const slot = context.core.openForSlot(page, 1);
			fill = async () => {
				const rows = Array.from({ length: ROWS }, (_, index) => `row ${index + 1}`);
				context.core.fillForSlot(
					slot,
					ROW_TEMPLATE,
					rows,
					(row) => row,
					(row) => [row],
				);
				await context.commit();
			};
		},
	};
	const component = withLynxBlockProgram(
		(() => null) as unknown as LynxComponent<Record<string, never>>,
		program,
	);

	const rendering = background.renderAsync(component as never, {});
	await settle();
	globalThis.lynxTestingEnv.switchToMainThread();
	main.markFirstScreenSyncReady();
	globalThis.lynxTestingEnv.switchToBackgroundThread();
	await settle();
	await rendering;

	const filling = fill!();
	await settle();
	await filling;

	expect(rowLabels(dom)).toEqual(Array.from({ length: ROWS }, (_, index) => `row ${index + 1}`));
});
