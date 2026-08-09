import { describe, expect, it } from 'vitest';
import {
	UNIVERSAL_TRANSPORT_PROTOCOL_VERSION,
	type UniversalTransportIdentity,
	createUniversalRoot,
	defineUniversalComponent,
	universalPlan,
	universalProps,
	universalValue,
	useState,
} from 'octane/universal/native';
import {
	createLynxClientContainer,
	createLynxClientDriver,
	type LynxClientContainer,
} from '../src/core/client-driver.js';
import { createLynxNodesRefSelector } from '../src/core/nodes-ref.js';
import {
	LYNX_BACKGROUND_TO_MAIN_EVENT,
	LYNX_MAIN_TO_BACKGROUND_EVENT,
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	validateLynxBackgroundInboundMessage,
	validateLynxBackgroundOutboundMessage,
	type LynxCommitWireMessage,
	type LynxContextProxy,
	type LynxContextProxyEvent,
	type LynxPublicHandleDelta,
} from '../src/core/protocol.js';
import {
	createLynxBackgroundTransport,
	type LynxBackgroundTransport,
} from '../src/core/transport.js';

class FakeContextProxy implements LynxContextProxy {
	private readonly listeners = new Map<string, Set<(event: LynxContextProxyEvent) => void>>();

	dispatchEvent(event: LynxContextProxyEvent): void {
		for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
	}

	addEventListener(type: string, listener: (event: LynxContextProxyEvent) => void): void {
		let listeners = this.listeners.get(type);
		if (listeners === undefined) this.listeners.set(type, (listeners = new Set()));
		listeners.add(listener);
	}

	removeEventListener(type: string, listener: (event: LynxContextProxyEvent) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	sendToBackground(data: unknown): void {
		this.dispatchEvent({ type: LYNX_MAIN_TO_BACKGROUND_EVENT, data });
	}
}

const plan = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	propsSlot: 0,
});

async function flushMicrotasks(count = 8): Promise<void> {
	for (let index = 0; index < count; index++) await Promise.resolve();
}

interface PacedMain {
	readonly commits: LynxCommitWireMessage[];
	/** Whether arriving commits are acknowledged and completed automatically. */
	auto: boolean;
	/** Send the frame-pulse answering the given (default: latest) applied commit. */
	pulse(version?: number): void;
	/** Reject the given commit instead of acknowledging it. */
	reject(commit: LynxCommitWireMessage, message: string): void;
}

/**
 * A scripted main thread that immediately acknowledges and completes every
 * commit, like the post-#1 fast main, but only answers paced commits with a
 * frame pulse when the test pumps one — so the test owns the frame clock.
 */
function installPacedMain(
	context: FakeContextProxy,
	options: { autoAck?: boolean } = {},
): PacedMain {
	const autoAck = options.autoAck ?? true;
	const commits: LynxCommitWireMessage[] = [];
	const generations = new Map<number, number>();
	const types = new Map<number, string>();

	const snapshotOf = (root: number, id: number, type: string, generation: number) => ({
		$$kind: 'octane.lynx.element' as const,
		renderer: LYNX_TRANSPORT_RENDERER,
		root,
		id,
		type,
		generation,
		selector: createLynxNodesRefSelector(root, id, generation),
	});

	const handleDeltas = (commit: LynxCommitWireMessage): LynxPublicHandleDelta[] => {
		const deltas: LynxPublicHandleDelta[] = [];
		for (const command of commit.batch.commands) {
			if (command.op === 'create' || command.op === 'recreate') {
				const generation = (generations.get(command.id) ?? 0) + 1;
				generations.set(command.id, generation);
				types.set(command.id, command.type);
				deltas.push({
					op: 'upsert',
					id: command.id,
					type: command.type,
					generation,
					attached: true,
					listDescendant: false,
					snapshot: snapshotOf(commit.root, command.id, command.type, generation),
				});
			} else if (command.op === 'destroy') {
				deltas.push({ op: 'remove', id: command.id, generation: generations.get(command.id)! });
				types.delete(command.id);
			}
		}
		return deltas;
	};

	const identityOf = (commit: LynxCommitWireMessage): UniversalTransportIdentity => ({
		protocol: UNIVERSAL_TRANSPORT_PROTOCOL_VERSION,
		renderer: LYNX_TRANSPORT_RENDERER,
		root: commit.root,
		version: commit.version,
	});

	const scripted: PacedMain = {
		commits,
		auto: autoAck,
		pulse(version) {
			const commit =
				version === undefined
					? commits[commits.length - 1]!
					: commits.find((candidate) => candidate.version === version)!;
			context.sendToBackground({ ...identityOf(commit), type: 'frame-pulse' });
		},
		reject(commit, message) {
			context.sendToBackground({
				...identityOf(commit),
				type: 'reject',
				error: { name: 'Error', message },
			});
		},
	};

	context.addEventListener(LYNX_BACKGROUND_TO_MAIN_EVENT, (event) => {
		const message = validateLynxBackgroundOutboundMessage(event.data);
		if (message.type === 'main-ready-request') {
			context.sendToBackground({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'main-ready',
				request: message.request,
			});
			return;
		}
		if (message.type !== 'commit') return;
		commits.push(message);
		if (!scripted.auto) return;
		context.sendToBackground({
			...identityOf(message),
			type: 'ack',
			handles: handleDeltas(message),
		});
		context.sendToBackground({ ...identityOf(message), type: 'complete' });
	});

	return scripted;
}

