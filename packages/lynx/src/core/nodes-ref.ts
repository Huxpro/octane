declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalSerializableValue } from 'octane/universal/native';
import { hasOwnSymbolFields } from './own-symbols.js';

/** Compiler-inaccessible native attribute used by the public selector-query API. */
export const LYNX_NODES_REF_ATTRIBUTE = 'octane-ref';

/**
 * Build the immutable selector installed for one root/host generation.
 *
 * A node carries this attribute only where a public instance was requested. In
 * a commit that announces its requests, every host it never names — a mounted
 * row, a native list cell nobody queried — carries none, and it is the request
 * rather than the attribute that survives a recycle onto whatever physical cell
 * the row lands on next. A background announces from what it knows while
 * composing, so its first batch announces too, which is what keeps the largest
 * tree a root ever mounts from paying for hosts nothing will query. Two paths
 * still install eagerly by construction: the first screen, which paints before
 * a peer exists at all, and adoption, which overwrites what it wrote.
 */
export function createLynxNodesRefSelector(root: number, id: number, generation: number): string {
	positiveSafeInteger(root, 'selector root');
	positiveSafeInteger(id, 'selector id');
	positiveSafeInteger(generation, 'selector generation');
	// Native Lynx attribute-selector matching compares the text after `=`
	// verbatim without stripping quotes, so the value must stay unquoted; the
	// token is a plain CSS identifier, so DOM `querySelector` accepts it too.
	return `[${LYNX_NODES_REF_ATTRIBUTE}=r${root}-h${id}-g${generation}]`;
}

/** Immutable native identity captured by one background query handle. */
export interface LynxNodesRefIdentity {
	readonly root: number;
	readonly id: number;
	readonly type: string;
	readonly generation: number;
	readonly selector: string;
}

/** Current client-driver state for the captured identity. */
export interface LynxNodesRefState extends LynxNodesRefIdentity {
	readonly active: boolean;
	/** Monotonic identity for the currently attached physical cell. */
	readonly attachmentEpoch: number;
}

export type LynxNodesRefErrorCode = 'inactive' | 'native' | 'stale';

export class LynxNodesRefError extends Error {
	readonly code: LynxNodesRefErrorCode;
	readonly nativeCode: number | null;
	readonly data: UniversalSerializableValue;

	constructor(
		code: LynxNodesRefErrorCode,
		message: string,
		nativeCode: number | null = null,
		data: UniversalSerializableValue = undefined,
	) {
		super(message);
		this.name = 'LynxNodesRefError';
		this.code = code;
		this.nativeCode = nativeCode;
		this.data = data;
	}
}

export interface LynxNativeQueryTask {
	exec(): void;
}

export interface LynxNativeInvokeOptions {
	readonly method: string;
	readonly params?: Readonly<Record<string, UniversalSerializableValue>>;
	readonly success: (value: unknown) => void;
	readonly fail: (value: unknown) => void;
}

export interface LynxNativeNodesRef {
	invoke(options: LynxNativeInvokeOptions): LynxNativeQueryTask;
	fields(
		fields: Readonly<Record<string, boolean>>,
		callback: (value: unknown, status: unknown) => void,
	): LynxNativeQueryTask;
	path(callback: (value: unknown, status: unknown) => void): LynxNativeQueryTask;
	setNativeProps(props: Readonly<Record<string, UniversalSerializableValue>>): LynxNativeQueryTask;
}

export interface LynxNativeSelectorQuery {
	select(selector: string): LynxNativeNodesRef;
}

export type LynxCreateSelectorQuery = () => LynxNativeSelectorQuery;

export interface LynxNodesRefFieldsOptions {
	readonly id?: boolean;
	readonly dataset?: boolean;
	readonly tag?: boolean;
	readonly unique_id?: boolean;
	readonly index?: boolean;
	readonly class?: boolean;
	readonly attribute?: boolean;
	/** Returning a live SelectorQuery would violate the Octane handle boundary. */
	readonly query?: false;
}

