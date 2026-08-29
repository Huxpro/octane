/**
 * Issue #103 U4b: the shipping path collects the template-run win for worklets.
 *
 * §1 measured a keyed list of `view.row > text.col > #text` through the real
 * compiler and the real transport. A plain row mounted in three commands at any
 * scale; adding one `main-thread:` prop to that row cost 6,002 commands at
 * 1,000 rows, because the compiler declined a template program for the list and
 * every row fell back to a `create` per host.
 *
 * What each layer owns, so a failure here points at one of them:
 *
 *   compiler   `universal-renderer.test.ts` proves a keyed row that *binds* a
 *              `main-thread:` prop still emits a program-eligible `universalFor`
 *              and that a literal one still does not.
 *   core       `universal-host-sdk.test.ts` proves a renderer-namespaced slot
 *              may carry a value the core does not read, and that the same
 *              value in a plain slot is still refused.
 *   here       the emitted shape, driven through `createLynxRoot` over the real
 *              transport onto the official Element PAPI: what a page pays, and
 *              what keeps each row's callbacks callable for exactly its life.
 *
 * The component is written the way the compiler writes one — a module-level
 * plan with per-instance bindings, and a run-eligible `universalFor` — because
 * the lynx suite compiles `.tsrx` without selecting a thread layer, so a
 * `'main thread'` directive cannot be authored in a fixture here.
 */
import { JSDOM } from 'jsdom';
import {
	installLynxTestingEnv,
	type LynxTestingEnv,
	uninstallLynxTestingEnv,
} from '@lynx-js/testing-environment';
import {
	defineUniversalComponent,
	universalFor,
	universalPlan,
	universalValue,
	type UniversalHostCommand,
} from 'octane/universal/native';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
// The main side has to carry the worklet feature, exactly as a bundle that
// authored a `'main thread'` handler does.
import '../src/main-worklets.js';
import { createLynxRoot, type LynxRoot } from '../src/index.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import {
	LYNX_BACKGROUND_TO_MAIN_EVENT,
	LYNX_TRANSPORT_RENDERER,
	type LynxBackgroundOutboundMessage,
	type LynxContextProxy,
} from '../src/core/protocol.js';
import { bindThreadFunction, registerThreadFunction } from '../src/core/worklets.js';
import { unwire } from './_fixtures/lynx-wire.js';

const TAP = 'worklet-template-runs:tap';
const RECORD = 'worklet-template-runs:record';

const PAGE_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	props: { id: 'page' },
	children: [{ kind: 'slot', slot: 0 }],
});

const ROW_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	props: { class: 'row' },
	bindings: [
		['id', 0],
		['main-thread:bindtap', 1],
	],
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'col' },
			children: [{ kind: 'text', slot: 2 }],
		},
	],
});

interface Row {
	readonly id: string;
	readonly label: string;
}

/**
 * The compiler's shape for a `'main thread'` handler that calls a `'background
 * only'` one: a tagged main-thread function whose capture list holds a tagged
 * background function. One handler value serves every row, which is what makes
 * per-host execution ownership observable rather than incidental.
 */
const Scene = defineUniversalComponent(
	LYNX_TRANSPORT_RENDERER,
	({ rows }: { rows: readonly Row[] }) => {
		const record = bindThreadFunction('background', RECORD, () => []);
		const onTap = bindThreadFunction('main-thread', TAP, () => [record]);
		return universalValue(PAGE_PLAN, [
			universalFor(
				rows,
				(row) => row.id,
				(row) => universalValue(ROW_PLAN, [row.id, onTap, row.label]),
				null,
				false,
				false,
				true,
			),
		]);
	},
);

/**
 * The same shape with a capture the caller can move, so "the handler changed"
 * and "the handler was rebuilt" can be told apart.
 */
const CapturingScene = defineUniversalComponent(
	LYNX_TRANSPORT_RENDERER,
	({ rows, armed }: { rows: readonly Row[]; armed: boolean }) => {
		const record = bindThreadFunction('background', RECORD, () => []);
		const onTap = bindThreadFunction('main-thread', TAP, () => [record, armed]);
		return universalValue(PAGE_PLAN, [
			universalFor(
				rows,
				(row) => row.id,
				(row) => universalValue(ROW_PLAN, [row.id, onTap, row.label]),
				null,
				false,
				false,
				true,
			),
		]);
	},
);

