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
import {
	LYNX_COMPACT_ACKNOWLEDGEMENT,
	LYNX_MAIN_TO_BACKGROUND_EVENT,
} from '../src/core/protocol.js';
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

it('acknowledges the second compact-eligible run compactly too (issue #230)', async () => {
	const { dom, main } = install();

	firstScreenRoot.render(FirstScreenApp, {});
	globalThis.lynxTestingEnv.switchToBackgroundThread();
	const container = createLynxClientContainer();
	const context = backgroundContext();
	// Main's own replies, read off the wire, because the encoding is the claim.
	const acknowledgements: { readonly encoding?: unknown; readonly handles?: unknown }[] = [];
	context.addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
		const message = (event as { data?: unknown }).data as
			| { readonly type?: string; readonly encoding?: unknown; readonly handles?: unknown }
			| undefined;
		if (message?.type === 'ack') acknowledgements.push(message);
	});
	const transport = createLynxBackgroundTransport(context, container);
	const background = createLynxBlockBackgroundCore({ container, transport });
	transport.bindRoot(background);

	// The benchmark's `Clear` and `Create` are separate clicks, so they are
	// separate commits: a batch that carried both would hold `remove`/`destroy`
	// beside the run and be ineligible for the compact form on its face.
	let fill: ((labels: readonly string[]) => Promise<void>) | null = null;
	let clear: (() => Promise<void>) | null = null;
	const program: LynxBlockProgram<Record<string, never>> = {
		mount(programContext) {
			const page = programContext.core.mount(null, null, PAGE_TEMPLATE, []);
			const slot = programContext.core.openForSlot(page, 1);
			fill = async (labels) => {
				programContext.core.fillForSlot(
					slot,
					ROW_TEMPLATE,
					labels,
					(row) => row,
					(row) => [row],
				);
				await programContext.commit();
			};
			clear = async () => {
				programContext.core.clearForSlot(slot);
				await programContext.commit();
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

	const labels = (count: number): string[] =>
		Array.from({ length: count }, (_, index) => `row ${index + 1}`);

	// Commit 2 is the first template run on this root. It is compact-eligible and
	// main takes the compact form, which is the behaviour already covered above.
	const first = fill!(labels(ROWS));
	await settle();
	await first;
	const afterFirstRun = acknowledgements.length;
	expect(acknowledgements[afterFirstRun - 1]!.encoding).toBe(LYNX_COMPACT_ACKNOWLEDGEMENT);

	// Clearing the range and refilling it is the benchmark's `Clear` then
	// `Create`, and it is where issue #230 lived: taking the compact path swaps
	// the driver's record store to its dense representation, and the incremental
	// candidate test asks for a `Map`, so preparation stops recording a host
	// count. Main used to read that missing count as "not compact" and answer a
	// second, identical run with one handle per host — 70,000 of them for the
	// benchmark's 10,000 rows. The count is recomputable from the batch, and the
	// gate below main's read already re-validates a recomputed count against the
	// prepared handle deltas, so the encoding must not turn on which container
	// the driver happens to be holding its records in.
	const clearing = clear!();
	await settle();
	await clearing;
	const refilling = fill!(labels(ROWS));
	await settle();
	await refilling;

	expect(rowLabels(dom)).toEqual(labels(ROWS));
	const last = acknowledgements[acknowledgements.length - 1]!;
	expect(last.encoding).toBe(LYNX_COMPACT_ACKNOWLEDGEMENT);
	expect(last.handles).toBeUndefined();
});
