// Issue #234 Part C: a page that would cross the platform's painted-element
// ceiling is refused in JavaScript, with a diagnostic, rather than painted into
// a SIGABRT that carries no JavaScript cause at all.
//
// Android charges one JNI global reference per painted element and its table
// holds `max=51200`; the ART dump at the crash attributes the entries to Lynx's
// `PaintingContext`. Every framework in the cross-framework native matrix DNFs
// at eager 10k for the same reason, so this is a platform limit rather than an
// Octane one — which is why the ceiling is a number the caller supplies and not
// a constant this driver applies to everyone.
import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

import type { UniversalHostBatch, UniversalHostCommand } from 'octane/universal/native';
import {
	applyLynxFirstScreenDirect,
	createLynxHostContainer,
	prepareLynxHostBatch,
	LYNX_PAINTED_ELEMENT_CEILING,
	type LynxFirstScreenDirectEnvelope,
	type LynxFirstScreenDirectNode,
} from '../src/core/host-driver.js';
import { LynxFirstScreenRefusalError } from '../src/core/first-screen.js';
import {
	LYNX_BACKGROUND_TO_MAIN_EVENT,
	LYNX_MAIN_TO_BACKGROUND_EVENT,
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	type LynxContextProxy,
} from '../src/core/protocol.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import { createLynxElementPAPI } from '../src/core/papi.js';
import { createFakePAPI } from './_fixtures/fake-element-papi.js';
import { unwire, wire } from './_fixtures/lynx-wire.js';

const envelope: LynxFirstScreenDirectEnvelope = { renderer: 'lynx', version: 1, events: [] };

/**
 * The shared fixture publishes the tree it built, and "nothing was created" is a
 * claim the tree cannot answer: an element built and then abandoned is never
 * inserted, so it leaves no trace there. Wrapping the one call the host paints
 * through does answer it.
 */
function counting(papi: ReturnType<typeof createFakePAPI>) {
	let created = 0;
	const createElement = papi.createElement;
	return {
		...papi,
		createElement(...args: Parameters<typeof createElement>) {
			created += 1;
			return createElement(...args);
		},
		created: () => created,
	};
}

function batch(version: number, commands: readonly UniversalHostCommand[]): UniversalHostBatch {
	return { renderer: 'lynx', version, commands };
}

/** One shell view holding `rows` leaf views: `rows + 1` painted elements. */
function tree(rows: number): LynxFirstScreenDirectNode {
	const children: LynxFirstScreenDirectNode[] = [];
	for (let row = 0; row < rows; row++) {
		children.push({
			kind: 'host',
			id: row + 2,
			type: 'view',
			props: { class: 'row' },
			children: [],
		});
	}
	return { kind: 'host', id: 1, type: 'view', props: { id: 'shell' }, children };
}

/** `list-item > text > #text`, the shape a native list's rows are declared with. */
const DEFERRED_ROW_PROGRAM = Object.freeze({
	nodes: Object.freeze([
		Object.freeze({
			type: 'list-item',
			parent: -1,
			props: Object.freeze({ 'reuse-identifier': 'feed-row' }),
			bindings: Object.freeze([Object.freeze({ name: 'item-key', valueIndex: 0 })]),
		}),
		Object.freeze({ type: 'text', parent: 0, props: Object.freeze({ class: 'row' }) }),
		Object.freeze({
			type: '#text',
			parent: 1,
			props: Object.freeze({}),
			bindings: Object.freeze([Object.freeze({ name: 'value', valueIndex: 1 })]),
		}),
	]),
	events: Object.freeze([]),
});

function deferredRowValues(count: number): readonly string[] {
	const values: string[] = [];
	for (let index = 0; index < count; index++) values.push(`item-${index}`, `Row ${index}`);
	return Object.freeze(values);
}

