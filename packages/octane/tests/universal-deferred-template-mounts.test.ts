/**
 * A renderer that owns which of its children are on screen — a native list is
 * the motivating one — asks for a child when it is about to display it. Such a
 * renderer wants a mount that *declares* a run's instances without building
 * them, and it wants the hosts that participate to be described by it rather
 * than by this core: where a cell may sit, and when a declaration is available
 * at all, are facts about the renderer.
 *
 * These pin the core half of that: which programs a placement lets exist, and
 * which mounts the core will turn into a declaration rather than a build.
 */

import { describe, expect, it } from 'vitest';
import {
	type UniversalHostCommand,
	type UniversalHostTemplateCapability,
	type UniversalHostTemplateProgram,
	type UniversalTemplateHostPlacement,
	createObjectContainer,
	createObjectDriver,
	createUniversalRoot,
	defineUniversalComponent,
	universalFor,
	universalPlan,
	universalValue,
} from '../src/universal.js';

/** A row: one cell, a label, and the label's text. */
const cellPlan = universalPlan('object', {
	kind: 'host',
	type: 'cell',
	bindings: [['id', 0]],
	children: [{ kind: 'host', type: 'label', children: [{ kind: 'slot', slot: 1 }] }],
});

/** The same row, plus a prop only a built host can carry. */
const liveCellPlan = universalPlan('object', {
	kind: 'host',
	type: 'cell',
	bindings: [
		['id', 0],
		['live:tick', 2],
	],
	children: [{ kind: 'host', type: 'label', children: [{ kind: 'slot', slot: 1 }] }],
});

/** The parent that owns its own children, holding a keyed range. */
const shelfPlan = universalPlan('object', {
	kind: 'host',
	type: 'shelf',
	children: [{ kind: 'slot', slot: 0 }],
});

/** A shelf nested inside a would-be program, which no program may describe. */
const shelvedPlan = universalPlan('object', {
	kind: 'host',
	type: 'frame',
	children: [{ kind: 'host', type: 'shelf' }],
});

/** The same rows under two parents: one that owns its children and one that does not. */
const framedShelfPlan = universalPlan('object', {
	kind: 'host',
	type: 'frame',
	children: [
		{ kind: 'slot', slot: 0 },
		{ kind: 'host', type: 'shelf', children: [{ kind: 'slot', slot: 1 }] },
	],
});

/** A cell below a program's root, which is one place a cell cannot be. */
const nestedCellPlan = universalPlan('object', {
	kind: 'host',
	type: 'frame',
	children: [{ kind: 'host', type: 'cell', children: [{ kind: 'host', type: 'label' }] }],
});

const SHELF_TEMPLATES: UniversalHostTemplateCapability = {
	placement(type: string): UniversalTemplateHostPlacement {
		if (type === 'shelf') return 'none';
		return type === 'cell' ? 'root' : 'any';
	},
	defer(parentType: string | null, program: UniversalHostTemplateProgram): boolean {
		if (parentType !== 'shelf') return false;
		for (const node of program.nodes) {
			for (const binding of node.bindings ?? []) {
				if (binding.name.startsWith('live:')) return false;
			}
		}
		return true;
	},
};

/** The same renderer minus the constraint, for the shared-plan case below. */
const UNCONSTRAINED_TEMPLATES: UniversalHostTemplateCapability = {
	placement: () => 'any',
	defer: () => false,
};

interface DeclaredRun {
	readonly parent: number | null;
	readonly count: number;
	readonly values: readonly unknown[];
	readonly firstId: number;
	readonly lastId: number;
}

/**
 * An object renderer that takes a declaration literally: a deferred run builds
 * nothing, which is what makes "declared but not built" observable here. What
 * a cell looks like once the renderer decides to show one is the renderer's
 * business, and the Lynx suite is where a real one is driven.
 */
