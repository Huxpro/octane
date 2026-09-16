declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

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
 * back to the handler the mount registered. It is **not** the public `LynxRoot`:
 * a compiled block program drives it, and that program owns semantic hook scopes
 * independently of this root's template and physical host records.
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
import { LYNX_TRANSPORT_RENDERER } from './transport-identity.js';
import {
	activateLynxCompactPublicHandle,
	applyLynxHostAttachments,
	releaseLynxCompactPublicHandle,
	type LynxClientContainer,
	type LynxPublicHandle,
} from './client-driver.js';
import type { LynxHostAttachmentChange } from './protocol.js';
import { createLynxBlockCore, type LynxBlock, type LynxBlockCore } from './block-core.js';
import { LYNX_PROFILE, lynxWireProfile } from './profiling.js';

const LYNX_BLOCK_ROOT_EVENT_SITE_ERROR = 'Octane Lynx OL019';

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
	/** Preserve renderer event priority when a handler enters universal hook cells. */
	readonly eventScope?: <T>(priority: UniversalEventPriority, run: () => T) => T;
}

export interface LynxBlockRoot {
	readonly renderer: typeof LYNX_TRANSPORT_RENDERER;
	readonly core: LynxBlockCore;
	/**
	 * The identity namespace every handle this root sends is stamped with. Read
	 * by anything that has to mint a handle in the same namespace the root's own
	 * frames use — a resource handle encoded for a template value, say — so the
	 * far side's ownership check accepts it.
	 */
	readonly transportRoot: number;
	/** Open the logical/listener journal for one render attempt. */
	beginAttempt(): void;
	/** Roll back a pre-acknowledgement attempt. False means it was already accepted. */
	abortAttempt(): boolean;
	/**
	 * Bind this block's event sites, in program order. A `null` entry leaves the
	 * site unbound, which is how a template with a conditional handler is
	 * expressed without a second template.
	 */
	bindListeners(block: LynxBlock, listeners: readonly (LynxBlockListener | null)[]): void;
	/** Replace or clear one known event site without visiting its siblings. */
	setListener(block: LynxBlock, site: number, listener: LynxBlockListener | null): void;
	/** Drop every listener this block owns. Call before its run is destroyed. */
	releaseListeners(block: LynxBlock): void;
	/** Stage authored ref values in compiler node order for publication after ACK. */
	bindRefs(block: LynxBlock, values: readonly unknown[]): void;
	/** Stage logical retirement for every ref-bearing host in this block. */
	releaseRefs(block: LynxBlock): void;
	/** Apply a native-list cell attachment transition to accepted ref owners. */
	dispatchHostAttachments(changes: readonly LynxHostAttachmentChange[]): void;
	/** Inbound delivery path. Satisfies what `transport.bindRoot` requires. */
	dispatchTransportEvent(message: UniversalTransportEventMessage): readonly unknown[];
	/** Whether the currently published listener journal owns this native token. */
	acceptsNativeEvent(listener: number, priority: UniversalEventPriority): boolean;
	/**
	 * Send whatever the core has accumulated as one transported commit, and
	 * resolve once the host has acknowledged it. The acceptance callback publishes
	 * semantic state first, then invokes `publishRefs` before scheduling layout
	 * work. Ignoring `publishRefs` is safe: the root invokes it as a fallback.
	 * Resolves immediately with `null` when no host frame is required. `onFrame`
	 * runs only after a non-empty core batch exists, before transport preparation.
	 */
	commit(
		onAccept?: (publishRefs: () => void) => void,
		onFrame?: () => void,
	): Promise<UniversalHostBatch | null>;
	/** Highest batch version this root has had acknowledged. */
	acceptedVersion(): number;
}

interface BoundListener {
	readonly priority: UniversalEventPriority;
	readonly handler: LynxBlockListener;
}

interface BoundHostRef {
	readonly id: number;
	readonly type: string;
	readonly handle: LynxPublicHandle;
	value: unknown;
	refAttached: boolean;
	cleanup: (() => void) | null;
}

interface PendingHostRef {
	readonly id: number;
	readonly type: string;
	readonly attached: boolean;
	readonly value: unknown;
}

