/**
 * A minimal main thread on the other end of the real Lynx background transport.
 *
 * `createLynxBackgroundTransport` is not doubled here — this is only the side
 * of the wire a page would occupy: the readiness handshake, the handle ledger
 * an acknowledgement has to carry, and the inbound event path. Everything the
 * background does (identity discipline, the outbound self-check, commit
 * bookkeeping) is the production code under test.
 *
 * `protocol.test.ts` keeps its own richer harness — worklets, fault taxonomies,
 * deferred first trees. This one stays small on purpose: a failure in a test
 * that uses it should point at the background core, not at a feature of the
 * fixture.
 */

import { vi } from 'vitest';

import {
	countLynxCompactAcknowledgementHosts,
	LYNX_BACKGROUND_TO_MAIN_EVENT,
	LYNX_COMPACT_ACKNOWLEDGEMENT,
	LYNX_MAIN_TO_BACKGROUND_EVENT,
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	validateLynxBackgroundOutboundMessage,
	type LynxContextProxy,
	type LynxContextProxyEvent,
	type LynxPublicHandleDelta,
	type LynxTransportCommitMessage,
} from '../../src/core/protocol.js';
import { createLynxNodesRefSelector } from '../../src/core/nodes-ref.js';

export class FakeContextProxy implements LynxContextProxy {
	readonly events: LynxContextProxyEvent[] = [];
	readonly postMessage = vi.fn(() => {
		throw new Error('postMessage must not be used.');
	});
	private readonly listeners = new Map<string, Set<(event: LynxContextProxyEvent) => void>>();

