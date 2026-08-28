// What the main-ready reply costs, as a function of the page it reports.
//
// Issue #231: the background has only ever read one bit out of that reply —
// that a first screen was painted, so the first background batch must preserve
// its IDs. Below the presence rung the only way to state that was to attach the
// whole first-tree description, so a correlated reply was O(painted tree):
// 37 MB for a 30,000-row page, structured-cloned across the wire and validated
// node by node on receipt to carry a boolean. It fired on whichever repetitions
// lost a race between adoption releasing the journal and the background's
// correlated request arriving, which is why it read as a scale cliff rather
// than as the unbounded reply it always was.
//
// These are budgets rather than exact byte counts: the claim is that the reply
// stops scaling with the page, and an exact number would only pin today's
// spelling of a constant-size message.
import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { root as firstScreenRoot } from '../src/first-screen.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import {
	defineUniversalComponent as defineFirstScreenComponent,
	firstScreenEvent,
	universalFor as firstScreenFor,
	universalPlan as firstScreenPlan,
	universalProps as firstScreenProps,
	universalValue as firstScreenValue,
} from '../src/main-renderer.js';
import {
	LYNX_BACKGROUND_TO_MAIN_EVENT,
	LYNX_FIRST_TREE_PRESENCE_READY_REQUEST_BASE,
	LYNX_MAIN_TO_BACKGROUND_EVENT,
	LYNX_TEMPLATE_RUN_READY_REQUEST_BASE,
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	validateLynxBackgroundInboundMessage,
	type LynxContextProxy,
	type LynxMainReadyReply,
} from '../src/core/protocol.js';

const rowPlan = firstScreenPlan('lynx', { kind: 'host', type: 'view', propsSlot: 0 });
const scenePlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	propsSlot: 0,
	children: [{ kind: 'slot', slot: 1 }],
});

/** A page whose size is entirely a function of `items`. */
const Scene = defineFirstScreenComponent('lynx', (props: { readonly items: readonly string[] }) => [
	firstScreenValue(scenePlan, [
		firstScreenProps([
			['set', 'id', 'scene'],
			['set', 'bindtap', firstScreenEvent],
		]),
		null,
	]),
	firstScreenFor(
		props.items,
		(item) => item,
		(item) => firstScreenValue(rowPlan, [firstScreenProps([['set', 'id', item]])]),
		null,
		true,
		true,
	),
]);

function backgroundContext(): LynxContextProxy {
	return (
		globalThis as unknown as { lynx: { getCoreContext(): LynxContextProxy } }
	).lynx.getCoreContext();
}
function mainContext(): LynxContextProxy {
	return (
		globalThis as unknown as { lynx: { getJSContext(): LynxContextProxy } }
	).lynx.getJSContext();
}

let main: LynxMainThreadController | null = null;

function teardown(): void {
	main?.close();
	main = null;
	try {
		globalThis.lynxTestingEnv?.clearGlobal?.();
		uninstallLynxTestingEnv(globalThis);
	} catch {
		// No environment installed yet.
	}
}
afterEach(teardown);

/** Paint `rows` rows, answer one correlated request at `request`, and report the reply. */
function paintAndAnswer(
	rows: number,
	request: number,
): { reply: LynxMainReadyReply; bytes: number } {
	teardown();
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	globalThis.lynxTestingEnv.switchToMainThread();
	main = installLynxMainThread({ firstScreen: true });
	const outbound: LynxMainReadyReply[] = [];
	mainContext().addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, (event) => {
		const message = event.data as LynxMainReadyReply;
		if (message.type === 'main-ready') outbound.push(message);
	});
	// Queued before the paint, which is the order that loses the race in
	// production: the background does not wait for the main thread to finish
	// painting before asking, and at 30,000 rows that paint is seconds long.
	backgroundContext().dispatchEvent({
		type: LYNX_BACKGROUND_TO_MAIN_EVENT,
		data: {
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			type: 'main-ready-request',
			request,
		},
	});
	firstScreenRoot.render(Scene, {
		items: Array.from({ length: rows }, (_, index) => `row-${index}`),
	});
	const correlated = outbound.filter((message) => message.request === request);
	expect(correlated).toHaveLength(1);
	return { reply: correlated[0]!, bytes: JSON.stringify(correlated[0]).length };
}

const presence = (n: number) => LYNX_FIRST_TREE_PRESENCE_READY_REQUEST_BASE + n;
const legacy = (n: number) => LYNX_TEMPLATE_RUN_READY_REQUEST_BASE + n;

describe('main-ready reply cost', () => {
	it('does not grow with the painted tree for a peer that reads presence', () => {
		const small = paintAndAnswer(50, presence(1));
		const large = paintAndAnswer(400, presence(1));

		expect(small.reply.firstTreePainted).toBe(1);
		expect(large.reply.firstTreePainted).toBe(1);
		expect(small.reply.firstTree).toBeUndefined();
		expect(large.reply.firstTree).toBeUndefined();
		// Eight times the page, byte-identical reply. Not merely "smaller": the
		// reply has stopped being a function of the page at all.
		expect(large.bytes).toBe(small.bytes);
		expect(large.bytes).toBeLessThan(512);
	});

	it('still sends the description to a peer below the presence rung', () => {
		// The fact is load-bearing and presence *is* the key for such a peer, so
		// the fallback is not approximated away: it would otherwise read a page
		// that was painted as a page that was not, and rebuild it over the command
		// path with fresh IDs.
		const small = paintAndAnswer(50, legacy(1));
		const large = paintAndAnswer(400, legacy(1));

		expect(small.reply.firstTree).toBeDefined();
		expect(large.reply.firstTree).toBeDefined();
		expect(small.reply.firstTreePainted).toBeUndefined();
		expect(large.reply.firstTree!.nodes).toHaveLength(401);
		// The cost this rung still pays, and the reason the newer one exists.
		expect(large.bytes).toBeGreaterThan(small.bytes * 4);
	});

	it('validates the presence reply and refuses an ambiguous or under-ranked one', () => {
		const { reply } = paintAndAnswer(8, presence(1));
		expect(() => validateLynxBackgroundInboundMessage(reply)).not.toThrow();

		expect(() => validateLynxBackgroundInboundMessage({ ...reply, request: legacy(1) })).toThrow(
			/first-tree-presence readiness request/,
		);

		const described = paintAndAnswer(8, legacy(1));
		expect(() =>
			validateLynxBackgroundInboundMessage({
				...described.reply,
				request: presence(1),
				firstTreePainted: 1,
			}),
		).toThrow(/cannot accompany firstTree/);
	});
});
