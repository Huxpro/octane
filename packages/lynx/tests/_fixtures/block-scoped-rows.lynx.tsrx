import { type OctaneNode, useCallback, useEffect, useState } from 'octane';

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
export interface BlockConditionalProps {
	readonly show: boolean;
	readonly label: string;
	readonly log: (entry: string) => void;
}

function BlockConditionalRow(props: {
	readonly label: string;
	readonly log: (entry: string) => void;
}) @{
	const [tone, setTone] = useState('quiet');
	const label = props.label;
	const log = props.log;
	const onTap = useCallback(() => setTone((value) => (value === 'quiet' ? 'loud' : 'quiet')), []);
	useEffect(() => {
		log('mount:' + label);
		return () => log('cleanup:' + label);
	}, []);

	<view class={['branch-row', tone]}>
		<text class="col-id">{label}</text>
		<text class="col-label" bindtap={onTap}>{label + ':' + tone}</text>
	</view>
}

export function BlockConditionalFixture(props: BlockConditionalProps) @{
	<view class="page">
		<text class="title">condition</text>
		<view class="rows">
			@if (props.show) {
				<BlockConditionalRow label={props.label} log={props.log} />
			} @else {
				<view class="alternate">
					<text>{'hidden:' + props.label}</text>
				</view>
			}
		</view>
	</view>
}

export interface BlockCompositionProps {
	readonly rows: readonly BlockScopedRowValue[];
	readonly prefix: string;
}

function BlockRenderLeaf(props: {
	readonly row: BlockScopedRowValue;
	readonly render: (row: BlockScopedRowValue, tone: string, onTap: () => void) => OctaneNode;
}) {
	const [tone, setTone] = useState('quiet');
	return props.render(
		props.row,
		tone,
		() => setTone((value) => (value === 'quiet' ? 'loud' : 'quiet')),
	);
}

function BlockChildrenFrame(props: { readonly children?: OctaneNode }) {
	return props.children ?? null;
}

export function BlockCompositionFixture(props: BlockCompositionProps) @{
	<view class="page">
		<text class="title">composition</text>
		<view class="rows">
			@for (const row of props.rows; key row.id) {
				<BlockChildrenFrame>
					<BlockRenderLeaf
						row={row}
						render={(value, tone, onTap) => <view class="row">
							<text class="col-id">{String(value.id)}</text>
							<text class="col-label" bindtap={onTap}>
								{props.prefix + ':' + value.label + ':' + tone}
							</text>
						</view>}
					/>
				</BlockChildrenFrame>
			}
		</view>
	</view>
}
