import { describe, expect, it } from 'vitest';

import { deriveLynxElementTemplateProgram } from '../src/compiler/derive-element-template.js';
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
					{ slot: 4, node: 0, name: 'class' },
					{ slot: 7, node: 2, name: 'value' },
				],
				events: [{ slot: 9, node: 1, type: 'bindtap', priority: 'discrete' }],
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
			values: [{ slot: 0, node: 0, name: 'className' }],
			events: [],
			ranges: [],
			addressable: true,
		});
		expect(deriveLynxElementTemplateProgram(base)).toBeNull();
		expect(deriveLynxElementTemplateProgram({ ...base, addressable: false })).toBeNull();
		expect(
			deriveLynxElementTemplateProgram({
				...base,
				values: [{ slot: 0, node: 0, name: 'id' }],
			}),
		).toBeNull();
	});
});
