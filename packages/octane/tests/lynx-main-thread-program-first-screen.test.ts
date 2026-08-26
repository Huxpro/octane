// Issue-#163 C2c: a compiled main-thread program claims its first screen's IDs.
//
// C1 made the `target: 'lynx'` main-thread compile emit a compiled create
// function in place of the description an interpreter walks. That leaves one
// question the emission alone cannot answer: a first screen is not only paint.
// It is also the IDs the background will independently assign to the same tree,
// and the listener bindings it announces so a tap reaches a handler. Those have
// to come out of the compiled arm exactly as they come out of the interpreted
// one, or the two threads disagree about which node is which and the page is
// unadoptable — it repaints on every launch and drops the taps in between.
//
// So this is a differential over everything about a first screen *except* the
// painting: same source, both encodings, and the IDs, the counts and the whole
// event envelope compared. Painting is C2d's, and the two paths that would
// paint are asserted to refuse by name rather than to quietly paint nothing.
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compiler/compile.js';
import { lynxMainThreadRenderer } from '../../lynx/src/config.js';
import * as Backend from '../../lynx/src/compiler/index.js';
import * as MainRenderer from '../../lynx/src/main-renderer.js';
import * as MainWorklets from '../../lynx/src/main-worklets.js';
import {
	applyLynxFirstScreenDirect,
	createLynxHostContainer,
} from '../../lynx/src/core/host-driver.js';
import { createFakePAPI } from '../../lynx/tests/_fixtures/fake-element-papi.js';

/**
 * Two events and two ranges, arranged so an interleaving mistake shows.
 *
 * `onPick` sits on a node *before* the first range and `onHold` on a node
 * *after* it. A program that numbered its own nodes first and its ranges'
 * members afterwards would still agree about `onPick`, about how many hosts
 * there are, and about every listener ID — and would put `onHold` on the wrong
 * node. That is the mistake worth a fixture, so both text holes carry a value
 * and each range therefore has a member that consumes an ID of its own.
 */
const CARD = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { label: string; detail: string; tone: string; onPick: () => void; onHold: () => void }) @{
	<view class={props.tone}>
		<text class="card-label" bindtap={props.onPick}>{props.label as string}</text>
		<view class="card-body"><text class="d" bindtap={props.onHold}>{props.detail as string}</text></view>
	</view>
}
`;

type CardComponent = Parameters<typeof MainRenderer.renderLynxFirstScreen>[0];

function compiled(program: boolean): string {
	return compile(CARD, '/src/Card.lynx.tsrx', {
		hmr: false,
		renderer: { ...lynxMainThreadRenderer, target: 'lynx', id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread: 'main-thread' },
		...(program ? { mainThreadProgramBackend: Backend } : null),
	}).code;
}

function cardFor(program: boolean): CardComponent {
	const rewritten = compiled(program)
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx(?:\/[\w-]+)?["'];/g,
			(_match, specifiers: string) =>
				`const {${specifiers.replace(/\s+as\s+/g, ': ')}} = __universal;`,
		)
		.replace('export const Card =', 'const Card =');
	return new Function('__universal', `${rewritten}\nreturn Card;`)({
		...MainRenderer,
		...MainWorklets,
	}) as CardComponent;
}

const PROPS = {
	label: 'Label',
	detail: 'Detail',
	tone: 'card active',
	onPick: () => {},
	onHold: () => {},
};

function render(program: boolean): MainRenderer.LynxFirstScreenRenderResult {
	return MainRenderer.renderLynxFirstScreen(cardFor(program), PROPS as never);
}

describe('a compiled main-thread program on the first-screen path', () => {
	it('compiles the fixture to both encodings', () => {
		// Guards the premise. If eligibility ever declined this shape the cells
		// below would compare the interpreted arm against itself and prove
		// nothing.
		expect(compiled(true)).toContain('"kind": "program"');
		expect(compiled(false)).not.toContain('"kind": "program"');
		expect(compiled(false)).toContain('"kind": "template"');
	});

	it('takes the same first-screen IDs as the interpreted encoding', () => {
		const program = render(true);
		const interpreted = render(false);

		// Four hosts the program creates, plus the one text member each of its two
		// holes turned out to hold. The program does not paint the members — that
		// is what makes them holes — but it does have to leave room for them.
		expect(program.hostCount).toBe(interpreted.hostCount);
		expect(program.hostCount).toBe(6);
		// The number the background counts to. A hole takes no ID of its own on
		// either arm: the interpreted arm splices a hole's members into their
		// parent, so a program that wrapped its holes in a node would land here one
		// higher per hole and shift every ID after the first one.
		expect(program.logicalCount).toBe(interpreted.logicalCount);
		expect(program.logicalCount).toBe(6);
	});

	it('announces the same listener bindings as the interpreted encoding', () => {
		const program = render(true);
		const interpreted = render(false);

		expect(program.envelope).toEqual(interpreted.envelope);
		// Spelled out rather than only compared, because "equal to each other" is
		// also true of two arms wrong in the same way. Pre-order over the painted
		// tree: view 1, the label text 2, its member 3, the body view 4, the detail
		// text 5, its member 6. So the second `bindtap` is host 5 — 5 and not 4,
		// which is the assertion that the first hole's member was numbered on its
		// way past rather than after the program.
		expect(program.envelope.events).toEqual([
			{ id: 2, type: 'bindtap', listener: { id: 1_000_000, priority: 'discrete' } },
			{ id: 5, type: 'bindtap', listener: { id: 1_000_001, priority: 'discrete' } },
		]);
	});

	it('announces no binding for an event site whose handler is not callable', () => {
		// An event-named prop that arrives holding nothing callable installs no
		// listener on an authored host, so a program's event site must behave the
		// same way: its table says where the sites are, the values say which ones
		// are bound. A program that announced its whole table would hand the
		// background a listener for a handler that does not exist.
		const unbound = { ...PROPS, onHold: undefined };
		const program = MainRenderer.renderLynxFirstScreen(cardFor(true), unbound as never);
		const interpreted = MainRenderer.renderLynxFirstScreen(cardFor(false), unbound as never);
		expect(program.envelope).toEqual(interpreted.envelope);
		expect(program.envelope.events).toEqual([
			{ id: 2, type: 'bindtap', listener: { id: 1_000_000, priority: 'discrete' } },
		]);
	});

	it('refuses both paint paths rather than painting a page without the program', () => {
		const program = render(true);
		// A batch is commands, and a program exists so its first screen is not
		// commands. This refusal is permanent, not a "not yet".
		expect(() => program.batch).toThrow(/has no command batch/);

		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1 });
		// The direct applier is the one that will run a program (C2d). Until it
		// does, a program must not reach the range-transparent branch, which would
		// walk straight past it and publish a page missing everything it paints.
		expect(() => applyLynxFirstScreenDirect(container, program.nodes, program.envelope)).toThrow(
			/cannot yet mount a compiled main-thread program/,
		);
	});
});
