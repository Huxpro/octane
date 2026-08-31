export function NativeListShapeClassesFixture(props) @{
	<list id="shape-feed">
		@for (const item of props.items; key item.id) {
			@if (item.media) {
				<list-item item-key={item.id} reuse-identifier="media-row">
					<view class="media">
						<text>{item.label as string}</text>
						<text>{item.caption as string}</text>
					</view>
				</list-item>
			} @else {
				<list-item item-key={item.id} reuse-identifier="plain-row">
					<text>{item.label as string}</text>
				</list-item>
			}
		}
	</list>
}
