import type {
	UniversalHostPlan,
	UniversalHostTemplateProgram,
	UniversalProgramPlan,
} from 'octane/universal/native';
import {
	compiledUniversalTemplateProgram,
	createUniversalHostEncoder,
	prepareUniversalTemplateProgram,
	prepareUniversalTemplateProgramValues,
} from 'octane/universal/template-program';
import { describe, expect, it } from 'vitest';

import {
	createLynxClientContainer,
	createLynxClientDriver,
	setLynxClientCapabilities,
} from '../src/core/client-driver.compiled-program.js';
import {
	createContext,
	defineUniversalComponent,
	memo,
	renderLynxFirstScreen,
	universalActivity,
	universalComponent,
	universalContext,
	universalIf,
	universalPlan,
	universalSwitch,
	universalValue,
	useContext,
} from '../src/main-renderer.compiled-program.js';

const WIRE: UniversalHostTemplateProgram = {
	nodes: [
		{
			type: 'view',
			parent: -1,
			props: {},
			bindings: [
				{ name: 'class', valueIndex: 0 },
				{ name: 'id', valueIndex: 1 },
			],
		},
		{
			type: 'text',
			parent: 0,
			props: {},
			bindings: [{ name: 'text', valueIndex: 2 }],
		},
	],
	events: [],
};

const PLAN: UniversalProgramPlan = {
	kind: 'program',
	slots: ['p:class', 'p:id', 'p:text'],
	nodes: 2,
	values: [0, 1, 2],
	events: [],
	ranges: [],
	wire: WIRE,
	bind: () => {
		throw new Error('This renderer test does not paint.');
	},
};

