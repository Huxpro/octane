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

function BlockRenderFrame(props: { readonly render: () => OctaneNode }): UniversalRenderable {
	return props.render() as UniversalRenderable;
}

function BlockSelection(props: {
	readonly key?: unknown;
	readonly label: string;
}) @{
	<view class="selection">
		<text>{'Active: ' + props.label}</text>
	</view>
}

function BlockShell(props: {
	readonly items: readonly BlockEligibleItem[];
	readonly selected: string;
	readonly onSelect: (label: string) => void;
}) @{
	<view id="block-eligible-shell">
		<text>{'Selected: ' + props.selected}</text>
		<view class="rows">
			@for (const item of props.items; key item.id) {
				<BlockEligibleRow item={item} onSelect={props.onSelect} />
			} @empty {
				<view class="empty">
					<text>{'No rows: ' + props.selected as string}</text>
				</view>
			}
			<text class="rows-tail">Rows ready</text>
		</view>
		<view class="if-region">
			@if (props.selected === 'none') {
				<view class="if-idle">
					<text>idle</text>
				</view>
			} @else {
				<view class="if-selected">
					<text>{props.selected as string}</text>
				</view>
			}
		</view>
		<view class="switch-region">
			@switch (props.selected) {
				@case 'none': {
					<view class="switch-idle">
						<text>none</text>
					</view>
				}
				@default: {
					<view class="switch-selected">
						<text>{props.selected as string}</text>
					</view>
				}
			}
		</view>
		<view class="render-prop">
			<text>{'Rendered: ' + props.selected as string}</text>
		</view>
		{props.selected === 'none'
			? null
			: <BlockSelection key={props.selected} label={props.selected} />}
	</view>
}

export function BlockEligible(props: {
	items: readonly BlockEligibleItem[];
	theme: string;
}) @{
	const [selected, setSelected] = useState('none');
	<BlockTheme.Provider value={props.theme}>
		<BlockFrame>
			<BlockRenderFrame
				render={() => <BlockShell items={props.items} selected={selected} onSelect={setSelected} />}
			/>
		</BlockFrame>
	</BlockTheme.Provider>
}
