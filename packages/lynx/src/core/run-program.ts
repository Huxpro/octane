/**
 * Issue-#246 E1 — the background's half of resolving an addressed run.
 *
 * Under E1 a run command may name a program instead of carrying it, which
 * removes the descriptor from the wire. What it does not remove is this
 * background's own need for one: the driver stages ids from the program's node
 * count, the delta shadow sizes the same run, the transport asks whether the
 * batch is compact-acknowledgeable. All three read the batch this background is
 * still composing, before anything is serialized.
 *
 * So this side never looks a program up by name. It asks the universal core for
 * the program its own producer lowered for that exact command object, which is
 * both cheaper and more precise than an address: two roots in one background
 * rendering the same component hold two structurally identical wire objects for
 * one address, and each command means its own.
 *
 * The main thread answers the same question from residency instead — see
 * `program-registry.ts`, which is deliberately absent from this graph.
 */

import {
	recordUniversalProgramCommand,
	universalProgramCommandWire,
	type UniversalHostCommand,
	type UniversalHostProgramManifest,
	type UniversalHostTemplateProgram,
	type UniversalHostTemplateProgramValue,
} from 'octane/universal/native';

/**
 * The wire program a run command means, whichever way it named one.
 *
 * `undefined` only for an addressed command this background did not produce,
 * which is a batch that was built somewhere this realm cannot see. Callers
 * decline such a run rather than approximating it: the alternative to a program
 * is not a different program, it is no tree.
 */
export function producedRunProgram(
	command:
		| {
				readonly op: 'mount-template-range' | 'mount-template-run';
				readonly program: UniversalHostTemplateProgram;
		  }
		| { readonly op: 'mount-program-run' | 'program-manifest' },
): UniversalHostTemplateProgram | undefined {
	if (command.op === 'mount-template-range' || command.op === 'mount-template-run') {
		return command.program;
	}
	return universalProgramCommandWire(command);
}

/**
 * Turn producer-local first-tree proof into the addressed command the peer can
 * execute if adoption declines.
 *
 * The command is a fresh object because `op` is part of both wire validation
 * and dispatch. Preserve the producer's command→program association on that
 * object: background self-checks still need the descriptor even though the
 * peer resolves only the address.
 */
export function promoteProducedProgramManifest(
	manifest: UniversalHostProgramManifest,
	values: readonly UniversalHostTemplateProgramValue[] = manifest.values,
): {
	readonly command: Extract<UniversalHostCommand, { readonly op: 'mount-program-run' }>;
	readonly program: UniversalHostTemplateProgram;
} | null {
	const program = universalProgramCommandWire(manifest);
	if (program === undefined) return null;
	const command = Object.freeze({
		op: 'mount-program-run' as const,
		parent: manifest.parent,
		before: manifest.before,
		address: manifest.address,
		firstId: manifest.firstId,
		firstListenerId: manifest.firstListenerId,
		count: manifest.count,
		values,
	});
	recordUniversalProgramCommand(command, program);
	return Object.freeze({ command, program });
}
