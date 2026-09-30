declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

/**
 * Runtime half of the compiler-owned Lynx program ABI.
 *
 * The background compiler emits this definition directly from the shared IR.
 * It contains no Universal plan tree and needs no runtime plan lowering; the
 * Block core consumes the wire and site maps as-is.
 */
import type {
	UniversalHostTemplateProgram,
	UniversalProgramAddress,
} from 'octane/universal/native';
import type {
	PreparedUniversalTemplateProgramEvent,
	PreparedUniversalTemplateProgramValue,
	UniversalTemplateProgramRange,
} from 'octane/universal/template-program';
import { LYNX_COMPILED_PROGRAM_HOST_REFS } from './compiled-program-host-ref-feature.js';
import { LYNX_PROGRAM_ABI_VERSION } from './program-abi.js';

const LYNX_COMPILER_PROGRAM: symbol = Symbol.for('octane.lynx.compiler-program');
const LYNX_COMPILER_PROGRAM_VALUE: symbol = Symbol.for('octane.lynx.compiler-program-value');

/** Increment only when the emitted background definition is incompatible. */
export const LYNX_COMPILER_PROGRAM_VERSION = LYNX_PROGRAM_ABI_VERSION;

export interface LynxCompilerProgramDefinition {
	readonly version: typeof LYNX_COMPILER_PROGRAM_VERSION;
	readonly address: UniversalProgramAddress;
	readonly wire: UniversalHostTemplateProgram;
	readonly values: readonly PreparedUniversalTemplateProgramValue[];
	readonly events: readonly PreparedUniversalTemplateProgramEvent[];
	readonly ranges: readonly UniversalTemplateProgramRange[];
	/** Authored host refs, omitted for the capability-free ABI. */
	readonly refs?: readonly { readonly node: number; readonly slot: number }[];
}

export interface LynxCompilerProgram extends LynxCompilerProgramDefinition {
	readonly $$kind: symbol;
	readonly renderer: string;
}

/** Dependency metadata shared by scalar replay and structural invalidation. */
interface LynxCompilerProgramComputationBase {
	/** Captures remain valid only for the committed component render that made them. */
	readonly escape: 'component-render';
	/** Stable hook getters whose values can invalidate this group. */
	readonly sources: readonly (() => unknown)[];
	/** Plan slots affected by this dependency group. */
	readonly slots: readonly number[];
}

/** A side-effect-free binding computation the runtime can replay directly. */
export interface LynxCompilerProgramScalarComputation extends LynxCompilerProgramComputationBase {
	readonly kind: 'scalar';
	readonly purity: 'pure';
	/** Recompute only the authored scalar values for `slots`. */
	readonly run: () => readonly unknown[];
}

/** A collection dependency whose descriptor cannot be reconstructed independently. */
interface LynxCompilerProgramUnknownStructuralComputation extends LynxCompilerProgramComputationBase {
	readonly kind: 'structural';
	readonly purity: 'unknown';
	readonly run?: never;
}

/**
 * A computation whose `run` only reconstructs keyed-range descriptors. Row
 * bodies and reconciliation still execute through the ordinary range path.
 */
interface LynxCompilerProgramReplayableStructuralComputation extends LynxCompilerProgramComputationBase {
	readonly kind: 'structural';
	readonly purity: 'descriptor-pure';
	readonly run: () => readonly unknown[];
}

export type LynxCompilerProgramStructuralComputation =
	| LynxCompilerProgramUnknownStructuralComputation
	| LynxCompilerProgramReplayableStructuralComputation;

export type LynxCompilerProgramComputation =
	LynxCompilerProgramScalarComputation | LynxCompilerProgramStructuralComputation;

export interface LynxCompilerProgramValue {
	readonly $$kind: symbol;
	readonly program: LynxCompilerProgram;
	readonly values: readonly unknown[];
	readonly computations: readonly LynxCompilerProgramComputation[];
}

const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;

function fail(message: string): never {
	throw new TypeError(
		DEVELOPMENT ? `Octane Lynx compiler program: ${message}.` : 'Octane Lynx OL500',
	);
}