interface PacedHarness {
	readonly context: FakeContextProxy;
	readonly main: PacedMain;
	readonly container: LynxClientContainer;
	readonly transport: LynxBackgroundTransport;
	readonly root: ReturnType<typeof createUniversalRoot>;
	tap(): void;
	tapListener(): number;
}

async function mountCounter(
	options: { autoAck?: boolean; commitPacing?: 'immediate' | 'frame' } = {},
): Promise<PacedHarness> {
	const context = new FakeContextProxy();
	const main = installPacedMain(context, { autoAck: options.autoAck });
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(
		context,
		container,
		options.commitPacing === undefined ? {} : { commitPacing: options.commitPacing },
	);
	const root = createUniversalRoot(container, createLynxClientDriver(), { transport });
	transport.bindRoot(root);
	const Scene = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, () => {
		const [count, setCount] = useState(0, 'count');
		return universalValue(plan, [
			universalProps([
				['set', 'count', count],
				['set', 'bindtap', () => setCount((value) => value + 1)],
			]),
		]);
	});
	await root.renderAsync(Scene, undefined);
	const tapListener = (): number => {
		const event = main.commits[0]!.batch.commands.find(
			(command) => command.op === 'event' && command.listener !== null,
		);
		if (event?.op !== 'event' || event.listener === null) throw new Error('Missing tap listener.');
		return event.listener.id;
	};
	const tap = (): void => {
		const accepted = transport.acceptedIdentity()!;
		root.dispatchTransportEvent({
			...accepted,
			type: 'event',
			priority: 'discrete',
			deliveries: [{ listener: tapListener(), payload: { type: 'tap' } }],
		});
	};
	return { context, main, container, transport, root, tap, tapListener };
}

function countOf(commit: LynxCommitWireMessage): number | undefined {
	for (const command of commit.batch.commands) {
		if (
			(command.op === 'create' || command.op === 'update') &&
			typeof command.props.count === 'number'
		) {
			return command.props.count;
		}
	}
	return undefined;
}

