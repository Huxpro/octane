/** @jsxImportSource @octanejs/lynx/intrinsics */
interface StructuralRow {
	readonly id: number;
	readonly label: string;
}

export function ElementTemplateStructural(props: { readonly rows: readonly StructuralRow[] }) @{
	<view class="structural-page">
		<view class="structural-rows">
			@for (const row of props.rows; key row.id) {
				<view class="structural-row">
					<text>{row.label as string}</text>
				</view>
			}
		</view>
	</view>
}
