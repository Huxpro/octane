/** @jsxImportSource @octanejs/lynx/intrinsics */
// Black-box cross-framework benchmark UI — Octane variant.
//
// Mirrors apps/ui-vdom/src/App.vue and apps/ui-react/src/App.tsx
// operation-for-operation, written idiomatically for Octane: immutable state
// updates + a keyed `@for` over a `Row` component. The rendered class
// structure (.page/.toolbar/.btn>.btn-text/.rows/.row(.danger)>.col-*) is the
// harness contract and must match the other apps exactly.
import { useCallback, useRef, useState } from 'octane';

import { buildData, buildDataSeeded } from './data.js';
import type { RowData } from './data.js';

// Mount-create ladder: BENCH_AUTOROWS=N builds a variant whose table is
// already populated at mount, so create cost is measurable without taps.
declare const __BENCH_AUTOROWS__: number;
const INITIAL_ROWS: RowData[] =
	__BENCH_AUTOROWS__ > 0 ? buildDataSeeded(__BENCH_AUTOROWS__) : [];

// Count Row bodies only in the deterministic profile build. Normal browser
// and production builds fold this branch away with their existing define.
declare const __OCTANE_LYNX_PROFILE__: boolean;
function countRowRender(): void {
	if (!__OCTANE_LYNX_PROFILE__) return;
	const profile = globalThis as { __BENCH_ROW_RENDERS__?: number };
	profile.__BENCH_ROW_RENDERS__ = (profile.__BENCH_ROW_RENDERS__ ?? 0) + 1;
}

// -- storms: N sequential state→render→DOM ticks from one click --------------
// Each tick runs in its own task so every mutation goes through a full render
// cycle instead of batching. Lynx for Web provides MessageChannel; the Native
// background runtime exposes lynx.setTimeout instead. Mirrors Vue and React.
const STORM_UPDATE_TICKS = 50;
const STORM_SELECT_TICKS = 30;

const _stormChannel =
	typeof MessageChannel === 'function' ? new MessageChannel() : null;
let _stormPending: (() => void) | null = null;
if (_stormChannel !== null) {
	_stormChannel.port1.onmessage = () => {
		const cb = _stormPending;
		_stormPending = null;
		if (cb) cb();
	};
}
function nextMacrotask(cb: () => void) {
	if (_stormChannel === null) {
		lynx.setTimeout(cb, 0);
		return;
	}
	_stormPending = cb;
	_stormChannel.port2.postMessage(0);
}

interface StormEvidence {
	readonly expectedTicks: number;
	readonly completedTicks: number;
	readonly renderBarriers: number;
}

type BenchmarkActionResult = void | StormEvidence | Promise<void | StormEvidence>;

function runStorm(ticks: number, step: (t: number) => void): void | Promise<StormEvidence> {
	if (_stormChannel === null) {
		const flush = (globalThis as BenchmarkGlobal).__LYNX_BENCH_FLUSH__;
		if (flush === undefined) {
			return Promise.reject(new Error('Octane Native benchmark has no transport flush.'));
		}
		return (async () => {
			let completedTicks = 0;
			let renderBarriers = 0;
			for (let tick = 1; tick <= ticks; tick++) {
				await new Promise<void>((resolve) => lynx.setTimeout(resolve, 0));
				step(tick);
				await flush();
				completedTicks = tick;
				await nextNativeFrame();
				renderBarriers++;
			}
			return { expectedTicks: ticks, completedTicks, renderBarriers };
		})();
	}
	let t = 0;
	const tick = () => {
		t += 1;
		step(t);
		if (t < ticks) nextMacrotask(tick);
	};
	nextMacrotask(tick);
}

interface BenchmarkSnapshot {
	readonly rowCount: number;
	readonly firstId: number | null;
	readonly secondId: number | null;
	readonly thirdId: number | null;
	readonly row998Id: number | null;
	readonly firstLabel: string | null;
	readonly selectedId: number | null;
}

type BenchmarkGlobal =
	typeof globalThis & {
		__LYNX_BENCH_FLUSH__?: () => Promise<void>;
		__LYNX_BENCH_SNAPSHOT__?: () => BenchmarkSnapshot;
		__LYNX_BENCH_ERROR__?: string;
	};

function nextNativeFrame(): Promise<number> {
	return new Promise((resolve) => lynx.requestAnimationFrame(() => resolve(Date.now())));
}

