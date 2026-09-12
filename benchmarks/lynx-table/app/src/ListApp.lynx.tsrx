/** @jsxImportSource @octanejs/lynx/intrinsics */

interface ListRowData {
	readonly id: string;
	readonly label: string;
}

declare const __BENCH_LIST_ROWS__: number;

const LIST_ROWS: readonly ListRowData[] = Array.from(
	{ length: __BENCH_LIST_ROWS__ },
	(_, index) => ({ id: `row-${index}`, label: `Row ${index}` }),
);

export function ListApp() @{
	<view class="bench-list-page">
		<list
			class="bench-list-viewport"
			list-type="single"
			span-count={1}
			preload-buffer-count={2}
			scroll-orientation="vertical"
		>
			@for (const row of LIST_ROWS; key row.id) {
				<list-item
					class="bench-list-cell"
					item-key={row.id}
					reuse-identifier="bench-list-row"
					estimated-main-axis-size-px={40}
				>
					<view class="bench-list-cell-body">
						<text class="bench-list-key">{row.id as string}</text>
						<text class="bench-list-label">{row.label as string}</text>
					</view>
				</list-item>
			}
		</list>
	</view>
}
