// Issue-#103 U2b: the Block core on the background side of the real transport.
//
// `block-core.test.ts` proves what the core emits and what it costs. This
// proves the part that has to hold before either number means anything: the
// frames are wire-legal and the protocol accepts them.
//
// Nothing here is a double for the transport. `createLynxBackgroundTransport`
// is the same one `src/root.ts` builds for a production background root, so
// the readiness handshake, the identity discipline, the outbound self-check
// (`selfCheckLynxBackgroundOutboundMessage`, which validates every command in
// development), and the acknowledgement round trip all run. A frame that would
// fault a real page faults here instead of quietly passing a fixture that was
// written to agree with it.
//
// The main side is deliberately minimal — a context proxy, a ready reply, and
// an ack — because what is under test is the background half. `protocol.test.ts`
// owns the richer harness (handle deltas, worklets, fault taxonomies); this one
// stays small so a failure here points at the block core rather than at a
// feature of the harness.
import { describe, expect, it } from 'vitest';

import {
	countLynxCompactAcknowledgementHosts,
	LYNX_COMPACT_ACKNOWLEDGEMENT,
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	type LynxTransportCommitMessage,
} from '../src/core/protocol.js';
import { createLynxBackgroundTransport } from '../src/core/transport.js';
import { createLynxClientContainer } from '../src/core/client-driver.js';
import { compileLynxBlockTemplate, createLynxBlockCore } from '../src/core/block-core.js';
import { createLynxBlockRoot } from '../src/core/block-root.js';
import { createLynxHostContainer, prepareLynxHostBatch } from '../src/core/host-driver.js';
import { createFakePAPI, shape } from './_fixtures/fake-element-papi.js';
import {
	FakeContextProxy,
	flushMicrotasks,
	installMainSide,
	type MainSide,
} from './_fixtures/fake-lynx-wire.js';

const PAGE_TEMPLATE = compileLynxBlockTemplate({
	nodes: [
		{ type: 'view', parent: -1, props: { class: 'page' } },
		{ type: 'view', parent: 0, props: { class: 'rows' } },
	],
	events: [],
});

