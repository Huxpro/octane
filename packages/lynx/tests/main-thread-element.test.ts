import { describe, expect, it, vi } from 'vitest';

import { createLynxMainThreadElement } from '../src/core/main-thread-element.js';

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

	it('rejects a missing native method at the call boundary', () => {
		const element = createLynxMainThreadElement({}, {});
		expect(() => element.setAttribute('data-owner', 'row-0')).toThrow(
			/MainThread\.Element requires __SetAttribute/,
		);
	});
});
