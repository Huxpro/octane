import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import type {
	UniversalHostBatch,
	UniversalHostDriver,
	UniversalKey,
	UniversalRenderable,
} from 'octane/universal/native';
import {
	createUniversalRoot,
	defineUniversalComponent as defineBackgroundUniversalComponent,
	use as useBackground,
	useId as useBackgroundId,
	type UniversalComponent,
	type UniversalHostCommitContext,
} from 'octane/universal/native';
import { describe, expect, it, vi } from 'vitest';
import { createLynxNativeResource } from '../src/first-screen.js';
import {
	captureLynxFirstTree,
	createLynxHostContainer,
	disposeLynxFirstTree,
	disposeLynxHostContainer,
	prepareLynxHostBatch,
} from '../src/core/host-driver.js';
import { createLynxElementPAPI } from '../src/core/papi.js';
import { createLynxMainThreadWorkletRegistry } from '../src/core/worklets.js';
import {
	createContext,
	createPortal,
	defineUniversalComponent,
	firstScreenEvent,
	hmrUniversalComponent,
	lazy,
	renderLynxFirstScreen,
	UNIVERSAL_HMR,
	universalComponent,
	universalContext,
	universalActivity,
	universalFor,
	universalIf,
	universalPlan,
	universalProps,
	universalSwitch,
	universalTry,
	universalValue,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	use,
	useBatch,
	warmChild,
} from '../src/main-renderer.js';

interface CapturedContainer {
	batch: UniversalHostBatch | null;
}

function captureBackgroundBatch<Props>(
	component: UniversalComponent<Props>,
	props: Props,
): UniversalHostBatch {
	const container: CapturedContainer = { batch: null };
	const driver: UniversalHostDriver<CapturedContainer> = {
		id: 'lynx',
		capabilities: { text: 'host', visibility: true },
		events: {
			classify(name) {
				const match = /^(?:capture-bind|capture-catch|global-bind|bind|catch)([A-Za-z]+)$/.exec(
					name,
				);
				if (match === null) return null;
				return {
					type: name,
					priority: match[1] === 'tap' ? 'discrete' : 'default',
				};
			},
		},
		prepareBatch(
			target: CapturedContainer,
			batch: UniversalHostBatch,
			_context: UniversalHostCommitContext,
		) {
			return {
				apply() {
					target.batch = batch;
				},
				abort() {},
			};
		},
		getPublicInstance() {
			return null;
		},
	};
	createUniversalRoot(container, driver, { scheduleMicrotask: (callback) => callback() }).render(
		component,
		props,
	);
	if (container.batch === null) throw new Error('Background root did not commit.');
	return container.batch;
}

function normalizeRootScopedUseId(batch: UniversalHostBatch, id: string): unknown {
	return {
		...batch,
		commands: batch.commands.map((command) =>
			command.op === 'create' && command.props.id === id
				? { ...command, props: { ...command.props, id: '<committed-use-id>' } }
				: command,
		),
	};
}

function normalizeFirstTreeSnapshot(
	snapshot: NonNullable<ReturnType<typeof captureLynxFirstTree>>['snapshot'],
): unknown {
	let listenerBase = Number.POSITIVE_INFINITY;
	for (const node of snapshot.nodes) {
		for (const event of node.events) listenerBase = Math.min(listenerBase, event.listener);
	}
	if (!Number.isFinite(listenerBase)) listenerBase = 0;
	return {
		...snapshot,
		nodes: snapshot.nodes.map(({ nativeId: _nativeId, ...node }) => ({
			...node,
			events: node.events.map((event) => ({
				...event,
				listener: event.listener - listenerBase,
			})),
		})),
	};
}

function applyAndCaptureFirstTree(batch: UniversalHostBatch): {
	readonly html: string;
	readonly snapshot: unknown | null;
} {
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	globalThis.lynxTestingEnv.switchToMainThread();
	const worklets = createLynxMainThreadWorkletRegistry();
	const container = createLynxHostContainer(createLynxElementPAPI(globalThis), {
		root: 77,
		worklets,
	});
	try {
		const prepared = prepareLynxHostBatch(container, batch);
		prepared.apply();
		const firstTree = captureLynxFirstTree(container);
		const result = {
			html: (container.page as unknown as Element).outerHTML,
			snapshot: firstTree === null ? null : normalizeFirstTreeSnapshot(firstTree.snapshot),
		};
		if (firstTree !== null) {
			expect(disposeLynxFirstTree(firstTree)).toMatchObject({ complete: true });
		}
		return result;
	} finally {
		if (!container.disposed) disposeLynxHostContainer(container);
		worklets.close();
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
		dom.window.close();
	}
}

const leafPlan = universalPlan('lynx', {
	kind: 'host',
	type: 'text',
	propsSlot: 0,
	children: [{ kind: 'text', slot: 1 }],
});

const rowPlan = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	propsSlot: 0,
});

const scopedRowsPlan = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	propsSlot: 0,
	children: [{ kind: 'slot', slot: 1 }],
});

const scopedRowPlan = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'col-id' },
			children: [{ kind: 'slot', slot: 1 }],
		},
		{
			kind: 'host',
			type: 'text',
			props: { class: 'col-label' },
			bindings: [['bindtap', 2]],
			children: [{ kind: 'slot', slot: 3 }],
		},
		{
			kind: 'host',
			type: 'text',
			props: { class: 'col-remove' },
			bindings: [['bindtap', 2]],
			children: [{ kind: 'slot', slot: 4 }],
		},
	],
});

const ScopedRow = defineUniversalComponent(
	'lynx',
	(props: { id: string; label: string; onTap: () => void }) =>
		universalValue(scopedRowPlan, [props.id, `id:${props.id}`, props.onTap, props.label, 'x']),
);

