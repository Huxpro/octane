// Issue #87: the pair production ships had no committed runtime coverage.
//
// The `lynx` vitest project compiles its fixtures with the *background* preset
// (`lynxRspeedyRenderers` → `target: 'universal'`), so no committed test ever
// executed `target: 'lynx'` output — while the real Rspeedy main-thread bundle
// carries exactly the L1 slot-kind table and create-function locals. L1 (#63)
// and L3 (#65) were each covered alone: the compile-output differential never
// reached `host-driver.ts`, and the applier differential never saw a
// template-encoded plan.
//
// This closes that: one fixture, compiled at both targets, rendered, and then
// applied through both appliers — four cells over the same fake Element PAPI.
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compiler/compile.js';
import { lynxMainThreadRenderer } from '../../lynx/src/config.js';
import * as MainRenderer from '../../lynx/src/main-renderer.js';
import {
	applyLynxFirstScreenDirect,
	captureLynxFirstTree,
	createLynxHostContainer,
	prepareLynxHostBatch,
} from '../../lynx/src/core/host-driver.js';
import { LYNX_FIRST_TREE_STATE } from '../../lynx/src/core/first-screen.js';
import { createFakePAPI, shape } from '../../lynx/tests/_fixtures/fake-element-papi.js';

const SOURCE = `import { useCallback, useState } from 'octane';

function Row(props: { label: string; active: boolean; onPick: () => void }) @{
	<view class={props.active ? 'row active' : 'row'}>
		<text class="label" bindtap={props.onPick}>{props.label as string}</text>
	</view>
}

export function Scene() @{
	const [count, setCount] = useState(0);
	const pick = useCallback(() => setCount((value) => value + 1), []);
	const items = [
		{ id: 'a', label: 'alpha', active: true },
		{ id: 'b', label: 'beta', active: false },
		{ id: 'c', label: 'gamma', active: true },
	];
	<view class="page">
		<text class="title">{'Fixture · ' + String(count)}</text>
		@if (count === 0) {
			<text class="hint">tap a row</text>
		} @else {
			<text class="hint">picked</text>
		}
		<view class="rows">
			@for (const item of items; key item.id) {
				<Row label={item.label} active={item.active} onPick={pick} />
			}
		</view>
	</view>
}
`;

type SceneComponent = Parameters<typeof MainRenderer.renderLynxFirstScreen>[0];

function compileAt(source: string, filename: string, target: 'lynx' | 'universal'): string {
	return compile(source, filename, {
		hmr: false,
		renderer: { ...lynxMainThreadRenderer, target, id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread: 'main-thread' },
	}).code;
}

function compiled(target: 'lynx' | 'universal'): string {
	return compileAt(SOURCE, '/src/Scene.lynx.tsrx', target);
}

