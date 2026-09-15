declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalHostBatch, UniversalHostProgramAddress } from 'octane/universal/native';
import {
	encodeLynxDeltaMessage,
	isLynxDeltaValue,
	prepareLynxDeltaValue,
	type LynxDeltaAnchor,
	type LynxDeltaOperation,
	type LynxDeltaTemplate,
	type LynxDeltaValue,
	type LynxEncodedDeltaMessage,
	type LynxSlotAddress,
} from './delta-protocol.js';
import { LYNX_TRANSPORT_RENDERER } from './transport-identity.js';

const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const CODE = 'Octane Lynx OL501';
const ROOT_INSTANCE = 1;
const FIRST_INSTANCE = ROOT_INSTANCE + 1;

export interface LynxBlockDeltaRun {
	readonly address: UniversalHostProgramAddress;
	readonly parent: LynxSlotAddress;
	readonly before: LynxDeltaAnchor;
	readonly count: number;
	readonly values: readonly unknown[];
	/** Omitted for ref-free templates so their frame shape remains unchanged. */
	readonly refs?: { readonly firstId: number; readonly stride: number };
}

/**
 * Direct producer seam consumed by the Block core.
 *
 * The core already owns instance, slot, and range identity. This interface
 * keeps that information intact until the existing compact v2 encoder instead
 * of recovering it from complete host props after the render.
 */
export interface LynxBlockDeltaProducer {
	beginAttempt(): void;
	acceptAttempt(): void;
	abortAttempt(): boolean;
	hasPending(): boolean;
	run(input: LynxBlockDeltaRun): number;
	set(instance: number, slot: number, value: unknown): boolean;
	move(instance: number, parent: LynxSlotAddress, before: LynxDeltaAnchor): void;
	remove(firstInstance: number, count: number): void;
	clear(parent: LynxSlotAddress, retiredInstances?: readonly number[]): void;
	visibility(instance: number, visible: boolean): void;
	flush(version: number): UniversalHostBatch | null;
}

export interface LynxPreparedBlockDeltaBatch {
	readonly source: 'block';
	readonly templates: readonly LynxDeltaTemplate[];
	readonly operations: readonly LynxDeltaOperation[];
	readonly retiredInstances: readonly number[];
	readonly encoded: LynxEncodedDeltaMessage;
}

interface PreparedEntry {
	readonly owner: LynxBlockDeltaProducer;
	readonly frame: LynxPreparedBlockDeltaBatch;
}

const prepared = new WeakMap<UniversalHostBatch, PreparedEntry>();

export function preparedLynxBlockDeltaBatch(
	batch: UniversalHostBatch,
	owner?: LynxBlockDeltaProducer,
): LynxPreparedBlockDeltaBatch | null {
	const entry = prepared.get(batch);
	return entry !== undefined && (owner === undefined || entry.owner === owner) ? entry.frame : null;
}

export function isLynxBlockDeltaTeardown(
	batch: UniversalHostBatch,
	owner?: LynxBlockDeltaProducer,
): boolean {
	const entry = prepared.get(batch);
	return (
		entry !== undefined &&
		(owner === undefined || entry.owner === owner) &&
		entry.frame.operations.length !== 0 &&
		entry.frame.operations.every(
			(operation) => operation.op === 'remove' || operation.op === 'clear',
		)
	);
}

function fail(message: string): never {
	throw new TypeError(DEVELOPMENT ? `Octane Lynx block delta producer: ${message}.` : CODE);
}
function positiveInteger(input: number, where: string): number {
	if (!Number.isSafeInteger(input) || input <= 0) fail(`${where} must be a positive integer`);
	return input;
}

function nonNegativeInteger(input: number, where: string): number {
	if (!Number.isSafeInteger(input) || input < 0) {
		fail(`${where} must be a non-negative integer`);
	}
	return input;
}

