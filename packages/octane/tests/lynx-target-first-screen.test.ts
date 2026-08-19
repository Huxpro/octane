// Issue #87: the pair production ships had no committed runtime coverage.
//
// The `lynx` vitest project compiles its fixtures with the *background* preset
// (`lynxRspeedyRenderers` → `target: 'universal'`), so no committed test ever
// executed `target: 'lynx'` output — while the real Rspeedy main-thread bundle
// carries exactly the L1 slot-kind table and create-function locals. L1 (#63)
// and L3 (#65) were each covered alone: the compile-output differential never
// reached `host-driver.ts`, and the applier differential never saw a
// template-encoded plan.
//
// This closes that: one fixture, compiled at both targets, rendered, and then
// applied through both appliers — four cells over the same fake Element PAPI.
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compiler/compile.js';
import { lynxMainThreadRenderer } from '../../lynx/src/config.js';
import * as MainRenderer from '../../lynx/src/main-renderer.js';
import {
	applyLynxFirstScreenDirect,
	captureLynxFirstTree,
	createLynxHostContainer,
	prepareLynxHostBatch,
} from '../../lynx/src/core/host-driver.js';
import { createFakePAPI, shape } from '../../lynx/tests/_fixtures/fake-element-papi.js';

const SOURCE = `import { useCallback, useState } from 'octane';

function Row(props: { label: string; active: boolean; onPick: () => void }) @{
	<view class={props.active ? 'row active' : 'row'}>
		<text class="label" bindtap={props.onPick}>{props.label as string}</text>
	</view>
}

export function Scene() @{
	const [count, setCount] = useState(0);
	const pick = useCallback(() => setCount((value) => value + 1), []);
	const items = [
		{ id: 'a', label: 'alpha', active: true },
		{ id: 'b', label: 'beta', active: false },
		{ id: 'c', label: 'gamma', active: true },
	];
	<view class="page">
		<text class="title">{'Fixture · ' + String(count)}</text>
		@if (count === 0) {
			<text class="hint">tap a row</text>
		} @else {
			<text class="hint">picked</text>
		}
		<view class="rows">
			@for (const item of items; key item.id) {
				<Row label={item.label} active={item.active} onPick={pick} />
			}
		</view>
	</view>
}
`;

type SceneComponent = Parameters<typeof MainRenderer.renderLynxFirstScreen>[0];

function compiled(target: 'lynx' | 'universal'): string {
	return compile(SOURCE, '/src/Scene.lynx.tsrx', {
		hmr: false,
		renderer: { ...lynxMainThreadRenderer, target, id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread: 'main-thread' },
	}).code;
}

function sceneFor(target: 'lynx' | 'universal'): SceneComponent {
	const rewritten = compiled(target)
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx\/main-renderer["'];/g,
			(_match, specifiers: string) =>
				`const {${specifiers.replace(/\s+as\s+/g, ': ')}} = __universal;`,
		)
		.replace(/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx\/main-worklets["'];/g, '')
		.replace('export const Scene =', 'const Scene =');
	return new Function('__universal', `${rewritten}\nreturn Scene;`)(MainRenderer) as SceneComponent;
}

interface Cell {
	readonly tree: unknown;
	readonly snapshot: unknown;
	readonly hostCount: number;
}

function paint(target: 'lynx' | 'universal', applier: 'direct' | 'staged'): Cell {
	const result = MainRenderer.renderLynxFirstScreen(sceneFor(target), {});
	const papi = createFakePAPI();
	const container = createLynxHostContainer(papi, { root: 1 });
	if (applier === 'direct') {
		expect(applyLynxFirstScreenDirect(container, result.nodes, result.batch)).toBe(true);
	} else {
		prepareLynxHostBatch(container, result.batch).apply();
	}
	const captured = captureLynxFirstTree(container);
	expect(captured).not.toBeNull();
	return {
		tree: shape(papi.pages[0]!),
		snapshot: captured!.snapshot,
		hostCount: result.batch.commands.length,
	};
}

describe('lynx-target first screen, end to end', () => {
	it('compiles the fixture to the create-function encoding', () => {
		// Guards the premise. If eligibility ever rejected this shape the cells
		// below would compare `universal` against itself and prove nothing, so
		// the two encodings are asserted to actually differ here.
		const lynx = compiled('lynx');
		const universal = compiled('universal');
		expect(lynx).toContain('"kind": "template"');
		expect(lynx).toContain('"slots"');
		expect(lynx).toMatch(/\bn0\b/);
		expect(universal).not.toContain('"kind": "template"');
		// The keyed `@for` body root is a component, so that hole stays a plan:
		// the fixture exercises a module that mixes both encodings, which is what
		// production modules look like.
		expect(lynx).toContain('"kind": "slot"');
	});

	it('paints the same tree and adoption snapshot on all four cells', () => {
		const universalStaged = paint('universal', 'staged');
		const universalDirect = paint('universal', 'direct');
		const lynxStaged = paint('lynx', 'staged');
		const lynxDirect = paint('lynx', 'direct');

		// The encoding must not be observable: same target, either applier, and
		// either target through the same applier all land on one tree.
		expect(lynxStaged.tree).toEqual(universalStaged.tree);
		expect(lynxDirect.tree).toEqual(universalDirect.tree);
		expect(lynxDirect.tree).toEqual(lynxStaged.tree);

		// Adoption is what the background thread reads back, so it is the part
		// that must be byte-compatible across all four.
		expect(lynxStaged.snapshot).toEqual(universalStaged.snapshot);
		expect(lynxDirect.snapshot).toEqual(universalDirect.snapshot);
		expect(lynxDirect.snapshot).toEqual(lynxStaged.snapshot);

		// The batch itself stays identical across encodings, which is what #63
		// claimed and what the applier cells above consume.
		expect(lynxStaged.hostCount).toBe(universalStaged.hostCount);
	});
});
