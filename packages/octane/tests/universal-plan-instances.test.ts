import { describe, expect, it } from 'vitest';
import {
	type UniversalAsyncCommitTransport,
	type UniversalHostBatch,
	type UniversalPlan,
	type UniversalPlanInstance,
	createObjectContainer,
	createObjectDriver,
	createUniversalRoot,
	defineUniversalComponent,
	universalFor,
	universalPlan,
	universalValue,
} from '../src/universal.js';

const RENDERER = 'plan-instances-proof';

/**
 * The plan-instance provenance contract: an async transport that declares
 * `planInstantiation` receives, on each staged batch, a `planInstances` list
 * attributing every fully-new, visible, plan-rooted host subtree to the plan
 * and slot values it was materialized from. A transport can re-encode those
 * subtrees as one wire instruction because the entry pins the exact host IDs,
 * in plan pre-order, and the staged listeners of the subtree.
 */
function captureRoot(
	planInstantiation: boolean | ((plan: UniversalPlan, values: readonly unknown[]) => boolean),
) {
	const batches: UniversalHostBatch[] = [];
	const container = createObjectContainer(RENDERER);
	const transport: UniversalAsyncCommitTransport<typeof container> = {
		mode: 'async',
		...(planInstantiation
			? { planInstantiation: planInstantiation === true ? true : planInstantiation }
			: null),
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
	const driver = createObjectDriver(RENDERER);
	const root = createUniversalRoot(
		container,
		// Async transports exclude local host callbacks; drop that capability.
		{
			id: driver.id,
			capabilities: { ...driver.capabilities, localHostCallbacks: false },
			events: driver.events,
			lifecycles: driver.lifecycles,
			localCallbacks: undefined,
			prepareBatch: driver.prepareBatch,
			getPublicInstance: driver.getPublicInstance,
		},
		{ transport },
	);
	return { root, batches };
}

const rowPlan = universalPlan(RENDERER, {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			bindings: [['onTap', 1]],
			children: [{ kind: 'slot', slot: 2 }],
		},
	],
});

const listPlan = universalPlan(RENDERER, {
	kind: 'host',
	type: 'view',
	props: { id: 'rows' },
	children: [{ kind: 'slot', slot: 0 }],
});

interface Item {
	readonly id: number;
	readonly label: string;
}

const Rows = defineUniversalComponent(RENDERER, ({ items }: { items: readonly Item[] }) =>
	universalValue(listPlan, [
		universalFor(
			items,
			(item: Item) => item.id,
			(item: Item) => universalValue(rowPlan, [`row-${item.id}`, () => item.id, item.label]),
		),
	]),
);

function instancesOf(batch: UniversalHostBatch): readonly UniversalPlanInstance[] {
	expect(batch.planInstances).toBeDefined();
	return batch.planInstances!;
}

