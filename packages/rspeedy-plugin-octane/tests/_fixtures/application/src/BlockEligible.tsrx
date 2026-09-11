/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';

export function BlockEligible(props: {
	items: readonly { id: number; label: string }[];
}) @{
	const [selected, setSelected] = useState('none');
	<view id="block-eligible-shell">
		<text>{'Selected: ' + selected}</text>
		<view class="rows">
			@for (const item of props.items; key item.id) {
				<view id={String(item.id)}>
					<text bindtap={() => setSelected(item.label)}>{item.label as string}</text>
				</view>
			}
		</view>
	</view>
}