function value(input: unknown, where: string): LynxDeltaValue {
	if (isLynxDeltaValue(input)) return input;
	return prepareLynxDeltaValue(input, where);
}

function frozenSite(site: LynxSlotAddress, where: string): LynxSlotAddress {
	if (site === null || typeof site !== 'object') fail(`${where} requires a slot address`);
	return Object.freeze({
		instance: positiveInteger(site.instance, `${where} instance`),
		slot: nonNegativeInteger(site.slot, `${where} slot`),
	});
}

function addressKey(address: UniversalHostProgramAddress): string {
	if (
		address === null ||
		typeof address !== 'object' ||
		typeof address.module !== 'string' ||
		address.module.length === 0 ||
		!Number.isSafeInteger(address.index) ||
		address.index < 0
	) {
		fail('RUN requires a build-proven program address');
	}
	return `${address.module}\u0000${address.index}`;
}

function frozenOperation(operation: LynxDeltaOperation): LynxDeltaOperation {
	switch (operation.op) {
		case 'run':
			return Object.freeze({
				...operation,
				parent: Object.freeze({ ...operation.parent }),
				before: operation.before === null ? null : Object.freeze({ ...operation.before }),
				values: Object.freeze([...operation.values]),
			});
		case 'move':
			return Object.freeze({
				...operation,
				parent: Object.freeze({ ...operation.parent }),
				before: operation.before === null ? null : Object.freeze({ ...operation.before }),
			});
		case 'clear':
			return Object.freeze({ ...operation, parent: Object.freeze({ ...operation.parent }) });
		default:
			return Object.freeze({ ...operation });
	}
}

/**
 * Build one compact frame directly from Block operations.
 *
 * Template and instance allocators are attempt-owned just like Block host and
 * listener ids: a rejected frame rewinds all three, while the immutable encoded
 * batch remains retryable. SETs use an instance/slot journal, so repeated writes
 * replace the first operation in place without rescanning any host layout.
 */
