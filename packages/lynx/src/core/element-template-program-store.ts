declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalProgramPlan } from 'octane/universal/native';

import { encodePrevalidatedLynxNativeEventToken } from './native-events.js';
import type {
	LynxElementTemplateAttributeValue,
	LynxElementTemplateHandle,
	LynxElementTemplatePAPI,
} from './element-template-papi.js';
import {
	createLynxElementTemplateNativeBudget,
	type LynxElementTemplateNativeBudget,
} from './element-template-native-budget.js';
import type {
	LynxCompiledProgramAdoption,
	LynxCompiledProgramMount,
	LynxCompiledProgramStore,
} from './compiled-program-store.js';

export type LynxElementTemplateAddress =
	| { readonly kind: 'page'; readonly owner: 1; readonly slot: 0 }
	| {
			readonly kind: 'range';
			readonly owner: number;
			readonly slot: number;
			readonly childSlot: number;
	  }
	| { readonly kind: 'node'; readonly owner: number; readonly node: number };

interface TemplateInstance<Handle extends LynxElementTemplateHandle> {
	readonly handle: number;
	readonly native: Handle;
	readonly plan: UniversalProgramPlan;
	readonly listener: number;
	readonly values: unknown[];
	readonly parent: LynxElementTemplateAddress;
	next: number | null;
	previous: number | null;
	visible: boolean;
}

interface TemplateRange {
	readonly parent: LynxElementTemplateAddress;
	readonly anchor: LynxElementTemplateAddress | null;
	head: number | null;
	tail: number | null;
}

const enum JournalOpcode {
	Mount = 1,
	Set = 2,
	Remove = 3,
	Move = 4,
	Visibility = 5,
	Adopt = 6,
}

const MAX_HANDLE = 2 ** 31 - 1;
const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const CODE = 'Octane Lynx OL510';

function fail(message: string): never {
	throw new TypeError(DEVELOPMENT ? `Octane Lynx Element Template store ${message}.` : CODE);
}

function aggregate(errors: unknown[], message: string): never {
	throw new AggregateError(errors, DEVELOPMENT ? message : CODE);
}

function requireHandle(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 1 || value > MAX_HANDLE) {
		fail('requires an in-range instance handle above the reserved root');
	}
}

function sameAddress(left: LynxElementTemplateAddress, right: LynxElementTemplateAddress): boolean {
	if (left.kind !== right.kind || left.owner !== right.owner) return false;
	if (left.kind === 'page') return true;
	if (left.kind === 'node') return left.node === (right as typeof left).node;
	return (
		left.slot === (right as typeof left).slot && left.childSlot === (right as typeof left).childSlot
	);
}

function rangeKey(parent: LynxElementTemplateAddress): string {
	if (parent.kind === 'page') return 'p';
	if (parent.kind !== 'range') fail('requires a page or structural-range parent');
	return `${parent.owner}:${parent.childSlot}`;
}

function scalar(value: unknown): value is LynxElementTemplateAttributeValue {
	const type = typeof value;
	return (
		value === null ||
		value === undefined ||
		type === 'string' ||
		type === 'boolean' ||
		(type === 'number' && Number.isFinite(value))
	);
}

function slotValue(plan: UniversalProgramPlan, slot: number, value: unknown): boolean {
	if (!scalar(value)) return false;
	const kind = plan.slots[plan.values[slot]!];
	return kind === 'c' ? typeof value === 'string' : kind?.startsWith('p:') === true;
}

function planTemplate(
	plan: UniversalProgramPlan,
): NonNullable<UniversalProgramPlan['elementTemplate']> {
	const template = plan.elementTemplate;
	if (
		template === undefined ||
		typeof template.templateId !== 'string' ||
		template.templateId.length === 0 ||
		template.attributeSlots !== plan.values.length + plan.events.length + 1 ||
		template.childSlots !== plan.ranges.length ||
		template.visibilitySlot !== template.attributeSlots - 1 ||
		plan.refs !== undefined ||
		plan.wire?.nodes.some(
			(node) =>
				node.type === 'list' ||
				node.type === 'list-item' ||
				node.bindings?.some((binding) => binding.name.startsWith('main-thread:')),
		)
	) {
		fail('requires a compiler-proved whole-root template plan');
	}
	for (const range of plan.ranges) {
		if (range.paintsText === true) fail('does not accept a text-polymorphic structural range');
	}
	return template;
}

