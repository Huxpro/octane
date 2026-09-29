import { fileURLToPath } from 'node:url';

// Serializable references keep Rspack worker compilation available. The
// loader verifies each signature against the loaded renderer backend.
export const DEFAULT_MAIN_THREAD_PROGRAM_BACKEND = Object.freeze({
	request: fileURLToPath(import.meta.resolve('@octanejs/lynx/compiler')),
	signature: 'lynx-main-thread-program/35',
});

/** Complete paired flat-keyed proof: compact resident metadata and one create body. */
export const FLAT_KEYED_MAIN_THREAD_PROGRAM_BACKEND = Object.freeze({
	request: fileURLToPath(import.meta.resolve('@octanejs/lynx/compiler/flat-keyed')),
	signature: 'lynx-main-thread-program/35+flat-keyed/1',
});

export const ELEMENT_TEMPLATE_MAIN_THREAD_PROGRAM_BACKEND = Object.freeze({
	request: fileURLToPath(import.meta.resolve('@octanejs/lynx/compiler/element-template')),
	signature: 'lynx-main-thread-program/35+element-template/6',
});

/**
 * Graph-proved backend whose plan and native definition both omit visibility.
 * It is never a user-selected default: finishMake installs it only after the
 * paired application graph proves structural Block semantics sufficient.
 */
export const STRUCTURAL_ELEMENT_TEMPLATE_MAIN_THREAD_PROGRAM_BACKEND = Object.freeze({
	request: fileURLToPath(
		import.meta.resolve('@octanejs/lynx/compiler/element-template/structural'),
	),
	signature: 'lynx-main-thread-program/35+element-template-structural/1',
});

/** Flat-keyed whole-root Template Definition backend with compact resident metadata. */
export const FLAT_KEYED_ELEMENT_TEMPLATE_MAIN_THREAD_PROGRAM_BACKEND = Object.freeze({
	request: fileURLToPath(
		import.meta.resolve('@octanejs/lynx/compiler/element-template/flat-keyed'),
	),
	signature: 'lynx-main-thread-program/35+element-template-flat-keyed/1',
});
