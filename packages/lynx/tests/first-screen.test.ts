import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deserialize, serialize } from 'node:v8';
import { JSDOM } from 'jsdom';
import {
	defineUniversalComponent,
	universalComponent,
	universalFor,
	universalPlan,
	universalProps,
	universalValue,
	useLayoutEffect,
	type UniversalComponent,
} from 'octane/universal/native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLynxRoot, type LynxRoot } from '../src/index.js';
import { root as firstScreenRoot } from '../src/first-screen.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import * as firstScreenRenderer from '../src/main-renderer.js';
import {
	defineUniversalComponent as defineFirstScreenComponent,
	firstScreenEvent,
	renderLynxFirstScreen,
	universalFor as firstScreenFor,
	universalPlan as firstScreenPlan,
	universalProps as firstScreenProps,
	universalValue as firstScreenValue,
	useLayoutEffect as useFirstScreenLayoutEffect,
} from '../src/main-renderer.js';
import {
	LYNX_BACKGROUND_TO_MAIN_EVENT,
	LYNX_COMPACT_ACKNOWLEDGEMENT,
	LYNX_LAZY_PUBLIC_INSTANCES,
	LYNX_MAIN_TO_BACKGROUND_EVENT,
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	type LynxBackgroundInboundMessage,
	type LynxBackgroundOutboundMessage,
	type LynxContextProxy,
} from '../src/core/protocol.js';

interface SceneProps {
	readonly id: string;
	readonly items: readonly string[];
	readonly componentItems?: readonly string[];
	readonly rowPrefix?: string;
	readonly onRowTap?: (id: string) => void;
	readonly onTap: (payload: unknown) => void;
	readonly onEffect: (owner: 'main' | 'background') => void;
}

interface EventRegistration {
	readonly listener: string | undefined;
}

interface InstalledEnvironment {
	readonly dom: JSDOM;
	readonly main: LynxMainThreadController;
	readonly registrations: EventRegistration[];
}

const mainPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	propsSlot: 0,
});

const mainScenePlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	propsSlot: 0,
	children: [{ kind: 'slot', slot: 1 }],
});

const MainScene = defineFirstScreenComponent('lynx', (props: SceneProps) => {
	useFirstScreenLayoutEffect(() => {
		props.onEffect('main');
	});
	return [
		firstScreenValue(mainScenePlan, [
			firstScreenProps([
				['set', 'id', props.id],
				['set', 'bindtap', firstScreenEvent],
			]),
			null,
		]),
		firstScreenFor(
			props.items,
			(item) => item,
			(item) => firstScreenValue(mainPlan, [firstScreenProps([['set', 'id', item]])]),
			null,
			true,
			true,
		),
	];
});

const MainSingleHost = defineFirstScreenComponent('lynx', (props: { readonly id: string }) =>
	firstScreenValue(mainPlan, [firstScreenProps([['set', 'id', props.id]])]),
);

const feedPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'list',
			bindings: [['id', 1]],
			children: [{ kind: 'host', type: 'list-item', bindings: [['item-key', 2]] }],
		},
	],
});

const FeedScene = defineFirstScreenComponent('lynx', () =>
	firstScreenValue(feedPlan, ['feed-shell', 'feed', 'row-0']),
);

const emptyFeedPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [{ kind: 'host', type: 'list', bindings: [['id', 1]] }],
});

/** A `<list>` with no rows: the one shape whose commit carries no list update. */
const EmptyFeedScene = defineFirstScreenComponent('lynx', () =>
	firstScreenValue(emptyFeedPlan, ['feed-shell', 'feed']),
);

/** The same feed with the row's `item-key` under the caller's control. */
const RowKeyFeedScene = defineFirstScreenComponent('lynx', (props: { readonly itemKey: string }) =>
	firstScreenValue(feedPlan, ['feed-shell', 'feed', props.itemKey]),
);

// Two list topologies the staged apply rejects. They exist so that painting a
// list cannot quietly swallow a diagnostic: a malformed tree must still throw
// from the staged path rather than settling as a quiet `skipped`.
const nestedFeedPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'list',
			bindings: [['id', 1]],
			children: [
				{
					kind: 'host',
					type: 'list-item',
					bindings: [['item-key', 2]],
					children: [{ kind: 'host', type: 'list', bindings: [['id', 3]] }],
				},
			],
		},
	],
});

const NestedFeedScene = defineFirstScreenComponent('lynx', () =>
	firstScreenValue(nestedFeedPlan, ['feed-shell', 'feed', 'row-0', 'inner-feed']),
);

const listChildPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'list',
			bindings: [['id', 1]],
			children: [{ kind: 'host', type: 'view', bindings: [['id', 2]] }],
		},
	],
});

const ListChildScene = defineFirstScreenComponent('lynx', () =>
	firstScreenValue(listChildPlan, ['feed-shell', 'feed', 'not-a-row']),
);

const duplicateRowPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'list',
			bindings: [['id', 1]],
			children: [
				{ kind: 'host', type: 'list-item', bindings: [['item-key', 2]] },
				{ kind: 'host', type: 'list-item', bindings: [['item-key', 3]] },
			],
		},
	],
});

const DuplicateRowScene = defineFirstScreenComponent('lynx', () =>
	firstScreenValue(duplicateRowPlan, ['feed-shell', 'feed', 'row-0', 'row-0']),
);

// The stray row sits beside a well-formed list on purpose: a tree with no list
// at all is never a decline candidate, so it would not exercise the placement
// rule the pre-check has to honour.
const strayRowPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'list',
			bindings: [['id', 1]],
			children: [{ kind: 'host', type: 'list-item', bindings: [['item-key', 2]] }],
		},
		{ kind: 'host', type: 'list-item', bindings: [['item-key', 3]] },
	],
});

const StrayRowScene = defineFirstScreenComponent('lynx', () =>
	firstScreenValue(strayRowPlan, ['feed-shell', 'feed', 'row-0', 'stray-row']),
);

// Non-list defects the prepare walk reports. The list beside them is valid on
// purpose: a page the pre-check declines never reaches that walk, so these are
// exactly the diagnostics a skipped build could swallow.
const collidingFeedPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'list',
			bindings: [['id', 1]],
			children: [{ kind: 'host', type: 'list-item', bindings: [['item-key', 2]] }],
		},
		{
			kind: 'host',
			type: 'view',
			bindings: [
				['bindtap', 3],
				['main-thread:bindtap', 4],
			],
		},
	],
});

