/**
 * Issue-#103 U2b — the Block core standing on the background side of the real
 * transport seam.
 *
 * `block-core.ts` answers "what would a specialized core emit". This answers
 * the question that has to come next before any of it is believable: **would
 * the wire accept it.** The core's frames go through the same
 * `LynxBackgroundTransport` the universal root uses — same identity discipline,
 * same outbound self-check, same acknowledgement handshake — rather than
 * through a test double that agrees with whatever the core produced.
 *
 * That distinction is the whole point. A core whose output is only ever fed to
 * a fixture proves nothing about the protocol; `selfCheckLynxBackgroundOutbound
 * Message` runs inside `transport.prepareBatch`, so a frame that would fault a
 * real page faults here instead of passing.
 *
 * ## What this root is, and is not
 *
 * It is the commit and event half of a root: it owns a `LynxBlockCore`, turns
 * one flush into one transported commit, and routes an inbound native delivery
 * back to the handler the mount registered. It is **not** `LynxRoot`: there is
 * no `render(component, props)`, because there are no hook cells yet and
 * therefore no program for a component to be. The caller drives the core
 * directly, which is exactly what a compiled block program would do.
 *
 * ## The transport root id is borrowed, not minted
 *
 * `universal-core.ts` allocates transport root ids from a module-private
 * counter (`NEXT_TRANSPORT_ROOT`) that it does not export, so a second core in
 * the same page cannot mint a non-colliding identity. Until that allocator is
 * shared, the id arrives as an option and the caller owns keeping it distinct.
 * Recorded on #103 as a seam finding rather than worked around here: minting
 * from a second private counter would collide the first time both cores ran in
 * one page, and it would collide silently.
 */

import {
	UNIVERSAL_TRANSPORT_PROTOCOL_VERSION,
	type UniversalAsyncCommitTransport,
	type UniversalEventPriority,
	type UniversalHostBatch,
	type UniversalTransportAcknowledgement,
	type UniversalTransportEventMessage,
	type UniversalTransportIdentity,
} from 'octane/universal/native';
import { LYNX_TRANSPORT_RENDERER } from './protocol.js';
import type { LynxClientContainer } from './client-driver.js';
import { createLynxBlockCore, type LynxBlock, type LynxBlockCore } from './block-core.js';

/** One native handler bound to one event site of one block. */
export type LynxBlockListener = (payload: unknown) => unknown;

export interface LynxBlockRootOptions {
	readonly container: LynxClientContainer;
	readonly transport: UniversalAsyncCommitTransport<LynxClientContainer>;
	/**
	 * Transport root id for every identity this root sends. Explicit because
	 * the shared allocator is private to `universal-core.ts`; see the header.
	 */
	readonly transportRoot: number;
	/** Bring your own core, primarily so a test can pin the id allocators. */
	readonly core?: LynxBlockCore;
}

export interface LynxBlockRoot {
	readonly renderer: typeof LYNX_TRANSPORT_RENDERER;
	readonly core: LynxBlockCore;
	/**
	 * Bind this block's event sites, in program order. A `null` entry leaves the
	 * site unbound, which is how a template with a conditional handler is
	 * expressed without a second template.
	 */
	bindListeners(block: LynxBlock, listeners: readonly (LynxBlockListener | null)[]): void;
	/** Drop every listener this block owns. Call before its run is destroyed. */
	releaseListeners(block: LynxBlock): void;
	/** Inbound delivery path. Satisfies what `transport.bindRoot` requires. */
	dispatchTransportEvent(message: UniversalTransportEventMessage): readonly unknown[];
	/**
	 * Send whatever the core has accumulated as one transported commit, and
	 * resolve once the host has acknowledged it. Resolves immediately with
	 * `null` when the core has nothing to say — an update that changed nothing
	 * sends no frame rather than an empty one the far side must still process.
	 */
	commit(): Promise<UniversalHostBatch | null>;
	/** Highest batch version this root has had acknowledged. */
	acceptedVersion(): number;
}

interface BoundListener {
	readonly priority: UniversalEventPriority;
	readonly handler: LynxBlockListener;
}

