import { useState } from 'octane';

export interface CompiledProgramProductRow {
	readonly id: number;
	readonly label: string;
	readonly image: string;
}

export interface CompiledProgramProductProps {
	readonly title: string;
	readonly tone: string;
	readonly rows: readonly CompiledProgramProductRow[];
	readonly onRowTap: (id: number, previousTaps: number) => void;
}

export interface CompiledProgramNativeListRow {
	readonly id: string;
	readonly label: string;
}

export interface CompiledProgramNativeListProps {
	readonly rows: readonly CompiledProgramNativeListRow[];
	readonly onRowTap: (id: string, previousTaps: number) => void;
}

function ProductRow(props: {
	readonly row: CompiledProgramProductRow;
	readonly onRowTap: (id: number, previousTaps: number) => void;
}) @{
	const [taps, setTaps] = useState(0);
	const row = props.row;
	const onTap = () => {
		props.onRowTap(row.id, taps);
		setTaps((value) => value + 1);
	};

	<view class="product-row-shell">
		<view class="product-static-frame">
			<text>static</text>
		</view>
		<view id={'row-' + row.id} class={['product-row', 'taps-' + taps]} bindtap={onTap}>
			<image id={'image-' + row.id} src={row.image} mode="aspectFill" />
			<text class="product-label">{row.label + ':' + taps as string}</text>
		</view>
	</view>
}

export function CompiledProgramProductFixture(props: CompiledProgramProductProps) @{
	<view id="product-shell" class={props.tone}>
		<text id="product-title">{props.title as string}</text>
		<view id="product-rows">
			@for (const row of props.rows; key row.id) {
				<ProductRow row={row} onRowTap={props.onRowTap} />
			}
		</view>
	</view>
}

function NativeListRow(props: {
	readonly row: CompiledProgramNativeListRow;
	readonly onRowTap: (id: string, previousTaps: number) => void;
}) @{
	const [taps, setTaps] = useState(0);
	const row = props.row;
	const onTap = () => {
		props.onRowTap(row.id, taps);
		setTaps((value) => value + 1);
	};

	<list-item item-key={row.id} reuse-identifier="compiled-product-row">
		<text id={'native-row-' + row.id} bindtap={onTap}>{row.label + ':' + taps as string}</text>
	</list-item>
}

export function CompiledProgramNativeListFixture(props: CompiledProgramNativeListProps) @{
	<list id="compiled-product-list">
		@for (const row of props.rows; key row.id) {
			<NativeListRow row={row} onRowTap={props.onRowTap} />
		}
	</list>
}
