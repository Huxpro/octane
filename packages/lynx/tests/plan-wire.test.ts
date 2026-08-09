import { describe, expect, it } from 'vitest';
import {
	type UniversalAsyncCommitTransport,
	type UniversalHostBatch,
	type UniversalHostCommand,
	type UniversalPlan,
	type UniversalPlanInstance,
	type UniversalPlanNode,
	createUniversalRoot,
	defineUniversalComponent,
	universalFor,
	universalPlan,
	universalValue,
} from 'octane/universal/native';
import { createLynxClientContainer, createLynxClientDriver } from '../src/core/client-driver.js';
import { universalPlan as mainUniversalPlan } from '../src/main-renderer.js';
import { LYNX_TRANSPORT_RENDERER } from '../src/core/protocol.js';
import {
	expandLynxInstantiateCommand,
	expandLynxWireBatch,
	foldLynxPlanInstances,
	lynxPlanRegistrySnapshot,
	lynxPlanWireId,
	onLynxPlanRegistered,
	registerLynxPlan,
	resolveLynxPlan,
	unregisterLynxPlan,
	type LynxInstantiateCommand,
	type LynxWireHostBatch,
} from '../src/core/plan-wire.js';

const ROW_ROOT: UniversalPlanNode = {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			bindings: [['bindtap', 1]],
			children: [{ kind: 'slot', slot: 2 }],
		},
	],
};

/** A second plan object with the same content, as the other bundle compiles it. */
function structuralClone(node: UniversalPlanNode): UniversalPlanNode {
	return JSON.parse(JSON.stringify(node)) as UniversalPlanNode;
}

function normalized(commands: readonly UniversalHostCommand[]): string[] {
	return commands.map((command) => JSON.stringify(command)).sort();
}

interface Item {
	readonly id: number;
	readonly label: string | number | boolean | null;
}

/** Mount the row scene through the real staging pipeline and capture batches. */
async function stageRows(items: readonly Item[]) {
	const batches: UniversalHostBatch[] = [];
	const container = createLynxClientContainer();
	const transport: UniversalAsyncCommitTransport<typeof container> = {
		mode: 'async',
		planInstantiation: true,
		prepareBatch(_container, batch, identity) {
			return {
				apply(acknowledge) {
					batches.push(batch);
					acknowledge({ ...identity, type: 'ack' });
					return Promise.resolve();
				},
				abort() {},
			};
		},
	};
	const rowPlan = universalPlan(LYNX_TRANSPORT_RENDERER, ROW_ROOT);
	const listPlan = universalPlan(LYNX_TRANSPORT_RENDERER, {
		kind: 'host',
		type: 'view',
		props: { id: 'rows' },
		children: [{ kind: 'slot', slot: 0 }],
	});
	const Rows = defineUniversalComponent(
		LYNX_TRANSPORT_RENDERER,
		({ items: current }: { items: readonly Item[] }) =>
			universalValue(listPlan, [
				universalFor(
					current,
					(item: Item) => item.id,
					(item: Item) => universalValue(rowPlan, [`row-${item.id}`, () => item.id, item.label]),
				),
			]),
	);
	const root = createUniversalRoot(container, createLynxClientDriver(), { transport });
	await root.renderAsync(Rows, { items });
	return { batches, rowPlan, listPlan, root };
}

describe('lynx plan wire identity', () => {
	it('derives one identity for structurally equal plans from different bundles', () => {
		const first = universalPlan(LYNX_TRANSPORT_RENDERER, ROW_ROOT);
		const second = universalPlan(LYNX_TRANSPORT_RENDERER, structuralClone(ROW_ROOT));
		expect(first).not.toBe(second);
		const id = lynxPlanWireId(first);
		expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
		expect(lynxPlanWireId(second)).toBe(id);
		// The two thread facades normalize plan literals differently — the
		// background stamps `props: {}` where the main facade omits the key —
		// without changing what the plan materializes. Identity must survive both.
		expect(
			lynxPlanWireId(mainUniversalPlan(LYNX_TRANSPORT_RENDERER, structuralClone(ROW_ROOT))),
		).toBe(id);
		expect(
			lynxPlanWireId(
				universalPlan(LYNX_TRANSPORT_RENDERER, {
					kind: 'host',
					type: 'view',
					props: {},
					bindings: [],
					children: [ROW_ROOT],
				}),
			),
		).toBe(
			lynxPlanWireId(
				universalPlan(LYNX_TRANSPORT_RENDERER, {
					kind: 'host',
					type: 'view',
					children: [ROW_ROOT],
				}),
			),
		);
	});

	it('distinguishes plans that differ anywhere in their content', () => {
		const base = universalPlan(LYNX_TRANSPORT_RENDERER, ROW_ROOT);
		const differentType = universalPlan(LYNX_TRANSPORT_RENDERER, {
			...ROW_ROOT,
			type: 'image',
		});
		const differentProps = universalPlan(LYNX_TRANSPORT_RENDERER, {
			...ROW_ROOT,
			props: { flat: true },
		});
		const ids = [base, differentType, differentProps].map(lynxPlanWireId);
		expect(new Set(ids).size).toBe(3);
	});

	it('declines identity for plans without a stable serialization', () => {
		const Comp = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, () => null);
		const withComponent = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			children: [{ kind: 'component', renderer: LYNX_TRANSPORT_RENDERER, component: Comp }],
		});
		expect(lynxPlanWireId(withComponent)).toBeNull();
		const withFunctionProp = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { format: () => 'nope' },
		});
		expect(lynxPlanWireId(withFunctionProp)).toBeNull();
	});
});