const CollidingFeedScene = defineFirstScreenComponent('lynx', () =>
	firstScreenValue(collidingFeedPlan, [
		'feed-shell',
		'feed',
		'row-0',
		() => {},
		{ _wkltId: 'gate:tap' },
	]),
);

const duplicateRefFeedPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'list',
			bindings: [['id', 1]],
			children: [{ kind: 'host', type: 'list-item', bindings: [['item-key', 2]] }],
		},
		{ kind: 'host', type: 'view', bindings: [['main-thread:ref', 3]] },
		{ kind: 'host', type: 'view', bindings: [['main-thread:ref', 4]] },
	],
});

const DuplicateRefFeedScene = defineFirstScreenComponent('lynx', () =>
	firstScreenValue(duplicateRefFeedPlan, [
		'feed-shell',
		'feed',
		'row-0',
		{ _wvid: 'gate:ref' },
		{ _wvid: 'gate:ref' },
	]),
);

const duplicateRefRowPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'list',
			bindings: [['id', 1]],
			children: [
				{
					kind: 'host',
					type: 'list-item',
					bindings: [
						['item-key', 2],
						['main-thread:ref', 4],
					],
				},
				{
					kind: 'host',
					type: 'list-item',
					bindings: [
						['item-key', 3],
						['main-thread:ref', 5],
					],
				},
			],
		},
	],
});

const DuplicateRefRowScene = defineFirstScreenComponent('lynx', () =>
	firstScreenValue(duplicateRefRowPlan, [
		'feed-shell',
		'feed',
		'row-0',
		'row-1',
		{ _wvid: 'gate:row-ref' },
		{ _wvid: 'gate:row-ref' },
	]),
);

// The shape authored code actually produces. A `<list>` gets its rows from a
// keyed `@for`, so a range sits between the list and every `<list-item>` and the
// rows are not the list's own children in the record tree. The fixtures above
// nest the rows directly, which no `.tsrx` does; a reader of the record tree
// that stopped at the list's immediate children would find no rows here.
const keyedRowPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'list-item',
	bindings: [['item-key', 0]],
});

const keyedFeedPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'list',
			bindings: [['id', 1]],
			children: [{ kind: 'slot', slot: 2 }],
		},
	],
});

// Rows carry their loop key and their `item-key` separately, because they are
// separate contracts: `@for` rejects a duplicate loop key on its own, before any
// list rule is consulted, so a fixture reusing one value for both could never
// reach the list's own uniqueness check.
const KeyedFeedScene = defineFirstScreenComponent(
	'lynx',
	(props: { readonly rows: readonly (readonly [key: string, itemKey: string])[] }) =>
		firstScreenValue(keyedFeedPlan, [
			'feed-shell',
			'feed',
			firstScreenFor(
				props.rows,
				(row) => row[0],
				(row) => firstScreenValue(keyedRowPlan, [row[1]]),
				null,
				true,
				true,
			),
		]),
);

// The lowering the compiler actually emits for `<list id="native-feed">`: a
// `template` create program, not a `host` plan node. Verified against
// `tests/_fixtures/native-list.lynx.tsrx` compiled with `lynxMainThreadRenderer`,
// which produces exactly this `kind`/`slots`/`create` shape with the rows as a
// keyed `@for` in the single child hole. The record tree it renders is what the
// pre-check reads, so this is the fixture that proves the pre-check fires on
// compiled pages rather than only on hand-built plans.
const templateFeedPlan = firstScreenPlan('lynx', {
	kind: 'template',
	slots: ['r'],
	create: (env, values) => {
		const list = env.h('list');
		env.p(list, 'id', 'feed');
		env.s(list, values[0]);
		return list;
	},
});

const TemplateFeedScene = defineFirstScreenComponent(
	'lynx',
	(props: { readonly rows: readonly (readonly [key: string, itemKey: string])[] }) =>
		firstScreenValue(templateFeedPlan, [
			firstScreenFor(
				props.rows,
				(row) => row[0],
				(row) => firstScreenValue(keyedRowPlan, [row[1]]),
				null,
				true,
				true,
			),
		]),
);

interface FirstScreenLinkedRuntime {
	useLinkedState?<Source, Value>(
		source: Source,
		reconcile: (source: Source, previous: { source: Source; value: Value } | undefined) => Value,
		options?:
			| {
					sourceEqual?: (previous: Source, next: Source) => boolean;
					valueEqual?: (previous: Value, next: Value) => boolean;
			  }
			| symbol
			| string
			| number,
		slot?: unknown,
	): [Value, (next: Value | ((previous: Value) => Value)) => void];
	__useLinkedStateWithGetter?<Source, Value>(
		source: Source,
		reconcile: (source: Source, previous: { source: Source; value: Value } | undefined) => Value,
		options?:
			| {
					sourceEqual?: (previous: Source, next: Source) => boolean;
					valueEqual?: (previous: Value, next: Value) => boolean;
			  }
			| symbol
			| string
			| number,
		slot?: unknown,
	): [Value, (next: Value | ((previous: Value) => Value)) => void, () => Value];
}

const firstScreenLinkedRuntime = firstScreenRenderer as FirstScreenLinkedRuntime;

function compiledFirstScreenHookImports(observeGetter: boolean): Set<string> {
	const tuple = observeGetter ? '[value, setValue, getValue]' : '[value, setValue]';
	const output = observeGetter ? 'getValue()' : 'value';
	const source = `
			import { useLinkedState } from 'octane';
			export function LinkedFirstScreen(props) @{
				const ${tuple} = useLinkedState(props.source, (source) => source.label);
				<view id={${output}} />
			}
		`;
	const repository = fileURLToPath(new URL('../../../', import.meta.url));
	const result = execFileSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			`import { createRequire } from 'node:module';
import { compile } from './packages/octane/src/compiler/compile.js';
import { lynxMainThreadRenderer } from './packages/lynx/src/config.runtime.js';
const compilerRequire = createRequire(new URL('./packages/octane/package.json', import.meta.url));
const { parseModule } = await import(compilerRequire.resolve('@tsrx/core'));
let source = '';
for await (const chunk of process.stdin) source += chunk;
const { code } = compile(source, '/src/linked-first-screen.lynx.tsrx', {
	hmr: false,
	inlineHookMemo: false,
	renderer: { ...lynxMainThreadRenderer, id: 'lynx' },
	universalRuntime: { runtime: 'lynx', thread: 'main-thread' },
});
const imports = [];
for (const statement of parseModule(code, '/compiled/linked-first-screen.js').body ?? []) {
	if (
		statement.type !== 'ImportDeclaration' ||
		statement.source?.value !== '@octanejs/lynx/main-renderer'
	) continue;
	for (const specifier of statement.specifiers ?? []) {
		if (specifier.type === 'ImportSpecifier') {
			imports.push(specifier.imported?.name ?? specifier.imported?.value);
		}
	}
}
process.stdout.write(JSON.stringify(imports));`,
		],
		{
			cwd: repository,
			input: source,
			encoding: 'utf8',
		},
	);
	return new Set(JSON.parse(result) as string[]);
}

