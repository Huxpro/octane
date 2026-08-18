/**
 * Host-neutral hook-cell kernel shared by universal-family renderer cores.
 *
 * This module is the first extraction slice of the ownership/hook kernel
 * described in docs/lynx-specialized-target-l0.md §5 (issue #58 L2): the
 * per-owner hook cell shapes, the hook update-queue value types, and the pure
 * helpers that read or advance cells without touching any owner, root, host
 * record, command, or scheduler. Everything here must stay free of renderer
 * and host imports; owner- and batch-shaped dependencies enter only as type
 * parameters. The scheduling seam (`scheduleOwner`, transition batches, root
 * services) deliberately stays in `universal-core.ts` — see the extraction
 * blocker inventory recorded in the spec before widening this module.
 */

export type EffectPhase = 'insertion' | 'layout' | 'passive';
export type UniversalVisibility = 'visible' | 'activity-hidden' | 'suspense-hidden';

export interface StateHook<T = unknown> {
	kind: 'state';
	value: T;
	set: (value: T | ((previous: T) => T)) => void;
	get: () => T;
}

export interface LinkedStatePrevious<Source, Value> {
	source: Source;
	value: Value;
}

export interface LinkedStateOptions<Source, Value> {
	sourceEqual?: (previous: Source, next: Source) => boolean;
	valueEqual?: (previous: Value, next: Value) => boolean;
}

export interface LinkedStateHook<Source = unknown, Value = unknown> {
	kind: 'state';
	linked: true;
	source: Source;
	generation: number;
	generationBase: Value;
	value: Value;
	valueEqual: (previous: Value, next: Value) => boolean;
	set: (value: Value | ((previous: Value) => Value)) => void;
	get?: () => Value;
}

export interface ParkedUniversalLinkedDraft<Source = unknown, Value = unknown> {
	source: Source;
	value: Value;
	valueEqual: (previous: Value, next: Value) => boolean;
	generation: number;
	updated: boolean;
}

export interface ReducerHook<S = unknown, A = unknown> {
	kind: 'reducer';
	value: S;
	reducer: (state: S, action: A) => S;
	dispatch: (action: A) => void;
	get: () => S;
}

export interface MemoHook<T = unknown> {
	kind: 'memo';
	value: T;
	deps: readonly unknown[] | null;
}

export interface RefHook<T = unknown> {
	kind: 'ref';
	current: T;
	value: { current: T };
}

export interface IdHook {
	kind: 'id';
	value: string;
}

export interface EffectEventHook {
	kind: 'effect-event';
	cell: EffectEventCell;
	next: (...args: any[]) => any;
	value: (...args: any[]) => any;
}

export interface EffectEventCell {
	impl: (...args: any[]) => any;
	active: boolean;
}

/**
 * The one cell that references its owner. The owner type is a parameter so
 * the kernel never names a renderer core's owner record; effect bodies and
 * the runners below never read through it.
 */
export interface EffectHook<Owner = unknown> {
	kind: 'effect';
	owner: Owner;
	slot: unknown;
	phase: EffectPhase;
	create: () => void | (() => void);
	deps: readonly unknown[] | null;
	cleanup: (() => void) | null;
	mounted: boolean;
	previous: EffectHook<Owner> | null;
}

export interface UniversalTransitionUpdate {
	readonly kind: 'state' | 'reducer';
}

export interface UniversalTransitionBatch<Owner, Root> {
	readonly updates: Map<Owner, Map<unknown, UniversalTransitionUpdate>>;
	readonly roots: Set<Root>;
	pendingActions: number;
	pendingSignals: number;
	closed: boolean;
	promotionScheduled: boolean;
	promoted: boolean;
	settled: boolean;
}

export interface UniversalTransitionServices<Owner extends { disposed: boolean }, Root> {
	rootFor(owner: Owner): Root;
	hasQueuedBatch(
		owner: Owner,
		slot: unknown,
		batch: UniversalTransitionBatch<Owner, Root>,
	): boolean;
	enqueueUpdate(
		owner: Owner,
		slot: unknown,
		kind: 'state' | 'reducer',
		value: unknown,
		batch: UniversalTransitionBatch<Owner, Root>,
	): void;
	scheduleTransition(root: Root, batch: UniversalTransitionBatch<Owner, Root>): void;
	discardTransitionBatch(root: Root, batch: UniversalTransitionBatch<Owner, Root>): void;
	scheduleMicrotask(root: Root, callback: () => void): void;
	scheduleFallbackMicrotask(callback: () => void): void;
	withDiscreteNotifications(notify: () => void): void;
}

export interface UniversalTransitionController<Owner extends { disposed: boolean }, Root> {
	readonly pendingCount: number;
	subscribe(listener: () => void): () => void;
	batchForUpdate(discrete: boolean): UniversalTransitionBatch<Owner, Root> | null;
	stageUpdate(
		batch: UniversalTransitionBatch<Owner, Root>,
		owner: Owner,
		slot: unknown,
		kind: 'state' | 'reducer',
		value: unknown,
	): void;
	finishRoot(batch: UniversalTransitionBatch<Owner, Root>, root: Root): void;
	start(run: () => void | Promise<unknown>): void;
}

