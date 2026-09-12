/**
 * Compatibility surface for the original main-thread-named derivation hook.
 *
 * New compiler integrations consume the versioned, thread-neutral IR from
 * `ir.ts`. Keep the old result shape while experimental renderer backends
 * migrate: callers that do not know the IR version field see precisely the
 * wire/value/event/range contract they already consumed.
 */

import type { UniversalHostPlan } from 'octane/universal/native';

import { deriveLynxProgramIR } from './derive-program.js';
import type { LynxProgramIR } from './ir.js';

export type LynxMainThreadDerivation = Omit<LynxProgramIR, 'version'>;

/** @deprecated Use `deriveLynxProgramIR` for the shared, versioned compiler IR. */
export function deriveLynxMainThreadProgram(
	plan: UniversalHostPlan,
): LynxMainThreadDerivation | null {
	const ir = deriveLynxProgramIR(plan);
	if (ir === null) return null;
	const {
		// Intentionally stripped for exact compatibility with the original hook.
		version: _version,
		...derived
	} = ir;
	return Object.freeze(derived);
}
