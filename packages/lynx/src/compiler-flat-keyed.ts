import type { UniversalHostTemplateProgram } from 'octane/universal/native';

import {
	deriveLynxMainThreadProgram,
	deriveLynxProgramIR,
	emitLynxMainThreadProgram as emitDefaultLynxMainThreadProgram,
	LYNX_PROGRAM_IR_VERSION,
	LynxMainThreadEmitRefusal,
	type LynxMainThreadProgramRange,
} from './compiler/index.js';

export {
	deriveLynxMainThreadProgram,
	deriveLynxProgramIR,
	LYNX_PROGRAM_IR_VERSION,
	LynxMainThreadEmitRefusal,
};

/** Graph-proved backend marker consumed only by Octane's universal compiler. */
export const compactFlatKeyed = true as const;
export const signature = 'lynx-main-thread-program/35+flat-keyed/1';

export function emitLynxMainThreadProgram(
	program: UniversalHostTemplateProgram,
	options: {
		readonly name: string;
		readonly residentNodes?: readonly number[];
		readonly slotUpdates?: boolean;
		readonly structuralRuns?: boolean;
		readonly ranges?: readonly LynxMainThreadProgramRange[];
	},
) {
	return emitDefaultLynxMainThreadProgram(program, { ...options, compactCreate: true });
}