describe('lynx plan registry', () => {
	it('registers eligible plans, resolves them, and notifies observers', () => {
		const plan = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { tag: 'registry-proof' },
		});
		const observed: string[] = [];
		const unsubscribe = onLynxPlanRegistered((planId) => observed.push(planId));
		try {
			const id = registerLynxPlan(plan);
			expect(id).not.toBeNull();
			expect(observed).toEqual([id]);
			expect(resolveLynxPlan(id!)).toBe(plan);
			expect(lynxPlanRegistrySnapshot()).toContain(id);
			// Same content registers idempotently and re-notifies nobody.
			expect(
				registerLynxPlan(universalPlan(LYNX_TRANSPORT_RENDERER, structuralClone(plan.root))),
			).toBe(id);
			expect(observed).toEqual([id]);
			expect(unregisterLynxPlan(id!)).toBe(true);
			expect(resolveLynxPlan(id!)).toBeUndefined();
		} finally {
			unsubscribe();
		}
	});

	it('registers nothing for plans the wire cannot instantiate', () => {
		const ineligible: UniversalPlanNode[] = [
			{ kind: 'host', type: 'view', propsSlot: 0 },
			{ kind: 'host', type: 'view', bindings: [['key', 0]] },
			{ kind: 'host', type: 'view', bindings: [['ref', 0]] },
			{ kind: 'host', type: 'view', bindings: [['children', 0]] },
			{ kind: 'host', type: 'view', bindings: [['main-thread:bindtap', 0]] },
			{ kind: 'if', conditionSlot: 0, then: { kind: 'text', value: 'x' } },
			{
				kind: 'switch',
				valueSlot: 0,
				cases: [['a', { kind: 'text', value: 'x' }]],
			},
			// One slot consumed as both an event handler and a crossing value.
			{
				kind: 'host',
				type: 'view',
				bindings: [
					['bindtap', 0],
					['class', 0],
				],
			},
		];
		for (const rootNode of ineligible) {
			const plan = universalPlan(LYNX_TRANSPORT_RENDERER, rootNode);
			expect(registerLynxPlan(plan)).toBeNull();
			const id = lynxPlanWireId(plan);
			if (id !== null) expect(lynxPlanRegistrySnapshot()).not.toContain(id);
		}
	});
});

