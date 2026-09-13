/**
 * Compiler-owned Lynx program IR shared by the background and main-thread
 * compiles.
 *
 * The two compiles must make one eligibility and addressing decision from the
 * same lowered surface. Keeping that surface versioned here, outside either
 * thread runtime, gives the compiler a boundary it can reject when a renderer
 * backend and compiler are out of step. The main-thread emitter consumes
 * `wire`; the background compile serializes that wire and its maps into the
 * Block program artifact. Neither output reconstructs the other's program at
 * runtime.
 */

import type { UniversalHostTemplateProgram } from 'octane/universal/native';
import type {
	PreparedUniversalTemplateProgramEvent,
	PreparedUniversalTemplateProgramValue,
	UniversalTemplateProgramRange,
} from 'octane/universal/template-program';

/** Increment only for an incompatible change to the shared IR shape. */
export const LYNX_PROGRAM_IR_VERSION = 1 as const;

/**
 * One plan lowered to the wire plus the maps both compiler outputs consume.
 *
 * `values` and `events` map plan slots to the resident create function's
 * positional parameters. `ranges` names structural holes the background
 * runtime owns instead of painting into the fixed wire. `addressable` is the
 * shared fail-closed eligibility answer for the independently built outputs.
 */
export interface LynxProgramRef {
	/** Resident host-node index whose authored `ref` value lives in `slot`. */
	readonly node: number;
	readonly slot: number;
}

export interface LynxProgramIR {
	readonly version: typeof LYNX_PROGRAM_IR_VERSION;
	readonly wire: UniversalHostTemplateProgram;
	readonly values: readonly PreparedUniversalTemplateProgramValue[];
	readonly events: readonly PreparedUniversalTemplateProgramEvent[];
	readonly ranges: readonly UniversalTemplateProgramRange[];
	/** Authored host refs, omitted so ref-free programs preserve their emitted shape. */
	readonly refs?: readonly LynxProgramRef[];
	/**
	 * Whether every remaining range is structural, so the fixed wire and the
	 * range topology together can name this program across the two build graphs.
	 */
	readonly addressable: boolean;
}
