export {
	deriveLynxElementTemplateProgram,
	deriveLynxMainThreadProgram,
	deriveLynxProgramIR,
	emitLynxMainThreadProgram,
	LYNX_PROGRAM_IR_VERSION,
	LynxMainThreadEmitRefusal,
} from './compiler/index.js';

export const elementTemplate = true as const;
export const signature = 'lynx-main-thread-program/31+element-template/5';
