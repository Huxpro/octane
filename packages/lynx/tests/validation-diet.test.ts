import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import type { UniversalComponent } from 'octane/universal/native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	LYNX_BACKGROUND_TO_MAIN_EVENT,
	LYNX_MAIN_TO_BACKGROUND_EVENT,
	type LynxCommitWireMessage,
	type LynxContextProxy,
} from '../src/core/protocol.js';

// The production build keeps envelope validation and every load-bearing check,
// but compiles the deep structural walks and the whole-tree prepare check pass
// out. These scenes run the real dual-thread pipeline with
// `NODE_ENV=production` modules — the configuration no other suite exercises —
// and pin the two halves of that contract: real workloads behave exactly as in
// development, and a corrupt commit still faults loudly instead of applying.

type LynxIndexModule = typeof import('../src/index.js');
type LynxMainThreadModule = typeof import('../src/main-thread.js');
type BackgroundFixtures = typeof import('./_fixtures/background-root.lynx.tsrx');
type ListFixtures = typeof import('./_fixtures/native-list.lynx.tsrx');

interface ProductionRig {
	readonly dom: JSDOM;
	readonly main: ReturnType<LynxMainThreadModule['installLynxMainThread']>;
	readonly api: LynxIndexModule;
	readonly fixtures: BackgroundFixtures;
	readonly listFixtures: ListFixtures;
	readonly commits: LynxCommitWireMessage[];
	readonly rejects: { version: number; error: { name: string; message: string } }[];
	readonly context: LynxContextProxy;
}

type LynxRoot = ReturnType<LynxIndexModule['createLynxRoot']>;

let rig: ProductionRig | null = null;
let root: LynxRoot | null = null;

async function installProductionRig(): Promise<ProductionRig> {
	vi.stubEnv('NODE_ENV', 'production');
	// The dev/prod split folds at module scope, so the production module graph
	// must be instantiated fresh; every runtime import below stays inside it.
	vi.resetModules();
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	const environment = globalThis.lynxTestingEnv;
	environment.switchToMainThread();
	const mainThreadApi: LynxMainThreadModule = await import('../src/main-thread.js');
	const main = mainThreadApi.installLynxMainThread();
	environment.switchToBackgroundThread();
	const api: LynxIndexModule = await import('../src/index.js');
	const fixtures: BackgroundFixtures = await import('./_fixtures/background-root.lynx.tsrx');
	const listFixtures: ListFixtures = await import('./_fixtures/native-list.lynx.tsrx');
	const context = (
		globalThis as typeof globalThis & { lynx: { getCoreContext(): LynxContextProxy } }
	).lynx.getCoreContext();
	const commits: LynxCommitWireMessage[] = [];
	const rejects: ProductionRig['rejects'] = [];
	context.addEventListener(LYNX_BACKGROUND_TO_MAIN_EVENT, (event) => {
		const message = event.data as { type?: unknown };
		if (message?.type === 'commit') commits.push(event.data as LynxCommitWireMessage);
	});
	context.addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
		const message = event.data as { type?: unknown; version?: number; error?: unknown };
		if (message?.type === 'reject') {
			rejects.push(event.data as ProductionRig['rejects'][number]);
		}
	});
	return (rig = { dom, main, api, fixtures, listFixtures, commits, rejects, context });
}

afterEach(async () => {
	if (rig !== null) globalThis.lynxTestingEnv.switchToBackgroundThread();
	if (root !== null) {
		try {
			await root.unmount();
		} catch {
			// An injected-corruption scene can leave the root already faulted.
		}
	}
	root = null;
	if (rig !== null) {
		globalThis.lynxTestingEnv.switchToMainThread();
		rig.main.close();
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
		rig.dom.window.close();
	}
	rig = null;
	vi.unstubAllEnvs();
	vi.resetModules();
});

interface SmokeProps {
	readonly label: string;
	readonly showDetails: boolean;
	readonly fail: boolean;
	readonly items: readonly { id: string; value: number }[];
	readonly log: (entry: string) => void;
	readonly captureActions: (actions: { increment(): void }) => void;
	readonly captureRow: (id: string, handle: unknown) => void;
	readonly counterRef: (handle: unknown) => void;
}

