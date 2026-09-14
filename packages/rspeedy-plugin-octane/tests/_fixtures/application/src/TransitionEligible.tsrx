/** @jsxImportSource @octanejs/lynx/intrinsics */
import { startTransition, useDeferredValue, useState, useTransition } from 'octane';

export function TransitionEligible() @{
	const [count, setCount] = useState(0);
	const deferred = useDeferredValue(count);
	const [pending, begin] = useTransition();
	<view id="transition-eligible-shell">
		<text
			class={pending ? 'pending' : 'ready'}
			bindtap={() => begin(() => setCount((value) => value + 1))}
		>{`Count ${count}; deferred ${deferred}`}</text>
		<text bindtap={() => startTransition(() => setCount((value) => value + 1))}>
			Standalone transition
		</text>
	</view>
}
