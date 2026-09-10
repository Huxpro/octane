declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import { createLynxCompiledProgramController } from './compiled-program-controller.js';
import type { LynxCompiledProgramResolver } from './compiled-program-frame.js';
import {
	decodeLynxCompiledProgramBackgroundMessage,
	encodeLynxCompiledProgramMainMessage,
	LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT,
	LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT,
} from './compiled-program-wire.js';
import type { LynxElementPAPI, LynxElementRef } from './papi.js';
import type { LynxContextProxy, LynxContextProxyEvent } from './protocol.js';
import {
	acceptLynxTransportFrame,
	createLynxTransportFrameState,
	frameLynxTransportValue,
} from './transport-codec.js';

const RECEIVER_DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const RECEIVER_ERROR = 'Octane Lynx OL492';

export interface InstallLynxCompiledProgramReceiverOptions<Node extends LynxElementRef> {
	readonly context: LynxContextProxy;
	readonly page: Node;
	readonly papi: LynxElementPAPI<Node>;
	readonly resolveProgram: LynxCompiledProgramResolver;
	/** Web may mark PageConfig ready at installation; Native waits for `__RenderPage`. */
	readonly pageReady?: boolean;
	readonly onDiagnostic?: (error: Error) => void;
}

export interface LynxCompiledProgramReceiver {
	/** Authored main-thread imports have evaluated and registered every addressed program. */
	markProgramsReady(): void;
	/** Native PageConfig is installed and Element PAPI writes may begin. */
	markPageReady(): void;
	close(): void;
}

function normalizedError(value: unknown, fallback: string): Error {
	return value instanceof Error ? value : new Error(value === undefined ? fallback : String(value));
}

function validateContext(context: LynxContextProxy): void {
	if (
		context === null ||
		typeof context !== 'object' ||
		typeof context.dispatchEvent !== 'function' ||
		typeof context.addEventListener !== 'function' ||
		typeof context.removeEventListener !== 'function'
	) {
		throw new TypeError(
			RECEIVER_DEVELOPMENT
				? 'Octane Lynx compact receiver requires ContextProxy dispatchEvent/addEventListener/removeEventListener.'
				: RECEIVER_ERROR,
		);
	}
}

/**
 * Install the page-local main half of the compiled-program transport.
 *
 * Readiness has two independent gates because the generated receiver evaluates
 * before authored main-thread modules: their module initializers register the
 * program addresses, while Native exposes configured Element PAPI only after
 * `__RenderPage`. A correlated reply is withheld until both facts are true, so
 * background cannot race either boundary even when its ready request arrives
 * during bundle evaluation.
 */
export function installLynxCompiledProgramReceiver<Node extends LynxElementRef>(
	options: InstallLynxCompiledProgramReceiverOptions<Node>,
): LynxCompiledProgramReceiver {
	const { context } = options;
	validateContext(context);
	const inbound = createLynxTransportFrameState();
	let sequence = 1;
	let readiness = options.pageReady === true ? 1 : 0;
	let readyRequest: number | null = null;
	let readySent = false;
	let closed = false;

	const report = (value: unknown, fallback = RECEIVER_ERROR): Error => {
		const error = normalizedError(value, fallback);
		try {
			options.onDiagnostic?.(error);
		} catch {}
		return error;
	};

	const dispatch = (message: Parameters<typeof encodeLynxCompiledProgramMainMessage>[0]): void => {
		const encoded = encodeLynxCompiledProgramMainMessage(message);
		const frames = frameLynxTransportValue(encoded, sequence++);
		for (const data of frames) {
			context.dispatchEvent({ type: LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT, data });
		}
	};

	const controller = createLynxCompiledProgramController({
		page: options.page,
		papi: options.papi,
		resolveProgram: options.resolveProgram,
		respond: dispatch,
		onDiagnostic: options.onDiagnostic,
	});

	const publishReady = (): void => {
		if (closed || readySent || readyRequest === null || readiness !== 3) return;
		try {
			dispatch({ type: 'ready', request: readyRequest });
			readySent = true;
		} catch (error) {
			report(
				error,
				RECEIVER_DEVELOPMENT
					? 'Octane Lynx compact receiver could not publish readiness.'
					: RECEIVER_ERROR,
			);
		}
	};

	const onMessage = (event: LynxContextProxyEvent): void => {
		if (closed) return;
		let message;
		try {
			const encoded = acceptLynxTransportFrame(event.data, inbound);
			if (encoded === null) return;
			message = decodeLynxCompiledProgramBackgroundMessage(encoded);
		} catch (error) {
			report(error);
			return;
		}
		if (message.type === 'ready') {
			if (readyRequest !== null && readyRequest !== message.request) {
				report(
					new Error(
						RECEIVER_DEVELOPMENT
							? 'Octane Lynx compact receiver received a second ready identity.'
							: RECEIVER_ERROR,
					),
				);
				return;
			}
			readyRequest = message.request;
			publishReady();
			return;
		}
		if (!readySent) {
			report(
				new Error(
					RECEIVER_DEVELOPMENT
						? 'Octane Lynx compact receiver received work before readiness.'
						: RECEIVER_ERROR,
				),
			);
			return;
		}
		if (message.type === 'frame') controller.apply(message, message.frame);
		else if (message.type === 'abort') controller.abort(message);
		else controller.dispose(message, message.type === 'terminal-dispose');
	};

	context.addEventListener(LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT, onMessage);
	const markReady = (gate: number): void => {
		if (closed || (readiness & gate) !== 0) return;
		readiness |= gate;
		publishReady();
	};

	return Object.freeze({
		markProgramsReady: () => markReady(2),
		markPageReady: () => markReady(1),
		close() {
			if (closed) return;
			controller.close();
			closed = true;
			context.removeEventListener(LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT, onMessage);
		},
	});
}
