// The `target: 'lynx'` compiler backend lowers eligible host-only templates
// into straight-line create functions (docs/lynx-specialized-target-l0.md
// §3.2–§3.3). The consumer contract protected here: a module compiled under
// the lynx target renders the exact same first-screen host batch — commands,
// ids, listener ids, props, visibility — as the interpreted plan encoding, so
// background adoption identity is untouched by the representation change.
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compiler/compile.js';
import { lynxMainThreadRenderer } from '../../lynx/src/config.js';
import * as MainRenderer from '../../lynx/src/main-renderer.js';
import { createLynxNativeResource } from '../../lynx/src/resource.js';

const SOURCE = `/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useCallback, useState } from 'octane';

interface RowProps {
	label: string;
	active: boolean;
	onPick: () => void;
}

function Row(props: RowProps) @{
	<view class={['row', props.active && 'active']}>
		<text class="col-label" bindtap={props.onPick}>{props.label}</text>
		<text class="col-tail">{'x'}</text>
	</view>
}

export function Scene() @{
	const [items] = useState([
		{ id: 1, label: 'alpha', active: false },
		{ id: 2, label: 'beta', active: true },
	]);
	const [count, setCount] = useState(0);
	const pick = useCallback(() => {
		setCount(count + 1);
	}, [count]);

	<view class="page">
		<text class="title">{'Fixture · ' + String(count)}</text>
		<view class="rows" bindtap={pick}>
			@for (const item of items; key item.id) {
				<Row label={item.label} active={item.active} onPick={pick} />
			}
		</view>
	</view>
}
`;

type SceneComponent = Parameters<typeof MainRenderer.renderLynxFirstScreen>[0];

function compileSource(source: string, target: 'lynx' | 'universal'): string {
	return compile(source, '/src/Scene.lynx.tsrx', {
		hmr: false,
		renderer: { ...lynxMainThreadRenderer, target, id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread: 'main-thread' },
	}).code;
}

/** Every emitted template's slot-kind table, holes included as `null`. */
function slotTablesOf(code: string): (string | null)[][] {
	return [...code.matchAll(/"slots":\s*(\[[^\]]*\])/g)].map(
		(match) => JSON.parse(match[1]!.replace(/\s+/g, ' ')) as (string | null)[],
	);
}

function compileScene(target: 'lynx' | 'universal'): string {
	return compileSource(SOURCE, target);
}