// Two event sites on distinct nodes and distinct priorities, so a delivery that
// picked the wrong site would land on the wrong handler rather than silently
// producing the same answer.
const ROW_TEMPLATE = compileLynxBlockTemplate({
	nodes: [
		{ type: 'view', parent: -1, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
		{ type: 'text', parent: 0, props: { class: 'col-label' } },
		{
			type: '#text',
			parent: 1,
			props: { value: '' },
			bindings: [{ name: 'value', valueIndex: 1 }],
		},
		{ type: 'text', parent: 0, props: { class: 'col-remove' } },
		{ type: '#text', parent: 3, props: { value: 'x' } },
	],
	events: [
		{ node: 1, type: 'bindtap', priority: 'discrete' },
		{ node: 3, type: 'bindtap', priority: 'default' },
	],
});

const ROW_CLASS = 0;
const ROW_LABEL = 1;

interface Row {
	readonly id: number;
	readonly label: string;
}

function rows(count: number): Row[] {
	return Array.from({ length: count }, (_, index) => ({
		id: index + 1,
		label: `row ${index + 1}`,
	}));
}

function rowValues(row: Row, selected: number | null): readonly (string | number)[] {
	return [row.id === selected ? 'row danger' : 'row', row.label];
}

function scene(compact = false) {
	const context = new FakeContextProxy();
	const main = installMainSide(context, compact);
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(context, container);
	const core = createLynxBlockCore();
	const root = createLynxBlockRoot({ container, transport, transportRoot: 1, core });
	transport.bindRoot(root);
	const page = core.mount(null, null, PAGE_TEMPLATE, []);
	const slot = core.openForSlot(page, 1);
	return { context, main, container, transport, core, root, page, slot };
}

/** Start a commit, let the transport reach the wire, acknowledge, settle. */
async function commitAndAck(
	root: ReturnType<typeof scene>['root'],
	main: MainSide,
): Promise<LynxTransportCommitMessage | null> {
	const before = main.commits.length;
	const committing = root.commit();
	await flushMicrotasks();
	if (main.commits.length === before) {
		// Nothing crossed the wire, which is a legitimate outcome for an empty
		// flush. Awaiting is still correct: the promise is already resolved.
		return committing.then(() => null);
	}
	const commit = main.commits[main.commits.length - 1]!;
	main.acknowledge(commit);
	await committing;
	return commit;
}

/** Replay every accepted commit through the real applier onto a fake host. */
function paint(commits: readonly LynxTransportCommitMessage[]) {
	const papi = createFakePAPI();
	const container = createLynxHostContainer(papi, { root: 1 });
	for (const commit of commits) prepareLynxHostBatch(container, commit.batch).apply();
	return { papi, container };
}

/** How many handle deltas a legacy acknowledgement for this commit must carry. */
function deltaCountFor(commit: LynxTransportCommitMessage): number {
	let total = 0;
	for (const command of commit.batch.commands) {
		if (command.op === 'mount-template-run') {
			total += command.program.nodes.length * command.count;
		} else if (command.op === 'update' || command.op === 'destroy') {
			total += 1;
		}
	}
	return total;
}

describe('Lynx block root — the wire accepts what the core emits', () => {
	it('carries a mount across the real transport and paints it through the real applier', async () => {
		const { main, root, core, slot } = scene();
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(3),
			(row) => row.id,
			(row) => rowValues(row, 2),
		);

		const commit = await commitAndAck(root, main);
		expect(commit).not.toBeNull();
		expect(commit!.version).toBe(1);
		expect(commit!.root).toBe(1);
		expect(root.acceptedVersion()).toBe(1);
		// Two `mount-template-run`s: the page shell and the dense row run. That
		// the self-check inside `prepareBatch` let them through is the claim; the
		// shape assertion is what makes a regression readable.
		expect(commit!.batch.commands.map((command) => command.op)).toEqual([
			'mount-template-run',
			'mount-template-run',
		]);

		const { papi } = paint(main.commits);
		const page = papi.pages[0]!.children[0]!;
		const rowsNode = page.children[0]!;
		expect(page.classes).toBe('page');
		expect(rowsNode.classes).toBe('rows');
		expect(rowsNode.children.map((row) => row.children[0]!.children[0]!.text)).toEqual([
			'row 1',
			'row 2',
			'row 3',
		]);
		// One host container replaying the same commits twice would diverge if the
		// applier were order-sensitive, so the painted shape is the oracle rather
		// than the command list that produced it.
		expect(shape(papi.pages[0]!)).toEqual(shape(paint(main.commits).papi.pages[0]!));
	});

	it('sends one command for a scoped update and advances the accepted version', async () => {
		const { main, root, core, slot } = scene();
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(500),
			(row) => row.id,
			(row) => rowValues(row, 3),
		);
		await commitAndAck(root, main);

		core.resetCounters();
		core.setKeyedSlotValue(slot, 3, ROW_CLASS, 'row');
		core.setKeyedSlotValue(slot, 400, ROW_CLASS, 'row danger');
		const commit = await commitAndAck(root, main);

		expect(core.counters()).toEqual({ blockLookups: 2, commands: 2 });
		expect(commit!.version).toBe(2);
		expect(root.acceptedVersion()).toBe(2);
		expect(commit!.batch.commands.map((command) => command.op)).toEqual(['update', 'update']);

		// The wire cost of a selection change on a 500-row list is the two rows
		// that changed, and the painted tree agrees with the core's own state.
		const { papi } = paint(main.commits);
		const rowNodes = papi.pages[0]!.children[0]!.children[0]!.children;
		expect(rowNodes[2]!.classes).toBe('row');
		expect(rowNodes[399]!.classes).toBe('row danger');
		expect(rowNodes.filter((row) => row.classes === 'row danger').length).toBe(1);
	});

	// A `mount-template-run` is one command outbound. On the legacy
	// acknowledgement it is `nodes.length * count` handle deltas inbound, because
	// the client container derives a transition for every node of every instance
	// and refuses a commit whose ack omits one. The compact acknowledgement is
	// what makes the return leg proportional too, and these two tests pin both
	// halves so the asymmetry is a measured property rather than an assumption.
	it('costs one handle delta per host on the return leg without the compact ack', async () => {
		const { main, root, core, slot } = scene();
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(3),
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		const commit = await commitAndAck(root, main);

		expect(commit!.ack).toBeUndefined();
		// 2 page hosts + 3 rows x 5 hosts. The outbound frame is 2 commands.
		expect(commit!.batch.commands.length).toBe(2);
		expect(deltaCountFor(commit!)).toBe(17);
	});

	it('qualifies for the compact acknowledgement when main advertises template runs', async () => {
		const { main, root, core, slot } = scene(true);
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(3),
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		const commit = await commitAndAck(root, main);

		// The negotiated commit asks for the compact form, and the frame the block
		// core built is compact-eligible: no `list`/`list-item`, no `ref` or
		// `main-thread:` binding, every created host also inserted.
		expect(commit!.ack).toBe(LYNX_COMPACT_ACKNOWLEDGEMENT);
		expect(countLynxCompactAcknowledgementHosts(commit!.batch)).toBe(17);
		expect(root.acceptedVersion()).toBe(1);

		// And the scoped update that follows still round-trips on the same root.
		core.setKeyedSlotValue(slot, 2, ROW_CLASS, 'row danger');
		const update = await commitAndAck(root, main);
		expect(update!.batch.commands.map((command) => command.op)).toEqual(['update']);
		expect(root.acceptedVersion()).toBe(2);
	});

	it('sends nothing at all when a commit has nothing to say', async () => {
		const { main, root, core, slot } = scene();
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(4),
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		await commitAndAck(root, main);
		const afterMount = main.commits.length;

		// A write that changes no slot must not become an empty frame: the far
		// side would still have to receive, validate, and acknowledge it.
		expect(core.setKeyedSlotValue(slot, 2, ROW_LABEL, 'row 2')).toBe(false);
		expect(await commitAndAck(root, main)).toBeNull();
		expect(main.commits.length).toBe(afterMount);
		expect(root.acceptedVersion()).toBe(1);
	});
});

