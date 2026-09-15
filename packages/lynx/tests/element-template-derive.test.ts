import { describe, expect, it } from 'vitest';

import {
	deriveLynxElementTemplateProgram,
	deriveLynxStructuralElementTemplateProgram,
} from '../src/compiler/derive-element-template.js';
import { LYNX_PROGRAM_IR_VERSION, type LynxProgramIR } from '../src/compiler/ir.js';

function ir(input: Omit<LynxProgramIR, 'version' | 'resident'>): LynxProgramIR {
	return { version: LYNX_PROGRAM_IR_VERSION, ...input };
}

describe('Element Template program lowering', () => {
	it('lowers static hosts, dynamic values, events, and a positioned structural range', () => {
		const result = deriveLynxElementTemplateProgram(
			ir({
				wire: {
					nodes: [
						{
							type: 'view',
							parent: -1,
							props: {},
							bindings: [{ name: 'class', valueIndex: 0 }],
						},
						{ type: 'text', parent: 0, props: { class: 'label' } },
						{
							type: '#text',
							parent: 1,
							props: {},
							bindings: [{ name: 'value', valueIndex: 1 }],
						},
						{ type: 'view', parent: 0, props: { id: 'after' } },
					],
					events: [{ node: 1, type: 'bindtap', priority: 'discrete' }],
				},
				values: [
					{ slot: 4, node: 0, name: 'class', text: false },
					{ slot: 7, node: 2, name: 'value', text: true },
				],
				events: [{ slot: 9, node: 1, prop: 'bindtap', type: 'bindtap', priority: 'discrete' }],
				ranges: [{ slot: 11, node: 0, before: 3 }],
				addressable: true,
			}),
		);

		expect(result).toEqual({
			attributeSlots: 4,
			childSlots: 1,
			visibilitySlot: 3,
			template: {
				kind: 'element',
				type: 'view',
				attributesArray: [
					{ kind: 'slot', key: 'class', attrSlotIndex: 0 },
					{ kind: 'slot', key: 'hidden', attrSlotIndex: 3 },
				],
				children: [
					{
						kind: 'element',
						type: 'text',
						attributesArray: [
							{ kind: 'static', key: 'class', value: 'label' },
							{ kind: 'slot', key: 'bindtap', attrSlotIndex: 2 },
						],
						children: [
							{
								kind: 'element',
								type: 'raw-text',
								attributesArray: [{ kind: 'slot', key: 'text', attrSlotIndex: 1 }],
								children: [],
							},
						],
					},
					{ kind: 'elementSlot', type: 'slot', elementSlotIndex: 0 },
					{
						kind: 'element',
						type: 'view',
						attributesArray: [{ kind: 'static', key: 'id', value: 'after' }],
						children: [],
					},
				],
			},
		});
	});

	it('keeps sibling structural slots in authored order before one static child', () => {
		const result = deriveLynxElementTemplateProgram(
			ir({
				wire: {
					nodes: [
						{ type: 'view', parent: -1, props: {} },
						{ type: 'text', parent: 0, props: { id: 'tail' } },
					],
					events: [],
				},
				values: [],
				events: [],
				ranges: [
					{ slot: 4, node: 0, before: 1 },
					{ slot: 7, node: 0, before: 1 },
				],
				addressable: true,
			}),
		);

		expect(result).toMatchObject({
			childSlots: 2,
			template: {
				children: [
					{ kind: 'elementSlot', elementSlotIndex: 0 },
					{ kind: 'elementSlot', elementSlotIndex: 1 },
					{ kind: 'element', type: 'text' },
				],
			},
		});
	});

	it('emits truthful native arity when graph proof removes visibility', () => {
		const result = deriveLynxStructuralElementTemplateProgram(
			ir({
				wire: {
					nodes: [
						{
							type: 'view',
							parent: -1,
							props: {},
							bindings: [{ name: 'id', valueIndex: 0 }],
						},
					],
					events: [{ node: 0, type: 'bindtap', priority: 'discrete' }],
				},
				values: [{ slot: 1, node: 0, name: 'id', text: false }],
				events: [{ slot: 2, node: 0, prop: 'bindtap', type: 'bindtap', priority: 'discrete' }],
				ranges: [],
				addressable: true,
			}),
		);

		expect(result).toMatchObject({
			attributeSlots: 2,
			childSlots: 0,
			template: {
				attributesArray: [
					{ kind: 'slot', key: 'id', attrSlotIndex: 0 },
					{ kind: 'slot', key: 'bindtap', attrSlotIndex: 1 },
				],
			},
		});
		expect(result).not.toHaveProperty('visibilitySlot');
	});

	it('fails closed instead of mixing ordinary refs or typed-list handles', () => {
		const base = ir({
			wire: { nodes: [{ type: 'view', parent: -1, props: {} }], events: [] },
			values: [],
			events: [],
			ranges: [],
			addressable: true,
		});
		expect(deriveLynxElementTemplateProgram({ ...base, refs: [{ node: 0, slot: 0 }] })).toBeNull();
		expect(
			deriveLynxElementTemplateProgram({
				...base,
				wire: { nodes: [{ type: 'list', parent: -1, props: {} }], events: [] },
			}),
		).toBeNull();
	});

	it('fails closed for text-polymorphic ranges and native attribute composition', () => {
		const base = ir({
			wire: {
				nodes: [
					{
						type: 'view',
						parent: -1,
						props: { class: 'static' },
						bindings: [{ name: 'className', valueIndex: 0 }],
					},
				],
				events: [],
			},
			values: [{ slot: 0, node: 0, name: 'className', text: false }],
			events: [],
			ranges: [],
			addressable: true,
		});
		expect(deriveLynxElementTemplateProgram(base)).toBeNull();
		expect(deriveLynxElementTemplateProgram({ ...base, addressable: false })).toBeNull();
		expect(
			deriveLynxElementTemplateProgram({
				...base,
				values: [{ slot: 0, node: 0, name: 'id', text: false }],
			}),
		).toBeNull();
	});
});
