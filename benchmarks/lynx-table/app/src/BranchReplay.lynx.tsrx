/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useLinkedState, useState } from 'octane';

export function BranchReplay() @{
	const [mode, setMode] = useState<'then' | 'case' | 'default'>('then'), [linked, setLinked] =
		useLinkedState('source', () => 'initial');
	<view class="branch-replay">
		<text
			class="branch-mode"
			bindtap={() => setMode(mode === 'then' ? 'case' : mode === 'case' ? 'default' : 'then')}
		>
			{'mode:' + mode}
		</text>
		<text class="linked-state" bindtap={() => setLinked((value) => value + '!')}>
			{'linked:' + linked}
		</text>
		<view class="branch-if">
			@if (mode === 'then') {
				<text>if:then</text>
			} @else {
				<text>if:else</text>
			}
		</view>
		<view class="branch-switch">
			@switch (mode) {
				@case 'case': {
					<text>switch:case</text>
				}
				@default: {
					<text>switch:default</text>
				}
			}
		</view>
	</view>
}
