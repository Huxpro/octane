declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

/** Opaque native handle; deliberately not assignable to the ordinary Element PAPI ref. */
export interface LynxElementTemplateHandle {
	readonly __octaneLynxElementTemplateHandle: unique symbol;
}

export type LynxElementTemplateAttributeValue = string | number | boolean | null | undefined;

export type LynxElementTemplateChildSlots<Handle extends LynxElementTemplateHandle> = readonly (
	readonly Handle[] | null | undefined
)[];

export interface LynxElementTemplatePAPIGlobals<
	Handle extends LynxElementTemplateHandle = LynxElementTemplateHandle,
> {
	__CreateElementTemplate(
		templateKey: string,
		bundleUrl: string | null,
		attributeSlots: readonly LynxElementTemplateAttributeValue[] | null,
		childSlots: LynxElementTemplateChildSlots<Handle> | null,
		uid: number,
	): Handle;
	__CreateTypedElementTemplate(
		type: string,
		attributes: null,
		childSlots: null,
		uid: number | string,
		options: null,
	): Handle;
	__SetAttributeOfElementTemplate(
		element: Handle,
		attrSlotIndex: number,
		value: LynxElementTemplateAttributeValue,
		options: null,
	): void;
	__InsertNodeToElementTemplate(
		parent: Handle,
		childSlotIndex: number,
		child: Handle,
		reference?: Handle | null,
	): void;
	__RemoveNodeFromElementTemplate(parent: Handle, childSlotIndex: number, child: Handle): void;
	__SerializeElementTemplate(element: Handle): unknown;
	__FlushElementTree(
		element: Handle | undefined,
		options?: Readonly<Record<string, unknown>>,
	): void;
}

export interface LynxElementTemplatePAPI<
	Handle extends LynxElementTemplateHandle = LynxElementTemplateHandle,
> {
	createPage(): Handle;
	create(
		templateKey: string,
		attributeSlots: readonly LynxElementTemplateAttributeValue[],
		childSlots: LynxElementTemplateChildSlots<Handle> | null,
		uid: number,
	): Handle;
	setAttribute(
		element: Handle,
		attrSlotIndex: number,
		value: LynxElementTemplateAttributeValue,
	): void;
	insert(parent: Handle, childSlotIndex: number, child: Handle, reference: Handle | null): void;
	remove(parent: Handle, childSlotIndex: number, child: Handle): void;
	serialize(element: Handle): unknown;
	flush(element: Handle | undefined, options?: Readonly<Record<string, unknown>>): void;
}

function requiredFunction<T extends (...args: never[]) => unknown>(
	target: object,
	name: keyof LynxElementTemplatePAPIGlobals,
): T {
	const value = (target as Record<PropertyKey, unknown>)[name];
	if (typeof value !== 'function') {
		throw new Error(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? `Octane Lynx Element Template backend requires ${String(name)}.`
				: 'Octane Lynx OL508',
		);
	}
	return value.bind(target) as T;
}

/** Capture the SDK's public Element Template functions from one main-thread realm. */
export function createLynxElementTemplatePAPI<
	Handle extends LynxElementTemplateHandle = LynxElementTemplateHandle,
>(target: object = globalThis): LynxElementTemplatePAPI<Handle> {
	type Globals = LynxElementTemplatePAPIGlobals<Handle>;
	const create = requiredFunction<Globals['__CreateElementTemplate']>(
		target,
		'__CreateElementTemplate',
	);
	const createTyped = requiredFunction<Globals['__CreateTypedElementTemplate']>(
		target,
		'__CreateTypedElementTemplate',
	);
	const setAttribute = requiredFunction<Globals['__SetAttributeOfElementTemplate']>(
		target,
		'__SetAttributeOfElementTemplate',
	);
	const insert = requiredFunction<Globals['__InsertNodeToElementTemplate']>(
		target,
		'__InsertNodeToElementTemplate',
	);
	const remove = requiredFunction<Globals['__RemoveNodeFromElementTemplate']>(
		target,
		'__RemoveNodeFromElementTemplate',
	);
	const serialize = requiredFunction<Globals['__SerializeElementTemplate']>(
		target,
		'__SerializeElementTemplate',
	);
	const flush = requiredFunction<Globals['__FlushElementTree']>(target, '__FlushElementTree');
	return Object.freeze({
		createPage: () => createTyped('page', null, null, 0, null),
		create: (
			templateKey: string,
			attributeSlots: readonly LynxElementTemplateAttributeValue[],
			childSlots: LynxElementTemplateChildSlots<Handle> | null,
			uid: number,
		) => {
			const element = create(templateKey, null, attributeSlots, childSlots, uid);
			if (element == null) {
				throw new Error(
					typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
						? `Octane Lynx Element Template backend could not create ${templateKey}.`
						: 'Octane Lynx OL509',
				);
			}
			return element;
		},
		setAttribute: (
			element: Handle,
			attrSlotIndex: number,
			value: LynxElementTemplateAttributeValue,
		) => setAttribute(element, attrSlotIndex, value, null),
		insert,
		remove,
		serialize,
		flush: (element: Handle | undefined, options?: Readonly<Record<string, unknown>>) =>
			flush(element, options),
	});
}
