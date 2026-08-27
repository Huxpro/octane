import { runOnMainThread, useEffect, useMainThreadRef, useState } from '@lynx-js/react';
import type { MainThread } from '@lynx-js/types';

interface Issue197ComputedStyleElement extends MainThread.Element {
	getComputedStyleProperty(name: string): string;
}

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

function RemoteCounter({
	count,
	counterRef,
}: {
	count: number;
	counterRef: { current: MainThread.Element | null };
}) {
	return (
		<view
			id="remote-counter"
			className={count % 2 === 0 ? 'remote-counter' : 'remote-counter remote-counter-odd'}
			main-thread:ref={counterRef}
		>
			<text id="remote-counter-value" className="remote-counter-value">
				{count}
			</text>
		</view>
	);
}

export function App() {
	const [count, setCount] = useState(0);
	const counterRef = useMainThreadRef<MainThread.Element>(null);

	const observeTouch = (event: MainThread.TouchEvent) => {
		'main thread';
		const counter = counterRef.current;
		if (counter === null) {
			throw new Error(
				'ISSUE197_OBSERVER_FAILURE cross-component counter ref missing at touchstart',
			);
		}
		const styleCounter = counter as Issue197ComputedStyleElement;
		const before = styleCounter.getComputedStyleProperty('background-color');
		const inputPlatformTimestamp = event.timestamp;
		if (__BENCH_PROFILE__) {
			lynx.performance.profileMark('Issue197::T1::cross-component::mts-input');
		}
		let changedFrameOrdinal = 0;
		const poll = (changedVsyncPlatformTimestamp: number) => {
			changedFrameOrdinal += 1;
			const after = styleCounter.getComputedStyleProperty('background-color');
			if (after !== before) {
				if (__BENCH_PROFILE__) {
					lynx.performance.profileMark('Issue197::T1::cross-component::changed-vsync');
				}
				throw new Error(
					`ISSUE197_SAMPLE ${JSON.stringify({
						shape: 'cross-component',
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
					'ISSUE197_OBSERVER_FAILURE cross-component predicate unchanged after 120 VSYNCs',
				);
			}
			requestAnimationFrame(poll);
		};
		requestAnimationFrame(poll);
	};
	const respondToTouch = () => {
		if (__BENCH_PROFILE__) {
			lynx.performance.profileMark('Issue197::T1::cross-component::bts-handler');
		}
		setCount((value) => value + 1);
	};

	const rows = Array.from({ length: 16 }, (_, index) => index + 1);
	return (
		<view className="page" main-thread:capture-bindtouchstart={observeTouch}>
			<view className="header">
				<text className="title">Touch to first changed frame</text>
				<RemoteCounter count={count} counterRef={counterRef} />
			</view>
			<view className="interaction-panel">
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
