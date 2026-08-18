// Issue-58 L3: the direct first-screen applier must leave a container that is
// indistinguishable from the staged batch path — same adoption snapshot
// (ids, native ids, props, events, visibility, roots), same physical tree,
// same event-token journal — so background adoption, mismatch repair, and
// buffered-event replay never observe which applier painted the first screen.
import { describe, expect, it } from 'vitest';

import {
	applyLynxFirstScreenDirect,
	captureLynxFirstTree,
	createLynxHostContainer,
	prepareLynxHostBatch,
} from '../src/core/host-driver.js';
import { LYNX_FIRST_TREE_STATE } from '../src/core/first-screen.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import {
	defineUniversalComponent,
	renderLynxFirstScreen,
	universalActivity,
	universalFor,
	universalPlan,
	universalValue,
} from '../src/main-renderer.js';

interface FakeNode {
	readonly uid: number;
	readonly type: string;
	parent: FakeNode | null;
	readonly children: FakeNode[];
	readonly attributes: Record<string, unknown>;
	classes: string;
	readonly events: Map<string, unknown>;
	selector: string;
	id: string | null;
	text: string;
}

function createFakePAPI(): LynxElementPAPI<FakeNode> & { readonly pages: FakeNode[] } {
	let nextUid = 1;
	const pages: FakeNode[] = [];
	const node = (type: string, text = ''): FakeNode => ({
		uid: nextUid++,
		type,
		parent: null,
		children: [],
		attributes: {},
		classes: '',
		events: new Map(),
		selector: '',
		id: null,
		text,
	});
	return {
		pages,
		createPage() {
			const page = node('page');
			pages.push(page);
			return page;
		},
		createElement(type, _parent, text) {
			return node(type === '#text' ? 'raw-text' : type, text);
		},
		getUniqueId(target) {
			return target.uid;
		},
		getParent(target) {
			return target.parent;
		},
		isEqual(first, second) {
			return first === second;
		},
		isChild(parent, child) {
			return child.parent === parent;
		},
		insertBefore(parent, child, before) {
			const index = before === null ? parent.children.length : parent.children.indexOf(before);
			parent.children.splice(index, 0, child);
			child.parent = parent;
		},
		remove(parent, child) {
			parent.children.splice(parent.children.indexOf(child), 1);
			child.parent = null;
		},
		replace() {
			throw new Error('unused');
		},
		setClasses(target, value) {
			target.classes = value;
		},
		setInlineStyles() {},
		setCssId() {},
		setAttribute(target, name, value) {
			if (name === 'text') target.text = String(value);
			else target.attributes[name] = value;
		},
		setRefSelector(target, value) {
			target.selector = value;
		},
		setDataset() {},
		setEvent(target, kind, name, listener) {
			if (listener === undefined) target.events.delete(`${kind}:${name}`);
			else target.events.set(`${kind}:${name}`, listener);
		},
		setId(target, value) {
			target.id = value;
		},
		flush() {},
	};
}

function shape(node: FakeNode): unknown {
	return {
		type: node.type,
		classes: node.classes,
		attributes: node.attributes,
		events: [...node.events.entries()].sort(),
		selector: node.selector,
		text: node.text,
		children: node.children.map(shape),
	};
}

const ROW_PLAN = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'label' },
			bindings: [['bindtap', 1]],
			children: [{ kind: 'slot', slot: 2 }],
		},
	],
});

const SCENE_PLAN = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	props: { class: 'page' },
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'title' },
			children: [{ kind: 'text', value: 'ready' }],
		},
		{ kind: 'slot', slot: 0 },
		{ kind: 'slot', slot: 1 },
	],
});

const Scene = defineUniversalComponent(
	'lynx',
	function Scene() {
		const rows = [
			{ id: 'a', label: 'alpha', active: true },
			{ id: 'b', label: 'beta', active: false },
		];
		return universalValue(SCENE_PLAN, [
			universalFor(
				rows,
				(row) => row.id,
				(row) => universalValue(ROW_PLAN, [row.active ? 'row active' : 'row', () => {}, row.label]),
			),
			universalActivity('hidden', () =>
				universalValue(ROW_PLAN, ['row hidden-row', () => {}, 'hidden label']),
			),
		]);
	},
	{ module: '@octanejs/lynx/main-renderer' },
);

function renderScene() {
	return renderLynxFirstScreen(Scene as never, {});
}

describe('direct first-screen applier', () => {
	it('produces the identical adoption snapshot, journal, and physical tree as the staged path', () => {
		const result = renderScene();

		const directPapi = createFakePAPI();
		const direct = createLynxHostContainer(directPapi, { root: 1 });
		expect(applyLynxFirstScreenDirect(direct, result.nodes, result.batch)).toBe(true);
		const directTree = captureLynxFirstTree(direct);

		const stagedResult = renderScene();
		const stagedPapi = createFakePAPI();
		const staged = createLynxHostContainer(stagedPapi, { root: 1 });
		const prepared = prepareLynxHostBatch(staged, stagedResult.batch);
		prepared.apply();
		const stagedTree = captureLynxFirstTree(staged);

		expect(directTree).not.toBeNull();
		expect(stagedTree).not.toBeNull();
		expect(directTree!.snapshot).toEqual(stagedTree!.snapshot);
		expect([...directTree![LYNX_FIRST_TREE_STATE].eventsByToken.keys()].sort()).toEqual(
			[...stagedTree![LYNX_FIRST_TREE_STATE].eventsByToken.keys()].sort(),
		);
		expect(shape(directPapi.pages[0]!)).toEqual(shape(stagedPapi.pages[0]!));
	});

	it('declines native-list trees so the staged path keeps owning them', () => {
		const listResult = {
			batch: Object.freeze({ renderer: 'lynx', version: 1, commands: Object.freeze([]) }),
			nodes: [
				{
					kind: 'host' as const,
					id: 1,
					type: 'list',
					props: {},
					children: [],
				},
			],
		};
		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1 });
		expect(applyLynxFirstScreenDirect(container, listResult.nodes, listResult.batch as never)).toBe(
			false,
		);
		expect(container.instanceCount).toBe(0);
	});
});
