import type { LynxFirstScreenRenderResult } from '../main-renderer-product.js';
import type { LynxCompiledProgramReceiver } from './compiled-program-receiver.js';
import type { LynxContextProxy } from './protocol.js';

export interface InstallLynxCompiledProgramNativeOwnerOptions {
	readonly target: object;
	readonly context: LynxContextProxy;
	readonly pageReady?: boolean;
	readonly firstScreen?: boolean;
	readonly onDiagnostic?: (error: Error) => void;
	readonly onReady: () => void;
}

export interface LynxCompiledProgramNativeOwner {
	readonly receiver: LynxCompiledProgramReceiver;
	paintFirstScreen(result: LynxFirstScreenRenderResult): void;
	disposeFirstScreen(): void;
}

export type InstallLynxCompiledProgramNativeOwner = (
	options: InstallLynxCompiledProgramNativeOwnerOptions,
) => LynxCompiledProgramNativeOwner;