function componentScopeFor<T>(
	items: Iterable<T>,
	key: (item: T, index: number) => UniversalKey,
	render: (item: T, index: number) => UniversalRenderable,
): UniversalRenderable {
	return universalFor(
		items,
		key,
		render,
		null,
		false,
		false,
		undefined,
		undefined,
		undefined,
		true,
	);
}

const ScopedRows = defineUniversalComponent(
	'lynx',
	(props: { items: readonly string[]; onTap: () => void }) =>
		universalValue(scopedRowsPlan, [
			universalProps([
				['set', 'id', 'rows'],
				['set', 'bindtap', props.onTap],
			]),
			componentScopeFor(
				props.items,
				(item) => item,
				(item) =>
					universalComponent(
						'lynx',
						ScopedRow,
						universalProps([
							['set', 'id', item],
							['set', 'label', `label:${item}`],
							['set', 'onTap', props.onTap],
						]),
					),
			),
		]),
);

const MixedScopedRows = defineUniversalComponent(
	'lynx',
	(props: { items: readonly string[]; onTap: () => void }) =>
		universalValue(scopedRowsPlan, [
			universalProps([['set', 'id', 'mixed-rows']]),
			[
				universalValue(rowPlan, [universalProps([['set', 'id', 'before']])]),
				componentScopeFor(
					props.items,
					(item) => item,
					(item) =>
						universalComponent(
							'lynx',
							ScopedRow,
							universalProps([
								['set', 'id', item],
								['set', 'label', `label:${item}`],
								['set', 'onTap', props.onTap],
							]),
						),
				),
				universalValue(rowPlan, [universalProps([['set', 'id', 'after']])]),
			],
		]),
);

const VariantRow = defineUniversalComponent('lynx', (props: { id: string; text: boolean }) =>
	props.text
		? universalValue(leafPlan, [universalProps([['set', 'id', props.id]]), `text:${props.id}`])
		: universalValue(rowPlan, [universalProps([['set', 'id', props.id]])]),
);

const VariantRows = defineUniversalComponent(
	'lynx',
	(props: { items: readonly string[]; onTap: () => void }) =>
		universalValue(scopedRowsPlan, [
			universalProps([
				['set', 'id', 'variant-rows'],
				['set', 'bindtap', props.onTap],
			]),
			componentScopeFor(
				props.items,
				(item) => item,
				(item, index) =>
					universalComponent(
						'lynx',
						VariantRow,
						universalProps([
							['set', 'id', item],
							['set', 'text', index % 2 === 1],
						]),
					),
			),
		]),
);

const Child = defineUniversalComponent('lynx', (props: { readonly value: string }) =>
	universalValue(leafPlan, [universalProps([['set', 'id', 'label']]), props.value]),
);

const Scene = defineUniversalComponent(
	'lynx',
	(props: {
		readonly handler: () => void;
		readonly items: readonly string[];
		readonly title: string;
	}) => [
		universalComponent('lynx', Child, universalProps([['set', 'value', props.title]])),
		universalFor(
			props.items,
			(item) => item,
			(item) =>
				universalValue(rowPlan, [
					universalProps([
						['set', 'id', item],
						['set', 'bindtap', props.handler],
					]),
				]),
		),
	],
);

