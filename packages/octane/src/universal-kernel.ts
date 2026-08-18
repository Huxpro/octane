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

export interface UniversalHookUpdateQueue<Batch = unknown> extends Array<unknown> {
	kind?: 'state' | 'reducer';
	baseState?: unknown;
	batches?: (Batch | null)[];
	rebases?: boolean[];
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
