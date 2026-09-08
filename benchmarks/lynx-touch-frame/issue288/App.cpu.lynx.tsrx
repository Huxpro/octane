import { createContext, memo, useContext, useState } from 'octane';

declare const __ISSUE288_ARM__: string;
declare const __ISSUE288_DEPTH__: number;
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

function ContextLeaf() @{
	const tone = useContext(Tone);
	<view id="context-leaf" class={['context-leaf', tone]}>
		<text class="context-label">{tone as string}</text>
	</view>
}

const MemoContextLeaf = memo(ContextLeaf);

interface ContextLayerProps {
	readonly depth: number;
}

function ContextLayer(props: ContextLayerProps) @{
	@if (props.depth === 0) {
		<MemoContextLeaf />
	} @else {
		<view class="context-layer">
			<MemoContextLayer depth={props.depth - 1} />
		</view>
	}
}

const MemoContextLayer = memo(ContextLayer);

interface ConsumerRowProps {
	readonly depth: number;
	readonly row: BenchRow;
}

function ConsumerRow(props: ConsumerRowProps) @{
	<view class="context-row" id={`context-row-${props.row.id}`}>
		<MemoContextLayer depth={props.depth} />
	</view>
}

const MemoConsumerRow = memo(ConsumerRow);

interface ContextRowProps {
	readonly consumer: number;
	readonly depth: number;
	readonly row: BenchRow;
}

function ContextRow(props: ContextRowProps) @{
	@if (props.row.id === props.consumer) {
		<MemoConsumerRow row={props.row} depth={props.depth} />
	} @else {
		<MemoPlainRow row={props.row} />
	}
}

const MemoContextRow = memo(ContextRow);

export function CpuApp() @{
	const [tone, setTone] = useState('light');
	const consumer = 1;
	const depth = __ISSUE288_DEPTH__;
	const toggleTone = () => setTone((value) => (value === 'light' ? 'dark' : 'light'));

	<view class="issue288-page">
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
					<MemoContextRow row={row} consumer={consumer} depth={depth} />
				}
			</view>
		</Tone.Provider>
	</view>
}
