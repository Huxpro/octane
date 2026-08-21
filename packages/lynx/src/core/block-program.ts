/**
 * Issue-#103 B0 — what a component lowered onto the Block core is, and how a
 * component carries one.
 *
 * Deliberately its own module with no value import of the core: an application
 * that attaches a program still builds with `core: 'universal'`, and must not
 * drag `block-core.ts` and `block-root.ts` into that bundle for the sake of a
 * marker. Everything the context names is a type-only import, so the flag-off
 * bundle carries this file's two functions and nothing else.
 *
 * The program shape is what a compiler lowering will emit once the Block core
 * has hook cells (#103 U2's missing component layer). Until then a hand-written
 * program is the only producer, and a hand-written program is an architecture
 * floor rather than a framework measurement — see `block-background.ts`.
 */

import type { UniversalHostBatch } from 'octane/universal/native';
import type { LynxComponent } from '../intrinsics.js';
import type { LynxClientContainer } from './client-driver.js';
import type { LynxBlockCore } from './block-core.js';
import type { LynxBlockRoot } from './block-root.js';

/** Everything a block program is handed to drive one root. */
export interface LynxBlockProgramContext {
	readonly root: LynxBlockRoot;
	readonly core: LynxBlockCore;
	readonly container: LynxClientContainer;
	/**
	 * Send whatever the core has accumulated as one transported commit. Resolves
	 * with `null` when nothing changed, which sends no frame rather than an
	 * empty one.
	 */
	commit(): Promise<UniversalHostBatch | null>;
}

/**
 * A component lowered onto the Block core.
 *
 * `mount` runs once per `render`; `update` runs for a later `render` of the
 * same component with new props, and a program that omits it declines to be
 * re-rendered rather than silently ignoring the new props. `unmount` runs
 * before the root tears the transport down, which is the window in which a
 * program must release listeners it bound (see `LynxBlockRoot.releaseListeners`
 * and `block-core.ts`'s `departed` callback).
 */
export interface LynxBlockProgram<Props = unknown> {
	mount(context: LynxBlockProgramContext, props: Props): void | Promise<void>;
	update?(context: LynxBlockProgramContext, props: Props): void | Promise<void>;
	unmount?(context: LynxBlockProgramContext): void | Promise<void>;
}

const LYNX_BLOCK_PROGRAM = Symbol.for('octane.lynx.blockProgram');

interface LynxBlockProgramCarrier<Props> {
	[LYNX_BLOCK_PROGRAM]?: LynxBlockProgram<Props>;
}

/**
 * Attach a block program to a component without changing what the component is.
 *
 * The component is returned unchanged apart from the attachment, so a bundle
 * built with the universal core renders it exactly as it would have. Only a
 * bundle built with `core: 'block'` reads the attachment.
 */
export function withLynxBlockProgram<Props>(
	component: LynxComponent<Props>,
	program: LynxBlockProgram<Props>,
): LynxComponent<Props> {
	if (typeof component !== 'function') {
		throw new TypeError('withLynxBlockProgram expects a component function.');
	}
	if (program === null || typeof program !== 'object' || typeof program.mount !== 'function') {
		throw new TypeError('withLynxBlockProgram expects a block program with a mount().');
	}
	Object.defineProperty(component, LYNX_BLOCK_PROGRAM, {
		value: program,
		configurable: true,
	});
	return component;
}

/** Read the block program a component carries, if it carries one. */
export function readLynxBlockProgram<Props>(
	component: LynxComponent<Props>,
): LynxBlockProgram<Props> | undefined {
	return (component as unknown as LynxBlockProgramCarrier<Props>)[LYNX_BLOCK_PROGRAM];
}
