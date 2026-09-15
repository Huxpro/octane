import { describe, expect, it } from 'vitest';

import { compileLynxBlockTemplate, createLynxBlockCore } from '../src/core/block-core.js';
import { createLynxBlockRoot } from '../src/core/block-root.js';
import { createLynxClientContainer, type LynxPublicHandle } from '../src/core/client-driver.js';
import { createLynxBackgroundTransport } from '../src/core/transport.js';
import {
	FakeContextProxy,
	flushMicrotasks,
	installMainSide,
	type MainSide,
} from './_fixtures/fake-lynx-wire.js';

const REF_TEMPLATE = compileLynxBlockTemplate(
	{
		nodes: [{ type: 'view', parent: -1, props: { class: 'target' } }],
		events: [],
	},
	undefined,
	[0],
);

function scene() {
	const context = new FakeContextProxy();
	const main = installMainSide(context, false);
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(context, container);
	const core = createLynxBlockCore();
	const root = createLynxBlockRoot({ container, transport, transportRoot: 1, core });
	transport.bindRoot(root);
	const block = core.mount(null, null, REF_TEMPLATE, []);
	return { main, container, core, root, block };
}

async function acknowledgeNext(
	root: ReturnType<typeof scene>['root'],
	main: MainSide,
): Promise<ReturnType<typeof root.commit>> {
	const committing = root.commit();
	await flushMicrotasks();
	main.acknowledge(main.commits.at(-1)!);
	return committing;
}

describe('Lynx Block root host refs', () => {
	it('publishes refs after ACK and journals ref-only replacement and teardown', async () => {
		const { main, container, core, root, block } = scene();
		const calls: string[] = [];
		const objectRef: { current: LynxPublicHandle | null } = { current: null };
		let firstHandle: LynxPublicHandle | null = null;
		const first = (handle: LynxPublicHandle | null) => {
			if (handle === null) calls.push('first:null');
			else {
				firstHandle = handle;
				calls.push(`first:${handle.id}`);
				return () => calls.push('first:cleanup');
			}
		};
		root.bindRefs(block, [[first, objectRef]]);

		const mounting = root.commit();
		await flushMicrotasks();
		expect(calls).toEqual([]);
		expect(objectRef.current).toBeNull();
		main.acknowledge(main.commits[0]!);
		await mounting;
		expect(calls).toEqual([`first:${block.firstId}`]);
		expect(objectRef.current).toBe(firstHandle);

		root.beginAttempt();
		root.bindRefs(block, [() => calls.push('aborted')]);
		expect(root.abortAttempt()).toBe(true);
		expect(calls).toEqual([`first:${block.firstId}`]);

		let secondHandle: LynxPublicHandle | null = null;
		root.beginAttempt();
		root.bindRefs(block, [
			(handle: LynxPublicHandle | null) => {
				if (handle === null) calls.push('second:null');
				else {
					secondHandle = handle;
					calls.push(`second:${handle.id}`);
				}
			},
		]);
		expect(await root.commit()).toBeNull();
		expect(calls).toEqual([`first:${block.firstId}`, 'first:cleanup', `second:${block.firstId}`]);
		expect(objectRef.current).toBeNull();
		expect(secondHandle).toBe(firstHandle);

		root.beginAttempt();
		root.releaseRefs(block);
		core.destroyRoot(block);
		const destroying = root.commit();
		await flushMicrotasks();
		expect(calls.at(-1)).toBe(`second:${block.firstId}`);
		main.acknowledge(main.commits[1]!);
		await destroying;
		expect(calls.at(-1)).toBe('second:null');
		expect(container.getPublicHandle(block.firstId)).toBeNull();
	});

	it('reports a ref callback failure after accepting the host commit', async () => {
		const { main, root, block } = scene();
		const failure = new Error('ref callback failed');
		const calls: string[] = [];
		root.bindRefs(block, [
			(handle: LynxPublicHandle | null) => {
				calls.push(handle === null ? 'throwing:null' : 'throwing:handle');
				if (handle !== null) throw failure;
			},
		]);

		await expect(acknowledgeNext(root, main)).rejects.toBe(failure);
		expect(root.acceptedVersion()).toBe(1);
		expect(calls).toEqual(['throwing:handle']);

		root.beginAttempt();
		root.bindRefs(block, [
			(handle: LynxPublicHandle | null) =>
				calls.push(handle === null ? 'next:null' : 'next:handle'),
		]);
		expect(await root.commit()).toBeNull();
		expect(calls).toEqual(['throwing:handle', 'throwing:null', 'next:handle']);
	});
});