async function mountSmokeScene(): Promise<{
	actions: { increment(): void };
	render(props: Partial<SmokeProps>): Promise<void>;
}> {
	const { api, fixtures } = rig!;
	const Scene = fixtures.BackgroundRootFixture as UniversalComponent<SmokeProps>;
	let actions: { increment(): void } | null = null;
	const base: SmokeProps = {
		label: 'prod',
		showDetails: false,
		fail: false,
		items: [{ id: 'first', value: 1 }],
		log: () => {},
		captureActions: (next) => {
			actions = next;
		},
		captureRow: () => {},
		counterRef: () => {},
	};
	root = api.createLynxRoot();
	const render = async (props: Partial<SmokeProps>): Promise<void> => {
		globalThis.lynxTestingEnv.switchToBackgroundThread();
		await root!.render(Scene, { ...base, ...props });
		await root!.flushTransport();
	};
	await render({});
	if (actions === null) throw new Error('Expected the fixture to publish its actions.');
	return { actions, render };
}

function corruptIdentityFrom(rigState: ProductionRig): {
	protocol: unknown;
	renderer: unknown;
	root: number;
	version: number;
} {
	const last = rigState.commits.at(-1);
	if (last === undefined) throw new Error('Expected at least one real commit to derive identity.');
	return {
		protocol: last.protocol,
		renderer: last.renderer,
		root: last.root,
		version: last.version + 7,
	};
}