const backgroundPlan = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	propsSlot: 0,
});

const backgroundScenePlan = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	propsSlot: 0,
	children: [{ kind: 'slot', slot: 1 }],
});

const postAdoptionRowPlan = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			bindings: [['bindtap', 2]],
			children: [{ kind: 'slot', slot: 1 }],
		},
	],
});

const PostAdoptionRow = defineUniversalComponent(
	'lynx',
	({
		id,
		label,
		onTap,
	}: {
		readonly id: string;
		readonly label: string;
		readonly onTap: (id: string) => void;
	}) => universalValue(postAdoptionRowPlan, [id, label, () => onTap(id)]),
);

const BackgroundScene = defineUniversalComponent('lynx', (props: SceneProps) => {
	useLayoutEffect(() => {
		props.onEffect('background');
	}, []);
	return [
		universalValue(backgroundScenePlan, [
			universalProps([
				['set', 'id', props.id],
				['set', 'bindtap', props.onTap],
			]),
			props.componentItems === undefined
				? null
				: universalFor(
						props.componentItems,
						(id) => id,
						(id) =>
							universalComponent(
								'lynx',
								PostAdoptionRow,
								universalProps([
									['set', 'id', id],
									['set', 'label', `${props.rowPrefix ?? 'label'}:${id}`],
									['set', 'onTap', props.onRowTap ?? (() => {})],
								]),
							),
					),
		]),
		universalFor(
			props.items,
			(item) => item,
			(item) => universalValue(backgroundPlan, [universalProps([['set', 'id', item]])]),
			null,
			true,
			true,
		),
	];
});

let installed: InstalledEnvironment | null = null;
let backgroundRoot: LynxRoot | null = null;

function mainContext(): LynxContextProxy {
	return (
		globalThis as typeof globalThis & {
			lynx: { getJSContext(): LynxContextProxy };
		}
	).lynx.getJSContext();
}

function backgroundContext(): LynxContextProxy {
	return (
		globalThis as typeof globalThis & {
			lynx: { getCoreContext(): LynxContextProxy };
		}
	).lynx.getCoreContext();
}

function installEnvironment(
	configurePAPI?: (target: Record<string, unknown>) => void,
	installOptions?: Partial<Parameters<typeof installLynxMainThread>[0]>,
): InstalledEnvironment {
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	globalThis.lynxTestingEnv.switchToMainThread();
	const target = globalThis as unknown as Record<string, unknown>;
	configurePAPI?.(target);
	const registrations: EventRegistration[] = [];
	const addEvent = target.__AddEvent as (
		node: object,
		kind: string,
		name: string,
		listener: string | undefined,
	) => void;
	target.__AddEvent = (node, kind, name, listener) => {
		registrations.push(Object.freeze({ listener }));
		addEvent(node, kind, name, listener);
	};
	const main = installLynxMainThread({
		firstScreen: true,
		firstScreenSync: 'manual',
		...installOptions,
	});
	return (installed = { dom, main, registrations });
}

afterEach(async () => {
	if (backgroundRoot !== null) {
		try {
			await backgroundRoot.unmount();
		} catch {
			// A manual protocol test can leave no live background root.
		}
	}
	backgroundRoot = null;
	if (installed !== null) {
		installed.main.close();
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
		installed.dom.window.close();
	}
	installed = null;
});

