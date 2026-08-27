import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import {
	UNIVERSAL_TRANSPORT_PROTOCOL_VERSION,
	defineUniversalComponent,
	universalPlan,
	universalProps,
	universalValue,
} from 'octane/universal/native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLynxRoot, type LynxRoot } from '../src/index.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import {
	LYNX_TRANSPORT_RENDERER,
	lynxValidationTraverses,
	validateLynxBackgroundOutboundMessage,
	type LynxContextProxy,
	type LynxValidationMode,
} from '../src/core/protocol.js';
import { LYNX_DEVELOPMENT } from '../src/core/environment.js';
import { conformingContextProxy, unwire } from './_fixtures/lynx-wire.js';

function identity(root: number, version: number) {
	return {
		protocol: UNIVERSAL_TRANSPORT_PROTOCOL_VERSION,
		renderer: LYNX_TRANSPORT_RENDERER,
		root,
		version,
	};
}

/** A commit whose envelope is correct and whose single command is not. */
function commitWithBadCommand(command: unknown) {
	return {
		...identity(1, 1),
		type: 'commit' as const,
		batch: { renderer: LYNX_TRANSPORT_RENDERER, version: 1, commands: [command] },
	};
}

/**
 * The same module graph, evaluated as a production build.
 *
 * `trusted` is defined as "decline the deep walk in production, keep it in
 * development", so a test that only ever runs one of those two builds is
 * asserting half the contract and assuming the other. `LYNX_DEVELOPMENT` is a
 * module-level constant that folds away in a real bundle, which is exactly why
 * it cannot be toggled after import — the module has to be evaluated again.
 */
async function loadAsProductionBuild(): Promise<
	typeof import('../src/core/protocol.js') & { readonly LYNX_DEVELOPMENT?: never }
> {
	const previous = process.env.NODE_ENV;
	process.env.NODE_ENV = 'production';
	vi.resetModules();
	try {
		return await import('../src/core/protocol.js');
	} finally {
		process.env.NODE_ENV = previous;
		vi.resetModules();
	}
}

