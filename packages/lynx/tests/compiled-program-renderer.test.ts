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
	startTransition,
	universalActivity,
	universalComponent,
	universalContext,
	universalIf,
	universalPlan,
	universalSwitch,
	universalTry,
	universalValue,
	use,
	useBatch,
	useContext,
	useDeferredValue,
	useId,
	useInsertionEffect,
	useLayoutEffect,
	useLinkedState,
	useMemo,
	useReducer,
	useState,
	useTransition,
	__useLinkedStateWithGetter,
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
	it('allocates distinct deterministic useId values for the first screen', () => {
		const plan = universalPlan('lynx', PLAN);
		const App = defineUniversalComponent('lynx', () => {
			const first = useId();
			const second = useId();
			return universalValue(plan, [first, second, first + ':' + second]);
		});

		const first = renderLynxFirstScreen(App, {}).nodes[0]?.selectedValues;
		const repeated = renderLynxFirstScreen(App, {}).nodes[0]?.selectedValues;
		expect(first).toEqual(repeated);
		expect(first?.slice(0, 2)).toEqual([':octane-u4:', ':octane-u8:']);
	});

	it('reclaims useId values from discarded first-screen try arms', () => {
		const plan = universalPlan('lynx', PLAN);
		const never = new Promise<never>(() => {});
		for (const discard of ['error', 'suspend'] as const) {
			let discarded = '';
			const App = defineUniversalComponent('lynx', () =>
				universalTry(
					() => {
						discarded = useId();
						if (discard === 'error') throw new Error('discard compact try arm');
						return use(never);
					},
					() => universalValue(plan, [useId(), 'pending', 'pending']),
					() => universalValue(plan, [useId(), 'caught', 'caught']),
				),
			);

			const selected = renderLynxFirstScreen(App, {}).nodes[0]?.children[0]?.selectedValues;
			expect(selected?.[0]).toBe(discarded);
		}
	});

	it('evaluates linked-state pairs and getter tuples for the first screen', () => {
		const plan = universalPlan('lynx', PLAN);
		const Pair = defineUniversalComponent('lynx', ({ source }: { readonly source: string }) => {
			const [value, update] = useLinkedState(source, (next) => `pair:${next}`);
			return universalValue(plan, [value, typeof update, value]);
		});
		const Getter = defineUniversalComponent('lynx', ({ source }: { readonly source: string }) => {
			const [value, update, read] = __useLinkedStateWithGetter(source, (next) => `getter:${next}`);
			return universalValue(plan, [value, typeof update, read()]);
		});

		expect(renderLynxFirstScreen(Pair, { source: 'alpha' }).nodes[0]?.selectedValues).toEqual([
			'pair:alpha',
			'function',
			'pair:alpha',
		]);
		expect(renderLynxFirstScreen(Getter, { source: 'beta' }).nodes[0]?.selectedValues).toEqual([
			'getter:beta',
			'function',
			'getter:beta',
		]);
	});

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

	it('evaluates reducer initialization and memo values without publishing first-screen effects', () => {
		const plan = universalPlan('lynx', PLAN);
		let memoCalls = 0;
		const App = defineUniversalComponent('lynx', () => {
			const [count, _dispatch, getCount] = useReducer(
				(value: number, amount: number) => value + amount,
				3,
				(value) => value * 2,
			);
			const label = useMemo(() => {
				memoCalls++;
				return `count:${getCount()}`;
			}, [count]);
			useInsertionEffect(() => {
				throw new Error('the compact first screen must not publish insertion effects');
			}, [label]);
			useLayoutEffect(() => {
				throw new Error('the compact first screen must not publish layout effects');
			}, [label]);
			return universalValue(plan, [label, count, label]);
		});

		const result = renderLynxFirstScreen(App, {});
		expect(result.nodes[0]?.selectedValues).toEqual(['count:6', '6', 'count:6']);
		expect(memoCalls).toBe(1);
	});

	it('previews transition hooks without scheduling main-thread first-screen state', () => {
		const plan = universalPlan('lynx', PLAN);
		const App = defineUniversalComponent('lynx', () => {
			const [count] = useState(2);
			const deferred = useDeferredValue(count);
			const [pending, begin] = useTransition();
			return universalValue(plan, [
				pending ? 'pending' : 'ready',
				typeof begin,
				`${deferred}:${typeof startTransition}`,
			]);
		});

		const result = renderLynxFirstScreen(App, {});
		expect(result.nodes[0]?.selectedValues).toEqual(['ready', 'function', '2:function']);
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

	it('materializes synchronous catch and pending use() arms without a reconciler', () => {
		const plan = universalPlan('lynx', PLAN);
		const program = (label: string) => universalValue(plan, [label, label, label]);
		const pending = new Promise<string>(() => {}) as Promise<string> & { status?: string };
		const other = new Promise<string>(() => {}) as Promise<string> & { status?: string };
		const Pending = defineUniversalComponent('lynx', () =>
			universalTry(
				() => {
					useBatch([pending, other]);
					return program(use(pending));
				},
				() => program('pending'),
			),
		);
		const Caught = defineUniversalComponent('lynx', () =>
			universalTry(
				() => {
					throw new Error('expected');
				},
				null,
				(error) => program((error as Error).message),
			),
		);

		const suspended = renderLynxFirstScreen(Pending, {});
		expect(pending.status).toBe('pending');
		expect(other.status).toBe('pending');
		expect(suspended.nodes[0]?.children[0]?.selectedValues).toEqual([
			'pending',
			'pending',
			'pending',
		]);
		const caught = renderLynxFirstScreen(Caught, {});
		expect(caught.nodes[0]?.children[0]?.selectedValues).toEqual([
			'expected',
			'expected',
			'expected',
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
