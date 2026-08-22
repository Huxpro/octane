// Issue-#135 item 1 — the compiler's plan is one pass away from the program a
// block mount runs.
//
// `benchmarks/lynx-table/app/src/block-program.ts` hand-writes two
// `compileLynxBlockTemplate` programs, a page and a row, and every number the
// `octane-block` cell reports is read through them. #135 item 1 asks for the
// compiler and a hook-cell layer to produce those instead. This file pins the
// half of that claim that needs no hook cell, because it is the half that
// decides whether the other half is worth building: given the plan the
// compiler already emits for a component at the Lynx *background* target, the
// extracted lowering produces exactly the program the benchmark wrote by hand
// — same nodes, same parents, same static props, same binding order, same
// event sites.
//
// Two things this deliberately does not do:
//
//   * It does not run the components. A plan is module-level, so the wire
//     program is decidable without an owner, a root, or a hook cell; keeping
//     those out is what makes the failure legible when it comes.
//   * It does not compare against the benchmark's source. The expected
//     programs are written out here, because a test that imported
//     `benchmarks/` would fail for reasons that are not this claim's.
//
// The `#text` nodes are the reason the lowering is a runtime pass rather than
// a compiler backend, and the reason this test is about the *plan* rather than
// the emitted module: the compiler emits `{kind: 'slot'}` for every dynamic
// child hole, because a hole in the universal encoding is a renderable one. Its
// text-ness is a property of the value. See `universal-template-program.ts`.
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compiler/compile.js';
// Through the published subpath, not a relative path: the point of the
// extraction is that a bundle which does not carry the universal core can still
// perform the lowering, and only the export map can say so.
import {
	compiledUniversalTemplateProgram,
	createUniversalHostEncoder,
	prepareUniversalTemplateProgram,
	prepareUniversalTemplateProgramValues,
} from 'octane/universal/template-program';
import type { UniversalHostPlan, UniversalPlan } from 'octane/universal/native';

import { lynxBackgroundRenderer } from '../../lynx/src/config.runtime.js';
import {
	createLynxClientContainer,
	createLynxClientDriver,
	setLynxClientCapabilities,
} from '../../lynx/src/core/client-driver.js';
import { compileLynxBlockTemplate } from '../../lynx/src/core/block-core.js';
import * as Renderer from '../../lynx/src/renderer.js';

// The bench page and row, reduced to two buttons and the parts that carry a
// slot. Everything the lowering decides — static prop, bound prop, event,
// static text, dynamic text, range site — appears at least once.
const SOURCE = `interface RowProps {
	row: { id: number; label: string };
	isSelected: boolean;
	onSelect: (id: number) => void;
	onRemove: (id: number) => void;
}

function Row(props: RowProps) @{
	<view class={['row', props.isSelected && 'danger']}>
		<text class="col-id">{String(props.row.id)}</text>
		<text class="col-label" bindtap={() => props.onSelect(props.row.id)}>{props.row.label}</text>
		<text class="col-remove" bindtap={() => props.onRemove(props.row.id)}>{'x'}</text>
	</view>
}

export function Page(props: { rows: RowProps['row'][]; onCreate: () => void; onClear: () => void }) @{
	<view class="page">
		<text class="title">{'Octane UI Benchmark on Lynx · ready'}</text>
		<view class="toolbar">
			<view class="btn" bindtap={props.onCreate}>
				<text class="btn-text">{'Create 1,000 rows'}</text>
			</view>
			<view class="btn" bindtap={props.onClear}>
				<text class="btn-text">{'Clear'}</text>
			</view>
		</view>
		<view class="rows">
			@for (const row of props.rows; key row.id) {
				<Row row={row} isSelected={false} onSelect={() => {}} onRemove={() => {}} />
			}
		</view>
	</view>
}
`;

/**
 * Every plan the compiled module declares, in declaration order.
 *
 * The module is evaluated rather than pattern-matched so that a compiler that
 * stopped emitting a plan — or emitted one the runtime rejects — fails here
 * instead of passing a regex.
 */
function compiledPlans(): UniversalPlan[] {
	const { code } = compile(SOURCE, '/src/Bench.lynx.tsrx', {
		hmr: false,
		renderer: { ...lynxBackgroundRenderer, id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread: 'background' },
	});
	const rewritten = code
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx(?:\/[\w-]+)?["'];/g,
			(_match, specifiers: string) =>
				`const {${specifiers.replace(/\s+as\s+/g, ': ')}} = __universal;`,
		)
		// The module is run as a function body, which has no export syntax.
		.replace(/^export /gm, '');
	const plans: UniversalPlan[] = [];
	const universal = {
		...Renderer,
		universalPlan(renderer: string, root: unknown) {
			const plan = Renderer.universalPlan(renderer, root as never);
			plans.push(plan);
			return plan;
		},
	};
	new Function('__universal', rewritten)(universal);
	return plans;
}

/** A driver whose peer has negotiated template-program mounts. */
function lynxEncoder() {
	const container = createLynxClientContainer({ createSelectorQuery: () => ({}) as never });
	setLynxClientCapabilities(container, {
		templateMount: 1,
		templateProgram: 1,
		templateRuns: 1,
	} as never);
	return createUniversalHostEncoder({
		driver: createLynxClientDriver(container),
		container,
		renderer: 'lynx',
		resourceRoot: 1,
		transported: true,
	});
}

