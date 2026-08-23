import type {
	UniversalHostBatch,
	UniversalHostCommand,
	UniversalHostTemplateProgram,
} from 'octane/universal/native';
import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
	captureLynxFirstTree,
	createLynxHostContainer,
	disposeLynxHostContainer,
	getLynxListDiagnostics,
	isLynxHostAttached,
	prepareLynxHostBatch,
	resolveLynxHostNativeEvent,
	type LynxHostAttachmentDelta,
	type LynxHostContainer,
} from '../src/core/host-driver.js';
import { LYNX_CSS_SCOPE_PROP } from '../src/core/host-props.js';
import { LYNX_NODES_REF_ATTRIBUTE } from '../src/core/nodes-ref.js';
import { createLynxElementPAPI, type LynxListComponentAtIndexes } from '../src/core/papi.js';
import {
	createLynxMainThreadWorkletRegistry,
	registerMainThreadWorklet,
	type LynxActivatedMainThreadWorklet,
	type LynxMainThreadWorkletRegistry,
} from '../src/core/worklets.js';

function batch(version: number, commands: readonly UniversalHostCommand[]): UniversalHostBatch {
	return { renderer: 'lynx', version, commands };
}

interface ItemIds {
	readonly item: number;
	readonly text: number;
	readonly raw: number;
}

function idsAt(index: number): ItemIds {
	return { item: index * 3 + 2, text: index * 3 + 3, raw: index * 3 + 4 };
}

function largeListMount(
	itemCount: number,
	listProps: Readonly<Record<string, unknown>> = {},
): UniversalHostCommand[] {
	const commands: UniversalHostCommand[] = [
		{ op: 'create', id: 1, type: 'list', props: { id: 'feed', ...listProps } },
	];
	for (let index = 0; index < itemCount; index++) {
		const ids = idsAt(index);
		commands.push(
			{
				op: 'create',
				id: ids.item,
				type: 'list-item',
				props: { 'item-key': `item-${index}`, 'reuse-identifier': 'feed-row' },
			},
			{ op: 'create', id: ids.text, type: 'text', props: {} },
			{ op: 'create', id: ids.raw, type: '#text', props: { value: `Row ${index}` } },
			{ op: 'insert', parent: ids.text, id: ids.raw, before: null },
			{ op: 'insert', parent: ids.item, id: ids.text, before: null },
			{ op: 'insert', parent: 1, id: ids.item, before: null },
		);
	}
	commands.push({ op: 'insert', parent: null, id: 1, before: null });
	return commands;
}

registerMainThreadWorklet('list.tsrx:fault', undefined, () => undefined);

function largeListUnmount(itemCount: number): UniversalHostCommand[] {
	const commands: UniversalHostCommand[] = [];
	for (let index = 0; index < itemCount; index++) {
		const ids = idsAt(index);
		commands.push(
			{ op: 'remove', parent: ids.text, id: ids.raw },
			{ op: 'destroy', id: ids.raw },
			{ op: 'remove', parent: ids.item, id: ids.text },
			{ op: 'destroy', id: ids.text },
			{ op: 'remove', parent: 1, id: ids.item },
			{ op: 'destroy', id: ids.item },
		);
	}
	commands.push({ op: 'remove', parent: null, id: 1 }, { op: 'destroy', id: 1 });
	return commands;
}

function removeListItem(index: number): UniversalHostCommand[] {
	const ids = idsAt(index);
	return [
		{ op: 'remove', parent: ids.text, id: ids.raw },
		{ op: 'destroy', id: ids.raw },
		{ op: 'remove', parent: ids.item, id: ids.text },
		{ op: 'destroy', id: ids.text },
		{ op: 'remove', parent: 1, id: ids.item },
		{ op: 'destroy', id: ids.item },
	];
}