/** Host-neutral transition batch ownership and promotion lifecycle. */
export function createUniversalTransitionController<Owner extends { disposed: boolean }, Root>(
	services: UniversalTransitionServices<Owner, Root>,
): UniversalTransitionController<Owner, Root> {
	type Batch = UniversalTransitionBatch<Owner, Root>;
	let depth = 0;
	let asyncCount = 0;
	let pendingCount = 0;
	let activeBatch: Batch | null = null;
	let inFlightBatch: Batch | null = null;
	const listeners = new Set<() => void>();

	const tickPending = (delta: number): void => {
		pendingCount = Math.max(0, pendingCount + delta);
		services.withDiscreteNotifications(() => {
			for (const listener of [...listeners]) listener();
		});
	};
	const settleBatch = (batch: Batch): void => {
		if (batch.settled) return;
		batch.settled = true;
		if (activeBatch === batch) activeBatch = null;
		if (inFlightBatch === batch) inFlightBatch = null;
		tickPending(-batch.pendingSignals);
	};

	let queuePromotion!: (batch: Batch) => void;
	const finishRoot = (batch: Batch, root: Root): void => {
		if (batch.settled) return;
		const rehomePromotion = !batch.promoted && batch.promotionScheduled;
		services.discardTransitionBatch(root, batch);
		batch.roots.delete(root);
		if (batch.closed && batch.pendingActions === 0 && batch.roots.size === 0) {
			settleBatch(batch);
		} else if (rehomePromotion) {
			batch.promotionScheduled = false;
			queuePromotion(batch);
		}
	};
	const promoteBatch = (batch: Batch): void => {
		if (batch.promoted || batch.settled || !batch.closed || batch.pendingActions !== 0) return;
		batch.promoted = true;
		const scheduledRoots = new Set<Root>();
		for (const [owner, bySlot] of batch.updates) {
			if (owner.disposed) continue;
			let hasUpdates = false;
			for (const slot of bySlot.keys()) {
				if (services.hasQueuedBatch(owner, slot, batch)) {
					hasUpdates = true;
					break;
				}
			}
			if (!hasUpdates) continue;
			const root = services.rootFor(owner);
			if (!scheduledRoots.has(root)) {
				scheduledRoots.add(root);
				services.scheduleTransition(root, batch);
			}
		}
		batch.updates.clear();
		for (const root of [...batch.roots]) {
			if (!scheduledRoots.has(root)) finishRoot(batch, root);
		}
		if (batch.roots.size === 0) settleBatch(batch);
	};
	queuePromotion = (batch: Batch): void => {
		if (
			batch.promotionScheduled ||
			batch.promoted ||
			batch.settled ||
			!batch.closed ||
			batch.pendingActions !== 0
		) {
			return;
		}
		batch.promotionScheduled = true;
		const firstOwner = batch.updates.keys().next().value as Owner | undefined;
		const promote = () => {
			batch.promotionScheduled = false;
			promoteBatch(batch);
		};
		if (firstOwner !== undefined && !firstOwner.disposed) {
			services.scheduleMicrotask(services.rootFor(firstOwner), promote);
		} else {
			services.scheduleFallbackMicrotask(promote);
		}
	};

	return {
		get pendingCount() {
			return pendingCount;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		batchForUpdate(discrete) {
			if (depth > 0) return activeBatch;
			if (discrete) return null;
			return asyncCount > 0 ? inFlightBatch : null;
		},
		stageUpdate(batch, owner, slot, kind, value) {
			services.enqueueUpdate(owner, slot, kind, value, batch);
			batch.roots.add(services.rootFor(owner));
			let bySlot = batch.updates.get(owner);
			if (bySlot === undefined) batch.updates.set(owner, (bySlot = new Map()));
			const update = bySlot.get(slot);
			if (update === undefined) bySlot.set(slot, { kind });
			else if (update.kind !== kind) {
				throw new Error('A universal transition cannot stage incompatible hook updates.');
			}
		},
		finishRoot,
		start(run) {
			if (typeof run !== 'function') throw new TypeError('startTransition expected a function.');
			tickPending(+1);
			const parentBatch = activeBatch;
			const pendingBatch = inFlightBatch;
			const batch: Batch = parentBatch ??
				pendingBatch ?? {
					updates: new Map(),
					roots: new Set(),
					pendingActions: 0,
					pendingSignals: 0,
					closed: false,
					promotionScheduled: false,
					promoted: false,
					settled: false,
				};
			const ownsBatch = parentBatch === null && pendingBatch === null;
			batch.pendingSignals++;
			activeBatch = batch;
			depth++;
			let result: void | Promise<unknown>;
			let then: ((resolve: () => void, reject: () => void) => unknown) | null = null;
			try {
				result = run();
				if ((result !== null && typeof result === 'object') || typeof result === 'function') {
					const candidate = (result as any).then;
					if (typeof candidate === 'function') then = candidate;
				}
				if (then !== null) {
					batch.pendingActions++;
					inFlightBatch = batch;
				}
			} catch (error) {
				batch.pendingSignals--;
				tickPending(-1);
				if (ownsBatch) {
					batch.closed = true;
					queuePromotion(batch);
				}
				throw error;
			} finally {
				activeBatch = parentBatch;
				depth--;
			}
			if (ownsBatch) batch.closed = true;
			if (then !== null) {
				asyncCount++;
				let settled = false;
				const settle = () => {
					if (settled) return;
					settled = true;
					batch.pendingActions--;
					asyncCount--;
					if (batch.pendingActions === 0 && inFlightBatch === batch) inFlightBatch = null;
					queuePromotion(batch);
				};
				try {
					then.call(result, settle, settle);
				} catch (error) {
					settle();
					throw error;
				}
			} else {
				queuePromotion(batch);
			}
		},
	};
}

export interface UniversalHookUpdateQueue<Batch = unknown> extends Array<unknown> {
	kind?: 'state' | 'reducer';
	baseState?: unknown;
	batches?: (Batch | null)[];
	rebases?: boolean[];
}

/** Hook storage shared by committed and speculative renderer owners. */
export interface UniversalHookOwner<Hook = unknown> {
	hooks: Map<unknown, Hook>;
}

/** The state a captured hook setter needs from its committed owner. */
export interface UniversalCommittedHookOwner<
	Hook = unknown,
	Batch = unknown,
> extends UniversalHookOwner<Hook> {
	updates: Map<unknown, UniversalHookUpdateQueue<Batch>>;
	disposed: boolean;
}

/** The state an update raised during a speculative render marks dirty. */
export interface UniversalDraftHookOwner<Hook = unknown> extends UniversalHookOwner<Hook> {
	needsRender: boolean;
}

export type UniversalOwnerScheduler<Owner, Slot = unknown> = (owner: Owner, slot?: Slot) => void;

/**
 * Bind a renderer's scheduling service while keeping the shared disposed-owner
 * contract in the kernel. The returned function is allocated once per core,
 * never per owner or update.
 */
export function createScheduleOwner<Owner extends { disposed: boolean }, Slot = unknown>(
	schedule: UniversalOwnerScheduler<Owner, Slot>,
): UniversalOwnerScheduler<Owner, Slot> {
	return (owner, slot) => {
		if (owner.disposed) return;
		schedule(owner, slot);
	};
}

export interface AppliedUniversalUrgentUpdates<Batch = unknown> {
	readonly lane: false;
	readonly queue: UniversalHookUpdateQueue<Batch>;
	readonly consumed: number;
	readonly baseState: unknown;
}

export interface AppliedUniversalLaneUpdates<Batch = unknown> {
	readonly lane: true;
	readonly queue: UniversalHookUpdateQueue<Batch>;
	readonly consumed: number;
	readonly baseState: unknown;
	readonly remainingValues: unknown[];
	readonly remainingBatches: (Batch | null)[];
	readonly remainingRebases: boolean[];
}

export type AppliedUniversalHookUpdates<Batch = unknown> =
	AppliedUniversalUrgentUpdates<Batch> | AppliedUniversalLaneUpdates<Batch>;

export type UniversalTrackedThenable<T = unknown> = PromiseLike<T> & {
	status?: 'pending' | 'fulfilled' | 'rejected';
	value?: T;
	reason?: unknown;
};

export function depsEqual(
	left: readonly unknown[] | null,
	right: readonly unknown[] | null,
): boolean {
	if (left === null || right === null || left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (!Object.is(left[index], right[index])) return false;
	}
	return true;
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		(value !== null && typeof value === 'object' && typeof (value as any).then === 'function') ||
		(typeof value === 'function' && typeof (value as any).then === 'function')
	);
}

export function trackUniversalThenable<T>(thenable: UniversalTrackedThenable<T>): void {
	if (
		thenable.status === 'pending' ||
		thenable.status === 'fulfilled' ||
		thenable.status === 'rejected'
	)
		return;
	thenable.status = 'pending';
	thenable.then(
		(value) => {
			thenable.status = 'fulfilled';
			thenable.value = value;
		},
		(error) => {
			thenable.status = 'rejected';
			thenable.reason = error;
		},
	);
}

export function runEffectCreate<Owner>(hook: EffectHook<Owner>): void {
	const cleanup = (hook.create as (...args: unknown[]) => void | (() => void))(
		...(hook.deps ?? []),
	);
	hook.cleanup = typeof cleanup === 'function' ? cleanup : null;
	hook.mounted = true;
}

export function runEffectCleanup<Owner>(hook: EffectHook<Owner>): void {
	const cleanup = hook.cleanup;
	hook.cleanup = null;
	hook.mounted = false;
	cleanup?.();
}

export function deactivateEffectEventCells(cells: readonly EffectEventCell[]): void {
	for (const cell of cells) cell.active = false;
}