/** The same shape over the command path: create, then insert into the shell. */
function mountCommands(rows: number): UniversalHostCommand[] {
	const commands: UniversalHostCommand[] = [
		{ op: 'create', id: 1, type: 'view', props: { id: 'shell' } },
	];
	for (let row = 0; row < rows; row++) {
		commands.push({ op: 'create', id: row + 2, type: 'view', props: { class: 'row' } });
	}
	for (let row = 0; row < rows; row++) {
		commands.push({ op: 'insert', parent: 1, id: row + 2, before: null });
	}
	commands.push({ op: 'insert', parent: null, id: 1, before: null });
	return commands;
}

describe('painted-element ceiling', () => {
	it('exports the ceiling derived from the platform reference table', () => {
		// Below `max=51200` with the platform's own bookkeeping left room, and a
		// round number to read in the diagnostic.
		expect(LYNX_PAINTED_ELEMENT_CEILING).toBe(45_000);
		expect(LYNX_PAINTED_ELEMENT_CEILING).toBeLessThan(51_200);
	});

	it('paints a first screen that sits under the ceiling untouched', () => {
		const papi = counting(createFakePAPI());
		const container = createLynxHostContainer(papi, { root: 1, paintedElementCeiling: 8 });
		// Eight elements exactly: the shell and seven rows. The guard is a
		// ceiling, not a quota, so the page that reaches it still paints.
		expect(applyLynxFirstScreenDirect(container, [tree(7)], envelope)).toBe(true);
		expect(papi.pages[0]!.children[0]!.children).toHaveLength(7);
		expect(papi.created()).toBe(8);
	});

	it('declines a first screen that would cross the ceiling, before creating anything', () => {
		const papi = counting(createFakePAPI());
		const container = createLynxHostContainer(papi, { root: 1, paintedElementCeiling: 8 });
		let refusal: unknown;
		try {
			applyLynxFirstScreenDirect(container, [tree(8)], envelope);
		} catch (error) {
			refusal = error;
		}
		expect(refusal).toBeInstanceOf(LynxFirstScreenRefusalError);
		expect((refusal as Error).message).toContain('this page paints 9 elements');
		expect((refusal as Error).message).toContain('over the 8 ceiling');
		expect((refusal as Error).message).toContain('51,200');
		expect((refusal as Error).message).toContain('native `<list>`');
		// Refused in the pre-walk: a page half painted and then abandoned is the
		// one outcome worse than not painting it at all.
		expect(papi.created()).toBe(0);
		expect(papi.pages[0]?.children ?? []).toHaveLength(0);
	});

	it('applies a commit that sits under the ceiling', () => {
		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1, paintedElementCeiling: 8 });
		prepareLynxHostBatch(container, batch(1, mountCommands(7))).apply();
		expect(papi.pages[0]!.children[0]!.children).toHaveLength(7);
	});

	it('faults a commit that would cross the ceiling, and stages nothing', () => {
		const papi = counting(createFakePAPI());
		const container = createLynxHostContainer(papi, { root: 1, paintedElementCeiling: 8 });
		// The command path is where the refusal has to become a fault: a declined
		// first screen still arrives over these commands, so a first-screen
		// refusal alone would only move the abort one message later.
		expect(() => prepareLynxHostBatch(container, batch(1, mountCommands(8)))).toThrow(
			/this page paints 9 elements, over the 8 ceiling/,
		);
		expect(papi.created()).toBe(0);
	});

	it('counts a template run by its whole shape rather than by its command', () => {
		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1, paintedElementCeiling: 8 });
		const program = Object.freeze({
			nodes: Object.freeze([
				Object.freeze({ type: 'view', parent: -1, props: Object.freeze({ class: 'row' }) }),
				Object.freeze({ type: 'text', parent: 0, props: Object.freeze({}) }),
			]),
			events: Object.freeze([]),
		});
		prepareLynxHostBatch(
			container,
			batch(1, [
				{ op: 'create', id: 1, type: 'view', props: { id: 'shell' } },
				{ op: 'insert', parent: null, id: 1, before: null },
			]),
		).apply();
		// One command, eight elements: four rows of a two-node program on top of
		// the shell is nine, and nine is over.
		expect(() =>
			prepareLynxHostBatch(
				container,
				batch(2, [
					{
						op: 'mount-template-run',
						parent: 1,
						before: null,
						program,
						firstId: 10,
						firstListenerId: 100,
						count: 4,
						values: Object.freeze([]),
					},
				]),
			),
		).toThrow(/this page paints 9 elements/);
	});

	it('projects a teardown and its replacement net, not gross', () => {
		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1, paintedElementCeiling: 8 });
		prepareLynxHostBatch(container, batch(1, mountCommands(7))).apply();
		// Retiring six rows and mounting six more holds the survivors, not the
		// sum. Projecting the sum would refuse a page that fits.
		const commands: UniversalHostCommand[] = [];
		for (let row = 0; row < 6; row++) commands.push({ op: 'remove', parent: 1, id: row + 2 });
		for (let row = 0; row < 6; row++) commands.push({ op: 'destroy', id: row + 2 });
		for (let row = 0; row < 6; row++) {
			commands.push({ op: 'create', id: row + 20, type: 'view', props: { class: 'row' } });
		}
		for (let row = 0; row < 6; row++) {
			commands.push({ op: 'insert', parent: 1, id: row + 20, before: null });
		}
		prepareLynxHostBatch(container, batch(2, commands)).apply();
		expect(papi.pages[0]!.children[0]!.children).toHaveLength(7);
	});

	it('does not count a native list row nobody has asked for yet', () => {
		// The refusal's own advice is `<list>`, so counting a declaration would
		// make the guardrail refuse the page it just told the author to write. A
		// deferred run declares 50 rows of three hosts each — 150 elements if this
		// counted declarations — and paints none of them.
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		globalThis.lynxTestingEnv.clearGlobal();
		globalThis.lynxTestingEnv.switchToMainThread();
		try {
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), {
				root: 1,
				paintedElementCeiling: 8,
			});
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
					{
						op: 'mount-template-run',
						parent: 1,
						before: null,
						program: DEFERRED_ROW_PROGRAM,
						firstId: 100,
						firstListenerId: null,
						count: 50,
						values: deferredRowValues(50),
						deferred: true,
					},
					{ op: 'insert', parent: null, id: 1, before: null },
				]),
			).apply();
			// The list itself is the one element that commit painted, so seven more
			// reach the ceiling and an eighth crosses it. Both halves are the
			// assertion: the declaration left neither arrears nor slack.
			const fill = (version: number, count: number, first: number) =>
				batch(
					version,
					Array.from({ length: count }, (_unused, index) => ({
						op: 'create' as const,
						id: first + index,
						type: 'view',
						props: {},
					})),
				);
			prepareLynxHostBatch(container, fill(2, 7, 400)).apply();
			expect(() => prepareLynxHostBatch(container, fill(3, 1, 500))).toThrow(
				/this page paints 9 elements/,
			);
		} finally {
			globalThis.lynxTestingEnv.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('does not count a native list page composed out of ordinary commands', () => {
		// The deferred run above announces itself with `deferred: true`. A native
		// list composed the ordinary way announces nothing: it is `create list`,
		// `create list-item`, subtree `create`s and `insert`s, and no single one of
		// those commands says the row will not paint. Counting them made this
		// guard refuse a large native-`<list>` page — the one page shape its own
		// diagnostic recommends — which is the false-refusal half of the defect.
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		globalThis.lynxTestingEnv.clearGlobal();
		globalThis.lynxTestingEnv.switchToMainThread();
		try {
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), {
				root: 1,
				paintedElementCeiling: 8,
			});
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
					{ op: 'insert', parent: null, id: 1, before: null },
				]),
			).apply();

			// Ten rows of two hosts each, every one of them under an unattached
			// cell: twenty creates against a ceiling of eight, and none of them
			// paints because the platform has not asked for a single cell.
			const rows: UniversalHostCommand[] = [];
			for (let row = 0; row < 10; row++) {
				const item = 10 + row * 3;
				rows.push(
					{ op: 'create', id: item, type: 'list-item', props: { 'item-key': `row-${row}` } },
					{ op: 'create', id: item + 1, type: 'view', props: {} },
					{ op: 'create', id: item + 2, type: 'text', props: {} },
					{ op: 'insert', parent: item, id: item + 1, before: null },
					// Two levels deep, so a projection that only looked at a create's
					// immediate parent would count this one and refuse the page.
					{ op: 'insert', parent: item + 1, id: item + 2, before: null },
					{ op: 'insert', parent: 1, id: item, before: null },
				);
			}
			prepareLynxHostBatch(container, batch(2, rows)).apply();

			// The list is still the only painted element, so seven more views reach
			// the ceiling and an eighth crosses it. Both halves are the assertion:
			// twenty declared rows left neither arrears nor slack.
			const fill = (version: number, count: number, first: number) =>
				batch(
					version,
					Array.from({ length: count }, (_unused, index) => ({
						op: 'create' as const,
						id: first + index,
						type: 'view',
						props: {},
					})),
				);
			prepareLynxHostBatch(container, fill(3, 7, 400)).apply();
			expect(() => prepareLynxHostBatch(container, fill(4, 1, 500))).toThrow(
				/this page paints 9 elements/,
			);
		} finally {
			globalThis.lynxTestingEnv.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('does not let a destroy of rows nobody materialized mask real growth', () => {
		// The other half of the same defect. `projected` starts from
		// `ownedNodes.size`, the painted reality, so decrementing for a row that
		// was never painted hands the batch headroom it never occupied — and a
		// commit retiring declared rows while creating real views crosses the real
		// table unrefused.
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		globalThis.lynxTestingEnv.clearGlobal();
		globalThis.lynxTestingEnv.switchToMainThread();
		try {
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), {
				root: 1,
				paintedElementCeiling: 8,
			});
			const items = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
					...items.map((id) => ({
						op: 'create' as const,
						id,
						type: 'list-item',
						props: { 'item-key': `row-${id}` },
					})),
					...items.map((id) => ({ op: 'insert' as const, parent: 1, id, before: null })),
					{ op: 'insert', parent: null, id: 1, before: null },
				]),
			).apply();

			// Retire all ten declared rows and paint eight real views in the same
			// commit. Gross that is 1 + 8 = 9 painted elements, over the ceiling.
			// Netting the ten unpainted destroys against it reads -1 and lets the
			// commit through, which is exactly the under-guard.
			expect(() =>
				prepareLynxHostBatch(
					container,
					batch(2, [
						...items.map((id) => ({ op: 'destroy' as const, id })),
						...Array.from({ length: 8 }, (_unused, index) => ({
							op: 'create' as const,
							id: 400 + index,
							type: 'view',
							props: {},
						})),
					]),
				),
			).toThrow(/this page paints 9 elements/);
		} finally {
			globalThis.lynxTestingEnv.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('counts a mounted template by the nodes it materializes', () => {
		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1, paintedElementCeiling: 8 });
		const nodes: { id: number; props: Record<string, unknown> }[] = [];
		const shape: { type: string; parent: number }[] = [];
		for (let index = 0; index < 9; index++) {
			shape.push({ type: 'view', parent: index === 0 ? -1 : 0 });
			nodes.push({ id: index + 1, props: {} });
		}
		// `mount-template` paints one element per node in one command, exactly as
		// the two program mounts do, and a projection that read only `create`
		// would let the whole template through.
		expect(() =>
			prepareLynxHostBatch(
				container,
				batch(1, [{ op: 'mount-template', parent: null, before: null, shape, nodes } as never]),
			),
		).toThrow(/this page paints 9 elements/);
	});

	it('counts the keyed ranges a first-screen program was handed to paint', () => {
		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1, paintedElementCeiling: 8 });
		// Seven program nodes and two ranges the program paints is nine elements;
		// the third range is a hole this renderer filled, whose node is a child and
		// is counted as one. The mount counts ownership the same way, so a
		// projection that read only `ids` would under-count every program on the
		// page by its painted text.
		const program: LynxFirstScreenDirectNode = {
			kind: 'program',
			id: 1,
			children: [],
			ids: [1, 2, 3, 4, 5, 6, 7],
			texts: ['painted', undefined, 'painted too'],
		};
		let refusal: unknown;
		try {
			applyLynxFirstScreenDirect(container, [program], envelope);
		} catch (error) {
			refusal = error;
		}
		expect(refusal).toBeInstanceOf(LynxFirstScreenRefusalError);
		expect((refusal as Error).message).toContain('this page paints 9 elements');
	});

	it('holds the ceiling against what the container already painted', () => {
		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1, paintedElementCeiling: 8 });
		prepareLynxHostBatch(container, batch(1, mountCommands(7))).apply();
		// Full. One more element is one too many, and the second commit is where
		// a page grows past a limit its first commit sat under.
		expect(() =>
			prepareLynxHostBatch(
				container,
				batch(2, [
					{ op: 'create', id: 90, type: 'view', props: { class: 'row' } },
					{ op: 'insert', parent: 1, id: 90, before: null },
				]),
			),
		).toThrow(/this page paints 9 elements/);
	});

	it('paints without limit when the container was given no ceiling', () => {
		const papi = counting(createFakePAPI());
		const container = createLynxHostContainer(papi, { root: 1 });
		// Every engine but Android: no per-element reference table, so no ceiling
		// and no per-node arithmetic on the paint path either.
		expect(applyLynxFirstScreenDirect(container, [tree(200)], envelope)).toBe(true);
		expect(papi.created()).toBe(201);
		prepareLynxHostBatch(
			createLynxHostContainer(createFakePAPI(), { root: 2 }),
			batch(1, mountCommands(200)),
		).apply();
	});

	it('refuses a ceiling that is not a positive safe integer', () => {
		const papi = createFakePAPI();
		for (const ceiling of [0, -1, 1.5, Number.NaN]) {
			expect(() =>
				createLynxHostContainer(papi, { root: 1, paintedElementCeiling: ceiling }),
			).toThrow(/paintedElementCeiling must be a positive safe integer or omitted/);
		}
	});
});

