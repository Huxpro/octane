/**
 * Issue-#163 C0 — derive the bench app's block program with the framework's
 * own lowering, so the spike prices a real program rather than a hand-written
 * one.
 *
 * `benchmarks/lynx-table/prototype/lepus-root.js` is the `octane-direct` cell:
 * a main-thread program written by hand for this one fixture, and therefore an
 * architecture floor rather than a claim about what a backend could emit. This
 * script closes that gap from the other side. It compiles
 * `app/src/App.lynx.tsrx` with the repo's own compiler, takes the two plans the
 * compiler declares at module level, and runs them through the same
 * plan → wire-program lowering `packages/lynx/src/core/block-component.ts`
 * uses — the one `packages/octane/tests/lynx-block-template-lowering.test.ts`
 * pins against the hand-written program.
 *
 * What comes out is `programs.json`: the page and row
 * `UniversalHostTemplateProgram`s, the range site where `@for` sat, and the
 * value/event slot maps. `emit.mjs` turns those into straight-line main-thread
 * code; nothing downstream re-derives them.
 *
 *   node mts-block/derive.mjs
 *   MTS_BLOCK_DEBUG=1 node mts-block/derive.mjs   # plan/render counts, and the
 *                                                 # message of the throw below
 *
 * The module is evaluated, and each component it defines is invoked once with
 * empty props, for one reason: which of the page's holes is the keyed `@for`
 * is not decidable from the plan. A renderable hole is one plan node whatever
 * it holds, so the range hole and `{row.label}` are the same shape — only the
 * *value* tells them apart, which is why `universalTemplateProgramWithoutRanges`
 * asks a predicate rather than inspecting the plan. That is the same question
 * `block-component.ts` answers with `isRangeValue`, answered the same way here.
 * The application's other top-level effects (a `MessageChannel`, the seeded row
 * builder) are stubbed rather than run, because running them would price the
 * harness instead of the lowering.
 */
process.env.NODE_ENV = 'production';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

import { compile } from '../../../packages/octane/src/compiler/compile.js';
import { lynxBackgroundRenderer } from '../../../packages/lynx/src/config.runtime.js';

const ROOT = import.meta.dirname;
const BENCH = path.resolve(ROOT, '..');
const REPO = path.resolve(BENCH, '../..');
const LYNX_SOURCE = path.join(REPO, 'packages/lynx/src');
const OCTANE_SOURCE = path.join(REPO, 'packages/octane/src');

const APP = path.join(BENCH, 'app/src/App.lynx.tsrx');

/** Build the TypeScript half once and import it. Mirrors `block-counts.mjs`. */
async function loadLowering() {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-mts-block-'));
	await build({
		configFile: false,
		root: REPO,
		logLevel: 'silent',
		resolve: {
			alias: [
				{ find: /^@octanejs\/lynx$/, replacement: path.join(LYNX_SOURCE, 'index.ts') },
				{
					find: /^@octanejs\/lynx\/intrinsics\/jsx-runtime$/,
					replacement: path.join(LYNX_SOURCE, 'intrinsics.ts'),
				},
				{ find: /^@octanejs\/lynx\/(.*)$/, replacement: `${LYNX_SOURCE}/$1.ts` },
				{
					find: /^octane\/universal\/template-program$/,
					replacement: path.join(OCTANE_SOURCE, 'universal-template-program.ts'),
				},
				{
					find: /^octane\/universal\/native$/,
					replacement: path.join(OCTANE_SOURCE, 'universal-native.ts'),
				},
				{ find: /^octane\/universal$/, replacement: path.join(OCTANE_SOURCE, 'universal.ts') },
				{ find: /^octane$/, replacement: path.join(OCTANE_SOURCE, 'index.ts') },
			],
		},
		define: { 'process.env.NODE_ENV': '"production"' },
		build: {
			write: true,
			minify: false,
			target: 'node22',
			lib: {
				entry: path.join(ROOT, 'lowering-entry.ts'),
				formats: ['es'],
				fileName: 'lowering-entry',
			},
			outDir: tempDir,
			emptyOutDir: false,
			rollupOptions: { external: [] },
		},
	});
	return {
		module: await import(pathToFileURL(path.join(tempDir, 'lowering-entry.js')).href),
		tempDir,
	};
}

/**
 * Every plan the compiled app declares, in declaration order.
 *
 * Evaluated rather than pattern-matched, for the reason the lowering test gives:
 * a compiler that stopped emitting a plan, or emitted one the runtime rejects,
 * has to fail here rather than pass a regex.
 */
