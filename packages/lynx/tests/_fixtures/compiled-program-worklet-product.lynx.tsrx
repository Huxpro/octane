import { runOnMainThread, useMainThreadRef } from '@octanejs/lynx';
import { useLayoutEffect } from 'octane';

export const compactWorkletState: {
	invoke: null | (() => Promise<string>);
	layout: null | string;
	background: string[];
} = {
	invoke: null,
	layout: null,
	background: [],
};

export function CompiledProgramWorkletProduct(props: { readonly prefix: string }) @{
	const node = useMainThreadRef();
	const reply = (value: string) => {
		'background only';
		compactWorkletState.background.push(value);
		return 'reply:' + value;
	};
	const onMainTap = () => {
		'main thread';
		return reply(props.prefix + ':' + (node.current !== null));
	};
	const invoke = runOnMainThread(onMainTap);
	compactWorkletState.invoke = invoke;

	useLayoutEffect(() => {
		void invoke().then((value) => {
			compactWorkletState.layout = value;
		});
	}, [invoke]);

	<view id="compact-worklet-product" main-thread:ref={node} main-thread:bindtap={onMainTap}>
		<text>compact worklet</text>
	</view>
}
