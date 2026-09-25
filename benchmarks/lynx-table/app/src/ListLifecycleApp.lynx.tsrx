/** @jsxImportSource @octanejs/lynx/intrinsics */

import { useMainThreadRef } from '@octanejs/lynx';
import type { LynxMainThreadElement } from '@octanejs/lynx';
import { useState } from 'octane';

interface LifecycleRowData {
	readonly id: string;
	readonly label: string;
}

interface LifecycleRowProps extends LifecycleRowData {}

declare const __BENCH_LIST_ROWS__: number;

const LIFECYCLE_ROWS: readonly LifecycleRowData[] = Array.from(
	{ length: __BENCH_LIST_ROWS__ },
	(_, index) => ({ id: `row-${index}`, label: `Row ${index}` }),
);

function LifecycleRow(props: LifecycleRowProps) @{
	const [backgroundHits, setBackgroundHits] = useState(0);
	const mainReceipt = useMainThreadRef<LynxMainThreadElement | null>(null);
	const reportMainTap = (owner: string, measuredBackground: string) => {
		'background only';
		console.log('__OCTANE_NATIVE_LIST_MAIN_TAP__=' + owner + ';measured=' + measuredBackground);
		return owner;
	};

	const onBackgroundTap = () => {
		setBackgroundHits((value) => value + 1);
	};
	const onMainTap = () => {
		'main thread';
		const receipt = mainReceipt.current;
		if (receipt === null) {
			throw new Error('native-list main-thread ref is unavailable for ' + props.id);
		}
		const measuredBackground = receipt.getComputedStyleProperty('background-color');
		receipt.setAttribute('aria-label', 'main-owner:' + props.id);
		receipt.setStyleProperty('background-color', props.id === 'row-0' ? '#d6efc7' : '#c7ddef');
		return reportMainTap(props.id, measuredBackground);
	};

	<list-item
		class="bench-list-lifecycle-cell"
		item-key={props.id}
		reuse-identifier="bench-list-lifecycle-row"
		estimated-main-axis-size-px={64}
		data-owner={props.id}
	>
		<view class="bench-list-lifecycle-body">
			<view
				id={'background-' + props.id}
				class="bench-list-lifecycle-control"
				bindtap={onBackgroundTap}
			>
				<text class="bench-list-lifecycle-key">{props.id as string}</text>
				<text class="bench-list-lifecycle-state">{'background:' + backgroundHits}</text>
			</view>
			<view
				id={'main-' + props.id}
				class="bench-list-lifecycle-control bench-list-lifecycle-main"
				data-main-owner="pending"
				main-thread:ref={mainReceipt}
				main-thread:bindtap={onMainTap}
			>
				<text class="bench-list-lifecycle-label">{props.label as string}</text>
				<text class="bench-list-lifecycle-state">main-thread</text>
			</view>
		</view>
	</list-item>
}

export function ListLifecycleApp() @{
	<view class="bench-list-page">
		<list
			class="bench-list-lifecycle-viewport"
			list-type="single"
			span-count={1}
			preload-buffer-count={2}
			scroll-orientation="vertical"
		>
			@for (const row of LIFECYCLE_ROWS; key row.id) {
				<LifecycleRow id={row.id} label={row.label} />
			}
		</list>
	</view>
}
