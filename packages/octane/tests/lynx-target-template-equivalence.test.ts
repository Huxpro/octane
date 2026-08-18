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
import { createLynxNativeResource } from '../../lynx/src/resource.js';

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

// A `@try` boundary whose body holds two independent, mutually exclusive
// outcomes: the parent carries a background-only native resource (which the
// renderer refuses on both encodings) and the child suspends. Whichever the
// renderer observes first decides which arm commits. Both renders SUCCEED —
// this is a difference in what is painted, not an error path.
const ARM_SELECTION_SOURCE = `/** @jsxImportSource @octanejs/lynx/intrinsics */
import { use } from 'octane';

function Suspends(props: { gate: Promise<string> }) @{
	const label = use(props.gate);
	<text class="loaded">{label}</text>
}

export function Scene(props: { outer: unknown; gate: Promise<string> }) @{
	<view class="root">
		@try {
			<view data-outer={props.outer}>
				<Suspends gate={props.gate} />
			</view>
		} @pending {
			<text class="pending">{'PENDING'}</text>
		} @catch (error) {
			<text class="caught">{error.message as string}</text>
		}
	</view>
}
`;

function committedArm(result: { readonly batch: { readonly commands: readonly any[] } }): string[] {
	return result.batch.commands
		.filter((command) => command.op === 'create' && command.props?.class)
		.map((command) => String(command.props.class));
}

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

	it('commits the same @try arm under both encodings', () => {
		// A real background-only resource, not an object impersonating the
		// framework's internal brand: the renderer's own guard is what refuses it.
		const props = () => ({
			outer: createLynxNativeResource('OUTER'),
			gate: new Promise<string>(() => {}),
		});
		const fromTemplates = MainRenderer.renderLynxFirstScreen(
			scene(ARM_SELECTION_SOURCE, 'lynx'),
			props() as never,
		);
		const fromPlans = MainRenderer.renderLynxFirstScreen(
			scene(ARM_SELECTION_SOURCE, 'universal'),
			props() as never,
		);
		expect(committedArm(fromTemplates)).toEqual(committedArm(fromPlans));
		expect(fromTemplates.batch).toEqual(fromPlans.batch);
	});
});
