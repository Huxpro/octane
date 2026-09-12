declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type {
	UniversalTransportAcknowledgement,
	UniversalTransportCompleteMessage,
	UniversalTransportError,
	UniversalTransportFaultMessage,
	UniversalTransportIdentity,
	UniversalTransportRejectMessage,
} from 'octane/universal/native';

import type {
	LynxDataLifecycleMessage,
	LynxGlobalPropsMessage,
	LynxLifecycleDataRecord,
	LynxPageDataMessage,
} from './lifecycle-types.js';
import type {
	LynxCompiledProgramDisposeAcknowledgement,
	LynxCompiledProgramDisposeRetry,
} from './compiled-program-controller.js';
import { LYNX_TRANSPORT_PROTOCOL_VERSION, LYNX_TRANSPORT_RENDERER } from './transport-identity.js';
import { decodeLynxTransportValue, encodeLynxTransportValue } from './transport-codec.js';

const WIRE_DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const WIRE_ERROR = 'Octane Lynx OL491';

const enum WireOpcode {
	Ready = 1,
	ReadyReply = 2,
	Frame = 3,
	Abort = 4,
	Dispose = 5,
	TerminalDispose = 6,
	Acknowledgement = 7,
	Complete = 8,
	Reject = 9,
	Fault = 10,
	DisposeAcknowledgement = 11,
	DisposeRetry = 12,
	PageDestroy = 13,
	PageReplace = 14,
	PageUpdate = 15,
	PageReset = 16,
	GlobalProps = 17,
}

export const LYNX_COMPILED_PROGRAM_BACKGROUND_TO_MAIN_EVENT =
	'octane-lynx:compiled-program-background-to-main';
export const LYNX_COMPILED_PROGRAM_MAIN_TO_BACKGROUND_EVENT =
	'octane-lynx:compiled-program-main-to-background';

export interface LynxCompiledProgramReadyRequest {
	readonly type: 'ready';
	readonly request: number;
}

export interface LynxCompiledProgramReadyReply {
	readonly type: 'ready';
	readonly request: number;
}

/** Root-independent native page lifetime teardown broadcast. */
export interface LynxCompiledProgramPageDestroyMessage {
	readonly type: 'page-destroy';
}

export interface LynxCompiledProgramFrameMessage extends UniversalTransportIdentity {
	readonly type: 'frame';
	readonly frame: readonly unknown[];
}

export interface LynxCompiledProgramAbortMessage extends UniversalTransportIdentity {
	readonly type: 'abort';
}

export interface LynxCompiledProgramDisposeMessage extends UniversalTransportIdentity {
	readonly type: 'dispose' | 'terminal-dispose';
}

export type LynxCompiledProgramBackgroundMessage =
	| LynxCompiledProgramReadyRequest
	| LynxCompiledProgramFrameMessage
	| LynxCompiledProgramAbortMessage
	| LynxCompiledProgramDisposeMessage;

export type LynxCompiledProgramMainMessage =
	| LynxCompiledProgramReadyReply
	| LynxCompiledProgramPageDestroyMessage
	| LynxDataLifecycleMessage
	| UniversalTransportAcknowledgement
	| UniversalTransportCompleteMessage
	| UniversalTransportRejectMessage
	| UniversalTransportFaultMessage
	| LynxCompiledProgramDisposeAcknowledgement
	| LynxCompiledProgramDisposeRetry;

function fail(message: string): never {
	throw new TypeError(WIRE_DEVELOPMENT ? `Octane Lynx compact wire ${message}.` : WIRE_ERROR);
}

function parse(value: unknown): unknown[] {
	if (typeof value !== 'string') fail('requires a string ContextProxy payload');
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		fail('received malformed JSON');
	}
	if (!Array.isArray(parsed)) fail('requires an array envelope');
	return parsed;
}

function safePositive(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) fail(`requires a positive ${name}`);
	return value as number;
}

function identity(input: unknown[], length: number): UniversalTransportIdentity {
	if (input.length !== length) fail('received the wrong field count');
	if (input[0] !== LYNX_TRANSPORT_PROTOCOL_VERSION) fail('received an unsupported version');
	return Object.freeze({
		protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
		renderer: LYNX_TRANSPORT_RENDERER,
		root: safePositive(input[2], 'root'),
		version: safePositive(input[3], 'frame version'),
	});
}