function measureNative(name: string, action: () => BenchmarkActionResult): Promise<void> {
	const benchmark = globalThis as BenchmarkGlobal;
	const flush = benchmark.__LYNX_BENCH_FLUSH__;
	if (flush === undefined) {
		return Promise.reject(new Error('Octane Native benchmark has no transport flush.'));
	}
	const preState = benchmark.__LYNX_BENCH_SNAPSHOT__?.();
	if (preState === undefined) {
		return Promise.reject(new Error('Octane Native benchmark has no pre-state.'));
	}
	const startMs = Date.now();
	let result: BenchmarkActionResult;
	try {
		result = action();
	} catch (error) {
		return Promise.reject(error);
	}
	return Promise.resolve(result).then(
		(stormEvidence) => flush().then(() => {
			const commitAckMs = Date.now();
			return nextNativeFrame().then(
				(firstFrameMs) => nextNativeFrame().then((endMs) => {
					const postState = benchmark.__LYNX_BENCH_SNAPSHOT__?.();
					if (postState === undefined) {
						throw new Error('Octane Native benchmark has no post-state.');
					}
					console.log(
						'__NATIVE_BENCH_RESULT__',
						JSON.stringify({
							protocol: 'lynx-native-bench-v2',
							name,
							source: 'native-tap',
							boundary: 'native-input-handler-to-second-native-frame',
							startMs,
							commitAckMs,
							firstFrameMs,
							endMs,
							latencyMs: endMs - startMs,
							renderEvidence: { kind: 'native-animation-frame', frames: 2 },
							transportEvidence: {
								kind: 'octane-root.flushTransport',
								acknowledged: true,
								ackMs: commitAckMs,
								...(stormEvidence === undefined
									? null
									: { tickAcknowledgements: stormEvidence.completedTicks }),
							},
							preState,
							postState,
							...(stormEvidence === undefined ? null : { stormEvidence }),
						}),
					);
				}),
			);
		}),
	);
}

function measureNativeTap(name: string, action: () => BenchmarkActionResult): void {
	if (_stormChannel !== null) {
		action();
		return;
	}
	void measureNative(name, action).catch((error: unknown) => {
		const message =
			error instanceof Error ? error.stack ?? error.message : String(error);
		(globalThis as BenchmarkGlobal).__LYNX_BENCH_ERROR__ = message;
		console.log('__NATIVE_BENCH_ERROR__', message);
	});
}

interface RowProps {
	row: RowData;
	isSelected: boolean;
	onSelect: (id: number) => void;
	onRemove: (id: number) => void;
}

function Row(props: RowProps) @{
	countRowRender();
	<view class={['row', props.isSelected && 'danger']}>
		<text class="col-id">{String(props.row.id)}</text>
		<text
			class="col-label"
			bindtap={() => measureNativeTap('select', () => props.onSelect(props.row.id))}
		>{props.row.label as string}</text>
		<text
			class="col-remove"
			bindtap={() => measureNativeTap('remove', () => props.onRemove(props.row.id))}
		>{'x'}</text>
	</view>
}

