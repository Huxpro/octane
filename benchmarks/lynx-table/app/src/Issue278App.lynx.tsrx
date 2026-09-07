/** @jsxImportSource @octanejs/lynx/intrinsics */
// Black-box cross-framework benchmark UI — Octane variant.
//
// Mirrors apps/ui-vdom/src/App.vue and apps/ui-react/src/App.tsx
// operation-for-operation, written idiomatically for Octane: immutable state
// updates + a keyed `@for` over a `Row` component. The rendered class
// structure (.page/.toolbar/.btn>.btn-text/.rows/.row(.danger)>.col-*) is the
// harness contract and must match the other apps exactly.
import { runOnMainThread } from '@octanejs/lynx';
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
declare const __BENCH_ISSUE278_ATTRIBUTION__: boolean;
declare const __BENCH_ISSUE278_TIMELINE__: boolean;
function countRowRender(): void {
	if (!__OCTANE_LYNX_PROFILE__) return;
	const profile = globalThis as { __BENCH_ROW_RENDERS__?: number };
	profile.__BENCH_ROW_RENDERS__ = (profile.__BENCH_ROW_RENDERS__ ?? 0) + 1;
}

interface Issue278Profile {
	readonly [name: string]: number;
}

interface Issue278CodecProfile {
	readonly [name: string]: number | Readonly<Record<string, number>>;
}

interface Issue278Snapshot {
	readonly rowCount: number;
	readonly firstId: number | null;
	readonly row998Id: number | null;
	readonly firstLabel: string | null;
}

interface Issue278WireEvent {
	readonly direction: 'bts-to-mts';
	readonly type: string;
	readonly startedAtMs: number;
	readonly returnedAtMs: number;
	readonly encodedBytes: number | null;
	readonly codecFlag: 0 | 1 | null;
}

type Issue278Global =
	typeof globalThis & {
		__OCTANE_LYNX_PROF?: Record<string, unknown>;
		__ISSUE278_CODEC_PROFILE__?: Record<string, unknown>;
		__ISSUE278_COMMIT_SNAPSHOT__?: {
			readonly atMs: number;
			readonly profile: Record<string, number | Record<string, number>> | null;
			readonly codecProfile: Record<string, number | Record<string, number>> | null;
			readonly timeline: Record<string, number> | null;
		};
		__ISSUE278_ROOT__?: { flushTransport(): Promise<void> };
		__ISSUE278_WIRE__?: Issue278WireEvent[];
		__ISSUE278_RUN_CREATE__?: (rows: number) => Promise<unknown>;
		__ISSUE278_CALIBRATE_CLOCK__?: () => Promise<unknown>;
		__ISSUE278_RUN_ECHO__?: (bytes: number) => Promise<unknown>;
		__ISSUE278_RUN_VM_CALIBRATION__?: (iterations: number) => Promise<unknown>;
		__ISSUE278_RUN_PAPI_FLOOR__?: (rows: number) => Promise<unknown>;
		__ISSUE278_SNAPSHOT__?: () => Issue278Snapshot;
		__ISSUE278_LAST__?: unknown;
		__ISSUE278_PROGRESS__?: string;
	};

function copyIssue278Profile(): Issue278Profile | null {
	const raw = (globalThis as Issue278Global).__OCTANE_LYNX_PROF;
	if (raw === undefined) return null;
	const copy: Record<string, number> = {};
	for (const name of Object.keys(raw)) {
		const value = raw[name];
		if (typeof value === 'number') copy[name] = value;
	}
	return copy;
}

