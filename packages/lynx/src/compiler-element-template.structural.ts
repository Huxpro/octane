export {
	deriveLynxMainThreadProgram,
	deriveLynxProgramIR,
	deriveLynxStructuralElementTemplateProgram as deriveLynxElementTemplateProgram,
	emitLynxMainThreadProgram,
	LYNX_PROGRAM_IR_VERSION,
	LynxMainThreadEmitRefusal,
} from './compiler/index.js';

export const elementTemplate = true as const;
export const signature = 'lynx-main-thread-program/35+element-template-structural/1';