describe('Lynx validation policy', () => {
	it('walks under checked always, and under trusted only in a development build', () => {
		// The default is not a detail: a root that says nothing gets the walk,
		// because opting out of it is a claim about who wrote the peer, and only
		// the application can make that claim.
		expect(lynxValidationTraverses('checked')).toBe(true);
		expect(lynxValidationTraverses('trusted')).toBe(LYNX_DEVELOPMENT);
	});

	it('declines only the command walk under trusted, and only in a production build', async () => {
		const unknownOperation = commitWithBadCommand({ op: 'teleport', id: 1 });
		const executableProp = commitWithBadCommand({
			op: 'create',
			id: 1,
			type: 'view',
			props: { onTap: () => {} },
		});

		// Development is unconditional: a build that can tell a developer their
		// message is malformed does so, whatever the root asked for, because the
		// cost `trusted` buys back is a production cost.
		for (const message of [unknownOperation, executableProp]) {
			expect(() => validateLynxBackgroundOutboundMessage(message, 'checked')).toThrow(TypeError);
			expect(() => validateLynxBackgroundOutboundMessage(message, 'trusted')).toThrow(TypeError);
		}

		const production = await loadAsProductionBuild();
		expect(production.lynxValidationTraverses('checked')).toBe(true);
		expect(production.lynxValidationTraverses('trusted')).toBe(false);
		for (const message of [unknownOperation, executableProp]) {
			expect(() => production.validateLynxBackgroundOutboundMessage(message, 'checked')).toThrow(
				TypeError,
			);
			expect(production.validateLynxBackgroundOutboundMessage(message, 'trusted')).toBe(message);
		}
	});

	it('keeps the envelope checked under trusted in a production build', async () => {
		const production = await loadAsProductionBuild();
		const good = {
			...identity(1, 1),
			type: 'commit' as const,
			batch: { renderer: LYNX_TRANSPORT_RENDERER, version: 1, commands: [] },
		};
		expect(production.validateLynxBackgroundOutboundMessage(good, 'trusted')).toBe(good);

		// Protocol, renderer, root, version, discriminant and the batch header are
		// what decide which root a commit belongs to and which frame it answers.
		// Skipping them would not be a trust decision, it would be a routing bug,
		// so `trusted` keeps every one of them.
		const refusals: readonly (readonly [unknown, RegExp])[] = [
			[{ ...good, protocol: UNIVERSAL_TRANSPORT_PROTOCOL_VERSION + 1 }, /protocol/],
			[{ ...good, renderer: 'react-dom' }, /renderer/],
			[{ ...good, root: 0 }, /root/],
			[{ ...good, version: 0 }, /version/],
			[{ ...good, type: 'teleport' }, /unsupported type/],
			[{ ...good, batch: { ...good.batch, renderer: 'react-dom' } }, /batch\.renderer/],
			[{ ...good, batch: { ...good.batch, version: 2 } }, /batch\.version/],
			[
				{ ...good, batch: { ...good.batch, commands: 'none' } },
				/batch\.commands.*must be an array/,
			],
			[{ ...good, batch: { ...good.batch, extra: true } }, /unknown field "extra"/],
			[{ ...good, batch: null }, /batch.*must be an object/],
		];
		for (const [message, pattern] of refusals) {
			expect(() => production.validateLynxBackgroundOutboundMessage(message, 'trusted')).toThrow(
				pattern,
			);
		}
	});

	describe('over a real pair of threads', () => {
		let dom: JSDOM | null = null;
		let main: LynxMainThreadController | null = null;
		let root: LynxRoot | null = null;

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

		/**
		 * Mount, update and tear down one scene, and report what crossed.
		 *
		 * The trace is message types in order, from both directions, which is
		 * where the acknowledgement, the completion that settles backpressure,
		 * and the terminal dispose all show up. Comparing two whole traces is a
		 * stronger statement than four hand-built cases: it says the modes differ
		 * in what they re-derive and in nothing else.
		 */
		async function traceWorkload(
			validation: LynxValidationMode,
		): Promise<{ readonly background: string[]; readonly main: string[]; readonly html: string }> {
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
			main = installLynxMainThread({ context: mainWire.context, validation });

			env.switchToBackgroundThread();
			const backgroundWire = conformingContextProxy(
				(
					globalThis as unknown as { lynx: { getJSContext(): LynxContextProxy } }
				).lynx.getJSContext(),
			);
			root = createLynxRoot({ context: backgroundWire.context, validation });

			const plan = universalPlan('lynx', { kind: 'host', type: 'view', propsSlot: 0 });
			const Scene = defineUniversalComponent('lynx', (props: { readonly id: string }) =>
				universalValue(plan, [universalProps([['set', 'id', props.id]])]),
			);

			await root.render(Scene, { id: 'mounted' });
			await root.flushTransport();
			await root.render(Scene, { id: 'updated' });
			await root.flushTransport();
			const html = dom.window.document.body.innerHTML;
			await root.unmount();
			root = null;

			const types = (crossings: readonly string[]): string[] =>
				crossings.map((payload) => String((unwire(payload) as { type?: unknown }).type));
			return {
				background: types(backgroundWire.conformance.crossings),
				main: types(mainWire.conformance.crossings),
				html,
			};
		}

		it('refuses a mode it does not implement, on both sides of the wire', async () => {
			dom = new JSDOM('<!doctype html><html><body></body></html>');
			installLynxTestingEnv(globalThis, {
				window: dom.window as unknown as Window & typeof globalThis,
			});
			const env = globalThis.lynxTestingEnv;
			const context = () =>
				(
					globalThis as unknown as { lynx: { getJSContext(): LynxContextProxy } }
				).lynx.getJSContext();

			// A mode nobody implements has to be an error rather than a silent
			// fallback: falling back to `checked` would make a typo look like it
			// worked, and falling back to `trusted` would silently drop validation
			// the application never asked to drop.
			for (const validation of [
				'loose',
				'',
				'CHECKED',
				'true',
			] as unknown as LynxValidationMode[]) {
				env.switchToBackgroundThread();
				expect(() => createLynxRoot({ context: context(), validation })).toThrow(
					/validation must be "checked" or "trusted"/,
				);
				env.switchToMainThread();
				expect(() => installLynxMainThread({ context: context(), validation })).toThrow(
					/validation must be "checked" or "trusted"/,
				);
			}

			// And both spellings that do exist are accepted on both sides.
			for (const validation of ['checked', 'trusted'] as const) {
				env.switchToMainThread();
				const controller = installLynxMainThread({ context: context(), validation });
				env.switchToBackgroundThread();
				const created = createLynxRoot({ context: context(), validation });
				await created.unmount();
				env.switchToMainThread();
				controller.close();
			}
		});

		it('carries the same acknowledgement, backpressure and lifetime under either mode', async () => {
			const checked = await traceWorkload('checked');
			globalThis.lynxTestingEnv?.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom?.window.close();
			dom = null;
			main = null;
			const trusted = await traceWorkload('trusted');

			// The positive control first: a trace that recorded nothing would make
			// every equality below true and prove nothing at all.
			expect(checked.background).toContain('commit');
			expect(checked.main).toContain('ack');
			expect(checked.main).toContain('complete');
			expect(checked.background).toContain('dispose');
			expect(checked.main).toContain('dispose-ack');
			expect(checked.html).toContain('updated');

			// One acknowledgement and one completion per commit. The count itself
			// is not the claim — it is that the three are equal, which is what
			// says every frame was published and settled rather than overtaken.
			const commits = checked.background.filter((type) => type === 'commit').length;
			expect(commits).toBeGreaterThan(1);
			expect(checked.main.filter((type) => type === 'ack')).toHaveLength(commits);
			expect(checked.main.filter((type) => type === 'complete')).toHaveLength(commits);

			expect(trusted.background).toEqual(checked.background);
			expect(trusted.main).toEqual(checked.main);
			expect(trusted.html).toEqual(checked.html);
		});

		it('reports a fault the same way under either mode', async () => {
			// A main thread that cannot apply a frame must terminally close the
			// exact root that sent it, whatever that root asked to re-derive. The
			// fault path runs after validation, so a mode that changed it would be
			// changing something it has no business touching.
			const faults: Record<LynxValidationMode, readonly string[]> = {
				checked: [],
				trusted: [],
			};
			for (const validation of ['checked', 'trusted'] as const) {
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
				main = installLynxMainThread({ context: mainWire.context, validation });

				env.switchToBackgroundThread();
				const backgroundWire = conformingContextProxy(
					(
						globalThis as unknown as { lynx: { getJSContext(): LynxContextProxy } }
					).lynx.getJSContext(),
				);
				const errors: string[] = [];
				root = createLynxRoot({
					context: backgroundWire.context,
					validation,
					onDiagnostic: (error: Error) => errors.push(error.message),
				});

				const plan = universalPlan('lynx', { kind: 'host', type: 'view', propsSlot: 0 });
				const Scene = defineUniversalComponent('lynx', (props: { readonly id: string }) =>
					universalValue(plan, [universalProps([['set', 'id', props.id]])]),
				);
				await root.render(Scene, { id: 'faulting' });
				await root.flushTransport();

				// An unsolicited host fault, addressed to this exact root.
				env.switchToMainThread();
				const identityFromCommit = backgroundWire.conformance.crossings
					.map((payload) => unwire(payload) as Record<string, unknown>)
					.find((message) => message.type === 'commit')!;
				mainWire.context.dispatchEvent({
					type: 'octane-lynx:main-to-background',
					data: JSON.stringify([
						0,
						{
							protocol: identityFromCommit.protocol,
							renderer: identityFromCommit.renderer,
							root: identityFromCommit.root,
							version: identityFromCommit.version,
							type: 'fault',
							error: { name: 'Error', message: 'host refused the frame' },
						},
					]),
				});

				env.switchToBackgroundThread();
				faults[validation] = [
					...errors,
					...backgroundWire.conformance.crossings
						.map((payload) => String((unwire(payload) as { type?: unknown }).type))
						.filter((type) => type === 'terminal-dispose'),
				];

				await root.unmount().catch(() => {});
				root = null;
				main?.close();
				main = null;
				globalThis.lynxTestingEnv?.clearGlobal();
				uninstallLynxTestingEnv(globalThis);
				dom?.window.close();
				dom = null;
			}

			expect(faults.checked.length).toBeGreaterThan(0);
			expect(faults.trusted).toEqual(faults.checked);
		});
	});
});
