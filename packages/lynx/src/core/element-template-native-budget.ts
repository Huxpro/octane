declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type {
	LynxElementTemplateHandle,
	LynxElementTemplatePAPI,
} from './element-template-papi.js';

const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const CODE = 'Octane Lynx OL512';

// Android's JNI global-reference tables are capped at 51,200 entries. Lynx 4.1
// retains pending PaintingContext callbacks in one table and live native/shadow
// nodes in another. Bound each category independently, leaving headroom in its
// corresponding table for the host, DevTool, bridge, and measurement
// uncertainty. The queued-work limit also bounds each DevTool DOM notification
// burst on instrumented builds.
export const LYNX_ELEMENT_TEMPLATE_PENDING_NATIVE_COST_LIMIT = 8_192;
export const LYNX_ELEMENT_TEMPLATE_RESIDENT_INSTANCE_LIMIT = 32_768;
export const LYNX_ELEMENT_TEMPLATE_RESIDENT_NATIVE_COST_LIMIT = 40_960;

// Android 4.1 retains the queued JNI callbacks when triggerLayout is false.
// A layout-triggering flush is therefore the only public PAPI safety barrier.
const INTERMEDIATE_FLUSH_OPTIONS = Object.freeze({ triggerLayout: true });

function fail(message: string): never {
	throw new RangeError(DEVELOPMENT ? `Octane Lynx Element Template budget ${message}.` : CODE);
}

export interface LynxElementTemplateNativeBudget {
	run<T>(cost: number, operation: () => T): T;
	reserveResident(count?: number, nativeCost?: number): void;
	releaseResident(count?: number, nativeCost?: number): void;
	flush(options?: Readonly<Record<string, unknown>>): void;
}

/** Bound queued painting work and live template handles before they reach JNI. */
export function createLynxElementTemplateNativeBudget<Handle extends LynxElementTemplateHandle>(
	papi: LynxElementTemplatePAPI<Handle>,
): LynxElementTemplateNativeBudget {
	let pendingCost = 0;
	let residents = 0;
	let residentNativeCost = 0;

	const flush = (options?: Readonly<Record<string, unknown>>): void => {
		papi.flush(undefined, options);
		pendingCost = 0;
	};
	return Object.freeze({
		run<T>(cost: number, operation: () => T): T {
			if (
				!Number.isSafeInteger(cost) ||
				cost <= 0 ||
				cost > LYNX_ELEMENT_TEMPLATE_PENDING_NATIVE_COST_LIMIT
			) {
				fail(
					`requires an operation cost between 1 and ${LYNX_ELEMENT_TEMPLATE_PENDING_NATIVE_COST_LIMIT}`,
				);
			}
			if (
				pendingCost !== 0 &&
				pendingCost + cost > LYNX_ELEMENT_TEMPLATE_PENDING_NATIVE_COST_LIMIT
			) {
				flush(INTERMEDIATE_FLUSH_OPTIONS);
			}
			pendingCost += cost;
			return operation();
		},
		reserveResident(count = 1, nativeCost = count): void {
			if (
				!Number.isSafeInteger(count) ||
				count <= 0 ||
				!Number.isSafeInteger(nativeCost) ||
				nativeCost <= 0
			) {
				fail('requires positive resident instance and native-node counts');
			}
			if (residents + count > LYNX_ELEMENT_TEMPLATE_RESIDENT_INSTANCE_LIMIT) {
				fail(`cannot retain more than ${LYNX_ELEMENT_TEMPLATE_RESIDENT_INSTANCE_LIMIT} instances`);
			}
			if (residentNativeCost + nativeCost > LYNX_ELEMENT_TEMPLATE_RESIDENT_NATIVE_COST_LIMIT) {
				fail(
					`cannot retain more than ${LYNX_ELEMENT_TEMPLATE_RESIDENT_NATIVE_COST_LIMIT} native nodes`,
				);
			}
			residents += count;
			residentNativeCost += nativeCost;
		},
		releaseResident(count = 1, nativeCost = count): void {
			if (
				!Number.isSafeInteger(count) ||
				count <= 0 ||
				count > residents ||
				!Number.isSafeInteger(nativeCost) ||
				nativeCost <= 0 ||
				nativeCost > residentNativeCost
			) {
				fail('cannot release an unreserved resident count');
			}
			residents -= count;
			residentNativeCost -= nativeCost;
		},
		flush,
	});
}
