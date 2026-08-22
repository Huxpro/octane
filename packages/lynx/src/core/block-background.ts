/**
 * Issue-#103 B0 — the Block core standing where the universal core stands, on
 * the background side of a real Lynx root.
 *
 * `block-root.ts` proved the core's frames survive the real transport.
 * `block-core.ts` proved the Block model emits a change-proportional update.
 * Neither of them is reachable from an application: `createLynxRoot` builds a
 * universal root, and nothing under `packages/lynx/src` referenced either
 * module. This is the seam that makes the choice real — selected at build time
 * by `@octanejs/rspeedy-plugin`'s `core` option, never per root.
 *
 * ## What flag-on can and cannot drive today, stated plainly
 *
 * Two things can be a program here, in this order.
 *
 * A component may **carry** one, attached by `withLynxBlockProgram`. That is
 * what a hand-written benchmark fixture supplies, and it stays first because it
 * is the explicit answer: a component that says what it is on the Block core is
 * never second-guessed by a derivation. A hand-written program is an
 * architecture floor, not a framework measurement, exactly as
 * `benchmarks/lynx-table/block-workload.ts` says of its own; any number
 * produced through one must carry that label.
 *
 * A compiled component that carries nothing is **derived** — `block-component.ts`
 * runs its setup, lowers the plan it returns to a template program, and makes
 * its slot values the block's values. That covers the components whose setup
 * needs no hook runtime; a hooked one and a keyed range site are refused there
 * by name, because a bundle that silently rendered nothing would be far worse
 * than one that says which piece it lacks. Deriving is what makes a number from
 * this core a framework measurement rather than a floor, for the shapes it
 * reaches.
 *
 * Either way a single application entry — `root.render(App)` — is driven by the
 * universal core with the flag off and by the Block core with the flag on,
 * which is what makes an A/B between the two cores a single-variable comparison
 * rather than two applications that merely resemble each other.
 *
 * ## The borrowed transport root id stops being borrowed
 *
 * `block-root.ts` records that `universal-core.ts` mints transport root ids
 * from a module-private counter it does not export, so a second core in one
 * page could collide with it silently. The compile-time switch resolves that
 * rather than working around it: a bundle carries exactly one core, so the two
 * allocators are never in the same page, and this module can mint from its own
 * counter without a collision to avoid.
 */

import type {
	UniversalComponent,
	UniversalHostBatch,
	UniversalPreparedAttempt,
	UniversalTransaction,
	UniversalTransportEventMessage,
} from 'octane/universal/native';
import type { LynxComponent } from '../intrinsics.js';
import { lynxClientTemplateRunsNegotiated, type LynxClientContainer } from './client-driver.js';
import { createLynxBlockCore, type LynxBlockCore } from './block-core.js';
import { lynxBlockProgramForComponent } from './block-component.js';
import { createLynxBlockRoot } from './block-root.js';
import {
	readLynxBlockProgram,
	type LynxBlockProgram,
	type LynxBlockProgramContext,
} from './block-program.js';
import { LYNX_TRANSPORT_RENDERER } from './protocol.js';
import type { LynxBackgroundTransport } from './transport.js';

/**
 * The members `root.ts` uses from whichever core the bundle carries.
 *
 * A structural interface rather than a class hierarchy: `UniversalRoot`
 * satisfies it as authored, so selecting the universal core costs nothing and
 * changes nothing about the path this replaces.
 */
export interface LynxBackgroundCore {
	renderAsync(component: UniversalComponent<any>, props: any): Promise<UniversalPreparedAttempt>;
	flushTransport(): Promise<void>;
	unmountAsync(): Promise<void>;
	dispatchTransportEvent(message: UniversalTransportEventMessage): readonly unknown[];
}

export interface LynxBlockBackgroundCoreOptions {
	readonly container: LynxClientContainer;
	readonly transport: LynxBackgroundTransport;
	/** Bring your own core and root id, primarily so a test can pin allocators. */
	readonly core?: LynxBlockCore;
	readonly transportRoot?: number;
}

// See the header: with one core per bundle there is no second allocator to
// collide with, so this counter is the whole of the identity discipline the
// block root needs from its caller.
let NEXT_BLOCK_TRANSPORT_ROOT = 1;

/** The frame a render that changed nothing did not send. */
const EMPTY_LYNX_BATCH: UniversalHostBatch = Object.freeze({
	renderer: LYNX_TRANSPORT_RENDERER,
	version: 0,
	commands: Object.freeze([]),
});

