/** @jsxImportSource @octanejs/lynx/intrinsics */
import type { LynxPublicHandle } from '@octanejs/lynx';
import { createPortal } from 'octane';
import type { UniversalRenderable } from 'octane/universal/native';

export function PortalEligible(props: {
	readonly target: LynxPublicHandle | null;
	readonly label: string;
}) @{
	<view id="portal-eligible-shell">
		<view id="portal-target" />
		{(props.target === null
			? null
			: createPortal(
					<view class="portal-content">
						<text>{props.label as string}</text>
					</view>,
					props.target as unknown as Element,
				)) as unknown as UniversalRenderable}
	</view>
}
