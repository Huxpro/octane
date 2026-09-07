import { useState, useSyncExternalStore } from 'octane';

export interface BenchRow {
	id: number;
	label: string;
}

export interface BenchAppProps {
	rows: readonly BenchRow[];
}

/**
 * Row shape used by the Vue-Lynx unified benchmark matrix: a keyed list of
 * rows, each with an id cell, a tappable label cell, and a tappable remove
 * cell. The tap handlers are ordinary background `bind*` props so the suite
 * measures the same host-command volume a click-driven run would produce.
 */
export function BenchApp(props: BenchAppProps) @{
	const [selected, setSelected] = useState(0);
	const [removed, setRemoved] = useState(0);

	<view class="container">
		<view class="jumbotron">
			<text class="title">Octane Lynx</text>
			<text class="stats">{`selected=${selected} removed=${removed}`}</text>
		</view>
		<view class="table">
			@for (const row of props.rows; key row.id) {
				<view class={row.id === selected ? 'row danger' : 'row'} id={`row-${row.id}`}>
					<text class="col-id">{`${row.id}`}</text>
					<view class="col-label" bindtap={() => setSelected(row.id)}>
						<text>{row.label}</text>
					</view>
					<view class="col-remove" bindtap={() => setRemoved((count) => count + 1)}>
						<text>x</text>
					</view>
				</view>
			}
		</view>
	</view>
}

/** Empty-startup target: the same root and transport with no authored rows. */
export function EmptyApp() @{
	<view class="container" />
}

export interface SelectionStore {
	readonly subscribe: (listener: () => void) => () => void;
	readonly getSnapshot: () => number;
}

export interface StoreBenchAppProps {
	readonly rows: readonly BenchRow[];
	readonly store: SelectionStore;
	readonly onRowRender: (id: number) => void;
}

function StoreBenchRow(props: {
	readonly row: BenchRow;
	readonly isSelected: boolean;
	readonly onRowRender: (id: number) => void;
}) @{
	props.onRowRender(props.row.id);
	<view class={props.isSelected ? 'row danger' : 'row'} id={`row-${props.row.id}`}>
		<text class="col-id">{String(props.row.id)}</text>
		<text class="col-label">{props.row.label as string}</text>
	</view>
}

/**
 * Production compiler path for #288's external-store selector owner: one page
 * subscription feeds one compiler-certified keyed selection. The row component
 * is local and immutable, the item is forwarded directly, and the only changing
 * capture is the selection key, so a Block build may revisit old/new rows only.
 */
export function StoreBenchApp(props: StoreBenchAppProps) @{
	const selected = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
	const onRowRender = props.onRowRender;
	<view class="container">
		<view class="table">
			@for (const row of props.rows; key row.id) {
				<StoreBenchRow row={row} isSelected={selected === row.id} onRowRender={onRowRender} />
			}
		</view>
	</view>
}