// Which engine is running is not the host driver's to know, so the driver takes
// a ceiling and the main-thread install derives one. `SystemInfo.platform` is
// where Lynx says: native Android reports `Android`, and Lynx-for-Web reports
// `web` through the same field, which is why one bundle serving both cannot
// carry the ceiling as a constant.
let installed: { dom: JSDOM; main: LynxMainThreadController } | null = null;

function installOn(
	platform: string | undefined,
	options: { readonly paintedElementCeiling?: number | null } = {},
): { readonly inbound: Record<string, unknown>[]; readonly commit: (batch: unknown) => void } {
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	globalThis.lynxTestingEnv.switchToMainThread();
	const target = globalThis as unknown as { SystemInfo?: unknown; lynx: { SystemInfo?: unknown } };
	// The native main thread carries `SystemInfo` only under `lynx`, and the
	// install republishes it as the bare global authored worklets read. Clearing
	// the bare one is what makes this test exercise that republication rather
	// than a global the environment happened to set first.
	delete target.SystemInfo;
	target.lynx.SystemInfo = platform === undefined ? {} : { platform };
	const main = installLynxMainThread(options);
	installed = { dom, main };
	globalThis.lynxTestingEnv.switchToBackgroundThread();
	const context = (
		globalThis as typeof globalThis & { lynx: { getCoreContext(): LynxContextProxy } }
	).lynx.getCoreContext();
	const inbound: Record<string, unknown>[] = [];
	context.addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
		inbound.push(unwire(event.data) as Record<string, unknown>);
	});
	return {
		inbound,
		commit(batch: unknown) {
			context.dispatchEvent({
				type: LYNX_BACKGROUND_TO_MAIN_EVENT,
				data: wire({
					protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
					renderer: LYNX_TRANSPORT_RENDERER,
					root: 777,
					version: 1,
					type: 'commit',
					batch,
				}),
			});
		},
	};
}