describe('@octanejs/lynx frame-aligned commit pacing', () => {
	it('dispatches at most one commit per pumped frame and folds interim updates', async () => {
		const harness = await mountCounter();
		const { main, tap } = harness;
		// The mount is the first commit after idle: it crossed immediately, before
		// any frame pulse existed.
		expect(main.commits).toHaveLength(1);
		expect(main.commits[0]!.pace).toBe(true);
		main.pulse();

		// One tap on an idle transport commits immediately as well: pacing never
		// taxes one-shot latency.
		tap();
		await flushMicrotasks();
		expect(main.commits).toHaveLength(2);
		expect(countOf(main.commits[1]!)).toBe(1);

		// Main has not reached its next frame. Further updates render and fold on
		// the background but no commit crosses the wire.
		tap();
		await flushMicrotasks();
		tap();
		await flushMicrotasks();
		tap();
		await flushMicrotasks();
		expect(main.commits).toHaveLength(2);

		// The next frame releases exactly one commit: the one prepared when the
		// first held update rendered. The updates that arrived while it was held
		// stay folded behind it.
		main.pulse();
		await flushMicrotasks();
		expect(main.commits).toHaveLength(3);
		expect(countOf(main.commits[2]!)).toBe(2);

		// The following frame carries every remaining folded update in one
		// commit: intermediate count 3 never crosses the wire. The fold tail —
		// the last scheduled flush re-renders, finds nothing new, and commits an
		// empty batch — settles on the background and never crosses at all
		// (protocol 2): an empty batch mutates nothing on main.
		main.pulse();
		await flushMicrotasks();
		expect(main.commits).toHaveLength(4);
		expect(countOf(main.commits[3]!)).toBe(4);
		expect(main.commits[3]!.pace).toBe(true);

		// Answer the count-4 commit's frame; nothing further crosses.
		main.pulse();
		await flushMicrotasks();
		expect(main.commits).toHaveLength(4);

		// Back to idle with every pulse answered: the next one-shot update needs
		// no further frame to cross — pacing never taxes cold latency.
		tap();
		await flushMicrotasks();
		expect(main.commits).toHaveLength(5);
		expect(countOf(main.commits[4]!)).toBe(5);
		harness.transport.close();
	});

	it('keeps unpaced dispatch under commitPacing: "immediate"', async () => {
		const harness = await mountCounter({ commitPacing: 'immediate' });
		const { main, tap } = harness;
		expect(main.commits[0]!.pace).toBeUndefined();
		// No frame pulse ever arrives, yet every update crosses as soon as the
		// previous acknowledgement returns.
		tap();
		await flushMicrotasks();
		tap();
		await flushMicrotasks();
		tap();
		await flushMicrotasks();
		expect(main.commits).toHaveLength(4);
		expect(countOf(main.commits[3]!)).toBe(3);
		harness.transport.close();
	});

	it('degrades to immediate dispatch when main answers pulses synchronously', async () => {
		const harness = await mountCounter();
		const { context, main, tap } = harness;
		// A main thread with no frame source answers each paced apply at once —
		// its next "frame" is indistinguishable from now.
		context.addEventListener(LYNX_BACKGROUND_TO_MAIN_EVENT, (event) => {
			const message = event.data as { type?: string; version?: number };
			if (message.type === 'commit') {
				void Promise.resolve().then(() => main.pulse(message.version));
			}
		});
		main.pulse();
		tap();
		await flushMicrotasks();
		tap();
		await flushMicrotasks();
		tap();
		await flushMicrotasks();
		expect(main.commits).toHaveLength(4);
		expect(countOf(main.commits[3]!)).toBe(3);
		harness.transport.close();
	});

	it('force-dispatches a held commit when the frame source stalls', async () => {
		const harness = await mountCounter();
		const { main, tap } = harness;
		// No pulse ever answers the mount: the frame source is dead (a hidden
		// Lynx-for-Web page throttles rAF to nothing). A held update must not
		// starve acknowledgement-driven effects forever.
		tap();
		await flushMicrotasks();
		expect(main.commits).toHaveLength(1);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(main.commits).toHaveLength(2);
		expect(countOf(main.commits[1]!)).toBe(1);
		harness.transport.close();
	});

	it('reopens the frame gate when a dispatched commit is rejected before apply', async () => {
		const harness = await mountCounter();
		const { main, tap } = harness;
		main.pulse();
		// Reject the next commit instead of acknowledging it: a rejection consumed
		// no main-thread frame, so the scheduled update's retry must not wait for
		// a pulse that will never come.
		main.auto = false;
		tap();
		await flushMicrotasks();
		expect(main.commits).toHaveLength(2);
		main.auto = true;
		main.reject(main.commits[1]!, 'scripted rejection');
		await flushMicrotasks(24);
		// The retry crossed with no frame pulse in between and carries the state
		// the rejected commit was carrying.
		expect(main.commits).toHaveLength(3);
		expect(countOf(main.commits[2]!)).toBe(1);
		harness.transport.close();
	});

	it('validates the paced commit flag and the frame pulse on both wire directions', () => {
		const identity = {
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			root: 7,
			version: 3,
		};
		expect(
			validateLynxBackgroundInboundMessage({ ...identity, type: 'frame-pulse' }),
		).toMatchObject({ type: 'frame-pulse', root: 7, version: 3 });
		expect(() =>
			validateLynxBackgroundInboundMessage({ ...identity, type: 'frame-pulse', extra: 1 }),
		).toThrow(/frame-pulse/);
		const batch = { renderer: LYNX_TRANSPORT_RENDERER, version: 3, commands: [] };
		expect(
			validateLynxBackgroundOutboundMessage({ ...identity, type: 'commit', batch, pace: true }),
		).toMatchObject({ type: 'commit', pace: true });
		expect(() =>
			validateLynxBackgroundOutboundMessage({ ...identity, type: 'commit', batch, pace: false }),
		).toThrow(/pace/);
	});
});
