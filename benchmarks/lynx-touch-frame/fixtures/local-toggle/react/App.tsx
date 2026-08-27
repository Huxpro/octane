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

export function App() {
	const [active, setActive] = useState(false);
	const targetRef = useMainThreadRef<MainThread.Element>(null);

	const observeTouch = (event: MainThread.TouchEvent) => {
		'main thread';
		const target = targetRef.current;
		if (target === null) {
			throw new Error('ISSUE197_OBSERVER_FAILURE local-toggle target ref missing at touchstart');
		}
		const styleTarget = target as Issue197ComputedStyleElement;
		const before = styleTarget.getComputedStyleProperty('background-color');
		const inputPlatformTimestamp = event.timestamp;
		if (__BENCH_PROFILE__) {
			lynx.performance.profileMark('Issue197::T1::local-toggle::mts-input');
		}
		let changedFrameOrdinal = 0;
		const poll = (changedVsyncPlatformTimestamp: number) => {
			changedFrameOrdinal += 1;
			const after = styleTarget.getComputedStyleProperty('background-color');
			if (after !== before) {
				if (__BENCH_PROFILE__) {
					lynx.performance.profileMark('Issue197::T1::local-toggle::changed-vsync');
				}
				throw new Error(
					`ISSUE197_SAMPLE ${JSON.stringify({
						shape: 'local-toggle',
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
					'ISSUE197_OBSERVER_FAILURE local-toggle predicate unchanged after 120 VSYNCs',
				);
			}
			requestAnimationFrame(poll);
		};
		requestAnimationFrame(poll);
	};
	const respondToTouch = () => {
		if (__BENCH_PROFILE__) {
			lynx.performance.profileMark('Issue197::T1::local-toggle::bts-handler');
		}
		setActive((value) => !value);
	};

	const rows = Array.from({ length: 16 }, (_, index) => index + 1);
	return (
		<view className="page" main-thread:capture-bindtouchstart={observeTouch}>
			<view className="header">
				<text className="title">Touch to first changed frame</text>
				<view className="remote-counter">
					<text className="remote-counter-value">0</text>
				</view>
			</view>
			<view className="interaction-panel">
				{rows.map((row) => {
					const target = row === 8;
					return (
						<view
							key={row}
							id={`target-${row}`}
							className={target && active ? 'target-row target-row-active' : 'target-row'}
							main-thread:ref={target ? targetRef : undefined}
							bindtouchstart={target ? respondToTouch : undefined}
						>
							<text className="target-label">Interaction row {row}</text>
						</view>
					);
				})}
			</view>
			<LoadPane />
		</view>
	);
}
