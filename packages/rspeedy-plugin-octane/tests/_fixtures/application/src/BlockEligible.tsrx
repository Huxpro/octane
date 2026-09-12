/** @jsxImportSource @octanejs/lynx/intrinsics */
import { createContext, memo, useContext, useState } from 'octane';
import type { OctaneNode } from 'octane';
import type { UniversalRenderable } from 'octane/universal/native';

const BlockTheme = createContext('default');

interface BlockEligibleItem {
	readonly id: number;
	readonly image: string;
	readonly label: string;
}

const BlockEligibleRow = memo(function BlockEligibleRow(props: {
	readonly item: BlockEligibleItem;
	readonly onSelect: (label: string) => void;
}) @{
	const [taps, setTaps] = useState(0);
	const theme = useContext(BlockTheme);
	const item = props.item;
	const onTap = () => {
		props.onSelect(item.label);
		setTaps((value) => value + 1);
	};
	<view id={'row-' + item.id} class={['row', theme, 'taps-' + taps]}>
		<image id={'image-' + item.id} src={item.image} mode="aspectFill" />
		<text bindtap={onTap}>{item.label + ':' + taps as string}</text>
	</view>
});

function BlockFrame(props: { readonly children?: OctaneNode }): UniversalRenderable {
	return props.children as UniversalRenderable;
}

export function BlockEligible(props: {
	items: readonly BlockEligibleItem[];
	theme: string;
}) @{
	const [selected, setSelected] = useState('none');
	<BlockTheme.Provider value={props.theme}>
		<BlockFrame>
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
				<view class="if-region">
					@if (selected === 'none') {
						<view class="if-idle">
							<text>idle</text>
						</view>
					} @else {
						<view class="if-selected">
							<text>{selected as string}</text>
						</view>
					}
				</view>
				<view class="switch-region">
					@switch (selected) {
						@case 'none': {
							<view class="switch-idle">
								<text>none</text>
							</view>
						}
						@default: {
							<view class="switch-selected">
								<text>{selected as string}</text>
							</view>
						}
					}
				</view>
			</view>
		</BlockFrame>
	</BlockTheme.Provider>
}
