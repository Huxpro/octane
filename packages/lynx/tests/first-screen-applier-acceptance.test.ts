// Issue-58 L3: `applyLynxFirstScreenDirect` must leave the container
// indistinguishable from `prepareLynxHostBatch` + `apply`. That contract covers
// which first-screen trees each applier is willing to paint at all: a tree one
// applier refuses and the other paints is the sharpest possible difference,
// because the refusal is what stops an invalid tree from reaching the engine.
//
// The tree below is reachable from authored `.tsrx`: the renderer rejects
// `<view>{text}</view>` at compile time ("does not allow authored primitive text
// under <view>"), but an explicit `children` prop is skipped by that check and
// compiles clean, after which the renderer materializes the string into a
// `#text` host under a non-text parent.
import { describe, expect, it } from 'vitest';

import {
	applyLynxFirstScreenDirect,
	createLynxHostContainer,
	prepareLynxHostBatch,
} from '../src/core/host-driver.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import {
	defineUniversalComponent,
	renderLynxFirstScreen,
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

function createFakePAPI(): LynxElementPAPI<FakeNode> {
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

const TEXT_UNDER_VIEW = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	props: { class: 'page' },
	bindings: [['children', 0]],
});

const Scene = defineUniversalComponent('lynx', () => universalValue(TEXT_UNDER_VIEW, ['hello']), {
	module: '@octanejs/lynx/main-renderer',
});

function applyThrough(direct: boolean): string {
	const result = renderLynxFirstScreen(Scene as never, {});
	const container = createLynxHostContainer(createFakePAPI(), { root: 1 });
	try {
		if (direct) {
			applyLynxFirstScreenDirect(container, result.nodes, result.batch);
		} else {
			prepareLynxHostBatch(container, result.batch).apply();
		}
		return 'painted';
	} catch (error) {
		return `refused: ${(error as Error).message}`;
	}
}

describe('first-screen applier acceptance', () => {
	it('accepts and refuses the same first-screen trees as the staged path', () => {
		expect(applyThrough(true)).toBe(applyThrough(false));
	});
});
