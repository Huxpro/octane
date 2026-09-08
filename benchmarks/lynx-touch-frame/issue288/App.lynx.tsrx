import { useMainThreadRef } from '@octanejs/lynx';
import type { LynxMainThreadRefCell } from '@octanejs/lynx';
import { createContext, memo, useContext, useState } from 'octane';

declare const __ISSUE288_ARM__: string;
declare const __ISSUE288_DEPTH__: number;
declare const __ISSUE288_PROFILE__: boolean;
declare const __ISSUE288_ROWS__: number;

interface BenchRow {
	readonly id: number;
	readonly label: string;
}

const ROWS: readonly BenchRow[] = Array.from(
	{ length: __ISSUE288_ROWS__ },
	(_, index) => ({
		id: index + 1,
		label: `Context row ${index + 1}`,
	}),
);
const CONSUMER = Math.floor(__ISSUE288_ROWS__ / 2);
const Tone = createContext('light');

interface PlainRowProps {
	readonly row: BenchRow;
}

function PlainRow(props: PlainRowProps) @{
	<view class="context-row" id={`context-row-${props.row.id}`}>
		<text class="context-label">{props.row.label as string}</text>
	</view>
}

const MemoPlainRow = memo(PlainRow);

interface ContextLeafProps {
	readonly leafRef: LynxMainThreadRefCell<object | undefined>;
}

function ContextLeaf(props: ContextLeafProps) @{
	const tone = useContext(Tone);
	<view id="context-leaf" class={['context-leaf', tone]} main-thread:ref={props.leafRef}>
		<text class="context-label">{tone as string}</text>
	</view>
}

const MemoContextLeaf = memo(ContextLeaf);

interface ContextLayerProps {
	readonly depth: number;
	readonly leafRef: LynxMainThreadRefCell<object | undefined>;
}

function ContextLayer(props: ContextLayerProps) @{
	@if (props.depth === 0) {
		<MemoContextLeaf leafRef={props.leafRef} />
	} @else {
		<view class="context-layer">
			<MemoContextLayer depth={props.depth - 1} leafRef={props.leafRef} />
		</view>
	}
}

const MemoContextLayer = memo(ContextLayer);

interface ConsumerRowProps {
	readonly depth: number;
	readonly leafRef: LynxMainThreadRefCell<object | undefined>;
	readonly row: BenchRow;
}

function ConsumerRow(props: ConsumerRowProps) @{
	<view class="context-row" id={`context-row-${props.row.id}`}>
		<MemoContextLayer depth={props.depth} leafRef={props.leafRef} />
	</view>
}

const MemoConsumerRow = memo(ConsumerRow);

interface ContextRowProps {
	readonly consumer: number;
	readonly depth: number;
	readonly leafRef: LynxMainThreadRefCell<object | undefined>;
	readonly row: BenchRow;
}

function ContextRow(props: ContextRowProps) @{
	@if (props.row.id === props.consumer) {
		<MemoConsumerRow row={props.row} depth={props.depth} leafRef={props.leafRef} />
	} @else {
		<MemoPlainRow row={props.row} />
	}
}

const MemoContextRow = memo(ContextRow);

export function App() @{
	const [tone, setTone] = useState('light');
	const leafRef = useMainThreadRef<object>();
	const consumer = CONSUMER;
	const depth = __ISSUE288_DEPTH__;

	const observeTouch = (event: Issue197TouchEvent) => {
		'main thread';
		const leaf = leafRef.current;
		if (leaf === null || leaf === undefined) {
			throw new Error('ISSUE288_OBSERVER_FAILURE context leaf ref missing at touchstart');
		}
		const before = __GetComputedStyleByKey(leaf, 'background-color');
		const inputPlatformTimestamp = event.timestamp;
		if (__ISSUE288_PROFILE__) {
			lynx.performance.profileMark(`Issue288::${__ISSUE288_ARM__}::mts-input`);
		}
		let changedFrameOrdinal = 0;
		const poll = (changedVsyncPlatformTimestamp: number) => {
			changedFrameOrdinal += 1;
			const after = __GetComputedStyleByKey(leaf, 'background-color');
			if (after !== before) {
				if (__ISSUE288_PROFILE__) {
					lynx.performance.profileMark(`Issue288::${__ISSUE288_ARM__}::changed-vsync`);
				}
				throw new Error(`ISSUE288_SAMPLE ${
					JSON.stringify({
						protocol: 'octane-issue288-native-context-v1',
						arm: __ISSUE288_ARM__,
						rows: __ISSUE288_ROWS__,
						depth: __ISSUE288_DEPTH__,
						inputPlatformTimestamp,
						changedVsyncPlatformTimestamp,
						changedFrameOrdinal,
						before,
						after,
						clock: 'lynx-event-epoch-ms-to-raf-uptime-ms-with-android-platform-calibration',
						observer: 'mts-capture-touchstart-raf-predicate',
					})
				}`);
			}
			if (changedFrameOrdinal >= 120) {
				throw new Error('ISSUE288_OBSERVER_FAILURE context predicate unchanged after 120 VSYNCs');
			}
			requestAnimationFrame(poll);
		};
		requestAnimationFrame(poll);
	};

	const toggleTone = () => {
		if (__ISSUE288_PROFILE__) {
			lynx.performance.profileMark(`Issue288::${__ISSUE288_ARM__}::bts-handler`);
		}
		setTone((value) => (value === 'light' ? 'dark' : 'light'));
	};

	<view class="issue288-page" main-thread:capture-bindtouchstart={observeTouch}>
		<view class="issue288-toolbar">
			<view id="issue288-toggle" class="issue288-toggle" bindtouchstart={toggleTone}>
				<text class="issue288-toggle-label">Toggle deep context</text>
			</view>
			<text
				class="issue288-meta"
			>{`${__ISSUE288_ARM__} · ${__ISSUE288_ROWS__} rows · depth ${__ISSUE288_DEPTH__}`}</text>
		</view>
		<Tone.Provider value={tone}>
			<view class="context-table">
				@for (const row of ROWS; key row.id) {
					<MemoContextRow row={row} consumer={consumer} depth={depth} leafRef={leafRef} />
				}
			</view>
		</Tone.Provider>
	</view>
}
