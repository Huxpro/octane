import type {
	UniversalHostTemplateProgram,
	UniversalProgramPlan,
	UniversalTransportIdentity,
} from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import {
	createLynxCompiledProgramController,
	type LynxCompiledProgramController,
	type LynxCompiledProgramControllerResponse,
} from '../src/core/compiled-program-controller.js';
import { encodeLynxDeltaMessage } from '../src/core/delta-protocol.js';
import { encodeLynxNativeEventToken } from '../src/core/native-events.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import { createFakePAPI, type FakeNode, shape } from './_fixtures/fake-element-papi.js';

const ROW: UniversalHostTemplateProgram = {
	nodes: [
		{
			type: 'view',
			parent: -1,
			props: {},
			bindings: [
				{ name: 'id', valueIndex: 0 },
				{ name: 'class', valueIndex: 1 },
			],
		},
		{ type: 'text', parent: 0, props: {} },
		{
			type: '#text',
			parent: 1,
			props: {},
			bindings: [{ name: 'value', valueIndex: 2 }],
		},
	],
	events: [],
};

const ADDRESS = { module: 'tests/CompactRow.lynx.tsrx', index: 0 } as const;

function emittedPlan(): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(ROW, {
		name: 'createControlledCompactRow',
		slotUpdates: true,
	});
	return {
		kind: 'program',
		slots: ['p:id', 'p:class', 'c'],
		nodes: ROW.nodes.length,
		values: [0, 1, 2],
		events: [],
		ranges: [],
		bind: new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'],
	};
}

function emittedEventPlan(): UniversalProgramPlan {
	const program: UniversalHostTemplateProgram = {
		...ROW,
		events: [{ node: 0, type: 'bindtap', priority: 'discrete' }],
	};
	const emission = emitLynxMainThreadProgram(program, {
		name: 'createControlledAdoptedRow',
		slotUpdates: true,
	});
	return {
		kind: 'program',
		slots: ['p:id', 'p:class', 'c', 'e:bindtap'],
		nodes: program.nodes.length,
		values: [0, 1, 2],
		events: program.events.map((event) => ({ ...event, slot: 3 })),
		ranges: [],
		bind: new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'],
	};
}

function emittedHost(): LynxElementPAPI<FakeNode> {
	const base = createFakePAPI();
	return {
		...base,
		intrinsics: {
			view: (pageId) => base.createElement('view', pageId, ''),
			text: (pageId) => base.createElement('text', pageId, ''),
			rawText: (text) => base.createElement('#text', 0, text),
		},
		append: (parent, child) => base.insertBefore(parent, child, null),
	};
}

function identity(version: number): UniversalTransportIdentity {
	return { protocol: 1, renderer: 'lynx', root: 73, version };
}

function mountFrame(label = 'one') {
	return encodeLynxDeltaMessage(
		[
			{
				op: 'run',
				templateId: 1,
				parent: { instance: 1, slot: 0 },
				before: null,
				firstInstance: 2,
				count: 1,
				values: ['row-2', 'cold', label],
			},
		],
		[{ id: 1, address: ADDRESS }],
	);
}

function setup(
	papi: LynxElementPAPI<FakeNode> = emittedHost(),
	respond?: (message: LynxCompiledProgramControllerResponse) => void,
) {
	const page = papi.createPage('0', 0);
	const responses: LynxCompiledProgramControllerResponse[] = [];
	const controller = createLynxCompiledProgramController({
		page,
		papi,
		resolveProgram: (module, index) =>
			module === ADDRESS.module && index === ADDRESS.index ? emittedPlan() : undefined,
		respond:
			respond ??
			((message) => {
				responses.push(message);
			}),
	});
	return { controller, page, responses };
}

