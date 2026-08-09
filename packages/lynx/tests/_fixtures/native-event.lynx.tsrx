import { useState } from 'octane';

/**
 * Ordinary background `bind*`/`catch*` handlers. The engine resolves these to
 * the background thread directly, so this fixture is driven by dispatching a
 * real event on the element the Element PAPI created, not by a test bridge.
 */
export function NativeEventFixture(props) @{
	const [taps, setTaps] = useState(0);
	// Unrendered state: updating it re-renders to identical output, so the
	// commit that crosses (or settles locally) carries zero commands.
	const [, setPing] = useState(0);

	<view id="shell" bindtap={() => props.log('shell:' + taps)}>
		<view
			id="target"
			bindtap={(event) => {
				props.log('target:' + event.type + ':' + event.detail.marker);
				setTaps((value) => value + 1);
			}}
		>
			<text>{'taps: ' + taps}</text>
		</view>
		<view id="caught" catchtap={() => props.log('caught')}>
			<text>{'caught'}</text>
		</view>
		<view id="noop" bindtap={() => setPing((value) => value + 1)}>
			<text>{'noop'}</text>
		</view>
	</view>
}