export type LynxNodesRefFieldsResult = Readonly<Record<string, UniversalSerializableValue>> | null;

export interface LynxNodesRefPathEntry {
	readonly tag: string;
	readonly id: string;
	readonly class: readonly string[];
	readonly dataSet: Readonly<Record<string, UniversalSerializableValue>>;
	readonly index: number;
}

export interface LynxNodesRefPathResult {
	readonly data: readonly LynxNodesRefPathEntry[];
}

export interface LynxMeasureOptions {
	readonly relativeTo?: 'screen' | string | null;
	readonly androidEnableTransformProps?: boolean;
	readonly iOSEnableAnimationProps?: boolean;
}

export interface LynxMeasureResult {
	readonly id: string;
	readonly dataset: Readonly<Record<string, UniversalSerializableValue>>;
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
	readonly width: number;
	readonly height: number;
}

export interface LynxNodesRef {
	readonly root: number;
	readonly id: number;
	readonly type: string;
	readonly generation: number;
	readonly active: boolean;
	invoke<Result extends UniversalSerializableValue = UniversalSerializableValue>(
		method: string,
		params?: Readonly<Record<string, UniversalSerializableValue>>,
	): Promise<Result>;
	measure(options?: LynxMeasureOptions): Promise<LynxMeasureResult>;
	fields(options: LynxNodesRefFieldsOptions): Promise<LynxNodesRefFieldsResult>;
	path(): Promise<LynxNodesRefPathResult | null>;
	/** Resolves once Lynx accepts the selector-query submission, not after layout. */
	setNativeProps(props: Readonly<Record<string, UniversalSerializableValue>>): Promise<void>;
}

export interface CreateLynxNodesRefOptions {
	readonly identity: LynxNodesRefIdentity;
	readonly createSelectorQuery: LynxCreateSelectorQuery;
	/** The client driver must return the currently published state for this handle. */
	readonly readState: () => LynxNodesRefState | null;
}

/**
 * The client driver owns permanent invalidation because a pull-only state read
 * cannot settle a native operation whose callback never arrives.
 */
export interface LynxNodesRefBinding {
	readonly handle: LynxNodesRef;
	/** Reject work owned by a detached cell without invalidating the logical handle. */
	invalidateAttachment(): void;
	invalidate(reason?: unknown): void;
}

interface PendingOperation {
	reject(error: Error): void;
}

type OperationOutcome<Value> =
	{ readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: Error };

const FIELD_NAMES = new Set([
	'id',
	'dataset',
	'tag',
	'unique_id',
	'index',
	'class',
	'attribute',
	'query',
]);

function normalizedError(value: unknown, fallback: string): Error {
	if (value instanceof Error) return value;
	return new Error(value === undefined ? fallback : String(value));
}

function positiveSafeInteger(value: unknown, label: string): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? `Octane Lynx NodesRef ${label} must be a positive safe integer.`
				: 'Octane Lynx OL111',
		);
	}
}

function nonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? `Octane Lynx NodesRef ${label} must be a non-negative safe integer.`
				: 'Octane Lynx OL112',
		);
	}
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? `Octane Lynx NodesRef ${label} must be a non-empty string.`
				: 'Octane Lynx OL113',
		);
	}
}

