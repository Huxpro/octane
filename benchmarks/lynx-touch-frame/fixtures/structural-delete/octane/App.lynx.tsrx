/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useMainThreadRef } from '@octanejs/lynx';
import type { LynxPublicHandle } from '@octanejs/lynx';
import { useEffect, useRef, useState } from 'octane';

function LoadPane() @{
	const loadRows: { id: string; label: string }[] = [];
	for (let index = 0; index < 200; index += 1) {
		loadRows.push({ id: `load-${index + 1}`, label: `Scroll load row ${index + 1}` });
	}
	const scrollRef = useRef<LynxPublicHandle | null>(null);
	useEffect(() => {
		if (__BENCH_LOAD__ !== 'sustained-scroll') return;
		void scrollRef.current?.invoke('autoScroll', { rate: 120, start: true });
	}, []);

	<scroll-view
		ref={scrollRef}
		class="load-scroll"
		scroll-orientation="vertical"
		scroll-bar-enable={false}
	>
		<view class="load-content">
			@for (const row of loadRows; key row.id) {
				<view class={['load-row', Number(row.id.slice(5)) % 2 === 0 && 'load-row-alt']}>
					<text class="load-label">{row.label as string}</text>
				</view>
			}
		</view>
	</scroll-view>
}

export function App() @{
	const [rows, setRows] = useState(() => Array.from({ length: 16 }, (_, index) => index + 1));
	const panelRef = useMainThreadRef<object>();
	const targetRef = useMainThreadRef<object>();
	const mtsPresent = useMainThreadRef(true);

	const observeTouch = (event: Issue197TouchEvent) => {
		'main thread';
		const panel = panelRef.current;
		if (panel === null || panel === undefined) {
			throw new Error('ISSUE197_OBSERVER_FAILURE structural-delete panel ref missing at touchstart');
		}
		const inputPlatformTimestamp = event.timestamp;
		if (__BENCH_PROFILE__) {
			lynx.performance.profileMark('Issue197::T2::structural-delete::mts-input');
		}
		let changedFrameOrdinal = 0;
		const poll = (changedVsyncPlatformTimestamp: number) => {
			changedFrameOrdinal += 1;
			if (__QuerySelector(panel, '#target-8', {}) === null) {
				if (__BENCH_PROFILE__) {
					lynx.performance.profileMark('Issue197::T2::structural-delete::changed-vsync');
				}
				throw new Error(`ISSUE197_SAMPLE ${
					JSON.stringify({
						shape: 'structural-delete',
						topology: __BENCH_TOPOLOGY__,
						load: __BENCH_LOAD__,
						inputPlatformTimestamp,
						changedVsyncPlatformTimestamp,
						changedFrameOrdinal,
						inputClock: 'unix-epoch-ms',
						changedVsyncClock: 'android-uptime-ms',
						clock: 'lynx-event-epoch-ms-to-raf-uptime-ms-with-android-platform-calibration',
						observer: 'mts-capture-touchstart-raf-predicate',
					})
				}`);
			}
			if (changedFrameOrdinal >= 120) {
				throw new Error('ISSUE197_OBSERVER_FAILURE structural-delete predicate unchanged after 120 VSYNCs');
			}
			requestAnimationFrame(poll);
		};
		requestAnimationFrame(poll);
	};

	const onBackgroundTouch = () => {
		if (__BENCH_PROFILE__) {
			lynx.performance.profileMark('Issue197::T2::structural-delete::bts-handler');
		}
		setRows((current) => current.filter((row) => row !== 8));
	};

	const onMainTouch = () => {
		'main thread';
		const panel = panelRef.current;
		const target = targetRef.current;
		if (panel === null || panel === undefined || target === null || target === undefined) return;
		if (!mtsPresent.current) return;
		mtsPresent.current = false;
		__RemoveElement(panel, target);
		__FlushElementTree();
	};

	<view class="page" main-thread:capture-bindtouchstart={observeTouch}>
		<view class="header">
			<text class="title">Touch to first changed frame</text>
			<view class="remote-counter">
				<text class="remote-counter-value">0</text>
			</view>
		</view>
		<view class="interaction-panel" main-thread:ref={panelRef}>
			@for (const row of rows; key row) {
				@if (row === 8) {
					@if (__BENCH_TOPOLOGY__ === 'T2') {
						<view
							id={'target-' + row}
							class="target-row"
							main-thread:ref={targetRef}
							bindtouchstart={onBackgroundTouch}
						>
							<text class="target-label">{'Interaction row ' + row}</text>
						</view>
					} @else {
						<view
							id={'target-' + row}
							class="target-row"
							main-thread:ref={targetRef}
							main-thread:bindtouchstart={onMainTouch}
						>
							<text class="target-label">{'Interaction row ' + row}</text>
						</view>
					}
				} @else {
					<view id={'target-' + row} class="target-row">
						<text class="target-label">{'Interaction row ' + row}</text>
					</view>
				}
			}
		</view>
		<LoadPane />
	</view>
}