describe('universal plan-instance provenance', () => {
	it('attributes each new plan-rooted subtree with pre-order IDs and staged listeners', async () => {
		const { root, batches } = captureRoot(true);
		const items: Item[] = [
			{ id: 1, label: 'one' },
			{ id: 2, label: 'two' },
		];
		const attempt = await root.renderAsync(Rows, { items });
		expect(batches).toHaveLength(1);
		expect(attempt.status).toBe('committed');
		if (attempt.status === 'committed') {
			expect(attempt.batch.planInstances).toBeUndefined();
			expect('planInstances' in attempt.batch).toBe(false);
		}
		const batch = batches[0]!;
		const instances = instancesOf(batch);
		// Outer list instance first, then its nested row instances in tree order:
		// an outer instance the transport cannot use must not hide the inner ones.
		expect(instances.map(({ plan }) => plan)).toEqual([listPlan, rowPlan, rowPlan]);

		const creates = batch.commands.filter((command) => command.op === 'create');
		const events = batch.commands.filter((command) => command.op === 'event');
		const [list, first, second] = instances;
		// The outer instance spans the whole batch; each row spans view + text +
		// materialized text host for the label slot.
		expect(list!.ids).toEqual(creates.map((command) => command.id));
		expect(list!.rootId).toBe(list!.ids[0]);
		expect(list!.values).toHaveLength(1);
		for (const [index, row] of [first!, second!].entries()) {
			expect(row.values).toEqual([
				`row-${items[index]!.id}`,
				expect.any(Function),
				items[index]!.label,
			]);
			expect(row.ids).toHaveLength(3);
			expect(row.rootId).toBe(row.ids[0]);
			// Pre-order over the staged creates: the row's create commands appear in
			// exactly this order in the batch.
			const staged = creates.filter((command) => row.ids.includes(command.id));
			expect(staged.map((command) => command.id)).toEqual([...row.ids]);
			expect(staged.map((command) => command.type)).toEqual(['view', 'text', '#text']);
			// The one staged listener matches the batch's event announcement.
			expect(row.events).toHaveLength(1);
			const event = row.events[0]!;
			expect(event.id).toBe(row.ids[1]);
			const command = events.find((candidate) => candidate.id === event.id);
			expect(command).toMatchObject({
				op: 'event',
				type: event.type,
				listener: { id: event.listener, priority: event.priority },
			});
		}
	});

	it('does not attribute retained instances on update commits', async () => {
		const { root, batches } = captureRoot(true);
		const items: Item[] = [
			{ id: 1, label: 'one' },
			{ id: 2, label: 'two' },
		];
		await root.renderAsync(Rows, { items });
		await root.renderAsync(Rows, {
			items: [items[0]!, { id: 2, label: 'TWO' }, { id: 3, label: 'three' }],
		});
		expect(batches).toHaveLength(2);
		const update = batches[1]!;
		// Only the appended row is new; the relabeled row updates in place.
		const instances = instancesOf(update);
		expect(instances.map(({ plan }) => plan)).toEqual([rowPlan]);
		expect(instances[0]!.values[2]).toBe('three');
		const updatedIds = update.commands.flatMap((command) =>
			command.op === 'update' ? [command.id] : [],
		);
		expect(updatedIds.length).toBeGreaterThan(0);
		for (const id of updatedIds) expect(instances[0]!.ids).not.toContain(id);
	});

	it('excludes subtrees a wire instruction could not reproduce', async () => {
		const lifecyclePlan = universalPlan(RENDERER, {
			kind: 'host',
			type: 'view',
			bindings: [['onUpdate', 0]],
		});
		const wrapperPlan = universalPlan(RENDERER, {
			kind: 'host',
			type: 'view',
			children: [{ kind: 'slot', slot: 0 }],
		});
		const plainPlan = universalPlan(RENDERER, {
			kind: 'host',
			type: 'view',
			props: { plain: true },
		});
		const Mixed = defineUniversalComponent(RENDERER, () => [
			universalValue(wrapperPlan, [universalValue(lifecyclePlan, [() => {}])]),
			universalValue(plainPlan, []),
		]);
		const { root, batches } = captureRoot(true);
		await root.renderAsync(Mixed, {});
		const instances = instancesOf(batches[0]!);
		// The lifecycle host needs lifecycle commands a wire instruction cannot
		// carry, so neither it nor the wrapper containing it is attributable. The
		// plain sibling still is.
		expect(instances.map(({ plan }) => plan)).toEqual([plainPlan]);
	});

	it('attaches nothing for transports that do not opt in', async () => {
		const { root, batches } = captureRoot(false);
		await root.renderAsync(Rows, { items: [{ id: 1, label: 'one' }] });
		expect(batches).toHaveLength(1);
		expect(batches[0]!.planInstances).toBeUndefined();
		expect('planInstances' in batches[0]!).toBe(false);
	});

	it('lets a transport reject a plan before walking its draft subtree', async () => {
		const visited: Array<{ plan: UniversalPlan; values: readonly unknown[] }> = [];
		const { root, batches } = captureRoot((plan, values) => {
			visited.push({ plan, values });
			return plan === rowPlan;
		});
		await root.renderAsync(Rows, {
			items: [
				{ id: 1, label: 'one' },
				{ id: 2, label: 'two' },
			],
		});
		expect(visited.map(({ plan }) => plan)).toEqual([listPlan, rowPlan, rowPlan]);
		expect(instancesOf(batches[0]!).map(({ plan }) => plan)).toEqual([rowPlan, rowPlan]);

		visited.length = 0;
		await root.renderAsync(Rows, {
			items: [
				{ id: 1, label: 'ONE' },
				{ id: 2, label: 'TWO' },
			],
		});
		expect(visited).toEqual([]);
		expect(batches[1]!.planInstances).toBeUndefined();
	});
});
