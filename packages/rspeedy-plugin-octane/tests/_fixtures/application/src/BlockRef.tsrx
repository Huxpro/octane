/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useRef } from 'octane';

export function BlockRef() @{
	const host = useRef<unknown>(null);
	<view ref={host} id="block-ref">
		<text>ref ready</text>
	</view>
}