function componentFor(compiledCode: string, exportName: string): SceneComponent {
	const rewritten = compiledCode
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx\/main-renderer["'];/g,
			(_match, specifiers: string) =>
				`const {${specifiers.replace(/\s+as\s+/g, ': ')}} = __universal;`,
		)
		.replace(/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx\/main-worklets["'];/g, '')
		.replace(`export const ${exportName} =`, `const ${exportName} =`);
	return new Function('__universal', `${rewritten}\nreturn ${exportName};`)(
		MainRenderer,
	) as SceneComponent;
}

function sceneFor(target: 'lynx' | 'universal'): SceneComponent {
	return componentFor(compiled(target), 'Scene');
}

interface Cell {
	readonly tree: unknown;
	readonly snapshot: unknown;
	readonly hostCount: number;
}

function paint(target: 'lynx' | 'universal', applier: 'direct' | 'staged'): Cell {
	const result = MainRenderer.renderLynxFirstScreen(sceneFor(target), {});
	const papi = createFakePAPI();
	const container = createLynxHostContainer(papi, { root: 1 });
	if (applier === 'direct') {
		expect(applyLynxFirstScreenDirect(container, result.nodes, result.envelope)).toBe(true);
	} else {
		prepareLynxHostBatch(container, result.batch).apply();
	}
	const captured = captureLynxFirstTree(container);
	expect(captured).not.toBeNull();
	return {
		tree: shape(papi.pages[0]!),
		snapshot: captured!.snapshot,
		hostCount: result.batch.commands.length,
	};
}

describe('lynx-target first screen, end to end', () => {
	it('compiles the fixture to the create-function encoding', () => {
		// Guards the premise. If eligibility ever rejected this shape the cells
		// below would compare `universal` against itself and prove nothing, so
		// the two encodings are asserted to actually differ here.
		const lynx = compiled('lynx');
		const universal = compiled('universal');
		expect(lynx).toContain('"kind": "template"');
		expect(lynx).toContain('"slots"');
		expect(lynx).toMatch(/\bn0\b/);
		expect(universal).not.toContain('"kind": "template"');
		// The keyed `@for` body root is a component, so that hole stays a plan:
		// the fixture exercises a module that mixes both encodings, which is what
		// production modules look like.
		expect(lynx).toContain('"kind": "slot"');
	});

	it('paints the same tree and adoption snapshot on all four cells', () => {
		const universalStaged = paint('universal', 'staged');
		const universalDirect = paint('universal', 'direct');
		const lynxStaged = paint('lynx', 'staged');
		const lynxDirect = paint('lynx', 'direct');

		// The encoding must not be observable: same target, either applier, and
		// either target through the same applier all land on one tree.
		expect(lynxStaged.tree).toEqual(universalStaged.tree);
		expect(lynxDirect.tree).toEqual(universalDirect.tree);
		expect(lynxDirect.tree).toEqual(lynxStaged.tree);

		// Adoption is what the background thread reads back, so it is the part
		// that must be byte-compatible across all four.
		expect(lynxStaged.snapshot).toEqual(universalStaged.snapshot);
		expect(lynxDirect.snapshot).toEqual(universalDirect.snapshot);
		expect(lynxDirect.snapshot).toEqual(lynxStaged.snapshot);

		// The batch itself stays identical across encodings, which is what #63
		// claimed and what the applier cells above consume.
		expect(lynxStaged.hostCount).toBe(universalStaged.hostCount);
	});
});

// A `<list>` is the one host the direct applier does not build with
// `__CreateElement`, and the one whose children never become its children: the
// platform materializes a row through `componentAtIndex` long after the paint.
// #66 C3 taught the direct applier to build one, and every test of that work
// feeds it a hand-authored plan object. None of them compiles a `.tsrx`, so the
// `<list>` the create-function encoding produces has never been painted.
//
// It is reachable: with no `ref` in the tree the whole root plan lowers, and the
// `<list>` element is constructed by `env.h('list')` inside the create function.
// One `ref` anywhere in the plan disqualifies the root, which is the shape the
// gallery example ships — so both are covered below.
const FEED_ROWS = `	const rows = [
		{ key: 'a', label: 'alpha' },
		{ key: 'b', label: 'beta' },
		{ key: 'c', label: 'gamma' },
	];
`;

// A sibling after the `<list>` on purpose: it is the node that would expose a
// creation order the staged path does not produce, because a list whose element
// were created after its subtree would hand this sibling the lower unique ID.
const FEED_SOURCE = `export function Feed() @{
${FEED_ROWS}	<view class="feed-shell">
		<list id="feed" list-type="single">
			@for (const row of rows; key row.key) {
				<list-item item-key={row.key} reuse-identifier="feed-row">
					<text class="row-label">{row.label as string}</text>
				</list-item>
			}
		</list>
		<text class="feed-footer">end</text>
	</view>
}
`;

// The gallery shape: a `ref` on the `<list>` keeps the root a plan while the
// rows still lower to create functions, so one module runs both encodings over
// the same list.
const HELD_SOURCE = `export function Held() @{
${FEED_ROWS}	const held: unknown[] = [];
	<view class="feed-shell">
		<list id="feed" ref={(handle) => { held.push(handle); }}>
			@for (const row of rows; key row.key) {
				<list-item item-key={row.key} reuse-identifier="feed-row">
					<text class="row-label">{row.label as string}</text>
				</list-item>
			}
		</list>
		<text class="feed-footer">end</text>
	</view>
}
`;

interface ListCell {
	readonly tree: unknown;
	readonly snapshot: unknown;
	readonly logicalNodes: unknown[];
	readonly lists: unknown[];
	readonly published: unknown;
	readonly materialized: unknown;
}

function paintList(
	source: string,
	exportName: string,
	target: 'lynx' | 'universal',
	applier: 'direct' | 'staged',
): ListCell {
	const component = componentFor(
		compileAt(source, `/src/${exportName}.lynx.tsrx`, target),
		exportName,
	);
	const result = MainRenderer.renderLynxFirstScreen(component, {});
	const papi = createFakePAPI({ list: true });
	const container = createLynxHostContainer(papi, { root: 1 });
	if (applier === 'direct') {
		expect(applyLynxFirstScreenDirect(container, result.nodes, result.envelope)).toBe(true);
	} else {
		prepareLynxHostBatch(container, result.batch).apply();
	}
	const captured = captureLynxFirstTree(container);
	expect(captured).not.toBeNull();
	const journal = captured![LYNX_FIRST_TREE_STATE];
	expect(papi.lists).toHaveLength(1);
	const list = papi.lists[0]!;
	// Read before the platform asks for anything, so this stays the first screen
	// rather than the first screen plus one cell.
	const tree = shape(papi.pages[0]!);
	// Driving the platform's own entry point is what proves the callbacks the
	// list was created with are live and pointed at this container. A row that
	// owns no element has to become one here, whichever encoding described it.
	const sign = list.componentAtIndex(list.node, papi.getUniqueId(list.node), 0, 0, false);
	expect(sign).toBeGreaterThan(0);
	return {
		tree,
		snapshot: captured!.snapshot,
		logicalNodes: [...journal.logicalNodes.values()],
		lists: [...journal.lists.values()],
		published: list.node.attributes['update-list-info'],
		materialized: shape(list.node.children[0]!),
	};
}

function expectSameAcrossCells(source: string, exportName: string): void {
	const universalStaged = paintList(source, exportName, 'universal', 'staged');
	const universalDirect = paintList(source, exportName, 'universal', 'direct');
	const lynxStaged = paintList(source, exportName, 'lynx', 'staged');
	const lynxDirect = paintList(source, exportName, 'lynx', 'direct');

	for (const [name, cell] of [
		['lynx+staged', lynxStaged],
		['lynx+direct', lynxDirect],
		['universal+direct', universalDirect],
	] as const) {
		// Named so a failure says which cell diverged rather than which line did.
		expect({ name, ...cell }).toEqual({ name, ...universalStaged });
	}
}

describe('lynx-target native list, end to end', () => {
	it('lowers the list element itself into the create function', () => {
		// Guards the premise of every cell below. If eligibility stopped lowering
		// a `<list>`, the lynx cells would run the same plan interpreter as the
		// universal ones and agree for a reason that proves nothing.
		const lynx = compileAt(FEED_SOURCE, '/src/Feed.lynx.tsrx', 'lynx');
		const universal = compileAt(FEED_SOURCE, '/src/Feed.lynx.tsrx', 'universal');
		expect(lynx).toContain('"kind": "template"');
		expect(lynx).toContain('.h("list")');
		expect(lynx).toContain('.h("list-item")');
		expect(universal).not.toContain('"kind": "template"');
		expect(universal).toContain('"type": "list"');
	});

	it('paints, publishes, and materializes the same list on all four cells', () => {
		expectSameAcrossCells(FEED_SOURCE, 'Feed');
	});

	it('keeps a ref-held list, whose root stays a plan, identical across encodings', () => {
		// The mixed module: one `ref` costs the root plan its lowering while the
		// rows keep theirs, so the list is interpreted and its cells are not.
		const lynx = compileAt(HELD_SOURCE, '/src/Held.lynx.tsrx', 'lynx');
		expect(lynx).toContain('.h("list-item")');
		expect(lynx).not.toContain('.h("list")');
		expect(lynx).toContain('"type": "list"');

		expectSameAcrossCells(HELD_SOURCE, 'Held');
	});
});