	dispatchEvent(event: LynxContextProxyEvent): void {
		this.events.push(event);
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

export interface MainSide {
	readonly commits: LynxTransportCommitMessage[];
	acknowledge(commit: LynxTransportCommitMessage): void;
	sendEvent(priority: 'discrete' | 'continuous' | 'default', listeners: readonly number[]): void;
}

/**
 * Main's side of the handle ledger.
 *
 * A `mount-template-run` is one command outbound and `nodes.length * count`
 * handles inbound: the client container derives a transition for every node of
 * every instance, so a legacy acknowledgement has to name all of them or the
 * commit is refused. That asymmetry is a real property of the protocol rather
 * than an artifact of this harness, and it is why the compact acknowledgement
 * exists — see the test that negotiates it.
 */
function installHandleLedger() {
	const generations = new Map<number, number>();
	const types = new Map<number, string>();

	const upsert = (
		root: number,
		id: number,
		type: string,
		generation: number,
	): LynxPublicHandleDelta => ({
		op: 'upsert',
		id,
		type,
		generation,
		attached: true,
		listDescendant: false,
		snapshot: {
			$$kind: 'octane.lynx.element',
			renderer: LYNX_TRANSPORT_RENDERER,
			root,
			id,
			type,
			generation,
			selector: createLynxNodesRefSelector(root, id, generation),
		},
	});

	return function handleDeltas(commit: LynxTransportCommitMessage): LynxPublicHandleDelta[] {
		const deltas: LynxPublicHandleDelta[] = [];
		for (const command of commit.batch.commands) {
			if (command.op === 'mount-template-run') {
				const length = command.program.nodes.length;
				for (let instance = 0; instance < command.count; instance++) {
					const firstId = command.firstId + instance * length;
					for (let index = 0; index < length; index++) {
						const id = firstId + index;
						const type = command.program.nodes[index]!.type;
						const generation = (generations.get(id) ?? 0) + 1;
						generations.set(id, generation);
						types.set(id, type);
						deltas.push(upsert(commit.root, id, type, generation));
					}
				}
				continue;
			}
			if (command.op === 'mount-template-range') {
				for (let index = 0; index < command.program.nodes.length; index++) {
					const id = command.firstId + index;
					const type = command.program.nodes[index]!.type;
					const generation = (generations.get(id) ?? 0) + 1;
					generations.set(id, generation);
					types.set(id, type);
					deltas.push(upsert(commit.root, id, type, generation));
				}
				continue;
			}
			if (command.op === 'mount-template') {
				for (let index = 0; index < command.nodes.length; index++) {
					const id = command.nodes[index]!.id;
					const type = command.shape[index]!.type;
					const generation = (generations.get(id) ?? 0) + 1;
					generations.set(id, generation);
					types.set(id, type);
					deltas.push(upsert(commit.root, id, type, generation));
				}
				continue;
			}
			if (command.op === 'create' || command.op === 'recreate') {
				const generation = (generations.get(command.id) ?? 0) + 1;
				generations.set(command.id, generation);
				types.set(command.id, command.type);
				deltas.push(upsert(commit.root, command.id, command.type, generation));
				continue;
			}
			if (command.op === 'update') {
				deltas.push(
					upsert(commit.root, command.id, types.get(command.id)!, generations.get(command.id)!),
				);
				continue;
			}
			if (command.op === 'destroy') {
				deltas.push({ op: 'remove', id: command.id, generation: generations.get(command.id)! });
				generations.delete(command.id);
				types.delete(command.id);
			}
			// `insert`, `move`, and `remove` change topology, not identity, so the
			// container derives no transition for them and the acknowledgement
			// names nothing.
		}
		return deltas;
	};
}

export function installMainSide(context: FakeContextProxy, compact = false): MainSide {
	const commits: LynxTransportCommitMessage[] = [];
	let accepted: LynxTransportCommitMessage | null = null;
	const handleDeltas = installHandleLedger();
	context.addEventListener(LYNX_BACKGROUND_TO_MAIN_EVENT, (event) => {
		// Validating here is not decoration: it is main's own inbound check, so a
		// frame this core sends has to survive the same parse a real page runs.
		const message = validateLynxBackgroundOutboundMessage(event.data);
		if (message.type === 'main-ready-request') {
			context.sendToBackground({
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				type: 'main-ready',
				request: message.request,
				// A main thread that can consume template runs says so here, and the
				// background then asks for the compact acknowledgement instead of a
				// delta per host. The transport tags its readiness request at the
				// newest base it understands, so this is a choice about main, not
				// about what the background is willing to negotiate. Stopping at
				// `templateRuns` makes this fixture a peer that takes runs eagerly,
				// which is what every suite reading it means to model.
				...(compact
					? {
							capabilities: {
								compactAck: 1,
								templateMount: 1,
								templateProgram: 1,
								lazyPublicInstances: 1,
								templateRuns: 1,
							},
						}
					: null),
			});
			return;
		}
		if (message.type === 'commit') commits.push(message);
	});
	return {
		commits,
		acknowledge(commit) {
			accepted = commit;
			const compactHosts =
				commit.ack === LYNX_COMPACT_ACKNOWLEDGEMENT
					? countLynxCompactAcknowledgementHosts(commit.batch)
					: null;
			// The ledger advances on every commit, compact or not. A compact ack
			// names no handles, but the container still holds them, so the *next*
			// legacy ack has to carry their real generations — which is a property
			// of the protocol worth keeping honest in the harness rather than a
			// bookkeeping convenience.
			const deltas = handleDeltas(commit);
			context.sendToBackground(
				compactHosts === null
					? {
							protocol: commit.protocol,
							renderer: commit.renderer,
							root: commit.root,
							version: commit.version,
							type: 'ack',
							handles: deltas,
						}
					: {
							protocol: commit.protocol,
							renderer: commit.renderer,
							root: commit.root,
							version: commit.version,
							type: 'ack',
							encoding: LYNX_COMPACT_ACKNOWLEDGEMENT,
							count: compactHosts,
						},
			);
			// The ack publishes handles; `complete` is what says the host actually
			// applied the frame, and it is what settles the background's commit.
			context.sendToBackground({
				protocol: commit.protocol,
				renderer: commit.renderer,
				root: commit.root,
				version: commit.version,
				type: 'complete',
			});
		},
		sendEvent(priority, listeners) {
			if (accepted === null) throw new Error('No accepted commit to address an event to.');
			context.sendToBackground({
				protocol: accepted.protocol,
				renderer: accepted.renderer,
				root: accepted.root,
				version: accepted.version,
				type: 'event',
				priority,
				deliveries: listeners.map((listener) => ({ listener, payload: { tap: listener } })),
			});
		},
	};
}

export async function flushMicrotasks(count = 4): Promise<void> {
	for (let index = 0; index < count; index++) await Promise.resolve();
}
