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
 * The Block core has no component layer. `block-root.ts` says so in its own
 * header: there is no `render(component, props)` because there are no hook
 * cells and therefore no program for a component to be. So a bundle built with
 * `core: 'block'` cannot run a compiled `.tsrx` component — and this module
 * refuses one with a diagnostic that says which piece is missing, rather than
 * rendering something partial.
 *
 * What it can run is a **block program**: the thing a compiler lowering will
 * eventually emit, and the thing a hand-written benchmark fixture can supply
 * today. `withLynxBlockProgram` attaches one to a component, so a single
 * application entry — `root.render(App)` — is driven by the universal core with
 * the flag off and by the Block core with the flag on. That is what makes an
 * A/B between the two cores a single-variable comparison rather than two
 * applications that merely resemble each other.
 *
 * A hand-written program is an architecture floor, not a framework measurement,
 * exactly as `benchmarks/lynx-table/block-workload.ts` says of its own. Any
 * number produced through one must carry that label.
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

function missingComponentLayer(): never {
	throw new Error(
		'Octane Lynx was built with core: "block", which has no component layer yet ' +
			'(issue #103 U2: no hook cells, so a compiled component has no program to be). ' +
			'Render a component carrying a block program via withLynxBlockProgram(), or ' +
			'build with core: "universal".',
	);
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
			const program = readLynxBlockProgram(component as unknown as LynxComponent<unknown>);
			if (program === undefined) missingComponentLayer();
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
