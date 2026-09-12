import { useCallback, useEffect, useState } from 'octane';

export interface BlockScopedRowValue {
	readonly id: number;
	readonly label: string;
}

export interface BlockScopedRowsProps {
	readonly rows: readonly BlockScopedRowValue[];
	readonly log: (entry: string) => void;
}

export function BlockScopedRow(props: {
	readonly row: BlockScopedRowValue;
	readonly log: (entry: string) => void;
}) @{
	const [tone, setTone] = useState('quiet');
	const row = props.row;
	const label = row.label;
	const log = props.log;
	const onTap = useCallback(() => setTone((value) => (value === 'quiet' ? 'loud' : 'quiet')), [
		tone,
	]);
	useEffect(() => {
		log('effect:' + label + ':' + tone);
		return () => log('cleanup:' + label + ':' + tone);
	});

	<view class="row">
		<text class="col-id">{String(row.id)}</text>
		<text class="col-label" bindtap={onTap}>{label + '-' + tone}</text>
	</view>
}

export function BlockScopedRowsFixture(props: BlockScopedRowsProps) @{
	<view class="page">
		<text class="title">rows</text>
		<view class="rows">
			@for (const row of props.rows; key row.id) {
				<BlockScopedRow row={row} log={props.log} />
			}
		</view>
	</view>
}
