/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useMainThreadRef } from '@octanejs/lynx';
import type { LynxMainThreadRefCell, LynxPublicHandle } from '@octanejs/lynx';
import { useEffect, useRef, useState } from 'octane';

const TARGET_ID = 'target-8';
const EVEN_COLOR = 'rgb(227, 242, 253)';
const ODD_COLOR = 'rgb(187, 222, 251)';

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

function RemoteCounter({
	count,
	counterRef,
	textRef,
}: {
	count: number;
	counterRef: LynxMainThreadRefCell<object | undefined>;
	textRef: LynxMainThreadRefCell<object | undefined>;
}) @{
	<view
		id="remote-counter"
		class={['remote-counter', count % 2 === 1 && 'remote-counter-odd']}
		data-count={String(count)}
		main-thread:ref={counterRef}
	>
		<text id="remote-counter-value" class="remote-counter-value" main-thread:ref={textRef}>{String(
			count,
		)}</text>
	</view>
}

export function App() @{
	const interactionRows: { id: string; label: string }[] = [];
	for (let index = 0; index < 16; index += 1) {
		interactionRows.push({
			id: `target-${index + 1}`,
			label: `Interaction row ${index + 1}`,
		});
	}
	const [count, setCount] = useState(0);
	const counterRef = useMainThreadRef<object>();
	const counterTextRef = useMainThreadRef<object>();
	const mtsCount = useMainThreadRef(0);

	const observeTouch = (event: Issue197TouchEvent) => {
		'main thread';
		const counter = counterRef.current;
		if (counter === null || counter === undefined) {
			throw new Error('ISSUE197_OBSERVER_FAILURE cross-component counter ref missing at touchstart');
		}
		const before = __GetComputedStyleByKey(counter, 'background-color');
		const inputPlatformTimestamp = event.timestamp;
		if (__BENCH_PROFILE__) {
			lynx.performance.profileMark('Issue197::T2::cross-component::mts-input');
		}
		let changedFrameOrdinal = 0;
		const poll = (changedVsyncPlatformTimestamp: number) => {
			changedFrameOrdinal += 1;
			const after = __GetComputedStyleByKey(counter, 'background-color');
			if (after !== before) {
				if (__BENCH_PROFILE__) {
					lynx.performance.profileMark('Issue197::T2::cross-component::changed-vsync');
				}
				throw new Error(`ISSUE197_SAMPLE ${
					JSON.stringify({
						shape: 'cross-component',
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
				throw new Error('ISSUE197_OBSERVER_FAILURE cross-component predicate unchanged after 120 VSYNCs');
			}
			requestAnimationFrame(poll);
		};
		requestAnimationFrame(poll);
	};

	const onBackgroundTouch = () => {
		if (__BENCH_PROFILE__) {
			lynx.performance.profileMark('Issue197::T2::cross-component::bts-handler');
		}
		setCount((value) => value + 1);
	};

	const onMainTouch = () => {
		'main thread';
		const counter = counterRef.current;
		const counterText = counterTextRef.current;
		if (
			counter === null || counter === undefined || counterText === null || counterText === undefined
		) return;
		const next = mtsCount.current + 1;
		mtsCount.current = next;
		__SetAttribute(counter, 'data-count', String(next));
		__SetAttribute(counterText, 'text', String(next));
		__AddInlineStyle(counter, 'background-color', next % 2 === 0 ? EVEN_COLOR : ODD_COLOR);
		__FlushElementTree();
	};

	<view class="page" main-thread:capture-bindtouchstart={observeTouch}>
		<view class="header">
			<text class="title">Touch to first changed frame</text>
			<RemoteCounter count={count} counterRef={counterRef} textRef={counterTextRef} />
		</view>
		<view class="interaction-panel">
			@for (const row of interactionRows; key row.id) {
				@if (row.id === TARGET_ID) {
					@if (__BENCH_TOPOLOGY__ === 'T2') {
						<view id={row.id} class="target-row" bindtouchstart={onBackgroundTouch}>
							<text class="target-label">{row.label as string}</text>
						</view>
					} @else {
						<view id={row.id} class="target-row" main-thread:bindtouchstart={onMainTouch}>
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
