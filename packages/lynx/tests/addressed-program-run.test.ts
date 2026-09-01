// Issue-#246 E1 — a background-originated mount that names a resident compiled
// program instead of carrying a descriptor.
//
// The claim the merge gate cares about is parity, and it is deliberately
// stronger than "both paths work": a range mounted by `mount-program-run` must
// produce the tree the same range mounted by `mount-template-run` produces —
// same hosts, same ids, same classes and attributes, same listener sites and
// listener ids, same public-instance handles — because the wire is the only
// thing that changed. The applier resolves the program instead of reading it off
// the command and then runs the identical code, so these tests are what says the
// resolution is the *only* difference.
//
// The second half is the refusal surface. A positional address says nothing
// about what it points at, so every way it can fail to name this realm's program
// has to end in a decline with a diagnostic, never in an approximation.
import type { UniversalHostBatch, UniversalHostCommand } from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { createLynxHostContainer, prepareLynxHostBatch } from '../src/core/host-driver.js';
import {
	registerUniversalProgram,
	residentRunProgram,
	residentUniversalProgramCount,
	resolveUniversalProgram,
} from '../src/core/program-registry.js';
import { validateLynxBackgroundOutboundMessage } from '../src/core/protocol.js';
import { createFakePAPI, shape, type FakeNode } from './_fixtures/fake-element-papi.js';

/**
 * A row: a bound class and id on the root, a `<text>` carrying bound content,
 * and a tap on a sibling.
 *
 * Both root bindings are deliberate. With one binding per node a plan slot and
 * the node that reads it share an index, so a resolution that returned the wrong
 * program could still paint a tree that looked right; making them disagree is
 * what turns the parity assertion into an assertion.
 */
const ROW = {
	nodes: [
		{
			type: 'view',
			parent: -1,
			props: {},
			bindings: [
				{ name: 'class', valueIndex: 0 },
				{ name: 'id', valueIndex: 1 },
			],
		},
		{ type: 'text', parent: 0, props: { class: 'label' } },
		{ type: '#text', parent: 1, props: {}, bindings: [{ name: 'value', valueIndex: 2 }] },
		{ type: 'view', parent: 0, props: { class: 'action' } },
	],
	events: [
		{ node: 0, type: 'bindtap', priority: 'default' as const },
		{ node: 3, type: 'catchtap', priority: 'discrete' as const },
	],
};

/** A second program with the same slot count but a different tree. */
const CELL = {
	nodes: [
		{
			type: 'view',
			parent: -1,
			props: { class: 'cell' },
			bindings: [
				{ name: 'id', valueIndex: 0 },
				{ name: 'class', valueIndex: 1 },
			],
		},
		{ type: '#text', parent: 0, props: {}, bindings: [{ name: 'value', valueIndex: 2 }] },
	],
	events: [],
};

const VALUES = Object.freeze([
	'first',
	'row-1',
	'One',
	'second',
	'row-2',
	'Two',
	'third',
	'row-3',
	'Three',
]);

const MODULE = 'src/Row.lynx.tsrx';

/**
 * The registry is module scope, which is the design (`program-registry.ts`), so
 * a test that registered under a fixed address would leak into the next one.
 * Every case takes its own module id and this counter is what keeps them apart.
 */
let nextModule = 0;
function freshModule(): string {
	nextModule += 1;
	return `${MODULE}?case=${nextModule}`;
}

/** Register a wire descriptor the way the compiled main-thread chunk does. */
function registerWire(module: string, index: number, wire: unknown): void {
	registerUniversalProgram(module, index, {
		kind: 'program',
		slots: [],
		nodes: 0,
		values: [],
		events: [],
		ranges: [],
		bind: () => () => null,
		wire,
	} as never);
}

function batch(commands: readonly UniversalHostCommand[]): UniversalHostBatch {
	return { renderer: 'lynx', version: 1, commands };
}

function createHost() {
	const papi = createFakePAPI();
	const container = createLynxHostContainer(papi, { root: 1 });
	return { container, papi, page: container.page };
}

/** The prelude both arms share: a shell to mount into and an anchor to mount before. */
const PRELUDE: readonly UniversalHostCommand[] = [
	{ op: 'create', id: 1, type: 'view', props: { id: 'shell' } },
	{ op: 'insert', parent: null, id: 1, before: null },
	{ op: 'create', id: 2, type: 'view', props: { id: 'anchor' } },
	{ op: 'insert', parent: 1, id: 2, before: null },
] as never;

function mountRun(run: UniversalHostCommand) {
	const { container, page } = createHost();
	const prepared = prepareLynxHostBatch(container, batch([...PRELUDE, run]), {
		compact: true,
		lazyPublicInstances: true,
	});
	const compactHostCount = prepared.compactHostCount;
	const handleDelta = prepared.handleDelta;
	prepared.apply();
	return { tree: shape(page as FakeNode), compactHostCount, handleDelta };
}