/** The reply types a commit came back with, in order. */
function replies(inbound: readonly Record<string, unknown>[]): string[] {
	return inbound.map((message) => String(message.type));
}

/** The error text of the one reply that carried an error, or `''` for none. */
function replyError(inbound: readonly Record<string, unknown>[]): string {
	const failure = inbound.find((message) => message.error !== undefined);
	return failure === undefined
		? ''
		: String((failure.error as { message?: unknown })?.message ?? '');
}

/**
 * The reply that says a batch was turned away with nothing applied.
 *
 * `reject` rather than `fault` is the property worth holding: a ceiling that
 * refused a batch before its first command ran leaves the root exactly as the
 * previous commit left it, so the page keeps working and the background is told
 * why. A `fault` would mean the driver had already started painting.
 */
const REFUSED = ['reject'];
const ACCEPTED = ['ack', 'complete'];

/**
 * A batch that projects one element past the Android ceiling and paints nothing.
 *
 * Both arms of the platform gate run this same batch, and neither may paint
 * 45,000 elements to make its point. Creates with no inserts are what allow
 * that: the projection counts every one of them, so a container that derived a
 * ceiling refuses the batch before command zero runs, while one that derived
 * none accepts it and leaves 45,001 detached elements the page never shows.
 */
function overCeilingCommands(): Record<string, unknown>[] {
	const commands: Record<string, unknown>[] = [];
	for (let index = 0; index <= LYNX_PAINTED_ELEMENT_CEILING; index++) {
		commands.push({ op: 'create', id: index + 1, type: 'view', props: {} });
	}
	return commands;
}