describe('@octanejs/lynx compact compiled-program controller', () => {
	it('takes ownership of a proved first-screen run without repainting it', () => {
		const base = emittedHost();
		let attachments = 0;
		const papi: typeof base = {
			...base,
			insertBefore(parent, child, before) {
				attachments++;
				base.insertBefore(parent, child, before);
			},
		};
		const page = papi.createPage('0', 0);
		const plan = emittedEventPlan();
		const values = ['row-2', 'cold', 'one'];
		const nodes = new Array<FakeNode>(plan.nodes);
		const token = encodeLynxNativeEventToken({
			root: 73,
			id: 10,
			generation: 1,
			listener: 1_000_000,
			priority: 'discrete',
		});
		plan.bind(papi).run!(papi.getUniqueId(page), 1, values, [token], [], nodes);
		papi.insertBefore(page, nodes[0]!, null);
		attachments = 0;
		const responses: LynxCompiledProgramControllerResponse[] = [];
		const controller = createLynxCompiledProgramController(
			{
				page,
				papi,
				resolveProgram: (module, index) =>
					module === ADDRESS.module && index === ADDRESS.index ? plan : undefined,
				respond: (message) => responses.push(message),
			},
			{
				firstListener: 1_000_000,
				resolveSeed: ({ firstHandle }) =>
					firstHandle === 2
						? { firstId: 10, firstListenerId: 1_000_000, nodes, stride: 4 }
						: undefined,
				verify() {},
				finish() {},
				dispose() {},
			},
		);

		controller.apply(identity(1), mountFrame());

		expect(attachments).toBe(0);
		expect(page.children).toEqual([nodes[0]]);
		expect(page.children[0]!.events.get('bindEvent:tap')).toBe(token);
		expect(controller.size()).toBe(1);
		expect(responses.map((message) => message.type)).toEqual(['ack', 'complete']);

		controller.dispose(identity(1));
		expect(page.children).toEqual([]);
		expect(responses.at(-1)).toMatchObject({ type: 'dispose-ack' });
	});

	it('owns one store across accepted RUN and SET settlements', () => {
		const { controller, page, responses } = setup();
		controller.apply(identity(1), mountFrame());
		controller.apply(
			identity(2),
			encodeLynxDeltaMessage([{ op: 'set', instance: 2, slot: 2, value: 'updated' }]),
		);

		expect(responses.map((message) => [message.version, message.type])).toEqual([
			[1, 'ack'],
			[1, 'complete'],
			[2, 'ack'],
			[2, 'complete'],
		]);
		expect(controller.activeIdentity()).toEqual(identity(2));
		expect(controller.size()).toBe(1);
		expect(shape(page)).toMatchObject({
			type: 'page',
			children: [
				{
					type: 'view',
					id: 'row-2',
					classes: 'cold',
					children: [{ type: 'text', children: [{ type: 'raw-text', text: 'updated' }] }],
				},
			],
		});
	});

	it('rolls back a malformed frame and accepts the exact identity on retry', () => {
		const { controller, page, responses } = setup();
		controller.apply(identity(1), [...mountFrame(), 99, 0]);
		expect(responses.map((message) => message.type)).toEqual(['reject']);
		expect(controller.activeIdentity()).toBeNull();
		expect(controller.size()).toBe(0);
		expect(page.children).toEqual([]);

		controller.apply(identity(1), mountFrame());
		expect(responses.map((message) => message.type)).toEqual(['reject', 'ack', 'complete']);
		expect(controller.activeIdentity()).toEqual(identity(1));
		expect(page.children).toHaveLength(1);
	});

	it('observes an abort that re-enters during PAPI work before frame publication', () => {
		const base = emittedHost();
		let controller!: LynxCompiledProgramController;
		let abortDuringInsert = true;
		const papi: typeof base = {
			...base,
			insertBefore(parent, child, before) {
				base.insertBefore(parent, child, before);
				if (abortDuringInsert) {
					abortDuringInsert = false;
					controller.abort(identity(1));
				}
			},
		};
		const setupResult = setup(papi);
		controller = setupResult.controller;
		controller.apply(identity(1), mountFrame());

		expect(setupResult.responses.map((message) => message.type)).toEqual(['reject']);
		expect(controller.activeIdentity()).toBeNull();
		expect(setupResult.page.children).toEqual([]);

		controller.apply(identity(1), mountFrame());
		expect(setupResult.responses.map((message) => message.type)).toEqual([
			'reject',
			'ack',
			'complete',
		]);
		expect(setupResult.page.children).toHaveLength(1);
	});

	it('retries incomplete disposal and acknowledges only after native ownership is gone', () => {
		const base = emittedHost();
		let failRemove = true;
		const papi: typeof base = {
			...base,
			remove(parent, child) {
				if (failRemove) {
					failRemove = false;
					throw new Error('transient remove failure');
				}
				base.remove(parent, child);
			},
		};
		const { controller, page, responses } = setup(papi);
		controller.apply(identity(1), mountFrame());

		controller.dispose(identity(1));
		expect(responses.at(-1)).toMatchObject({ type: 'dispose-retry' });
		expect(controller.activeIdentity()).toEqual(identity(1));
		expect(page.children).toHaveLength(1);

		controller.dispose(identity(1));
		expect(responses.at(-1)).toMatchObject({ type: 'dispose-ack' });
		expect(controller.activeIdentity()).toBeNull();
		expect(controller.size()).toBe(0);
		expect(page.children).toEqual([]);

		controller.dispose(identity(1));
		expect(responses.at(-1)).toMatchObject({ type: 'dispose-ack' });
		controller.apply(identity(1), mountFrame());
		expect(responses.at(-1)).toMatchObject({ type: 'reject' });
		expect(page.children).toEqual([]);
	});

	it('retains accepted state when acknowledgement delivery faults', () => {
		const responses: LynxCompiledProgramControllerResponse[] = [];
		const { controller, page } = setup(undefined, (message) => {
			responses.push(message);
			if (message.type === 'ack') throw new Error('ack delivery failed');
		});
		controller.apply(identity(1), mountFrame());

		expect(responses.map((message) => message.type)).toEqual(['ack']);
		expect(controller.activeIdentity()).toEqual(identity(1));
		expect(controller.size()).toBe(1);
		expect(page.children).toHaveLength(1);
		expect(controller.diagnostics().at(-1)?.message).toBe('ack delivery failed');

		controller.apply(identity(2), encodeLynxDeltaMessage([]));
		expect(page.children).toHaveLength(1);
		expect(controller.activeIdentity()).toEqual(identity(1));
	});

	it('faults instead of inviting retry when frame rollback leaves native ownership', () => {
		const base = emittedHost();
		let removeFailures = 2;
		const papi: typeof base = {
			...base,
			remove(parent, child) {
				if (removeFailures-- > 0) throw new Error('transient rollback cleanup failure');
				base.remove(parent, child);
			},
		};
		const { controller, page, responses } = setup(papi);
		controller.apply(identity(1), [...mountFrame(), 99, 0]);

		expect(responses.at(-1)).toMatchObject({ type: 'fault', root: 73, version: 1 });
		expect(controller.activeIdentity()).toEqual(identity(1));
		expect(page.children).toHaveLength(1);

		controller.dispose(identity(1), true);
		expect(responses.at(-1)).toMatchObject({ type: 'dispose-retry' });
		expect(page.children).toHaveLength(1);

		controller.dispose(identity(1), true);
		expect(responses.at(-1)).toMatchObject({ type: 'dispose-ack' });
		expect(controller.activeIdentity()).toBeNull();
		expect(page.children).toEqual([]);
	});
});