function committedTransaction(batch: UniversalHostBatch | null): UniversalTransaction {
	// The block path commits inside `render`, exactly as the universal path does
	// on an asynchronous transport, so what comes back is a settled transaction.
	// `commit`/`abort` are the synchronous channel of a transaction that has not
	// been sent yet; they refuse rather than pretending to re-run a sent commit.
	const settled: UniversalTransaction = {
		status: 'committed',
		// A render that changed nothing sends no frame. The transaction still has
		// to answer `batch`, so it answers with the empty frame that was not sent.
		batch: batch ?? EMPTY_LYNX_BATCH,
		commit() {
			throw new Error('Octane Lynx block commits are asynchronous; this batch is already sent.');
		},
		commitAsync() {
			return Promise.resolve();
		},
		abort() {
			throw new Error('Octane Lynx block root cannot abort a batch the host has accepted.');
		},
	};
	return Object.freeze(settled);
}

/**
 * Create the background core a `core: 'block'` bundle drives its root with.
 *
 * One `LynxBlockRoot` over the caller's real transport and container: same
 * identity discipline, same outbound self-check, same acknowledgement
 * handshake, same inbound event routing. Only render is different, because
 * only render is what the Block core does not have yet.
 */
export function createLynxBlockBackgroundCore(
	options: LynxBlockBackgroundCoreOptions,
): LynxBackgroundCore {
	const { container, transport } = options;
	// The negotiation the Block core has to respect, read per mount. A main
	// thread that painted a first screen keeps template runs dormant until the
	// background's first batch has adopted or repaired it, so the first commit
	// mounts in the legacy vocabulary and every later one is a run. Without this
	// the whole first mount is rejected as an unnegotiated template run and the
	// page never leaves its first screen.
	const core =
		options.core ??
		createLynxBlockCore({
			templateRuns: () => lynxClientTemplateRunsNegotiated(container),
		});
	const blockRoot = createLynxBlockRoot({
		container,
		transport,
		transportRoot: options.transportRoot ?? NEXT_BLOCK_TRANSPORT_ROOT++,
		core,
	});
	const context: LynxBlockProgramContext = Object.freeze({
		root: blockRoot,
		core,
		container,
		commit() {
			return blockRoot.commit();
		},
	});
	// A derived program holds the block it mounted, so it belongs to this core
	// rather than to the component: two roots rendering the same component are
	// two programs. The memo is load-bearing for identity, not economy —
	// deriving only builds closures (the component's setup runs per render
	// either way), but a second render handed a *fresh* program object would be
	// refused as a program swap by the mounted-program check below.
	const derived = new WeakMap<LynxComponent<unknown>, LynxBlockProgram<unknown>>();
	const programFor = (component: LynxComponent<unknown>): LynxBlockProgram<unknown> => {
		const carried = readLynxBlockProgram(component);
		if (carried !== undefined) return carried;
		let program = derived.get(component);
		if (program === undefined) {
			program = lynxBlockProgramForComponent(component);
			derived.set(component, program);
		}
		return program;
	};
	let mounted: LynxBlockProgram<never> | null = null;
	// Renders serialize. `mounted` is only assigned after `program.mount`
	// yields, so two un-awaited renderAsync calls would otherwise both read
	// `mounted === null` and mount the program twice over one page tree; the
	// universal core supports and coalesces exactly that calling pattern, so
	// the second render must instead run after the first and become an update.
	let renderQueue: Promise<unknown> = Promise.resolve();
	// Every commit this core starts, so `flushTransport` and `unmountAsync` wait
	// for work a program started and did not await rather than tearing the
	// transport down underneath it.
	let pending: Promise<unknown> = Promise.resolve();
	const track = <T>(work: Promise<T>): Promise<T> => {
		// allSettled rather than then: a caller that already handled a rejection
		// must not have it resurface out of an unrelated flushTransport().
		pending = Promise.allSettled([pending, work]);
		return work;
	};

	return Object.freeze({
		async renderAsync(
			component: UniversalComponent<any>,
			props: unknown,
		): Promise<UniversalTransaction> {
			const program = programFor(component as unknown as LynxComponent<unknown>);
			const run = renderQueue.then(async () => {
				if (mounted === null) {
					await program.mount(context, props);
					mounted = program as unknown as LynxBlockProgram<never>;
				} else if (mounted !== (program as unknown as LynxBlockProgram<never>)) {
					throw new Error('Octane Lynx block root cannot swap the program it mounted.');
				} else if (typeof program.update === 'function') {
					await program.update(context, props);
				} else {
					throw new Error(
						'Octane Lynx block program declined a re-render: it has no update(). ' +
							'A program that accepts new props must implement update().',
					);
				}
				return committedTransaction(await blockRoot.commit());
			});
			// A rejected render surfaces to its own caller through `run`; it must
			// not wedge every later render behind the same rejection.
			renderQueue = run.then(
				() => undefined,
				() => undefined,
			);
			return track(run);
		},

		async flushTransport() {
			await pending;
		},

		async unmountAsync() {
			await pending;
			if (mounted !== null && typeof mounted.unmount === 'function') {
				await mounted.unmount(context);
				mounted = null;
				await blockRoot.commit();
			}
		},

		dispatchTransportEvent(message: UniversalTransportEventMessage): readonly unknown[] {
			return blockRoot.dispatchTransportEvent(message);
		},
	});
}
