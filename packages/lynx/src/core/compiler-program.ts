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
}

export interface LynxCompilerProgram extends LynxCompilerProgramDefinition {
	readonly $$kind: symbol;
	readonly renderer: string;
}

export interface LynxCompilerProgramValue {
	readonly $$kind: symbol;
	readonly program: LynxCompilerProgram;
	readonly values: readonly unknown[];
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
	const program = {
		$$kind: LYNX_COMPILER_PROGRAM,
		renderer,
		version: LYNX_COMPILER_PROGRAM_VERSION,
		address: frozenAddress(definition.address),
		wire: definition.wire,
		values: definition.values,
		events: definition.events,
		ranges: definition.ranges,
	} satisfies LynxCompilerProgram;
	deepFreeze(program);
	return program;
}

/** Pair a module-scope program definition with one render's slot values. */
export function lynxProgramValue(
	program: LynxCompilerProgram,
	values: readonly unknown[] = [],
): LynxCompilerProgramValue {
	if (!isLynxCompilerProgram(program)) fail('lynxProgramValue expected a compiler program');
	if (!Array.isArray(values)) fail('lynxProgramValue expected an array of slot values');
	return { $$kind: LYNX_COMPILER_PROGRAM_VALUE, program, values };
}

export function isLynxCompilerProgram(value: unknown): value is LynxCompilerProgram {
	return (value as { $$kind?: unknown } | null)?.$$kind === LYNX_COMPILER_PROGRAM;
}

export function isLynxCompilerProgramValue(value: unknown): value is LynxCompilerProgramValue {
	return (value as { $$kind?: unknown } | null)?.$$kind === LYNX_COMPILER_PROGRAM_VALUE;
}
