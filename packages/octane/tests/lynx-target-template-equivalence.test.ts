// A module compiled under `target: 'lynx'` must render the same first-screen
// host batch as the same module compiled under `target: 'universal'`, for every
// template the eligibility predicate admits
// (docs/lynx-specialized-target-l0.md §3.2, and the contract stated in
// packages/octane/tests/lynx-target-templates.test.ts). Adoption identity is
// positional, so a difference in host count, painted text, or command order
// changes the tree the background thread adopts against.
//
// Both cases below assert only that the two encodings AGREE. They do not pin
// either encoding's own behavior, so any fix that makes the two paths consistent
// turns them green.
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compiler/compile.js';
import { lynxMainThreadRenderer } from '../../lynx/src/config.js';
import * as MainRenderer from '../../lynx/src/main-renderer.js';

type SceneComponent = Parameters<typeof MainRenderer.renderLynxFirstScreen>[0];

function scene(source: string, target: 'lynx' | 'universal'): SceneComponent {
	const compiled = compile(source, '/src/Scene.lynx.tsrx', {
		hmr: false,
		renderer: { ...lynxMainThreadRenderer, target, id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread: 'main-thread' },
	}).code;
	const rewritten = compiled
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx\/main-renderer["'];/g,
			(_match: string, specifiers: string) =>
				`const {${specifiers.replace(/\s+as\s+/g, ': ')}} = __universal;`,
		)
		.replace(/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx\/main-worklets["'];/g, '')
		.replace('export const Scene =', 'const Scene =');
	return new Function('__universal', `${rewritten}\nreturn Scene;`)(MainRenderer) as SceneComponent;
}

function paintedText(result: { readonly nodes: readonly unknown[] }): string[] {
	const out: string[] = [];
	const walk = (nodes: readonly any[]): void => {
		for (const node of nodes) {
			if (node.kind === 'host' && node.type === '#text') out.push(String(node.props.value));
			walk(node.children);
		}
	};
	walk(result.nodes as readonly any[]);
	return out;
}

// A custom native element declared through the documented
// `LynxCustomIntrinsicElements` augmentation (packages/lynx/README.md). Vendor
// tags carry vendor-chosen attribute names, and the renderer's attribute
// allowlist is only consulted for its own declared intrinsics.
const CUSTOM_ELEMENT_SOURCE = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Scene(props: { spec: unknown }) @{
	<octane-badge class="page" __proto__={props.spec} />
}
`;

const OBSERVATION_ORDER_SOURCE = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Scene(props: { outer: unknown; inner: unknown }) @{
	<view class="page">
		@try {
			<view class="risky" data-outer={props.outer}>
				<text class="inner" data-inner={props.inner}>{'inner'}</text>
			</view>
		} @catch (error) {
			<text class="fallback">{error.message as string}</text>
		}
	</view>
}
`;

describe('lynx-target template equivalence', () => {
	it('renders the same batch when a custom element carries an inherited prop name', () => {
		const spec = { children: 'hijacked' };
		const fromTemplates = MainRenderer.renderLynxFirstScreen(scene(CUSTOM_ELEMENT_SOURCE, 'lynx'), {
			spec,
		});
		const fromPlans = MainRenderer.renderLynxFirstScreen(
			scene(CUSTOM_ELEMENT_SOURCE, 'universal'),
			{ spec },
		);
		expect(fromTemplates.hostCount).toBe(fromPlans.hostCount);
		expect(paintedText(fromTemplates)).toEqual(paintedText(fromPlans));
		expect(fromTemplates.batch).toEqual(fromPlans.batch);
	});

	it('paints the same caught error when a prop value throws', () => {
		// Two ordinary consumer objects whose property read throws. Which one the
		// renderer observes first decides what the boundary paints.
		const throwing = () => ({
			outer: {
				get $$kind(): never {
					throw new Error('outer prop exploded');
				},
			},
			inner: {
				get $$kind(): never {
					throw new Error('inner prop exploded');
				},
			},
		});
		const fromTemplates = MainRenderer.renderLynxFirstScreen(
			scene(OBSERVATION_ORDER_SOURCE, 'lynx'),
			throwing(),
		);
		const fromPlans = MainRenderer.renderLynxFirstScreen(
			scene(OBSERVATION_ORDER_SOURCE, 'universal'),
			throwing(),
		);
		expect(paintedText(fromTemplates)).toEqual(paintedText(fromPlans));
		expect(fromTemplates.batch).toEqual(fromPlans.batch);
	});
});
