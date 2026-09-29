import { useId } from 'octane';

export interface CompiledProgramUseIdRow {
	readonly id: number;
	readonly label: string;
}

export interface CompiledProgramUseIdProps {
	readonly rows: readonly CompiledProgramUseIdRow[];
	readonly showBadge: boolean;
	readonly failBoundary: boolean;
	readonly observe: (owner: string, id: string) => void;
}

function UseIdBadge(props: {
	readonly owner: string;
	readonly observe: (owner: string, id: string) => void;
}) @{
	const badgeId = useId();
	props.observe(props.owner, badgeId);

	<text id={badgeId} class="use-id-badge">{props.owner as string}</text>
}

function UseIdBoundaryBody(props: {
	readonly fail: boolean;
	readonly observe: (owner: string, id: string) => void;
}) @{
	const bodyId = useId();
	props.observe('boundary-body', bodyId);
	if (props.fail) throw new Error('discard boundary body');

	<text id={bodyId} class="use-id-boundary-body">body</text>
}

function UseIdRow(props: {
	readonly row: CompiledProgramUseIdRow;
	readonly observe: (owner: string, id: string) => void;
}) @{
	const rowId = useId();
	const row = props.row;
	props.observe('row-' + row.id, rowId);

	<view id={rowId} class="use-id-row">
		<text class="use-id-label">{row.label as string}</text>
	</view>
}

export function CompiledProgramUseIdFixture(props: CompiledProgramUseIdProps) @{
	const shellId = useId();
	props.observe('shell', shellId);

	<view id={shellId} class="use-id-shell">
		<view class="use-id-rows">
			@for (const row of props.rows; key row.id) {
				<UseIdRow row={row} observe={props.observe} />
			}
		</view>
		<view class="use-id-branch">
			@if (props.showBadge) {
				<view class="use-id-badge-frame">
					<UseIdBadge owner="badge" observe={props.observe} />
				</view>
			}
		</view>
		<view class="use-id-boundary">
			@try {
				<view class="use-id-body-frame">
					<UseIdBoundaryBody fail={props.failBoundary} observe={props.observe} />
				</view>
			} @catch (error) {
				<view class="use-id-caught-frame">
					<UseIdBadge owner="caught" observe={props.observe} />
				</view>
			}
		</view>
	</view>
}