function createDeferringObjectDriver(
	templates: UniversalHostTemplateCapability = SHELF_TEMPLATES,
	deferredTemplateProgramRuns = true,
) {
	const base = createObjectDriver();
	const declared: DeclaredRun[] = [];
	const driver = {
		...base,
		capabilities: {
			...base.capabilities,
			templateMount: true,
			collapsedTemplateMount: true,
			templateProgramMount: true,
			stableStaticHostProps: true,
			templateProgramRuns: true,
			deferredTemplateProgramRuns,
		},
		templates,
		prepareBatch(...args: Parameters<typeof base.prepareBatch>) {
			const [container, batch, context] = args;
			// A declared host exists only in its run until this renderer decides to
			// show it, so every later command that names one is answered from the
			// declaration rather than from a built host. That is the whole of what
			// deferral costs a renderer, and skipping it here would let the double
			// pass a core that never declared anything.
			const isDeclared = (id: number) =>
				declared.some((run) => id >= run.firstId && id <= run.lastId);
			const commands: UniversalHostCommand[] = [];
			for (const command of batch.commands) {
				if (command.op === 'ensure-public-instance') continue;
				if (command.op === 'mount-template-run' && command.deferred === true) {
					const width = command.program.nodes.length;
					declared.push({
						parent: typeof command.parent === 'number' ? command.parent : null,
						count: command.count,
						values: command.values,
						firstId: command.firstId,
						lastId: command.firstId + command.count * width - 1,
					});
					continue;
				}
				if ('id' in command && typeof command.id === 'number' && isDeclared(command.id)) continue;
				commands.push(command);
			}
			return base.prepareBatch(container, { ...batch, commands }, context);
		},
	};
	return { driver, declared };
}

function runsIn(commands: readonly UniversalHostCommand[]) {
	return commands.filter((command) => command.op === 'mount-template-run');
}

function Rows(rows: readonly { readonly id: string; readonly label: string }[], live = false) {
	return universalValue(shelfPlan, [
		universalFor(
			rows,
			(row) => row.id,
			(row) =>
				live
					? universalValue(liveCellPlan, [row.id, row.label, 'tick'])
					: universalValue(cellPlan, [row.id, row.label]),
			null,
			false,
			false,
			true,
		),
	]);
}

const Shelf = defineUniversalComponent(
	'object',
	({ rows, live }: { rows: readonly { id: string; label: string }[]; live?: boolean }) =>
		Rows(rows, live === true),
);

/** One keyed range whose rows are not all the same program. */
const MixedShelf = defineUniversalComponent(
	'object',
	({ rows }: { rows: readonly { id: string; label: string; live?: boolean }[] }) =>
		universalValue(shelfPlan, [
			universalFor(
				rows,
				(row) => row.id,
				(row) =>
					row.live === true
						? universalValue(liveCellPlan, [row.id, row.label, 'tick'])
						: universalValue(cellPlan, [row.id, row.label]),
				null,
				false,
				false,
				true,
			),
		]),
);

/** The same row program under a parent that owns its children and one that does not. */
const TwoParents = defineUniversalComponent(
	'object',
	({ rows }: { rows: readonly { id: string; label: string }[] }) =>
		universalValue(framedShelfPlan, [
			universalFor(
				rows,
				(row) => `framed-${row.id}`,
				(row) => universalValue(cellPlan, [`framed-${row.id}`, row.label]),
				null,
				false,
				false,
				true,
			),
			universalFor(
				rows,
				(row) => `shelved-${row.id}`,
				(row) => universalValue(cellPlan, [`shelved-${row.id}`, row.label]),
				null,
				false,
				false,
				true,
			),
		]),
);

