/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';

export function BranchReplay() @{
	const [mode, setMode] = useState<'then' | 'case' | 'default'>('then');
	<view class="branch-replay">
		<text
			class="branch-mode"
			bindtap={() => setMode(mode === 'then' ? 'case' : mode === 'case' ? 'default' : 'then')}
		>
			{'mode:' + mode}
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