function cloneSerializable(
	value: unknown,
	label: string,
	seen: Set<object> = new Set(),
): UniversalSerializableValue {
	if (
		value === null ||
		value === undefined ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'bigint' ||
		typeof value === 'boolean'
	) {
		return value;
	}
	if (typeof value !== 'object') {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? `Octane Lynx NodesRef ${label} contains a non-serializable value.`
				: 'Octane Lynx OL114',
		);
	}
	if (hasOwnSymbolFields(value)) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? `Octane Lynx NodesRef ${label} contains symbol fields.`
				: 'Octane Lynx OL115',
		);
	}
	if (seen.has(value)) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? `Octane Lynx NodesRef ${label} contains a cycle.`
				: 'Octane Lynx OL116',
		);
	}
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return Object.freeze(
				value.map((entry, index) => cloneSerializable(entry, `${label}[${index}]`, seen)),
			);
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? `Octane Lynx NodesRef ${label} requires arrays or plain objects.`
					: 'Octane Lynx OL117',
			);
		}
		const output: Record<string, UniversalSerializableValue> = {};
		for (const [name, entry] of Object.entries(value)) {
			Object.defineProperty(output, name, {
				configurable: true,
				enumerable: true,
				value: cloneSerializable(entry, `${label}.${name}`, seen),
				writable: true,
			});
		}
		return Object.freeze(output);
	} finally {
		seen.delete(value);
	}
}

function cloneRecord(
	value: unknown,
	label: string,
): Readonly<Record<string, UniversalSerializableValue>> {
	const clone = cloneSerializable(value, label);
	if (clone === null || typeof clone !== 'object' || Array.isArray(clone)) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? `Octane Lynx NodesRef ${label} must be a plain object.`
				: 'Octane Lynx OL118',
		);
	}
	return clone as Readonly<Record<string, UniversalSerializableValue>>;
}

function nativeStatus(
	value: unknown,
	label: string,
): { code: number; data: UniversalSerializableValue } {
	const status = cloneRecord(value, label);
	if (!Number.isSafeInteger(status.code)) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? `Octane Lynx NodesRef ${label}.code must be a safe integer.`
				: 'Octane Lynx OL119',
		);
	}
	return { code: status.code as number, data: status.data };
}

function nativeFailure(value: unknown, label: string): Error {
	let status;
	try {
		status = nativeStatus(value, label);
	} catch (error) {
		return normalizedError(
			error,
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? `Octane Lynx NodesRef received an invalid ${label}.`
				: 'Octane Lynx OL120',
		);
	}
	return new LynxNodesRefError(
		'native',
		typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
			? `Octane Lynx NodesRef ${label} failed with native code ${status.code}.`
			: 'Octane Lynx OL121',
		status.code,
		status.data,
	);
}

function validateFieldsOptions(
	value: LynxNodesRefFieldsOptions,
): Readonly<Record<string, boolean>> {
	const fields = cloneRecord(value, 'fields options');
	for (const [name, enabled] of Object.entries(fields)) {
		if (!FIELD_NAMES.has(name)) {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? `Octane Lynx NodesRef fields options contain unknown field ${name}.`
					: 'Octane Lynx OL122',
			);
		}
		if (typeof enabled !== 'boolean') {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? `Octane Lynx NodesRef fields option ${name} must be boolean.`
					: 'Octane Lynx OL123',
			);
		}
		if (name === 'query' && enabled) {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? 'Octane Lynx NodesRef fields cannot return a live native SelectorQuery.'
					: 'Octane Lynx OL124',
			);
		}
	}
	return fields as Readonly<Record<string, boolean>>;
}

function validateMeasureOptions(
	value: LynxMeasureOptions,
): Readonly<Record<string, UniversalSerializableValue>> {
	const options = cloneRecord(value, 'measure options');
	for (const name of Object.keys(options)) {
		if (
			name !== 'relativeTo' &&
			name !== 'androidEnableTransformProps' &&
			name !== 'iOSEnableAnimationProps'
		) {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? `Octane Lynx NodesRef measure options contain unknown field ${name}.`
					: 'Octane Lynx OL125',
			);
		}
	}
	if (
		options.relativeTo !== undefined &&
		options.relativeTo !== null &&
		typeof options.relativeTo !== 'string'
	) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx NodesRef measure relativeTo must be a string or null.'
				: 'Octane Lynx OL126',
		);
	}
	if (
		options.androidEnableTransformProps !== undefined &&
		typeof options.androidEnableTransformProps !== 'boolean'
	) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx NodesRef measure androidEnableTransformProps must be boolean.'
				: 'Octane Lynx OL127',
		);
	}
	if (
		options.iOSEnableAnimationProps !== undefined &&
		typeof options.iOSEnableAnimationProps !== 'boolean'
	) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx NodesRef measure iOSEnableAnimationProps must be boolean.'
				: 'Octane Lynx OL128',
		);
	}
	return options;
}

