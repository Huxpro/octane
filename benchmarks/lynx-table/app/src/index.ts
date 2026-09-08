import { root } from '@octanejs/lynx';

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
declare const __OCTANE_LYNX_PROFILE__: boolean;

interface BenchmarkSnapshot {
	readonly rowCount: number;
	readonly firstId: number | null;
	readonly secondId: number | null;
	readonly thirdId: number | null;
	readonly row998Id: number | null;
	readonly firstLabel: string | null;
	readonly selectedId: number | null;
}

interface NativeStartupReceipt {
	readonly protocol: 'lynx-native-startup-v1';
	readonly moduleStartMs: number;
	readonly commitAckMs: number;
	readonly firstFrameMs: number;
	readonly secondFrameMs: number;
	readonly renderEvidence: {
		readonly kind: 'native-animation-frame';
		readonly frames: 2;
	};
	readonly transportEvidence: {
		readonly kind: 'octane-root.render';
		readonly acknowledged: true;
		readonly ackMs: number;
	};
	readonly postState: BenchmarkSnapshot;
}

const benchmarkGlobal = globalThis as typeof globalThis & {
	__LYNX_BENCH_ERROR__?: string;
	__LYNX_BENCH_FLUSH__?: () => Promise<void>;
	__LYNX_BENCH_SNAPSHOT__?: () => BenchmarkSnapshot;
	__LYNX_BENCH_STARTUP__?: NativeStartupReceipt;
};
const moduleStartMs = Date.now();
benchmarkGlobal.__LYNX_BENCH_FLUSH__ = () => Promise.resolve(root.flushTransport());
const rendered = root.render(
	__BENCH_CORE__ === 'block' && __BENCH_BLOCK_MODE__ !== 'derived' ? blockApp(App) : App,
);

// The generated main-thread entry returns synchronously. Only the background
// root exposes the transport acknowledgement used by the benchmark receipt.
if (rendered !== null && typeof rendered === 'object' && 'then' in rendered) {
	void rendered.then(
		() => {
			const commitAckMs = Date.now();
			lynx.requestAnimationFrame(() => {
				const firstFrameMs = Date.now();
				lynx.requestAnimationFrame(() => {
					const secondFrameMs = Date.now();
					const postState = benchmarkGlobal.__LYNX_BENCH_SNAPSHOT__?.();
					if (postState === undefined) {
						benchmarkGlobal.__LYNX_BENCH_ERROR__ =
							'Octane Native startup completed without a semantic snapshot.';
						return;
					}
					const receipt: NativeStartupReceipt = {
						protocol: 'lynx-native-startup-v1',
						moduleStartMs,
						commitAckMs,
						firstFrameMs,
						secondFrameMs,
						renderEvidence: { kind: 'native-animation-frame', frames: 2 },
						transportEvidence: {
							kind: 'octane-root.render',
							acknowledged: true,
							ackMs: commitAckMs,
						},
						postState,
					};
					benchmarkGlobal.__LYNX_BENCH_STARTUP__ = receipt;
					console.log('__NATIVE_BENCH_STARTUP__', JSON.stringify(receipt));
				});
			});
		},
		(error: unknown) => {
			const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
			benchmarkGlobal.__LYNX_BENCH_ERROR__ = message;
			console.log('__NATIVE_BENCH_ERROR__', message);
		},
	);
}
if (__OCTANE_LYNX_PROFILE__) {
	const globals = globalThis as typeof globalThis & {
		__OCTANE_BENCH_UNMOUNT__?: () => Promise<void>;
	};
	globals.__OCTANE_BENCH_UNMOUNT__ = async () => {
		await rendered;
		await root.unmount();
		delete globals.__OCTANE_BENCH_UNMOUNT__;
	};
}
void rendered;
