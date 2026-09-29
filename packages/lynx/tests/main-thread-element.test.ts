import { describe, expect, it, vi } from 'vitest';

import { createLynxMainThreadElement } from '../src/core/main-thread-element.js';
import { requireLynxMainThreadWorkletFeature } from '../src/core/main-thread-worklet-feature.js';
import { createLynxMainThreadRefDescriptor } from '../src/core/worklets.js';
import '../src/main-worklets.js';

describe('Lynx MainThread.Element adapter', () => {
	it('adapts an opaque Element PAPI handle and coalesces native flushes', async () => {
		const parent = { id: 'parent' };
		const child = { id: 'child' };
		const attributes = new Map<string, unknown>();
		const styles = new Map<string, string>();
		const flush = vi.fn();
		const animate = vi.fn();
		const target = {
			__SetAttribute(node: object, name: string, value: unknown) {
				expect(node).toBe(parent);
				attributes.set(name, value);
			},
			__AddInlineStyle(node: object, name: string, value: string) {
				expect(node).toBe(parent);
				styles.set(name, value);
			},
			__GetAttributeByName(node: object, name: string) {
				expect(node).toBe(parent);
				return attributes.get(name);
			},
			__GetAttributeNames(node: object) {
				expect(node).toBe(parent);
				return [...attributes.keys()];
			},
			__QuerySelector(node: object, selector: string) {
				expect(node).toBe(parent);
				return selector === '#child' ? child : null;
			},
			__QuerySelectorAll(node: object, selector: string) {
				expect(node).toBe(parent);
				return selector === '.child' ? [child] : [];
			},
			__GetComputedStyleByKey(node: object, name: string) {
				expect(node).toBe(parent);
				return styles.get(name) ?? '';
			},
			__InvokeUIMethod(
				node: object,
				method: string,
				params: Readonly<Record<string, unknown>>,
				callback: (result: { code: number; data?: unknown }) => void,
			) {
				expect(node).toBe(parent);
				callback({ code: 0, data: { method, params } });
			},
			__ElementAnimate: animate,
			__FlushElementTree: flush,
		};
		const element = createLynxMainThreadElement(parent, target);
		expect(Object.keys(element)).toEqual([]);

		element.setAttribute('data-owner', 'row-0');
		element.setStyleProperty('background-color', 'green');
		element.setStyleProperties({ width: '10px', height: '20px' });
		expect(element.getAttribute('data-owner')).toBe('row-0');
		expect(element.getAttributeNames()).toEqual(['data-owner']);
		expect(element.getComputedStyleProperty('width')).toBe('10px');
		expect(element.querySelector('#missing')).toBeNull();
		expect(element.querySelector('#child')?.getAttributeNames).toBeTypeOf('function');
		expect(element.querySelectorAll('.child')).toHaveLength(1);
		const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], 120);
		expect(Object.keys(animation)).toEqual(['id', 'effect']);
		expect(animate).toHaveBeenLastCalledWith(parent, [
			0,
			animation.id,
			[{ opacity: 0 }, { opacity: 1 }],
			{ duration: 120 },
		]);
		animation.pause();
		expect(animate).toHaveBeenLastCalledWith(parent, [2, animation.id]);
		animation.play();
		expect(animate).toHaveBeenLastCalledWith(parent, [1, animation.id]);
		animation.cancel();
		expect(animate).toHaveBeenLastCalledWith(parent, [3, animation.id]);
		expect(flush).not.toHaveBeenCalled();
		await expect(element.invoke('measure', { relativeTo: 'screen' })).resolves.toEqual({
			method: 'measure',
			params: { relativeTo: 'screen' },
		});

		await Promise.resolve();
		expect(flush).toHaveBeenCalledOnce();
	});

	it('flushes each main-thread global that scheduled work in the same turn', async () => {
		const first = { __SetAttribute: vi.fn(), __FlushElementTree: vi.fn() };
		const second = { __SetAttribute: vi.fn(), __FlushElementTree: vi.fn() };

		createLynxMainThreadElement({ id: 'a' }, first).setAttribute('data-a', 1);
		createLynxMainThreadElement({ id: 'b' }, second).setAttribute('data-b', 2);
		createLynxMainThreadElement({ id: 'c' }, first).setAttribute('data-c', 3);
		await Promise.resolve();

		expect(first.__FlushElementTree).toHaveBeenCalledOnce();
		expect(second.__FlushElementTree).toHaveBeenCalledOnce();
	});

	it('binds mounted host refs to the registry element target', async () => {
		const node = { id: 'owner' };
		const target = { __SetAttribute: vi.fn(), __FlushElementTree: vi.fn() };
		const registry = requireLynxMainThreadWorkletFeature().createRegistry({
			elementTarget: target,
		});
		const ref = createLynxMainThreadRefDescriptor('test:element-target');
		const cell = registry.retainRef<{ setAttribute(name: string, value: unknown): void } | null>(
			ref,
			null,
		);

		registry.mountRef(ref, node);
		cell.current!.setAttribute('data-owner', 'row-0');
		await Promise.resolve();

		expect(target.__SetAttribute).toHaveBeenCalledWith(node, 'data-owner', 'row-0');
		expect(target.__FlushElementTree).toHaveBeenCalledOnce();
		registry.releaseRef(ref);
		registry.close();
	});

	it('rejects a missing native method at the call boundary', () => {
		const element = createLynxMainThreadElement({}, {});
		expect(() => element.setAttribute('data-owner', 'row-0')).toThrow(
			/MainThread\.Element requires __SetAttribute/,
		);
	});
});