describe('Lynx native list recycling', () => {
	it('uses the exact two-function list API published by Lynx 3.9', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const target = globalThis as unknown as Record<string, unknown>;
			delete target.__UpdateListComponents;
			const papi = createLynxElementPAPI(globalThis);
			const container = createLynxHostContainer(papi, { root: 39 });

			prepareLynxHostBatch(container, batch(1, largeListMount(1))).apply();
			const list = (container.page as unknown as Element).querySelector('#feed')!;
			const sign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);

			expect(list.firstElementChild?.textContent).toBe('Row 0');
			expect(sign).toBeGreaterThanOrEqual(0);
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('reports retained subtree ancestry changes and omits same-list reorders', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 12 });
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'ancestry-list' } },
					{ op: 'create', id: 2, type: 'list-item', props: { 'item-key': 'row' } },
					{ op: 'create', id: 3, type: 'view', props: { id: 'retained-root' } },
					{ op: 'create', id: 4, type: 'view', props: { id: 'retained-child' } },
					{ op: 'insert', parent: 3, id: 4, before: null },
					{ op: 'insert', parent: 1, id: 2, before: null },
					{ op: 'insert', parent: null, id: 1, before: null },
					{ op: 'insert', parent: null, id: 3, before: null },
				]),
			).apply();

			const enterList = prepareLynxHostBatch(
				container,
				batch(2, [{ op: 'move', parent: 2, id: 3, before: null }]),
			);
			expect(enterList.listAncestryDelta).toEqual([
				{ id: 3, generation: 1, listDescendant: true },
				{ id: 4, generation: 1, listDescendant: true },
			]);
			enterList.abort();

			const reorder = prepareLynxHostBatch(
				container,
				batch(2, [{ op: 'move', parent: 1, id: 2, before: null }]),
			);
			expect(reorder.listAncestryDelta).toEqual([]);
			reorder.abort();
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('materializes requested cells, reuses their native identity, and makes late callbacks inert', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const attachmentBatches: Array<{
				readonly version: number;
				readonly deltas: readonly LynxHostAttachmentDelta[];
			}> = [];
			const papi = createLynxElementPAPI(globalThis);
			const container = createLynxHostContainer(papi, {
				root: 1,
				onAttachments(version, deltas) {
					attachmentBatches.push({ version, deltas });
				},
			});
			const itemCount = 1_000;
			prepareLynxHostBatch(container, batch(1, largeListMount(itemCount))).apply();

			const page = container.page as unknown as Element;
			const list = page.querySelector('#feed')!;
			expect(list).not.toBeNull();
			expect(list.children).toHaveLength(0);
			expect(isLynxHostAttached(container, 1)).toBe(true);
			expect(isLynxHostAttached(container, idsAt(0).item)).toBe(false);
			expect(JSON.parse(list.getAttribute('update-list-info')!)[0].insertAction).toHaveLength(
				itemCount,
			);

			const firstSign = globalThis.elementTree.enterListItemAtIndex(list as never, 0, 11, false);
			const firstCell = list.firstElementChild!;
			expect(firstCell.textContent).toBe('Row 0');
			expect(isLynxHostAttached(container, idsAt(0).item)).toBe(true);
			expect(attachmentBatches.at(-1)).toMatchObject({
				version: 1,
				deltas: [
					{ id: idsAt(0).raw, attached: true },
					{ id: idsAt(0).text, attached: true },
					{ id: idsAt(0).item, attached: true },
				],
			});

			globalThis.elementTree.leaveListItem(list as never, firstSign);
			expect(isLynxHostAttached(container, idsAt(0).item)).toBe(false);
			expect(
				attachmentBatches.at(-1)?.deltas.map(({ id, attached }) => ({ id, attached })),
			).toEqual([
				{ id: idsAt(0).item, attached: false },
				{ id: idsAt(0).text, attached: false },
				{ id: idsAt(0).raw, attached: false },
			]);

			const secondSign = globalThis.elementTree.enterListItemAtIndex(list as never, 1, 12, false);
			expect(secondSign).toBe(firstSign);
			expect(list.firstElementChild).toBe(firstCell);
			expect(firstCell.textContent).toBe('Row 1');
			expect(isLynxHostAttached(container, idsAt(1).raw)).toBe(true);

			const last = idsAt(itemCount - 1);
			// A cell answers a NodesRef selector only where a public instance was
			// requested, so ask on the row that is about to move.
			prepareLynxHostBatch(
				container,
				batch(2, [
					{ op: 'ensure-public-instance', id: idsAt(1).item },
					{ op: 'move', parent: 1, id: idsAt(1).item, before: null },
				]),
			).apply();
			const movedSelector = firstCell.getAttribute(LYNX_NODES_REF_ATTRIBUTE);
			expect(movedSelector).toMatch(/^r1-h\d+-g1$/);
			const moveAttachmentStart = attachmentBatches.length;
			const movedSign = globalThis.elementTree.enterListItemAtIndex(list as never, itemCount - 1);
			expect(movedSign).not.toBe(secondSign);
			expect(list.children).toHaveLength(2);
			// The moved row is the same logical host on a new physical cell: its
			// selector follows it there, and the cell it vacated stops answering.
			expect(firstCell.getAttribute(LYNX_NODES_REF_ATTRIBUTE)).toBe('');
			expect(list.lastElementChild!.getAttribute(LYNX_NODES_REF_ATTRIBUTE)).toBe(movedSelector);
			expect(
				list.querySelectorAll(`[${LYNX_NODES_REF_ATTRIBUTE}="${movedSelector}"]`),
			).toHaveLength(1);
			expect(
				attachmentBatches
					.slice(moveAttachmentStart)
					.map(({ deltas }) => deltas.map(({ attached }) => attached)),
			).toEqual([
				[false, false, false],
				[true, true, true],
			]);
			globalThis.elementTree.leaveListItem(list as never, secondSign);
			expect(getLynxListDiagnostics(container, 1)).toMatchObject({
				physicalCells: 2,
				attachedCells: 1,
				pooledCells: 1,
				leaveCount: 2,
			});
			expect(isLynxHostAttached(container, last.item)).toBe(false);

			prepareLynxHostBatch(container, batch(3, largeListUnmount(itemCount))).apply();
			expect(page.children).toHaveLength(0);
			expect(attachmentBatches.at(-1)).toMatchObject({
				version: 3,
				deltas: expect.arrayContaining([{ id: idsAt(1).item, generation: 1, attached: false }]),
			});
			expect(globalThis.elementTree.enterListItemAtIndex(list as never, 0)).toBe(-1);
			expect(() => globalThis.elementTree.leaveListItem(list as never, secondSign)).not.toThrow();
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('does not publish a reuse notification when a pooled cell returns to its own item', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const target = globalThis as unknown as Record<string, unknown>;
			const flushes: Array<Readonly<Record<string, unknown>> | undefined> = [];
			const flush = target.__FlushElementTree as (
				node?: object,
				options?: Readonly<Record<string, unknown>>,
			) => void;
			target.__FlushElementTree = (node?: object, options?: Readonly<Record<string, unknown>>) => {
				flushes.push(options);
				flush(node, options);
			};
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 10 });
			prepareLynxHostBatch(container, batch(1, largeListMount(1))).apply();
			const list = (container.page as unknown as Element).querySelector('#feed')!;
			const sign = globalThis.elementTree.enterListItemAtIndex(list as never, 0, 51, true);
			globalThis.elementTree.leaveListItem(list as never, sign);
			flushes.length = 0;

			expect(globalThis.elementTree.enterListItemAtIndex(list as never, 0, 52, true)).toBe(sign);
			expect(flushes).toHaveLength(1);
			expect(flushes[0]).toMatchObject({ triggerLayout: true, operationID: 52 });
			expect(flushes[0]).not.toHaveProperty('listReuseNotification');
			expect(getLynxListDiagnostics(container, 1)).toMatchObject({
				createdCells: 1,
				reusedCells: 1,
				enterCount: 2,
				leaveCount: 1,
			});
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('retires a pooled cell when its logical item is removed', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 12 });
			prepareLynxHostBatch(container, batch(1, largeListMount(2))).apply();
			const list = (container.page as unknown as Element).querySelector('#feed')!;
			const removedSign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			globalThis.elementTree.leaveListItem(list as never, removedSign);

			prepareLynxHostBatch(container, batch(2, removeListItem(0))).apply();
			expect(getLynxListDiagnostics(container, 1)).toMatchObject({
				logicalItems: 1,
				physicalCells: 0,
				attachedCells: 0,
				pooledCells: 0,
			});
			expect(() => globalThis.elementTree.leaveListItem(list as never, removedSign)).not.toThrow();

			const remainingSign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			expect(remainingSign).not.toBe(removedSign);
			expect(list.firstElementChild?.textContent).toBe('Row 1');
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('retires both physical cells when a moved item is removed before enqueue', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 13 });
			prepareLynxHostBatch(container, batch(1, largeListMount(2))).apply();
			const list = (container.page as unknown as Element).querySelector('#feed')!;
			const oldSign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			prepareLynxHostBatch(
				container,
				batch(2, [{ op: 'move', parent: 1, id: idsAt(0).item, before: null }]),
			).apply();
			const currentSign = globalThis.elementTree.enterListItemAtIndex(list as never, 1);
			expect(currentSign).not.toBe(oldSign);

			prepareLynxHostBatch(container, batch(3, removeListItem(0))).apply();
			expect(getLynxListDiagnostics(container, 1)).toMatchObject({
				logicalItems: 1,
				physicalCells: 0,
				attachedCells: 0,
				pooledCells: 0,
			});
			expect(() => globalThis.elementTree.leaveListItem(list as never, oldSign)).not.toThrow();
			expect(() => globalThis.elementTree.leaveListItem(list as never, currentSign)).not.toThrow();

			const remainingSign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			expect(remainingSign).not.toBe(oldSign);
			expect(remainingSign).not.toBe(currentSign);
			expect(list.firstElementChild?.textContent).toBe('Row 1');
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('keeps accepted list cleanup terminally disposable when cell removal faults', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const remove = globalThis.__RemoveElement as (parent: object, child: object) => unknown;
			const failure = new Error('injected pooled cell cleanup failure');
			let failNextRemove = false;
			globalThis.__RemoveElement = (parent: object, child: object) => {
				if (failNextRemove) {
					failNextRemove = false;
					throw failure;
				}
				return remove(parent, child);
			};
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 14 });
			prepareLynxHostBatch(container, batch(1, largeListMount(2))).apply();
			const page = container.page as unknown as Element;
			const list = page.querySelector('#feed')!;
			const removedSign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			globalThis.elementTree.leaveListItem(list as never, removedSign);
			failNextRemove = true;

			expect(() => prepareLynxHostBatch(container, batch(2, removeListItem(0))).apply()).toThrow(
				failure,
			);
			expect(container.acceptedVersion).toBe(2);
			expect(container.instanceCount).toBe(4);
			expect(() => prepareLynxHostBatch(container, batch(3, []))).toThrow(/post-fault teardown/);
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
			expect(page.children).toHaveLength(0);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('treats an empty reuse identifier as the omitted default pool', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 11 });
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'default-pool' } },
					{
						op: 'create',
						id: 2,
						type: 'list-item',
						props: { 'item-key': 'empty', 'reuse-identifier': '' },
					},
					{ op: 'create', id: 3, type: 'list-item', props: { 'item-key': 'omitted' } },
					{ op: 'insert', parent: 1, id: 2, before: null },
					{ op: 'insert', parent: 1, id: 3, before: null },
					{ op: 'insert', parent: null, id: 1, before: null },
				]),
			).apply();
			const list = (container.page as unknown as Element).querySelector('#default-pool')!;
			const firstSign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			globalThis.elementTree.leaveListItem(list as never, firstSign);

			expect(globalThis.elementTree.enterListItemAtIndex(list as never, 1)).toBe(firstSign);
			expect(getLynxListDiagnostics(container, 1)).toMatchObject({
				createdCells: 1,
				reusedCells: 1,
			});
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('rejects invalid direct children, missing keys, and duplicate item keys before mutation', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 2 });
			expect(() =>
				prepareLynxHostBatch(
					container,
					batch(1, [
						{ op: 'create', id: 1, type: 'list', props: {} },
						{ op: 'create', id: 2, type: 'view', props: {} },
						{ op: 'insert', parent: 1, id: 2, before: null },
						{ op: 'insert', parent: null, id: 1, before: null },
					]),
				),
			).toThrow(/must be a <list-item>/);

			const keyed = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 3 });
			expect(() =>
				prepareLynxHostBatch(
					keyed,
					batch(1, [
						{ op: 'create', id: 1, type: 'list', props: {} },
						{ op: 'create', id: 2, type: 'list-item', props: { 'item-key': 'same' } },
						{ op: 'create', id: 3, type: 'list-item', props: { 'item-key': 'same' } },
						{ op: 'insert', parent: 1, id: 2, before: null },
						{ op: 'insert', parent: 1, id: 3, before: null },
						{ op: 'insert', parent: null, id: 1, before: null },
					]),
				),
			).toThrow(/item-key.*duplicated/);

			const nested = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 4 });
			expect(() =>
				prepareLynxHostBatch(
					nested,
					batch(1, [
						{ op: 'create', id: 1, type: 'list', props: {} },
						{ op: 'create', id: 2, type: 'list-item', props: { 'item-key': 'outer' } },
						{ op: 'create', id: 3, type: 'list', props: {} },
						{ op: 'insert', parent: 2, id: 3, before: null },
						{ op: 'insert', parent: 1, id: 2, before: null },
						{ op: 'insert', parent: null, id: 1, before: null },
					]),
				),
			).toThrow(/nested <list>/);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('rejects ReactLynx unmount-on-recycle metadata before mutation', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 5 });
			expect(() =>
				prepareLynxHostBatch(
					container,
					batch(1, [
						{ op: 'create', id: 1, type: 'list', props: {} },
						{
							op: 'create',
							id: 2,
							type: 'list-item',
							props: {
								'item-key': 'retained',
								defer: { unmountRecycled: true },
							},
						},
						{ op: 'insert', parent: 1, id: 2, before: null },
						{ op: 'insert', parent: null, id: 1, before: null },
					]),
				),
			).toThrow(/object form.*intentionally unsupported.*retains logical component state/);
			expect((container.page as unknown as Element).children).toHaveLength(0);
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('rekeys the native callback sign when reuse must recreate a cell root', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 5 });
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'recreate-feed' } },
					{
						op: 'create',
						id: 2,
						type: 'list-item',
						props: {
							'item-key': 'scoped',
							'reuse-identifier': 'row',
							[LYNX_CSS_SCOPE_PROP]: 7,
						},
					},
					{
						op: 'create',
						id: 3,
						type: 'list-item',
						props: { 'item-key': 'unscoped', 'reuse-identifier': 'row' },
					},
					{ op: 'insert', parent: 1, id: 2, before: null },
					{ op: 'insert', parent: 1, id: 3, before: null },
					{ op: 'insert', parent: null, id: 1, before: null },
				]),
			).apply();
			const list = (container.page as unknown as Element).querySelector('#recreate-feed')!;
			const firstSign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			const firstCell = list.firstElementChild;
			globalThis.elementTree.leaveListItem(list as never, firstSign);

			const secondSign = globalThis.elementTree.enterListItemAtIndex(list as never, 1);
			expect(secondSign).not.toBe(firstSign);
			expect(list.firstElementChild).not.toBe(firstCell);
			expect(() => globalThis.elementTree.leaveListItem(list as never, firstSign)).not.toThrow();
			globalThis.elementTree.leaveListItem(list as never, secondSign);
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('accepts a logical list removal when native cell retirement faults before mutation', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const remove = globalThis.__RemoveElement as (parent: object, child: object) => unknown;
			const failure = new Error('injected list retirement failure');
			let failNextRemove = false;
			globalThis.__RemoveElement = (parent: object, child: object) => {
				if (failNextRemove) {
					failNextRemove = false;
					throw failure;
				}
				return remove(parent, child);
			};
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 6 });
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'fault-feed' } },
					{
						op: 'create',
						id: 2,
						type: 'list-item',
						props: { 'item-key': 'only', recyclable: false },
					},
					{ op: 'insert', parent: 1, id: 2, before: null },
					{ op: 'insert', parent: null, id: 1, before: null },
				]),
			).apply();
			const page = container.page as unknown as Element;
			const list = page.querySelector('#fault-feed')!;
			globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			failNextRemove = true;

			expect(() =>
				prepareLynxHostBatch(
					container,
					batch(2, [
						{ op: 'remove', parent: 1, id: 2 },
						{ op: 'destroy', id: 2 },
					]),
				).apply(),
			).toThrow(failure);
			expect(container.acceptedVersion).toBe(2);
			expect(container.instanceCount).toBe(1);
			expect(() => prepareLynxHostBatch(container, batch(3, []))).toThrow(/post-fault teardown/);

			expect(disposeLynxHostContainer(container)).toEqual({
				complete: true,
				removedRoots: 1,
				remainingRoots: 0,
				flushed: true,
				errors: [],
			});
			expect(page.children).toHaveLength(0);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('rekeys pooled cells when live item reuse metadata changes', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 7 });
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'metadata-feed' } },
					{
						op: 'create',
						id: 2,
						type: 'list-item',
						props: { 'item-key': 'only', 'reuse-identifier': 'reuse-0' },
					},
					{ op: 'insert', parent: 1, id: 2, before: null },
					{ op: 'insert', parent: null, id: 1, before: null },
				]),
			).apply();
			const list = (container.page as unknown as Element).querySelector('#metadata-feed')!;
			const sign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			globalThis.elementTree.leaveListItem(list as never, sign);

			for (let version = 2; version <= 12; version++) {
				prepareLynxHostBatch(
					container,
					batch(version, [
						{
							op: 'update',
							id: 2,
							props: {
								'item-key': 'only',
								'reuse-identifier': `reuse-${version - 1}`,
							},
						},
					]),
				).apply();
				expect(globalThis.elementTree.enterListItemAtIndex(list as never, 0)).toBe(sign);
				globalThis.elementTree.leaveListItem(list as never, sign);
				expect(getLynxListDiagnostics(container, 1)).toMatchObject({
					physicalCells: 1,
					attachedCells: 0,
					pooledCells: 1,
					createdCells: 1,
				});
			}
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('batches callback attachments and mirrors sync and async reuse flush options', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const target = globalThis as unknown as Record<string, unknown>;
			let componentAtIndexes: LynxListComponentAtIndexes<object> | undefined;
			const createList = target.__CreateList as (...args: unknown[]) => object;
			target.__CreateList = (...args: unknown[]) => {
				componentAtIndexes = args[4] as LynxListComponentAtIndexes<object>;
				return createList(...args);
			};
			const flushes: Array<{
				readonly node: object | undefined;
				readonly options: Readonly<Record<string, unknown>> | undefined;
			}> = [];
			const flush = target.__FlushElementTree as (
				node?: object,
				options?: Readonly<Record<string, unknown>>,
			) => void;
			target.__FlushElementTree = (node?: object, options?: Readonly<Record<string, unknown>>) => {
				flushes.push({ node, options });
				flush(node, options);
			};
			const attachmentBatches: Array<readonly LynxHostAttachmentDelta[]> = [];
			const papi = createLynxElementPAPI(globalThis);
			const container = createLynxHostContainer(papi, {
				root: 8,
				onAttachments(_version, deltas) {
					attachmentBatches.push(deltas);
				},
			});
			prepareLynxHostBatch(container, batch(1, largeListMount(4))).apply();
			const list = (container.page as unknown as Element).querySelector('#feed')!;
			const firstSign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			const secondSign = globalThis.elementTree.enterListItemAtIndex(list as never, 1);
			globalThis.elementTree.leaveListItem(list as never, firstSign);
			globalThis.elementTree.leaveListItem(list as never, secondSign);
			flushes.length = 0;
			attachmentBatches.length = 0;
			if (componentAtIndexes === undefined) throw new Error('Expected batched list callback.');

			componentAtIndexes(
				list as never,
				papi.getUniqueId(list as never),
				[2, 3],
				[31, 32],
				true,
				true,
			);
			expect(flushes).toHaveLength(3);
			expect(
				flushes.slice(0, 2).map(({ options }) => ({
					asyncFlush: options?.asyncFlush,
					itemKey: (options?.listReuseNotification as { readonly itemKey?: unknown } | undefined)
						?.itemKey,
				})),
			).toEqual([
				{ asyncFlush: true, itemKey: 'item-2' },
				{ asyncFlush: true, itemKey: 'item-3' },
			]);
			expect(flushes[2]).toMatchObject({
				node: list,
				options: { triggerLayout: true, operationIDs: [31, 32] },
			});
			expect(attachmentBatches).toHaveLength(1);

			for (const child of [...list.children]) {
				globalThis.elementTree.leaveListItem(
					list as never,
					globalThis.__GetElementUniqueID(child as never),
				);
			}
			flushes.length = 0;
			attachmentBatches.length = 0;
			componentAtIndexes(
				list as never,
				papi.getUniqueId(list as never),
				[0, 1],
				[41, 42],
				true,
				false,
			);
			expect(flushes).toEqual([
				expect.objectContaining({
					node: list,
					options: expect.objectContaining({ triggerLayout: true, operationIDs: [41, 42] }),
				}),
			]);
			expect(flushes[0]!.options).not.toHaveProperty('listReuseNotification');
			expect(attachmentBatches).toHaveLength(1);
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it.each(['create', 'insert', 'getUniqueId', 'flush', 'pooled-rebind'] as const)(
		'fail-stops and reports one accepted fault when scroll-time %s throws',
		(stage) => {
			const dom = new JSDOM();
			installLynxTestingEnv(globalThis, { window: dom.window as never });
			const environment = globalThis.lynxTestingEnv;
			environment.clearGlobal();
			environment.switchToMainThread();
			try {
				const target = globalThis as unknown as Record<string, unknown>;
				const failure = new Error(`injected scroll-time list ${stage} failure`);
				let armed = false;
				const failAt = (candidate: typeof stage): void => {
					if (!armed || stage !== candidate) return;
					armed = false;
					throw failure;
				};
				const createElement = target.__CreateElement as (type: string, parentId: number) => object;
				target.__CreateElement = (type: string, parentId: number) => {
					failAt('create');
					return createElement(type, parentId);
				};
				const insert = target.__InsertElementBefore as (
					parent: object,
					child: object,
					before?: object,
				) => unknown;
				target.__InsertElementBefore = (parent: object, child: object, before?: object) => {
					failAt('insert');
					return insert(parent, child, before);
				};
				const getUniqueId = target.__GetElementUniqueID as (node: object) => number;
				target.__GetElementUniqueID = (node: object) => {
					failAt('getUniqueId');
					return getUniqueId(node);
				};
				const setAttribute = target.__SetAttribute as (
					node: object,
					name: string,
					value: unknown,
				) => void;
				target.__SetAttribute = (node: object, name: string, value: unknown) => {
					failAt('pooled-rebind');
					setAttribute(node, name, value);
				};
				const flush = target.__FlushElementTree as (
					node?: object,
					options?: Readonly<Record<string, unknown>>,
				) => void;
				target.__FlushElementTree = (
					node?: object,
					options?: Readonly<Record<string, unknown>>,
				) => {
					failAt('flush');
					flush(node, options);
				};
				const faults: Array<{ readonly version: number; readonly error: unknown }> = [];
				const attachments: Array<readonly LynxHostAttachmentDelta[]> = [];
				const registry = createLynxMainThreadWorkletRegistry();
				const activations: LynxActivatedMainThreadWorklet[] = [];
				const worklets: LynxMainThreadWorkletRegistry = Object.freeze({
					...registry,
					activate(descriptor) {
						const active = registry.activate(descriptor);
						activations.push(active);
						return active;
					},
				});
				const ref = { _wvid: `list:fault:${stage}` };
				const refCell = registry.retainOwner(ref);
				const container = createLynxHostContainer(createLynxElementPAPI(globalThis), {
					root: 9,
					worklets,
					onAttachments(_version, deltas) {
						attachments.push(deltas);
					},
					onCallbackFault(version, error) {
						faults.push({ version, error });
					},
				});
				prepareLynxHostBatch(
					container,
					batch(
						1,
						largeListMount(stage === 'pooled-rebind' ? 2 : 1, {
							'main-thread:bindtap': { _wkltId: 'list.tsrx:fault' },
							'main-thread:ref': ref,
						}),
					),
				).apply();
				const list = (container.page as unknown as Element).querySelector('#feed')!;
				expect(activations).toHaveLength(1);
				expect(registry.isActive(activations[0]!)).toBe(true);
				expect(refCell.current).toBe(list);
				if (stage === 'pooled-rebind') {
					const sign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
					globalThis.elementTree.leaveListItem(list as never, sign);
					attachments.length = 0;
				}
				armed = true;

				expect(
					globalThis.elementTree.enterListItemAtIndex(
						list as never,
						stage === 'pooled-rebind' ? 1 : 0,
					),
				).toBe(-1);
				expect(faults).toEqual([{ version: 1, error: failure }]);
				expect(attachments).toEqual([]);
				expect(registry.isActive(activations[0]!)).toBe(false);
				expect(refCell.current).toBe(null);
				registry.releaseOwner(ref);
				expect(() => registry.updateRef(ref, null)).toThrow(/stale/);
				expect(isLynxHostAttached(container, idsAt(0).item)).toBe(false);
				expect(globalThis.elementTree.enterListItemAtIndex(list as never, 0)).toBe(-1);
				expect(faults).toHaveLength(1);
				expect(() =>
					prepareLynxHostBatch(container, batch(2, [{ op: 'update', id: 1, props: {} }])),
				).toThrow(/after a host fault/);
				expect(disposeLynxHostContainer(container).errors).toEqual([]);
			} finally {
				environment.clearGlobal();
				uninstallLynxTestingEnv(globalThis);
				dom.window.close();
			}
		},
	);

	it('addresses only the cells a public instance was requested for, across recycles', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const papi = createLynxElementPAPI(globalThis);
			const container = createLynxHostContainer(papi, {
				root: 1,
				announcesPublicInstances: true,
			});
			prepareLynxHostBatch(container, batch(1, largeListMount(4))).apply();
			const page = container.page as unknown as Element;
			const list = page.querySelector('#feed')!;
			/** Every value a NodesRef query could currently resolve inside the list. */
			const addressable = (): string[] =>
				[...list.querySelectorAll(`[${LYNX_NODES_REF_ATTRIBUTE}]`)]
					.map((node) => node.getAttribute(LYNX_NODES_REF_ATTRIBUTE)!)
					.filter((value) => value !== '');

			const firstSign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			globalThis.elementTree.enterListItemAtIndex(list as never, 1);
			expect(list.children).toHaveLength(2);
			expect(addressable()).toEqual([]);

			// Requested before the row has ever owned a physical cell, so the request
			// has to outlive every node it could have been recorded against.
			const requested = idsAt(3).item;
			prepareLynxHostBatch(
				container,
				batch(2, [{ op: 'ensure-public-instance', id: requested }]),
			).apply();
			expect(addressable()).toEqual([]);

			const selector = `r1-h${requested}-g1`;
			globalThis.elementTree.leaveListItem(list as never, firstSign);
			const reusedSign = globalThis.elementTree.enterListItemAtIndex(list as never, 3);
			expect(reusedSign).toBe(firstSign);
			expect(list.children).toHaveLength(2);
			expect(addressable()).toEqual([selector]);
			expect(
				list.querySelectorAll(`[${LYNX_NODES_REF_ATTRIBUTE}="${selector}"]`)[0]!.textContent,
			).toBe('Row 3');

			// Back to the pool: nothing answers for the row while it owns no cell.
			globalThis.elementTree.leaveListItem(list as never, reusedSign);
			expect(addressable()).toEqual([]);

			// And returning to the same row addresses it again, exactly once.
			expect(globalThis.elementTree.enterListItemAtIndex(list as never, 3)).toBe(reusedSign);
			expect(addressable()).toEqual([selector]);

			prepareLynxHostBatch(container, batch(3, largeListUnmount(4))).apply();
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('honors a first-batch public-instance request for a list row across adoption', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const papi = createLynxElementPAPI(globalThis);
			const page = papi.createPage('entry', 0);
			// The first screen paints the same list before the background exists.
			const source = createLynxHostContainer(papi, { root: 1, page });
			prepareLynxHostBatch(source, batch(1, largeListMount(2))).apply();
			const firstTree = captureLynxFirstTree(source);

			// The background's first batch adopts it, and — announcing — names the
			// row a ref will query. The row is logical, so the request must survive
			// adoption until a cell materializes it.
			const container = createLynxHostContainer(papi, {
				root: 1,
				page,
				announcesPublicInstances: true,
			});
			const requested = idsAt(1).item;
			const prepared = prepareLynxHostBatch(
				container,
				batch(1, [...largeListMount(2), { op: 'ensure-public-instance', id: requested }]),
				{ firstTree },
			);
			expect(prepared.firstTreeAction).toBe('adopt');
			prepared.apply();

			const list = (container.page as unknown as Element).querySelector('#feed')!;
			const addressable = (): string[] =>
				[...list.querySelectorAll(`[${LYNX_NODES_REF_ATTRIBUTE}]`)]
					.map((node) => node.getAttribute(LYNX_NODES_REF_ATTRIBUTE)!)
					.filter((value) => value !== '');

			// A row nothing asked for materializes unaddressed…
			globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			expect(addressable()).toEqual([]);

			// …and the requested row answers the moment it owns a cell.
			const selector = `r1-h${requested}-g1`;
			globalThis.elementTree.enterListItemAtIndex(list as never, 1);
			expect(addressable()).toEqual([selector]);
			expect(
				list.querySelectorAll(`[${LYNX_NODES_REF_ATTRIBUTE}="${selector}"]`)[0]!.textContent,
			).toBe('Row 1');

			prepareLynxHostBatch(container, batch(2, largeListUnmount(2))).apply();
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});

	it('keeps list-cell selectors eager for a peer that announces no public instances', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const papi = createLynxElementPAPI(globalThis);
			// No `announcesPublicInstances`: this peer never sends
			// `ensure-public-instance`, so a selector it was never asked for is the
			// only thing that can make its refs address anything.
			const container = createLynxHostContainer(papi, { root: 1 });
			prepareLynxHostBatch(container, batch(1, largeListMount(4))).apply();
			const page = container.page as unknown as Element;
			const list = page.querySelector('#feed')!;
			const addressable = (): string[] =>
				[...list.querySelectorAll(`[${LYNX_NODES_REF_ATTRIBUTE}]`)]
					.map((node) => node.getAttribute(LYNX_NODES_REF_ATTRIBUTE)!)
					.filter((value) => value !== '');

			const firstSign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			expect(addressable()).toEqual([`r1-h${idsAt(0).item}-g1`, `r1-h${idsAt(0).text}-g1`]);

			globalThis.elementTree.leaveListItem(list as never, firstSign);
			expect(globalThis.elementTree.enterListItemAtIndex(list as never, 3)).toBe(firstSign);
			expect(addressable()).toEqual([`r1-h${idsAt(3).item}-g1`, `r1-h${idsAt(3).text}-g1`]);

			prepareLynxHostBatch(container, batch(2, largeListUnmount(4))).apply();
			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});
});

