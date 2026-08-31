/**
 * Issue-#246 E1 — the main thread's name→program registry.
 *
 * ## Why this exists
 *
 * The first-screen join needs no addressing at all: the main thread renders, so
 * the applier holds the `UniversalProgramPlan` object and keys its bound creates
 * on it directly. E1 inverts the direction — the *background* renders a keyed
 * range and asks the main thread to instantiate a resident compiled program —
 * and the moment it does, the background has to say which program it means.
 *
 * A plan cannot travel: `bind` is a function, so it is realm-local by
 * construction. What travels is the plan's address, and this is the only thing
 * on the main thread that can turn one back into the plan it names.
 *
 * ## Why registration is a module-scope side effect
 *
 * A registry populated by painting would only ever hold programs the first
 * screen already painted, and the mounts E1 serves are exactly the ones the
 * first screen did not: a range revealed by a tap, a list that grew. So the
 * main-thread chunk registers every addressed program when the module that
 * declares it evaluates, which is the same moment the plan itself comes into
 * existence — `universalPlan` is the call the compiler already emits at module
 * scope, so nothing new appears in the chunk but the address arguments.
 *
 * ## Why this module holds no runtime import from the universal core
 *
 * `runtime-compatibility.test.ts` pins the main-thread runtime graph at zero
 * package dependencies, which is the whole of #163's bundle claim: the MTS chunk
 * does not ship the universal core. The type below is erased, and the key and
 * the descriptor walk are a dozen lines, so owning them here costs less than the
 * dependency would. The background answers the same question from the command
 * object its own producer lowered — see `run-program.ts`, which is absent from
 * this graph for the mirrored reason.
 *
 * ## Why a wrong resolution is impossible rather than unlikely
 *
 * The address is positional, so it says nothing about what it points at. That is
 * paid for at build time, not here: both compiles emit a structural digest over
 * exactly the derived wire surface, and a build whose two layers disagree about
 * the *n*th plan of a module fails. By the time a chunk runs, agreement is a
 * property of the build that produced it.
 *
 * What this still refuses is the case that survives a correct build: an address
 * naming a module the main-thread chunk never evaluated, or an index past what
 * that module declared. Those resolve to nothing, and the caller declines the
 * mount rather than approximating it.
 */

import type { UniversalHostTemplateProgram, UniversalProgramPlan } from 'octane/universal/native';

/** One address, as a run command carries it. */
export interface LynxProgramAddress {
	readonly module: string;
	readonly index: number;
}

/**
 * Every addressed program this realm holds.
 *
 * Module scope, not per-root: a program belongs to the chunk that compiled it,
 * and two roots in one realm rendering the same component mean the same program.
 * Entries live as long as the chunk does, which is what makes a resolution one
 * map lookup with no lifetime question attached to it.
 */
const RESIDENT_PROGRAMS = new Map<string, UniversalProgramPlan>();

/** One string key per address. A \u0000 cannot appear in a module path. */
function addressKey(module: string, index: number): string {
	return `${module}\u0000${index}`;
}

/**
 * Record one compiled program under the name the background will use for it.
 *
 * Re-registering the same address with the same plan is a no-op, because a
 * module evaluated twice — HMR, a chunk loaded under two ids — is an ordinary
 * event and not a drift signal. Re-registering it with a *different* plan is
 * not: it means two programs answer to one name, and whichever mount arrives
 * second would paint a plausible wrong tree. That is the failure this refuses.
 */
export function registerUniversalProgram(
	module: string,
	index: number,
	plan: UniversalProgramPlan,
): void {
	const key = addressKey(module, index);
	const existing = RESIDENT_PROGRAMS.get(key);
	if (existing !== undefined && existing !== plan) {
		throw new TypeError(
			`Two compiled main-thread programs claim the address ${module}#${index}. ` +
				'A program address is positional, so this means the two compiles of this ' +
				'module disagree about its plan order.',
		);
	}
	RESIDENT_PROGRAMS.set(key, plan);
	// The plan is what the first screen paints from; the wire is what a mount
	// arriving over the command path walks. Both are this one program, and a
	// chunk that registered a `bind` it could not also describe would accept an
	// addressed run and then have nothing to apply it with.
	if (plan.wire !== undefined) deepFreezeWire(plan.wire);
}