interface InstalledEnvironment {
	readonly dom: JSDOM;
	readonly env: LynxTestingEnv;
	readonly main: LynxMainThreadController;
	readonly commits: UniversalHostCommand[][];
}

let installed: InstalledEnvironment | null = null;
let backgroundRoot: LynxRoot | null = null;

function installEnvironment(): InstalledEnvironment {
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	const env = globalThis.lynxTestingEnv;
	env.switchToMainThread();
	const main = installLynxMainThread();
	env.switchToBackgroundThread();
	// Every outbound commit, read off the background context the root publishes
	// on: what crossed the wire rather than what the core staged.
	const commits: UniversalHostCommand[][] = [];
	const context = (
		globalThis as typeof globalThis & { lynx: { getCoreContext(): LynxContextProxy } }
	).lynx.getCoreContext();
	context.addEventListener(LYNX_BACKGROUND_TO_MAIN_EVENT, (event) => {
		const message = unwire(event.data) as LynxBackgroundOutboundMessage;
		if (message.type === 'commit') commits.push([...message.batch.commands]);
	});
	return (installed = { dom, env, main, commits });
}

function rows(count: number): Row[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `row-${index + 1}`,
		label: `row ${index + 1}`,
	}));
}

/** The one run a mounted list is expected to be. */
function onlyRun(commands: readonly UniversalHostCommand[]) {
	const runs = commands.filter((command) => command.op === 'mount-template-run');
	expect(runs).toHaveLength(1);
	const run = runs[0]!;
	if (run.op !== 'mount-template-run') throw new Error('Expected a template run.');
	return run;
}

/** The `main-thread:bindtap` descriptor each instance of a run carries. */
function workletSlots(run: ReturnType<typeof onlyRun>): readonly Record<string, unknown>[] {
	const arity = run.values.length / run.count;
	return Array.from({ length: run.count }, (_, index) => {
		const value = run.values[index * arity + 1];
		if (typeof value !== 'object' || value === null) {
			throw new Error('Expected a worklet descriptor in the bound main-thread slot.');
		}
		return value as Record<string, unknown>;
	});
}

beforeAll(() => {
	registerThreadFunction('background', RECORD, () => 'recorded');
	registerThreadFunction('main-thread', TAP, function () {
		return null;
	});
});

afterEach(async () => {
	await backgroundRoot?.unmount();
	backgroundRoot = null;
	// Closing the controller releases the main-thread worklet registry the
	// feature installed, so the next page can install its own.
	installed?.main.close();
	if (installed !== null) {
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
	}
	installed = null;
});

