/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';

interface BlockEligibleItem {
	readonly id: number;
	readonly image: string;
	readonly label: string;
}

function BlockEligibleRow(props: {
	readonly item: BlockEligibleItem;
	readonly onSelect: (label: string) => void;
}) @{
	const [taps, setTaps] = useState(0);
	const item = props.item;
	const onTap = () => {
		props.onSelect(item.label);
		setTaps((value) => value + 1);
	};
	<view id={'row-' + item.id} class={['row', 'taps-' + taps]}>
		<image id={'image-' + item.id} src={item.image} mode="aspectFill" />
		<text bindtap={onTap}>{item.label + ':' + taps as string}</text>
	</view>
}

export function BlockEligible(props: {
	items: readonly BlockEligibleItem[];
}) @{
	const [selected, setSelected] = useState('none');
	<view id="block-eligible-shell">
		<text>{'Selected: ' + selected}</text>
		<view class="rows">
			@for (const item of props.items; key item.id) {
				<BlockEligibleRow item={item} onSelect={setSelected} />
			} @empty {
				<view class="empty">
					<text>{'No rows: ' + selected as string}</text>
				</view>
			}
		</view>
	</view>
}
