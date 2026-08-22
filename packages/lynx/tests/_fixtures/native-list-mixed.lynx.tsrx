export function NativeListMixedFixture(props) @{
	<list id="mixed-feed">
		@for (const item of props.items; key item.id) {
			@if (item.tappable) {
				<list-item item-key={item.id} reuse-identifier="tap-row" main-thread:bindtap={props.tap}>
					<text>{item.label as string}</text>
				</list-item>
			} @else {
				<list-item item-key={item.id} reuse-identifier="plain-row">
					<text>{item.label as string}</text>
				</list-item>
			}
		}
	</list>
}
