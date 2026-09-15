import { fileURLToPath } from 'node:url';

// Serializable references keep Rspack worker compilation available. The
// loader verifies each signature against the loaded renderer backend.
export const DEFAULT_MAIN_THREAD_PROGRAM_BACKEND = Object.freeze({
	request: fileURLToPath(import.meta.resolve('@octanejs/lynx/compiler')),
	signature: 'lynx-main-thread-program/34',
});

export const ELEMENT_TEMPLATE_MAIN_THREAD_PROGRAM_BACKEND = Object.freeze({
	request: fileURLToPath(import.meta.resolve('@octanejs/lynx/compiler/element-template')),
	signature: 'lynx-main-thread-program/34+element-template/6',
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
	signature: 'lynx-main-thread-program/34+element-template-structural/1',
});