describe('@octanejs/lynx compact compiled-program renderer', () => {
	it('normalizes every resident value exactly once before the scalar transport', () => {
		const plan = universalPlan('lynx', PLAN);
		const authoredClass = ['row', { active: true, disabled: false }] as const;
		const authoredText = { not: 'a string' };
		const App = defineUniversalComponent('lynx', () =>
			universalValue(plan, [authoredClass, 42, authoredText]),
		);

		const result = renderLynxFirstScreen(App, {});
		const node = result.nodes[0]!;
		expect(node.kind).toBe('program');
		expect(node.values).toEqual([authoredClass, 42, authoredText]);
		expect(node.selectedValues).toEqual(['row active', '42', '']);
	});

	it('materializes only the selected if and switch branches as stable ranges', () => {
		const plan = universalPlan('lynx', PLAN);
		const program = (label: string) => universalValue(plan, [label, label, label]);
		const executions: string[] = [];
		const branch = (label: string) => () => {
			executions.push(label);
			return program(label);
		};
		const App = defineUniversalComponent('lynx', (props: { show: boolean; mode: string }) => [
			universalIf(props.show, branch('then'), branch('else')),
			universalSwitch(props.mode, [['case', branch('case')]], branch('default')),
		]);

		const selected = renderLynxFirstScreen(App, { show: true, mode: 'case' });
		expect(executions).toEqual(['then', 'case']);
		expect(selected.nodes.map((node) => node.kind)).toEqual(['range', 'range']);
		expect(selected.nodes.map((node) => node.children[0]?.selectedValues)).toEqual([
			['then', 'then', 'then'],
			['case', 'case', 'case'],
		]);

		executions.length = 0;
		const fallback = renderLynxFirstScreen(App, { show: false, mode: 'other' });
		expect(executions).toEqual(['else', 'default']);
		expect(fallback.nodes.map((node) => node.kind)).toEqual(['range', 'range']);
		expect(fallback.nodes.map((node) => node.children[0]?.selectedValues)).toEqual([
			['else', 'else', 'else'],
			['default', 'default', 'default'],
		]);
	});

	it('retains hidden Activity programs without announcing their events', () => {
		const eventPlan = universalPlan('lynx', {
			...PLAN,
			events: [{ slot: 3, node: 1, type: 'bindtap', priority: 'discrete' }],
		});
		const onTap = () => {};
		const program = (label: string) => universalValue(eventPlan, [label, label, label, onTap]);
		const App = defineUniversalComponent('lynx', () => [
			universalActivity('hidden', () => universalActivity('visible', () => program('hidden'))),
			universalActivity('visible', () => program('visible')),
		]);

		const result = renderLynxFirstScreen(App, {});
		expect(result.nodes[0]?.children[0]?.children[0]?.visibility).toBe('hidden');
		expect(result.nodes[1]?.children[0]?.visibility).toBe('visible');
		expect(result.envelope.events).toEqual([
			{ id: 7, type: 'bindtap', listener: { id: 2, priority: 'discrete' } },
		]);
	});

	it('scopes nested providers and restores defaults without a retained owner graph', () => {
		const Theme = createContext('default');
		const plan = universalPlan('lynx', PLAN);
		const Consumer = defineUniversalComponent('lynx', (_props: {}, context) => {
			const label = `${useContext(Theme)}:${context.readContext(Theme)}`;
			return universalValue(plan, [label, label, label]);
		});
		const child = () => universalComponent('lynx', Consumer, {});
		const App = defineUniversalComponent('lynx', (props: { outer: string; inner: string }) =>
			universalContext(Theme, props.outer, () => [
				child(),
				universalContext(Theme, props.inner, child),
				child(),
			]),
		);

		const result = renderLynxFirstScreen(App, { outer: 'outer', inner: 'inner' });
		const outer = result.nodes[0]!;
		expect(outer.kind).toBe('range');
		expect(outer.children[0]?.children[0]?.selectedValues).toEqual([
			'outer:outer',
			'outer:outer',
			'outer:outer',
		]);
		expect(outer.children[1]?.children[0]?.children[0]?.selectedValues).toEqual([
			'inner:inner',
			'inner:inner',
			'inner:inner',
		]);
		expect(outer.children[2]?.children[0]?.selectedValues).toEqual([
			'outer:outer',
			'outer:outer',
			'outer:outer',
		]);

		const defaultResult = renderLynxFirstScreen(Consumer, {});
		expect(defaultResult.nodes[0]?.selectedValues).toEqual([
			'default:default',
			'default:default',
			'default:default',
		]);
	});
	it('treats memo as an ownership-free first-render wrapper', () => {
		const plan = universalPlan('lynx', PLAN);
		let comparisons = 0;
		const Row = memo(
			defineUniversalComponent('lynx', (props: { label: string }) =>
				universalValue(plan, [props.label, props.label, props.label]),
			),
			() => {
				comparisons++;
				return true;
			},
		);
		const App = defineUniversalComponent('lynx', () =>
			universalComponent('lynx', Row, { label: 'memoized' }),
		);

		const result = renderLynxFirstScreen(App, {});
		expect(result.nodes[0]?.children[0]?.selectedValues).toEqual([
			'memoized',
			'memoized',
			'memoized',
		]);
		expect(comparisons).toBe(0);
	});

	it('gives the background program the same normalized scalar values', () => {
		const container = createLynxClientContainer();
		setLynxClientCapabilities(container, {
			templateMount: 1,
			templateProgram: 1,
			templateRuns: 1,
		} as never);
		const encoder = createUniversalHostEncoder({
			driver: createLynxClientDriver(container),
			container,
			renderer: 'lynx',
			resourceRoot: 1,
			transported: true,
		});
		const root: UniversalHostPlan = {
			kind: 'host',
			type: 'view',
			bindings: [
				['class', 0],
				['id', 1],
			],
			children: [{ kind: 'host', type: 'text', bindings: [['text', 2]] }],
		};
		const compiled = compiledUniversalTemplateProgram(encoder, root)!;
		const prepared = prepareUniversalTemplateProgram(encoder, compiled)!;

		expect(
			prepareUniversalTemplateProgramValues(encoder, compiled, prepared, [
				['row', { active: true, disabled: false }],
				42,
				{ not: 'a string' },
			]),
		).toEqual(['row active', '42', '']);
	});

	it('reserves listener IDs for empty conditional event sites', () => {
		const wire: UniversalHostTemplateProgram = {
			...WIRE,
			events: [
				{ node: 1, type: 'bindtap', priority: 'discrete' },
				{ node: 1, type: 'bindlongpress', priority: 'discrete' },
			],
		};
		const plan = universalPlan('lynx', {
			...PLAN,
			wire,
			events: [
				{ slot: 3, node: 1, type: 'bindtap', priority: 'discrete' },
				{ slot: 4, node: 1, type: 'bindlongpress', priority: 'discrete' },
			],
		});
		const onLongPress = () => {};
		const App = defineUniversalComponent('lynx', () =>
			universalValue(plan, ['row', 'row-id', 'label', undefined, onLongPress]),
		);

		const result = renderLynxFirstScreen(App, {});
		expect(result.envelope.events).toEqual([
			{
				id: 2,
				type: 'bindlongpress',
				listener: { id: 2, priority: 'discrete' },
			},
		]);
	});
	it('defers resident native-list worklet cells for demand-driven materialization', () => {
		const driver = createLynxClientDriver();
		const workletRow: UniversalHostTemplateProgram = {
			nodes: [
				{
					type: 'list-item',
					parent: -1,
					props: {},
					bindings: [{ name: 'main-thread:bindtap', valueIndex: 0 }],
				},
			],
			events: [],
		};

		expect(driver.templates!.defer('list', workletRow)).toBe(true);
		expect(driver.templates!.defer('view', workletRow)).toBe(false);
	});
});