describe('Lynx block root — inbound event delivery', () => {
	it('routes a native delivery to the handler the mount bound, by derived listener id', async () => {
		const { main, root, core, slot } = scene();
		const taps: string[] = [];
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(3),
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		for (const [key, block] of slot.items) {
			root.bindListeners(block, [
				(payload) => {
					taps.push(`label:${String(key)}:${JSON.stringify(payload)}`);
					core.setSlotValue(block, ROW_CLASS, 'row danger');
					return `label:${String(key)}`;
				},
				() => {
					taps.push(`remove:${String(key)}`);
					return `remove:${String(key)}`;
				},
			]);
		}
		await commitAndAck(root, main);

		// Row 2's first site: `firstListenerId + rowIndex * eventCount + site`.
		const second = slot.items.get(2)!;
		expect(second.firstListenerId).not.toBeNull();
		main.sendEvent('discrete', [second.firstListenerId!]);

		expect(taps).toEqual([`label:2:${JSON.stringify({ tap: second.firstListenerId! })}`]);

		// The handler's scoped write is a normal update, so it rides the next
		// commit — which closes the loop the U0 ceiling only modelled: a tap on
		// the main thread becomes exactly one command back.
		const commit = await commitAndAck(root, main);
		expect(commit!.batch.commands).toEqual([
			{ op: 'update', id: second.firstId, props: { class: 'row danger' } },
		]);
	});

	it('reaches the second event site of the same row, not the first', async () => {
		const { main, root, core, slot } = scene();
		const taps: string[] = [];
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(2),
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		for (const [key, block] of slot.items) {
			root.bindListeners(block, [
				() => taps.push(`label:${String(key)}`),
				() => taps.push(`remove:${String(key)}`),
			]);
		}
		await commitAndAck(root, main);

		const first = slot.items.get(1)!;
		main.sendEvent('default', [first.firstListenerId! + 1]);
		expect(taps).toEqual(['remove:1']);
	});

	it('invokes nothing when any delivery in the batch is unroutable', async () => {
		const { main, root, core, slot, transport } = scene();
		const taps: string[] = [];
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(2),
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		for (const [key, block] of slot.items) {
			root.bindListeners(block, [() => taps.push(`label:${String(key)}`), null]);
		}
		await commitAndAck(root, main);
		const first = slot.items.get(1)!;

		// A valid delivery prefixing an unknown one. The transport reports the
		// throw rather than rethrowing, so the observable contract is that the
		// valid handler did NOT run: a forged listener must not be able to buy a
		// partial dispatch by riding behind a real one.
		main.sendEvent('discrete', [first.firstListenerId!, 999_999]);
		expect(taps).toEqual([]);

		// A site the mount left unbound is unroutable for the same reason: the
		// listener id is derivable from the run, but nothing claimed it, so there
		// is no handler to reach. An id being *derivable* is not an id being live.
		main.sendEvent('discrete', [first.firstListenerId! + 1]);
		expect(taps).toEqual([]);

		// Both refusals are reported rather than swallowed. The transport catches
		// what `dispatchTransportEvent` throws and routes it to diagnostics, so a
		// silent drop and a refusal would otherwise look identical from here.
		const reported = transport.diagnostics().map((error) => error.message);
		expect(reported.filter((message) => /Unknown or inactive/.test(message)).length).toBe(2);
	});

	it('refuses a delivery whose priority does not match the site', async () => {
		const { main, root, core, slot } = scene();
		const taps: string[] = [];
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(1),
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		const only = slot.items.get(1)!;
		root.bindListeners(only, [() => taps.push('label'), () => taps.push('remove')]);
		await commitAndAck(root, main);

		// Site 0 is `discrete`; delivering it as `default` is the priority forgery
		// `universal-core.ts` refuses, and this root refuses it the same way.
		expect(() =>
			root.dispatchTransportEvent({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'event',
				priority: 'default',
				deliveries: [{ listener: only.firstListenerId!, payload: null }],
			}),
		).toThrowError(/priority/);
		expect(taps).toEqual([]);
	});

	it('refuses an event addressed to a foreign root', async () => {
		const { main, root, core, slot } = scene();
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(1),
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		const only = slot.items.get(1)!;
		root.bindListeners(only, [() => 'label', () => 'remove']);
		await commitAndAck(root, main);

		expect(() =>
			root.dispatchTransportEvent({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 2,
				version: 1,
				type: 'event',
				priority: 'discrete',
				deliveries: [{ listener: only.firstListenerId!, payload: null }],
			}),
		).toThrowError(/stale or foreign root/);
	});
});

