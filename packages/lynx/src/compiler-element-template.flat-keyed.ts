export {
	compactFlatKeyed,
	deriveLynxMainThreadProgram,
	deriveLynxProgramIR,
	emitLynxMainThreadProgram,
	LYNX_PROGRAM_IR_VERSION,
	LynxMainThreadEmitRefusal,
} from './compiler-flat-keyed.js';
export { deriveLynxStructuralElementTemplateProgram as deriveLynxElementTemplateProgram } from './compiler/index.js';

export const elementTemplate = true as const;
export const signature = 'lynx-main-thread-program/35+element-template-flat-keyed/1';