function copyIssue278CodecProfile(): Issue278CodecProfile | null {
	const raw = (globalThis as Issue278Global).__ISSUE278_CODEC_PROFILE__;
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

function resetIssue278Profile(): void {
	const target = globalThis as Issue278Global;
	for (const raw of [target.__OCTANE_LYNX_PROF, target.__ISSUE278_CODEC_PROFILE__]) {
		if (raw === undefined) continue;
		for (const name of Object.keys(raw)) {
			if (typeof raw[name] === 'number') raw[name] = 0;
			else if (raw[name] !== null && typeof raw[name] === 'object') raw[name] = {};
		}
	}
}

function issue278Calibration(iterations: number): { elapsedMs: number; checksum: number } {
	let checksum = 0x9e3779b9;
	const startedAtMs = Date.now();
	for (let index = 0; index < iterations; index++) {
		checksum = Math.imul(checksum ^ index, 1664525) + 1013904223;
		checksum ^= checksum >>> 13;
	}
	return { elapsedMs: Date.now() - startedAtMs, checksum: checksum >>> 0 };
}

// -- storms: N sequential state→render→DOM ticks from one click --------------
// Each tick runs in its own macrotask (MessageChannel avoids the nested
// setTimeout 4ms clamp) so every mutation goes through a full render cycle
// instead of batching. Mirrors the Vue and React apps.
const STORM_UPDATE_TICKS = 50;
const STORM_SELECT_TICKS = 30;

const _stormChannel = new MessageChannel();
let _stormPending: (() => void) | null = null;
_stormChannel.port1.onmessage = () => {
	const cb = _stormPending;
	_stormPending = null;
	if (cb) cb();
};
function nextMacrotask(cb: () => void) {
	_stormPending = cb;
	_stormChannel.port2.postMessage(0);
}

function runStorm(ticks: number, step: (t: number) => void) {
	let t = 0;
	const tick = () => {
		t += 1;
		step(t);
		if (t < ticks) nextMacrotask(tick);
	};
	nextMacrotask(tick);
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
		<text class="col-label" bindtap={() => props.onSelect(props.row.id)}>{props.row.label}</text>
		<text class="col-remove" bindtap={() => props.onRemove(props.row.id)}>{'x'}</text>
	</view>
}

export function Issue278ScalarPlaceholder() @{
	<text class="issue278-scalar-placeholder">{'scalar placeholder'}</text>
}

export function Issue278ScalarCard(props: { label: string }) @{
	<view class="issue278-addressed-card">
		<text class="issue278-scalar-label">{props.label as string}</text>
	</view>
}

export function App() @{
	const [rows, setRows] = useState<RowData[]>(INITIAL_ROWS);
	const [selected, setSelected] = useState<number | undefined>(undefined);

	const readMainProfile = () => {
		'main thread';
		const target = globalThis as {
			__ISSUE278_COMMIT_SNAPSHOT__?: {
				readonly atMs: number;
				readonly profile: Record<string, number | Record<string, number>> | null;
				readonly codecProfile: Record<string, number | Record<string, number>> | null;
				readonly timeline: Record<string, number> | null;
			};
		};
		return target.__ISSUE278_COMMIT_SNAPSHOT__ ?? null;
	};
	const echoOnMain = (value: string) => {
		'main thread';
		return { value, receivedAtMs: Date.now() };
	};
	const calibrateMain = (iterations: number) => {
		'main thread';
		let checksum = 0x9e3779b9;
		const startedAtMs = Date.now();
		for (let index = 0; index < iterations; index++) {
			checksum = Math.imul(checksum ^ index, 1664525) + 1013904223;
			checksum ^= checksum >>> 13;
		}
		return { elapsedMs: Date.now() - startedAtMs, checksum: checksum >>> 0 };
	};
	const papiFloorOnMain = (count: number) => {
		'main thread';
		// This is deliberately a detached, independently-created page. Keeping the
		// floor out of the benchmark's resident template avoids a main-thread ref,
		// which would make that template ineligible for mount-program-run and would
		// change the path being attributed. Page/container setup is outside timing.
		const page = __CreatePage('issue278-papi-floor', 0);
		const uid = __GetElementUniqueID(page);
		const rowsContainer = __CreateView(uid);
		__SetClasses(rowsContainer, 'rows');
		__AppendElement(page, rowsContainer);
		const views = new Array(count);
		const idTexts = new Array(count);
		const labelTexts = new Array(count);
		const removeTexts = new Array(count);
		const idRaws = new Array(count);
		const labelRaws = new Array(count);
		const removeRaws = new Array(count);
		const startedAtMs = Date.now();
		for (let index = 0; index < count; index++) {
			views[index] = __CreateView(uid);
			idTexts[index] = __CreateText(uid);
			labelTexts[index] = __CreateText(uid);
			removeTexts[index] = __CreateText(uid);
			idRaws[index] = __CreateRawText(String(index + 1));
			labelRaws[index] = __CreateRawText('pretty red table');
			removeRaws[index] = __CreateRawText('x');
		}
		const factoriesEndMs = Date.now();
		for (let index = 0; index < count; index++) {
			__SetClasses(views[index], 'row');
			__SetClasses(idTexts[index], 'col-id');
			__SetClasses(labelTexts[index], 'col-label');
			__SetClasses(removeTexts[index], 'col-remove');
			__AddEvent(labelTexts[index], 'bindEvent', 'tap', `issue278-${index}-select`);
			__AddEvent(removeTexts[index], 'bindEvent', 'tap', `issue278-${index}-remove`);
		}
		const propsEndMs = Date.now();
		for (let index = 0; index < count; index++) {
			const view = views[index];
			__AppendElement(view, idTexts[index]);
			__AppendElement(idTexts[index], idRaws[index]);
			__AppendElement(view, labelTexts[index]);
			__AppendElement(labelTexts[index], labelRaws[index]);
			__AppendElement(view, removeTexts[index]);
			__AppendElement(removeTexts[index], removeRaws[index]);
			__AppendElement(rowsContainer, view);
		}
		const treeEndMs = Date.now();
		__FlushElementTree(page);
		const flushEndMs = Date.now();
		return {
			rows: count,
			hosts: count * 7,
			factoriesMs: factoriesEndMs - startedAtMs,
			propsAndEventsMs: propsEndMs - factoriesEndMs,
			treeMs: treeEndMs - propsEndMs,
			flushReturnMs: flushEndMs - treeEndMs,
			totalMs: flushEndMs - startedAtMs,
		};
	};

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

	// Storm drivers read ids off a ref so the module-scope tick loop never
	// captures a stale rows binding (same shape as the React app).
	const idsRef = useRef<number[]>([]);
	idsRef.current = rows.map((r) => r.id);
	const rowsRef = useRef<RowData[]>(rows);
	rowsRef.current = rows;
	const snapshot = (): Issue278Snapshot => {
		const current = rowsRef.current;
		return {
			rowCount: current.length,
			firstId: current[0]?.id ?? null,
			row998Id: current[998]?.id ?? null,
			firstLabel: current[0]?.label ?? null,
		};
	};
	if (__BENCH_ISSUE278_ATTRIBUTION__) {
		const target = globalThis as Issue278Global;
		target.__ISSUE278_SNAPSHOT__ = snapshot;
		target.__ISSUE278_CALIBRATE_CLOCK__ = async () => {
			const samples = [];
			for (let ordinal = 0; ordinal < 7; ordinal++) {
				const value = `issue278-clock-${ordinal}`;
				const startedAtMs = Date.now();
				const echoed = await runOnMainThread(echoOnMain)(value);
				const returnedAtMs = Date.now();
				if (echoed.value !== value) throw new Error('issue #278 clock echo changed its payload.');
				samples.push({
					ordinal,
					startedAtMs,
					receivedAtMs: echoed.receivedAtMs,
					returnedAtMs,
					roundTripMs: returnedAtMs - startedAtMs,
				});
			}
			const best = samples.reduce(
				(left, right) => right.roundTripMs < left.roundTripMs ? right : left,
			);
			return {
				protocol: 'octane-issue278-cross-realm-clock-v1',
				samples,
				offsetMs: best.receivedAtMs - (best.startedAtMs + best.returnedAtMs) / 2,
				uncertaintyMs: best.roundTripMs / 2,
			};
		};
		target.__ISSUE278_RUN_CREATE__ = async (count: number) => {
			if (!Number.isInteger(count) || count <= 0) throw new Error('row count must be positive.');
			const root = target.__ISSUE278_ROOT__;
			if (root === undefined) throw new Error('issue #278 root is unavailable.');
			target.__ISSUE278_PROGRESS__ = 'reset-bts-profile';
			resetIssue278Profile();
			const wire = target.__ISSUE278_WIRE__;
			if (wire !== undefined) wire.length = 0;
			const preState = snapshot();
			const startedAtMs = Date.now();
			lynx.performance?.profileMark?.('Issue278::create-start');
			setRows(buildData(count));
			setSelected(undefined);
			target.__ISSUE278_PROGRESS__ = 'commit-flush';
			await root.flushTransport();
			target.__ISSUE278_PROGRESS__ = 'commit-acked';
			const commitAckMs = Date.now();
			lynx.performance?.profileMark?.('Issue278::commit-ack');
			const btsProfile = copyIssue278Profile();
			const btsCodecProfile = copyIssue278CodecProfile();
			const operationWire =
				wire === undefined ? [] : wire.slice();
			const postState = snapshot();
			target.__ISSUE278_PROGRESS__ = 'read-main-profile';
			const mts =
				__OCTANE_LYNX_PROFILE__ || __BENCH_ISSUE278_TIMELINE__
					? await runOnMainThread(readMainProfile)()
					: { atMs: null, profile: null, codecProfile: null, timeline: null };
			if ((__OCTANE_LYNX_PROFILE__ || __BENCH_ISSUE278_TIMELINE__) && mts === null) {
				throw new Error('issue #278 main-thread commit snapshot is unavailable.');
			}
			const result = {
				protocol: 'octane-issue278-create-v2',
				rows: count,
				boundary: 'programmatic-bts-state-update-to-commit-complete',
				startedAtMs,
				commitAckMs,
				wallMs: commitAckMs - startedAtMs,
				preState,
				postState,
				btsProfile,
				btsCodecProfile,
				mtsProfile: mts.profile,
				mtsCodecProfile: mts.codecProfile,
				mtsTimeline: mts.timeline,
				mtsSnapshotAtMs: mts.atMs,
				wire: operationWire,
			};
			target.__ISSUE278_LAST__ = result;
			target.__ISSUE278_PROGRESS__ = 'complete';
			console.log('__ISSUE278_CREATE__', JSON.stringify(result));
			return result;
		};
		target.__ISSUE278_RUN_ECHO__ = async (bytes: number) => {
			const value = 'x'.repeat(bytes);
			const startedAtMs = Date.now();
			const echoed = await runOnMainThread(echoOnMain)(value);
			const returnedAtMs = Date.now();
			return {
				protocol: 'octane-issue278-echo-v1',
				bytes,
				startedAtMs,
				receivedAtMs: echoed.receivedAtMs,
				returnedAtMs,
				roundTripMs: returnedAtMs - startedAtMs,
				correct: echoed.value.length === bytes && echoed.value === value,
			};
		};
		target.__ISSUE278_RUN_VM_CALIBRATION__ = async (iterations: number) => ({
			protocol: 'octane-issue278-vm-calibration-v1',
			iterations,
			bts: issue278Calibration(iterations),
			mts: await runOnMainThread(calibrateMain)(iterations),
		});
		target.__ISSUE278_RUN_PAPI_FLOOR__ = (count: number) => runOnMainThread(papiFloorOnMain)(count);
	}

	const stormUpdate = useCallback(() => {
		runStorm(
			STORM_UPDATE_TICKS,
			(t) => setRows(
				(prev) => prev.map((r, i) => (i % 10 === 0 ? { id: r.id, label: 'bench ' + t } : r)),
			),
		);
	}, []);

	const stormSelect = useCallback(() => {
		runStorm(STORM_SELECT_TICKS, (t) => {
			const ids = idsRef.current;
			setSelected(t < STORM_SELECT_TICKS ? ids[(t * 97) % ids.length]! : ids[0]!);
		});
	}, []);

	<view class="page">
		<text class="title">{'Octane UI Benchmark on Lynx · ready'}</text>
		<view class="toolbar">
			<view class="btn" bindtap={run}>
				<text class="btn-text">{'Create 1,000 rows'}</text>
			</view>
			<view class="btn" bindtap={run3k}>
				<text class="btn-text">{'Create 3,000 rows'}</text>
			</view>
			<view class="btn" bindtap={run5k}>
				<text class="btn-text">{'Create 5,000 rows'}</text>
			</view>
			<view class="btn" bindtap={runLots}>
				<text class="btn-text">{'Create 10,000 rows'}</text>
			</view>
			<view class="btn" bindtap={run20k}>
				<text class="btn-text">{'Create 20,000 rows'}</text>
			</view>
			<view class="btn" bindtap={run30k}>
				<text class="btn-text">{'Create 30,000 rows'}</text>
			</view>
			<view class="btn" bindtap={add}>
				<text class="btn-text">{'Append 1,000 rows'}</text>
			</view>
			<view class="btn" bindtap={update}>
				<text class="btn-text">{'Update every 10th row'}</text>
			</view>
			<view class="btn" bindtap={swapRows}>
				<text class="btn-text">{'Swap Rows'}</text>
			</view>
			<view class="btn" bindtap={clear}>
				<text class="btn-text">{'Clear'}</text>
			</view>
			<view class="btn" bindtap={stormUpdate}>
				<text class="btn-text">{'Update storm'}</text>
			</view>
			<view class="btn" bindtap={stormSelect}>
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
