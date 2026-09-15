/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';

import badge from './badge.svg';
import styles from './card.module.css';
import './global.css';

interface NativeListItem {
	readonly id: string;
	readonly label: string;
}

function NativeListRow(props: { readonly item: NativeListItem }) @{
	const [taps, setTaps] = useState(0);
	const item = props.item;
	<list-item item-key={item.id} reuse-identifier="release-candidate-row">
		<view class={[styles.card, 'native-list-row']}>
			<image src={badge} mode="aspectFill" />
			<text bindtap={() => setTaps((value) => value + 1)}>{item.label + ':' + taps as string}</text>
		</view>
	</list-item>
}

export function NativeListApp(props: { readonly items: readonly NativeListItem[] }) @{
	<list id="release-candidate-native-list">
		@for (const item of props.items; key item.id) {
			<NativeListRow item={item} />
		}
	</list>
}
