import {
	createContext,
	type OctaneNode,
	memo,
	useCallback,
	useContext,
	useEffect,
	useState,
} from 'octane';

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

export interface BlockWrappedSelectionProps {
	readonly rows: readonly BlockScopedRowValue[];
	readonly selected: number;
	readonly observe: (entry: string) => void;
}

function BlockWrappedSelectionRow(props: {
	readonly row: BlockScopedRowValue;
	readonly tone: 'danger' | 'muted';
	readonly observe: (entry: string) => void;
}) @{
	props.observe('selection-row:' + props.row.id);
	<view class={['row', props.tone]}>
		<text>{props.row.label}</text>
	</view>
}

export function BlockWrappedSelectionFixture({
	rows,
	selected,
	observe,
}: BlockWrappedSelectionProps) @{
	<view class="page">
		<view class="rows">
			@for (const row of rows; key row.id) {
				<BlockWrappedSelectionRow
					row={row}
					tone={selected !== row.id ? 'muted' : 'danger'}
					observe={observe}
				/>
			}
		</view>
	</view>
}

const BlockTheme = createContext('default');

export interface BlockContextProps {
	readonly rows: readonly BlockScopedRowValue[];
	readonly theme: string;
	readonly log: (entry: string) => void;
}

const BlockContextRow = memo(
	function BlockContextRow(props: {
		readonly row: BlockScopedRowValue;
		readonly log: (entry: string) => void;
	}) @{
		const theme = useContext(BlockTheme);
		const [tone, setTone] = useState('quiet');
		const row = props.row;
		const log = props.log;
		useEffect(() => {
			log('effect:' + row.id + ':' + theme);
			return () => log('cleanup:' + row.id + ':' + theme);
		}, [theme]);

		<view class={['context-row', theme, tone]}>
			<text class="col-id">{String(row.id)}</text>
			<text
				class="col-label"
				bindtap={() => setTone((value) => (value === 'quiet' ? 'loud' : 'quiet'))}
			>
				{row.label + ':' + theme + ':' + tone}
			</text>
		</view>
	},
	(previous, next) => {
		return previous.row.id === next.row.id;
	},
);

export function BlockContextFixture(props: BlockContextProps) @{
	<BlockTheme.Provider value={props.theme}>
		<view class="page">
			<text class="title">context</text>
			<view class="rows">
				@for (const row of props.rows; key row.id) {
					<BlockContextRow row={row} log={props.log} />
				}
			</view>
		</view>
	</BlockTheme.Provider>
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

export interface BlockDynamicComponentProps {
	readonly identity: string;
	readonly label: string;
	readonly show: boolean;
}

function BlockDynamicRegionRow(props: { readonly label: string }) @{
	const [tone, setTone] = useState('quiet');
	<view class={['row', tone]}>
		<text class="col-label" bindtap={() => setTone(tone === 'quiet' ? 'loud' : 'quiet')}>
			{props.label + ':' + tone}
		</text>
	</view>
}

export function BlockDynamicComponentFixture(props: BlockDynamicComponentProps) @{
	<view class="shell">
		{props.show ? <BlockDynamicRegionRow key={props.identity} label={props.label} /> : null}
	</view>
}

export interface BlockSwitchProps {
	readonly mode: 'case' | 'default';
	readonly label: string;
	readonly log: (entry: string) => void;
}

export function BlockSwitchFixture(props: BlockSwitchProps) @{
	<view class="page">
		<text class="title">switch</text>
		<view class="rows">
			@switch (props.mode) {
				@case 'case': {
					<BlockConditionalRow label={props.label} log={props.log} />
				}
				@default: {
					<view class="alternate">
						<text>{'default:' + props.label}</text>
					</view>
				}
			}
		</view>
	</view>
}

export function BlockStateBranchesFixture() @{
	const [mode, setMode] = useState<'then' | 'case' | 'default'>('then');
	<view class="state-branches">
		<text
			class="state-branches-mode"
			bindtap={() => setMode(mode === 'then' ? 'case' : mode === 'case' ? 'default' : 'then')}
		>{mode as string}</text>
		<view class="state-if">
			@if (mode === 'then') {
				<text>if:then</text>
			} @else {
				<text>if:else</text>
			}
		</view>
		<view class="state-switch">
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