export function App() @{
	const [rows, setRows] = useState<RowData[]>(INITIAL_ROWS);
	const [selected, setSelected] = useState<number | undefined>(undefined);

	const run = useCallback(() => {
		setRows(buildData());
		setSelected(undefined);
	}, []);
	const run3k = useCallback(() => {
		setRows(buildData(3000));
		setSelected(undefined);
	}, []);
	const run5k = useCallback(() => {
		setRows(buildData(5000));
		setSelected(undefined);
	}, []);
	const runLots = useCallback(() => {
		setRows(buildData(10000));
		setSelected(undefined);
	}, []);
	const run20k = useCallback(() => {
		setRows(buildData(20000));
		setSelected(undefined);
	}, []);
	const run30k = useCallback(() => {
		setRows(buildData(30000));
		setSelected(undefined);
	}, []);
	const add = useCallback(() => {
		setRows((prev) => prev.concat(buildData(1000)));
	}, []);
	const update = useCallback(() => {
		setRows((prev) => {
			const next = prev.slice();
			for (let i = 0; i < next.length; i += 10) {
				next[i] = { id: next[i]!.id, label: `${next[i]!.label} !!!` };
			}
			return next;
		});
	}, []);
	const select = useCallback((id: number) => {
		setSelected(id);
	}, []);
	const remove = useCallback((id: number) => {
		setRows((prev) => {
			const idx = prev.findIndex((d) => d.id === id);
			return prev.slice(0, idx).concat(prev.slice(idx + 1));
		});
	}, []);
	const swapRows = useCallback(() => {
		setRows((prev) => {
			if (prev.length <= 998) return prev;
			const next = prev.slice();
			const d1 = next[1]!;
			next[1] = next[998]!;
			next[998] = d1;
			return next;
		});
	}, []);
	const clear = useCallback(() => {
		setRows([]);
		setSelected(undefined);
	}, []);

	// Storm drivers and Native post-ACK predicates read refs so async work never
	// observes the render closure from before the acknowledged commit.
	const idsRef = useRef<number[]>([]);
	idsRef.current = rows.map((r) => r.id);
	const rowsRef = useRef<RowData[]>(rows);
	rowsRef.current = rows;
	const selectedRef = useRef<number | undefined>(selected);
	selectedRef.current = selected;
	(globalThis as BenchmarkGlobal).__LYNX_BENCH_SNAPSHOT__ = () => {
		const current = rowsRef.current;
		return {
			rowCount: current.length,
			firstId: current[0]?.id ?? null,
			secondId: current[1]?.id ?? null,
			thirdId: current[2]?.id ?? null,
			row998Id: current[998]?.id ?? null,
			firstLabel: current[0]?.label ?? null,
			selectedId: selectedRef.current ?? null,
		};
	};

	const stormUpdate = useCallback(() => {
		return runStorm(
			STORM_UPDATE_TICKS,
			(t) => setRows(
				(prev) => prev.map((r, i) => (i % 10 === 0 ? { id: r.id, label: 'bench ' + t } : r)),
			),
		);
	}, []);

	const stormSelect = useCallback(() => {
		return runStorm(STORM_SELECT_TICKS, (t) => {
			const ids = idsRef.current;
			setSelected(t < STORM_SELECT_TICKS ? ids[(t * 97) % ids.length]! : ids[0]!);
		});
	}, []);

	<view class="page">
		<text class="title">{'Octane UI Benchmark on Lynx · ready'}</text>
		<view class="toolbar">
			<view class="btn" bindtap={() => measureNativeTap('create', run)}>
				<text class="btn-text">{'Create 1,000 rows'}</text>
			</view>
			<view class="btn" bindtap={() => measureNativeTap('create', run3k)}>
				<text class="btn-text">{'Create 3,000 rows'}</text>
			</view>
			<view class="btn" bindtap={() => measureNativeTap('create', run5k)}>
				<text class="btn-text">{'Create 5,000 rows'}</text>
			</view>
			<view class="btn" bindtap={() => measureNativeTap('create', runLots)}>
				<text class="btn-text">{'Create 10,000 rows'}</text>
			</view>
			<view class="btn" bindtap={() => measureNativeTap('create', run20k)}>
				<text class="btn-text">{'Create 20,000 rows'}</text>
			</view>
			<view class="btn" bindtap={() => measureNativeTap('create', run30k)}>
				<text class="btn-text">{'Create 30,000 rows'}</text>
			</view>
			<view class="btn" bindtap={() => measureNativeTap('append1k', add)}>
				<text class="btn-text">{'Append 1,000 rows'}</text>
			</view>
			<view class="btn" bindtap={() => measureNativeTap('update10th', update)}>
				<text class="btn-text">{'Update every 10th row'}</text>
			</view>
			<view class="btn" bindtap={() => measureNativeTap('swap', swapRows)}>
				<text class="btn-text">{'Swap Rows'}</text>
			</view>
			<view class="btn" bindtap={() => measureNativeTap('clear', clear)}>
				<text class="btn-text">{'Clear'}</text>
			</view>
			<view class="btn" bindtap={() => measureNativeTap('updateStorm', stormUpdate)}>
				<text class="btn-text">{'Update storm'}</text>
			</view>
			<view class="btn" bindtap={() => measureNativeTap('selectStorm', stormSelect)}>
				<text class="btn-text">{'Select storm'}</text>
			</view>
		</view>
		<view class="rows">
			@for (const row of rows; key row.id) {
				<Row row={row} isSelected={selected === row.id} onSelect={select} onRemove={remove} />
			}
		</view>
	</view>
}