function compiledPlans(Renderer) {
	const { code } = compile(fs.readFileSync(APP, 'utf8'), '/src/App.lynx.tsrx', {
		hmr: false,
		renderer: { ...lynxBackgroundRenderer, id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread: 'background' },
	});
	const rewritten = code
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx(?:\/[\w-]+)?["'];/g,
			(_match, specifiers) => `const {${specifiers.replace(/\s+as\s+/g, ': ')}} = __universal;`,
		)
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']\.\/data\.js["'];/g,
			(_match, specifiers) => `const {${specifiers.replace(/\s+as\s+/g, ': ')}} = __data;`,
		)
		// Run as a function body, which has no export syntax.
		.replace(/^export /gm, '');

	const plans = [];
	const rendered = [];
	const defined = [];
	const universal = {
		...Renderer,
		hookSlots: () => 0,
		useCallback: (fn) => fn,
		useRef: (value) => ({ current: value }),
		useState: (value) => [value, () => {}, () => value],
		universalPlan(renderer, root) {
			const plan = Renderer.universalPlan(renderer, root);
			plans.push(plan);
			return plan;
		},
		universalValue(plan, values) {
			rendered.push({ plan, values });
			return Renderer.universalValue(plan, values);
		},
		// `(renderer, render, metadata)` — the renderer id comes first.
		defineUniversalComponent(renderer, render, metadata) {
			defined.push(render);
			return Renderer.defineUniversalComponent(renderer, render, metadata);
		},
	};
	const data = { buildData: () => [], buildDataSeeded: () => [] };
	// `App.lynx.tsrx` opens a MessageChannel at module scope for the storm ticks.
	// Nothing here clicks a storm, so a channel that never delivers is the
	// honest stub: a real one would keep the process alive for no measurement.
	const channel = {
		port1: { onmessage: null },
		port2: { postMessage() {} },
	};
	new Function(
		'__universal',
		'__data',
		'MessageChannel',
		'__BENCH_AUTOROWS__',
		'__OCTANE_LYNX_PROFILE__',
		rewritten,
	)(
		universal,
		data,
		function MessageChannelStub() {
			return channel;
		},
		0,
		false,
	);
	// Invoke each component once so the range predicate has values to read. A
	// row body dereferences props this cannot supply and throws; that is
	// expected and skipped, because the range site is on the page and the page
	// takes no props it needs. A silent empty result would be the real failure,
	// so the caller checks what came back rather than trusting this loop.
	for (const body of defined) {
		try {
			body({});
		} catch (error) {
			if (process.env.MTS_BLOCK_DEBUG) console.error('[body threw]', error.message);
		}
	}
	if (process.env.MTS_BLOCK_DEBUG) {
		console.error(
			'[defined]',
			defined.length,
			'[rendered]',
			rendered.length,
			'[plans]',
			plans.length,
		);
	}
	return { plans, rendered };
}

/** An encoder whose peer has negotiated template-program mounts, as the app's does. */
function lynxEncoder(lowering) {
	const container = lowering.createLynxClientContainer({ createSelectorQuery: () => ({}) });
	lowering.setLynxClientCapabilities(container, {
		templateMount: 1,
		templateProgram: 1,
		templateRuns: 1,
	});
	return lowering.createUniversalHostEncoder({
		driver: lowering.createLynxClientDriver(container),
		container,
		renderer: 'lynx',
		resourceRoot: 1,
		transported: true,
	});
}

/** What `block-component.ts` calls a keyed range: the value, not the plan node. */
const UNIVERSAL_FOR = Symbol.for('octane.universal.for');
function isRangeValue(value) {
	return value !== null && typeof value === 'object' && value.$$kind === UNIVERSAL_FOR;
}

function lower(lowering, plan, values) {
	const encoder = lynxEncoder(lowering);
	const compiled = lowering.compiledUniversalTemplateProgram(encoder, plan.root);
	if (compiled === null) {
		throw new Error('the lowering refused this plan: it is not compile-time host structure');
	}
	const reduced = lowering.universalTemplateProgramWithoutRanges(compiled, (slot) =>
		isRangeValue(values[slot]),
	);
	if (reduced === null) {
		throw new Error('a keyed range is not the last child of its host element');
	}
	const prepared = lowering.prepareUniversalTemplateProgram(encoder, reduced.compiled);
	if (prepared === null) throw new Error('the lowering produced no wire program');
	return { prepared, ranges: reduced.ranges };
}

const { module: lowering, tempDir } = await loadLowering();
try {
	const { plans, rendered } = compiledPlans(lowering.Renderer);
	// Two module-level plans: the row body and the page. A `@for` whose body is a
	// single component hole contributes no plan of its own, which is why this is
	// two rather than the three the reduced fixture in the lowering test declares.
	if (plans.length !== 2) {
		throw new Error(`expected 2 module-level plans from App.lynx.tsrx, got ${plans.length}`);
	}
	const valuesFor = (plan) => {
		const entry = rendered.find((candidate) => candidate.plan === plan);
		if (entry === undefined) {
			throw new Error('no component returned this plan, so its range holes cannot be identified');
		}
		return entry.values;
	};
	// A row has no range hole of its own, and its body needs props this script
	// cannot supply, so it is lowered against an empty value list: the predicate
	// is asked and answers false for every slot, which is the truth for a row.
	const row = lower(lowering, plans[0], []);
	if (row.ranges.length !== 0) {
		throw new Error(`the row template grew a range site: ${row.ranges.length}`);
	}
	const page = lower(lowering, plans[1], valuesFor(plans[1]));
	if (page.ranges.length !== 1) {
		throw new Error(`expected exactly one keyed range site on the page, got ${page.ranges.length}`);
	}
	const payload = {
		source: 'benchmarks/lynx-table/app/src/App.lynx.tsrx',
		derivedBy: 'octane/universal/template-program (the lowering block-component.ts uses)',
		row: { wire: row.prepared.wire, values: row.prepared.values, events: row.prepared.events },
		page: {
			wire: page.prepared.wire,
			values: page.prepared.values,
			events: page.prepared.events,
			range: page.ranges[0],
		},
	};
	const out = path.join(ROOT, 'programs.json');
	fs.writeFileSync(out, JSON.stringify(payload, null, '\t') + '\n');
	console.log(
		`[mts-block] wrote ${path.relative(BENCH, out)}: page ${payload.page.wire.nodes.length} nodes / ` +
			`${payload.page.wire.events.length} events, row ${payload.row.wire.nodes.length} nodes / ` +
			`${payload.row.wire.events.length} events, range at node ${payload.page.range.node}`,
	);
} finally {
	fs.rmSync(tempDir, { recursive: true, force: true });
}