function evaluateScene(compiled: string): SceneComponent {
	const rewritten = compiled
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx\/main-renderer["'];/g,
			(_match, specifiers: string) =>
				`const {${specifiers.replace(/\s+as\s+/g, ': ')}} = __universal;`,
		)
		.replace(/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx\/main-worklets["'];/g, '')
		.replace('export const Scene =', 'const Scene =');
	return new Function('__universal', `${rewritten}\nreturn Scene;`)(MainRenderer) as SceneComponent;
}

describe('lynx-target template emission', () => {
	it('emits create-function templates for host-only plans and keeps plan fallbacks', () => {
		const lynxCode = compileScene('lynx');
		const universalCode = compileScene('universal');
		expect(lynxCode).toContain('"kind": "template"');
		expect(lynxCode).toContain('"slots"');
		// The keyed @for body hole stays a plan (non-host root), proving mixed
		// modules keep the interpreted encoding where templates are ineligible.
		expect(lynxCode).toContain('{ "kind": "slot", "slot": 0 }');
		expect(universalCode).not.toContain('"kind": "template"');
	});

	it('marks every renderable hole as a range site', () => {
		// A slot kind selects which operation may write the slot, so a hole that
		// holds instantiated members must not look like one the writer sets in
		// place. Every renderable hole is the former: a bare expression can
		// evaluate to an array or a component just as a directive can, so all of
		// them are ranges and none is a scalar.
		const forms = {
			'cast text child': `<view class="a"><text class="l">{props.t as string}</text></view>`,
			'bare hole': `<view class="a"><text class="l">{props.t}</text></view>`,
			conditional: `<view class="a">@if (props.o) { <text class="b">{'s'}</text> }</view>`,
			keyed: `<view class="a">@for (const x of props.xs; key x) { <text class="b">{'s'}</text> }</view>`,
		};
		for (const [label, body] of Object.entries(forms)) {
			const slots = slotTablesOf(
				compileSource(
					`/** @jsxImportSource @octanejs/lynx/intrinsics */
export function P(props: { t: string; o: boolean; xs: string[] }) @{
	${body}
}
`,
					'lynx',
				),
			);
			const holes = slots.flat().filter((kind) => kind !== null && !kind.includes(':'));
			expect(holes, label).toEqual(holes.map(() => 'r'));
			expect(holes.length, label).toBeGreaterThan(0);
		}
	});

	it('keeps prop and event slot kinds naming the prop they write', () => {
		const kinds = new Set(slotTablesOf(compileScene('lynx')).flat());
		expect([...kinds].some((kind) => kind?.startsWith('p:'))).toBe(true);
		expect([...kinds].some((kind) => kind?.startsWith('e:'))).toBe(true);
		// The scene's only eligible template holds the keyed `@for`, so its
		// renderable hole is a range site and not a scalar.
		expect(kinds).toContain('r');
	});

	it('renders the identical first-screen batch through templates and plans', () => {
		const fromTemplates = MainRenderer.renderLynxFirstScreen(
			evaluateScene(compileScene('lynx')),
			{},
		);
		const fromPlans = MainRenderer.renderLynxFirstScreen(
			evaluateScene(compileScene('universal')),
			{},
		);
		expect(fromTemplates.hostCount).toBe(fromPlans.hostCount);
		expect(fromTemplates.logicalCount).toBe(fromPlans.logicalCount);
		expect(fromTemplates.batch).toEqual(fromPlans.batch);
		// The batch is real work, not an empty pass: the fixture mounts the
		// page chrome plus two keyed rows with listeners.
		const creates = fromPlans.batch.commands.filter((command) => command.op === 'create');
		const events = fromPlans.batch.commands.filter((command) => command.op === 'event');
		expect(creates.length).toBeGreaterThanOrEqual(10);
		expect(events.length).toBeGreaterThanOrEqual(3);
	});

	it('rejects native-resource event values identically under both encodings', () => {
		// Background-only native resources must fail loudly on the main thread
		// no matter which template representation carries the event prop.
		const resource = createLynxNativeResource('res');
		const planEncoded = MainRenderer.universalPlan('lynx', {
			kind: 'host',
			type: 'view',
			bindings: [['bindtap', 0]],
		});
		const templateEncoded = MainRenderer.universalPlan('lynx', {
			kind: 'template',
			slots: ['e:bindtap'],
			create: (env: any, values: readonly unknown[]) => {
				const n0 = env.h('view');
				env.e(n0, 'bindtap', values[0]);
				return n0;
			},
		} as never);
		for (const plan of [planEncoded, templateEncoded]) {
			const Scene = MainRenderer.defineUniversalComponent(
				'lynx',
				() => MainRenderer.universalValue(plan, [resource]),
				{ module: '@octanejs/lynx/main-renderer' },
			);
			expect(() => MainRenderer.renderLynxFirstScreen(Scene as never, {})).toThrowError(
				/native resource prop "bindtap" on <view>/,
			);
		}
	});

	it('rejects malformed template plans at freeze time', () => {
		expect(() =>
			MainRenderer.universalPlan('lynx', { kind: 'template', slots: [], create: 42 } as never),
		).toThrowError(/create function and a slots array/);
		expect(() =>
			MainRenderer.universalPlan('lynx', {
				kind: 'template',
				slots: 'nope',
				create: () => null,
			} as never),
		).toThrowError(/create function and a slots array/);
	});
});