const overCeilingBatch = { renderer: 'lynx', version: 1, commands: overCeilingCommands() };

afterEach(() => {
	if (installed !== null) {
		installed.main.close();
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
		installed.dom.window.close();
	}
	installed = null;
});

describe.sequential('painted-element ceiling by platform', () => {
	it('derives the ceiling for an Android engine', () => {
		const { inbound, commit } = installOn('Android');
		commit(overCeilingBatch);
		expect(replies(inbound)).toEqual(REFUSED);
		expect(replyError(inbound)).toContain('this page paints 45001 elements, over the 45000');
	});

	it('derives no ceiling for Lynx-for-Web, which has no reference table', () => {
		const { inbound, commit } = installOn('web');
		// The same batch, and the whole point: `web` is a platform this bundle
		// also serves, so a ceiling applied unconditionally would refuse pages the
		// browser renders without complaint.
		commit(overCeilingBatch);
		expect(replies(inbound)).toEqual(ACCEPTED);
	});

	it('derives no ceiling for an engine that reports no platform at all', () => {
		const { inbound, commit } = installOn(undefined);
		// Refusing a page because the engine did not identify itself would turn a
		// missing field into a broken app. The ceiling is opt-in on evidence.
		commit(overCeilingBatch);
		expect(replies(inbound)).toEqual(ACCEPTED);
	});

	it('takes an explicit ceiling on any platform', () => {
		const { inbound, commit } = installOn('web', { paintedElementCeiling: 8 });
		commit({ renderer: 'lynx', version: 1, commands: mountCommands(8) });
		expect(replies(inbound)).toEqual(REFUSED);
		expect(replyError(inbound)).toContain('this page paints 9 elements, over the 8 ceiling');
	});

	it('turns the ceiling off for an Android engine given null', () => {
		const { inbound, commit } = installOn('Android', { paintedElementCeiling: null });
		// An engine that lifted the limit, or a page whose author accepts the risk
		// deliberately: `null` is the difference between a default and a law.
		commit(overCeilingBatch);
		expect(replies(inbound)).toEqual(ACCEPTED);
	});

	it('refuses an explicit ceiling that is not a positive safe integer', () => {
		const dom = new JSDOM('<!doctype html><html><body></body></html>');
		installLynxTestingEnv(globalThis, {
			window: dom.window as unknown as Window & typeof globalThis,
		});
		globalThis.lynxTestingEnv.switchToMainThread();
		try {
			for (const ceiling of [0, -1, 1.5, Number.NaN]) {
				expect(() => installLynxMainThread({ paintedElementCeiling: ceiling })).toThrow(
					/paintedElementCeiling must be a positive safe integer, null, or omitted/,
				);
			}
		} finally {
			globalThis.lynxTestingEnv.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});
});