function error(input: unknown[], at: number): UniversalTransportError {
	const name = input[at];
	const message = input[at + 1];
	if (typeof name !== 'string' || name.length === 0 || typeof message !== 'string') {
		fail('received an invalid error');
	}
	return Object.freeze({ name, message });
}

function lifecycleRecord(input: unknown[], name: string): LynxLifecycleDataRecord {
	if (input.length !== 3) fail(`received the wrong ${name} field count`);
	if (typeof input[2] !== 'string') fail(`received invalid ${name} encoding`);
	const value = decodeLynxTransportValue(input[2]);
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		fail(`received invalid ${name} data`);
	}
	return value as LynxLifecycleDataRecord;
}

/**
 * Encode an internal compact-producer message without the general value walk.
 *
 * The v2 frame producer has already restricted every payload member to a wire
 * scalar. This boundary adds only routing/identity fields and JSON materializes
 * the array in the receiving realm. Unsupported values are therefore a producer
 * defect, not an application value that needs the general codec's escape ABI.
 */
export function encodeLynxCompiledProgramBackgroundMessage(
	message: LynxCompiledProgramBackgroundMessage,
): string {
	if (message.type === 'ready') {
		return JSON.stringify([
			LYNX_TRANSPORT_PROTOCOL_VERSION,
			WireOpcode.Ready,
			safePositive(message.request, 'ready request'),
		]);
	}
	const prefix = [
		LYNX_TRANSPORT_PROTOCOL_VERSION,
		message.type === 'frame'
			? WireOpcode.Frame
			: message.type === 'abort'
				? WireOpcode.Abort
				: message.type === 'dispose'
					? WireOpcode.Dispose
					: WireOpcode.TerminalDispose,
		safePositive(message.root, 'root'),
		safePositive(message.version, 'frame version'),
	];
	if (
		message.protocol !== LYNX_TRANSPORT_PROTOCOL_VERSION ||
		message.renderer !== LYNX_TRANSPORT_RENDERER
	) {
		fail('received a foreign identity');
	}
	if (message.type === 'frame') {
		if (!Array.isArray(message.frame)) fail('requires a frame array');
		prefix.push(message.frame as never);
	}
	return JSON.stringify(prefix);
}

export function decodeLynxCompiledProgramBackgroundMessage(
	value: unknown,
): LynxCompiledProgramBackgroundMessage {
	const input = parse(value);
	if (input[0] !== LYNX_TRANSPORT_PROTOCOL_VERSION) fail('received an unsupported version');
	if (input[1] === WireOpcode.Ready) {
		if (input.length !== 3) fail('received the wrong ready field count');
		return Object.freeze({ type: 'ready', request: safePositive(input[2], 'ready request') });
	}
	if (input[1] === WireOpcode.Frame) {
		const route = identity(input, 5);
		if (!Array.isArray(input[4])) fail('requires a frame array');
		return Object.freeze({ ...route, type: 'frame', frame: input[4] });
	}
	if (
		input[1] !== WireOpcode.Abort &&
		input[1] !== WireOpcode.Dispose &&
		input[1] !== WireOpcode.TerminalDispose
	) {
		fail('received an unknown background opcode');
	}
	const route = identity(input, 4);
	return Object.freeze({
		...route,
		type:
			input[1] === WireOpcode.Abort
				? 'abort'
				: input[1] === WireOpcode.Dispose
					? 'dispose'
					: 'terminal-dispose',
	});
}