describe('Lynx main-thread first-screen renderer', () => {
	it('keeps the first-screen wrapper stable while accepting a replacement implementation', () => {
		const First = defineUniversalComponent('lynx', () =>
			universalValue(rowPlan, [universalProps([['set', 'version', 'first']])]),
		);
		const Second = defineUniversalComponent('lynx', () =>
			universalValue(rowPlan, [universalProps([['set', 'version', 'second']])]),
		);
		const firstWarm = () => undefined;
		const secondWarm = () => undefined;
		(First as any).__warm = firstWarm;
		(Second as any).__warm = secondWarm;
		const Reloadable = hmrUniversalComponent('lynx', First);
		const identity = Reloadable;
		expect((Reloadable as any).__warm).toBe(firstWarm);

		(Reloadable as any)[UNIVERSAL_HMR].update(hmrUniversalComponent('lynx', Second));

		expect(Reloadable).toBe(identity);
		expect((Reloadable as any).__warm).toBe(secondWarm);
		expect(renderLynxFirstScreen(Reloadable, {}).batch.commands[0]).toMatchObject({
			op: 'create',
			props: { version: 'second' },
		});
	});

	it('commits an authored pending arm while a lazy chunk loads and reuses the cached module', async () => {
		const Loaded = defineUniversalComponent('lynx', (props: { label: string }) =>
			universalValue(rowPlan, [
				universalProps([
					['set', 'state', 'loaded'],
					['set', 'label', props.label],
				]),
			]),
		);
		let resolve!: (module: { default: typeof Loaded }) => void;
		const module = new Promise<{ default: typeof Loaded }>((done) => {
			resolve = done;
		});
		let loads = 0;
		const Lazy = lazy(() => {
			loads++;
			return module;
		});
		const Boundary = defineUniversalComponent('lynx', () =>
			universalTry(
				() => universalComponent('lynx', Lazy, { label: 'native chunk' }),
				() => universalValue(rowPlan, [universalProps([['set', 'state', 'pending']])]),
			),
		);

		expect(renderLynxFirstScreen(Boundary, {}).batch.commands[0]).toMatchObject({
			op: 'create',
			props: { state: 'pending' },
		});
		expect(loads).toBe(1);

		resolve({ default: Loaded });
		await module;
		expect(renderLynxFirstScreen(Boundary, {}).batch.commands[0]).toMatchObject({
			op: 'create',
			props: { label: 'native chunk', state: 'loaded' },
		});
		expect(loads).toBe(1);
	});

	it('caches a rejected lazy chunk and routes the error through the authored catch arm', async () => {
		let reject!: (error: Error) => void;
		const module = new Promise<never>((_resolve, fail) => {
			reject = fail;
		});
		let loads = 0;
		const Lazy = lazy(() => {
			loads++;
			return module;
		});
		const Boundary = defineUniversalComponent('lynx', () =>
			universalTry(
				() => universalComponent('lynx', Lazy),
				() => universalValue(rowPlan, [universalProps([['set', 'state', 'pending']])]),
				(error) =>
					universalValue(rowPlan, [
						universalProps([
							['set', 'state', 'caught'],
							['set', 'message', (error as Error).message],
						]),
					]),
			),
		);

		expect(renderLynxFirstScreen(Boundary, {}).batch.commands[0]).toMatchObject({
			op: 'create',
			props: { state: 'pending' },
		});
		reject(new Error('native chunk failed'));
		await module.catch(() => undefined);

		expect(renderLynxFirstScreen(Boundary, {}).batch.commands[0]).toMatchObject({
			op: 'create',
			props: { message: 'native chunk failed', state: 'caught' },
		});
		expect(loads).toBe(1);
	});

	it('rejects a lazy module compiled for another renderer', () => {
		const Foreign = defineBackgroundUniversalComponent('object', () => null);
		const Lazy = lazy(
			() =>
				({
					then(resolve: (module: { default: typeof Foreign }) => void) {
						resolve({ default: Foreign });
					},
				}) as PromiseLike<{ default: any }>,
		);
		const Boundary = defineUniversalComponent('lynx', () =>
			universalTry(
				() => universalComponent('lynx', Lazy),
				null,
				(error) =>
					universalValue(rowPlan, [universalProps([['set', 'message', (error as Error).message]])]),
			),
		);

		expect(renderLynxFirstScreen(Boundary, {}).batch.commands[0]).toMatchObject({
			op: 'create',
			props: { message: 'Universal lazy for renderer "lynx" cannot render component "object".' },
		});
	});

	it('starts independent lazy chunks before committing their shared pending arm', () => {
		const calls: string[] = [];
		const pending = () => new Promise<never>(() => {});
		const Left = lazy(() => {
			calls.push('left');
			return pending();
		});
		const Right = lazy(() => {
			calls.push('right');
			return pending();
		});
		const Boundary = defineUniversalComponent('lynx', () => {
			useBatch([], () => {
				warmChild(Left, {});
				warmChild(Right, {});
			});
			return universalTry(
				() => [universalComponent('lynx', Left), universalComponent('lynx', Right)],
				() => universalValue(rowPlan, [universalProps([['set', 'state', 'pending']])]),
			);
		});

		expect(renderLynxFirstScreen(Boundary, {}).batch.commands[0]).toMatchObject({
			op: 'create',
			props: { state: 'pending' },
		});
		expect(calls).toHaveLength(2);
		expect(new Set(calls)).toEqual(new Set(['left', 'right']));
	});

	it('passes compiler warm-plan props through nested lazy children', () => {
		const calls: string[] = [];
		const pending = () => new Promise<never>(() => {});
		const Left = lazy(() => {
			calls.push('left');
			return pending();
		});
		const Right = lazy(() => {
			calls.push('right');
			return pending();
		});
		const Branch = defineUniversalComponent(
			'lynx',
			(props: { child: UniversalComponent<any>; childProps: Record<string, unknown> }) =>
				universalComponent('lynx', props.child, props.childProps),
		);
		(Branch as any).__warm = (props: {
			child: UniversalComponent<any>;
			childProps: Record<string, unknown>;
		}) => warmChild(props.child, props.childProps);
		const branchProps = { child: Right, childProps: { label: 'right' } };
		const Boundary = defineUniversalComponent('lynx', () => {
			useBatch([], () => warmChild(Branch, branchProps));
			return universalTry(
				() => [universalComponent('lynx', Left), universalComponent('lynx', Branch, branchProps)],
				() => universalValue(rowPlan, [universalProps([['set', 'state', 'pending']])]),
			);
		});

		expect(renderLynxFirstScreen(Boundary, {}).batch.commands[0]).toMatchObject({
			op: 'create',
			props: { state: 'pending' },
		});
		expect(calls).toEqual(['left', 'right']);
	});

	it('diagnoses pending lazy content that has no authored first-screen boundary', () => {
		const Lazy = lazy(() => new Promise<never>(() => {}));
		const Unbounded = defineUniversalComponent('lynx', () => universalComponent('lynx', Lazy));

		expect(() => renderLynxFirstScreen(Unbounded, {})).toThrow(
			/suspended without an authored @pending boundary.*cannot wait for lazy chunks/,
		);
	});

	it('emits the same initial host IDs, topology, props, and listener metadata as background', () => {
		const props = {
			handler: () => {},
			items: ['a', 'b'],
			title: 'Hello',
		};
		const main = renderLynxFirstScreen(Scene, props);
		const background = captureBackgroundBatch(Scene, props);

		expect(main.batch).toEqual(background);
		expect(main.hostCount).toBe(4);
		expect(main.logicalCount).toBeGreaterThan(main.hostCount);
		expect(main.batch.commands.some((command) => 'props' in command && command.props.bindtap)).toBe(
			false,
		);
	});

	// Issue #81: the background gates first-screen event emission on the host's
	// resolved visibility, so a handler inside a hidden `<Activity>` announces
	// no listener until the subtree is shown. The main renderer walked every
	// host with no gate, so the two batches disagreed by exactly one `event`
	// command — and a first screen whose event bindings do not match can never
	// be adopted: it repaints from scratch on every launch and drops the taps
	// buffered in between. A hidden tab, a collapsed drawer, and a pre-rendered
	// off-screen route are all this shape.
	const shellPlan = universalPlan('lynx', {
		kind: 'host',
		type: 'view',
		children: [{ kind: 'slot', slot: 0 }],
	});
	const handlerInActivity = (mode: 'visible' | 'hidden') =>
		defineUniversalComponent('lynx', (props: { readonly handler: () => void }) =>
			universalValue(shellPlan, [
				universalActivity(mode, () =>
					universalValue(rowPlan, [universalProps([['set', 'bindtap', props.handler]])]),
				),
			]),
		);

	it('emits no listener for a handler hidden by an Activity, as background does', () => {
		const HiddenHandler = handlerInActivity('hidden');
		const props = { handler: () => {} };
		const main = renderLynxFirstScreen(HiddenHandler, props);

		expect(main.batch).toEqual(captureBackgroundBatch(HiddenHandler, props));
		expect(main.batch.commands.filter((command) => command.op === 'event')).toEqual([]);
		// The fixture really does hide a host, so the assertion above is not
		// vacuously true of a tree with nothing to gate.
		expect(main.batch.commands.filter((command) => command.op === 'visibility')).not.toEqual([]);
	});

	it('still emits the listener once the same handler is visible', () => {
		const VisibleHandler = handlerInActivity('visible');
		const props = { handler: () => {} };
		const main = renderLynxFirstScreen(VisibleHandler, props);

		// Deliberately not compared against the background batch. The background
		// seeds listener IDs from a per-process root counter
		// (`NEXT_EVENT_ROOT++ * 1_000_000`) while the first-screen renderer always
		// starts at 1_000_000, so the two agree only for the first root built in
		// a process — which is production's arrangement but not a suite's. What
		// this case has to show is that the visibility gate is not over-broad:
		// the same handler, shown, still announces exactly one listener.
		expect(main.batch.commands.filter((command) => command.op === 'event')).toEqual([
			{
				op: 'event',
				id: 3,
				type: 'bindtap',
				listener: { id: 1_000_000, priority: 'discrete' },
			},
		]);
		expect(main.batch.commands.filter((command) => command.op === 'visibility')).toEqual([]);
	});

	it('preserves background host records and physical order when component scopes use templates', () => {
		for (const [component, props] of [
			[ScopedRows, { items: ['a', 'b'], onTap: () => {} }],
			[MixedScopedRows, { items: ['a', 'b'], onTap: () => {} }],
			[VariantRows, { items: ['plain', 'text'], onTap: () => {} }],
		] as const) {
			const main = renderLynxFirstScreen(component, props);
			const background = captureBackgroundBatch(component, props);

			expect(applyAndCaptureFirstTree(main.batch)).toEqual(applyAndCaptureFirstTree(background));
		}
	});

	it.each([
		['template create', '__CreateView', 2, 'before'],
		['template create', '__CreateView', 2, 'after'],
		['template event', '__AddEvent', 2, 'before'],
		['template event', '__AddEvent', 2, 'after'],
		['template placement', '__InsertElementBefore', 1, 'before'],
		['template placement', '__InsertElementBefore', 1, 'after'],
		['commit flush', '__FlushElementTree', 1, 'before'],
		['commit flush', '__FlushElementTree', 1, 'after'],
	] as const)(
		'terminally cleans a first-screen template after %s faults %s mutation',
		(_label, method, occurrence, timing) => {
			const rendered = renderLynxFirstScreen(ScopedRows, {
				items: ['a', 'b'],
				onTap() {},
			});
			const dom = new JSDOM('<!doctype html><html><body></body></html>');
			installLynxTestingEnv(globalThis, {
				window: dom.window as unknown as Window & typeof globalThis,
			});
			globalThis.lynxTestingEnv.switchToMainThread();
			const target = globalThis as unknown as Record<string, unknown>;
			const rawCreateView = target.__CreateView as (componentId: number) => object;
			const rawAddEvent = target.__AddEvent as (
				node: object,
				kind: string,
				name: string,
				listener: unknown,
			) => void;
			const rawInsert = target.__InsertElementBefore as (
				parent: object,
				child: object,
				before?: object,
			) => void;
			const rawFlush = target.__FlushElementTree as (...args: unknown[]) => void;
			const rawSetId = target.__SetID as (node: object, id: string) => void;
			const calls = new Map<string, number>();
			const activeEvents = new Map<object, Set<string>>();
			const failure = new Error(`${method} ${timing} failure`);
			let hit = false;
			const invoke = <T>(name: string, mutation: () => T): T => {
				const count = (calls.get(name) ?? 0) + 1;
				calls.set(name, count);
				const selected = name === method && count === occurrence;
				if (selected && timing === 'before') {
					hit = true;
					throw failure;
				}
				const result = mutation();
				if (selected && timing === 'after') {
					hit = true;
					throw failure;
				}
				return result;
			};
			target.__CreateView = (componentId: number) =>
				invoke('__CreateView', () => rawCreateView.call(target, componentId));
			target.__AddEvent = (node: object, kind: string, name: string, listener: unknown) =>
				invoke('__AddEvent', () => {
					rawAddEvent.call(target, node, kind, name, listener);
					let events = activeEvents.get(node);
					if (listener == null) {
						events?.delete(`${kind}:${name}`);
					} else {
						if (events === undefined) activeEvents.set(node, (events = new Set()));
						events.add(`${kind}:${name}`);
					}
				});
			target.__InsertElementBefore = (parent: object, child: object, before?: object) =>
				invoke('__InsertElementBefore', () => rawInsert.call(target, parent, child, before));
			target.__FlushElementTree = (...args: unknown[]) =>
				invoke('__FlushElementTree', () => rawFlush.apply(target, args));

			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 78 });
			const foreign = rawCreateView.call(target, container.pageComponentUniqueId);
			rawSetId.call(target, foreign, 'foreign');
			rawInsert.call(target, container.page, foreign);
			try {
				const prepared = prepareLynxHostBatch(container, rendered.batch);
				expect(() => prepared.apply()).toThrow(failure);
				expect(hit).toBe(true);
				expect(prepared.mutationStarted).toBe(true);
				expect(container.acceptedVersion).toBe(1);
				expect(container.instanceCount).toBe(rendered.hostCount);

				const cleanup = disposeLynxHostContainer(container);
				expect(cleanup).toMatchObject({ complete: true });
				expect(container.instanceCount).toBe(0);
				expect([...activeEvents.values()].reduce((count, events) => count + events.size, 0)).toBe(
					0,
				);
				expect((container.page as unknown as Element).querySelector('#foreign')).toBe(foreign);
				expect((container.page as unknown as Element).children).toHaveLength(1);
			} finally {
				if (!container.disposed) disposeLynxHostContainer(container);
				globalThis.lynxTestingEnv.clearGlobal();
				uninstallLynxTestingEnv(globalThis);
				dom.window.close();
			}
		},
	);

	it('aborts a prepared first-screen template without entering Element PAPI', () => {
		const batch = renderLynxFirstScreen(ScopedRows, {
			items: ['a', 'b'],
			onTap() {},
		}).batch;
		const dom = new JSDOM('<!doctype html><html><body></body></html>');
		installLynxTestingEnv(globalThis, {
			window: dom.window as unknown as Window & typeof globalThis,
		});
		globalThis.lynxTestingEnv.switchToMainThread();
		const target = globalThis as unknown as Record<string, unknown>;
		const calls: string[] = [];
		for (const name of [
			'__CreateView',
			'__CreateText',
			'__CreateRawText',
			'__AddEvent',
			'__InsertElementBefore',
			'__FlushElementTree',
		] as const) {
			const original = target[name] as (...args: unknown[]) => unknown;
			target[name] = (...args: unknown[]) => {
				calls.push(name);
				return original.apply(target, args);
			};
		}
		const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 79 });
		try {
			const prepared = prepareLynxHostBatch(container, batch);
			prepared.abort();
			prepared.abort();
			prepared.apply();
			expect(prepared.mutationStarted).toBe(false);
			expect(container.acceptedVersion).toBe(0);
			expect(container.instanceCount).toBe(0);
			expect(calls).toEqual([]);
			expect((container.page as unknown as Element).children).toHaveLength(0);
			expect(disposeLynxHostContainer(container)).toMatchObject({ complete: true });
		} finally {
			if (!container.disposed) disposeLynxHostContainer(container);
			globalThis.lynxTestingEnv.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('matches background first-tree semantics for component-scope edge cases', () => {
		const listPlan = universalPlan('lynx', { kind: 'host', type: 'list', children: [] });
		const listItemPlan = universalPlan('lynx', {
			kind: 'host',
			type: 'list-item',
			props: { 'item-key': 'safe-item' },
		});
		const listParentPlan = universalPlan('lynx', {
			kind: 'host',
			type: 'list',
			children: [{ kind: 'slot', slot: 0 }],
		});
		const mainThreadPlan = universalPlan('lynx', {
			kind: 'host',
			type: 'view',
			props: { 'main-thread:ref': { _wvid: 'unsafe-direct-ref' } },
		});
		const protoBindingPlan = universalPlan('lynx', {
			kind: 'host',
			type: 'view',
			bindings: [['__proto__', 0]],
		});
		const symbolProp = Symbol('first-screen-static-prop');
		const symbolPropPlan = universalPlan('lynx', {
			kind: 'host',
			type: 'view',
			props: { [symbolProp]: 'preserved' },
		});
		const Safe = defineUniversalComponent('lynx', () =>
			universalValue(rowPlan, [universalProps([['set', 'id', 'safe']])]),
		);
		const SafeListItem = defineUniversalComponent('lynx', () => universalValue(listItemPlan, []));
		const MultiRoot = defineUniversalComponent('lynx', () => [
			universalValue(rowPlan, [universalProps([['set', 'id', 'first']])]),
			universalValue(rowPlan, [universalProps([['set', 'id', 'second']])]),
		]);
		const Hidden = defineUniversalComponent('lynx', () =>
			universalActivity('hidden', () =>
				universalValue(rowPlan, [universalProps([['set', 'id', 'hidden']])]),
			),
		);
		const NativeList = defineUniversalComponent('lynx', () => universalValue(listPlan, []));
		const MainThread = defineUniversalComponent('lynx', () => universalValue(mainThreadPlan, []));
		const ProtoBinding = defineUniversalComponent('lynx', () =>
			universalValue(protoBindingPlan, ['ignored-by-generic-props']),
		);
		const SymbolProp = defineUniversalComponent('lynx', () => universalValue(symbolPropPlan, []));
		const InnerScope = defineUniversalComponent('lynx', () =>
			universalValue(scopedRowsPlan, [
				universalProps([['set', 'id', 'nested']]),
				componentScopeFor(
					['inner'],
					(item) => item,
					() => universalComponent('lynx', Safe),
				),
			]),
		);
		const scene = (
			Item: UniversalComponent<any>,
			options: { readonly nullKey?: boolean; readonly nativeListParent?: boolean } = {},
		): UniversalComponent<Record<string, never>> =>
			defineUniversalComponent('lynx', () => {
				const loop = componentScopeFor(
					['item'],
					(item) => (options.nullKey ? (null as never) : item),
					() => universalComponent('lynx', Item),
				);
				return options.nativeListParent ? universalValue(listParentPlan, [loop]) : loop;
			});
		const DirectHost = defineUniversalComponent('lynx', () =>
			componentScopeFor(
				['item'],
				(item) => item,
				() => universalValue(rowPlan, [universalProps([['set', 'id', 'direct-host']])]),
			),
		);
		const ExplicitComponentKey = defineUniversalComponent('lynx', () =>
			componentScopeFor(
				['item'],
				(item) => item,
				() => universalComponent('lynx', Safe, null, 'authored-component-key'),
			),
		);

		for (const [label, component] of [
			['non-component body', DirectHost],
			['explicit component key', ExplicitComponentKey],
			['multiple physical roots', scene(MultiRoot)],
			['hidden host', scene(Hidden)],
			['native-list descendant', scene(NativeList)],
			['native-list ancestor', scene(SafeListItem, { nativeListParent: true })],
			['direct main-thread prop', scene(MainThread)],
			['dynamic __proto__ binding', scene(ProtoBinding)],
			['static symbol prop', scene(SymbolProp)],
			['null key', scene(Safe, { nullKey: true })],
			['nested component scope', scene(InnerScope)],
		] as const) {
			const main = renderLynxFirstScreen(component, {});
			const background = captureBackgroundBatch(component, {});
			expect(applyAndCaptureFirstTree(main.batch), label).toEqual(
				applyAndCaptureFirstTree(background),
			);
		}
	});

	it('retains first-screen portal and foreign-renderer rejection inside component scopes', () => {
		const PortalItem = defineUniversalComponent('lynx', () =>
			createPortal(universalValue(rowPlan, [universalProps([])]), {}),
		);
		const ForeignItem = defineBackgroundUniversalComponent('object', () => null);
		const scene = (Item: UniversalComponent<any>) =>
			defineUniversalComponent('lynx', () =>
				componentScopeFor(
					['item'],
					(item) => item,
					() => universalComponent('lynx', Item),
				),
			);

		expect(() => renderLynxFirstScreen(scene(PortalItem), {})).toThrow(/does not support portals/);
		expect(() => renderLynxFirstScreen(scene(ForeignItem), {})).toThrow(
			/requires a compiled Lynx component/,
		);
	});

	it('matches background range IDs for production-compiled ownerless leaf loops', () => {
		const ProductionLeafLoop = defineUniversalComponent(
			'lynx',
			(props: { readonly items: readonly string[] }) =>
				universalFor(
					props.items,
					(item) => item,
					(item) => universalValue(rowPlan, [universalProps([['set', 'id', item]])]),
					null,
					true,
					true,
				),
		);
		const props = { items: ['a', 'b'] };
		const main = renderLynxFirstScreen(ProductionLeafLoop, props);
		const background = captureBackgroundBatch(ProductionLeafLoop, props);

		// A production compile emits the two trailing `true` hints for this leaf
		// shape. Lynx does not advertise compilerLeafProps, so both runtimes must
		// preserve the per-item ranges and therefore allocate host IDs 2 and 4.
		expect(main.batch).toEqual(background);
		expect(
			main.batch.commands.filter((command) => command.op === 'create').map((command) => command.id),
		).toEqual([2, 4]);
		expect(main.logicalCount).toBe(4);
	});

	it('recognizes the compiler sentinel without retaining an authored callback', () => {
		const EventOnly = defineUniversalComponent('lynx', () =>
			universalValue(rowPlan, [universalProps([['set', 'bindtap', firstScreenEvent]])]),
		);
		const result = renderLynxFirstScreen(EventOnly, {});

		expect(result.batch.commands).toEqual([
			{ op: 'create', id: 1, type: 'view', props: {} },
			{
				op: 'event',
				id: 1,
				type: 'bindtap',
				listener: { id: 1_000_000, priority: 'discrete' },
			},
			{ op: 'insert', parent: null, id: 1, before: null },
		]);
	});

	// A prop whose name is an event channel is the renderer's to interpret, and
	// it interprets a non-callable one as "no handler". What it must not do is
	// leave the value in the props bag: the background does not put it there,
	// so a first screen that did would disagree with the background's create
	// command and lose adoption for the whole page — and the value would reach
	// the platform as a real attribute on that channel.
	it('drops an event-named prop that carries no handler, as background does', () => {
		const StringHandler = defineUniversalComponent('lynx', () =>
			universalValue(rowPlan, [universalProps([['set', 'bindtap', 'not-a-handler']])]),
		);
		const result = renderLynxFirstScreen(StringHandler, {});

		expect(result.batch.commands).toEqual([
			{ op: 'create', id: 1, type: 'view', props: {} },
			{ op: 'insert', parent: null, id: 1, before: null },
		]);
	});

	it('uses initial hook values and never publishes effects, refs, or updates', () => {
		const effect = vi.fn();
		const layout = vi.fn();
		const ref = vi.fn();
		const Hooks = defineUniversalComponent('lynx', () => {
			const [count, setCount] = useState(2);
			const localRef = useRef('private');
			useEffect(effect);
			useLayoutEffect(layout);
			setCount(9);
			return universalValue(leafPlan, [
				universalProps([
					['set', 'id', useId()],
					['set', 'ref', ref],
				]),
				`${localRef.current}:${count}`,
			]);
		});

		const result = renderLynxFirstScreen(Hooks, {});
		expect(result.batch.commands).toContainEqual({
			op: 'create',
			id: 1,
			type: 'text',
			props: { id: ':octane-u4:' },
		});
		expect(result.batch.commands).toContainEqual({
			op: 'create',
			id: 2,
			type: '#text',
			props: { value: 'private:2' },
		});
		expect(effect).not.toHaveBeenCalled();
		expect(layout).not.toHaveBeenCalled();
		expect(ref).not.toHaveBeenCalled();
	});

	it('reclaims useId allocations from discarded try arms before committing a fallback', () => {
		const never = new Promise<never>(() => {});
		for (const discard of ['error', 'suspend'] as const) {
			let discardedMainId = '';
			const MainBoundary = defineUniversalComponent('lynx', () =>
				universalTry(
					() => {
						discardedMainId = useId();
						if (discard === 'error') throw new Error('discard main try arm');
						use(never);
					},
					() => universalValue(rowPlan, [universalProps([['set', 'id', useId()]])]),
					() => universalValue(rowPlan, [universalProps([['set', 'id', useId()]])]),
				),
			);
			let discardedBackgroundId = '';
			const BackgroundBoundary = defineUniversalComponent('lynx', () =>
				universalTry(
					() => {
						discardedBackgroundId = useBackgroundId('discarded-arm-id');
						if (discard === 'error') throw new Error('discard background try arm');
						useBackground(never);
					},
					() =>
						universalValue(rowPlan, [
							universalProps([['set', 'id', useBackgroundId('committed-pending-id')]]),
						]),
					() =>
						universalValue(rowPlan, [
							universalProps([['set', 'id', useBackgroundId('committed-catch-id')]]),
						]),
				),
			);

			const main = renderLynxFirstScreen(MainBoundary, {}).batch;
			const background = captureBackgroundBatch(BackgroundBoundary, {});
			const mainCreate = main.commands.find((command) => command.op === 'create');
			const backgroundCreate = background.commands.find((command) => command.op === 'create');
			if (mainCreate?.op !== 'create' || backgroundCreate?.op !== 'create') {
				throw new Error('Expected both try fallbacks to create a host.');
			}
			expect(mainCreate.props.id).toBe(discardedMainId);
			expect(backgroundCreate.props.id).toBe(discardedBackgroundId);
			expect(normalizeRootScopedUseId(main, discardedMainId)).toEqual(
				normalizeRootScopedUseId(background, discardedBackgroundId),
			);
		}
	});

	it('rejects background-scoped native resource props before emitting a first-screen batch', () => {
		const NativeResourceItem = defineUniversalComponent('lynx', () =>
			universalValue(rowPlan, [
				universalProps([['set', 'texture', createLynxNativeResource('hero')]]),
			]),
		);
		const NativeResource = defineUniversalComponent('lynx', () =>
			componentScopeFor(
				['item'],
				(item) => item,
				() => universalComponent('lynx', NativeResourceItem),
			),
		);

		expect(() => renderLynxFirstScreen(NativeResource, {})).toThrow(
			/native resource prop "texture".*background-only/,
		);
	});

	it('refuses a plan node kind it cannot render instead of freezing it into empty text', () => {
		// Freezing used to end in an unguarded `kind: 'text'` return, so a node
		// kind this renderer did not recognize became a text node carrying neither
		// a value nor a slot. The first screen painted an empty string where the
		// content belonged: no throw, no warning, nothing missing from the batch
		// to notice.
		expect(() => universalPlan('lynx', { kind: 'hosts', type: 'view' } as never)).toThrow(
			/Unsupported universal plan node kind "hosts"/,
		);
		// At depth too: freezing walks children, and a child it cannot render is
		// the same authoring error as a root it cannot render.
		expect(() =>
			universalPlan('lynx', {
				kind: 'host',
				type: 'view',
				children: [{ kind: 'hosts', type: 'view' }],
			} as never),
		).toThrow(/Unsupported universal plan node kind "hosts"/);
	});

	it('refuses a compiled program whose tables name nodes it does not make', () => {
		// #163: this renderer numbers a program's first screen from its own
		// tables, and reads nothing back out of the paint to check them. An event
		// site naming a node the program does not make is therefore read against
		// an ID table that has no entry for it, announced to the background as a
		// listener bound to `undefined`, and the tap it was authored for reaches
		// nothing — with no throw, no warning, and a page that looks right.
		//
		// Freezing runs once per plan at module scope, which is what makes this
		// the place to answer it: a per-mount check would pay on every row.
		const program = {
			kind: 'program' as const,
			slots: [null],
			nodes: 2,
			values: [],
			events: [{ slot: 0, node: 2, type: 'tap', priority: 'discrete' }],
			ranges: [],
			bind: () => () => [],
		};
		expect(() => universalPlan('lynx', program as never)).toThrow(
			/binds an event on node 2, which is not one of its 2 nodes/,
		);
		// A range's declared position is the same kind of claim: one outside the
		// program's own pre-order matches nothing, so its members would be
		// numbered after the program rather than where the hole was, and every ID
		// from there on would disagree with the interpreted encoding this one has
		// to be interchangeable with.
		expect(() =>
			universalPlan('lynx', {
				...program,
				events: [],
				ranges: [{ slot: 0, node: 1, id: 7 }],
			} as never),
		).toThrow(/declares a keyed range at position 7, which is not one of its 3 positions/);
		expect(() =>
			universalPlan('lynx', { ...program, events: [], bind: undefined } as never),
		).toThrow(/requires a bind function and a node count/);
		// Two sites on one node for one driver event type is the same class of
		// claim, and the one a consumer's addressing depends on. The applier reads
		// a site's announcement out of the run this renderer recorded for the
		// program rather than searching for it, which is exact only while
		// `(node, type)` names at most one site: two of them would make one
		// announcement answer to both, and the second listener would be announced
		// to the background and installed on nothing.
		expect(() =>
			universalPlan('lynx', {
				...program,
				events: [
					{ slot: 0, node: 1, type: 'tap', priority: 'discrete' },
					{ slot: 1, node: 1, type: 'tap', priority: 'discrete' },
				],
			} as never),
		).toThrow(/binds two events of type "tap" on node 1/);
		// And the third thing a site declares (issue #215 D6). The mount encodes
		// this into every token the program installs, so a value outside the three
		// the dispatcher knows produces a token the host accepts and the background
		// then cannot decode — the same tap reaching nothing, from a third
		// direction. Answered here so the mount does not have to ask per instance;
		// `emitLynxMainThreadProgram` refuses one at build for the plans that do
		// come from the compiler.
		expect(() =>
			universalPlan('lynx', {
				...program,
				events: [{ slot: 0, node: 1, type: 'tap', priority: 'urgent' }],
			} as never),
		).toThrow(/binds an event on node 1 at priority "urgent"/);
		expect(() =>
			universalPlan('lynx', {
				...program,
				events: [{ slot: 0, node: 1, type: 'tap', priority: undefined }],
			} as never),
		).toThrow(/at priority undefined/);
		// All three legal priorities stay legal, so the check cannot pass by
		// refusing everything but the one the fixtures happen to use.
		for (const priority of ['discrete', 'continuous', 'default']) {
			expect(() =>
				universalPlan('lynx', {
					...program,
					events: [{ slot: 0, node: 1, type: 'tap', priority }],
				} as never),
			).not.toThrow();
		}
		// The same type on another node, and another type on the same node, are
		// both ordinary: a row with a tap on each of two children, and a text with
		// a tap and a long press, are what the check has to keep accepting.
		expect(() =>
			universalPlan('lynx', {
				...program,
				events: [
					{ slot: 0, node: 0, type: 'tap', priority: 'discrete' },
					{ slot: 1, node: 1, type: 'tap', priority: 'discrete' },
					{ slot: 2, node: 1, type: 'longpress', priority: 'discrete' },
				],
			} as never),
		).not.toThrow();
		// And a well-formed one is adopted rather than refused: C2c is where this
		// renderer stopped declining the kind its own compiler emits.
		const plan = universalPlan('lynx', {
			...program,
			events: [{ slot: 0, node: 1, type: 'tap', priority: 'discrete' }],
			ranges: [{ slot: 0, node: 1, id: 2 }],
		} as never);
		expect((plan.root as { kind: string }).kind).toBe('program');
		expect(Object.isFrozen(plan.root)).toBe(true);
	});

	it('refuses a compiled program whose range positions do not form an order', () => {
		// Two holes claiming the same position are each inside the program's own
		// pre-order, so the freeze-time bound check passes them, and only walking
		// the order finds that the second one matches nothing. Left unchecked its
		// members would keep ID zero — which reads as a node nobody painted rather
		// than as a program whose tables disagree with each other.
		const plan = universalPlan('lynx', {
			kind: 'program',
			slots: ['r', 'r'],
			nodes: 1,
			values: [],
			events: [],
			ranges: [
				{ slot: 0, node: 0, id: 1 },
				{ slot: 1, node: 0, id: 1 },
			],
			bind: () => () => [],
		} as never);
		const Broken = defineUniversalComponent('lynx', () =>
			universalValue(plan, ['first', 'second']),
		);
		expect(() => renderLynxFirstScreen(Broken, {})).toThrow(
			/declares 1 nodes and 2 ranges, but its range positions do not fit that order/,
		);
	});

	it('renders context, keyed control flow, caught errors, and pending fallbacks deterministically', () => {
		const Context = createContext('default');
		const Read = defineUniversalComponent('lynx', () =>
			universalValue(leafPlan, [universalProps([]), useContext(Context)]),
		);
		const pending = new Promise<void>(() => {});
		const Boundary = defineUniversalComponent('lynx', () =>
			universalContext(Context, 'provided', [
				universalTry(
					() => {
						use(pending);
						return null;
					},
					() => universalComponent('lynx', Read),
				),
				universalTry(
					() => {
						throw new Error('expected');
					},
					null,
					() => universalValue(leafPlan, [universalProps([]), 'caught']),
				),
			]),
		);

		const result = renderLynxFirstScreen(Boundary, {});
		const creates = result.batch.commands.filter((command) => command.op === 'create');
		expect(
			creates.filter((command) => command.type === '#text').map((command) => command.props),
		).toEqual([{ value: 'provided' }, { value: 'caught' }]);
	});

	it('starts every pending member in a compiler-batched suspension stratum', () => {
		const first = new Promise<void>(() => {}) as Promise<void> & { status?: string };
		const second = new Promise<void>(() => {}) as Promise<void> & { status?: string };
		const Batched = defineUniversalComponent('lynx', () =>
			universalTry(
				() => {
					useBatch([first, second]);
					use(first);
					return null;
				},
				() => universalValue(leafPlan, [universalProps([]), 'pending']),
			),
		);

		const result = renderLynxFirstScreen(Batched, {});
		expect(first.status).toBe('pending');
		expect(second.status).toBe('pending');
		expect(result.batch.commands).toContainEqual({
			op: 'create',
			id: 4,
			type: '#text',
			props: { value: 'pending' },
		});
	});

	it('matches background IDs and topology through early and directive control flow', () => {
		const ControlFlow = defineUniversalComponent(
			'lynx',
			(props: { show: boolean; branch: string; fail: boolean }) => {
				if (!props.show) return null;
				return [
					universalIf(true, () => universalValue(rowPlan, [universalProps([['set', 'id', 'if']])])),
					universalSwitch(
						props.branch,
						[['a', () => universalValue(rowPlan, [universalProps([['set', 'id', 'case']])])]],
						() => universalValue(rowPlan, [universalProps([['set', 'id', 'default']])]),
					),
					universalTry(
						() => {
							if (props.fail) throw new Error('expected');
							return universalValue(rowPlan, [universalProps([['set', 'id', 'body']])]);
						},
						null,
						() => universalValue(rowPlan, [universalProps([['set', 'id', 'catch']])]),
					),
					universalActivity('hidden', () =>
						universalValue(rowPlan, [universalProps([['set', 'id', 'hidden']])]),
					),
				];
			},
		);

		for (const props of [
			{ show: false, branch: 'a', fail: false },
			{ show: true, branch: 'a', fail: false },
			{ show: true, branch: 'other', fail: true },
		]) {
			expect(renderLynxFirstScreen(ControlFlow, props).batch).toEqual(
				captureBackgroundBatch(ControlFlow, props),
			);
		}
	});

	it('accepts conditional initial hooks without retaining an update path', () => {
		const ConditionalHooks = defineUniversalComponent('lynx', (props: { enabled: boolean }) => {
			if (!props.enabled) return null;
			const [value, update] = useState('initial');
			update('ignored');
			return universalValue(leafPlan, [universalProps([]), value]);
		});

		expect(renderLynxFirstScreen(ConditionalHooks, { enabled: false }).batch.commands).toEqual([]);
		expect(
			renderLynxFirstScreen(ConditionalHooks, { enabled: true }).batch.commands,
		).toContainEqual({
			op: 'create',
			id: 2,
			type: '#text',
			props: { value: 'initial' },
		});
	});
});
