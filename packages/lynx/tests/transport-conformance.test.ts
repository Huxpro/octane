import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import {
	defineUniversalComponent,
	universalPlan,
	universalProps,
	universalValue,
} from 'octane/universal/native';
import { afterEach, describe, expect, it } from 'vitest';

import { createLynxRoot, type LynxRoot } from '../src/index.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import type { LynxContextProxy } from '../src/core/protocol.js';
import { conformingContextProxy } from './_fixtures/lynx-wire.js';

const LYNX_SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Every `.ts` under `src`, so a new send site cannot hide in a new file. */
function sourceFiles(directory: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) found.push(...sourceFiles(path));
		else if (entry.name.endsWith('.ts')) found.push(path);
	}
	return found.sort();
}

/** The `{ … }` immediately after each `dispatchEvent(`, brace-matched. */
function dispatchEventArguments(source: string): string[] {
	const found: string[] = [];
	const pattern = /\bdispatchEvent\(\s*\{/g;
	for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
		let depth = 0;
		let index = source.indexOf('{', match.index);
		const start = index;
		while (index < source.length) {
			const character = source[index];
			if (character === '{') depth++;
			else if (character === '}') {
				depth--;
				if (depth === 0) break;
			}
			index++;
		}
		found.push(source.slice(start, index + 1));
	}
	return found;
}

describe('Lynx transport conformance', () => {
	// The static half. A runtime probe only proves what it executed, and the
	// claim being made is about every path, so the send sites are counted and
	// read directly. Adding a fifth one, or dropping the encode from an existing
	// one, is what this notices.
	it('encodes at every send site in the package, and there are exactly four', () => {
		const sites: string[] = [];
		for (const file of sourceFiles(LYNX_SRC)) {
			const source = readFileSync(file, 'utf8');
			for (const argument of dispatchEventArguments(source)) {
				// Only the two transport channels; a host PAPI dispatch is not ours.
				if (!/LYNX_(?:MAIN_TO_BACKGROUND|BACKGROUND_TO_MAIN)_EVENT/.test(argument)) continue;
				sites.push(`${relative(LYNX_SRC, file)}: ${argument.replace(/\s+/g, ' ')}`);
			}
		}
		expect(sites).toHaveLength(4);
		for (const site of sites) {
			expect(site).toMatch(/data:\s*encoded\b|data:\s*encodeLynxTransportValue\(/);
		}
	});

	// The dynamic half, under traffic the static half cannot see: what a real
	// mount, update, and teardown actually put on the channel.
	describe('under a strict wire', () => {
		let root: LynxRoot | null = null;
		let main: LynxMainThreadController | null = null;
		let dom: JSDOM | null = null;

		afterEach(async () => {
			globalThis.lynxTestingEnv?.switchToBackgroundThread();
			await root?.unmount().catch(() => {});
			root = null;
			globalThis.lynxTestingEnv?.switchToMainThread();
			main?.close();
			main = null;
			globalThis.lynxTestingEnv?.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom?.window.close();
			dom = null;
		});

		it('carries only decodable strings across a real mount, update, and teardown', async () => {
			dom = new JSDOM('<!doctype html><html><body></body></html>');
			installLynxTestingEnv(globalThis, {
				window: dom.window as unknown as Window & typeof globalThis,
			});
			const env = globalThis.lynxTestingEnv;

			env.switchToMainThread();
			const mainWire = conformingContextProxy(
				(
					globalThis as unknown as { lynx: { getJSContext(): LynxContextProxy } }
				).lynx.getJSContext(),
			);
			main = installLynxMainThread({ context: mainWire.context });

			env.switchToBackgroundThread();
			const backgroundWire = conformingContextProxy(
				(
					globalThis as unknown as { lynx: { getJSContext(): LynxContextProxy } }
				).lynx.getJSContext(),
			);
			root = createLynxRoot({ context: backgroundWire.context });

			const plan = universalPlan('lynx', { kind: 'host', type: 'view', propsSlot: 0 });
			const Scene = defineUniversalComponent('lynx', (props: { readonly id: string }) =>
				universalValue(plan, [universalProps([['set', 'id', props.id]])]),
			);

			await root.render(Scene, { id: 'mounted' });
			await root.flushTransport();
			expect(dom.window.document.querySelector('#mounted')).not.toBeNull();

			await root.render(Scene, { id: 'updated' });
			await root.flushTransport();
			expect(dom.window.document.querySelector('#updated')).not.toBeNull();

			await root.unmount();
			root = null;

			// The positive control. A wrapper that was never reached would satisfy
			// every assertion above it, which is exactly how a conformance harness
			// quietly stops proving anything.
			expect(backgroundWire.conformance.crossings.length).toBeGreaterThan(0);
			expect(mainWire.conformance.crossings.length).toBeGreaterThan(0);
			// Both directions were exercised, not just the loud one.
			expect(backgroundWire.conformance.bytes()).toBeGreaterThan(0);
			expect(mainWire.conformance.bytes()).toBeGreaterThan(0);
		});
	});
});
