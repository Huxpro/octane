// Issue-#135 item 2, U3b-b2: a native `<list>` whose rows are declared rather
// than built.
//
// The rows of a `<list>` are a keyed range of `<list-item>`s, and the platform
// asks for one only when it is about to show it. A deferred run says so on the
// wire: the commit declares the whole range and the host builds a row when the
// list enters it. What that changes is invisible in the DOM — a list row owns no
// element until its cell materializes either way — so the contract is observed
// where it is expressed: the command the commit sends, and the behavior of a row
// that was never named by a `create`.
import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import type { UniversalComponent } from 'octane/universal/native';
import { afterEach, describe, expect, it } from 'vitest';

import { createLynxRoot, type LynxRoot } from '../src/index.js';
// A worklet row is one of the rows a renderer refuses to declare, and building
// one binds the worklet on the main thread — which is inert unless the bundle
// compiled the optional feature in.
import '../src/main-worklets.js';
import { registerMainThreadWorklet } from '../src/core/worklets.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import {
	LYNX_BACKGROUND_TO_MAIN_EVENT,
	type LynxContextProxy,
	type LynxContextProxyEvent,
	type LynxTransportCommitMessage,
} from '../src/core/protocol.js';
import { NativeListLifecycleFixture } from './_fixtures/native-list-lifecycle.lynx.tsrx';
import { NativeListMixedFixture } from './_fixtures/native-list-mixed.lynx.tsrx';
import { NativeListWorkletFixture } from './_fixtures/native-list-worklet.lynx.tsrx';

interface Row {
	readonly id: string;
	readonly label: string;
}

type Commands = LynxTransportCommitMessage['batch']['commands'];

const fixture = NativeListLifecycleFixture as UniversalComponent<{
	readonly items: readonly Row[];
	readonly captureIncrement: (id: string, increment: () => void) => void;
	readonly log: (entry: string) => void;
}>;

const workletFixture = NativeListWorkletFixture as UniversalComponent<{
	readonly items: readonly Row[];
	readonly tap: unknown;
}>;

const mixedFixture = NativeListMixedFixture as UniversalComponent<{
	readonly items: readonly (Row & { readonly tappable: boolean })[];
	readonly tap: unknown;
}>;

const rows = (count: number, prefix = 'Row'): Row[] =>
	Array.from({ length: count }, (_, index) => ({
		id: String(index),
		label: `${prefix} ${index}`,
	}));

let root: LynxRoot | null = null;
let main: LynxMainThreadController | null = null;
let dom: JSDOM | null = null;

afterEach(async () => {
	if (root !== null) {
		try {
			await root.unmount();
		} catch {
			// A failed assertion can leave a root already terminally disposed.
		}
	}
	root = null;
	main?.close();
	main = null;
	if (dom !== null) {
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
		dom.window.close();
		dom = null;
	}
});

/**
 * Main's own context, with every commit it receives recorded.
 *
 * The background dispatches onto the shared context and main subscribes to it,
 * so a wrapper that only forwards sees nothing. Wrapping the listener is what
 * puts this on the path the frames actually take.
 */
function recordingContext(context: LynxContextProxy, commands: Commands[]): LynxContextProxy {
	const wrappers = new Map<
		(event: LynxContextProxyEvent) => void,
		(event: LynxContextProxyEvent) => void
	>();
	return {
		dispatchEvent(event) {
			return context.dispatchEvent(event);
		},
		addEventListener(type, listener) {
			const wrapper = (event: LynxContextProxyEvent) => {
				const message = event.data as { readonly type?: unknown; readonly batch?: unknown };
				if (type === LYNX_BACKGROUND_TO_MAIN_EVENT && message?.type === 'commit') {
					commands.push((message.batch as LynxTransportCommitMessage['batch']).commands);
				}
				listener(event);
			};
			wrappers.set(listener, wrapper);
			context.addEventListener(type, wrapper);
		},
		removeEventListener(type, listener) {
			context.removeEventListener(type, wrappers.get(listener) ?? listener);
		},
	};
}