/**
 * Freeze the resident descriptor through, once, at registration.
 *
 * Not hygiene: `prepareTemplateProgram` and `assertTemplateProgram` both decline
 * to memoize a program they cannot prove immutable, and walk every node, prop
 * and binding again on each mount that names it. A resident program is one
 * object for the chunk's life, so that check is the difference between one walk
 * and one per mount — which is the entire point of naming a program instead of
 * sending it.
 *
 * The compiler emits the descriptor as an object literal, so freezing is some
 * caller's job either way, and here is the one place every addressed program
 * passes through. The walk is O(descriptor) once per program at module scope.
 */
function deepFreezeWire(value: unknown, seen = new WeakSet<object>()): void {
	if (value === null || typeof value !== 'object') return;
	if (seen.has(value)) return;
	seen.add(value);
	for (const key of Object.keys(value as Record<string, unknown>)) {
		deepFreezeWire((value as Record<string, unknown>)[key], seen);
	}
	Object.freeze(value);
}

/** The program registered under this address, or `undefined` for an unknown one. */
export function resolveUniversalProgram(
	module: string,
	index: number,
): UniversalProgramPlan | undefined {
	return RESIDENT_PROGRAMS.get(addressKey(module, index));
}

/**
 * How many programs this realm holds.
 *
 * The main thread advertises `addressedProgramRuns` from this rather than from
 * the protocol rung it speaks: understanding the op is free, and resolving an
 * address needs the main-thread chunk of a two-layer build. An isolated
 * `thread: 'main-thread'` graph registers nothing (issue #246 §6.3), so it says
 * so and the peer keeps sending descriptors instead of failing per mount.
 *
 * Deliberately not a way to enumerate them: nothing in the mount path should be
 * able to pick a program other than by the name it was given.
 */
export function residentUniversalProgramCount(): number {
	return RESIDENT_PROGRAMS.size;
}

/**
 * The wire program a run command means, whichever way it named one.
 *
 * The receiving half of the question `producedRunProgram` answers for a
 * background. Every consumer of a run — the validator counting its hosts, the
 * applier mounting them — asks it, and before E1 the answer was always "the
 * field on the command".
 *
 * `undefined` for an address this realm cannot resolve. Callers decline such a
 * mount rather than approximating it: the alternative to a program is not a
 * different program, it is no tree.
 */
export function residentRunProgram(
	command:
		| {
				readonly op: 'mount-template-range' | 'mount-template-run';
				readonly program: UniversalHostTemplateProgram;
		  }
		| { readonly op: 'mount-program-run'; readonly address: LynxProgramAddress },
): UniversalHostTemplateProgram | undefined {
	if (command.op !== 'mount-program-run') return command.program;
	const address = command.address;
	if (address === null || typeof address !== 'object') return undefined;
	if (typeof address.module !== 'string' || !Number.isSafeInteger(address.index)) return undefined;
	return resolveUniversalProgram(address.module, address.index)?.wire;
}

/**
 * Why an address did not resolve, said in terms of what the builder can change.
 *
 * A positional address is earned by a two-layer application build, because that
 * is the only shape in which one plugin configuration sees both compiles of a
 * module and can fail when they disagree. An isolated `thread: 'main-thread'`
 * graph has nothing to cross-check against, so it never emits an address at all
 * — which means an unresolvable one here is not that case. It is a chunk that
 * did not evaluate the module the address names, or named an index past what
 * that module declared.
 */
export function unresolvedProgramAddressMessage(
	label: string,
	address: LynxProgramAddress,
): string {
	return (
		`${label} names program ${address.module}#${address.index}, which this realm does not hold. ` +
		'An addressed run resolves against the programs its own chunk registered, and only a ' +
		'two-layer application build emits one; a single-thread graph keeps descriptor mounts.'
	);
}