export function createLynxBlockRoot(options: LynxBlockRootOptions): LynxBlockRoot {
	const { container, transport, transportRoot } = options;
	if (!Number.isSafeInteger(transportRoot) || transportRoot <= 0) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx block root requires a positive transport root id.'
				: 'Octane Lynx OL016',
		);
	}
	if (transport.mode !== 'async') {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx block root requires an asynchronous commit transport.'
				: 'Octane Lynx OL017',
		);
	}
	const core = options.core ?? createLynxBlockCore();
	const eventScope = options.eventScope ?? ((_priority, run) => run());
	const listeners = new Map<number, BoundListener>();
	const refs = new Map<number, BoundHostRef>();
	let attemptActive = false;
	let listenerWrites: Array<number | BoundListener | undefined> | null = null;
	let refWrites: Map<number, PendingHostRef | null> | null = null;
	let acceptedVersion = 0;
	// Main can still deliver an event for the accepted tree while its next frame
	// is in flight. Keep that tree's closures live until ACK, then publish the
	// draft writes in program order so release-then-bind retains its meaning.
	const writeListener = (id: number, listener: BoundListener | undefined): void => {
		if (attemptActive) {
			(listenerWrites ??= []).push(id, listener);
			return;
		}
		if (listener === undefined) listeners.delete(id);
		else listeners.set(id, listener);
	};
	const runRefTasks = (tasks: readonly (() => void)[]): void => {
		let hasError = false;
		let firstError: unknown;
		for (const task of tasks) {
			try {
				task();
			} catch (error) {
				if (!hasError) {
					hasError = true;
					firstError = error;
				}
			}
		}
		if (hasError) throw firstError;
	};
	const detachRef = (record: BoundHostRef): void => {
		if (!record.refAttached) return;
		record.refAttached = false;
		const cleanup = record.cleanup;
		record.cleanup = null;
		if (cleanup !== null) {
			cleanup();
			return;
		}
		const tasks: (() => void)[] = [];
		const collect = (value: unknown): void => {
			if (Array.isArray(value)) for (const nested of value) collect(nested);
			else if (typeof value === 'function') tasks.push(() => value(null));
			else if (value !== null && typeof value === 'object') {
				tasks.push(() => {
					(value as { current: unknown }).current = null;
				});
			}
		};
		collect(record.value);
		runRefTasks(tasks);
	};
	const attachRef = (record: BoundHostRef): void => {
		if (record.refAttached || !record.handle.attached || record.value == null) return;
		record.refAttached = true;
		const cleanupTasks: (() => void)[] = [];
		const attachTasks: (() => void)[] = [];
		const collect = (value: unknown): void => {
			if (Array.isArray(value)) for (const nested of value) collect(nested);
			else if (typeof value === 'function') {
				attachTasks.push(() => {
					const index = cleanupTasks.length;
					cleanupTasks.push(() => value(null));
					const cleanup = value(record.handle);
					if (typeof cleanup === 'function') cleanupTasks[index] = cleanup;
				});
			} else if (value !== null && typeof value === 'object') {
				attachTasks.push(() => {
					(value as { current: unknown }).current = record.handle;
					cleanupTasks.push(() => {
						(value as { current: unknown }).current = null;
					});
				});
			}
		};
		collect(record.value);
		record.cleanup = () => runRefTasks(cleanupTasks);
		runRefTasks(attachTasks);
	};
	const applyRefWrites = (writes: Map<number, PendingHostRef | null> | null): void => {
		if (writes === null) return;
		let hasError = false;
		let firstError: unknown;
		const capture = (task: () => void): void => {
			try {
				task();
			} catch (error) {
				if (!hasError) {
					hasError = true;
					firstError = error;
				}
			}
		};
		for (const [id, next] of writes) {
			let record = refs.get(id);
			if (next === null) {
				if (record === undefined) continue;
				capture(() => detachRef(record!));
				releaseLynxCompactPublicHandle(container, id);
				refs.delete(id);
				continue;
			}
			if (record === undefined) {
				const handle = activateLynxCompactPublicHandle(container, {
					root: transportRoot,
					id,
					type: next.type,
					attached: next.attached,
				});
				record = {
					id,
					type: next.type,
					handle,
					value: next.value,
					refAttached: false,
					cleanup: null,
				};
				refs.set(id, record);
				capture(() => attachRef(record!));
				continue;
			}
			if (record.type !== next.type) {
				capture(() => {
					throw new Error('Octane Lynx Block ref changed host type.');
				});
				continue;
			}
			if (Object.is(record.value, next.value)) continue;
			capture(() => detachRef(record!));
			record.value = next.value;
			capture(() => attachRef(record!));
		}
		if (hasError) throw firstError;
	};
	const acceptAttempt = (): (() => void) => {
		attemptActive = false;
		const writes = listenerWrites;
		listenerWrites = null;
		const acceptedRefWrites = refWrites;
		refWrites = null;
		for (let index = 0; index < (writes?.length ?? 0); index += 2) {
			const id = writes![index] as number;
			const listener = writes![index + 1] as BoundListener | undefined;
			if (listener === undefined) listeners.delete(id);
			else listeners.set(id, listener);
		}
		core.acceptAttempt();
		let published = false;
		return () => {
			if (published) return;
			published = true;
			applyRefWrites(acceptedRefWrites);
		};
	};
	const finishAccepted = (onAccept?: (publishRefs: () => void) => void): void => {
		const publishRefs = acceptAttempt();
		runRefTasks(
			onAccept === undefined ? [publishRefs] : [() => onAccept(publishRefs), publishRefs],
		);
	};

	const listenerId = (block: LynxBlock, site: number): number => {
		if (block.firstListenerId === null) {
			throw new Error(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? 'Octane Lynx block root cannot bind an event on an event-free template.'
					: 'Octane Lynx OL018',
			);
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
		transportRoot,

		beginAttempt() {
			if (attemptActive) {
				throw new Error('Octane Lynx block root already has an active render attempt.');
			}
			core.beginAttempt();
			attemptActive = true;
		},

		abortAttempt() {
			if (!attemptActive) return false;
			attemptActive = false;
			listenerWrites = null;
			refWrites = null;
			core.abortAttempt();
			return true;
		},

		bindListeners(block, bound) {
			const sites = block.template.program.events;
			if (bound.length !== sites.length) {
				throw new Error(
					typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
						? `Octane Lynx block root expected ${sites.length} listeners for this template, received ${bound.length}.`
						: LYNX_BLOCK_ROOT_EVENT_SITE_ERROR,
				);
			}
			for (let site = 0; site < sites.length; site++) {
				const handler = bound[site];
				if (handler !== null && handler !== undefined) root.setListener(block, site, handler);
			}
		},

		setListener(block, site, handler) {
			const sites = block.template.program.events;
			if (!Number.isSafeInteger(site) || site < 0 || site >= sites.length) {
				throw new RangeError(
					typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
						? `Octane Lynx block root event site ${String(site)} is outside this template.`
						: LYNX_BLOCK_ROOT_EVENT_SITE_ERROR,
				);
			}
			const id = listenerId(block, site);
			if (handler === null || handler === undefined) {
				writeListener(id, undefined);
				return;
			}
			if (typeof handler !== 'function') {
				throw new TypeError(
					typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
						? 'Octane Lynx block root listeners must be functions.'
						: 'Octane Lynx OL020',
				);
			}
			writeListener(id, { priority: sites[site]!.priority, handler });
		},

		releaseListeners(block) {
			const sites = block.template.program.events;
			if (block.firstListenerId === null) return;
			for (let site = 0; site < sites.length; site++) {
				const id = block.firstListenerId + site;
				writeListener(id, undefined);
			}
		},

		bindRefs(block, values) {
			const sites = block.template.refs;
			if (sites === undefined || values.length !== sites.length) {
				throw new Error('Octane Lynx Block ref values do not match their template sites.');
			}
			const writes = (refWrites ??= new Map());
			for (let index = 0; index < sites.length; index++) {
				const node = sites[index]!;
				const id = block.firstId + node;
				writes.set(id, {
					id,
					type: block.template.program.nodes[node]!.type,
					attached: !block.deferred,
					value: values[index],
				});
			}
		},

		releaseRefs(block) {
			const sites = block.template.refs;
			if (sites === undefined) return;
			const writes = (refWrites ??= new Map());
			for (const node of sites) writes.set(block.firstId + node, null);
		},

		dispatchHostAttachments(changes) {
			const live: LynxHostAttachmentChange[] = [];
			for (const change of changes) {
				if (refs.has(change.id)) live.push(change);
				else if (change.attached) {
					throw new Error('Octane Lynx Block attachment lost its ref owner.');
				}
			}
			if (live.length === 0) return;
			const batch = applyLynxHostAttachments(container, live);
			const tasks: (() => void)[] = [];
			for (const id of batch.detached) {
				const record = refs.get(id);
				if (record === undefined)
					throw new Error('Octane Lynx Block attachment lost its ref owner.');
				tasks.push(() => detachRef(record));
			}
			for (const id of batch.attached) {
				const record = refs.get(id);
				if (record === undefined)
					throw new Error('Octane Lynx Block attachment lost its ref owner.');
				tasks.push(() => attachRef(record));
			}
			runRefTasks(tasks);
		},

		dispatchTransportEvent(message) {
			if (message.type !== 'event') {
				throw new Error(
					typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
						? 'Octane Lynx block root expected a transported event message.'
						: 'Octane Lynx OL021',
				);
			}
			if (message.protocol !== UNIVERSAL_TRANSPORT_PROTOCOL_VERSION) {
				throw new Error(
					typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
						? `Octane Lynx block root event uses protocol ${String(message.protocol)}; expected ${UNIVERSAL_TRANSPORT_PROTOCOL_VERSION}.`
						: 'Octane Lynx OL022',
				);
			}
			if (message.renderer !== LYNX_TRANSPORT_RENDERER) {
				throw new Error(
					typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
						? 'Octane Lynx block root event belongs to a foreign renderer.'
						: 'Octane Lynx OL023',
				);
			}
			if (message.root !== transportRoot) {
				throw new Error(
					typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
						? 'Octane Lynx block root event belongs to a stale or foreign root.'
						: 'Octane Lynx OL024',
				);
			}
			if (message.version !== acceptedVersion) {
				// The same identity discipline `universal-core.ts` applies to events:
				// a delivery stamped against a superseded batch was aimed at a tree
				// this root no longer paints, and must be refused rather than run
				// against post-commit state.
				throw new Error(
					typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
						? `Octane Lynx block root event version ${String(message.version)} does not match batch ${acceptedVersion}.`
						: 'Octane Lynx OL025',
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
			return eventScope(message.priority, () => {
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
			});
		},

		acceptsNativeEvent(listener, priority) {
			const bound = listeners.get(listener);
			return bound !== undefined && bound.priority === priority;
		},

		async commit(onAccept, onFrame) {
			const batch = core.flush();
			if (batch === null) {
				finishAccepted(onAccept);
				return null;
			}
			onFrame?.();
			// U1 §3: a commit is the unit of structural consistency and it is
			// indivisible. One flush becomes one frame; the core never emits a
			// prefix, yields, and emits the rest, because a `move`'s `before`
			// anchor could then name an id the host has not been told to create.
			if (LYNX_PROFILE) lynxWireProfile().blockAckRoundTrips++;
			const identity = identityFor(batch.version);
			const prepared = transport.prepareBatch(container, batch, identity);
			let acknowledged = false;
			let hasAcceptedError = false;
			let acceptedError: unknown;
			await prepared.apply((message: UniversalTransportAcknowledgement) => {
				if (
					message.protocol !== UNIVERSAL_TRANSPORT_PROTOCOL_VERSION ||
					message.renderer !== LYNX_TRANSPORT_RENDERER ||
					message.root !== transportRoot ||
					message.version !== batch.version
				) {
					throw new Error(
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? `Octane Lynx block root acknowledgement does not match batch ${batch.version}.`
							: 'Octane Lynx OL026',
					);
				}
				if (message.type !== 'ack') {
					throw new Error(
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? `Octane Lynx block root expected an acknowledgement for batch ${batch.version}.`
							: 'Octane Lynx OL027',
					);
				}
				if (batch.version <= acceptedVersion) {
					throw new Error(
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? `Octane Lynx block root rejected stale accepted batch version ${batch.version}; current version is ${acceptedVersion}.`
							: 'Octane Lynx OL028',
					);
				}
				acceptedVersion = batch.version;
				acknowledged = true;
				try {
					finishAccepted(onAccept);
				} catch (error) {
					hasAcceptedError = true;
					acceptedError = error;
				}
			});
			if (!acknowledged) {
				throw new Error(
					typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
						? `Octane Lynx block root batch ${batch.version} was never acknowledged.`
						: 'Octane Lynx OL029',
				);
			}
			prepared.afterAccept?.();
			if (hasAcceptedError) throw acceptedError;
			return batch;
		},

		acceptedVersion() {
			return acceptedVersion;
		},
	};
	return Object.freeze(root);
}
