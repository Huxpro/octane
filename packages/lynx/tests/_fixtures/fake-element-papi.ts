// The pinned Element PAPI emulation shared by the first-screen suites. It is a
// fixture rather than a test so the `octane` project can drive the same host
// while compiling `.tsrx` at `target: 'lynx'`, which the `lynx` project cannot
// do: its plugin is configured with the background renderer.
import type { LynxElementPAPI } from '../../src/core/papi.js';

export interface FakeNode {
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

export function createFakePAPI(
	options: { failCreateAt?: number } = {},
): LynxElementPAPI<FakeNode> & { readonly pages: FakeNode[]; flushes(): number } {
	let nextUid = 1;
	let created = 0;
	let flushCount = 0;
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
		flushes() {
			return flushCount;
		},
		createPage() {
			const page = node('page');
			pages.push(page);
			return page;
		},
		createElement(type, _parent, text) {
			created += 1;
			if (options.failCreateAt !== undefined && created === options.failCreateAt) {
				throw new Error('injected create fault');
			}
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
		flush() {
			flushCount += 1;
		},
	};
}

export function shape(node: FakeNode): unknown {
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