describe('mounting a resident program by address (issue #246 E1)', () => {
	it('paints the tree, the ids and the listeners a descriptor run paints', () => {
		const module = freshModule();
		registerWire(module, 0, ROW);

		const descriptor = mountRun({
			op: 'mount-template-run',
			parent: 1,
			before: 2,
			program: ROW,
			firstId: 10,
			firstListenerId: 700,
			count: 3,
			values: VALUES,
		} as never);
		const addressed = mountRun({
			op: 'mount-program-run',
			parent: 1,
			before: 2,
			address: { module, index: 0 },
			firstId: 10,
			firstListenerId: 700,
			count: 3,
			values: VALUES,
		} as never);

		// The whole tree, ids and event sites included, compared without any
		// normalization: both arms were handed the same `firstId` and
		// `firstListenerId`, so every number one produced the other must produce.
		expect(addressed.tree).toEqual(descriptor.tree);
		// Not vacuous: the arms really did paint the row.
		expect(JSON.stringify(descriptor.tree)).toContain('row-3');
		// The counts the transport uses to size an acknowledgement, and the public
		// instance handles adoption is keyed on, are the same two answers.
		expect(addressed.compactHostCount).toBe(descriptor.compactHostCount);
		expect(addressed.handleDelta).toEqual(descriptor.handleDelta);
	});

	it('declines an address this realm does not hold rather than approximating it', () => {
		const module = freshModule();
		const { container } = createHost();
		expect(() =>
			prepareLynxHostBatch(
				container,
				batch([
					...PRELUDE,
					{
						op: 'mount-program-run',
						parent: 1,
						before: 2,
						address: { module, index: 4 },
						firstId: 10,
						firstListenerId: 700,
						count: 1,
						values: ['a', 'b', 'c'],
					},
				] as never),
				{ compact: true },
			),
		).toThrowError(/names program .*#4, which this realm does not hold/);
	});

	it('refuses two different plans under one address', () => {
		const module = freshModule();
		registerWire(module, 0, ROW);
		expect(() => registerWire(module, 0, CELL)).toThrowError(
			/Two compiled main-thread programs claim the address/,
		);
		// The first registration stands: a refused second one must not have
		// replaced it, or the refusal would be a wrong tree with a message.
		expect(resolveUniversalProgram(module, 0)!.wire).toBe(ROW);
	});

	it('resolves a descriptor run from its own field and an addressed run from the registry', () => {
		const module = freshModule();
		registerWire(module, 1, CELL);
		expect(residentRunProgram({ op: 'mount-template-run', program: ROW } as never)).toBe(ROW);
		expect(
			residentRunProgram({ op: 'mount-program-run', address: { module, index: 1 } } as never),
		).toBe(CELL);
		// A malformed address is a miss, not a throw: the caller owns the decline
		// and owns the diagnostic that names the build.
		expect(residentRunProgram({ op: 'mount-program-run', address: null } as never)).toBeUndefined();
		expect(
			residentRunProgram({ op: 'mount-program-run', address: { module, index: 1.5 } } as never),
		).toBeUndefined();
		expect(residentUniversalProgramCount()).toBeGreaterThan(0);
	});

	it('freezes the resident descriptor through, so both memos survive a mount', () => {
		// Not hygiene. `prepareTemplateProgram` and `assertTemplateProgram` both
		// refuse to memoize a program they cannot prove immutable and re-walk it on
		// every mount, so a resident program that was not frozen through would cost
		// the same per mount as the descriptor E1 stopped sending — which is the
		// entire reason for naming one.
		const module = freshModule();
		const wire = {
			nodes: [{ type: 'view', parent: -1, props: { class: 'a' }, bindings: [] }],
			events: [],
		};
		registerWire(module, 0, wire);
		expect(Object.isFrozen(wire)).toBe(true);
		expect(Object.isFrozen(wire.nodes)).toBe(true);
		expect(Object.isFrozen(wire.nodes[0])).toBe(true);
		expect(Object.isFrozen(wire.nodes[0]!.props)).toBe(true);
		expect(Object.isFrozen(wire.nodes[0]!.bindings)).toBe(true);
	});

	it('validates an addressed run against the resolver it is given', () => {
		const module = freshModule();
		registerWire(module, 0, ROW);
		const run = {
			op: 'mount-program-run',
			parent: 1,
			before: null,
			address: { module, index: 0 },
			firstId: 10,
			firstListenerId: 700,
			count: 1,
			values: ['a', 'b', 'c'],
		};
		const message = {
			protocol: 1,
			renderer: 'lynx',
			root: 1,
			version: 1,
			type: 'commit',
			batch: { renderer: 'lynx', version: 1, commands: [run] },
		};
		// With the resolver the main thread passes, the command validates: the
		// program it names is one this realm holds and its value count matches.
		expect(() =>
			validateLynxBackgroundOutboundMessage(message as never, 'checked', residentRunProgram),
		).not.toThrow();
		// Without one, no realm can say what the address means, so the command is
		// refused rather than waved through on the strength of its shape.
		expect(() => validateLynxBackgroundOutboundMessage(message as never, 'checked')).toThrowError(
			/program/,
		);
	});
});
