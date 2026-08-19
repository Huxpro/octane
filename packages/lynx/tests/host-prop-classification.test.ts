import { describe, expect, it } from 'vitest';
import {
	LYNX_CSS_SCOPE_PROP,
	classifyLynxHostPropUpdate,
	planLynxHostPropPatch,
} from '../src/core/host-props.js';

/**
 * `updates.classify` used to run the full prop planner and keep one boolean.
 * These cases pin the replacement against the planner it replaced: for the same
 * inputs the two must agree on the verdict and on the exact error, so the
 * cheaper path can never accept an update the planner would have rejected or
 * relocate a validation to the main thread.
 */
type Outcome = { readonly kind: string } | { readonly error: string };

function planned(
	type: string,
	previous: Record<string, unknown>,
	next: Record<string, unknown>,
): Outcome {
	try {
		return {
			kind: planLynxHostPropPatch(type, previous, next).requiresRecreate ? 'recreate' : 'update',
		};
	} catch (error) {
		return { error: (error as Error).message };
	}
}

function classified(
	type: string,
	previous: Record<string, unknown>,
	next: Record<string, unknown>,
): Outcome {
	try {
		return { kind: classifyLynxHostPropUpdate(type, previous, next) };
	} catch (error) {
		return { error: (error as Error).message };
	}
}

const scope = { cssId: 1185352, entryName: 'lazy-card' };
const otherScope = { cssId: 42, entryName: 'other-card' };
const tap = { _wkltId: 'card.tsrx:tap', _c: { count: 1 } };
const ref = { _wvid: 'card:ref' };

/** Prop bags reachable from ordinary `.tsrx`, plus every rejection path. */
const FRAGMENTS: readonly (readonly [string, Record<string, unknown>])[] = [
	['empty', {}],
	['class-string', { class: 'row' }],
	['class-array', { class: ['row', 'selected'] }],
	['className', { className: 'row' }],
	['id', { id: 'row-1' }],
	['id-number', { id: 7 }],
	['attributes', { title: 'a', 'aria-label': 'b' }],
	['hidden', { hidden: true }],
	['style-string', { style: 'width:10rpx' }],
	['style-object', { style: { width: '10rpx', backgroundColor: 'red' } }],
	['style-bad-length', { style: { width: '10cm' } }],
	['style-bad-type', { style: 7 }],
	['dataset', { 'data-index': 1, 'data-name': 'a' }],
	['dataset-empty-key', { 'data-': 1 }],
	['scope', { [LYNX_CSS_SCOPE_PROP]: scope }],
	['scope-other', { [LYNX_CSS_SCOPE_PROP]: otherScope }],
	['scope-bare-id', { [LYNX_CSS_SCOPE_PROP]: 1185352 }],
	['scope-bad', { [LYNX_CSS_SCOPE_PROP]: { cssId: 1.5 } }],
	['native-event', { bindtap: 42 }],
	['main-thread-event', { 'main-thread:bindtap': tap }],
	['main-thread-event-bad', { 'main-thread:bindtap': 42 }],
	['main-thread-event-conflict', { 'main-thread:bindtap': tap, bindtap: 9 }],
	['main-thread-ref', { 'main-thread:ref': ref }],
	['main-thread-ref-bad', { 'main-thread:ref': 42 }],
	['nodes-ref', { 'octane-ref': 'foreign-selector' }],
	['reserved-namespace', { 'foreign:bindtap': 1 }],
	['reserved-ref', { ref: 9 }],
	['text-value', { value: 'first' }],
	['text-value-scope', { value: 'first', [LYNX_CSS_SCOPE_PROP]: scope }],
	['image-src', { src: '/logo.png' }],
	['image-src-bad', { src: { $$kind: 'octane.universal.resource', id: 1 } }],
	['image-placeholder', { placeholder: 'data:image/png;base64,AA==' }],
];

const TYPES = ['view', 'text', '#text', 'raw-text', 'image', 'scroll-view', 'list-item'] as const;

