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
	defineUniversalComponent,
	renderLynxFirstScreen,
	universalPlan,
	universalValue,
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
});
