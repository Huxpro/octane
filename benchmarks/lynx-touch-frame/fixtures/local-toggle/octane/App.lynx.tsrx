/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useMainThreadRef } from '@octanejs/lynx';
import type { LynxPublicHandle } from '@octanejs/lynx';
import { useEffect, useRef, useState } from 'octane';

const TARGET_ID = 'target-8';
const IDLE_COLOR = 'rgb(255, 255, 255)';
const ACTIVE_COLOR = 'rgb(255, 213, 79)';

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
	const interactionRows: { id: string; label: string }[] = [];
	for (let index = 0; index < 16; index += 1) {
		interactionRows.push({
			id: `target-${index + 1}`,
			label: `Interaction row ${index + 1}`,
		});
	}
	const [active, setActive] = useState(false);
	const pageRef = useMainThreadRef<object>();
	const targetRef = useMainThreadRef<object>();
	const mtsActive = useMainThreadRef(false);

	const observeTouch = (event: Issue197TouchEvent) => {
		'main thread';
		const target = targetRef.current;
		if (target === null || target === undefined) {
			throw new Error('ISSUE197_OBSERVER_FAILURE local-toggle target ref missing at touchstart');
		}
		const before = __GetComputedStyleByKey(target, 'background-color');
		const inputPlatformTimestamp = event.timestamp;
		if (__BENCH_PROFILE__) {
			lynx.performance.profileMark('Issue197::T2::local-toggle::mts-input');
		}
		let changedFrameOrdinal = 0;
		const poll = (changedVsyncPlatformTimestamp: number) => {
			changedFrameOrdinal += 1;
			const after = __GetComputedStyleByKey(target, 'background-color');
			if (after !== before) {
				if (__BENCH_PROFILE__) {
					lynx.performance.profileMark('Issue197::T2::local-toggle::changed-vsync');
				}
				throw new Error(`ISSUE197_SAMPLE ${
					JSON.stringify({
						shape: 'local-toggle',
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
				throw new Error('ISSUE197_OBSERVER_FAILURE local-toggle predicate unchanged after 120 VSYNCs');
			}
			requestAnimationFrame(poll);
		};
		requestAnimationFrame(poll);
	};

	const onBackgroundTouch = () => {
		if (__BENCH_PROFILE__) {
			lynx.performance.profileMark('Issue197::T2::local-toggle::bts-handler');
		}
		setActive((value) => !value);
	};

	const onMainTouch = () => {
		'main thread';
		const target = targetRef.current;
		if (target === null || target === undefined) return;
		const next = !mtsActive.current;
		mtsActive.current = next;
		__AddInlineStyle(target, 'background-color', next ? ACTIVE_COLOR : IDLE_COLOR);
		__FlushElementTree();
	};

	<view class="page" main-thread:ref={pageRef} main-thread:capture-bindtouchstart={observeTouch}>
		<view class="header">
			<text class="title">Touch to first changed frame</text>
			<view class="remote-counter">
				<text class="remote-counter-value">0</text>
			</view>
		</view>
		<view class="interaction-panel">
			@for (const row of interactionRows; key row.id) {
				@if (row.id === TARGET_ID) {
					@if (__BENCH_TOPOLOGY__ === 'T2') {
						<view
							id={row.id}
							class={['target-row', active && 'target-row-active']}
							main-thread:ref={targetRef}
							bindtouchstart={onBackgroundTouch}
						>
							<text class="target-label">{row.label as string}</text>
						</view>
					} @else {
						<view
							id={row.id}
							class="target-row"
							main-thread:ref={targetRef}
							main-thread:bindtouchstart={onMainTouch}
						>
							<text class="target-label">{row.label as string}</text>
						</view>
					}
				} @else {
					<view id={row.id} class="target-row">
						<text class="target-label">{row.label as string}</text>
					</view>
				}
			}
		</view>
		<LoadPane />
	</view>
}
