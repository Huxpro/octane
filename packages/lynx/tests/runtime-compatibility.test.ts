import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const LYNX_ROOT = resolve(import.meta.dirname, '..');
const REPOSITORY_ROOT = resolve(LYNX_ROOT, '../..');
const evidence = JSON.parse(
	readFileSync(resolve(LYNX_ROOT, 'audit/runtime-compatibility.json'), 'utf8'),
) as {
	selectedSdk: string;
	selectedRspeedy: string;
	runtimes: Record<string, { compileGraph: string }>;
	universalCoreBuiltins: {
		diagnosedApplicationGlobals: string[];
		documentedOrBaseline: string[];
		microtaskContract: string;
		symbolContract: string;
	};
};
const toolchain = JSON.parse(readFileSync(resolve(LYNX_ROOT, 'audit/toolchain.json'), 'utf8')) as {
	nativeSdk: { version: string };
	packages: Array<{ name: string; version: string }>;
};
const universalCore = readFileSync(
	resolve(REPOSITORY_ROOT, 'packages/octane/src/universal-core.ts'),
	'utf8',
);
const universalKernel = readFileSync(
	resolve(REPOSITORY_ROOT, 'packages/octane/src/universal-kernel.ts'),
	'utf8',
);
const lifecycleData = readFileSync(resolve(LYNX_ROOT, 'src/core/lifecycle-data.ts'), 'utf8');

function runtimeSourceGraph(entry: string): { files: string[]; packages: string[] } {
	const pending = [entry];
	const files = new Set<string>();
	const packages = new Set<string>();
	while (pending.length > 0) {
		const filename = pending.pop()!;
		if (files.has(filename)) continue;
		files.add(filename);
		const source = readFileSync(filename, 'utf8');
		const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
		for (const statement of parsed.statements) {
			if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
			if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
			const request = statement.moduleSpecifier.text;
			if (!request.startsWith('.')) {
				packages.add(request);
				continue;
			}
			const resolved = resolve(dirname(filename), request.replace(/\.js$/, '.ts'));
			pending.push(resolved);
		}
	}
	return {
		files: [...files].map((filename) => relative(LYNX_ROOT, filename).replaceAll('\\', '/')).sort(),
		packages: [...packages].sort(),
	};
}

describe('Lynx runtime compatibility evidence', () => {
	it('stays aligned with the immutable SDK and Rspeedy pins', () => {
		expect(evidence.selectedSdk).toBe(toolchain.nativeSdk.version);
		expect(evidence.selectedRspeedy).toBe(
			toolchain.packages.find((entry) => entry.name === '@lynx-js/rspeedy')?.version,
		);
		expect(Object.keys(evidence.runtimes)).toEqual(['main-thread', 'background']);
		expect(
			new Set(Object.values(evidence.runtimes).map((runtime) => runtime.compileGraph)),
		).toEqual(new Set(['packages/rspeedy-plugin-octane/tests/build.test.ts']));
	});

	it('records every non-baseline built-in used by the native universal runtime graph', () => {
		expect(universalCore).toContain('.flatMap(');
		expect(universalCore).toContain('.finally(');
		expect(universalCore).toContain('globalThis');
		expect(universalCore).not.toMatch(/\bqueueMicrotask\s*\(/);
		expect(universalCore).not.toMatch(
			/\b(?:FinalizationRegistry|structuredClone|WeakRef)\b|\.(?:toReversed|toSorted)\s*\(/,
		);
		expect(lifecycleData).not.toMatch(/\.at\s*\(/);
		expect(universalCore).toContain("typeof AggregateError === 'function'");
		expect(universalKernel).toContain('.description');
		expect(evidence.universalCoreBuiltins.documentedOrBaseline).toEqual(
			expect.arrayContaining([
				'Array.prototype.flatMap',
				'globalThis',
				'Promise.prototype.finally',
				'Symbol.prototype.description',
			]),
		);
		expect(evidence.universalCoreBuiltins.microtaskContract).toMatch(/options\.scheduleMicrotask/);
		expect(evidence.universalCoreBuiltins.symbolContract).toMatch(/Symbol\.prototype\.description/);
		expect(evidence.universalCoreBuiltins.diagnosedApplicationGlobals).toEqual(
			expect.arrayContaining(['queueMicrotask', 'structuredClone']),
		);
	});

	it('keeps background and main-thread runtime ownership in separate source graphs', () => {
		expect(runtimeSourceGraph(resolve(LYNX_ROOT, 'src/root.ts'))).toEqual({
			files: [
				'src/core/background-lifecycle.ts',
				// Issue #103 B0: both background cores are in the *source* graph,
				// because the compile-time switch is a branch in `root.ts` and the
				// bundler folds it. Exactly one survives a production build; the
				// bytes are the claim and `benchmarks/lynx-bundle-size/core-switch.mjs`
				// is what checks it. What this guard still owns is the thing it
				// always owned: no main-thread-only module reaches the background.
				'src/core/block-background.ts',
				'src/core/block-component.ts',
				'src/core/block-core.ts',
				'src/core/block-program.ts',
				'src/core/block-root.ts',
				'src/core/client-driver.ts',
				'src/core/delta-protocol.ts',
				'src/core/delta-shadow.ts',
				'src/core/environment.ts',
				'src/core/host-props.ts',
				'src/core/lifecycle-data.ts',
				'src/core/native-event-receiver.ts',
				'src/core/native-events.ts',
				'src/core/nodes-ref.ts',
				'src/core/own-symbols.ts',
				'src/core/plain-object.ts',
				'src/core/portal.ts',
				'src/core/profiling.ts',
				'src/core/protocol.ts',
				'src/core/renderer-id.ts',
				'src/core/transport.ts',
				'src/core/worklets.ts',
				'src/resource.ts',
				'src/root.ts',
			],
			// Issue #135 item 1b: the plan → wire template lowering is published on
			// its own subpath, and `block-component.ts` is its only importer here.
			// Like the block modules above it is folded by the compile-time switch,
			// and like them it owns no main-thread surface.
			packages: ['octane/universal/native', 'octane/universal/template-program'],
		});
		expect(runtimeSourceGraph(resolve(LYNX_ROOT, 'src/main-thread.ts'))).toEqual({
			files: [
				'src/core/environment.ts',
				'src/core/first-screen-host.ts',
				'src/core/first-screen.ts',
				'src/core/host-driver.ts',
				'src/core/host-props.ts',
				'src/core/lifecycle-data.ts',
				'src/core/list.ts',
				'src/core/main-thread-worklet-feature.ts',
				'src/core/native-events.ts',
				'src/core/nodes-ref.ts',
				'src/core/own-symbols.ts',
				'src/core/papi.ts',
				'src/core/plain-object.ts',
				'src/core/portal.ts',
				'src/core/profiling.ts',
				'src/core/protocol.ts',
				'src/core/renderer-id.ts',
				'src/core/worklets.ts',
				'src/main-renderer.ts',
				'src/main-thread.ts',
				'src/resource.ts',
			],
			packages: [],
		});
	});
});
