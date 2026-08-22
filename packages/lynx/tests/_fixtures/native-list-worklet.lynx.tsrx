export function NativeListWorkletFixture(props) @{
	<list id="worklet-feed">
		@for (const item of props.items; key item.id) {
			<list-item item-key={item.id} reuse-identifier="worklet-row" main-thread:bindtap={props.tap}>
				<text>{item.label as string}</text>
			</list-item>
		}
	</list>
}