export function encodeLynxCompiledProgramMainMessage(
	message: LynxCompiledProgramMainMessage,
): string {
	if (message.type === 'ready') {
		return JSON.stringify([
			LYNX_TRANSPORT_PROTOCOL_VERSION,
			WireOpcode.ReadyReply,
			safePositive(message.request, 'ready request'),
		]);
	}
	if (message.type === 'page-destroy') {
		return JSON.stringify([LYNX_TRANSPORT_PROTOCOL_VERSION, WireOpcode.PageDestroy]);
	}
	if (message.type === 'page-data' || message.type === 'global-props') {
		if (
			message.protocol !== LYNX_TRANSPORT_PROTOCOL_VERSION ||
			message.renderer !== LYNX_TRANSPORT_RENDERER
		) {
			fail('received a foreign lifecycle identity');
		}
		if (message.type === 'global-props') {
			return JSON.stringify([
				LYNX_TRANSPORT_PROTOCOL_VERSION,
				WireOpcode.GlobalProps,
				encodeLynxTransportValue(message.patch),
			]);
		}
		const opcode =
			message.operation === 'replace'
				? WireOpcode.PageReplace
				: message.operation === 'update'
					? WireOpcode.PageUpdate
					: message.operation === 'reset'
						? WireOpcode.PageReset
						: fail('received an invalid page-data operation');
		return JSON.stringify([
			LYNX_TRANSPORT_PROTOCOL_VERSION,
			opcode,
			encodeLynxTransportValue(message.data),
		]);
	}
	if (
		message.protocol !== LYNX_TRANSPORT_PROTOCOL_VERSION ||
		message.renderer !== LYNX_TRANSPORT_RENDERER
	) {
		fail('received a foreign identity');
	}
	const opcode =
		message.type === 'ack'
			? WireOpcode.Acknowledgement
			: message.type === 'complete'
				? WireOpcode.Complete
				: message.type === 'reject'
					? WireOpcode.Reject
					: message.type === 'fault'
						? WireOpcode.Fault
						: message.type === 'dispose-ack'
							? WireOpcode.DisposeAcknowledgement
							: WireOpcode.DisposeRetry;
	const output: unknown[] = [
		LYNX_TRANSPORT_PROTOCOL_VERSION,
		opcode,
		safePositive(message.root, 'root'),
		safePositive(message.version, 'frame version'),
	];
	if (message.type === 'reject' || message.type === 'fault' || message.type === 'dispose-retry') {
		output.push(message.error.name, message.error.message);
	}
	return JSON.stringify(output);
}

export function decodeLynxCompiledProgramMainMessage(
	value: unknown,
): LynxCompiledProgramMainMessage {
	const input = parse(value);
	if (input[0] !== LYNX_TRANSPORT_PROTOCOL_VERSION) fail('received an unsupported version');
	if (input[1] === WireOpcode.ReadyReply) {
		if (input.length !== 3) fail('received the wrong ready field count');
		return Object.freeze({ type: 'ready', request: safePositive(input[2], 'ready request') });
	}
	if (input[1] === WireOpcode.PageDestroy) {
		if (input.length !== 2) fail('received the wrong page-destroy field count');
		return Object.freeze({ type: 'page-destroy' });
	}
	if (input[1] === WireOpcode.GlobalProps) {
		const patch = lifecycleRecord(input, 'global-props');
		return Object.freeze({
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			type: 'global-props',
			patch,
		}) as LynxGlobalPropsMessage;
	}
	if (
		input[1] === WireOpcode.PageReplace ||
		input[1] === WireOpcode.PageUpdate ||
		input[1] === WireOpcode.PageReset
	) {
		const data = lifecycleRecord(input, 'page-data');
		return Object.freeze({
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			type: 'page-data',
			operation:
				input[1] === WireOpcode.PageReplace
					? 'replace'
					: input[1] === WireOpcode.PageUpdate
						? 'update'
						: 'reset',
			data,
		}) as LynxPageDataMessage;
	}
	const withError =
		input[1] === WireOpcode.Reject ||
		input[1] === WireOpcode.Fault ||
		input[1] === WireOpcode.DisposeRetry;
	const route = identity(input, withError ? 6 : 4);
	if (input[1] === WireOpcode.Acknowledgement) return Object.freeze({ ...route, type: 'ack' });
	if (input[1] === WireOpcode.Complete) return Object.freeze({ ...route, type: 'complete' });
	if (input[1] === WireOpcode.DisposeAcknowledgement) {
		return Object.freeze({ ...route, type: 'dispose-ack' });
	}
	if (input[1] === WireOpcode.Reject) {
		return Object.freeze({ ...route, type: 'reject', error: error(input, 4) });
	}
	if (input[1] === WireOpcode.Fault) {
		return Object.freeze({ ...route, type: 'fault', error: error(input, 4) });
	}
	if (input[1] === WireOpcode.DisposeRetry) {
		return Object.freeze({ ...route, type: 'dispose-retry', error: error(input, 4) });
	}
	fail('received an unknown main opcode');
}
