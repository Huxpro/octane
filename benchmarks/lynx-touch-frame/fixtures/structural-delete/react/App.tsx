import { runOnMainThread, useEffect, useMainThreadRef, useState } from '@lynx-js/react';
import type { MainThread } from '@lynx-js/types';

const TARGET_ID = 'target-8';

function LoadPane() {
	const scrollRef = useMainThreadRef<MainThread.Element>(null);
	const startAutoScroll = () => {
		'main thread';
		void scrollRef.current?.invoke('autoScroll', { rate: 120, start: true });
	};
	useEffect(() => {
		if (__BENCH_LOAD__ !== 'sustained-scroll') return;
		void runOnMainThread(startAutoScroll)();
	}, []);

	const rows = Array.from({ length: 200 }, (_, index) => index + 1);
	return (
		<scroll-view
			main-thread:ref={scrollRef}
			className="load-scroll"
			scroll-orientation="vertical"
			scroll-bar-enable={false}
		>
			<view className="load-content">
				{rows.map((row) => (
					<view key={row} className={row % 2 === 0 ? 'load-row load-row-alt' : 'load-row'}>
						<text className="load-label">Scroll load row {row}</text>
					</view>
				))}
			</view>
		</scroll-view>
	);
}

export function App() {
	const [rows, setRows] = useState(() => Array.from({ length: 16 }, (_, index) => index + 1));
	const panelRef = useMainThreadRef<MainThread.Element>(null);

	const observeTouch = (event: MainThread.TouchEvent) => {
		'main thread';
		const panel = panelRef.current;
		if (panel === null) {
			throw new Error(
				'ISSUE197_OBSERVER_FAILURE structural-delete panel ref missing at touchstart',
			);
		}
		const inputPlatformTimestamp = event.timestamp;
		if (__BENCH_PROFILE__) {
			lynx.performance.profileMark('Issue197::T1::structural-delete::mts-input');
		}
		let changedFrameOrdinal = 0;
		const poll = (changedVsyncPlatformTimestamp: number) => {
			changedFrameOrdinal += 1;
			if (panel.querySelector(`#${TARGET_ID}`) === null) {
				if (__BENCH_PROFILE__) {
					lynx.performance.profileMark('Issue197::T1::structural-delete::changed-vsync');
				}
				throw new Error(
					`ISSUE197_SAMPLE ${JSON.stringify({
						shape: 'structural-delete',
						topology: 'T1',
						load: __BENCH_LOAD__,
						inputPlatformTimestamp,
						changedVsyncPlatformTimestamp,
						changedFrameOrdinal,
						inputClock: 'unix-epoch-ms',
						changedVsyncClock: 'android-uptime-ms',
						clock: 'lynx-event-epoch-ms-to-raf-uptime-ms-with-android-platform-calibration',
						observer: 'mts-capture-touchstart-raf-predicate',
					})}`,
				);
			}
			if (changedFrameOrdinal >= 120) {
				throw new Error(
					'ISSUE197_OBSERVER_FAILURE structural-delete predicate unchanged after 120 VSYNCs',
				);
			}
			requestAnimationFrame(poll);
		};
		requestAnimationFrame(poll);
	};
	const respondToTouch = () => {
		if (__BENCH_PROFILE__) {
			lynx.performance.profileMark('Issue197::T1::structural-delete::bts-handler');
		}
		setRows((current) => current.filter((id) => id !== 8));
	};

	return (
		<view className="page" main-thread:capture-bindtouchstart={observeTouch}>
			<view className="header">
				<text className="title">Touch to first changed frame</text>
				<view className="remote-counter">
					<text className="remote-counter-value">0</text>
				</view>
			</view>
			<view className="interaction-panel" main-thread:ref={panelRef}>
				{rows.map((row) => (
					<view
						key={row}
						id={`target-${row}`}
						className="target-row"
						bindtouchstart={row === 8 ? respondToTouch : undefined}
					>
						<text className="target-label">Interaction row {row}</text>
					</view>
				))}
			</view>
			<LoadPane />
		</view>
	);
}