describe.sequential('Lynx synchronous first-screen adoption', () => {
	it('compiles linked-state pairs for the main renderer and paints their one-shot initial value', () => {
		expect(compiledFirstScreenHookImports(false).has('useLinkedState')).toBe(true);
		const { dom } = installEnvironment();
		let update!: (next: string) => void;
		const initialValues: Array<{ source: { label: string }; value: string } | undefined> = [];
		const LinkedScene = defineFirstScreenComponent(
			'lynx',
			(props: { source: { label: string } }) => {
				const [value, setValue] = firstScreenLinkedRuntime.useLinkedState!(
					props.source,
					(source, previous) => {
						initialValues.push(previous);
						return `linked-${source.label}`;
					},
					Symbol('linked-first-screen'),
				);
				update = setValue;
				return firstScreenValue(mainPlan, [firstScreenProps([['set', 'id', value]])]);
			},
		);

		firstScreenRoot.render(LinkedScene, { source: { label: 'main' } });
		expect(dom.window.document.querySelector('#linked-main')).not.toBeNull();
		expect(initialValues).toEqual([undefined]);

		update('ignored-update');
		expect(dom.window.document.querySelector('#linked-main')).not.toBeNull();
		expect(dom.window.document.querySelector('#ignored-update')).toBeNull();
	});

	it('compiles observed linked getters and exposes the original one-shot value after inert updates', () => {
		expect(compiledFirstScreenHookImports(true).has('__useLinkedStateWithGetter')).toBe(true);
		const { dom } = installEnvironment();
		const sourceEqual = vi.fn(() => false);
		const valueEqual = vi.fn(() => false);
		let getValue!: () => string;
		let setValue!: (next: string) => void;
		const LinkedGetterScene = defineFirstScreenComponent(
			'lynx',
			(props: { source: { label: string } }) => {
				const [value, update, read] = firstScreenLinkedRuntime.__useLinkedStateWithGetter!(
					props.source,
					(source, previous) => {
						expect(previous).toBeUndefined();
						return `getter-${source.label}`;
					},
					{ sourceEqual, valueEqual },
					Symbol('linked-getter-first-screen'),
				);
				getValue = read;
				setValue = update;
				return firstScreenValue(mainPlan, [firstScreenProps([['set', 'id', value]])]);
			},
		);

		firstScreenRoot.render(LinkedGetterScene, { source: { label: 'main' } });
		expect(dom.window.document.querySelector('#getter-main')).not.toBeNull();
		expect(getValue()).toBe('getter-main');
		setValue('ignored-update');
		expect(getValue()).toBe('getter-main');
		expect(sourceEqual).not.toHaveBeenCalled();
		expect(valueEqual).not.toHaveBeenCalled();
	});

	it('paints synchronously, gates background startup, adopts node identity, and replays events', async () => {
		const { dom, main, registrations } = installEnvironment();
		const inbound: LynxBackgroundInboundMessage[] = [];
		const outbound: LynxBackgroundOutboundMessage[] = [];
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			inbound.push(event.data as LynxBackgroundInboundMessage);
		});
		mainContext().addEventListener(LYNX_BACKGROUND_TO_MAIN_EVENT, (event) => {
			outbound.push(event.data as LynxBackgroundOutboundMessage);
		});
		const effects: string[] = [];
		const events: unknown[] = [];
		let placeholderToken: string | undefined;
		const props: SceneProps = {
			id: 'first-screen',
			items: ['a', 'b'],
			onTap(payload) {
				events.push(payload);
				if (
					(payload as { detail?: { phase?: unknown } }).detail?.phase === 'first' &&
					placeholderToken !== undefined
				) {
					main.dispatchNativeEvent(placeholderToken, {
						type: 'tap',
						detail: { phase: 'reentrant' },
					});
				}
			},
			onEffect(owner) {
				effects.push(owner);
			},
		};

		const painted = firstScreenRoot.render(MainScene as UniversalComponent<SceneProps>, props);
		const firstNode = dom.window.document.querySelector('#first-screen');
		const firstA = dom.window.document.querySelector('#a');
		const firstB = dom.window.document.querySelector('#b');
		expect(painted).toMatchObject({ hostCount: 3, logicalCount: 5 });
		expect(firstNode).not.toBeNull();
		expect(firstA).not.toBeNull();
		expect(firstB).not.toBeNull();
		expect(effects).toEqual([]);
		expect(main.firstScreenSnapshot()).toMatchObject({ root: 1, version: 1 });

		placeholderToken = registrations.find((entry) => entry.listener !== undefined)?.listener;
		expect(placeholderToken).toBeTypeOf('string');
		main.dispatchNativeEvent(placeholderToken!, { type: 'tap', detail: { phase: 'first' } });

		globalThis.lynxTestingEnv.switchToBackgroundThread();
		const context = backgroundContext();
		const dispatch = context.dispatchEvent.bind(context);
		const clonedRuns: boolean[] = [];
		context.dispatchEvent = (event) => {
			const data = deserialize(serialize(event.data)) as unknown;
			if (
				data !== null &&
				typeof data === 'object' &&
				'type' in data &&
				data.type === 'commit' &&
				'batch' in data
			) {
				const batch = data.batch as { commands?: readonly unknown[] };
				const run = batch.commands?.[0] as
					{ op?: string; program?: object; values?: readonly unknown[] } | undefined;
				if (run?.op === 'mount-template-run') {
					clonedRuns.push(
						!Object.isFrozen(run) && !Object.isFrozen(run.program) && !Object.isFrozen(run.values),
					);
				}
			}
			return dispatch({ ...event, data });
		};
		backgroundRoot = createLynxRoot();
		const rendering = backgroundRoot.render(BackgroundScene, props);
		let settled = false;
		void rendering.finally(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(events).toEqual([]);

		globalThis.lynxTestingEnv.switchToMainThread();
		main.markFirstScreenSyncReady();
		globalThis.lynxTestingEnv.switchToBackgroundThread();
		await rendering;

		expect(dom.window.document.querySelector('#first-screen')).toBe(firstNode);
		expect(dom.window.document.querySelector('#a')).toBe(firstA);
		expect(dom.window.document.querySelector('#b')).toBe(firstB);
		expect(effects).toEqual(['background']);
		expect(main.diagnostics()).toEqual([]);
		expect(events).toEqual([
			{ type: 'tap', detail: { phase: 'first' } },
			{ type: 'tap', detail: { phase: 'reentrant' } },
		]);
		expect(main.firstScreenSnapshot()).toBeNull();
		expect(main.activeIdentity()).toMatchObject({ root: 1, version: 1 });
		const ready = inbound.filter((message) => message.type === 'main-ready');
		expect(ready).toHaveLength(1);
		expect(ready[0]).toMatchObject({
			type: 'main-ready',
			firstTree: { root: 1, version: 1 },
			capabilities: { templateProgram: 1, templateRuns: 1, lazyPublicInstances: 1 },
		});
		expect((ready[0] as { request: number }).request).toBeGreaterThan(0);
		const adoptionCommit = outbound.find((message) => message.type === 'commit');
		expect(adoptionCommit).not.toHaveProperty('ack');
		expect(adoptionCommit).not.toHaveProperty('instances');

		const componentItems = ['row-a', 'row-b', 'row-c', 'row-d', 'row-e', 'row-f', 'row-g', 'row-h'];
		const rowTaps: string[] = [];
		await backgroundRoot.render(BackgroundScene, {
			...props,
			componentItems,
			onRowTap: (id) => rowTaps.push(id),
		});
		expect(dom.window.document.querySelector('#first-screen')).toBe(firstNode);
		expect(dom.window.document.querySelector('#a')).toBe(firstA);
		expect(dom.window.document.querySelector('#b')).toBe(firstB);
		expect(
			componentItems.map((id) => dom.window.document.querySelector(`#${id}`)?.textContent),
		).toEqual(componentItems.map((id) => `label:${id}`));
		const creation = outbound.filter((message) => message.type === 'commit').at(-1);
		expect(creation).toMatchObject({
			ack: LYNX_COMPACT_ACKNOWLEDGEMENT,
			instances: LYNX_LAZY_PUBLIC_INSTANCES,
			batch: { commands: [{ op: 'mount-template-run' }] },
		});
		const creationAcknowledgement = inbound.find(
			(message) => message.type === 'ack' && message.version === creation!.version,
		);
		expect(creationAcknowledgement).toMatchObject({
			encoding: LYNX_COMPACT_ACKNOWLEDGEMENT,
			count: componentItems.length * 3,
		});
		expect(creationAcknowledgement).not.toHaveProperty('handles');
		expect(clonedRuns).toEqual([true]);
		const lastRowListener = registrations.at(-1)?.listener;
		expect(lastRowListener).toBeTypeOf('string');
		main.dispatchNativeEvent(lastRowListener!, { type: 'tap' });
		expect(rowTaps).toEqual(['row-h']);
		expect(main.diagnostics()).toEqual([]);

		await backgroundRoot.render(BackgroundScene, {
			...props,
			componentItems,
			rowPrefix: 'updated',
			onRowTap: (id) => rowTaps.push(id),
		});
		expect(dom.window.document.querySelector('#row-a')?.textContent).toBe('updated:row-a');
		expect(dom.window.document.querySelector('#first-screen')).toBe(firstNode);

		await backgroundRoot.render(BackgroundScene, {
			...props,
			componentItems: componentItems.slice(0, -1),
			rowPrefix: 'updated',
			onRowTap: (id) => rowTaps.push(id),
		});
		expect(dom.window.document.querySelector('#row-h')).toBeNull();
		expect(dom.window.document.querySelector('#first-screen')).toBe(firstNode);
		main.dispatchNativeEvent(lastRowListener!, { type: 'tap' });
		expect(rowTaps).toEqual(['row-h']);
		expect(main.diagnostics().at(-1)?.message).toMatch(/stale, hidden, removed, or foreign/);
	});

	it('defers an engine-mode first screen until __RenderPage arrives', () => {
		// Native installs the decoded PageConfig on the ElementManager only after
		// main-thread script evaluation, so an engine-mode receiver must not
		// create elements during evaluation; the render runs when the engine's
		// __RenderPage lifecycle proves evaluation has finished.
		const engineListeners = new Map<string, Set<(event: LynxContextProxyEvent) => void>>();
		const engineContext: LynxContextProxy = {
			dispatchEvent(event) {
				for (const listener of [...(engineListeners.get(event.type) ?? [])]) listener(event);
			},
			addEventListener(type, listener) {
				let entries = engineListeners.get(type);
				if (entries === undefined) engineListeners.set(type, (entries = new Set()));
				entries.add(listener);
			},
			removeEventListener(type, listener) {
				engineListeners.get(type)?.delete(listener);
			},
		};
		const { dom, main } = installEnvironment(
			(target) => {
				(target.lynx as Record<string, unknown>).getEngine = () => engineContext;
			},
			{ firstScreenRender: 'engine' },
		);
		const props: SceneProps = {
			id: 'engine-mode',
			items: ['a'],
			onTap() {},
			onEffect() {},
		};

		const deferred = firstScreenRoot.render(MainScene as UniversalComponent<SceneProps>, props);
		expect(deferred).toBeNull();
		expect(dom.window.document.querySelector('#engine-mode')).toBeNull();

		main.markFirstScreenSyncReady();
		expect(dom.window.document.querySelector('#engine-mode')).toBeNull();
		expect(main.firstScreenSnapshot()).toBeNull();

		engineContext.dispatchEvent({ type: '__RenderPage', data: [{}, {}] });
		expect(dom.window.document.querySelector('#engine-mode')).not.toBeNull();
		expect(dom.window.document.querySelector('#a')).not.toBeNull();
		expect(main.firstScreenSnapshot()).toMatchObject({ root: 1, version: 1 });
		expect(main.diagnostics()).toEqual([]);
	});

	it('repairs a nondeterministic first tree and reports the typed mismatch', () => {
		const { dom, main } = installEnvironment();
		const props: SceneProps = {
			id: 'main-value',
			items: ['a', 'b'],
			onTap() {},
			onEffect() {},
		};
		firstScreenRoot.render(MainScene as UniversalComponent<SceneProps>, props);
		const firstNode = dom.window.document.querySelector('#main-value');
		const inbound: LynxBackgroundInboundMessage[] = [];
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			inbound.push(event.data as LynxBackgroundInboundMessage);
		});
		main.markFirstScreenSyncReady();

		const replacement = renderLynxFirstScreen(MainScene, {
			...props,
			id: 'background-value',
		});
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'commit',
				batch: replacement.batch,
			},
		});

		expect(inbound.find((message) => message.type === 'ack')).toMatchObject({
			type: 'ack',
			adoption: 'repaired',
		});
		expect(dom.window.document.querySelector('#background-value')).not.toBe(firstNode);
		expect(main.diagnostics()).toEqual([
			expect.objectContaining({
				code: 'OCTANE_LYNX_FIRST_SCREEN_MISMATCH',
				path: 'snapshot.nodes[1].props',
			}),
		]);
	});

	it('accepts a later commit before adoption ownership is confirmed', () => {
		const { dom, main } = installEnvironment();
		firstScreenRoot.render(MainSingleHost, { id: 'first-screen' });
		const inbound: LynxBackgroundInboundMessage[] = [];
		let queuedSecondCommit = false;
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			const message = event.data as LynxBackgroundInboundMessage;
			inbound.push(message);
			if (message.type !== 'ack' || message.version !== 1 || queuedSecondCommit) return;
			queuedSecondCommit = true;
			backgroundContext().dispatchEvent({
				type: LYNX_BACKGROUND_TO_MAIN_EVENT,
				data: {
					protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
					renderer: LYNX_TRANSPORT_RENDERER,
					root: 1,
					version: 2,
					type: 'commit',
					batch: {
						renderer: 'lynx',
						version: 2,
						commands: [{ op: 'update', id: 1, props: { id: 'after-adoption' } }],
					},
				},
			});
		});
		main.markFirstScreenSyncReady();

		const initial = renderLynxFirstScreen(MainSingleHost, { id: 'first-screen' });
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'commit',
				batch: initial.batch,
			},
		});

		expect(inbound.filter((message) => message.type === 'ack')).toEqual([
			expect.objectContaining({ type: 'ack', version: 1, adoption: 'adopted' }),
			expect.objectContaining({ type: 'ack', version: 2 }),
		]);
		expect(inbound.some((message) => message.type === 'reject')).toBe(false);
		expect(dom.window.document.querySelector('#after-adoption')).not.toBeNull();
		expect(main.activeIdentity()).toMatchObject({ root: 1, version: 2 });
		expect(main.firstScreenSnapshot()).not.toBeNull();

		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'adoption-ready',
			},
		});

		expect(main.firstScreenSnapshot()).toBeNull();
		expect(main.activeIdentity()).toMatchObject({ root: 1, version: 2 });
		expect(main.diagnostics()).toEqual([]);
	});

	it('can seal an entry with no first-screen render and unblock background readiness', () => {
		const { main } = installEnvironment();
		const inbound: LynxBackgroundInboundMessage[] = [];
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			inbound.push(event.data as LynxBackgroundInboundMessage);
		});

		main.markFirstScreenSyncReady();

		expect(inbound).toEqual([
			{
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'main-ready',
				request: 0,
			},
		]);
		expect(() =>
			firstScreenRoot.render(MainScene as UniversalComponent<SceneProps>, {
				id: 'late',
				items: ['a', 'b'],
				onTap() {},
				onEffect() {},
			}),
		).toThrow(/render window has closed/);
	});

	it('retains a captured first tree until facade unmount cleanup can be retried', async () => {
		let removalFailures = 0;
		const { dom, main } = installEnvironment((target) => {
			const remove = target.__RemoveElement as (parent: object, child: object) => unknown;
			target.__RemoveElement = (parent: object, child: object) => {
				if (removalFailures++ < 3) throw new Error('transient first-tree remove failure');
				return remove(parent, child);
			};
		});
		const inbound: LynxBackgroundInboundMessage[] = [];
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			inbound.push(event.data as LynxBackgroundInboundMessage);
		});
		firstScreenRoot.render(MainSingleHost, { id: 'cleanup-retry' });

		await firstScreenRoot.unmount();
		expect(dom.window.document.querySelector('#cleanup-retry')).not.toBeNull();
		expect(main.firstScreenSnapshot()).not.toBeNull();
		expect(inbound).toEqual([]);

		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'main-ready-request',
				request: 43,
			},
		});
		expect(dom.window.document.querySelector('#cleanup-retry')).toBeNull();
		expect(main.firstScreenSnapshot()).toBeNull();
		expect(inbound).toEqual([expect.objectContaining({ type: 'main-ready', request: 43 })]);
	});

	// A `<list>` is a documented element an application is entitled to use, and
	// the background genuinely cannot adopt one: the platform materializes its
	// rows through main-local callbacks and owns the resulting cells. Declining
	// the synchronous paint is therefore an ordinary outcome, and must not be
	// reported the way the broken host in the next test is.
	it('paints a first screen holding a native list, with its rows still logical', () => {
		// The divergence this closes: a page holding a `<list>` used to get no
		// synchronous first screen at all, because capture refused every root that
		// held one. It paints now — and only the list paints. Rows are records the
		// platform has not asked for, materialized later through `componentAtIndex`,
		// so a five-row feed still creates exactly one element beneath the shell.
		const painted: string[] = [];
		const { dom, main } = installEnvironment((target) => {
			const hostFlush = target.__FlushElementTree as (...args: unknown[]) => void;
			target.__FlushElementTree = (...args: unknown[]) => {
				hostFlush.apply(target, args);
				painted.push((args[0] as { innerHTML?: string } | undefined)?.innerHTML ?? '');
			};
		});
		const inbound: LynxBackgroundInboundMessage[] = [];
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			inbound.push(event.data as LynxBackgroundInboundMessage);
		});

		expect(firstScreenRoot.render(FeedScene, {})).toMatchObject({ hostCount: 3 });

		expect(painted.some((html) => html.includes('id="feed"'))).toBe(true);
		const list = dom.window.document.querySelector('#feed');
		expect(dom.window.document.querySelector('#feed-shell')).not.toBeNull();
		expect(list).not.toBeNull();
		expect(list!.children).toHaveLength(0);
		expect(main.firstScreenSnapshot()).toMatchObject({ root: 1, version: 1 });
		expect(main.diagnostics()).toEqual([]);

		// A painted list gates background startup like any other painted page —
		// where a declined one used to settle readiness immediately, leaving the
		// background to build the whole feed itself.
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'main-ready-request',
				request: 51,
			},
		});
		expect(inbound).toEqual([]);

		main.markFirstScreenSyncReady();
		expect(inbound).toEqual([
			expect.objectContaining({
				type: 'main-ready',
				request: 51,
				firstTree: expect.objectContaining({ root: 1, version: 1 }),
			}),
		]);
	});

	it('adopts a painted native list, and the adopted list still materializes rows', () => {
		// The list's cells, pools, signs and recycling counters are main-local
		// bookkeeping that never crossed the wire, so adoption moves the state
		// itself. The three callbacks Lynx holds cannot come along — they close over
		// the container adoption is about to empty — so they are rebound against the
		// target. Driving a row in afterwards is what proves that happened: a trio
		// still pointed at the retired source could not produce a cell.
		const { dom, main } = installEnvironment();
		firstScreenRoot.render(FeedScene, {});
		const paintedShell = dom.window.document.querySelector('#feed-shell');
		const paintedList = dom.window.document.querySelector('#feed');
		const inbound: LynxBackgroundInboundMessage[] = [];
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			inbound.push(event.data as LynxBackgroundInboundMessage);
		});
		main.markFirstScreenSyncReady();

		const background = renderLynxFirstScreen(FeedScene, {});
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'commit',
				batch: background.batch,
			},
		});

		expect(inbound.find((message) => message.type === 'ack')).toMatchObject({
			type: 'ack',
			adoption: 'adopted',
		});
		expect(dom.window.document.querySelector('#feed-shell')).toBe(paintedShell);
		expect(dom.window.document.querySelector('#feed')).toBe(paintedList);
		expect(main.diagnostics()).toEqual([]);

		const sign = globalThis.elementTree.enterListItemAtIndex(paintedList as never, 0);
		expect(sign).toBeGreaterThanOrEqual(0);
		expect(paintedList!.children).toHaveLength(1);
	});

	it('adopts a native list that has no rows at all', () => {
		// An empty feed is a real page — a filtered search, a cleared inbox — and it
		// is the one shape whose background commit carries no list update at all,
		// because there is nothing to insert. Adoption must not read that absence as
		// disagreement.
		const { dom, main } = installEnvironment();
		firstScreenRoot.render(EmptyFeedScene, {});
		const paintedList = dom.window.document.querySelector('#feed');
		const inbound: LynxBackgroundInboundMessage[] = [];
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			inbound.push(event.data as LynxBackgroundInboundMessage);
		});
		main.markFirstScreenSyncReady();

		const background = renderLynxFirstScreen(EmptyFeedScene, {});
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'commit',
				batch: background.batch,
			},
		});

		expect(inbound.find((message) => message.type === 'ack')).toMatchObject({
			type: 'ack',
			adoption: 'adopted',
		});
		expect(dom.window.document.querySelector('#feed')).toBe(paintedList);
		expect(main.diagnostics()).toEqual([]);
	});

	it('repairs when the background list holds different rows', () => {
		// `update-list-info` was already written onto the painted node by the main
		// thread. The background says what it would have written through its own
		// prepared list update, and adoption is sound exactly when the two agree.
		const { dom, main } = installEnvironment();
		firstScreenRoot.render(RowKeyFeedScene, { itemKey: 'row-0' });
		const paintedList = dom.window.document.querySelector('#feed');
		const inbound: LynxBackgroundInboundMessage[] = [];
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			inbound.push(event.data as LynxBackgroundInboundMessage);
		});
		main.markFirstScreenSyncReady();

		const background = renderLynxFirstScreen(RowKeyFeedScene, { itemKey: 'row-9' });
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'commit',
				batch: background.batch,
			},
		});

		expect(inbound.find((message) => message.type === 'ack')).toMatchObject({
			type: 'ack',
			adoption: 'repaired',
		});
		expect(dom.window.document.querySelector('#feed')).not.toBe(paintedList);
		expect(main.diagnostics()).toEqual([
			expect.objectContaining({ code: 'OCTANE_LYNX_FIRST_SCREEN_MISMATCH' }),
		]);
	});

	it('repairs when the platform materialized a row between capture and adoption', () => {
		// A cell created after capture is physical state the captured tree does not
		// describe. Adoption re-reads the list's recycling counters and repairs
		// rather than adopting a picture that has moved on.
		const { dom, main } = installEnvironment();
		firstScreenRoot.render(FeedScene, {});
		const paintedList = dom.window.document.querySelector('#feed');
		const inbound: LynxBackgroundInboundMessage[] = [];
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			inbound.push(event.data as LynxBackgroundInboundMessage);
		});
		main.markFirstScreenSyncReady();
		globalThis.elementTree.enterListItemAtIndex(paintedList as never, 0);

		const background = renderLynxFirstScreen(FeedScene, {});
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'commit',
				batch: background.batch,
			},
		});

		expect(inbound.find((message) => message.type === 'ack')).toMatchObject({
			type: 'ack',
			adoption: 'repaired',
		});
		expect(main.diagnostics()).toEqual([
			expect.objectContaining({
				code: 'OCTANE_LYNX_FIRST_SCREEN_MISMATCH',
				path: 'snapshot.lists[2].epoch',
			}),
		]);
	});

	it('paints a native list whose rows come from a keyed loop', () => {
		// Rows reach a `<list>` through `@for` in every real page, which puts a
		// range between the list and each `<list-item>`. Capture reads records
		// rather than the record tree, so ranges never reach it — but a fixture
		// that only ever nested rows directly under the list would not prove that.
		const { dom, main } = installEnvironment();

		expect(
			firstScreenRoot.render(KeyedFeedScene, {
				rows: [
					['k0', 'row-0'],
					['k1', 'row-1'],
					['k2', 'row-2'],
				],
			}),
		).not.toBeNull();

		const list = dom.window.document.querySelector('#feed');
		expect(dom.window.document.querySelector('#feed-shell')).not.toBeNull();
		expect(list).not.toBeNull();
		expect(list!.children).toHaveLength(0);
		expect(main.firstScreenSnapshot()).toMatchObject({ root: 1, version: 1 });
		expect(main.diagnostics()).toEqual([]);
	});

	it('still reports a duplicated item-key a keyed loop produced', () => {
		// Painting a list must not cost a diagnostic the staged apply owns: a
		// duplicate `item-key` is rejected where it has always been rejected.
		const { main } = installEnvironment();

		expect(() =>
			firstScreenRoot.render(KeyedFeedScene, {
				rows: [
					['k0', 'row-0'],
					['k1', 'row-1'],
					['k2', 'row-0'],
				],
			}),
		).toThrow(/item-key "row-0" is duplicated in one <list>/);
		expect(main.firstScreenSnapshot()).toBeNull();
	});

	it('paints a native list the compiler lowered to a template', () => {
		// A template-created `<list>` still records as an ordinary `list` host,
		// which is what lets capture treat it like any other painted node while
		// leaving its rows logical.
		const { dom, main } = installEnvironment();

		expect(
			firstScreenRoot.render(TemplateFeedScene, {
				rows: [
					['k0', 'row-0'],
					['k1', 'row-1'],
				],
			}),
		).not.toBeNull();

		const list = dom.window.document.querySelector('#feed');
		expect(list).not.toBeNull();
		expect(list!.children).toHaveLength(0);
		expect(main.firstScreenSnapshot()).toMatchObject({ root: 1, version: 1 });
		expect(main.diagnostics()).toEqual([]);
	});

	it('still reports a duplicated item-key under a template-lowered list', () => {
		const { main } = installEnvironment();

		expect(() =>
			firstScreenRoot.render(TemplateFeedScene, {
				rows: [
					['k0', 'row-0'],
					['k1', 'row-0'],
				],
			}),
		).toThrow(/item-key "row-0" is duplicated in one <list>/);
		expect(main.firstScreenSnapshot()).toBeNull();
	});

	// Painting a list must not cost a diagnostic. Each of these is a list defect
	// the staged apply reports, and each has to keep being reported from where it
	// is reported today rather than settling as a quiet `skipped`.
	it('still reports a nested native list rather than declining it silently', () => {
		const { main } = installEnvironment();

		expect(() => firstScreenRoot.render(NestedFeedScene, {})).toThrow(
			/nested <list> hosts are not supported/,
		);
		expect(main.firstScreenSnapshot()).toBeNull();
	});

	it('still reports a non-list-item child of a list rather than declining it silently', () => {
		const { main } = installEnvironment();

		expect(() => firstScreenRoot.render(ListChildScene, {})).toThrow(
			/<list> child \d+ must be a <list-item>/,
		);
		expect(main.firstScreenSnapshot()).toBeNull();
	});

	it('still reports a duplicated item-key rather than declining it silently', () => {
		const { main } = installEnvironment();

		expect(() => firstScreenRoot.render(DuplicateRowScene, {})).toThrow(
			/item-key "row-0" is duplicated in one <list>/,
		);
		expect(main.firstScreenSnapshot()).toBeNull();
	});

	it('still reports a list item outside a list rather than declining it silently', () => {
		const { main } = installEnvironment();

		expect(() => firstScreenRoot.render(StrayRowScene, {})).toThrow(
			/must be placed directly under a <list>/,
		);
		expect(main.firstScreenSnapshot()).toBeNull();
	});

	it('still reports a main-thread event collision rather than declining it silently', () => {
		// The colliding host sits beside a valid list, so the pre-check's skip
		// verdict is otherwise settled — the prepare walk that raises this
		// diagnostic on the staged path would never run.
		const { dom, main } = installEnvironment();

		expect(() => firstScreenRoot.render(CollidingFeedScene, {})).toThrow(
			/conflicts with background event/,
		);
		expect(main.firstScreenSnapshot()).toBeNull();
		// Reported before anything was painted, which is the part that makes this
		// the same refusal the staged path gives: a page the applier declines
		// leaves no half-built tree behind for the platform to show.
		expect(dom.window.document.querySelectorAll('view')).toHaveLength(0);
	});

	it('still reports a duplicated main-thread ref rather than declining it silently', () => {
		const { dom, main } = installEnvironment();

		expect(() => firstScreenRoot.render(DuplicateRefFeedScene, {})).toThrow(
			/is assigned to hosts \d+ and \d+/,
		);
		expect(main.firstScreenSnapshot()).toBeNull();
		expect(dom.window.document.querySelectorAll('view')).toHaveLength(0);
	});

	it('reports a duplicated main-thread ref carried by two rows of one native list', () => {
		// Rows own no element until the platform asks for a cell, so neither ref is
		// ever installed during the first screen and a mid-walk check would see
		// nothing wrong. The staged path refuses this page from its record set, so
		// this one owes the same refusal.
		const { dom, main } = installEnvironment();

		expect(() => firstScreenRoot.render(DuplicateRefRowScene, {})).toThrow(
			/is assigned to hosts \d+ and \d+/,
		);
		expect(main.firstScreenSnapshot()).toBeNull();
		expect(dom.window.document.querySelectorAll('list')).toHaveLength(0);
	});

	it('still reports a host that cannot build a list rather than declining it silently', () => {
		// Without the list PAPI pair a `<list>` cannot be built at all. That is a
		// fact about the host, not a page to skip quietly, so the tree keeps going
		// and fails where it fails today.
		const { main } = installEnvironment((target) => {
			delete target.__CreateList;
			delete target.__UpdateListCallbacks;
		});

		expect(() => firstScreenRoot.render(FeedScene, {})).toThrow(
			/requires __CreateList and __UpdateListCallbacks/,
		);
		expect(main.firstScreenSnapshot()).toBeNull();
	});

	it('retains a failed pre-capture source and retries cleanup for background readiness', () => {
		const captureFailure = new Error('capture unique ID failed');
		let uniqueIdCalls = 0;
		let removalFailures = 0;
		const { dom, main } = installEnvironment((target) => {
			const getUniqueId = target.__GetElementUniqueID as (node: object) => number;
			target.__GetElementUniqueID = (node: object) => {
				if (++uniqueIdCalls === 2) throw captureFailure;
				return getUniqueId(node);
			};
			const remove = target.__RemoveElement as (parent: object, child: object) => unknown;
			target.__RemoveElement = (parent: object, child: object) => {
				if (removalFailures++ < 6) throw new Error('transient failed-source remove failure');
				return remove(parent, child);
			};
		});
		const inbound: LynxBackgroundInboundMessage[] = [];
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			inbound.push(event.data as LynxBackgroundInboundMessage);
		});

		expect(() => firstScreenRoot.render(MainSingleHost, { id: 'failed-capture' })).toThrow(
			captureFailure,
		);
		expect(dom.window.document.querySelector('#failed-capture')).not.toBeNull();
		expect(main.firstScreenSnapshot()).toBeNull();
		expect(inbound).toEqual([]);

		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'main-ready-request',
				request: 41,
			},
		});
		expect(dom.window.document.querySelector('#failed-capture')).not.toBeNull();
		expect(inbound).toEqual([]);

		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'main-ready-request',
				request: 42,
			},
		});

		expect(dom.window.document.querySelector('#failed-capture')).toBeNull();
		expect(inbound).toEqual([
			expect.objectContaining({ type: 'main-ready', request: 41 }),
			expect.objectContaining({ type: 'main-ready', request: 42 }),
		]);
	});

	it('withholds terminal dispose acknowledgement until first-tree cleanup succeeds', () => {
		let removalFailures = 0;
		const { dom, main } = installEnvironment((target) => {
			const remove = target.__RemoveElement as (parent: object, child: object) => unknown;
			target.__RemoveElement = (parent: object, child: object) => {
				if (removalFailures++ < 3) throw new Error('transient terminal remove failure');
				return remove(parent, child);
			};
		});
		const inbound: LynxBackgroundInboundMessage[] = [];
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			inbound.push(event.data as LynxBackgroundInboundMessage);
		});
		firstScreenRoot.render(MainSingleHost, { id: 'terminal-retry' });
		const dispose = {
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			root: 1,
			version: 1,
			type: 'terminal-dispose' as const,
		};

		backgroundContext().dispatchEvent({ type: LYNX_BACKGROUND_TO_MAIN_EVENT, data: dispose });
		expect(inbound.at(-1)).toMatchObject({ type: 'dispose-retry', root: 1, version: 1 });
		expect(dom.window.document.querySelector('#terminal-retry')).not.toBeNull();
		expect(main.firstScreenSnapshot()).not.toBeNull();

		backgroundContext().dispatchEvent({ type: LYNX_BACKGROUND_TO_MAIN_EVENT, data: dispose });
		expect(inbound.at(-1)).toMatchObject({ type: 'dispose-ack', root: 1, version: 1 });
		expect(dom.window.document.querySelector('#terminal-retry')).toBeNull();
		expect(main.firstScreenSnapshot()).toBeNull();
	});
});
