import { describe, expect, it, vi } from 'vitest';

import {
	createLynxElementTemplateNativeBudget,
	lynxElementTemplateBudgetIsBounded,
	LYNX_ELEMENT_TEMPLATE_PENDING_NATIVE_COST_LIMIT,
	LYNX_ELEMENT_TEMPLATE_RESIDENT_INSTANCE_LIMIT,
	LYNX_ELEMENT_TEMPLATE_RESIDENT_NATIVE_COST_LIMIT,
} from '../src/core/element-template-native-budget.js';
import type {
	LynxElementTemplateHandle,
	LynxElementTemplatePAPI,
} from '../src/core/element-template-papi.js';

function host() {
	const flush = vi.fn();
	const papi = { flush } as unknown as LynxElementTemplatePAPI<LynxElementTemplateHandle>;
	return { budget: createLynxElementTemplateNativeBudget(papi), flush };
}

describe('Element Template native-operation budget', () => {
	it('drains queued painting work with a layout barrier before the JNI-safe boundary', () => {
		const { budget, flush } = host();
		const operations: string[] = [];

		budget.run(LYNX_ELEMENT_TEMPLATE_PENDING_NATIVE_COST_LIMIT, () => operations.push('first'));
		expect(flush).not.toHaveBeenCalled();
		budget.run(1, () => operations.push('second'));

		expect(operations).toEqual(['first', 'second']);
		expect(flush).toHaveBeenCalledTimes(1);
		expect(flush).toHaveBeenLastCalledWith(undefined, { triggerLayout: true });

		budget.flush({});
		expect(flush).toHaveBeenLastCalledWith(undefined, {});
		budget.run(LYNX_ELEMENT_TEMPLATE_PENDING_NATIVE_COST_LIMIT, () => undefined);
		expect(flush).toHaveBeenCalledTimes(2);
	});

	it('rejects a single unbounded operation before calling native code', () => {
		const { budget } = host();
		const operation = vi.fn();
		expect(() =>
			budget.run(LYNX_ELEMENT_TEMPLATE_PENDING_NATIVE_COST_LIMIT + 1, operation),
		).toThrow(/operation cost/);
		expect(operation).not.toHaveBeenCalled();
	});

	it('caps and releases live native template ownership independently', () => {
		const { budget } = host();
		budget.reserveResident(LYNX_ELEMENT_TEMPLATE_RESIDENT_INSTANCE_LIMIT);
		expect(() => budget.reserveResident()).toThrow(/cannot retain more than/);
		budget.releaseResident(LYNX_ELEMENT_TEMPLATE_RESIDENT_INSTANCE_LIMIT);
		expect(() => budget.reserveResident()).not.toThrow();
		expect(() => budget.releaseResident(2)).toThrow(/unreserved resident count/);
	});

	it('caps compiler-proved resident native nodes before the weak-reference table', () => {
		const { budget } = host();
		budget.reserveResident(1, LYNX_ELEMENT_TEMPLATE_RESIDENT_NATIVE_COST_LIMIT);
		expect(() => budget.reserveResident(1, 1)).toThrow(/native nodes/);
		budget.releaseResident(1, LYNX_ELEMENT_TEMPLATE_RESIDENT_NATIVE_COST_LIMIT);
		expect(() => budget.reserveResident(1, 1)).not.toThrow();
	});

	it('leaves non-Android engines unbounded: no layout barrier and no resident cap', () => {
		const flush = vi.fn();
		const papi = { flush } as unknown as LynxElementTemplatePAPI<LynxElementTemplateHandle>;
		const budget = createLynxElementTemplateNativeBudget(papi, { bounded: false });
		expect(budget.bounded).toBe(false);
		for (let index = 0; index < 4; index++) {
			budget.run(LYNX_ELEMENT_TEMPLATE_PENDING_NATIVE_COST_LIMIT, () => undefined);
		}
		expect(flush).not.toHaveBeenCalled();
		budget.reserveResident(
			LYNX_ELEMENT_TEMPLATE_RESIDENT_INSTANCE_LIMIT + 1,
			LYNX_ELEMENT_TEMPLATE_RESIDENT_NATIVE_COST_LIMIT + 1,
		);
		budget.releaseResident(
			LYNX_ELEMENT_TEMPLATE_RESIDENT_INSTANCE_LIMIT + 1,
			LYNX_ELEMENT_TEMPLATE_RESIDENT_NATIVE_COST_LIMIT + 1,
		);
		expect(() => budget.releaseResident()).toThrow(/unreserved resident count/);
		budget.flush({});
		expect(flush).toHaveBeenCalledWith(undefined, {});
	});

	it('bounds only the Android engine, whose JNI tables charge per native node', () => {
		expect(createLynxElementTemplateNativeBudget({ flush: vi.fn() } as never).bounded).toBe(true);
		expect(lynxElementTemplateBudgetIsBounded({ SystemInfo: { platform: 'Android' } })).toBe(true);
		expect(
			lynxElementTemplateBudgetIsBounded({ lynx: { SystemInfo: { platform: 'android' } } }),
		).toBe(true);
		expect(lynxElementTemplateBudgetIsBounded({ SystemInfo: { platform: 'iOS' } })).toBe(false);
		expect(lynxElementTemplateBudgetIsBounded({ SystemInfo: { platform: 'web' } })).toBe(false);
		expect(lynxElementTemplateBudgetIsBounded({})).toBe(false);
	});
});