export function createLynxBlockRoot(options: LynxBlockRootOptions): LynxBlockRoot {
	const { container, transport, transportRoot } = options;
	if (!Number.isSafeInteger(transportRoot) || transportRoot <= 0) {
		throw new TypeError('Octane Lynx block root requires a positive transport root id.');
	}
	if (transport.mode !== 'async') {
		throw new TypeError('Octane Lynx block root requires an asynchronous commit transport.');
	}
	const core = options.core ?? createLynxBlockCore();
	const listeners = new Map<number, BoundListener>();
	let acceptedVersion = 0;

	const listenerId = (block: LynxBlock, site: number): number => {
		if (block.firstListenerId === null) {
			throw new Error('Octane Lynx block root cannot bind an event on an event-free template.');
		}
		return block.firstListenerId + site;
	};

	const identityFor = (version: number): UniversalTransportIdentity =>
		Object.freeze({
			protocol: UNIVERSAL_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			root: transportRoot,
			version,
		});

	const root: LynxBlockRoot = {
		renderer: LYNX_TRANSPORT_RENDERER,
		core,

		bindListeners(block, bound) {
			const sites = block.template.program.events;
			if (bound.length !== sites.length) {
				throw new Error(
					`Octane Lynx block root expected ${sites.length} listeners for this template, received ${bound.length}.`,
				);
			}
			for (let site = 0; site < sites.length; site++) {
				const handler = bound[site];
				if (handler === null || handler === undefined) continue;
				if (typeof handler !== 'function') {
					throw new TypeError('Octane Lynx block root listeners must be functions.');
				}
				listeners.set(listenerId(block, site), { priority: sites[site]!.priority, handler });
			}
		},

		releaseListeners(block) {
			const sites = block.template.program.events;
			if (block.firstListenerId === null) return;
			for (let site = 0; site < sites.length; site++) {
				listeners.delete(block.firstListenerId + site);
			}
		},

		dispatchTransportEvent(message) {
			if (message.type !== 'event') {
				throw new Error('Octane Lynx block root expected a transported event message.');
			}
			if (message.protocol !== UNIVERSAL_TRANSPORT_PROTOCOL_VERSION) {
				throw new Error(
					`Octane Lynx block root event uses protocol ${String(message.protocol)}; expected ${UNIVERSAL_TRANSPORT_PROTOCOL_VERSION}.`,
				);
			}
			if (message.renderer !== LYNX_TRANSPORT_RENDERER) {
				throw new Error('Octane Lynx block root event belongs to a foreign renderer.');
			}
			if (message.root !== transportRoot) {
				throw new Error('Octane Lynx block root event belongs to a stale or foreign root.');
			}
			if (message.version !== acceptedVersion) {
				// The same identity discipline `universal-core.ts` applies to events:
				// a delivery stamped against a superseded batch was aimed at a tree
				// this root no longer paints, and must be refused rather than run
				// against post-commit state.
				throw new Error(
					`Octane Lynx block root event version ${String(message.version)} does not match batch ${acceptedVersion}.`,
				);
			}
			// Validate the whole propagation batch before invoking any handler, as
			// `universal-core.ts` does: a renderer must not be able to prefix a
			// stale or priority-forged listener with a valid delivery and thereby
			// partially dispatch an invalid message.
			for (const { listener } of message.deliveries) {
				const bound = listeners.get(listener);
				if (bound === undefined) {
					throw new Error(`Unknown or inactive Lynx block listener ${listener}.`);
				}
				if (bound.priority !== message.priority) {
					throw new Error(
						`Lynx block listener ${listener} has priority ${JSON.stringify(bound.priority)}, not transported priority ${JSON.stringify(message.priority)}.`,
					);
				}
			}
			// Every pre-validated delivery runs even when an earlier handler
			// throws, as `universal-core.ts` guarantees: a partially-dispatched
			// valid batch is exactly the outcome pre-validation exists to prevent.
			const results = new Array<unknown>(message.deliveries.length);
			let errors: unknown[] | null = null;
			for (let index = 0; index < message.deliveries.length; index++) {
				const { listener, payload } = message.deliveries[index]!;
				try {
					results[index] = listeners.get(listener)!.handler(payload);
				} catch (error) {
					(errors ??= []).push(error);
				}
			}
			if (errors !== null) {
				if (errors.length === 1) throw errors[0];
				throw typeof AggregateError === 'function'
					? new AggregateError(errors, 'Multiple Lynx block listeners failed.')
					: errors[0];
			}
			return Object.freeze(results);
		},

		async commit() {
			const batch = core.flush();
			if (batch === null) return null;
			// U1 §3: a commit is the unit of structural consistency and it is
			// indivisible. One flush becomes one frame; the core never emits a
			// prefix, yields, and emits the rest, because a `move`'s `before`
			// anchor could then name an id the host has not been told to create.
			const identity = identityFor(batch.version);
			const prepared = transport.prepareBatch(container, batch, identity);
			let acknowledged = false;
			await prepared.apply((message: UniversalTransportAcknowledgement) => {
				if (
					message.protocol !== UNIVERSAL_TRANSPORT_PROTOCOL_VERSION ||
					message.renderer !== LYNX_TRANSPORT_RENDERER ||
					message.root !== transportRoot ||
					message.version !== batch.version
				) {
					throw new Error(
						`Octane Lynx block root acknowledgement does not match batch ${batch.version}.`,
					);
				}
				if (message.type !== 'ack') {
					throw new Error(
						`Octane Lynx block root expected an acknowledgement for batch ${batch.version}.`,
					);
				}
				if (batch.version <= acceptedVersion) {
					throw new Error(
						`Octane Lynx block root rejected stale accepted batch version ${batch.version}; current version is ${acceptedVersion}.`,
					);
				}
				acceptedVersion = batch.version;
				acknowledged = true;
			});
			if (!acknowledged) {
				throw new Error(`Octane Lynx block root batch ${batch.version} was never acknowledged.`);
			}
			prepared.afterAccept?.();
			return batch;
		},

		acceptedVersion() {
			return acceptedVersion;
		},
	};
	return Object.freeze(root);
}
