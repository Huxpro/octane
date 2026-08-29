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
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { createLynxRoot, type LynxRoot } from '../src/index.js';
import { root as firstScreenRoot } from '../src/first-screen.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import * as firstScreenRenderer from '../src/main-renderer.js';
import {
	defineUniversalComponent as defineFirstScreenComponent,
	firstScreenEvent,
	renderLynxFirstScreen,
	universalComponent as firstScreenComponent,
	universalFor as firstScreenFor,
	universalActivity as firstScreenActivity,
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
import { unwire, wire } from './_fixtures/lynx-wire.js';

interface SceneProps {
	readonly id: string;
	readonly items: readonly string[];
	readonly componentItems?: readonly string[];
	readonly rowPrefix?: string;
	readonly onRowTap?: (id: string, payload: unknown) => void;
	readonly onTap: (payload: unknown) => void;
	readonly onEffect: (owner: 'main' | 'background') => void;
}

interface EventRegistration {
	readonly node: object;
	readonly name: string;
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

const mainComponentRowPlan = firstScreenPlan('lynx', {
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

const MainComponentRow = defineFirstScreenComponent(
	'lynx',
	(props: { readonly id: string; readonly label: string }) =>
		firstScreenValue(mainComponentRowPlan, [props.id, props.label, firstScreenEvent]),
);

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
			props.componentItems === undefined
				? null
				: firstScreenFor(
						props.componentItems,
						(id) => id,
						(id) =>
							firstScreenComponent(
								'lynx',
								MainComponentRow,
								firstScreenProps([
									['set', 'id', id],
									['set', 'label', `${props.rowPrefix ?? 'label'}:${id}`],
								]),
							),
						null,
						false,
						false,
						undefined,
						undefined,
						undefined,
						true,
					),
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

/**
 * A row component the main-thread chunk has nothing compiled for.
 *
 * Deliberately not passed through `defineFirstScreenComponent`, which is what
 * the bundle split makes ordinary rather than exotic: the logic half of a page
 * is compiled into the background chunk, so a component that only ever renders
 * there carries no main-thread identity at all. Reaching one while painting is
 * the edge of what this renderer can do, not a mistake in the page.
 */
const RefusedRow = ((props: { readonly id: string }) =>
	firstScreenValue(mainPlan, [firstScreenProps([['set', 'id', props.id]])])) as UniversalComponent<{
	readonly id: string;
}>;

/** A page whose keyed rows are that component. */
const RefusedRowScene = defineFirstScreenComponent(
	'lynx',
	(props: { readonly rows: readonly string[] }) =>
		firstScreenValue(mainScenePlan, [
			firstScreenProps([['set', 'id', 'refused-feed']]),
			firstScreenFor(
				props.rows,
				(row) => row,
				(row) => firstScreenComponent('lynx', RefusedRow, { id: row }),
				null,
				true,
				true,
			),
		]),
);

/** The same page as the background renders it, which is where those rows live. */
const BackgroundRefusedRow = defineUniversalComponent('lynx', (props: { readonly id: string }) =>
	universalValue(backgroundPlan, [universalProps([['set', 'id', props.id]])]),
);

const BackgroundRefusedRowScene = defineUniversalComponent(
	'lynx',
	(props: { readonly rows: readonly string[] }) =>
		universalValue(backgroundScenePlan, [
			universalProps([['set', 'id', 'refused-feed']]),
			universalFor(
				props.rows,
				(row) => row,
				(row) =>
					universalComponent('lynx', BackgroundRefusedRow, universalProps([['set', 'id', row]])),
			),
		]),
);

/**
 * A row compiled, but for somebody else's renderer.
 *
 * The other half of the same sentence: this renderer has nothing compiled for
 * this component either. `defineUniversalComponent` here is the background's,
 * because the main renderer's own refuses to mark a component for a renderer it
 * cannot evaluate — which is the point.
 */
const ForeignRow = defineUniversalComponent('dom', (props: { readonly id: string }) =>
	universalValue(backgroundPlan, [universalProps([['set', 'id', props.id]])]),
) as unknown as UniversalComponent<{ readonly id: string }>;

const ForeignRowScene = defineFirstScreenComponent(
	'lynx',
	(props: { readonly rows: readonly string[] }) =>
		firstScreenValue(mainScenePlan, [
			firstScreenProps([['set', 'id', 'foreign-feed']]),
			firstScreenFor(
				props.rows,
				(row) => row,
				(row) => firstScreenComponent('lynx', ForeignRow, { id: row }),
				null,
				true,
				true,
			),
		]),
);

/**
 * A page the *applier* cannot finish, rather than one the renderer cannot
 * render.
 *
 * A compiled main-thread program marks its hidden hosts with an attribute
 * unless they are raw text, and which of a program's nodes are raw text is
 * exactly what the program stopped carrying — so the mount refuses a hidden one
 * rather than guessing. `bind` is deliberately a trap: the refusal happens
 * before the program is ever bound, and a test that passed by running it would
 * be testing something else.
 *
 * The sibling in front of it is the point, and it is the reason the plan sits
 * second rather than alone. It is the node the applier would have painted first
 * if a refusal were raised where the mount meets it, so a page that ends with
 * nothing created is evidence the refusal was decided before the walk began
 * rather than evidence there was nothing to paint.
 */
const refusedProgramPlan = firstScreenPlan('lynx', {
	kind: 'program',
	slots: [],
	nodes: 1,
	values: [],
	events: [],
	ranges: [],
	bind: () => () => {
		throw new Error('a refused program is never bound');
	},
});

const HiddenProgramScene = defineFirstScreenComponent('lynx', () => [
	firstScreenValue(mainPlan, [firstScreenProps([['set', 'id', 'painted-before']])]),
	firstScreenActivity('hidden', () => firstScreenValue(refusedProgramPlan, [])),
]);

/** A page whose setup faults, which is the opposite case and must stay one. */
const FaultingScene = defineFirstScreenComponent('lynx', (): never => {
	throw new Error('scene setup blew up');
});

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
		readonly onTap: (id: string, payload: unknown) => void;
	}) => universalValue(postAdoptionRowPlan, [id, label, (payload: unknown) => onTap(id, payload)]),
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
						null,
						false,
						false,
						undefined,
						undefined,
						undefined,
						true,
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
		registrations.push(Object.freeze({ node, name, listener }));
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
			inbound.push(unwire(event.data) as LynxBackgroundInboundMessage);
		});
		mainContext().addEventListener(LYNX_BACKGROUND_TO_MAIN_EVENT, (event) => {
			outbound.push(unwire(event.data) as LynxBackgroundOutboundMessage);
		});
		const effects: string[] = [];
		const events: unknown[] = [];
		const initialRowEvents: Array<readonly [string, unknown]> = [];
		const initialComponentItems = ['initial-a', 'initial-b'];
		let placeholderToken: string | undefined;
		let initialRowToken: string | undefined;
		const props: SceneProps = {
			id: 'first-screen',
			items: ['a', 'b'],
			componentItems: initialComponentItems,
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
			onRowTap(id, payload) {
				initialRowEvents.push([id, payload]);
				if (
					(payload as { detail?: { phase?: unknown } }).detail?.phase === 'first' &&
					initialRowToken !== undefined
				) {
					main.dispatchNativeEvent(initialRowToken, {
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
		const firstInitialA = dom.window.document.querySelector('#initial-a');
		const firstInitialB = dom.window.document.querySelector('#initial-b');
		expect(painted).toMatchObject({ hostCount: 9, logicalCount: 15 });
		expect(firstNode).not.toBeNull();
		expect(firstA).not.toBeNull();
		expect(firstB).not.toBeNull();
		expect(firstInitialA?.textContent).toBe('label:initial-a');
		expect(firstInitialB?.textContent).toBe('label:initial-b');
		expect(effects).toEqual([]);
		expect(main.firstScreenSnapshot()).toMatchObject({ root: 1, version: 1 });

		placeholderToken = registrations.find(
			(registration) => registration.name === 'tap' && registration.node === firstNode,
		)?.listener;
		initialRowToken = registrations.find(
			(registration) =>
				registration.name === 'tap' &&
				firstInitialA?.contains(registration.node as unknown as Node) === true,
		)?.listener;
		expect(placeholderToken).toBeTypeOf('string');
		expect(initialRowToken).toBeTypeOf('string');
		main.dispatchNativeEvent(placeholderToken!, { type: 'tap', detail: { phase: 'first' } });
		main.dispatchNativeEvent(initialRowToken!, { type: 'tap', detail: { phase: 'first' } });

		globalThis.lynxTestingEnv.switchToBackgroundThread();
		const context = backgroundContext();
		const originalDispatch = context.dispatchEvent;
		// Restored when this test ends, however it ends. The context object outlives
		// the environment install around it, so a patch left on it is a patch every
		// later test in this file inherits — which is a test failing in a file it
		// does not appear in.
		onTestFinished(() => {
			context.dispatchEvent = originalDispatch;
		});
		const dispatch = originalDispatch.bind(context);
		const clonedRuns: boolean[] = [];
		context.dispatchEvent = (event) => {
			const data = deserialize(serialize(unwire(event.data))) as unknown;
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
			// Re-dispatch what was actually sent. The observation above is a
			// read of the wire, not a rewrite of it: handing the decoded object
			// back would put a live composite on a channel that now carries text.
			return dispatch(event);
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
		expect(initialRowEvents).toEqual([]);

		globalThis.lynxTestingEnv.switchToMainThread();
		main.markFirstScreenSyncReady();
		globalThis.lynxTestingEnv.switchToBackgroundThread();
		await rendering;

		expect(dom.window.document.querySelector('#first-screen')).toBe(firstNode);
		expect(dom.window.document.querySelector('#a')).toBe(firstA);
		expect(dom.window.document.querySelector('#b')).toBe(firstB);
		expect(dom.window.document.querySelector('#initial-a')).toBe(firstInitialA);
		expect(dom.window.document.querySelector('#initial-b')).toBe(firstInitialB);
		expect(effects).toEqual(['background']);
		expect(main.diagnostics()).toEqual([]);
		expect(events).toEqual([
			{ type: 'tap', detail: { phase: 'first' } },
			{ type: 'tap', detail: { phase: 'reentrant' } },
		]);
		expect(initialRowEvents).toEqual([
			['initial-a', { type: 'tap', detail: { phase: 'first' } }],
			['initial-a', { type: 'tap', detail: { phase: 'reentrant' } }],
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

		await backgroundRoot.render(BackgroundScene, {
			...props,
			componentItems: [],
		});
		expect(dom.window.document.querySelector('#initial-a')).toBeNull();
		expect(dom.window.document.querySelector('#initial-b')).toBeNull();

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
			inbound.push(unwire(event.data) as LynxBackgroundInboundMessage);
		});
		main.markFirstScreenSyncReady();

		const replacement = renderLynxFirstScreen(MainScene, {
			...props,
			id: 'background-value',
		});
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: wire({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'commit',
				batch: replacement.batch,
			}),
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
			const message = unwire(event.data) as LynxBackgroundInboundMessage;
			inbound.push(message);
			if (message.type !== 'ack' || message.version !== 1 || queuedSecondCommit) return;
			queuedSecondCommit = true;
			backgroundContext().dispatchEvent({
				type: LYNX_BACKGROUND_TO_MAIN_EVENT,
				data: wire({
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
				}),
			});
		});
		main.markFirstScreenSyncReady();

		const initial = renderLynxFirstScreen(MainSingleHost, { id: 'first-screen' });
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: wire({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'commit',
				batch: initial.batch,
			}),
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
			data: wire({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'adoption-ready',
			}),
		});

		expect(main.firstScreenSnapshot()).toBeNull();
		expect(main.activeIdentity()).toMatchObject({ root: 1, version: 2 });
		expect(main.diagnostics()).toEqual([]);
	});

	it('can seal an entry with no first-screen render and unblock background readiness', () => {
		const { main } = installEnvironment();
		const inbound: LynxBackgroundInboundMessage[] = [];
		mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
			inbound.push(unwire(event.data) as LynxBackgroundInboundMessage);
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
			inbound.push(unwire(event.data) as LynxBackgroundInboundMessage);
		});
		firstScreenRoot.render(MainSingleHost, { id: 'cleanup-retry' });

		await firstScreenRoot.unmount();
		expect(dom.window.document.querySelector('#cleanup-retry')).not.toBeNull();
		// Cleanup that cannot finish leaves the captured tree in hand, and what it
		// answers with is that tree — not what the retrying teardown has left of
		// the container behind it.
		expect(main.firstScreenSnapshot()).toMatchObject({
			root: 1,
			version: 1,
			roots: [1],
			nodes: [
				expect.objectContaining({
					id: 1,
					type: 'view',
					parent: null,
					props: { id: 'cleanup-retry' },
					visible: true,
				}),
			],
		});
		expect(inbound).toEqual([]);

		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: wire({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'main-ready-request',
				request: 43,
			}),
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
			inbound.push(unwire(event.data) as LynxBackgroundInboundMessage);
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
			data: wire({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'main-ready-request',
				request: 51,
			}),
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
			inbound.push(unwire(event.data) as LynxBackgroundInboundMessage);
		});
		main.markFirstScreenSyncReady();

		const background = renderLynxFirstScreen(FeedScene, {});
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: wire({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'commit',
				batch: background.batch,
			}),
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
			inbound.push(unwire(event.data) as LynxBackgroundInboundMessage);
		});
		main.markFirstScreenSyncReady();

		const background = renderLynxFirstScreen(EmptyFeedScene, {});
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: wire({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'commit',
				batch: background.batch,
			}),
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
			inbound.push(unwire(event.data) as LynxBackgroundInboundMessage);
		});
		main.markFirstScreenSyncReady();

		const background = renderLynxFirstScreen(RowKeyFeedScene, { itemKey: 'row-9' });
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: wire({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'commit',
				batch: background.batch,
			}),
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
			inbound.push(unwire(event.data) as LynxBackgroundInboundMessage);
		});
		main.markFirstScreenSyncReady();
		globalThis.elementTree.enterListItemAtIndex(paintedList as never, 0);

		const background = renderLynxFirstScreen(FeedScene, {});
		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: wire({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'commit',
				batch: background.batch,
			}),
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

	// The other side of that boundary (issue #163 C3). Everything above is a
	// *defect*: a page that is wrong, which the first screen owes an error for
	// however cheap a quiet skip would be. What follows is a page that is right
	// and holds a shape this renderer cannot paint, which owes the opposite.
	it('declines a page whose rows are a component it has nothing compiled for', async () => {
		const { dom, main } = installEnvironment();

		// Not a throw, and not a painted page either: the attempt settles as
		// `skipped`, which is what leaves the background free to render the page
		// the ordinary way.
		const declined = firstScreenRoot.render(RefusedRowScene, { rows: ['row-a', 'row-b'] });
		expect(declined).toBeNull();
		expect(main.firstScreenSnapshot()).toBeNull();
		expect(dom.window.document.querySelectorAll('view')).toHaveLength(0);
		// Declined, not swallowed. A launch that quietly stopped painting its
		// first screen is a cliff with nothing red at the top of it, so the
		// reason is a diagnostic and it names what ended the attempt.
		expect(main.diagnostics()).toEqual([
			expect.objectContaining({
				code: 'OCTANE_LYNX_FIRST_SCREEN_REFUSED',
				message: 'Lynx first-screen rendering requires a compiled Lynx component.',
			}),
		]);

		// And the fallback actually delivers. This root is installed with
		// `firstScreenSync: 'manual'`, so a background render blocks until the
		// main thread says the window is closed — nothing below marks it, because
		// retiring the refused attempt is what releases it.
		globalThis.lynxTestingEnv.switchToBackgroundThread();
		backgroundRoot = createLynxRoot();
		await backgroundRoot.render(BackgroundRefusedRowScene, { rows: ['row-a', 'row-b'] });

		expect(dom.window.document.querySelector('#refused-feed')).not.toBeNull();
		expect(dom.window.document.querySelector('#row-a')).not.toBeNull();
		expect(dom.window.document.querySelector('#row-b')).not.toBeNull();
	});

	it("declines a page whose rows are compiled for somebody else's renderer", () => {
		// The same sentence, its other half. A component carrying another
		// renderer's identity is no more paintable here than one carrying none,
		// and this renderer cannot see whether the background will do better —
		// so it answers the only question it can, and says which page it was.
		const { main } = installEnvironment();

		expect(firstScreenRoot.render(ForeignRowScene, { rows: ['row-a'] })).toBeNull();
		expect(main.firstScreenSnapshot()).toBeNull();
		expect(main.diagnostics()).toEqual([
			expect.objectContaining({ code: 'OCTANE_LYNX_FIRST_SCREEN_REFUSED' }),
		]);
	});

	it('declines when the root itself is a component it has nothing compiled for', () => {
		// The root is the same question asked one level up, and it is worth asking
		// separately: `root.render()` checks the component it was handed before
		// any tree exists, on its own line, and a page that never starts is the
		// most complete version of the loss this slice removes.
		const { main } = installEnvironment();

		expect(firstScreenRoot.render(ForeignRow, { id: 'root-row' })).toBeNull();
		expect(main.firstScreenSnapshot()).toBeNull();
		expect(main.diagnostics()).toEqual([
			expect.objectContaining({
				code: 'OCTANE_LYNX_FIRST_SCREEN_REFUSED',
				message: 'Lynx first-screen root.render() requires a compiled Lynx component.',
			}),
		]);
	});

	it('declines a page the applier cannot finish, before it has created anything', () => {
		// The same boundary from the other side. Here the renderer produced a tree
		// perfectly well and the *mount* is what cannot finish it, which is the
		// shape #163's C2d slice left behind by name. The page is well formed and
		// the background paints it over the command path, so it costs the first
		// screen rather than the launch.
		const removed: object[] = [];
		const created: object[] = [];
		const { dom, main } = installEnvironment((target) => {
			const create = target.__CreateElement as (...args: unknown[]) => object;
			target.__CreateElement = (...args: unknown[]) => {
				const node = create.apply(target, args);
				created.push(node);
				return node;
			};
			const remove = target.__RemoveElement as (...args: unknown[]) => unknown;
			target.__RemoveElement = (...args: unknown[]) => {
				removed.push(args[1] as object);
				return remove.apply(target, args);
			};
		});

		expect(firstScreenRoot.render(HiddenProgramScene, {})).toBeNull();
		expect(main.firstScreenSnapshot()).toBeNull();
		expect(main.diagnostics()).toEqual([
			expect.objectContaining({
				code: 'OCTANE_LYNX_FIRST_SCREEN_REFUSED',
				message: expect.stringMatching(/cannot yet mount a hidden compiled main-thread program/),
			}),
		]);
		// And the part this asserts beyond the decline: the page costs zero PAPI
		// calls, not merely zero surviving nodes. The direct applier has no
		// prepare stage to refuse from, so it decides every refusal in a pre-walk
		// ahead of the paint — which is what lets a declined page be indistinct
		// from one that was never attempted, instead of one built and torn down.
		//
		// `#painted-before` is what makes that a claim rather than a tautology: it
		// is the sibling *in front of* the refused program, so a refusal raised
		// where the mount meets the program would have created it first. Nothing
		// created at all is the pre-walk, and nothing else.
		expect(created).toEqual([]);
		expect(removed).toEqual([]);
		expect(dom.window.document.querySelector('#painted-before')).toBeNull();
		expect(dom.window.document.querySelectorAll('view')).toHaveLength(0);
	});

	it('still faults when the page itself throws, rather than declining it', () => {
		// The control that keeps the branch above narrow. Application setup throws
		// from inside the same render pass, and every reason to decline a refusal
		// argues the other way here: nothing about the command path makes a page
		// whose setup failed render correctly, so the launch owes the error.
		const { main } = installEnvironment();

		expect(() => firstScreenRoot.render(FaultingScene, {})).toThrow(/scene setup blew up/);
		expect(main.firstScreenSnapshot()).toBeNull();
		expect(main.diagnostics()).toEqual([
			expect.objectContaining({ message: 'scene setup blew up' }),
		]);
		expect(main.diagnostics()[0]).not.toHaveProperty('code', 'OCTANE_LYNX_FIRST_SCREEN_REFUSED');
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

	it('declines a program-bearing first screen the direct applier cannot finish', () => {
		// The staged batch path cannot carry a compiled main-thread program —
		// reading `batch` on such a result throws by design — so when the direct
		// applier refuses to start the tree (here: a `<list>` on a host with no
		// list PAPI), the whole first screen declines to the command path instead
		// of crashing into the batch fallback with an error naming the wrong
		// problem.
		const { dom, main } = installEnvironment((target) => {
			delete target.__CreateList;
			delete target.__UpdateListCallbacks;
		});
		const programPlan = firstScreenPlan('lynx', {
			kind: 'program',
			slots: [],
			nodes: 1,
			values: [],
			events: [],
			ranges: [],
			bind: () => () => [],
		} as never);
		const ProgramBesideList = defineFirstScreenComponent('lynx', () => [
			firstScreenValue(programPlan, []),
			firstScreenValue(emptyFeedPlan, ['feed-shell', 'feed']),
		]);

		expect(firstScreenRoot.render(ProgramBesideList, {})).toBeNull();
		expect(main.firstScreenSnapshot()).toBeNull();
		// Declined before anything was painted: no half-built tree stays behind.
		expect(dom.window.document.querySelectorAll('view')).toHaveLength(0);
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
			inbound.push(unwire(event.data) as LynxBackgroundInboundMessage);
		});

		expect(() => firstScreenRoot.render(MainSingleHost, { id: 'failed-capture' })).toThrow(
			captureFailure,
		);
		expect(dom.window.document.querySelector('#failed-capture')).not.toBeNull();
		expect(main.firstScreenSnapshot()).toBeNull();
		expect(inbound).toEqual([]);

		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: wire({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'main-ready-request',
				request: 41,
			}),
		});
		expect(dom.window.document.querySelector('#failed-capture')).not.toBeNull();
		expect(inbound).toEqual([]);

		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: wire({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'main-ready-request',
				request: 42,
			}),
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
			inbound.push(unwire(event.data) as LynxBackgroundInboundMessage);
		});
		firstScreenRoot.render(MainSingleHost, { id: 'terminal-retry' });
		const dispose = {
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			root: 1,
			version: 1,
			type: 'terminal-dispose' as const,
		};

		backgroundContext().dispatchEvent({ type: LYNX_BACKGROUND_TO_MAIN_EVENT, data: wire(dispose) });
		expect(inbound.at(-1)).toMatchObject({ type: 'dispose-retry', root: 1, version: 1 });
		expect(dom.window.document.querySelector('#terminal-retry')).not.toBeNull();
		expect(main.firstScreenSnapshot()).not.toBeNull();

		backgroundContext().dispatchEvent({ type: LYNX_BACKGROUND_TO_MAIN_EVENT, data: wire(dispose) });
		expect(inbound.at(-1)).toMatchObject({ type: 'dispose-ack', root: 1, version: 1 });
		expect(dom.window.document.querySelector('#terminal-retry')).toBeNull();
		expect(main.firstScreenSnapshot()).toBeNull();
	});
});