describe('Lynx block root — identity discipline', () => {
	it('refuses a transport root id the identity contract cannot carry', () => {
		const context = new FakeContextProxy();
		installMainSide(context);
		const container = createLynxClientContainer();
		const transport = createLynxBackgroundTransport(context, container);
		expect(() => createLynxBlockRoot({ container, transport, transportRoot: 0 })).toThrowError(
			/positive transport root id/,
		);
	});

	it('releases a block’s listeners so a retired row cannot still be tapped', async () => {
		const { main, root, core, slot } = scene();
		const taps: string[] = [];
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(2),
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		for (const [key, block] of slot.items) {
			root.bindListeners(block, [() => taps.push(`label:${String(key)}`), null]);
		}
		await commitAndAck(root, main);
		const retiring = slot.items.get(2)!;
		const listener = retiring.firstListenerId!;

		root.releaseListeners(retiring);
		core.reconcileForSlot(
			slot,
			ROW_TEMPLATE,
			[rows(2)[0]!],
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		await commitAndAck(root, main);

		expect(() =>
			root.dispatchTransportEvent({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 2,
				type: 'event',
				priority: 'discrete',
				deliveries: [{ listener, payload: null }],
			}),
		).toThrowError(/Unknown or inactive/);
		expect(taps).toEqual([]);
	});
});

describe('Lynx block root — event identity and batch completeness', () => {
	it('refuses an event stamped against a superseded batch version', async () => {
		const { main, root, core, slot } = scene();
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(1),
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		const only = slot.items.get(1)!;
		const taps: string[] = [];
		root.bindListeners(only, [() => taps.push('label'), () => taps.push('remove')]);
		await commitAndAck(root, main);

		// A delivery queued before a later commit restructured the tree carries
		// the old version. It must be refused, not run against post-commit state.
		expect(() =>
			root.dispatchTransportEvent({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 0,
				type: 'event',
				priority: 'discrete',
				deliveries: [{ listener: only.firstListenerId!, payload: null }],
			}),
		).toThrowError(/version 0 does not match batch 1/);
		expect(taps).toEqual([]);
	});

	it('runs every pre-validated delivery even when an earlier handler throws', async () => {
		const { main, root, core, slot } = scene();
		core.fillForSlot(
			slot,
			ROW_TEMPLATE,
			rows(2),
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		const first = slot.items.get(1)!;
		const second = slot.items.get(2)!;
		const taps: string[] = [];
		root.bindListeners(first, [
			() => {
				throw new Error('handler one failed');
			},
			null,
		]);
		root.bindListeners(second, [() => taps.push('second ran'), null]);
		await commitAndAck(root, main);

		expect(() =>
			root.dispatchTransportEvent({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'event',
				priority: 'discrete',
				deliveries: [
					{ listener: first.firstListenerId!, payload: null },
					{ listener: second.firstListenerId!, payload: null },
				],
			}),
		).toThrowError('handler one failed');
		// The throw is reported, but the valid batch was dispatched completely.
		expect(taps).toEqual(['second ran']);
	});
});
