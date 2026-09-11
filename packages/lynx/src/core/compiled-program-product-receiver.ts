declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalTransportIdentity } from 'octane/universal/native';

import { applyLynxCompiledProgramFrame } from './compiled-program-frame.js';
import {
	decodeLynxCompiledProgramBackgroundMessage,
	encodeLynxCompiledProgramMainMessage,
	LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT,
	LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT,
} from './compiled-program-wire.js';
import { createLynxCompiledProgramStore } from './compiled-program-store.js';
import type { LynxElementRef } from './papi.js';
import type {
	InstallLynxCompiledProgramReceiverOptions,
	LynxCompiledProgramReceiver,
} from './compiled-program-receiver.js';
import type { LynxContextProxyEvent } from './protocol.js';
import {
	acceptLynxTransportFrame,
	createLynxTransportFrameState,
	frameLynxTransportValue,
} from './transport-codec.js';

const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const CODE = 'Octane Lynx OL495';
const MAX_CLOSE_CLEANUP_ATTEMPTS = 3;

/** Generated-build receiver with framing, settlement, and page ownership in one closure. */
export function installLynxCompiledProgramProductReceiver<Node extends LynxElementRef>(
	options: InstallLynxCompiledProgramReceiverOptions<Node>,
): LynxCompiledProgramReceiver {
	const { context, page, papi } = options;
	if (
		context === null ||
		typeof context !== 'object' ||
		typeof context.dispatchEvent !== 'function' ||
		typeof context.addEventListener !== 'function' ||
		typeof context.removeEventListener !== 'function'
	) {
		throw new TypeError(DEVELOPMENT ? 'Invalid compact ContextProxy.' : CODE);
	}

	const inbound = createLynxTransportFrameState();
	let sequence = 1;
	let readiness = options.pageReady === true ? 1 : 0;
	let readyRequest: number | null = null;
	let store = null as ReturnType<typeof createLynxCompiledProgramStore<Node>> | null;
	let active: UniversalTransportIdentity | null = null;
	let aborted: UniversalTransportIdentity | null = null;
	let disposed: UniversalTransportIdentity | null = null;
	let busy = false;
	let faulted = false;
	let closed = false;

	const report = (value: unknown): Error => {
		const error =
			value instanceof Error ? value : new Error(value === undefined ? CODE : String(value));
		try {
			options.onDiagnostic?.(error);
		} catch {}
		return error;
	};
	const release = (candidate: NonNullable<typeof store>): void => {
		for (let attempt = 0; attempt < MAX_CLOSE_CLEANUP_ATTEMPTS; attempt++) {
			try {
				candidate.dispose();
				return;
			} catch (error) {
				report(error);
			}
		}
	};
	const send = (message: Parameters<typeof encodeLynxCompiledProgramMainMessage>[0]): boolean => {
		try {
			const encoded = encodeLynxCompiledProgramMainMessage(message);
			const frames = frameLynxTransportValue(encoded, sequence++);
			for (const data of frames) {
				context.dispatchEvent({ type: LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT, data });
			}
			return true;
		} catch (error) {
			faulted = true;
			report(error);
			return false;
		}
	};
	const same = (left: UniversalTransportIdentity, right: UniversalTransportIdentity): boolean =>
		left.root === right.root &&
		left.renderer === right.renderer &&
		left.version === right.version &&
		left.protocol === right.protocol;
	const reject = (identity: UniversalTransportIdentity, value: unknown): void => {
		const error = report(value);
		send({ ...identity, type: 'reject', error: { name: error.name, message: error.message } });
	};
	const publishReady = (): void => {
		if (!closed && readyRequest !== null && readiness === 3) {
			if (send({ type: 'ready', request: readyRequest })) readiness = 4;
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
			if (readyRequest !== null && readyRequest !== message.request) report(CODE);
			else {
				readyRequest = message.request;
				publishReady();
			}
			return;
		}
		if (readiness !== 4) {
			report(CODE);
			return;
		}
		if (message.type === 'abort') {
			if (
				faulted ||
				(active !== null && (message.root !== active.root || message.version <= active.version))
			) {
				report(CODE);
			} else aborted = message;
			return;
		}
		if (message.type === 'dispose' || message.type === 'terminal-dispose') {
			if (busy) {
				report(CODE);
				return;
			}
			if (active === null) {
				if (
					message.type !== 'terminal-dispose' &&
					(disposed === null || !same(disposed, message))
				) {
					report(CODE);
					return;
				}
			} else if (
				message.root !== active.root ||
				message.renderer !== active.renderer ||
				(message.type === 'terminal-dispose'
					? message.version < active.version
					: message.version !== active.version)
			) {
				report(CODE);
				return;
			}
			busy = true;
			try {
				store?.dispose();
			} catch (error) {
				busy = false;
				const failure = report(error);
				send({
					...message,
					type: 'dispose-retry',
					error: { name: failure.name, message: failure.message },
				});
				return;
			}
			busy = false;
			store = null;
			active = null;
			aborted = null;
			disposed = message;
			send({ ...message, type: 'dispose-ack' });
			return;
		}
		if (message.type !== 'frame') return;
		if (
			faulted ||
			busy ||
			disposed?.root === message.root ||
			(active === null
				? message.version !== 1
				: message.root !== active.root ||
					message.renderer !== active.renderer ||
					message.version !== active.version + 1)
		) {
			reject(message, CODE);
			return;
		}
		if (aborted !== null && same(aborted, message)) {
			aborted = null;
			reject(message, CODE);
			return;
		}
		const candidate =
			store ?? createLynxCompiledProgramStore(papi, papi.getUniqueId(page), message.root);
		busy = true;
		try {
			applyLynxCompiledProgramFrame(candidate, page, options.resolveProgram, message.frame, () => {
				if (closed) throw new Error(CODE);
				if (aborted !== null && same(aborted, message)) {
					aborted = null;
					throw new Error(CODE);
				}
			});
		} catch (error) {
			busy = false;
			if (closed) {
				release(candidate);
				store = null;
				active = null;
				aborted = null;
				if (candidate.isFaulted()) report(error);
				return;
			}
			if (candidate.isFaulted()) {
				store = candidate;
				active = message;
				faulted = true;
				const failure = report(error);
				send({
					...message,
					type: 'fault',
					error: { name: failure.name, message: failure.message },
				});
			} else reject(message, error);
			return;
		}
		busy = false;
		if (closed) {
			release(candidate);
			store = null;
			active = null;
			aborted = null;
			return;
		}
		store = candidate;
		active = message;
		if (send({ ...message, type: 'ack' })) send({ ...message, type: 'complete' });
	};

	context.addEventListener(LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT, onMessage);
	const mark = (gate: number): void => {
		if (!closed && readiness <= 3 && (readiness & gate) === 0) {
			readiness |= gate;
			publishReady();
		}
	};
	return {
		markProgramsReady: () => mark(2),
		markPageReady: () => mark(1),
		destroyPage() {
			if (closed) return;
			send({ type: 'page-destroy' });
			closed = true;
			if (!busy && store !== null) release(store);
			store = null;
			active = null;
			aborted = null;
			context.removeEventListener(LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT, onMessage);
		},
		close() {
			if (closed || busy) return;
			store?.dispose();
			closed = true;
			context.removeEventListener(LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT, onMessage);
		},
	};
}
