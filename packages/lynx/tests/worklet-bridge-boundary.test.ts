/// <reference types="node" />
// @vitest-environment node

/**
 * The main-thread receiver reaches the worklet runtime only through the
 * `worklet-bridge` slot, provided by `main-renderer.ts`'s thread-function
 * entry points. This suite pins both halves of that boundary:
 *
 * - bundle shape: a production main-thread bundle that never imports a
 *   thread-function entry point retains none of the registry machinery, while
 *   importing `registerThreadFunction` or `useMainThreadRef` retains it;
 * - behavior: a receiver installed with no bridge still runs commits, and
 *   reports worklet-addressed traffic cleanly instead of crashing.
 *
 * This file must not import `main-renderer.ts` (or call anything that does)
 * before the no-bridge cases run: the bridge slot is process-global and the
 * suite relies on it staying empty.
 */

import { resolve } from 'node:path';

import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

import { createLynxClientContainer } from '../src/core/client-driver.js';
import {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	type LynxContextProxy,
} from '../src/core/protocol.js';
import { createLynxBackgroundTransport } from '../src/core/transport.js';
import { registerMainThreadWorklet } from '../src/core/worklets.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';

const packageDirectory = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(packageDirectory, '../..');

// Strings that exist only inside the registry machinery behind the bridge —
// not in `worklets.ts` module scope, which every main-thread bundle still
// evaluates for the built-in ref-owner registrations.
const REGISTRY_MARKERS = [
	'Octane Lynx main-thread worklet registry is closed.',
	'Octane Lynx already has an installed main-thread worklet registry.',
] as const;

async function bundleMainThread(extraSource: string): Promise<string> {
	const mainThreadEntry = resolve(packageDirectory, 'src/main-thread.ts');
	const firstScreenEntry = resolve(packageDirectory, 'src/first-screen.ts');
	const result = await build({
		stdin: {
			contents: `
				import { installLynxMainThread } from ${JSON.stringify(mainThreadEntry)};
				import { root } from ${JSON.stringify(firstScreenEntry)};
				globalThis.__octaneMainThreadProbe = { installLynxMainThread, root };
				${extraSource}
			`,
			resolveDir: repositoryRoot,
			sourcefile: 'lynx-main-thread-probe.js',
		},
		absWorkingDir: repositoryRoot,
		bundle: true,
		format: 'iife',
		logLevel: 'silent',
		minify: true,
		platform: 'browser',
		treeShaking: true,
		write: false,
	});
	return result.outputFiles[0]!.text;
}

describe('@octanejs/lynx worklet bridge bundle boundary', () => {
	it('sheds the worklet registry from a main-thread bundle with no worklet imports', async () => {
		const output = await bundleMainThread('');
		for (const marker of REGISTRY_MARKERS) {
			expect(output).not.toContain(marker);
		}
	});

	it('retains the worklet registry when compiled output registers a thread function', async () => {
		const mainRendererEntry = resolve(packageDirectory, 'src/main-renderer.ts');
		const output = await bundleMainThread(`
			import { registerThreadFunction } from ${JSON.stringify(mainRendererEntry)};
			registerThreadFunction('main-thread', 'tf_probe', () => undefined);
		`);
		for (const marker of REGISTRY_MARKERS) {
			expect(output).toContain(marker);
		}
	});

	it('retains the worklet registry when the bundle uses useMainThreadRef', async () => {
		const firstScreenEntry = resolve(packageDirectory, 'src/first-screen.ts');
		const output = await bundleMainThread(`
			import { useMainThreadRef } from ${JSON.stringify(firstScreenEntry)};
			globalThis.__octaneMainThreadProbe.useMainThreadRef = useMainThreadRef;
		`);
		for (const marker of REGISTRY_MARKERS) {
			expect(output).toContain(marker);
		}
	});
});

describe.sequential('main-thread receiver without a worklet bridge', () => {
	let dom: JSDOM | null = null;
	let controller: LynxMainThreadController | null = null;
	const diagnostics: Error[] = [];

	afterEach(() => {
		controller?.close();
		controller = null;
		diagnostics.length = 0;
		if (dom !== null) {
			globalThis.lynxTestingEnv.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
			dom = null;
		}
	});

	function install(): {
		context: LynxContextProxy;
		runWorklet: ((descriptor: unknown, args?: readonly unknown[]) => unknown) | undefined;
	} {
		dom = new JSDOM('<!doctype html><html><body></body></html>');
		installLynxTestingEnv(globalThis, {
			window: dom.window as unknown as Window & typeof globalThis,
		});
		globalThis.lynxTestingEnv.switchToMainThread();
		controller = installLynxMainThread({
			onDiagnostic: (error) => void diagnostics.push(error),
		});
		const runWorklet = (globalThis as { runWorklet?: (...args: unknown[]) => unknown }).runWorklet;
		globalThis.lynxTestingEnv.switchToBackgroundThread();
		const context = (
			globalThis as typeof globalThis & { lynx: { getCoreContext(): LynxContextProxy } }
		).lynx.getCoreContext();
		return { context, runWorklet };
	}

	it('rejects a main-thread call cleanly and keeps ordinary commits working', async () => {
		const { context } = install();
		const container = createLynxClientContainer();
		const transport = createLynxBackgroundTransport(context, container);
		await transport.ready;

		// Registered in the shared test realm, so the failure below is the
		// receiver's missing bridge, not a missing definition.
		const worklet = registerMainThreadWorklet('test:no-bridge-call', undefined, () => 42);
		const root = 41;
		const identity = (version: number) => ({
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			root,
			version,
		});
		const calls: ReturnType<typeof transport.callMain>[] = [];
		await transport
			.prepareBatch(
				container,
				{
					renderer: LYNX_TRANSPORT_RENDERER,
					version: 1,
					commands: [
						{ op: 'create', id: 1, type: 'view', props: { id: 'no-bridge' } },
						{ op: 'insert', parent: null, id: 1, before: null },
					],
				},
				identity(1),
			)
			.apply(() => {
				calls.push(transport.callMain(worklet, []));
			});

		// The ordinary commit applied: the receiver works without the bridge.
		expect(dom!.window.document.querySelector('[id="no-bridge"]')).not.toBeNull();
		// The worklet call fails as a clean remote error, not a crash.
		await expect(calls[0]!.promise).rejects.toThrow(/compiled no main-thread worklets/);
	});

	it('reports a host-dispatched worklet instead of crashing', () => {
		const { runWorklet } = install();
		expect(runWorklet).toBeTypeOf('function');
		expect(runWorklet!({ _wkltId: 'test:no-bridge-host-dispatch' })).toBeUndefined();
		expect(diagnostics.some((error) => /compiled none/.test(error.message))).toBe(true);
	});
});