describe('Lynx worklet template runs', () => {
	it('mounts a keyed worklet list in three commands at any scale', async () => {
		const { dom, commits } = installEnvironment();

		backgroundRoot = createLynxRoot();
		await backgroundRoot.render(Scene, { rows: rows(10) });
		await backgroundRoot.flushTransport();

		// The page host, the run that mounts every row, and the insert that attaches
		// the page — one `create` in the frame and none per row. The 6,002 was 6,000
		// per-host creates and inserts plus those three. §1's plain row paid exactly
		// this, and the worklet row now pays it too.
		const mount = commits.at(-1)!;
		expect(mount.map((command) => command.op)).toEqual(['create', 'mount-template-run', 'insert']);
		expect(onlyRun(mount).count).toBe(10);
		expect(dom.window.document.querySelectorAll('view.row')).toHaveLength(10);
		expect(dom.window.document.querySelector('#row-7')?.querySelector('text')?.textContent).toBe(
			'row 7',
		);
		await backgroundRoot.unmount();
		backgroundRoot = null;

		// The count is a property of the program, not of the list length: the run
		// grows its value array, not the command stream. This is the cell that read
		// 6,002 before the compiler and the core stopped refusing a bound
		// `main-thread:` prop.
		backgroundRoot = createLynxRoot();
		await backgroundRoot.render(Scene, { rows: rows(1000) });
		await backgroundRoot.flushTransport();
		const large = commits.at(-1)!;
		expect(large.map((command) => command.op)).toEqual(['create', 'mount-template-run', 'insert']);
		expect(onlyRun(large).count).toBe(1000);
		expect(dom.window.document.querySelectorAll('view.row')).toHaveLength(1000);
	});

	it('binds one background execution per row and destroys it with the row', async () => {
		const { commits, main } = installEnvironment();
		const list = rows(3);

		backgroundRoot = createLynxRoot();
		await backgroundRoot.render(Scene, { rows: list });
		await backgroundRoot.flushTransport();

		// One `onTap` value is shared by every row, so an execution keyed by the
		// value rather than by the host would give the three rows one callback
		// between them and let any row's teardown silence the others. The captured
		// background function is what needs an execution at all: without one the
		// worklet ships unbound and cannot call back.
		const run = onlyRun(commits.at(-1)!);
		const executions = workletSlots(run).map((slot) => {
			expect(slot._wkltId).toBe(TAP);
			const captured = (slot._c as { values: readonly Record<string, unknown>[] }).values[0]!;
			expect(captured._jsFnId).toBe(RECORD);
			return captured._execId;
		});
		expect(executions.every((execution) => typeof execution === 'string')).toBe(true);
		expect(new Set(executions).size).toBe(3);

		// An execution is what makes a captured background function callable from
		// the main thread, so calling it is how a row's lifetime is observed rather
		// than inferred from the frame.
		const call = (execution: unknown) =>
			main.callBackground({ _jsFnId: RECORD, _execId: execution as string }, []).promise;
		await expect(call(executions[1])).resolves.toBe('recorded');

		// Removing the middle row destroys every host of that instance, which is
		// what releases the callbacks the run installed on it.
		await backgroundRoot.render(Scene, { rows: [list[0]!, list[2]!] });
		await backgroundRoot.flushTransport();
		const removal = commits.at(-1)!;
		const hostsPerRow = run.program.nodes.length;
		// The row leaves as one run rather than as per-host removes and destroys:
		// upstream's collapsed-run teardown (#750, arriving with issue #227) names
		// the contiguous range and the driver derives the unbinds, removes, and
		// destroys from the program it already holds. What matters here is that
		// the range named is exactly the middle row's, so the teardown below
		// reaches that row's hosts and stops there.
		expect(removal).toEqual([
			{
				op: 'destroy-run',
				parent: run.parent,
				firstId: run.firstId + hostsPerRow,
				count: 1,
				width: hostsPerRow,
			},
		]);

		// The removed row's callback is gone: its execution was the run's, keyed by
		// the host the run installed it on, and that host's `destroy` released it.
		await expect(call(executions[1])).rejects.toThrow();

		// The survivors keep the executions the run gave them. Their handler names
		// the same thing this render as last, so the frame carries nothing for them
		// and there is nothing to take their executions away: a row's teardown
		// reaches that row's hosts and stops there.
		await expect(call(executions[0])).resolves.toBe('recorded');
		await expect(call(executions[2])).resolves.toBe('recorded');
	});

	it('re-sends a row handler only when the handler changes', async () => {
		const { commits } = installEnvironment();
		const list = rows(3);

		backgroundRoot = createLynxRoot();
		await backgroundRoot.render(CapturingScene, { rows: list, armed: false });
		await backgroundRoot.flushTransport();
		const mounted = commits.length;

		// `bindThreadFunction` returns a fresh tagged function every render, so an
		// identity-only prop diff would call every row's handler changed and re-send
		// its whole prop bag — one update per worklet-bearing row, per render,
		// forever. The list is unchanged here, so a plain row emits nothing and a
		// worklet row must emit nothing too.
		await backgroundRoot.render(CapturingScene, { rows: [...list], armed: false });
		await backgroundRoot.flushTransport();
		expect(commits.slice(mounted).flat()).toEqual([]);

		// The handler's captures are what it will act on, so a change in them is a
		// change in the handler: suppressing that update would leave every row
		// tapping on stale state. Only the rows whose capture moved are re-sent.
		await backgroundRoot.render(CapturingScene, { rows: list, armed: true });
		await backgroundRoot.flushTransport();
		const armed = commits.slice(mounted).flat();
		expect(armed.map((command) => command.op)).toEqual(['update', 'update', 'update']);
		for (const command of armed) {
			if (command.op !== 'update') throw new Error('Expected an update.');
			const descriptor = command.props['main-thread:bindtap'] as {
				_c: { values: readonly unknown[] };
			};
			expect(descriptor._c.values[1]).toBe(true);
		}
	});
});