function lower(plan: UniversalPlan) {
	const compiled = compiledUniversalTemplateProgram(plan.root as UniversalHostPlan);
	expect(compiled).not.toBeNull();
	const prepared = prepareUniversalTemplateProgram(lynxEncoder(), compiled!);
	expect(prepared).not.toBeNull();
	return { compiled: compiled!, prepared: prepared! };
}

describe('lynx block template lowering', () => {
	const plans = compiledPlans();

	const ROW = 0;
	const PAGE = 2;

	it('declares three plans: Row, the @for body, and the page', () => {
		// Not incidental — everything below indexes these, and the middle one is
		// easy to forget: a `@for` body is its own plan even when it is a single
		// component hole, so the page is plans[2] rather than plans[1].
		expect(plans.map((plan) => (plan.root as { kind: string }).kind)).toEqual([
			'host',
			'slot',
			'host',
		]);
		expect((plans[ROW]!.root as UniversalHostPlan).type).toBe('view');
		expect((plans[PAGE]!.root as UniversalHostPlan).type).toBe('view');
	});

	it('lowers Row to the row template block-program.ts hand-writes', () => {
		const { prepared } = lower(plans[ROW]!);
		// `benchmarks/lynx-table/app/src/block-program.ts`, `rowTemplate()`, with
		// one difference the hand-written program got wrong rather than the
		// lowering: it declares `priority: 'default'` for its two tap sites, and
		// the Lynx driver classifies `tap` as discrete. The lowering asks the
		// driver, so it cannot drift from what the component path dispatches.
		expect(prepared.wire).toEqual({
			nodes: [
				{ type: 'view', parent: -1, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
				{ type: 'text', parent: 0, props: { class: 'col-id' } },
				{
					type: '#text',
					parent: 1,
					props: {},
					bindings: [{ name: 'value', valueIndex: 1 }],
				},
				{ type: 'text', parent: 0, props: { class: 'col-label' } },
				{
					type: '#text',
					parent: 3,
					props: {},
					bindings: [{ name: 'value', valueIndex: 2 }],
				},
				{ type: 'text', parent: 0, props: { class: 'col-remove' } },
				{ type: '#text', parent: 5, props: { value: 'x' } },
			],
			events: [
				{ node: 3, type: 'bindtap', priority: 'discrete' },
				{ node: 5, type: 'bindtap', priority: 'discrete' },
			],
		});
	});

	it('gives Row the slot order the hand-written program indexes by', () => {
		// `ROW_CLASS_SLOT = 0` and `ROW_LABEL_SLOT = 2` are how every scoped write
		// in the benchmark addresses a row. A lowering that produced the same seven
		// nodes in another binding order would silently write the wrong column.
		const { prepared } = lower(plans[ROW]!);
		expect(prepared.values.map((value) => `${value.node}:${value.name}`)).toEqual([
			'0:class',
			'2:value',
			'4:value',
		]);
		expect(prepared.events.map((event) => `${event.node}:${event.prop}`)).toEqual([
			'3:bindtap',
			'5:bindtap',
		]);
	});

	it('lowers the page to a run whose last node is the keyed range site', () => {
		const { prepared } = lower(plans[PAGE]!);
		const types = prepared.wire.nodes.map((node) => `${node.parent}>${node.type}`);
		expect(types).toEqual([
			'-1>view', // .page
			'0>text', // .title
			'1>#text', // "Octane UI Benchmark on Lynx · ready"
			'0>view', // .toolbar
			'3>view', // .btn
			'4>text', // .btn-text
			'5>#text', // "Create 1,000 rows"
			'3>view', // .btn
			'7>text', // .btn-text
			'8>#text', // "Clear"
			'0>view', // .rows
			'10>#text', // the @for range site — see below
		]);
		expect(prepared.wire.events).toEqual([
			{ node: 4, type: 'bindtap', priority: 'discrete' },
			{ node: 7, type: 'bindtap', priority: 'discrete' },
		]);
	});

	it('declines the page instance, because its range site is not text', () => {
		// The hand-written page template stops at `.rows` and opens a keyed range
		// on it (`openForSlot(page, rowsNode)`). The lowering cannot: a plan says
		// `{kind: 'slot'}` for the `@for` exactly as it does for `{row.label}`, so
		// the shape pass describes it as a `#text` child and only the *value* can
		// tell the two apart. It does, and refuses — which is the seam a range-site
		// lowering has to fill, and the reason this cell of #135 item 1 is not
		// finished by this file.
		const { compiled, prepared } = lower(plans[PAGE]!);
		const forValue = Renderer.universalFor(
			[{ id: 1, label: 'a' }],
			(row: { id: number }) => row.id,
			() => null,
		);
		const values = prepareUniversalTemplateProgramValues(lynxEncoder(), compiled, prepared, [
			() => {},
			() => {},
			forValue,
		]);
		expect(values).toBeNull();
	});

	it('produces a program the Block core accepts', () => {
		// The lowering and `compileLynxBlockTemplate` are two independent readers
		// of the same wire shape. This is the one assertion that they agree.
		const { prepared } = lower(plans[ROW]!);
		const template = compileLynxBlockTemplate(prepared.wire);
		expect(template.hostCount).toBe(7);
		expect(template.valueCount).toBe(3);
		expect(template.eventCount).toBe(2);
		expect(template.valueNodes).toEqual([0, 2, 4]);
		expect(template.valueNames).toEqual(['class', 'value', 'value']);
		expect(template.mainThreadValues).toBeNull();
	});
});