describe('Lynx host prop update classification', () => {
	it('agrees with the prop planner on every type × fragment pair, errors included', () => {
		let cases = 0;
		let recreates = 0;
		let errors = 0;
		for (const type of TYPES) {
			for (const [previousName, previous] of FRAGMENTS) {
				for (const [nextName, next] of FRAGMENTS) {
					const expected = planned(type, previous, next);
					const actual = classified(type, previous, next);
					expect(actual, `${type}: ${previousName} -> ${nextName}`).toEqual(expected);
					cases++;
					if ('error' in expected) errors++;
					else if (expected.kind === 'recreate') recreates++;
				}
			}
		}
		// Guard the corpus itself: a refactor that stopped reaching the recreate
		// verdict or the rejection paths would make the agreement vacuous.
		expect(cases).toBe(TYPES.length * FRAGMENTS.length * FRAGMENTS.length);
		expect(recreates).toBeGreaterThan(20);
		expect(errors).toBeGreaterThan(200);
	});

	it('agrees on merged bags, so one bad prop cannot hide behind a valid neighbour', () => {
		// Bases chosen so the merged bag is compared against an empty host, a host
		// that already carries a scope (the only recreate trigger), and a host with
		// unrelated attributes that the diff must walk past.
		const bases: readonly (readonly [string, Record<string, unknown>])[] = [
			['empty', {}],
			['scope', { [LYNX_CSS_SCOPE_PROP]: scope }],
			['attributes', { title: 'a', id: 'row-1', class: 'row' }],
		];
		for (const type of TYPES) {
			for (const [leftName, left] of FRAGMENTS) {
				for (const [rightName, right] of FRAGMENTS) {
					const merged = { ...left, ...right };
					for (const [baseName, base] of bases) {
						expect(
							classified(type, base, merged),
							`${type}: ${baseName} -> ${leftName}+${rightName}`,
						).toEqual(planned(type, base, merged));
						expect(
							classified(type, merged, base),
							`${type}: ${leftName}+${rightName} -> ${baseName}`,
						).toEqual(planned(type, merged, base));
					}
				}
			}
		}
	});

	it('reports recreate exactly when a CSS scope is cleared', () => {
		expect(classifyLynxHostPropUpdate('view', { [LYNX_CSS_SCOPE_PROP]: scope }, {})).toBe(
			'recreate',
		);
		expect(classifyLynxHostPropUpdate('view', {}, { [LYNX_CSS_SCOPE_PROP]: scope })).toBe('update');
		expect(
			classifyLynxHostPropUpdate(
				'view',
				{ [LYNX_CSS_SCOPE_PROP]: scope },
				{ [LYNX_CSS_SCOPE_PROP]: otherScope },
			),
		).toBe('update');
		expect(
			classifyLynxHostPropUpdate(
				'#text',
				{ value: 'a', [LYNX_CSS_SCOPE_PROP]: scope },
				{ value: 'b' },
			),
		).toBe('recreate');
	});

	it('keeps rejecting the props the planner rejects', () => {
		expect(() => classifyLynxHostPropUpdate('view', {}, { 'octane-ref': 'x' })).toThrow(
			/reserved for generation-scoped query handles/,
		);
		expect(() => classifyLynxHostPropUpdate('view', {}, { 'main-thread:bindtap': 42 })).toThrow(
			/main-thread worklet descriptor/,
		);
		expect(() => classifyLynxHostPropUpdate('raw-text', {}, { 'main-thread:ref': ref })).toThrow(
			/raw-text hosts cannot own direct main-thread prop/,
		);
		expect(() => classifyLynxHostPropUpdate('view', {}, { 'data-': 1 })).toThrow(
			/requires a non-empty key/,
		);
		expect(() => classifyLynxHostPropUpdate('view', {}, { style: { width: '10cm' } })).toThrow(
			/unsupported Lynx length/,
		);
		expect(() =>
			classifyLynxHostPropUpdate(
				'image',
				{},
				{ src: { $$kind: 'octane.universal.resource', id: 1 } },
			),
		).toThrow(/bundled URL string/);
		expect(() =>
			classifyLynxHostPropUpdate('view', {}, { [LYNX_CSS_SCOPE_PROP]: { cssId: 1.5 } }),
		).toThrow(/safe integer/);
	});
});