// Issue #135 item 2 (#103 U3b) — a native list asks for the rows it is about to
// show, so declaring a row and building it are different requests.
describe('Lynx deferred template runs', () => {
	/** `list-item > text > #text`, with the item key and the text bound. */
	const ROW_PROGRAM: UniversalHostTemplateProgram = Object.freeze({
		nodes: Object.freeze([
			Object.freeze({
				type: 'list-item',
				parent: -1,
				props: Object.freeze({ 'reuse-identifier': 'feed-row' }),
				bindings: Object.freeze([Object.freeze({ name: 'item-key', valueIndex: 0 })]),
			}),
			Object.freeze({ type: 'text', parent: 0, props: Object.freeze({ class: 'row' }) }),
			Object.freeze({
				type: '#text',
				parent: 1,
				props: Object.freeze({}),
				bindings: Object.freeze([Object.freeze({ name: 'value', valueIndex: 1 })]),
			}),
		]),
		events: Object.freeze([]),
	});
	const ROW_HOSTS = 3;
	const FIRST_ROW_ID = 100;

	function rowValues(count: number): readonly string[] {
		const values: string[] = [];
		for (let index = 0; index < count; index++) values.push(`item-${index}`, `Row ${index}`);
		return Object.freeze(values);
	}

	function rowIdsAt(index: number): ItemIds {
		const item = FIRST_ROW_ID + index * ROW_HOSTS;
		return { item, text: item + 1, raw: item + 2 };
	}

	function deferredRun(count: number, overrides: Record<string, unknown> = {}) {
		return {
			op: 'mount-template-run' as const,
			parent: 1,
			before: null,
			program: ROW_PROGRAM,
			firstId: FIRST_ROW_ID,
			firstListenerId: null,
			count,
			values: rowValues(count),
			deferred: true as const,
			...overrides,
		};
	}

	function deferredListMount(count: number): UniversalHostCommand[] {
		return [
			{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
			deferredRun(count),
			{ op: 'insert', parent: null, id: 1, before: null },
		];
	}

	function withList<Result>(
		run: (environment: { readonly container: LynxHostContainer; readonly dom: JSDOM }) => Result,
	): Result {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		try {
			const container = createLynxHostContainer(createLynxElementPAPI(globalThis), { root: 1 });
			return run({ container, dom });
		} finally {
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	}

	it('declares every row of a list and builds only the cells it is asked for', () => {
		withList(({ container }) => {
			const rows = 1_000;
			const before = container.instanceCount;
			prepareLynxHostBatch(container, batch(1, deferredListMount(rows))).apply();

			// The whole claim: the list learned about all 1,000 rows, and the driver
			// holds one host — the `<list>` itself. An eager run of the same program
			// would hold 1 + 1,000 x 3.
			const list = (container.page as unknown as Element).querySelector('#feed')!;
			expect(JSON.parse(list.getAttribute('update-list-info')!)[0].insertAction).toHaveLength(rows);
			expect(container.instanceCount - before).toBe(1);
			expect(list.children).toHaveLength(0);
			expect(isLynxHostAttached(container, rowIdsAt(0).item)).toBe(false);

			// A requested row is an ordinary host from the moment it owns a cell: it
			// paints, it reports attached, and it is now one of the driver's records.
			const sign = globalThis.elementTree.enterListItemAtIndex(list as never, 0, 11, false);
			expect(list.firstElementChild?.textContent).toBe('Row 0');
			expect(isLynxHostAttached(container, rowIdsAt(0).item)).toBe(true);
			expect(container.instanceCount - before).toBe(1 + ROW_HOSTS);

			// A second row through the same physical cell rebinds rather than
			// building a second one, and reads the values its own instance declared.
			globalThis.elementTree.leaveListItem(list as never, sign);
			expect(globalThis.elementTree.enterListItemAtIndex(list as never, 617, 12, false)).toBe(sign);
			expect(list.firstElementChild?.textContent).toBe('Row 617');
			expect(isLynxHostAttached(container, rowIdsAt(617).raw)).toBe(true);
			expect(isLynxHostAttached(container, rowIdsAt(0).item)).toBe(false);
			expect(container.instanceCount - before).toBe(1 + 2 * ROW_HOSTS);

			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		});
	});

	/** The same four rows a peer without this capability has to send. */
	function eagerRows(count: number): UniversalHostCommand[] {
		const commands: UniversalHostCommand[] = [];
		for (let index = 0; index < count; index++) {
			const ids = rowIdsAt(index);
			commands.push(
				{
					op: 'create',
					id: ids.item,
					type: 'list-item',
					props: { 'reuse-identifier': 'feed-row', 'item-key': `item-${index}` },
				},
				{ op: 'create', id: ids.text, type: 'text', props: { class: 'row' } },
				{ op: 'create', id: ids.raw, type: '#text', props: { value: `Row ${index}` } },
				{ op: 'insert', parent: ids.text, id: ids.raw, before: null },
				{ op: 'insert', parent: ids.item, id: ids.text, before: null },
				{ op: 'insert', parent: 1, id: ids.item, before: null },
			);
		}
		return commands;
	}

	it('gives a deferred instance the hosts an eager run would have given it', () => {
		// Deferring is a decision about when to build, not about what to build. Both
		// commits describe the same four rows under the same list, so the cell that
		// comes back has to be indistinguishable — and so does what the driver holds
		// once the rows are real.
		const paint = (rows: readonly UniversalHostCommand[]): readonly [string, number] =>
			withList(({ container }) => {
				prepareLynxHostBatch(
					container,
					batch(1, [
						{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
						...rows,
						{ op: 'insert', parent: null, id: 1, before: null },
					]),
				).apply();
				const list = (container.page as unknown as Element).querySelector('#feed')!;
				globalThis.elementTree.enterListItemAtIndex(list as never, 2, 11, false);
				const painted = [list.firstElementChild!.outerHTML, container.instanceCount] as const;
				expect(disposeLynxHostContainer(container).errors).toEqual([]);
				return painted;
			});

		const [deferredCell, deferredHosts] = paint([deferredRun(4)]);
		const [eagerCell, eagerHosts] = paint(eagerRows(4));
		expect(deferredCell).toBe(eagerCell);
		// What differs is the price of the rows nothing showed. The eager commit
		// holds the list and all four rows whether or not anything is on screen;
		// the deferred one holds the list and the single row that is.
		expect(eagerHosts).toBe(1 + 4 * ROW_HOSTS);
		expect(deferredHosts).toBe(1 + ROW_HOSTS);
	});

	/**
	 * Tap the `<text>` inside the list's one live cell.
	 *
	 * A native event names the event rather than the PAPI channel it was bound
	 * on, and carries a plain id/uid/dataset target over the read-only `Event`
	 * accessors, so the shape is defined rather than assigned.
	 */
	function tapRow(dom: JSDOM, list: Element): void {
		const target = list.firstElementChild!.firstElementChild!;
		const event = new dom.window.Event('bindEvent:tap', { bubbles: true, cancelable: true });
		const lynxTarget = { id: target.id, uid: 1, dataset: {} };
		for (const [name, value] of [
			['type', 'tap'],
			['target', lynxTarget],
			['currentTarget', lynxTarget],
		] as const) {
			Object.defineProperty(event, name, { configurable: true, value });
		}
		Object.assign(event, { timestamp: 1, detail: {} });
		target.dispatchEvent(event);
	}

	/** The same row with a tap site, so a run carries listener identities too. */
	const TAPPABLE_ROW_PROGRAM: UniversalHostTemplateProgram = Object.freeze({
		nodes: ROW_PROGRAM.nodes,
		events: Object.freeze([
			Object.freeze({ node: 1, type: 'bindtap', priority: 'default' as const }),
		]),
	});
	const FIRST_LISTENER_ID = 900;

	it('binds a deferred row to the listener identity its own instance declared', () => {
		withList(({ container, dom }) => {
			// A run's listener ids stride by row exactly as its host ids do, and the
			// stride is arithmetic the declaration keeps rather than records the
			// driver holds. A tap is where the two have to agree.
			//
			// A bare host container has no engine behind it, so the tap's landing
			// point is stood up here: `__AddEvent` routes a native event to
			// `lynxCoreInject.tt.publishEvent`, and the token it hands over is the
			// only thing the driver actually wrote.
			const scope = globalThis as unknown as {
				lynxCoreInject?: { tt: Record<string, unknown> };
			};
			const engine = scope.lynxCoreInject;
			const taps: unknown[] = [];
			scope.lynxCoreInject = {
				tt: {
					publishEvent: (handler: unknown) =>
						taps.push(resolveLynxHostNativeEvent(container, handler)),
				},
			};
			try {
				prepareLynxHostBatch(
					container,
					batch(1, [
						{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
						deferredRun(50, {
							program: TAPPABLE_ROW_PROGRAM,
							firstListenerId: FIRST_LISTENER_ID,
						}),
						{ op: 'insert', parent: null, id: 1, before: null },
					]),
				).apply();
				const list = dom.window.document.querySelector('#feed')!;

				const sign = globalThis.elementTree.enterListItemAtIndex(list as never, 7, 11, false);
				tapRow(dom, list);
				expect(taps).toEqual([{ listener: FIRST_LISTENER_ID + 7, priority: 'default' }]);

				// Recycling the physical cell rebinds the site to the row it now shows.
				globalThis.elementTree.leaveListItem(list as never, sign);
				globalThis.elementTree.enterListItemAtIndex(list as never, 41, 12, false);
				tapRow(dom, list);
				expect(taps).toEqual([
					{ listener: FIRST_LISTENER_ID + 7, priority: 'default' },
					{ listener: FIRST_LISTENER_ID + 41, priority: 'default' },
				]);

				expect(disposeLynxHostContainer(container).errors).toEqual([]);
			} finally {
				if (engine === undefined) delete scope.lynxCoreInject;
				else scope.lynxCoreInject = engine;
			}
		});
	});

	it('declares rows into a list that was already on screen', () => {
		withList(({ container }) => {
			// A list that fills after it mounts takes the rows through the ordinary
			// per-commit list update rather than through its own creation, so the
			// declaration has to be visible to that walk too.
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
					{ op: 'insert', parent: null, id: 1, before: null },
				]),
			).apply();
			const list = (container.page as unknown as Element).querySelector('#feed')!;
			expect(list.getAttribute('update-list-info')).toBeNull();

			const before = container.instanceCount;
			prepareLynxHostBatch(container, batch(2, [deferredRun(500)])).apply();
			expect(JSON.parse(list.getAttribute('update-list-info')!).at(-1).insertAction).toHaveLength(
				500,
			);
			expect(container.instanceCount).toBe(before);

			globalThis.elementTree.enterListItemAtIndex(list as never, 499, 11, false);
			expect(list.firstElementChild?.textContent).toBe('Row 499');
			expect(container.instanceCount).toBe(before + ROW_HOSTS);

			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		});
	});

	it('refuses to defer anywhere the list is not the one deciding what is on screen', () => {
		withList(({ container }) => {
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
					{ op: 'create', id: 2, type: 'view', props: { id: 'plain' } },
					{ op: 'insert', parent: null, id: 1, before: null },
					{ op: 'insert', parent: null, id: 2, before: null },
				]),
			).apply();

			// A plain host does not own a display window, so there is nothing to
			// build the instance on demand for.
			expect(() =>
				prepareLynxHostBatch(container, batch(2, [deferredRun(2, { parent: 2 })])),
			).toThrow(/may only defer directly under a native <list>/);

			// A `<list>`'s direct children are its cells.
			expect(() =>
				prepareLynxHostBatch(
					container,
					batch(2, [
						deferredRun(2, {
							program: {
								...ROW_PROGRAM,
								nodes: [{ ...ROW_PROGRAM.nodes[0]!, type: 'view' }, ...ROW_PROGRAM.nodes.slice(1)],
							},
						}),
					]),
				),
			).toThrow(/must declare <list-item> instances/);

			// And the converse: a cell template is the one thing a run cannot mount
			// eagerly, because the only parent that could hold it refuses eager runs.
			const { deferred: _eager, ...eagerCellRun } = deferredRun(2, { parent: 2 });
			expect(() => prepareLynxHostBatch(container, batch(2, [eagerCellRun]))).toThrow(
				/may only mount a <list-item> template as a deferred run/,
			);

			// The list owns the order of the rows it was told about, so a placement
			// relative to a sibling would be a second answer to the same question.
			expect(() =>
				prepareLynxHostBatch(container, batch(2, [deferredRun(2, { before: 1 })])),
			).toThrow(/cannot defer relative to a sibling/);

			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		});
	});

	it('refuses to defer a run whose instances the per-commit audits would never see', () => {
		withList(({ container }) => {
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
					{ op: 'insert', parent: null, id: 1, before: null },
				]),
			).apply();

			// A declared host is not in the walk that collects native lists, so a
			// declared `<list>` would be a list this driver never learned it owns.
			// The program shape refuses one outright, deferred or not.
			expect(() =>
				prepareLynxHostBatch(
					container,
					batch(2, [
						deferredRun(2, {
							program: {
								nodes: [
									ROW_PROGRAM.nodes[0]!,
									{ type: 'list', parent: 0, props: {} },
									ROW_PROGRAM.nodes[2]!,
								],
								events: [],
							},
							values: Object.freeze(['item-0', 'Row 0', 'item-1', 'Row 1']),
						}),
					]),
				),
			).toThrow(/cannot contain native-list hosts/);

			// A cell has exactly one place it can be, so a run may declare one and
			// never nest one.
			expect(() =>
				prepareLynxHostBatch(
					container,
					batch(2, [
						deferredRun(2, {
							program: {
								nodes: [
									ROW_PROGRAM.nodes[0]!,
									{ type: 'list-item', parent: 0, props: { 'item-key': 'nested' } },
									ROW_PROGRAM.nodes[2]!,
								],
								events: [],
							},
							values: Object.freeze(['item-0', 'Row 0', 'item-1', 'Row 1']),
						}),
					]),
				),
			).toThrow(/may only declare a <list-item> as its root/);

			// A declared row is not in the walk that checks main-thread props and
			// refs either, and a bound `main-thread:` slot is the only way a run can
			// carry one.
			expect(() =>
				prepareLynxHostBatch(
					container,
					batch(2, [
						deferredRun(1, {
							program: {
								nodes: [
									{
										...ROW_PROGRAM.nodes[0]!,
										bindings: [
											{ name: 'item-key', valueIndex: 0 },
											{ name: 'main-thread:bindtap', valueIndex: 1 },
										],
									},
									ROW_PROGRAM.nodes[1]!,
									{ type: '#text', parent: 1, props: { value: 'static' } },
								],
								events: [],
							},
							values: Object.freeze(['item-0', { _wkltId: 'row.tsrx:tap' }]),
						}),
					]),
				),
			).toThrow(/main-thread props/);

			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		});
	});

	it('validates every declared instance at accept, including the ones nothing builds', () => {
		withList(({ container }) => {
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
					{ op: 'insert', parent: null, id: 1, before: null },
				]),
			).apply();

			// Row 300 of 1,000 is one nothing on this screen will ever ask for. A
			// deferred run that accepted it would move the fault from the commit
			// that composed it to a scroll position.
			const values = [...rowValues(1_000)];
			values[601] = 7 as never;
			expect(() =>
				prepareLynxHostBatch(
					container,
					batch(2, [deferredRun(1_000, { values: Object.freeze(values) })]),
				),
			).toThrow(/#text must contain a string value/);

			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		});
	});

	it('forgets a destroyed row rather than deriving it again', () => {
		withList(({ container }) => {
			prepareLynxHostBatch(container, batch(1, deferredListMount(4))).apply();
			const list = (container.page as unknown as Element).querySelector('#feed')!;
			const removed = rowIdsAt(1);

			prepareLynxHostBatch(
				container,
				batch(2, [
					{ op: 'remove', parent: 1, id: removed.item },
					{ op: 'destroy', id: removed.raw },
					{ op: 'destroy', id: removed.text },
					{ op: 'destroy', id: removed.item },
				]),
			).apply();

			// The list now owns three rows, and index 1 is the row that used to be
			// index 2.
			expect(JSON.parse(list.getAttribute('update-list-info')!).at(-1).removeAction).toEqual([1]);
			globalThis.elementTree.enterListItemAtIndex(list as never, 1, 11, false);
			expect(list.firstElementChild?.textContent).toBe('Row 2');

			// The declaration outlives the hosts it declared, so the destroyed row
			// has to be struck from it. A later commit is where that shows: within
			// the commit that destroyed them the ids are refused by the deletion
			// journal, and after it the run is the only thing that still knows the
			// arithmetic. A host that answers again is a destroyed host come back.
			expect(() =>
				prepareLynxHostBatch(
					container,
					batch(3, [{ op: 'update', id: removed.text, props: { class: 'resurrected' } }]),
				),
			).toThrow(new RegExp(`unknown update target ${removed.text}`));
			expect(() =>
				prepareLynxHostBatch(
					container,
					batch(3, [{ op: 'insert', parent: 1, id: removed.item, before: null }]),
				),
			).toThrow();

			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		});
	});

	it('bumps the generation when a destroyed materialized row id is reused', () => {
		withList(({ container }) => {
			prepareLynxHostBatch(container, batch(1, deferredListMount(2))).apply();
			const list = (container.page as unknown as Element).querySelector('#feed')!;
			const row = rowIdsAt(0);
			const sign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			expect(sign).toBeGreaterThan(0);
			globalThis.elementTree.leaveListItem(list as never, sign);

			prepareLynxHostBatch(
				container,
				batch(2, [
					{ op: 'remove', parent: row.text, id: row.raw },
					{ op: 'destroy', id: row.raw },
					{ op: 'remove', parent: row.item, id: row.text },
					{ op: 'destroy', id: row.text },
					{ op: 'remove', parent: 1, id: row.item },
					{ op: 'destroy', id: row.item },
				]),
			).apply();

			// A host that lived and died must not be impersonated by its successor:
			// every consumer keyed on (root, id, generation) — stale events, handle
			// deltas — relies on the reused id announcing a higher generation, the
			// same contract every eager creation path keeps.
			prepareLynxHostBatch(
				container,
				batch(3, [
					{ op: 'create', id: row.item, type: 'view', props: { id: 'successor' } },
					{ op: 'insert', parent: null, id: row.item, before: null },
				]),
			).apply();
			const successor = (container.page as unknown as Element).querySelector('#successor')!;
			expect(successor.getAttribute(LYNX_NODES_REF_ATTRIBUTE)).toBe(`r1-h${row.item}-g2`);

			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		});
	});

	it('refuses a deferred range that collides with compact-accepted hosts', () => {
		withList(({ container }) => {
			// A compact commit accepts hosts whose generations stay implicit, so an
			// id-collision guard that only reads the generation map cannot see them.
			const program: UniversalHostTemplateProgram = Object.freeze({
				nodes: Object.freeze([
					Object.freeze({ type: 'view', parent: -1, props: Object.freeze({ class: 'card' }) }),
					Object.freeze({ type: 'text', parent: 0, props: Object.freeze({}) }),
					Object.freeze({
						type: '#text',
						parent: 1,
						props: Object.freeze({}),
						bindings: Object.freeze([Object.freeze({ name: 'value', valueIndex: 0 })]),
					}),
				]),
				events: Object.freeze([]),
			});
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 2, type: 'view', props: { id: 'shell' } },
					{ op: 'insert', parent: null, id: 2, before: null },
				]),
			).apply();
			prepareLynxHostBatch(
				container,
				batch(2, [
					{
						op: 'mount-template-run',
						parent: 2,
						before: null,
						program,
						firstId: FIRST_ROW_ID,
						firstListenerId: null,
						count: 2,
						values: Object.freeze(['One', 'Two']),
					},
				]),
				{ compact: true, incrementalCompact: true, lazyPublicInstances: true },
			).apply();
			prepareLynxHostBatch(
				container,
				batch(3, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
					{ op: 'insert', parent: null, id: 1, before: null },
				]),
			).apply();

			// The same ids in an eager run are refused as duplicates; declaring them
			// must be refused the same way, or the run aliases living hosts.
			expect(() => prepareLynxHostBatch(container, batch(4, [deferredRun(2)]))).toThrow(
				/duplicate host id/,
			);

			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		});
	});

	it('validates every declared #text value at accept, not only the value-only route', () => {
		withList(({ container }) => {
			// A #text carrying a CSS scope beside its bound value leaves the
			// value-only fast route, but accepting a run still means every instance
			// it declares is valid — the fault belongs to the commit, not to the
			// scroll position that would first build the row.
			const scoped: UniversalHostTemplateProgram = Object.freeze({
				nodes: Object.freeze([
					Object.freeze({
						type: 'list-item',
						parent: -1,
						props: Object.freeze({ 'reuse-identifier': 'feed-row' }),
						bindings: Object.freeze([Object.freeze({ name: 'item-key', valueIndex: 0 })]),
					}),
					Object.freeze({ type: 'text', parent: 0, props: Object.freeze({ class: 'row' }) }),
					Object.freeze({
						type: '#text',
						parent: 1,
						props: Object.freeze({ [LYNX_CSS_SCOPE_PROP]: 'scope-a' }),
						bindings: Object.freeze([Object.freeze({ name: 'value', valueIndex: 1 })]),
					}),
				]),
				events: Object.freeze([]),
			});
			prepareLynxHostBatch(
				container,
				batch(1, [
					{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
					{ op: 'insert', parent: null, id: 1, before: null },
				]),
			).apply();
			expect(() =>
				prepareLynxHostBatch(
					container,
					batch(2, [
						deferredRun(2, {
							program: scoped,
							values: Object.freeze(['item-0', 'Row 0', 'item-1', 7]),
						}),
					]),
				),
			).toThrow(/must contain a string value/);

			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		});
	});

	// Issue #135 item 2 (#103 U3b-b3) — the two ways a declared host stops being
	// one. Both are promotions, and they are not the same size; the retained-heap
	// figures those counts explain are in `benchmarks/lynx-list/retention.mjs`.
	it('promotes the host an update wrote and leaves the rest of its row declared', () => {
		withList(({ container }) => {
			const rows = 1_000;
			const before = container.instanceCount;
			prepareLynxHostBatch(container, batch(1, deferredListMount(rows))).apply();
			expect(container.instanceCount - before).toBe(1);

			// One `update` per row against the `#text` that carries its value — the
			// commit a re-render produces when that value changed, for rows the list
			// has never asked for. A written host cannot be derived from its
			// declaration any more, so it becomes a record.
			prepareLynxHostBatch(
				container,
				batch(
					2,
					Array.from({ length: rows }, (_unused, index) => ({
						op: 'update' as const,
						id: rowIdsAt(index).raw,
						props: { value: `Renamed ${index}` },
					})),
				),
			).apply();

			// One host per row, not one row per row. Rewriting every row of a
			// 1,000-row list leaves the driver holding 1,001 records where an eager
			// mount holds 3,001 — a third, not all of it.
			expect(container.instanceCount - before).toBe(1 + rows);

			// The two hosts the update did not name are still declared, and the row
			// still paints from the values its own instance carries — the rewritten
			// one from the record, the rest from the run.
			const list = (container.page as unknown as Element).querySelector('#feed')!;
			globalThis.elementTree.enterListItemAtIndex(list as never, 815, 11, false);
			expect(list.firstElementChild?.textContent).toBe('Renamed 815');
			expect(list.firstElementChild?.getAttribute('item-key')).toBe('item-815');
			expect(container.instanceCount - before).toBe(1 + rows + 2);

			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		});
	});

	it('keeps a write to a declared row across a recycle', () => {
		withList(({ container }) => {
			// The invariant a release-on-enqueue optimization must not break. A row
			// the list has never shown is rewritten, shown, recycled away, and shown
			// again: the second paint has to be the written value, because the
			// declaration still holds the value the write replaced. Releasing a
			// promoted host back to its run on enqueue would paint `Row 3` here.
			prepareLynxHostBatch(container, batch(1, deferredListMount(50))).apply();
			prepareLynxHostBatch(
				container,
				batch(2, [{ op: 'update', id: rowIdsAt(3).raw, props: { value: 'Renamed 3' } }]),
			).apply();
			const list = (container.page as unknown as Element).querySelector('#feed')!;
			const sign = globalThis.elementTree.enterListItemAtIndex(list as never, 3, 11, false);
			expect(list.firstElementChild?.textContent).toBe('Renamed 3');

			globalThis.elementTree.leaveListItem(list as never, sign);
			globalThis.elementTree.enterListItemAtIndex(list as never, 9, 12, false);
			globalThis.elementTree.enterListItemAtIndex(list as never, 3, 13, false);
			expect([...list.children].map((child) => child.textContent)).toContain('Renamed 3');

			expect(disposeLynxHostContainer(container).errors).toEqual([]);
		});
	});

	it('holds what an eager mount holds once the list has been scrolled end to end', () => {
		// Deferral is deferral, not release: a row promotes when the list asks for
		// it and stays promoted after the cell is enqueued, so a list the user has
		// scrolled through converges on the eager count exactly rather than
		// approximately. That is the ceiling on this slice, and releasing an
		// unwritten host back to its declaration on enqueue is what would lift it.
		const rows = 200;
		const window = 12;
		const scrollThrough = (mount: readonly UniversalHostCommand[]): number =>
			withList(({ container }) => {
				const before = container.instanceCount;
				prepareLynxHostBatch(container, batch(1, mount)).apply();
				const list = (container.page as unknown as Element).querySelector('#feed')!;
				const signs: number[] = [];
				for (let index = 0; index < window; index++) {
					signs.push(globalThis.elementTree.enterListItemAtIndex(list as never, index, 11, false));
				}
				for (let index = window; index < rows; index++) {
					globalThis.elementTree.leaveListItem(list as never, signs.shift()!);
					signs.push(globalThis.elementTree.enterListItemAtIndex(list as never, index, 11, false));
				}
				const held = container.instanceCount - before;
				expect(disposeLynxHostContainer(container).errors).toEqual([]);
				return held;
			});

		const eagerMount: UniversalHostCommand[] = [
			{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
			...eagerRows(rows),
			{ op: 'insert', parent: null, id: 1, before: null },
		];
		expect(scrollThrough(deferredListMount(rows))).toBe(1 + rows * ROW_HOSTS);
		expect(scrollThrough(eagerMount)).toBe(1 + rows * ROW_HOSTS);
	});
});
