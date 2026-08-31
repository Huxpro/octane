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

import {
	resolveUniversalProgramWire,
	universalProgramAddressKey,
	type UniversalHostProgramAddress,
	type UniversalProgramPlan,
} from 'octane/universal/native';

/**
 * Every addressed program this realm holds.
 *
 * Module scope, not per-root: a program belongs to the chunk that compiled it,
 * and two roots in one realm rendering the same component mean the same program.
 * Entries live as long as the chunk does, which is what makes a resolution one
 * map lookup with no lifetime question attached to it.
 */
const RESIDENT_PROGRAMS = new Map<string, UniversalProgramPlan>();

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
	const key = universalProgramAddressKey(module, index);
	const existing = RESIDENT_PROGRAMS.get(key);
	if (existing !== undefined && existing !== plan) {
		throw new TypeError(
			`Two compiled main-thread programs claim the address ${module}#${index}. ` +
				'A program address is positional, so this means the two compiles of this ' +
				'module disagree about its plan order.',
		);
	}
	RESIDENT_PROGRAMS.set(key, plan);
}

/** The program registered under this address, or `undefined` for an unknown one. */
export function resolveUniversalProgram(
	module: string,
	index: number,
): UniversalProgramPlan | undefined {
	return RESIDENT_PROGRAMS.get(universalProgramAddressKey(module, index));
}

/**
 * How many programs this realm holds.
 *
 * For tests and diagnostics. Deliberately not a way to enumerate them: nothing
 * in the mount path should be able to pick a program other than by the name it
 * was given.
 */
export function residentUniversalProgramCount(): number {
	return RESIDENT_PROGRAMS.size;
}

/**
 * The wire program a run command means, whichever way it named one.
 *
 * Every consumer of a run — the background driver staging its ids, the
 * validator counting its hosts, the applier mounting them — asks the same
 * question, and before E1 the answer was always "the field on the command". An
 * addressed run answers it from the realm's own registry instead, so the four
 * call sites stay one question with one answer rather than growing a second
 * shape each has to handle.
 *
 * `undefined` for an address this realm cannot resolve. Callers decline such a
 * mount rather than approximating it: the alternative to a program is not a
 * different program, it is no tree.
 */
export function runCommandProgram(
	command:
		| { readonly op: 'mount-template-range' | 'mount-template-run'; readonly program: unknown }
		| { readonly op: 'mount-program-run'; readonly address: UniversalHostProgramAddress },
): unknown {
	if (command.op === 'mount-program-run') {
		const address = command.address;
		if (address === null || typeof address !== 'object') return undefined;
		if (typeof address.module !== 'string' || !Number.isSafeInteger(address.index)) {
			return undefined;
		}
		return resolveUniversalProgramWire(address.module, address.index);
	}
	return command.program;
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
	address: UniversalHostProgramAddress,
): string {
	return (
		`${label} names program ${address.module}#${address.index}, which this realm does not hold. ` +
		'An addressed run resolves against the programs its own chunk registered, and only a ' +
		'two-layer application build emits one; a single-thread graph keeps descriptor mounts.'
	);
}