describe('deferred template mounts', () => {
	it('declares a keyed range under a self-owning parent instead of building it', () => {
		const container = createObjectContainer();
		const { driver, declared } = createDeferringObjectDriver();
		const root = createUniversalRoot(container, driver);
		const prepared = root.prepare(Shelf, {
			rows: [
				{ id: 'a', label: 'Alpha' },
				{ id: 'b', label: 'Beta' },
				{ id: 'c', label: 'Gamma' },
			],
		});
		if (prepared.status !== 'prepared') throw new Error('Expected a prepared transaction.');
		const runs = runsIn(prepared.batch.commands);
		expect(runs).toHaveLength(1);
		const run = runs[0];
		if (run.op !== 'mount-template-run') throw new Error('Expected an intrinsic run.');
		expect(run.deferred).toBe(true);
		expect(run.count).toBe(3);
		// A declaration is appended or not made at all, so it never names a sibling.
		expect(run.before).toBeNull();
		expect(run.values).toEqual(['a', 'Alpha', 'b', 'Beta', 'c', 'Gamma']);
		// Every row travels in the one command: nothing creates a cell beside it.
		expect(
			prepared.batch.commands.filter(
				(command) => command.op === 'create' && command.type === 'cell',
			),
		).toEqual([]);
		prepared.commit();
		expect(declared).toHaveLength(1);
		expect(declared[0].count).toBe(3);
		expect(container.children).toHaveLength(1);
		expect(container.children[0].type).toBe('shelf');
		expect(container.children[0].children).toEqual([]);
		root.unmount();
	});

	it('builds the rows one at a time when the renderer will not declare the program', () => {
		const container = createObjectContainer();
		const { driver, declared } = createDeferringObjectDriver();
		const root = createUniversalRoot(container, driver);
		const prepared = root.prepare(Shelf, {
			rows: [
				{ id: 'a', label: 'Alpha' },
				{ id: 'b', label: 'Beta' },
			],
			live: true,
		});
		if (prepared.status !== 'prepared') throw new Error('Expected a prepared transaction.');
		expect(runsIn(prepared.batch.commands)).toEqual([]);
		prepared.commit();
		expect(declared).toEqual([]);
		const shelf = container.children[0];
		expect(shelf.children.map((cell) => cell.props.id)).toEqual(['a', 'b']);
		expect(shelf.children.map((cell) => cell.children[0].children[0].props.value)).toEqual([
			'Alpha',
			'Beta',
		]);
		root.unmount();
	});

	it('builds the rows for a renderer that has no deferred runs at all', () => {
		const container = createObjectContainer();
		// The renderer still says where a cell may sit, so the program is still
		// kept out of a program interior; what it lacks is any way to declare one.
		// A page whose peer predates deferral is exactly this renderer, and it has
		// to get the rows it got before deferral existed.
		const { driver, declared } = createDeferringObjectDriver(SHELF_TEMPLATES, false);
		const root = createUniversalRoot(container, driver);
		const prepared = root.prepare(Shelf, {
			rows: [
				{ id: 'a', label: 'Alpha' },
				{ id: 'b', label: 'Beta' },
			],
		});
		if (prepared.status !== 'prepared') throw new Error('Expected a prepared transaction.');
		expect(runsIn(prepared.batch.commands)).toEqual([]);
		prepared.commit();
		expect(declared).toEqual([]);
		const shelf = container.children[0];
		expect(shelf.children.map((cell) => cell.props.id)).toEqual(['a', 'b']);
		expect(shelf.children.map((cell) => cell.children[0].children[0].props.value)).toEqual([
			'Alpha',
			'Beta',
		]);
		root.unmount();
	});

	it('builds rows appended to a parent that already holds children', () => {
		const container = createObjectContainer();
		const { driver, declared } = createDeferringObjectDriver();
		const root = createUniversalRoot(container, driver);
		root.render(Shelf, { rows: [{ id: 'a', label: 'Alpha' }] });
		expect(declared).toHaveLength(1);
		const append = root.prepare(Shelf, {
			rows: [
				{ id: 'a', label: 'Alpha' },
				{ id: 'b', label: 'Beta' },
			],
		});
		if (append.status !== 'prepared') throw new Error('Expected an append transaction.');
		// A declared instance is not a sibling this core can place another run
		// against, so the second commit builds rather than declares.
		expect(runsIn(append.batch.commands)).toEqual([]);
		append.commit();
		expect(declared).toHaveLength(1);
		expect(container.children[0].children.map((cell) => cell.props.id)).toEqual(['b']);
		root.unmount();
	});

	it('keeps an excluded host out of every template program', () => {
		const container = createObjectContainer();
		const { driver } = createDeferringObjectDriver();
		const root = createUniversalRoot(container, driver);
		const Framed = defineUniversalComponent('object', () => universalValue(shelvedPlan, []));
		const prepared = root.prepare(Framed, {});
		if (prepared.status !== 'prepared') throw new Error('Expected a prepared transaction.');
		expect(
			prepared.batch.commands.filter(
				(command) =>
					command.op === 'mount-template' ||
					command.op === 'mount-template-run' ||
					command.op === 'mount-template-range',
			),
		).toEqual([]);
		prepared.commit();
		expect(container.children[0].children[0].type).toBe('shelf');
		root.unmount();
	});

	it('keeps a root-only host out of a program interior', () => {
		const container = createObjectContainer();
		const { driver } = createDeferringObjectDriver();
		const root = createUniversalRoot(container, driver);
		const Framed = defineUniversalComponent('object', () => universalValue(nestedCellPlan, []));
		const prepared = root.prepare(Framed, {});
		if (prepared.status !== 'prepared') throw new Error('Expected a prepared transaction.');
		expect(
			prepared.batch.commands.filter(
				(command) =>
					command.op === 'mount-template' ||
					command.op === 'mount-template-run' ||
					command.op === 'mount-template-range',
			),
		).toEqual([]);
		prepared.commit();
		expect(container.children[0].children[0].type).toBe('cell');
		root.unmount();
	});

	it('answers placement per renderer for a plan both of them render', () => {
		const constrained = createDeferringObjectDriver();
		const unconstrained = createDeferringObjectDriver(UNCONSTRAINED_TEMPLATES);
		const first = createUniversalRoot(createObjectContainer(), constrained.driver);
		const second = createUniversalRoot(createObjectContainer(), unconstrained.driver);
		const rows = [
			{ id: 'a', label: 'Alpha' },
			{ id: 'b', label: 'Beta' },
		];
		// Deliberately the constrained renderer first: a plan is compiler-hoisted
		// and shared by every root that renders the module, so an answer cached
		// against the plan alone would be this renderer's answer for both.
		const declaredFirst = first.prepare(Shelf, { rows });
		if (declaredFirst.status !== 'prepared') throw new Error('Expected a prepared transaction.');
		expect(runsIn(declaredFirst.batch.commands)).toMatchObject([{ deferred: true, count: 2 }]);
		declaredFirst.commit();

		const builtSecond = second.prepare(Shelf, { rows });
		if (builtSecond.status !== 'prepared') throw new Error('Expected a prepared transaction.');
		const runs = runsIn(builtSecond.batch.commands);
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ count: 2 });
		// Same plan, same program, and this renderer is told to build it.
		expect((runs[0] as { deferred?: true }).deferred).toBeUndefined();
		builtSecond.abort();
		expect(unconstrained.declared).toEqual([]);
		first.unmount();
		second.unmount();
	});

	it('declares the rows under the parent that owns them and builds the same rows elsewhere', () => {
		const container = createObjectContainer();
		const { driver, declared } = createDeferringObjectDriver();
		const root = createUniversalRoot(container, driver);
		const prepared = root.prepare(TwoParents, {
			rows: [
				{ id: 'a', label: 'Alpha' },
				{ id: 'b', label: 'Beta' },
			],
		});
		if (prepared.status !== 'prepared') throw new Error('Expected a prepared transaction.');
		// The framed rows are visited first, so a renderer answer remembered
		// against the program alone would carry that refusal into the shelf.
		expect(runsIn(prepared.batch.commands)).toMatchObject([{ deferred: true, count: 2 }]);
		prepared.commit();
		expect(declared).toHaveLength(1);
		const frame = container.children[0];
		expect(frame.children.map((child) => child.props.id ?? child.type)).toEqual([
			'framed-a',
			'framed-b',
			'shelf',
		]);
		const shelf = frame.children[2];
		expect(shelf.children).toEqual([]);
		root.unmount();
	});

	it('builds only the rows of a range the renderer will not declare', () => {
		const container = createObjectContainer();
		const { driver, declared } = createDeferringObjectDriver();
		const root = createUniversalRoot(container, driver);
		const prepared = root.prepare(MixedShelf, {
			rows: [
				{ id: 'a', label: 'Alpha' },
				{ id: 'b', label: 'Beta', live: true },
				{ id: 'c', label: 'Gamma' },
			],
		});
		if (prepared.status !== 'prepared') throw new Error('Expected a prepared transaction.');
		// One run per declared row rather than one for the range: a run coalesces
		// with the placement beside it, and the built row sits between these two.
		expect(runsIn(prepared.batch.commands)).toMatchObject([
			{ deferred: true, count: 1 },
			{ deferred: true, count: 1 },
		]);
		// Order survives the mix: each row is appended where its turn comes, so
		// the built one lands between the two declarations rather than after them.
		const placements = prepared.batch.commands.filter(
			(command) =>
				(command.op === 'mount-template-run' && command.parent === 1) ||
				(command.op === 'insert' && command.parent === 1),
		);
		expect(placements.map((command) => command.op)).toEqual([
			'mount-template-run',
			'insert',
			'mount-template-run',
		]);
		prepared.commit();
		expect(declared).toHaveLength(2);
		const shelf = container.children[0];
		expect(shelf.children.map((cell) => cell.props.id)).toEqual(['b']);
		root.unmount();
	});
});
