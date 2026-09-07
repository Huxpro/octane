import { createLynxRoot, root as defaultRoot } from '@octanejs/lynx';

import { App, Issue278ScalarCard, Issue278ScalarPlaceholder } from './Issue278App.lynx.tsrx';
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
declare const __BENCH_ISSUE278_SCALAR__: boolean;
declare const __BENCH_ISSUE278_VALIDATION__: 'checked' | 'trusted';

interface Issue278WireEvent {
	readonly direction: 'bts-to-mts';
	readonly type: string;
	readonly startedAtMs: number;
	readonly returnedAtMs: number;
	readonly encodedBytes: number | null;
	readonly codecFlag: 0 | 1 | null;
}

type Issue278Global = typeof globalThis & {
	__OCTANE_LYNX_PROF?: Record<string, unknown>;
	__ISSUE278_CODEC_PROFILE__?: Record<string, unknown>;
	__ISSUE278_ROOT__?: ReturnType<typeof createLynxRoot>;
	__ISSUE278_WIRE__?: Issue278WireEvent[];
	__ISSUE278_RUN_SCALAR__?: () => Promise<unknown>;
	__ISSUE278_PROGRESS__?: string;
};

function resetIssue278BackgroundProfiles(target: Issue278Global): void {
	for (const raw of [target.__OCTANE_LYNX_PROF, target.__ISSUE278_CODEC_PROFILE__]) {
		if (raw === undefined) continue;
		for (const name of Object.keys(raw)) {
			if (typeof raw[name] === 'number') raw[name] = 0;
			else if (raw[name] !== null && typeof raw[name] === 'object') raw[name] = {};
		}
	}
}

function copyIssue278BackgroundRecord(
	raw: Record<string, unknown> | undefined,
): Record<string, number | Record<string, number>> | null {
	if (raw === undefined) return null;
	const copy: Record<string, number | Record<string, number>> = {};
	for (const name of Object.keys(raw)) {
		const value = raw[name];
		if (typeof value === 'number') copy[name] = value;
		else if (value !== null && typeof value === 'object') {
			const nested: Record<string, number> = {};
			for (const key of Object.keys(value)) {
				const count = (value as Record<string, unknown>)[key];
				if (typeof count === 'number') nested[key] = count;
			}
			copy[name] = nested;
		}
	}
	return copy;
}

function issue278Root() {
	if (!__BENCH_ISSUE278_ATTRIBUTION__) return defaultRoot;
	const raw = lynx.getCoreContext();
	const wire: Issue278WireEvent[] = [];
	(globalThis as Issue278Global).__ISSUE278_WIRE__ = wire;
	const context = {
		dispatchEvent(event: { type: string; data?: unknown }) {
			const startedAtMs = Date.now();
			const codecFlag =
				typeof event.data !== 'string'
					? null
					: event.data.startsWith('[0,')
						? 0
						: event.data.startsWith('[1,')
							? 1
							: null;
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
				codecFlag,
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
	return createLynxRoot({ context, validation: __BENCH_ISSUE278_VALIDATION__ });
}

const root = issue278Root();
const initialRender = __BENCH_ISSUE278_SCALAR__
	? root.render(Issue278ScalarPlaceholder)
	: root.render(
			__BENCH_CORE__ === 'block' && __BENCH_BLOCK_MODE__ !== 'derived' ? blockApp(App) : App,
		);
if (__BENCH_ISSUE278_ATTRIBUTION__) {
	const target = globalThis as Issue278Global;
	target.__ISSUE278_ROOT__ = root;
	if (__BENCH_ISSUE278_SCALAR__) {
		target.__ISSUE278_RUN_SCALAR__ = async () => {
			// The runner has already observed the placeholder in the Native DOM.
			// Explorer keeps both its first root.render() promise and an idle
			// flushTransport() pending after that observable commit. Neither is a
			// usable second readiness gate; the update's own flush below is its commit
			// boundary.
			target.__ISSUE278_PROGRESS__ = 'scalar-reset';
			resetIssue278BackgroundProfiles(target);
			const wire = target.__ISSUE278_WIRE__;
			if (wire !== undefined) wire.length = 0;
			const startedAtMs = Date.now();
			lynx.performance?.profileMark?.('Issue278::scalar-start');
			target.__ISSUE278_PROGRESS__ = 'scalar-render';
			void root.render(Issue278ScalarCard, { label: 'scalar addressed program' });
			target.__ISSUE278_PROGRESS__ = 'scalar-flush';
			await root.flushTransport();
			target.__ISSUE278_PROGRESS__ = 'scalar-acked';
			const commitAckMs = Date.now();
			lynx.performance?.profileMark?.('Issue278::scalar-ack');
			return {
				protocol: 'octane-issue278-scalar-v2',
				startedAtMs,
				commitAckMs,
				wallMs: commitAckMs - startedAtMs,
				btsProfile: copyIssue278BackgroundRecord(target.__OCTANE_LYNX_PROF),
				btsCodecProfile: copyIssue278BackgroundRecord(target.__ISSUE278_CODEC_PROFILE__),
				wire: wire === undefined ? [] : wire.slice(),
			};
		};
	}
}

void initialRender;
