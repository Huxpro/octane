import {
	defineUniversalComponent,
	universalFor,
	universalPlan,
	universalValue,
} from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { deriveLynxProgramIR } from '../src/compiler/index.js';
import { createLynxBlockBackgroundCore } from '../src/core/block-background.js';
import { createLynxBlockCore } from '../src/core/block-core.js';
import { lynxProgram, lynxProgramValue } from '../src/core/compiler-program.js';
import { createLynxClientContainer, type LynxPublicHandle } from '../src/core/client-driver.js';
import { LYNX_TRANSPORT_RENDERER } from '../src/core/protocol.js';
import { createLynxBackgroundTransport } from '../src/core/transport.js';
import type { LynxComponent } from '../src/intrinsics.js';
import { FakeContextProxy, flushMicrotasks, installMainSide } from './_fixtures/fake-lynx-wire.js';

const ROW_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [{ kind: 'host', type: 'text', props: {}, children: [{ kind: 'text', value: 'row' }] }],
});
const ROW_IR = deriveLynxProgramIR(ROW_PLAN.root as never)!;
const REF_ROW_PROGRAM = lynxProgram(LYNX_TRANSPORT_RENDERER, {
	...ROW_IR,
	address: {
		module: 'tests/InlineRefRow.lynx.tsrx',
		index: 0,
		digest: 'inline-ref-row',
	},
	refs: [{ node: 0, slot: 1 }],
});
const PAGE_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	props: { class: 'rows' },
	children: [{ kind: 'slot', slot: 0 }],
});

interface RefTableProps {
	readonly ids: readonly number[];
	readonly version: string;
	readonly calls: string[];
	readonly handles: Map<string, LynxPublicHandle>;
}

const RefTable = defineUniversalComponent(
	LYNX_TRANSPORT_RENDERER,
	function RefTable({ ids, version, calls, handles }: RefTableProps) {
		return universalValue(PAGE_PLAN, [
			universalFor(
				ids,
				(id: number) => id,
				(id: number) =>
					lynxProgramValue(REF_ROW_PROGRAM, [
						'row-' + id,
						(handle: LynxPublicHandle | null) => {
							if (handle === null) {
								calls.push(`${version}:${id}:null`);
								return;
							}
							calls.push(`${version}:${id}:attach`);
							handles.set(`${version}:${id}`, handle);
							return () => calls.push(`${version}:${id}:cleanup`);
						},
					]) as never,
			),
		]) as never;
	},
);

function scene() {
	const context = new FakeContextProxy();
	const main = installMainSide(context, false);
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(context, container);
	const background = createLynxBlockBackgroundCore({
		container,
		transport,
		transportRoot: 1,
		core: createLynxBlockCore({ templateRuns: () => false }),
		scheduleMicrotask: (callback) => void Promise.resolve().then(callback),
	});
	transport.bindRoot(background);
	let acknowledged = 0;
	const render = async (props: RefTableProps): Promise<void> => {
		let settled = false;
		const rendering = background.renderAsync(RefTable as LynxComponent<RefTableProps>, props).then(
			() => {
				settled = true;
			},
			(error) => {
				settled = true;
				throw error;
			},
		);
		rendering.catch(() => undefined);
		for (let guard = 0; guard < 20 && !settled; guard++) {
			await flushMicrotasks();
			while (acknowledged < main.commits.length) main.acknowledge(main.commits[acknowledged++]!);
		}
		await rendering;
	};
	return { main, render };
}

describe('Lynx Block component inline host refs', () => {
	it('retains physical handles across ref-only row updates and releases departed rows', async () => {
		const block = scene();
		const calls: string[] = [];
		const handles = new Map<string, LynxPublicHandle>();
		await block.render({ ids: [1, 2], version: 'a', calls, handles });
		expect(calls).toEqual(['a:1:attach', 'a:2:attach']);
		const firstCommitCount = block.main.commits.length;

		await block.render({ ids: [1, 2], version: 'b', calls, handles });
		expect(block.main.commits).toHaveLength(firstCommitCount);
		expect(calls).toEqual([
			'a:1:attach',
			'a:2:attach',
			'a:1:cleanup',
			'b:1:attach',
			'a:2:cleanup',
			'b:2:attach',
		]);
		expect(handles.get('b:1')).toBe(handles.get('a:1'));
		expect(handles.get('b:2')).toBe(handles.get('a:2'));

		await block.render({ ids: [2], version: 'c', calls, handles });
		expect(calls.slice(-3)).toEqual(['b:1:cleanup', 'b:2:cleanup', 'c:2:attach']);
		expect(handles.get('c:2')).toBe(handles.get('a:2'));
	});
});
