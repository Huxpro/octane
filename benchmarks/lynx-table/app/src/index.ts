import { createLynxRoot, root as defaultRoot } from '@octanejs/lynx';

import { App } from './App.lynx.tsrx';
import { blockApp } from './block-program.js';
import './app.css';

// Issue-#103 B0: one application entry, one build flag. `__BENCH_CORE__` is
// substituted beside `pluginOctane({ core })`, so the ternary folds at build
// time and `block-program.ts` — with `block-core.ts` behind it — leaves the
// `universal` bundle entirely. That fold is what makes the two cells an A/B
// with a single variable rather than two applications that resemble each other.
//
// Issue-#135 item 1b adds a third position for that one variable. `derived`
// runs the Block core on the compiled `App` itself, the way `universal` does,
// rather than on the hand-written program beside it — so `block-program.ts`
// folds out of that bundle too, and the cell measures the framework instead of
// standing in for it. The other two modes stay because the ceiling they record
// is what the derived cell is read against.
declare const __BENCH_CORE__: string;
declare const __BENCH_BLOCK_MODE__: string;
declare const __BENCH_ISSUE278_ATTRIBUTION__: boolean;
declare const __BENCH_ISSUE278_WIRE_OPS__: boolean;

interface Issue278WireEvent {
	readonly direction: 'bts-to-mts';
	readonly type: string;
	readonly startedAtMs: number;
	readonly returnedAtMs: number;
	readonly encodedBytes: number | null;
	readonly commandOps: readonly string[] | null;
}

type Issue278Global = typeof globalThis & {
	__ISSUE278_ROOT__?: ReturnType<typeof createLynxRoot>;
	__ISSUE278_WIRE__?: Issue278WireEvent[];
};

function issue278Root() {
	if (!__BENCH_ISSUE278_ATTRIBUTION__) return defaultRoot;
	const raw = lynx.getCoreContext();
	const wire: Issue278WireEvent[] = [];
	(globalThis as Issue278Global).__ISSUE278_WIRE__ = wire;
	const context = {
		dispatchEvent(event: { type: string; data?: unknown }) {
			const startedAtMs = Date.now();
			let commandOps: string[] | null = null;
			if (__BENCH_ISSUE278_WIRE_OPS__ && typeof event.data === 'string') {
				try {
					const envelope = JSON.parse(event.data) as [number, { batch?: { commands?: unknown[] } }];
					const commands = envelope[1]?.batch?.commands;
					if (Array.isArray(commands)) {
						commandOps = commands.map((command) => {
							const op = (command as { op?: unknown }).op;
							return typeof op === 'string' ? op : '<missing-op>';
						});
					}
				} catch {
					commandOps = ['<wire-decode-failed>'];
				}
			}
			lynx.performance?.profileMark?.('Issue278::bts-dispatch-start');
			const result = raw.dispatchEvent(event);
			const returnedAtMs = Date.now();
			lynx.performance?.profileMark?.('Issue278::bts-dispatch-return');
			wire.push({
				direction: 'bts-to-mts',
				type: event.type,
				startedAtMs,
				returnedAtMs,
				encodedBytes: typeof event.data === 'string' ? event.data.length : null,
				commandOps,
			});
			return result;
		},
		addEventListener(type: string, listener: (event: unknown) => void) {
			return raw.addEventListener(type, listener);
		},
		removeEventListener(type: string, listener: (event: unknown) => void) {
			return raw.removeEventListener(type, listener);
		},
	};
	return createLynxRoot({ context });
}

const root = issue278Root();
if (__BENCH_ISSUE278_ATTRIBUTION__) {
	(globalThis as Issue278Global).__ISSUE278_ROOT__ = root;
}

void root.render(
	__BENCH_CORE__ === 'block' && __BENCH_BLOCK_MODE__ !== 'derived' ? blockApp(App) : App,
);