export function createLynxBlockDeltaProducer(): LynxBlockDeltaProducer {
	const templates = new Map<string, number>();
	let nextTemplate = 1;
	let nextInstance = FIRST_INSTANCE;
	let operations: LynxDeltaOperation[] = [];
	let definitions: LynxDeltaTemplate[] = [];
	let dirtySlots = new Map<number, Map<number, number>>();
	let retiredInstances: number[] = [];
	let dirtyVisibility = new Map<number, number>();
	let attempt: {
		readonly nextTemplate: number;
		readonly nextInstance: number;
		readonly templates: readonly string[];
	} | null = null;
	let attemptTemplates: string[] | null = null;

	const append = (operation: LynxDeltaOperation): number => {
		const index = operations.length;
		operations.push(operation);
		return index;
	};

	const templateFor = (address: UniversalHostProgramAddress): number => {
		const key = addressKey(address);
		const known = templates.get(key);
		if (known !== undefined) return known;
		const id = nextTemplate++;
		templates.set(key, id);
		attemptTemplates?.push(key);
		definitions.push({
			id,
			address: Object.freeze({ module: address.module, index: address.index }),
		});
		return id;
	};

	const producer: LynxBlockDeltaProducer = {
		beginAttempt() {
			if (attempt !== null) fail('a render attempt is already active');
			if (operations.length !== 0 || definitions.length !== 0) {
				fail('a render attempt cannot begin with an unflushed frame');
			}
			attemptTemplates = [];
			attempt = {
				nextTemplate,
				nextInstance,
				templates: attemptTemplates,
			};
		},
		acceptAttempt() {
			attempt = null;
			attemptTemplates = null;
		},
		abortAttempt() {
			if (attempt === null) return false;
			operations = [];
			definitions = [];
			retiredInstances = [];
			dirtySlots = new Map();
			dirtyVisibility = new Map();
			for (const key of attempt.templates) templates.delete(key);
			nextTemplate = attempt.nextTemplate;
			nextInstance = attempt.nextInstance;
			attempt = null;
			attemptTemplates = null;
			return true;
		},
		hasPending: () => operations.length !== 0 || definitions.length !== 0,
		run(input) {
			if (!Number.isSafeInteger(input.count) || input.count <= 0) {
				fail('RUN count must be a positive integer');
			}
			const firstInstance = nextInstance;
			const finalInstance = firstInstance + input.count - 1;
			if (!Number.isSafeInteger(finalInstance) || finalInstance > 2 ** 31 - 1) {
				fail('RUN exhausts the instance handle range');
			}
			const values = input.values.map((entry, index) => value(entry, `RUN value ${index}`));
			append({
				op: 'run',
				templateId: templateFor(input.address),
				parent: frozenSite(input.parent, 'RUN parent'),
				before: input.before === null ? null : frozenSite(input.before, 'RUN anchor'),
				firstInstance,
				count: input.count,
				values,
			});
			if (input.refs !== undefined) {
				append({
					op: 'ref-run',
					firstInstance,
					firstId: positiveInteger(input.refs.firstId, 'REF-RUN first host id'),
					stride: positiveInteger(input.refs.stride, 'REF-RUN stride'),
				});
			}
			nextInstance = finalInstance + 1;
			return firstInstance;
		},
		set(instance, slot, input) {
			positiveInteger(instance, 'SET instance');
			nonNegativeInteger(slot, 'SET slot');
			const next = value(input, 'SET value');
			let slots = dirtySlots.get(instance);
			if (slots === undefined) dirtySlots.set(instance, (slots = new Map()));
			const prior = slots.get(slot);
			const operation = { op: 'set' as const, instance, slot, value: next };
			if (prior !== undefined) {
				operations[prior] = operation;
				return false;
			}
			slots.set(slot, append(operation));
			return true;
		},
		move(instance, parent, before) {
			positiveInteger(instance, 'MOVE instance');
			append({
				op: 'move',
				instance,
				parent: frozenSite(parent, 'MOVE parent'),
				before: before === null ? null : frozenSite(before, 'MOVE anchor'),
			});
		},
		remove(firstInstance, count) {
			positiveInteger(firstInstance, 'REMOVE first instance');
			positiveInteger(count, 'REMOVE count');
			append({ op: 'remove', firstInstance, count });
		},
		clear(parent, retired) {
			append({ op: 'clear', parent: frozenSite(parent, 'CLEAR parent') });
			if (retired !== undefined) {
				for (const instance of retired) {
					positiveInteger(instance, 'CLEAR retired instance');
					retiredInstances.push(instance);
				}
			}
		},
		visibility(instance, visible) {
			positiveInteger(instance, 'VIS instance');
			const operation = {
				op: 'vis' as const,
				instance,
				state: visible ? ('visible' as const) : ('hidden' as const),
			};
			const prior = dirtyVisibility.get(instance);
			if (prior === undefined) dirtyVisibility.set(instance, append(operation));
			else operations[prior] = operation;
		},
		flush(version) {
			if (operations.length === 0) return null;
			const frame: LynxPreparedBlockDeltaBatch = Object.freeze({
				source: 'block',
				templates: Object.freeze(definitions.map((definition) => Object.freeze(definition))),
				operations: Object.freeze(operations.map(frozenOperation)),
				retiredInstances: Object.freeze([...retiredInstances]),
				encoded: encodeLynxDeltaMessage(operations, definitions),
			});
			const batch: UniversalHostBatch = Object.freeze({
				renderer: LYNX_TRANSPORT_RENDERER,
				version,
				commands: Object.freeze([]),
			});
			prepared.set(batch, { owner: producer, frame });
			operations = [];
			definitions = [];
			retiredInstances = [];
			dirtySlots = new Map();
			dirtyVisibility = new Map();
			return batch;
		},
	};
	return Object.freeze(producer);
}
