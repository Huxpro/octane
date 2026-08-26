/** @jsxImportSource @octanejs/lynx/intrinsics */

interface ProbeRow {
	readonly id: number;
	readonly key: string;
	readonly title: string;
	readonly detail: string;
}

const ROWS: readonly ProbeRow[] = Array.from(
	{ length: 10_000 },
	(_value, index) => ({
		id: index,
		key: `probe-row-${index}`,
		title: `Feed item ${index}`,
		detail: `Section ${index % 17} · score ${(index * 37) % 101}`,
	}),
);

export function App() @{
	<list class="probe-list" list-type="single" scroll-orientation="vertical">
		@for (const row of ROWS; key row.id) {
			<list-item
				class="probe-item"
				item-key={row.key}
				reuse-identifier="octane-issue-195-row"
				estimated-main-axis-size-px={92}
			>
				<view class="probe-row">
					<text class="probe-index">{String(row.id)}</text>
					<view class="probe-copy">
						<text class="probe-title">{row.title}</text>
						<text class="probe-detail">{row.detail}</text>
					</view>
					<text class="probe-chevron">{'›'}</text>
				</view>
			</list-item>
		}
	</list>
}