export interface LynxElementTemplateAdoptionSeed<Handle extends LynxElementTemplateHandle> {
	readonly natives: readonly Handle[];
	readonly firstListenerId: number | null;
	readonly paintedValues: readonly unknown[];
	/** True when the shared native budget already owns these live handles. */
	readonly residentReserved?: true;
}

export type LynxElementTemplateAdoptionSeedResolver<Handle extends LynxElementTemplateHandle> = (
	input: LynxCompiledProgramMount<LynxElementTemplateAddress>,
) => LynxElementTemplateAdoptionSeed<Handle> | undefined;

/**
 * Create the main-thread store for the fail-closed whole-root Element Template slice.
 *
 * Its public shape intentionally matches the compact program store, but its
 * `Node` is a logical range/static-anchor address rather than an ElementRef.
 * Only this store resolves those addresses to branded template handles.
 */
export function createLynxElementTemplateProgramStore<Handle extends LynxElementTemplateHandle>(
	papi: LynxElementTemplatePAPI<Handle>,
	page: Handle,
	root: number,
	firstListener = 1,
	seed?: LynxElementTemplateAdoptionSeedResolver<Handle>,
	nativeBudget: LynxElementTemplateNativeBudget = createLynxElementTemplateNativeBudget(papi),
): LynxCompiledProgramStore<LynxElementTemplateAddress> & {
	readonly page: LynxElementTemplateAddress;
} {
	if (!Number.isSafeInteger(root) || root <= 0) fail('requires a positive root identity');
	if (!Number.isSafeInteger(firstListener) || firstListener <= 0) {
		fail('requires a positive first listener identity');
	}
	const pageAddress = Object.freeze({ kind: 'page' as const, owner: 1 as const, slot: 0 as const });
	const instances = new Map<number, TemplateInstance<Handle>>();
	const ranges = new Map<string, TemplateRange>();
	const templates: (UniversalProgramPlan | undefined)[] = [undefined];
	let journal: unknown[] | null = null;
	let journalFirstHandle = 1;
	let journalFirstListener = firstListener;
	let journalFirstTemplates = 1;
	let lastHandle = 1;
	let nextListener = firstListener;
	let faulted = false;
	let closing = false;

	const healthy = (): void => {
		if (faulted) fail('is faulted after an incomplete native rollback');
		if (closing) fail('is closing or closed');
	};
	const activeJournal = (): unknown[] => {
		healthy();
		if (journal === null) fail('requires begin() before host operations');
		return journal;
	};
	const instance = (handle: number): TemplateInstance<Handle> => {
		requireHandle(handle);
		const value = instances.get(handle);
		if (value === undefined) fail(`does not hold instance ${handle}`);
		return value;
	};
	const nativeParent = (
		address: LynxElementTemplateAddress,
	): { readonly native: Handle; readonly slot: number } => {
		if (address.kind === 'page') return { native: page, slot: 0 };
		if (address.kind !== 'range') fail('requires a page or structural-range parent');
		return { native: instance(address.owner).native, slot: address.childSlot };
	};
	const unlink = (value: TemplateInstance<Handle>, range: TemplateRange): void => {
		if (value.previous === null) range.head = value.next;
		else instance(value.previous).next = value.next;
		if (value.next === null) range.tail = value.previous;
		else instance(value.next).previous = value.previous;
		if (range.head === null) ranges.delete(rangeKey(value.parent));
	};
	const relink = (value: TemplateInstance<Handle>, range: TemplateRange): void => {
		if (!ranges.has(rangeKey(value.parent))) ranges.set(rangeKey(value.parent), range);
		if (value.previous === null) range.head = value.handle;
		else instance(value.previous).next = value.handle;
		if (value.next === null) range.tail = value.handle;
		else instance(value.next).previous = value.handle;
	};
	const nativeBefore = (before: number | null): Handle | null =>
		before === null ? null : instance(before).native;
	const validateAnchor = (
		parent: LynxElementTemplateAddress,
		anchor: LynxElementTemplateAddress | null,
	): void => {
		if (parent.kind === 'page') {
			if (anchor !== null) fail('page range cannot name a static anchor');
			return;
		}
		if (parent.kind !== 'range') fail('requires a structural-range parent');
		const owner = instance(parent.owner);
		const site = owner.plan.ranges[parent.childSlot];
		if (site?.slot !== parent.slot) fail('lost the compiler range-slot mapping');
		const expected = site.before ?? null;
		if (expected === null) {
			if (anchor !== null) fail('tail range cannot name a static anchor');
		} else if (
			anchor?.kind !== 'node' ||
			anchor.owner !== parent.owner ||
			anchor.node !== expected
		) {
			fail('static anchor disagrees with the Template Definition child slot');
		}
	};
	const rangeFor = (
		parent: LynxElementTemplateAddress,
		anchor: LynxElementTemplateAddress | null,
	): TemplateRange => {
		validateAnchor(parent, anchor);
		const key = rangeKey(parent);
		const current = ranges.get(key);
		if (current === undefined) return { parent, anchor, head: null, tail: null };
		if (
			!sameAddress(current.parent, parent) ||
			(current.anchor === null) !== (anchor === null) ||
			(current.anchor !== null && anchor !== null && !sameAddress(current.anchor, anchor))
		) {
			fail('range anchor changed after native insertion');
		}
		return current;
	};
	const validateBefore = (
		parent: LynxElementTemplateAddress,
		before: number | null,
	): TemplateInstance<Handle> | null => {
		if (before === null) return null;
		const target = instance(before);
		if (!sameAddress(target.parent, parent)) fail('received an anchor outside the target range');
		return target;
	};
	const eventToken = (value: TemplateInstance<Handle>, site: number): string => {
		const event = value.plan.events[site]!;
		return encodePrevalidatedLynxNativeEventToken(
			root,
			value.handle,
			1,
			value.listener + site,
			event.priority,
		);
	};
	const setVisibility = (value: TemplateInstance<Handle>, visible: boolean): void => {
		const template = planTemplate(value.plan);
		const changed: Array<readonly [number, LynxElementTemplateAttributeValue]> = [];
		const write = (slot: number, next: LynxElementTemplateAttributeValue): void => {
			const previous =
				slot === template.visibilitySlot
					? !value.visible
					: value.visible
						? eventToken(value, slot - value.plan.values.length)
						: null;
			nativeBudget.run(1, () => papi.setAttribute(value.native, slot, next));
			changed.push([slot, previous]);
		};
		try {
			if (visible) write(template.visibilitySlot, false);
			for (let site = 0; site < value.plan.events.length; site++) {
				write(value.plan.values.length + site, visible ? eventToken(value, site) : null);
			}
			if (!visible) write(template.visibilitySlot, true);
		} catch (error) {
			const errors: unknown[] = [error];
			for (let index = changed.length - 1; index >= 0; index--) {
				try {
					nativeBudget.run(1, () =>
						papi.setAttribute(value.native, changed[index]![0], changed[index]![1]),
					);
				} catch (rollbackError) {
					errors.push(rollbackError);
				}
			}
			if (errors.length !== 1) {
				faulted = true;
				aggregate(errors, 'Element Template visibility rollback failed.');
			}
			throw error;
		}
		value.visible = visible;
	};
	const moveNative = (value: TemplateInstance<Handle>, before: number | null): void => {
		const target = nativeParent(value.parent);
		nativeBudget.run(1, () =>
			papi.insert(target.native, target.slot, value.native, nativeBefore(before)),
		);
		const range = ranges.get(rangeKey(value.parent));
		if (range === undefined) fail('lost the instance range order');
		unlink(value, range);
		value.next = before;
		value.previous = before === null ? range.tail : instance(before).previous;
		relink(value, range);
	};
	const removeInstance = (handle: number, undo: unknown[]): void => {
		const value = instance(handle);
		for (let slot = 0; slot < value.plan.ranges.length; slot++) {
			if (ranges.has(`${handle}:${slot}`)) {
				fail(`cannot remove instance ${handle} while range ${slot} owns children`);
			}
		}
		const range = ranges.get(rangeKey(value.parent));
		if (range === undefined) fail('lost the instance range order');
		const before = value.next;
		const target = nativeParent(value.parent);
		try {
			nativeBudget.run(1, () => papi.remove(target.native, target.slot, value.native));
		} catch (error) {
			try {
				nativeBudget.run(1, () =>
					papi.insert(target.native, target.slot, value.native, nativeBefore(before)),
				);
			} catch (rollbackError) {
				faulted = true;
				aggregate([error, rollbackError], 'Element Template remove rollback failed.');
			}
			throw error;
		}
		nativeBudget.releaseResident(1, value.plan.nodes);
		unlink(value, range);
		instances.delete(handle);
		undo.push(value, range, before, JournalOpcode.Remove);
	};
	const mount = (input: LynxCompiledProgramMount<LynxElementTemplateAddress>): void => {
		const undo = activeJournal();
		requireHandle(input.firstHandle);
		if (!Number.isSafeInteger(input.count) || input.count <= 0)
			fail('requires a positive run count');
		const finalHandle = input.firstHandle + input.count - 1;
		if (
			!Number.isSafeInteger(finalHandle) ||
			finalHandle > MAX_HANDLE ||
			input.firstHandle <= lastHandle
		) {
			fail('requires a fresh contiguous instance range');
		}
		const template = planTemplate(input.plan);
		const valueOffset = input.valueOffset ?? 0;
		const valueCount = input.plan.values.length * input.count;
		if (
			!Number.isSafeInteger(valueOffset) ||
			valueOffset < 0 ||
			valueOffset + valueCount > input.values.length ||
			(input.valueOffset === undefined && valueOffset + valueCount !== input.values.length)
		) {
			fail('received the wrong run value arity');
		}
		for (let offset = 0; offset < valueCount; offset++) {
			if (
				!slotValue(
					input.plan,
					offset % input.plan.values.length,
					input.values[valueOffset + offset],
				)
			) {
				fail(`received a value outside slot ${offset % input.plan.values.length}`);
			}
		}
		const anchor = input.anchor ?? null;
		if (input.before !== null && anchor !== null) fail('cannot combine dynamic and static anchors');
		const range = rangeFor(input.parent, anchor);
		const before = validateBefore(input.parent, input.before);
		let previous = before === null ? range.tail : before.previous;
		const target = nativeParent(input.parent);
		const adoption = seed?.(input);
		if (adoption !== undefined) {
			const firstListenerId = input.plan.events.length === 0 ? null : nextListener;
			if (
				input.before !== null ||
				adoption.natives.length !== input.count ||
				adoption.paintedValues.length !== valueCount ||
				adoption.firstListenerId !== firstListenerId
			) {
				fail('received incompatible first-screen template ownership');
			}
			const adoptionNativeCost = input.plan.nodes * input.count;
			const adoptionReserved = adoption.residentReserved !== true;
			if (adoptionReserved) nativeBudget.reserveResident(input.count, adoptionNativeCost);
			const adopted: TemplateInstance<Handle>[] = [];
			const changed: Array<readonly [Handle, number, LynxElementTemplateAttributeValue]> = [];
			try {
				for (let row = 0; row < input.count; row++) {
					const handle = input.firstHandle + row;
					const values = input.values.slice(
						valueOffset + row * input.plan.values.length,
						valueOffset + (row + 1) * input.plan.values.length,
					);
					const native = adoption.natives[row]!;
					for (let slot = 0; slot < values.length; slot++) {
						const previousValue = adoption.paintedValues[row * values.length + slot];
						if (Object.is(previousValue, values[slot])) continue;
						nativeBudget.run(1, () =>
							papi.setAttribute(native, slot, values[slot] as LynxElementTemplateAttributeValue),
						);
						changed.push([native, slot, previousValue as LynxElementTemplateAttributeValue]);
					}
					const value: TemplateInstance<Handle> = {
						handle,
						native,
						plan: input.plan,
						listener: nextListener + row * input.plan.events.length,
						values,
						parent: input.parent,
						previous,
						next: null,
						visible: true,
					};
					instances.set(handle, value);
					relink(value, range);
					adopted.push(value);
					previous = handle;
				}
			} catch (error) {
				const errors: unknown[] = [error];
				for (let index = adopted.length - 1; index >= 0; index--) {
					const value = adopted[index]!;
					const currentRange = ranges.get(rangeKey(value.parent));
					if (currentRange !== undefined) unlink(value, currentRange);
					instances.delete(value.handle);
				}
				for (let index = changed.length - 1; index >= 0; index--) {
					try {
						nativeBudget.run(1, () =>
							papi.setAttribute(changed[index]![0], changed[index]![1], changed[index]![2]),
						);
					} catch (rollbackError) {
						errors.push(rollbackError);
					}
				}
				if (adoptionReserved) {
					nativeBudget.releaseResident(input.count, adoptionNativeCost);
				}
				if (errors.length !== 1) {
					faulted = true;
					aggregate(errors, 'Element Template adoption cleanup failed.');
				}
				throw error;
			}
			undo.push(adopted, changed, range, adoptionReserved, adoptionNativeCost, JournalOpcode.Adopt);
			lastHandle = finalHandle;
			nextListener += input.plan.events.length * input.count;
			return;
		}
		const created: TemplateInstance<Handle>[] = [];
		let pending: TemplateInstance<Handle> | null = null;
		try {
			for (let row = 0; row < input.count; row++) {
				const handle = input.firstHandle + row;
				const values = input.values.slice(
					valueOffset + row * input.plan.values.length,
					valueOffset + (row + 1) * input.plan.values.length,
				);
				const attributes = new Array<LynxElementTemplateAttributeValue>(
					template.attributeSlots,
				).fill(null);
				for (let slot = 0; slot < values.length; slot++) {
					attributes[slot] = values[slot] as LynxElementTemplateAttributeValue;
				}
				const listener = nextListener + row * input.plan.events.length;
				for (let site = 0; site < input.plan.events.length; site++) {
					const event = input.plan.events[site]!;
					attributes[input.plan.values.length + site] = encodePrevalidatedLynxNativeEventToken(
						root,
						handle,
						1,
						listener + site,
						event.priority,
					);
				}
				attributes[template.visibilitySlot] = false;
				nativeBudget.reserveResident(1, input.plan.nodes);
				let native: Handle;
				try {
					native = nativeBudget.run(input.plan.nodes, () =>
						papi.create(template.templateId, attributes, [], handle),
					);
				} catch (error) {
					nativeBudget.releaseResident(1, input.plan.nodes);
					throw error;
				}
				const value: TemplateInstance<Handle> = {
					handle,
					native,
					plan: input.plan,
					listener,
					values,
					parent: input.parent,
					previous,
					next: input.before,
					visible: true,
				};
				pending = value;
				nativeBudget.run(1, () =>
					papi.insert(target.native, target.slot, value.native, before?.native ?? null),
				);
				pending = null;
				instances.set(handle, value);
				relink(value, range);
				created.push(value);
				previous = handle;
			}
		} catch (error) {
			const errors: unknown[] = [error];
			if (pending !== null) {
				try {
					// Native insertion may mutate before throwing. Without crossing back
					// into ordinary Element inspection, removal is the only safe cleanup
					// probe; failure faults the store rather than claiming a retryable tree.
					nativeBudget.run(1, () => papi.remove(target.native, target.slot, pending!.native));
					nativeBudget.releaseResident(1, pending.plan.nodes);
				} catch (cleanupError) {
					errors.push(cleanupError);
				}
			}
			for (let index = created.length - 1; index >= 0; index--) {
				const value = created[index]!;
				try {
					nativeBudget.run(1, () => papi.remove(target.native, target.slot, value.native));
					nativeBudget.releaseResident(1, value.plan.nodes);
				} catch (cleanupError) {
					errors.push(cleanupError);
				}
				const currentRange = ranges.get(rangeKey(value.parent));
				if (currentRange !== undefined) unlink(value, currentRange);
				instances.delete(value.handle);
			}
			if (errors.length !== 1) {
				faulted = true;
				aggregate(errors, 'Element Template mount cleanup failed.');
			}
			throw error;
		}
		undo.push(input.firstHandle, input.count, range, JournalOpcode.Mount);
		lastHandle = finalHandle;
		nextListener += input.plan.events.length * input.count;
	};
	const rollback = (): void => {
		if (journal === null) fail('cannot roll back without an active frame');
		const active = journal;
		journal = null;
		const errors: unknown[] = [];
		while (active.length !== 0) {
			try {
				const opcode = active.pop();
				if (opcode === JournalOpcode.Mount) {
					const range = active.pop() as TemplateRange;
					const count = active.pop() as number;
					const first = active.pop() as number;
					for (let offset = count - 1; offset >= 0; offset--) {
						const value = instance(first + offset);
						const target = nativeParent(value.parent);
						nativeBudget.run(1, () => papi.remove(target.native, target.slot, value.native));
						nativeBudget.releaseResident(1, value.plan.nodes);
						unlink(value, range);
						instances.delete(value.handle);
					}
				} else if (opcode === JournalOpcode.Set) {
					const previous = active.pop() as LynxElementTemplateAttributeValue;
					const slot = active.pop() as number;
					const value = instance(active.pop() as number);
					nativeBudget.run(1, () => papi.setAttribute(value.native, slot, previous));
					value.values[slot] = previous;
				} else if (opcode === JournalOpcode.Remove) {
					const before = active.pop() as number | null;
					const range = active.pop() as TemplateRange;
					const value = active.pop() as TemplateInstance<Handle>;
					nativeBudget.reserveResident(1, value.plan.nodes);
					const target = nativeParent(value.parent);
					try {
						nativeBudget.run(1, () =>
							papi.insert(target.native, target.slot, value.native, nativeBefore(before)),
						);
					} catch (error) {
						nativeBudget.releaseResident(1, value.plan.nodes);
						throw error;
					}
					instances.set(value.handle, value);
					relink(value, range);
				} else if (opcode === JournalOpcode.Move) {
					const before = active.pop() as number | null;
					const value = instance(active.pop() as number);
					moveNative(value, before);
				} else if (opcode === JournalOpcode.Visibility) {
					const visible = active.pop() as boolean;
					setVisibility(instance(active.pop() as number), visible);
				} else if (opcode === JournalOpcode.Adopt) {
					const adoptionNativeCost = active.pop() as number;
					const adoptionReserved = active.pop() as boolean;
					const range = active.pop() as TemplateRange;
					const changed = active.pop() as Array<
						readonly [Handle, number, LynxElementTemplateAttributeValue]
					>;
					const adopted = active.pop() as TemplateInstance<Handle>[];
					for (let index = adopted.length - 1; index >= 0; index--) {
						const value = adopted[index]!;
						unlink(value, range);
						instances.delete(value.handle);
					}
					for (let index = changed.length - 1; index >= 0; index--) {
						nativeBudget.run(1, () =>
							papi.setAttribute(changed[index]![0], changed[index]![1], changed[index]![2]),
						);
					}
					if (adoptionReserved) {
						nativeBudget.releaseResident(adopted.length, adoptionNativeCost);
					}
				} else {
					fail('journal contains an unknown operation');
				}
			} catch (error) {
				errors.push(error);
			}
		}
		lastHandle = journalFirstHandle;
		nextListener = journalFirstListener;
		templates.length = journalFirstTemplates;
		if (errors.length !== 0) {
			faulted = true;
			aggregate(errors, 'Element Template frame rollback failed.');
		}
	};

	return {
		page: pageAddress,
		begin() {
			healthy();
			if (journal !== null) fail('cannot begin a nested frame');
			journal = [];
			journalFirstHandle = lastHandle;
			journalFirstListener = nextListener;
			journalFirstTemplates = templates.length;
		},
		prepareCommit() {
			activeJournal();
		},
		commit() {
			activeJournal();
			journal = null;
		},
		rollback,
		define(template, plan) {
			activeJournal();
			planTemplate(plan);
			if (template === templates.length) {
				templates.push(plan);
				return true;
			}
			if (templates[template] === plan) return false;
			fail(`cannot define non-contiguous or conflicting template ${template}`);
		},
		resolve(template) {
			return templates[template];
		},
		adopt(_input: LynxCompiledProgramAdoption<LynxElementTemplateAddress>) {
			fail('first-screen adoption requires template-native ownership evidence');
		},
		mount,
		node(handle, index) {
			activeJournal();
			const value = instance(handle);
			if (!Number.isSafeInteger(index) || index < 0 || index >= value.plan.nodes) {
				fail(`instance ${handle} does not hold static node ${String(index)}`);
			}
			return Object.freeze({ kind: 'node' as const, owner: handle, node: index });
		},
		range(handle, slot) {
			activeJournal();
			if (!Number.isSafeInteger(slot) || slot < 0) fail('requires a non-negative range slot');
			const value = instance(handle);
			const childSlot = value.plan.ranges.findIndex((range) => range.slot === slot);
			if (childSlot < 0) fail(`instance ${handle} does not hold range slot ${slot}`);
			return Object.freeze({ kind: 'range' as const, owner: handle, slot, childSlot });
		},
		clear(parent) {
			const undo = activeJournal();
			const range = ranges.get(rangeKey(parent));
			while (range !== undefined && range.head !== null) removeInstance(range.head, undo);
		},
		move(handle, parent, before, anchor = null) {
			const undo = activeJournal();
			const value = instance(handle);
			if (!sameAddress(value.parent, parent)) fail('cannot move an instance across ranges');
			const range = ranges.get(rangeKey(parent));
			if (range === undefined) fail('lost the instance range order');
			validateAnchor(parent, anchor);
			if (before !== null) validateBefore(parent, before);
			if (before === handle || value.next === before) return false;
			const previous = value.next;
			try {
				moveNative(value, before);
			} catch (error) {
				try {
					moveNative(value, previous);
				} catch (rollbackError) {
					faulted = true;
					aggregate([error, rollbackError], 'Element Template move rollback failed.');
				}
				throw error;
			}
			undo.push(handle, previous, JournalOpcode.Move);
			return true;
		},
		remove(handle) {
			removeInstance(handle, activeJournal());
		},
		set(handle, slot, value) {
			const undo = activeJournal();
			if (!Number.isSafeInteger(slot) || slot < 0) fail('requires a non-negative value slot');
			const owner = instance(handle);
			if (slot >= owner.plan.values.length || !slotValue(owner.plan, slot, value)) {
				fail(`received a value outside slot ${slot}`);
			}
			const previous = owner.values[slot];
			if (Object.is(previous, value)) return false;
			try {
				nativeBudget.run(1, () =>
					papi.setAttribute(owner.native, slot, value as LynxElementTemplateAttributeValue),
				);
			} catch (error) {
				try {
					nativeBudget.run(1, () =>
						papi.setAttribute(owner.native, slot, previous as LynxElementTemplateAttributeValue),
					);
				} catch (rollbackError) {
					faulted = true;
					aggregate([error, rollbackError], 'Element Template slot rollback failed.');
				}
				throw error;
			}
			owner.values[slot] = value;
			undo.push(handle, slot, previous, JournalOpcode.Set);
			return true;
		},
		visibility(handle, visible) {
			const undo = activeJournal();
			const value = instance(handle);
			if (value.visible === visible) return false;
			const previous = value.visible;
			setVisibility(value, visible);
			undo.push(handle, previous, JournalOpcode.Visibility);
			return true;
		},
		refs() {
			fail('does not accept ordinary ElementRef runs');
		},
		size() {
			return instances.size;
		},
		isFaulted() {
			return faulted;
		},
		dispose() {
			closing = true;
			const errors: unknown[] = [];
			if (journal !== null) {
				try {
					rollback();
				} catch (error) {
					errors.push(error);
				}
			}
			const attempted = new Set<number>();
			while (instances.size !== 0) {
				let leaf: TemplateInstance<Handle> | undefined;
				for (const candidate of instances.values()) {
					if (attempted.has(candidate.handle)) continue;
					let ownsChildren = false;
					for (let slot = 0; slot < candidate.plan.ranges.length; slot++) {
						if (ranges.has(`${candidate.handle}:${slot}`)) {
							ownsChildren = true;
							break;
						}
					}
					if (!ownsChildren) {
						leaf = candidate;
						break;
					}
				}
				if (leaf === undefined) {
					if (errors.length === 0) errors.push(new Error(CODE));
					break;
				}
				attempted.add(leaf.handle);
				try {
					const target = nativeParent(leaf.parent);
					nativeBudget.run(1, () => papi.remove(target.native, target.slot, leaf.native));
					nativeBudget.releaseResident(1, leaf.plan.nodes);
					const range = ranges.get(rangeKey(leaf.parent));
					if (range !== undefined) unlink(leaf, range);
					instances.delete(leaf.handle);
				} catch (error) {
					errors.push(error);
				}
			}
			if (instances.size === 0) {
				ranges.clear();
				templates.length = 1;
			}
			if (errors.length !== 0) aggregate(errors, 'Element Template disposal failed.');
		},
	};
}