describe.sequential('@octanejs/lynx production validation diet', () => {
	it('renders, updates, replaces, and unmounts a real scene with production modules', async () => {
		await installProductionRig();
		const { actions, render } = await mountSmokeScene();
		const document = rig!.dom.window.document;

		globalThis.lynxTestingEnv.switchToMainThread();
		expect(document.querySelector('#counter')?.textContent).toBe('Count: 0');
		expect(document.querySelector('#summary')).not.toBeNull();
		expect(document.querySelector('#details')).toBeNull();
		expect(document.querySelector('#row-first')?.textContent).toBe('prod:1');

		globalThis.lynxTestingEnv.switchToBackgroundThread();
		actions.increment();
		await root!.flushTransport();
		globalThis.lynxTestingEnv.switchToMainThread();
		expect(document.querySelector('#counter')?.textContent).toBe('Count: 1');

		// Replacing the summary branch exercises remove + destroy staging, whose
		// surviving-parent bookkeeping must stay intact without the dev checks.
		await render({ showDetails: true, items: [{ id: 'second', value: 2 }] });
		globalThis.lynxTestingEnv.switchToMainThread();
		expect(document.querySelector('#details')).not.toBeNull();
		expect(document.querySelector('#summary')).toBeNull();
		expect(document.querySelector('#row-first')).toBeNull();
		expect(document.querySelector('#row-second')?.textContent).toBe('prod:2');

		globalThis.lynxTestingEnv.switchToBackgroundThread();
		await root!.unmount();
		root = null;
		globalThis.lynxTestingEnv.switchToMainThread();
		expect(document.querySelector('#counter')).toBeNull();
		expect(rig!.rejects).toEqual([]);
	});

	it('plans native-list creation and membership updates with production modules', async () => {
		await installProductionRig();
		const { api, listFixtures } = rig!;
		const Scene = listFixtures.NativeListFixture as UniversalComponent<{
			readonly items: readonly { id: string; label: string }[];
			readonly captureRef: (id: string, handle: unknown) => void;
			readonly onTap: (id: string) => void;
		}>;
		root = api.createLynxRoot();
		const render = async (items: readonly { id: string; label: string }[]): Promise<void> => {
			globalThis.lynxTestingEnv.switchToBackgroundThread();
			await root!.render(Scene, { items, captureRef: () => {}, onTap: () => {} });
			await root!.flushTransport();
		};
		// The mount creates and populates the <list> in one batch; native list
		// state snapshots its initial items at creation, and the follow-up
		// membership update below needs the production list collection (the dev
		// whole-tree pass that used to gather live lists is compiled out).
		await render([
			{ id: 'one', label: 'One' },
			{ id: 'two', label: 'Two' },
		]);
		const document = rig!.dom.window.document;
		globalThis.lynxTestingEnv.switchToMainThread();
		const list = document.querySelector('#native-feed');
		expect(list).not.toBeNull();
		const sign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
		expect(list!.firstElementChild?.textContent).toBe('One');

		// The membership change touches an accepted list, which production
		// collects from the accepted records exactly as development does: without
		// that collection no update-list-info reaches the engine and the new item
		// never becomes enterable.
		await render([
			{ id: 'one', label: 'One!' },
			{ id: 'two', label: 'Two' },
			{ id: 'three', label: 'Three' },
		]);
		globalThis.lynxTestingEnv.switchToMainThread();
		expect(list!.firstElementChild?.textContent).toBe('One!');
		globalThis.elementTree.leaveListItem(list as never, sign);
		expect(globalThis.elementTree.enterListItemAtIndex(list as never, 2)).toBe(sign);
		expect(list!.firstElementChild?.textContent).toBe('Three');
		expect(rig!.rejects).toEqual([]);
	});

	it('faults loudly on a structurally corrupt command instead of applying it', async () => {
		await installProductionRig();
		await mountSmokeScene();
		const document = rig!.dom.window.document;
		const identity = corruptIdentityFrom(rig!);

		globalThis.lynxTestingEnv.switchToMainThread();
		// Development rejects this shape at the protocol boundary; production has
		// compiled that walk out, so the staging guards and the prepare fault path
		// must reject it — the invariant is a loud reject, never a quiet apply.
		// The command is minimally corrupt (fresh id, real type, null props), so
		// the unconditional cloneProps ownership check is the only guard left
		// between it and a silent apply.
		rig!.context.dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				...identity,
				type: 'commit',
				batch: {
					renderer: identity.renderer,
					version: identity.version,
					commands: [{ op: 'create', id: 424242, type: 'view', props: null }],
				},
			},
		});
		expect(rig!.rejects).toHaveLength(1);
		expect(rig!.rejects[0]!.version).toBe(identity.version);
		expect(rig!.rejects[0]!.error.message).not.toBe('');
		expect(document.querySelector('#counter')?.textContent).toBe('Count: 0');
	});

	it('still rejects a duplicate host id: load-bearing checks survive the diet', async () => {
		await installProductionRig();
		await mountSmokeScene();
		const document = rig!.dom.window.document;
		const identity = corruptIdentityFrom(rig!);
		const mounted = rig!.commits[0]!.batch.commands.find((command) => command.op === 'create');
		if (mounted?.op !== 'create') throw new Error('Expected a create command in the mount commit.');

		globalThis.lynxTestingEnv.switchToMainThread();
		rig!.context.dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				...identity,
				type: 'commit',
				batch: {
					renderer: identity.renderer,
					version: identity.version,
					commands: [{ op: 'create', id: mounted.id, type: mounted.type, props: {} }],
				},
			},
		});
		expect(rig!.rejects).toHaveLength(1);
		expect(rig!.rejects[0]!.error.message).toContain('duplicate host id');
		expect(document.querySelector('#counter')?.textContent).toBe('Count: 0');
	});

	it('still rejects a malformed commit envelope at the boundary', async () => {
		await installProductionRig();
		await mountSmokeScene();
		const document = rig!.dom.window.document;
		const identity = corruptIdentityFrom(rig!);

		globalThis.lynxTestingEnv.switchToMainThread();
		rig!.context.dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				...identity,
				type: 'commit',
				batch: { renderer: identity.renderer, version: identity.version },
			},
		});
		expect(rig!.rejects).toHaveLength(1);
		expect(rig!.rejects[0]!.version).toBe(identity.version);
		expect(document.querySelector('#counter')?.textContent).toBe('Count: 0');
	});
});
