import { describe, expect, it } from 'vitest';

import {
	decodeLynxCompiledProgramBackgroundMessage,
	decodeLynxCompiledProgramMainMessage,
	encodeLynxCompiledProgramBackgroundMessage,
	encodeLynxCompiledProgramMainMessage,
} from '../src/core/compiled-program-wire.js';
import {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
} from '../src/core/transport-identity.js';
import { encodeLynxTransportValue } from '../src/core/transport-codec.js';

const route = Object.freeze({
	protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
	renderer: LYNX_TRANSPORT_RENDERER,
	root: 7,
	version: 3,
});

describe('@octanejs/lynx compact compiled-program worklet wire', () => {
	it('round-trips every background-to-main call message without losing isolated values', () => {
		const messages = [
			{
				...route,
				type: 'call-main' as const,
				call: 1,
				worklet: { _wkltId: 'wire:main', _c: { missing: undefined } },
				args: [{ nested: [undefined, 'value'] }],
			},
			{ ...route, type: 'cancel-main' as const, call: 2 },
			{
				...route,
				type: 'call-background-result' as const,
				call: 3,
				value: { nested: [undefined, 4] },
			},
			{
				...route,
				type: 'call-background-error' as const,
				call: 4,
				error: { name: 'RangeError', message: 'background failed' },
			},
		];

		for (const message of messages) {
			expect(
				decodeLynxCompiledProgramBackgroundMessage(
					encodeLynxCompiledProgramBackgroundMessage(message),
				),
			).toEqual(message);
		}
	});

	it('round-trips every main-to-background call message without losing isolated values', () => {
		const messages = [
			{
				...route,
				type: 'call-background' as const,
				call: 5,
				fn: {
					_jsFnId: 'wire:background',
					_execId: 'wire:execution',
					_c: { missing: undefined },
				},
				args: [{ nested: [undefined, 'value'] }],
			},
			{ ...route, type: 'cancel-background' as const, call: 6 },
			{
				...route,
				type: 'call-main-result' as const,
				call: 7,
				value: { nested: [undefined, 8] },
			},
			{
				...route,
				type: 'call-main-error' as const,
				call: 8,
				error: { name: 'TypeError', message: 'main failed' },
			},
		];

		for (const message of messages) {
			expect(
				decodeLynxCompiledProgramMainMessage(encodeLynxCompiledProgramMainMessage(message)),
			).toEqual(message);
		}
	});

	it('rejects malformed call envelopes before they reach either executor', () => {
		const value = encodeLynxTransportValue({ invalid: true });
		const args = encodeLynxTransportValue([]);

		expect(() =>
			decodeLynxCompiledProgramBackgroundMessage(
				JSON.stringify([LYNX_TRANSPORT_PROTOCOL_VERSION, 19, 7, 3, 0, value, args]),
			),
		).toThrow(/positive call id/);
		expect(() =>
			decodeLynxCompiledProgramBackgroundMessage(
				JSON.stringify([LYNX_TRANSPORT_PROTOCOL_VERSION, 19, 7, 3, 1, value]),
			),
		).toThrow(/wrong field count/);
		expect(() =>
			decodeLynxCompiledProgramMainMessage(
				JSON.stringify([
					LYNX_TRANSPORT_PROTOCOL_VERSION,
					23,
					7,
					3,
					1,
					encodeLynxTransportValue([]),
					args,
				]),
			),
		).toThrow(/invalid call-background payload/);
		expect(() =>
			decodeLynxCompiledProgramMainMessage(
				JSON.stringify([
					LYNX_TRANSPORT_PROTOCOL_VERSION,
					23,
					7,
					3,
					1,
					value,
					encodeLynxTransportValue({ not: 'args' }),
				]),
			),
		).toThrow(/invalid call-background payload/);
	});
});
