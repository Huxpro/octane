// The pinned Element PAPI emulation shared by the first-screen suites. It is a
// fixture rather than a test so the `octane` project can drive the same host
// while compiling `.tsrx` at `target: 'lynx'`, which the `lynx` project cannot
// do: its plugin is configured with the background renderer.
import type {
	LynxElementPAPI,
	LynxListComponentAtIndex,
	LynxListComponentAtIndexes,
	LynxListEnqueueComponent,
} from '../../src/core/papi.js';

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

/**
 * One native list the host built, with the callback trio it currently holds.
 * Mutable because `__UpdateListCallbacks` retargets a live list in place, which
 * is how a list survives being adopted into another container.
 */
export interface FakeList {
	readonly node: FakeNode;
	componentAtIndex: LynxListComponentAtIndex<FakeNode>;
	enqueueComponent: LynxListEnqueueComponent<FakeNode>;
	componentAtIndexes: LynxListComponentAtIndexes<FakeNode>;
}

export function createFakePAPI(
	options: { failCreateAt?: number; list?: boolean } = {},
): LynxElementPAPI<FakeNode> & {
	readonly pages: FakeNode[];
	flushes(): number;
	readonly lists: FakeList[];
} {
	let nextUid = 1;
	let created = 0;
	let flushCount = 0;
	// Off by default. A host without `__CreateList` is a real configuration —
	// one a page using `<list>` is owed a diagnostic about — so opting in keeps
	// that case testable rather than making every fake host list-capable.
	const lists: FakeList[] = [];
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
		lists,
		flushes() {
			return flushCount;
		},
		...(options.list === true
			? {
					list: {
						create(
							_parentComponentUniqueId,
							componentAtIndex,
							enqueueComponent,
							componentAtIndexes,
						) {
							const listNode = node('list');
							lists.push({
								node: listNode,
								componentAtIndex,
								enqueueComponent,
								componentAtIndexes,
							});
							return listNode;
						},
						updateCallbacks(listNode, componentAtIndex, enqueueComponent, componentAtIndexes) {
							const handle = lists.find((entry) => entry.node === listNode);
							if (handle === undefined) {
								throw new Error('__UpdateListCallbacks called for an unknown list');
							}
							handle.componentAtIndex = componentAtIndex;
							handle.enqueueComponent = enqueueComponent;
							handle.componentAtIndexes = componentAtIndexes;
						},
					},
				}
			: null),
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
			// `__InsertElementBefore` delegates to DOM `appendChild`/`insertBefore`
			// on a real host, so an already-attached child is REPARENTED rather than
			// duplicated. `host-driver.ts` relies on exactly that: a `move` command
			// emits one `insertBefore` with no preceding `remove`, so a fixture that
			// only spliced would leave the node in both places and report a tree the
			// host would never produce.
			if (child.parent !== null) {
				const attached = child.parent.children.indexOf(child);
				if (attached !== -1) child.parent.children.splice(attached, 1);
			}
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

// `r{root}-h{id}-g{generation}`, the shape `host-driver.ts` writes into the
// nodes-ref selector.
const SELECTOR = /^r(\d+)-h\d+-g(\d+)$/;

/**
 * Strip the two places `shape()` carries an allocator's choice of number rather
 * than a property of the tree: the native event token, which encodes the host id
 * and the listener id, and the nodes-ref selector, which is the host id spelled
 * out. Two scenes that reach the same tree by different command sequences run
 * different id sequences to get there, so comparing those numbers would report a
 * difference that is not one.
 *
 * What survives is everything the numbers were standing in for. Event *sites*
 * must still match exactly — which node carries which `kind:name` — and the
 * selector keeps its root and its **generation**, because a generation bump
 * means an instance was replaced rather than reused, which is precisely what
 * these tests exist to catch.
 */
export function withoutAllocatorIdentity(node: unknown): unknown {
	const value = node as {
		events: [string, unknown][];
		children: unknown[];
		selector: string;
	};
	const selector =
		value.selector === ''
			? ''
			: value.selector.replace(SELECTOR, (_, root, generation) => {
					return `r${root}-h*-g${generation}`;
				});
	// A selector this pattern does not recognise would be silently compared as
	// itself, which would make the normalization look sound while hiding a
	// format change. Fail instead.
	if (value.selector !== '' && selector === value.selector) {
		throw new Error(`unrecognised nodes-ref selector ${JSON.stringify(value.selector)}`);
	}
	return {
		...(value as object),
		selector,
		events: value.events.map(([name]) => name),
		children: value.children.map(withoutAllocatorIdentity),
	};
}