function deepFreeze(value: unknown, seen = new WeakSet<object>()): void {
	if (value === null || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	for (const key of Object.keys(value as Record<string, unknown>)) {
		deepFreeze((value as Record<string, unknown>)[key], seen);
	}
	Object.freeze(value);
}

function frozenAddress(address: UniversalProgramAddress): UniversalProgramAddress {
	if (
		address === null ||
		typeof address !== 'object' ||
		typeof address.module !== 'string' ||
		address.module === '' ||
		!Number.isSafeInteger(address.index) ||
		address.index < 0 ||
		typeof address.digest !== 'string' ||
		address.digest === ''
	) {
		return fail('a definition requires a non-empty module/digest and non-negative integer index');
	}
	return Object.freeze({
		module: address.module,
		index: address.index,
		digest: address.digest,
	});
}

/** Adopt one compiler-emitted definition at module evaluation time. */
export function lynxProgram(
	renderer: string,
	definition: LynxCompilerProgramDefinition,
): LynxCompilerProgram {
	if (renderer !== 'lynx') fail(`renderer ${JSON.stringify(renderer)} is not "lynx"`);
	if (definition === null || typeof definition !== 'object') fail('definition must be an object');
	if (definition.version !== LYNX_COMPILER_PROGRAM_VERSION) {
		fail(
			`expected ABI version ${LYNX_COMPILER_PROGRAM_VERSION}, received ${String(definition.version)}`,
		);
	}
	if (definition.wire === null || typeof definition.wire !== 'object') {
		fail('definition requires a wire program');
	}
	if (
		!Array.isArray(definition.values) ||
		!Array.isArray(definition.events) ||
		!Array.isArray(definition.ranges)
	) {
		fail('definition requires value, event, and range maps');
	}
	if (definition.refs !== undefined) {
		if (LYNX_COMPILED_PROGRAM_HOST_REFS) {
			if (
				!Array.isArray(definition.refs) ||
				definition.refs.some(
					(ref) =>
						ref === null ||
						typeof ref !== 'object' ||
						!Number.isSafeInteger(ref.node) ||
						ref.node < 0 ||
						ref.node >= definition.wire.nodes.length ||
						!Number.isSafeInteger(ref.slot) ||
						ref.slot < 0,
				)
			) {
				fail('definition contains an invalid host-ref site');
			}
		} else {
			fail('definition reached a bundle compiled without host-ref support');
		}
	}
	const program = {
		$$kind: LYNX_COMPILER_PROGRAM,
		renderer,
		version: LYNX_COMPILER_PROGRAM_VERSION,
		address: frozenAddress(definition.address),
		wire: definition.wire,
		values: definition.values,
		events: definition.events,
		ranges: definition.ranges,
		...(LYNX_COMPILED_PROGRAM_HOST_REFS && definition.refs !== undefined
			? { refs: definition.refs }
			: null),
	} satisfies LynxCompilerProgram;
	deepFreeze(program);
	return program;
}

/** Pair a module-scope program definition with one render's slot values. */
export function lynxProgramValue(
	program: LynxCompilerProgram,
	values: readonly unknown[] = [],
	computations: readonly LynxCompilerProgramComputation[] = [],
): LynxCompilerProgramValue {
	if (!isLynxCompilerProgram(program)) fail('lynxProgramValue expected a compiler program');
	if (!Array.isArray(values)) fail('lynxProgramValue expected an array of slot values');
	if (!Array.isArray(computations)) fail('lynxProgramValue expected an array of computations');
	if (LYNX_COMPILED_PROGRAM_HOST_REFS && program.refs?.some((ref) => ref.slot >= values.length)) {
		fail('lynxProgramValue received a host-ref slot outside its value array');
	}
	if (DEVELOPMENT) {
		const rangeSlots = new Set(program.ranges.map((range) => range.slot));
		for (const computation of computations) {
			const replayableStructural =
				computation !== null &&
				typeof computation === 'object' &&
				computation.kind === 'structural' &&
				computation.purity === 'descriptor-pure';
			if (
				computation === null ||
				typeof computation !== 'object' ||
				!Array.isArray(computation.sources) ||
				(computation.kind !== 'scalar' && computation.kind !== 'structural') ||
				(computation.kind === 'structural'
					? computation.purity !== 'unknown' && computation.purity !== 'descriptor-pure'
					: computation.purity !== 'pure') ||
				computation.escape !== 'component-render' ||
				computation.sources.length === 0 ||
				computation.sources.some((source: unknown) => typeof source !== 'function') ||
				!Array.isArray(computation.slots) ||
				computation.slots.length === 0 ||
				computation.slots.some(
					(slot: unknown) =>
						typeof slot !== 'number' ||
						!Number.isSafeInteger(slot) ||
						slot < 0 ||
						slot >= values.length,
				) ||
				computation.slots.some(
					(slot: number) => rangeSlots.has(slot) !== (computation.kind === 'structural'),
				) ||
				((computation.kind === 'scalar' || replayableStructural) &&
					typeof computation.run !== 'function') ||
				(computation.kind === 'structural' &&
					computation.purity === 'unknown' &&
					computation.run !== undefined)
			) {
				fail(
					'each computation requires valid kind/purity/escape metadata, source getters, value slots, and an exact replay function shape',
				);
			}
		}
	}
	return { $$kind: LYNX_COMPILER_PROGRAM_VALUE, program, values, computations };
}

export function isLynxCompilerProgram(value: unknown): value is LynxCompilerProgram {
	return (value as { $$kind?: unknown } | null)?.$$kind === LYNX_COMPILER_PROGRAM;
}

export function isLynxCompilerProgramValue(value: unknown): value is LynxCompilerProgramValue {
	return (value as { $$kind?: unknown } | null)?.$$kind === LYNX_COMPILER_PROGRAM_VALUE;
}
