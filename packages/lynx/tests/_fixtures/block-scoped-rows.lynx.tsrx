import { useCallback, useEffect, useState } from 'octane';

export interface BlockScopedRowValue {
	readonly id: number;
	readonly label: string;
}

export interface BlockScopedRowsProps {
	readonly rows: readonly BlockScopedRowValue[];
	readonly log: (entry: string) => void;
	readonly observe: (entry: string) => void;
}

export function BlockScopedRow(props: {
	readonly row: BlockScopedRowValue;
	readonly log: (entry: string) => void;
	readonly observe: (entry: string) => void;
}) @{
	const [tone, setTone] = useState('quiet');
	const row = props.row;
	const label = row.label;
	const log = props.log;
	props.observe('row:' + row.id);
	const onTap = useCallback(() => setTone((value) => (value === 'quiet' ? 'loud' : 'quiet')), [
		tone,
	]);
	const status =
		tone === 'loud' ? label.toUpperCase() : label.toLowerCase();
	useEffect(() => {
		log('effect:' + label + ':' + tone);
		return () => log('cleanup:' + label + ':' + tone);
	});

	<view class={['row', tone]}>
		<text class="col-id">{String(row.id)}</text>
		<text class="col-label" bindtap={onTap}>{label + '-' + tone}</text>
		<text class="col-status">{status + ':' + tone}</text>
	</view>
}

export function BlockScopedRowsFixture(props: BlockScopedRowsProps) @{
	props.observe('page');
	<view class="page">
		<text class="title">rows</text>
		<view class="rows">
			@for (const row of props.rows; key row.id) {
				<BlockScopedRow row={row} log={props.log} observe={props.observe} />
			}
		</view>
	</view>
}