function validateMeasureResult(value: UniversalSerializableValue): LynxMeasureResult {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx NodesRef measure returned a non-object result.'
				: 'Octane Lynx OL129',
		);
	}
	const result = value as Readonly<Record<string, UniversalSerializableValue>>;
	if (typeof result.id !== 'string') {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx NodesRef measure result id must be a string.'
				: 'Octane Lynx OL130',
		);
	}
	if (
		result.dataset === null ||
		typeof result.dataset !== 'object' ||
		Array.isArray(result.dataset)
	) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx NodesRef measure result dataset must be an object.'
				: 'Octane Lynx OL131',
		);
	}
	for (const name of ['left', 'right', 'top', 'bottom', 'width', 'height'] as const) {
		const coordinate = result[name];
		if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? `Octane Lynx NodesRef measure result ${name} must be finite.`
					: 'Octane Lynx OL132',
			);
		}
	}
	return result as unknown as LynxMeasureResult;
}

function validateFieldsResult(value: unknown): LynxNodesRefFieldsResult {
	if (value === null) return null;
	return cloneRecord(value, 'fields result');
}

function validatePathResult(value: unknown): LynxNodesRefPathResult | null {
	if (value === null) return null;
	const result = cloneRecord(value, 'path result');
	if (!Array.isArray(result.data)) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx NodesRef path result data must be an array.'
				: 'Octane Lynx OL133',
		);
	}
	for (let index = 0; index < result.data.length; index++) {
		const entry = result.data[index];
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? `Octane Lynx NodesRef path result data[${index}] must be an object.`
					: 'Octane Lynx OL134',
			);
		}
		const record = entry as Readonly<Record<string, UniversalSerializableValue>>;
		if (typeof record.tag !== 'string' || typeof record.id !== 'string') {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? `Octane Lynx NodesRef path result data[${index}] requires string tag and id.`
					: 'Octane Lynx OL135',
			);
		}
		if (!Array.isArray(record.class) || record.class.some((name) => typeof name !== 'string')) {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? `Octane Lynx NodesRef path result data[${index}].class is invalid.`
					: 'Octane Lynx OL136',
			);
		}
		if (
			record.dataSet === null ||
			typeof record.dataSet !== 'object' ||
			Array.isArray(record.dataSet)
		) {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? `Octane Lynx NodesRef path result data[${index}].dataSet is invalid.`
					: 'Octane Lynx OL137',
			);
		}
		if (!Number.isSafeInteger(record.index) || (record.index as number) < 0) {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? `Octane Lynx NodesRef path result data[${index}].index is invalid.`
					: 'Octane Lynx OL138',
			);
		}
	}
	return result as unknown as LynxNodesRefPathResult;
}

