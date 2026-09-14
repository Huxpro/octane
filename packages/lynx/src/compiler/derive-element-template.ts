import { parseLynxMainThreadEventProp } from '../core/native-events.js';

import { LYNX_PROGRAM_IR_VERSION, type LynxProgramIR } from './ir.js';

export interface LynxElementTemplateStaticAttribute {
	readonly kind: 'static';
	readonly key: string;
	readonly value: string | number | boolean | null;
}

export interface LynxElementTemplateSlotAttribute {
	readonly kind: 'slot';
	readonly key: string;
	readonly attrSlotIndex: number;
}

export type LynxElementTemplateAttribute =
	LynxElementTemplateStaticAttribute | LynxElementTemplateSlotAttribute;

export interface LynxElementTemplateElementSlot {
	readonly kind: 'elementSlot';
	readonly type: 'slot';
	readonly elementSlotIndex: number;
}

export interface LynxElementTemplateNode {
	readonly kind: 'element';
	readonly type: string;
	readonly attributesArray: readonly LynxElementTemplateAttribute[];
	readonly children: readonly (LynxElementTemplateNode | LynxElementTemplateElementSlot)[];
}

/**
 * SDK Template Definition plus the positional runtime slots that instantiate it.
 *
 * Attribute slots deliberately use the resident plan's value order followed by
 * its event order. Child slots deliberately use structural-range order. The
 * compact frame can therefore keep its existing value and range protocol: the
 * Element Template store changes the native owner, not the background wire.
 */
export interface LynxElementTemplateProgram {
	readonly template: LynxElementTemplateNode;
	readonly attributeSlots: number;
	readonly childSlots: number;
	readonly visibilitySlot: number;
}

function templateType(type: string): string {
	return type === '#text' ? 'raw-text' : type;
}

function templateAttributeName(type: string, name: string): string {
	if ((type === '#text' || type === 'raw-text') && name === 'value') return 'text';
	return name === 'className' ? 'class' : name;
}

function staticValue(value: unknown): string | number | boolean | null | undefined {
	if (value === null || typeof value === 'string') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
	if (typeof value === 'boolean') return value;
	return undefined;
}

/**
 * Lower one already-validated shared Lynx program IR to the public SDK Element
 * Template Definition shape.
 *
 * `null` is a conservative eligibility answer. The first whole-root slice does
 * not mix ordinary ElementRefs with template handles, so refs, main-thread
 * worklets, typed native list hosts, text-polymorphic ranges, and native
 * attribute-composition cases remain on the existing application backend.
 */
export function deriveLynxElementTemplateProgram(
	ir: LynxProgramIR,
): LynxElementTemplateProgram | null {
	if (ir.version !== LYNX_PROGRAM_IR_VERSION) return null;
	const nodes = ir.wire.nodes;
	if (nodes.length === 0 || nodes[0]?.parent !== -1) return null;
	if (ir.refs !== undefined || ir.addressable !== true) return null;
	if (ir.wire.events.length !== ir.events.length) return null;
	const children = Array.from({ length: nodes.length }, () => [] as number[]);
	for (let index = 1; index < nodes.length; index++) {
		const parent = nodes[index]!.parent;
		if (!Number.isSafeInteger(parent) || parent < 0 || parent >= index) return null;
		children[parent]!.push(index);
	}

	const ranges = new Map<number, { readonly index: number; readonly before: number | null }>();
	for (let index = 0; index < ir.ranges.length; index++) {
		const range = ir.ranges[index]!;
		if (ranges.has(range.node)) return null;
		const before = range.before ?? null;
		if (
			!Number.isSafeInteger(range.node) ||
			range.node < 0 ||
			range.node >= nodes.length ||
			nodes[range.node]!.type === '#text' ||
			nodes[range.node]!.type === 'raw-text' ||
			(before !== null && nodes[before]?.parent !== range.node)
		) {
			return null;
		}
		ranges.set(range.node, { index, before });
	}

	const attributes = Array.from(
		{ length: nodes.length },
		() => [] as LynxElementTemplateAttribute[],
	);
	const attributeNames = Array.from({ length: nodes.length }, () => new Set<string>());
	const valueSlots = new Set<number>();
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index]!;
		if (node.type === 'list' || node.type === 'list-item') return null;
		for (const [name, input] of Object.entries(node.props)) {
			const value = staticValue(input);
			if (value === undefined) return null;
			const key = templateAttributeName(node.type, name);
			if (attributeNames[index]!.has(key)) return null;
			attributeNames[index]!.add(key);
			attributes[index]!.push({ kind: 'static', key, value });
		}
		for (const binding of node.bindings ?? []) {
			if (parseLynxMainThreadEventProp(binding.name) !== null) return null;
			const value = ir.values[binding.valueIndex];
			if (
				!Number.isSafeInteger(binding.valueIndex) ||
				binding.valueIndex < 0 ||
				binding.valueIndex >= ir.values.length ||
				value?.node !== index ||
				value.name !== binding.name ||
				valueSlots.has(binding.valueIndex)
			) {
				return null;
			}
			const key = templateAttributeName(node.type, binding.name);
			if (attributeNames[index]!.has(key)) return null;
			attributeNames[index]!.add(key);
			valueSlots.add(binding.valueIndex);
			attributes[index]!.push({ kind: 'slot', key, attrSlotIndex: binding.valueIndex });
		}
	}
	if (valueSlots.size !== ir.values.length) return null;

	for (let index = 0; index < ir.events.length; index++) {
		const event = ir.events[index]!;
		const wireEvent = ir.wire.events[index];
		if (
			!Number.isSafeInteger(event.node) ||
			event.node < 0 ||
			event.node >= nodes.length ||
			wireEvent?.node !== event.node ||
			wireEvent.type !== event.type ||
			wireEvent.priority !== event.priority
		) {
			return null;
		}
		if (attributeNames[event.node]!.has(event.type)) return null;
		attributeNames[event.node]!.add(event.type);
		attributes[event.node]!.push({
			kind: 'slot',
			key: event.type,
			attrSlotIndex: ir.values.length + index,
		});
	}
	const visibilitySlot = ir.values.length + ir.events.length;
	if (attributeNames[0]!.has('hidden')) return null;
	attributes[0]!.push({ kind: 'slot', key: 'hidden', attrSlotIndex: visibilitySlot });

	const lower = (index: number): LynxElementTemplateNode => {
		const range = ranges.get(index);
		const loweredChildren: (LynxElementTemplateNode | LynxElementTemplateElementSlot)[] = [];
		for (const child of children[index]!) {
			if (range?.before === child) {
				loweredChildren.push({
					kind: 'elementSlot',
					type: 'slot',
					elementSlotIndex: range.index,
				});
			}
			loweredChildren.push(lower(child));
		}
		if (range !== undefined && range.before === null) {
			loweredChildren.push({
				kind: 'elementSlot',
				type: 'slot',
				elementSlotIndex: range.index,
			});
		}
		return {
			kind: 'element',
			type: templateType(nodes[index]!.type),
			attributesArray: attributes[index]!,
			children: loweredChildren,
		};
	};

	return Object.freeze({
		template: lower(0),
		attributeSlots: visibilitySlot + 1,
		childSlots: ir.ranges.length,
		visibilitySlot,
	});
}