describe.sequential('Lynx deferred native list rows', () => {
	it('declares a list of rows and builds one only when the list shows it', async () => {
		dom = new JSDOM('<!doctype html><html><body></body></html>');
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.switchToMainThread();
		const commits: Commands[] = [];
		const context = (
			globalThis as unknown as { lynx: { getJSContext(): LynxContextProxy } }
		).lynx.getJSContext();
		main = installLynxMainThread({ context: recordingContext(context, commits) });
		environment.switchToBackgroundThread();

		const lifecycle: string[] = [];
		const increments = new Map<string, () => void>();
		const props = {
			items: rows(50),
			captureIncrement: (id: string, next: () => void) => void increments.set(id, next),
			log: (entry: string) => void lifecycle.push(entry),
		};
		root = createLynxRoot();
		await root.render(fixture, props);
		await root.flushTransport();

		const mount = commits[0]!;
		const run = mount.find((command) => command.op === 'mount-template-run');
		expect(run).toBeDefined();
		expect(run).toMatchObject({ deferred: true, count: 50, before: null });
		// Nothing about the range was built: the run is the only thing that names
		// a row, and the list itself is the one host this commit created.
		expect(
			mount.filter((command) => command.op === 'create').map((command) => command.type),
		).toEqual(['list']);

		const list = dom.window.document.querySelector('#stateful-feed')!;
		expect(list.children).toHaveLength(0);
		// Deferral is a decision about hosts, not about the tree that owns them:
		// every row is a mounted component with its own state and effects whether
		// or not the list has ever shown it.
		expect(lifecycle).toHaveLength(50);
		expect(increments.size).toBe(50);

		environment.switchToMainThread();
		const sign = globalThis.elementTree.enterListItemAtIndex(list as never, 7);
		expect(list.firstElementChild?.textContent).toBe('Row 7: 0');

		environment.switchToBackgroundThread();
		await root.flushTransport();
		increments.get('7')!();
		await root.flushTransport();
		environment.switchToMainThread();
		expect(list.firstElementChild?.textContent).toBe('Row 7: 1');
		globalThis.elementTree.leaveListItem(list as never, sign);

		environment.switchToBackgroundThread();
		await root.unmount();
		root = null;
	});

	it('updates and removes a row the list never asked for', async () => {
		dom = new JSDOM('<!doctype html><html><body></body></html>');
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.switchToMainThread();
		main = installLynxMainThread();
		environment.switchToBackgroundThread();

		const lifecycle: string[] = [];
		const increments = new Map<string, () => void>();
		const captureIncrement = (id: string, next: () => void) => void increments.set(id, next);
		const log = (entry: string) => void lifecycle.push(entry);
		root = createLynxRoot();
		await root.render(fixture, { items: rows(50), captureIncrement, log });
		await root.flushTransport();

		const list = dom.window.document.querySelector('#stateful-feed')!;
		// Row 40 has never been shown, so nothing was ever built for it. Renaming
		// it is an update against a host that exists only as part of a declaration.
		await root.render(fixture, { items: rows(50, 'Renamed'), captureIncrement, log });
		await root.flushTransport();
		environment.switchToMainThread();
		const sign = globalThis.elementTree.enterListItemAtIndex(list as never, 40);
		expect(list.firstElementChild?.textContent).toBe('Renamed 40: 0');
		globalThis.elementTree.leaveListItem(list as never, sign);

		// Dropping the tail destroys 30 rows, of which only row 40 was ever built.
		environment.switchToBackgroundThread();
		await root.render(fixture, { items: rows(20, 'Renamed'), captureIncrement, log });
		await root.flushTransport();
		expect(lifecycle.filter((entry) => entry.startsWith('cleanup:'))).toHaveLength(30);
		expect(main.activeIdentity()).not.toBeNull();

		environment.switchToMainThread();
		expect(globalThis.elementTree.enterListItemAtIndex(list as never, 19)).toBeGreaterThan(0);
		expect(list.firstElementChild?.textContent).toBe('Renamed 19: 0');

		environment.switchToBackgroundThread();
		await root.unmount();
		root = null;
		expect(dom.window.document.querySelector('page')?.children).toHaveLength(0);
	});

	it('builds the rows of a list the renderer will not declare', async () => {
		dom = new JSDOM('<!doctype html><html><body></body></html>');
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.switchToMainThread();
		const commits: Commands[] = [];
		const context = (
			globalThis as unknown as { lynx: { getJSContext(): LynxContextProxy } }
		).lynx.getJSContext();
		main = installLynxMainThread({ context: recordingContext(context, commits) });
		environment.switchToBackgroundThread();

		// A worklet is bound on the main thread from what the commit carried, and a
		// declared host is in none of the walks that do that binding — so a row
		// carrying one has to be built. The host driver refuses such a run rather
		// than degrading it, which is why the renderer answers before one is sent.
		root = createLynxRoot();
		await root.render(workletFixture, {
			items: rows(4),
			tap: registerMainThreadWorklet('background-deferred-list:tap', undefined, () => {}),
		});
		await root.flushTransport();

		const mount = commits[0]!;
		expect(mount.some((command) => command.op === 'mount-template-run')).toBe(false);
		expect(
			mount.filter((command) => command.op === 'create').map((command) => command.type),
		).toEqual([
			'list',
			'list-item',
			'text',
			'#text',
			'list-item',
			'text',
			'#text',
			'list-item',
			'text',
			'#text',
			'list-item',
			'text',
			'#text',
		]);

		const list = dom.window.document.querySelector('#worklet-feed')!;
		environment.switchToMainThread();
		expect(globalThis.elementTree.enterListItemAtIndex(list as never, 2)).toBeGreaterThan(0);
		expect(list.firstElementChild?.textContent).toBe('Row 2');

		environment.switchToBackgroundThread();
		await root.unmount();
		root = null;
	});

	it('keeps row order when a list declares some rows and builds others', async () => {
		dom = new JSDOM('<!doctype html><html><body></body></html>');
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.switchToMainThread();
		const commits: Commands[] = [];
		const context = (
			globalThis as unknown as { lynx: { getJSContext(): LynxContextProxy } }
		).lynx.getJSContext();
		main = installLynxMainThread({ context: recordingContext(context, commits) });
		environment.switchToBackgroundThread();

		// One keyed range, two row programs: the renderer declares the plain rows
		// and refuses the one binding a worklet. A list holding both is the case
		// where a declaration has to be placed among built siblings rather than
		// instead of them.
		root = createLynxRoot();
		await root.render(mixedFixture, {
			items: [
				{ id: '0', label: 'Row 0', tappable: false },
				{ id: '1', label: 'Row 1', tappable: true },
				{ id: '2', label: 'Row 2', tappable: false },
			],
			tap: registerMainThreadWorklet('background-deferred-list:mixed-tap', undefined, () => {}),
		});
		await root.flushTransport();

		const mount = commits[0]!;
		// A run coalesces with the placement beside it, so the built row between
		// the two declared ones leaves two runs rather than one.
		expect(
			mount
				.filter((command) => command.op === 'mount-template-run')
				.map((command) => ({ deferred: command.deferred, count: command.count })),
		).toEqual([
			{ deferred: true, count: 1 },
			{ deferred: true, count: 1 },
		]);
		expect(
			mount.filter((command) => command.op === 'create').map((command) => command.type),
		).toEqual(['list', 'list-item', 'text', '#text']);

		const list = dom.window.document.querySelector('#mixed-feed')!;
		environment.switchToMainThread();
		// Each row paints its own label at its own index, declared or built.
		for (const index of [0, 1, 2]) {
			const sign = globalThis.elementTree.enterListItemAtIndex(list as never, index);
			expect(sign).toBeGreaterThan(0);
			expect(Array.from(list.children).some((cell) => cell.textContent === `Row ${index}`)).toBe(
				true,
			);
			globalThis.elementTree.leaveListItem(list as never, sign);
		}
		expect(main.activeIdentity()).not.toBeNull();

		environment.switchToBackgroundThread();
		await root.unmount();
		root = null;
	});
});