export function createLynxNodesRef(options: CreateLynxNodesRefOptions): LynxNodesRefBinding {
	if (options === null || typeof options !== 'object') {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx NodesRef options must be an object.'
				: 'Octane Lynx OL139',
		);
	}
	const identity = options.identity;
	if (identity === null || typeof identity !== 'object') {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx NodesRef identity must be an object.'
				: 'Octane Lynx OL140',
		);
	}
	positiveSafeInteger(identity.root, 'identity.root');
	positiveSafeInteger(identity.id, 'identity.id');
	positiveSafeInteger(identity.generation, 'identity.generation');
	nonEmptyString(identity.type, 'identity.type');
	nonEmptyString(identity.selector, 'identity.selector');
	if (typeof options.createSelectorQuery !== 'function') {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx NodesRef createSelectorQuery must be a function.'
				: 'Octane Lynx OL141',
		);
	}
	if (typeof options.readState !== 'function') {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx NodesRef readState must be a function.'
				: 'Octane Lynx OL142',
		);
	}

	const expected = Object.freeze({ ...identity });
	const createSelectorQuery = options.createSelectorQuery;
	const readState = options.readState;
	const pending = new Set<PendingOperation>();
	let invalidated: Error | null = null;

	const inactiveError = () =>
		new LynxNodesRefError(
			'inactive',
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? `Octane Lynx NodesRef ${expected.id}:${expected.generation} is inactive.`
				: 'Octane Lynx OL143',
		);

	const currentState = (attachmentEpoch: number | null = null): LynxNodesRefState => {
		if (invalidated !== null) throw invalidated;
		const state = readState();
		if (state === null || state.active !== true) throw inactiveError();
		nonNegativeSafeInteger(state.attachmentEpoch, 'state.attachmentEpoch');
		if (
			state.root !== expected.root ||
			state.id !== expected.id ||
			state.type !== expected.type ||
			state.generation !== expected.generation ||
			state.selector !== expected.selector
		) {
			throw new LynxNodesRefError(
				'stale',
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? `Octane Lynx NodesRef ${expected.id}:${expected.generation} no longer owns its selector.`
					: 'Octane Lynx OL144',
			);
		}
		if (attachmentEpoch !== null && state.attachmentEpoch !== attachmentEpoch) {
			throw new LynxNodesRefError(
				'stale',
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? `Octane Lynx NodesRef ${expected.id}:${expected.generation} changed physical attachment while an operation was pending.`
					: 'Octane Lynx OL145',
			);
		}
		return state;
	};

	const select = (selector: string): LynxNativeNodesRef => {
		const query = createSelectorQuery();
		if (query === null || typeof query !== 'object' || typeof query.select !== 'function') {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? 'Octane Lynx createSelectorQuery() returned an invalid query.'
					: 'Octane Lynx OL146',
			);
		}
		const nativeRef = query.select(selector);
		if (nativeRef === null || typeof nativeRef !== 'object') {
			throw new TypeError(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? 'Octane Lynx SelectorQuery.select() returned an invalid NodesRef.'
					: 'Octane Lynx OL147',
			);
		}
		return nativeRef;
	};

	const execute = <Value>(
		start: (
			selector: string,
			succeed: (value: Value) => void,
			fail: (error: Error) => void,
		) => void,
	): Promise<Value> =>
		new Promise<Value>((resolve, reject) => {
			let dispatching = true;
			let settled = false;
			let attachmentEpoch: number | null = null;
			let callbackOutcome: OperationOutcome<Value> | null = null;
			let forcedError: Error | null = null;

			const finish = (outcome: OperationOutcome<Value>) => {
				if (settled) return;
				settled = true;
				pending.delete(operation);
				if (outcome.ok) resolve(outcome.value);
				else reject(outcome.error);
			};
			const publish = (outcome: OperationOutcome<Value>) => {
				if (settled) return;
				if (dispatching) {
					callbackOutcome ??= outcome;
					return;
				}
				try {
					currentState(attachmentEpoch);
				} catch (error) {
					finish({
						ok: false,
						error: normalizedError(
							error,
							typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
								? 'Octane Lynx NodesRef became inactive.'
								: 'Octane Lynx OL148',
						),
					});
					return;
				}
				finish(outcome);
			};
			const operation: PendingOperation = {
				reject(error) {
					if (settled) return;
					if (dispatching) forcedError ??= error;
					else finish({ ok: false, error });
				},
			};
			pending.add(operation);

			try {
				const state = currentState();
				attachmentEpoch = state.attachmentEpoch;
				start(
					state.selector,
					(value) => publish({ ok: true, value }),
					(error) => publish({ ok: false, error }),
				);
			} catch (error) {
				forcedError = normalizedError(
					error,
					typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
						? 'Octane Lynx NodesRef operation failed.'
						: 'Octane Lynx OL149',
				);
			}
			dispatching = false;

			if (forcedError !== null) {
				finish({ ok: false, error: forcedError });
				return;
			}
			try {
				currentState(attachmentEpoch);
			} catch (error) {
				finish({
					ok: false,
					error: normalizedError(
						error,
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? 'Octane Lynx NodesRef became inactive.'
							: 'Octane Lynx OL150',
					),
				});
				return;
			}
			if (callbackOutcome !== null) finish(callbackOutcome);
		});

	const handle: LynxNodesRef = Object.freeze({
		root: expected.root,
		id: expected.id,
		type: expected.type,
		generation: expected.generation,
		get active() {
			try {
				currentState();
				return true;
			} catch {
				return false;
			}
		},
		invoke<Result extends UniversalSerializableValue = UniversalSerializableValue>(
			method: string,
			params: Readonly<Record<string, UniversalSerializableValue>> = {},
		): Promise<Result> {
			let clonedParams: Readonly<Record<string, UniversalSerializableValue>>;
			try {
				nonEmptyString(method, 'invoke method');
				clonedParams = cloneRecord(params, 'invoke params');
			} catch (error) {
				return Promise.reject(error);
			}
			return execute<Result>((selector, succeed, fail) => {
				const nativeRef = select(selector);
				if (typeof nativeRef.invoke !== 'function') {
					throw new TypeError(
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? 'Octane Lynx native NodesRef does not support invoke().'
							: 'Octane Lynx OL151',
					);
				}
				const task = nativeRef.invoke({
					method,
					params: clonedParams,
					success(value) {
						try {
							succeed(cloneSerializable(value, 'invoke result') as Result);
						} catch (error) {
							fail(
								normalizedError(
									error,
									typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
										? 'Octane Lynx invoke returned an invalid result.'
										: 'Octane Lynx OL152',
								),
							);
						}
					},
					fail(value) {
						fail(nativeFailure(value, 'invoke'));
					},
				});
				if (task === null || typeof task !== 'object' || typeof task.exec !== 'function') {
					throw new TypeError(
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? 'Octane Lynx NodesRef.invoke() returned an invalid query task.'
							: 'Octane Lynx OL153',
					);
				}
				task.exec();
			});
		},
		measure(measureOptions: LynxMeasureOptions = {}): Promise<LynxMeasureResult> {
			let params;
			try {
				params = validateMeasureOptions(measureOptions);
			} catch (error) {
				return Promise.reject(error);
			}
			return handle
				.invoke('boundingClientRect', params)
				.then((result) => validateMeasureResult(result));
		},
		fields(fieldOptions: LynxNodesRefFieldsOptions): Promise<LynxNodesRefFieldsResult> {
			let fields;
			try {
				fields = validateFieldsOptions(fieldOptions);
			} catch (error) {
				return Promise.reject(error);
			}
			return execute<LynxNodesRefFieldsResult>((selector, succeed, fail) => {
				const nativeRef = select(selector);
				if (typeof nativeRef.fields !== 'function') {
					throw new TypeError(
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? 'Octane Lynx native NodesRef does not support fields().'
							: 'Octane Lynx OL154',
					);
				}
				const task = nativeRef.fields(fields, (value, rawStatus) => {
					try {
						const status = nativeStatus(rawStatus, 'fields status');
						if (status.code !== 0) {
							fail(
								new LynxNodesRefError(
									'native',
									typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
										? `Octane Lynx NodesRef fields failed with native code ${status.code}.`
										: 'Octane Lynx OL155',
									status.code,
									status.data,
								),
							);
							return;
						}
						succeed(validateFieldsResult(value));
					} catch (error) {
						fail(
							normalizedError(
								error,
								typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
									? 'Octane Lynx fields returned an invalid result.'
									: 'Octane Lynx OL156',
							),
						);
					}
				});
				if (task === null || typeof task !== 'object' || typeof task.exec !== 'function') {
					throw new TypeError(
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? 'Octane Lynx NodesRef.fields() returned an invalid query task.'
							: 'Octane Lynx OL157',
					);
				}
				task.exec();
			});
		},
		path(): Promise<LynxNodesRefPathResult | null> {
			return execute<LynxNodesRefPathResult | null>((selector, succeed, fail) => {
				const nativeRef = select(selector);
				if (typeof nativeRef.path !== 'function') {
					throw new TypeError(
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? 'Octane Lynx native NodesRef does not support path().'
							: 'Octane Lynx OL158',
					);
				}
				const task = nativeRef.path((value, rawStatus) => {
					try {
						const status = nativeStatus(rawStatus, 'path status');
						if (status.code !== 0) {
							fail(
								new LynxNodesRefError(
									'native',
									typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
										? `Octane Lynx NodesRef path failed with native code ${status.code}.`
										: 'Octane Lynx OL159',
									status.code,
									status.data,
								),
							);
							return;
						}
						succeed(validatePathResult(value));
					} catch (error) {
						fail(
							normalizedError(
								error,
								typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
									? 'Octane Lynx path returned an invalid result.'
									: 'Octane Lynx OL160',
							),
						);
					}
				});
				if (task === null || typeof task !== 'object' || typeof task.exec !== 'function') {
					throw new TypeError(
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? 'Octane Lynx NodesRef.path() returned an invalid query task.'
							: 'Octane Lynx OL161',
					);
				}
				task.exec();
			});
		},
		setNativeProps(props: Readonly<Record<string, UniversalSerializableValue>>): Promise<void> {
			let clonedProps;
			try {
				clonedProps = cloneRecord(props, 'native props');
				if (
					Object.prototype.hasOwnProperty.call(clonedProps, 'style') ||
					Object.prototype.hasOwnProperty.call(clonedProps, 'ref') ||
					Object.prototype.hasOwnProperty.call(clonedProps, LYNX_NODES_REF_ATTRIBUTE)
				) {
					throw new TypeError(
						Object.prototype.hasOwnProperty.call(clonedProps, 'style')
							? typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
								? 'Octane Lynx NodesRef setNativeProps cannot set the whole style prop.'
								: 'Octane Lynx OL162'
							: typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
								? 'Octane Lynx NodesRef setNativeProps cannot replace its reserved ref selector.'
								: 'Octane Lynx OL163',
					);
				}
			} catch (error) {
				return Promise.reject(error);
			}
			return execute<void>((selector, succeed) => {
				const nativeRef = select(selector);
				if (typeof nativeRef.setNativeProps !== 'function') {
					throw new TypeError(
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? 'Octane Lynx native NodesRef does not support setNativeProps().'
							: 'Octane Lynx OL164',
					);
				}
				const task = nativeRef.setNativeProps(clonedProps);
				if (task === null || typeof task !== 'object' || typeof task.exec !== 'function') {
					throw new TypeError(
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? 'Octane Lynx NodesRef.setNativeProps() returned an invalid query task.'
							: 'Octane Lynx OL165',
					);
				}
				task.exec();
				succeed(undefined);
			});
		},
	});

	const binding: LynxNodesRefBinding = {
		handle,
		invalidateAttachment() {
			const error = inactiveError();
			for (const operation of [...pending]) operation.reject(error);
		},
		invalidate(reason) {
			if (invalidated !== null) return;
			invalidated =
				reason === undefined
					? inactiveError()
					: normalizedError(
							reason,
							typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
								? 'Octane Lynx NodesRef was invalidated.'
								: 'Octane Lynx OL166',
						);
			for (const operation of [...pending]) operation.reject(invalidated);
		},
	};
	return Object.freeze(binding);
}