describe('lynx plan fold and expansion', () => {
	it('round-trips a creation burst through instantiate commands byte-for-byte', async () => {
		const { batches, rowPlan } = await stageRows([
			{ id: 1, label: 'one' },
			{ id: 2, label: 2 },
			// Nullish and boolean labels render no text host at all.
			{ id: 3, label: null },
			{ id: 4, label: false },
		]);
		expect(batches).toHaveLength(1);
		const staged = batches[0]!;
		expect(staged.planInstances).toBeDefined();

		const planId = lynxPlanWireId(rowPlan)!;
		const folded = foldLynxPlanInstances(staged, (candidate) => candidate === planId);
		expect('planInstances' in folded).toBe(false);
		const instantiates = folded.commands.filter(
			(command): command is LynxInstantiateCommand => command.op === 'instantiate',
		);
		expect(instantiates).toHaveLength(4);
		expect(instantiates.map(({ ids }) => ids.length)).toEqual([3, 3, 2, 2]);
		// Event slots are scrubbed; value slots cross verbatim.
		expect(instantiates.map(({ values }) => values)).toEqual([
			['row-1', null, 'one'],
			['row-2', null, 2],
			['row-3', null, null],
			['row-4', null, false],
		]);
		for (const command of instantiates) {
			expect(command.plan).toBe(planId);
			expect(command.events).toHaveLength(1);
		}
		// 7 per-node commands for full rows, 5 for text-less rows, fold to 1 each.
		expect(folded.commands.length).toBe(staged.commands.length - 6 - 6 - 4 - 4);

		// The other bundle's structurally equal plan expands to the exact same
		// per-node command set the background staged.
		const remotePlan = universalPlan(LYNX_TRANSPORT_RENDERER, structuralClone(ROW_ROOT));
		const expanded = expandLynxWireBatch(folded, (id) => (id === planId ? remotePlan : undefined));
		expect(normalized(expanded.commands)).toEqual(normalized(staged.commands));
		// Within the expansion, each create precedes every use of its host ID.
		const seen = new Set<number>();
		for (const command of expanded.commands) {
			if (command.op === 'create') seen.add(command.id);
			else if (command.op === 'insert') {
				expect(seen.has(command.id)).toBe(true);
				if (typeof command.parent === 'number') expect(seen.has(command.parent)).toBe(true);
			} else if (command.op === 'event') {
				expect(seen.has(command.id)).toBe(true);
			}
		}
	});

	it('keeps per-node commands for plans the main thread never announced', async () => {
		const { batches } = await stageRows([{ id: 1, label: 'one' }]);
		const staged = batches[0]!;
		const folded = foldLynxPlanInstances(staged, () => false);
		expect(folded.commands).toEqual(staged.commands);
		expect('planInstances' in folded).toBe(false);
		// And a batch that never carried provenance passes through unchanged.
		const bare: UniversalHostBatch = {
			renderer: staged.renderer,
			version: staged.version,
			commands: staged.commands,
		};
		expect(foldLynxPlanInstances(bare, () => true)).toBe(bare);
	});

	it('keeps per-node commands when the batch touches the instance beyond its footprint', async () => {
		const { batches, rowPlan } = await stageRows([{ id: 1, label: 'one' }]);
		const staged = batches[0]!;
		const planId = lynxPlanWireId(rowPlan)!;
		const instance = staged.planInstances!.find(({ plan }) => plan === rowPlan)!;
		const touched: UniversalHostBatch = {
			renderer: staged.renderer,
			version: staged.version,
			// An update against one of the instance's hosts proves the subtree is
			// not exactly the plan walk's footprint.
			commands: [...staged.commands, { op: 'update', id: instance.rootId, props: { late: 1 } }],
			planInstances: staged.planInstances,
		};
		const folded = foldLynxPlanInstances(touched, (candidate) => candidate === planId);
		expect(folded.commands.some((command) => command.op === 'instantiate')).toBe(false);
	});

	it('keeps per-node commands for instance values the wire cannot carry', async () => {
		const { batches, rowPlan } = await stageRows([{ id: 1, label: 'one' }]);
		const staged = batches[0]!;
		const planId = lynxPlanWireId(rowPlan)!;
		const instance = staged.planInstances!.find(({ plan }) => plan === rowPlan)!;
		const nonLeaf: UniversalPlanInstance = {
			...instance,
			values: [{ nested: 'object' }, instance.values[1], instance.values[2]],
		};
		const folded = foldLynxPlanInstances(
			{
				renderer: staged.renderer,
				version: staged.version,
				commands: staged.commands,
				planInstances: [nonLeaf],
			},
			(candidate) => candidate === planId,
		);
		expect(folded.commands.some((command) => command.op === 'instantiate')).toBe(false);
	});

	it('rejects expansion against unknown or mismatched plans', async () => {
		const { batches, rowPlan } = await stageRows([{ id: 1, label: 'one' }]);
		const staged = batches[0]!;
		const planId = lynxPlanWireId(rowPlan)!;
		const folded = foldLynxPlanInstances(staged, (candidate) => candidate === planId);
		const instantiate = folded.commands.find(
			(command): command is LynxInstantiateCommand => command.op === 'instantiate',
		)!;

		expect(() => expandLynxWireBatch(folded, () => undefined)).toThrow(/never registered/);

		// A plan that produces a different subtree than the background staged.
		const foreignPlan = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			bindings: [['class', 0]],
		});
		expect(() => expandLynxInstantiateCommand(instantiate, foreignPlan)).toThrow(
			/different subtree|ran out of host IDs/,
		);

		// Listener entries must name hosts inside the instance.
		const remotePlan = universalPlan(LYNX_TRANSPORT_RENDERER, structuralClone(ROW_ROOT));
		expect(() =>
			expandLynxInstantiateCommand(
				{ ...instantiate, events: [{ ...instantiate.events[0]!, id: 99999 }] },
				remotePlan,
			),
		).toThrow(/foreign host/);

		// Non-primitive slot values cannot materialize a text host.
		expect(() =>
			expandLynxInstantiateCommand(
				{ ...instantiate, values: [instantiate.values[0], null, { bad: true }] },
				remotePlan,
			),
		).toThrow(/non-primitive text slot value/);
	});

	it('passes wire batches without instantiate commands through untouched', () => {
		const batch: LynxWireHostBatch = {
			renderer: LYNX_TRANSPORT_RENDERER,
			version: 1,
			commands: [{ op: 'create', id: 1, type: 'view', props: {} }],
		};
		expect(expandLynxWireBatch(batch)).toBe(batch);
	});
});
