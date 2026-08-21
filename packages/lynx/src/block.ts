/**
 * Issue-#103 B0 — the Block core's authoring surface, on its own subpath.
 *
 * Everything here is also reachable from the package root, except for one
 * constraint that makes the root import unusable for an application entry:
 * `@octanejs/rspeedy-plugin` replaces the bare `@octanejs/lynx` request with
 * `@octanejs/lynx/first-screen` on the main-thread layer, and that facade
 * carries the first-screen API rather than this one. An entry module is
 * compiled into *both* layers, so an entry that reaches for the block surface
 * through the package root fails to link on the main-thread side. This subpath
 * is not rewritten, so it resolves to the same modules in both layers.
 *
 * That is a real cost and it is stated rather than hidden: the main-thread
 * bundle of an application that attaches a block program carries these modules
 * too, because the main-thread copy of the entry references them. Once the
 * compiler lowers components onto the Block core it will emit the program into
 * the background graph only, and the main-thread graph will stop seeing it. A
 * hand-written program has no such compiler, so it pays the bytes and reports
 * them (`benchmarks/lynx-table/README.md`).
 */

export { withLynxBlockProgram } from './core/block-program.js';
export type { LynxBlockProgram, LynxBlockProgramContext } from './core/block-program.js';
export { compileLynxBlockTemplate } from './core/block-core.js';
export type {
	LynxBlock,
	LynxBlockCore,
	LynxBlockForSlot,
	LynxBlockTemplate,
} from './core/block-core.js';
export type { LynxBlockListener, LynxBlockRoot } from './core/block-root.js';
