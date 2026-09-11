export type LynxClassValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly LynxClassValue[]
	| { readonly [name: string]: unknown };

/** Octane's clsx-style class composition without importing the general host driver. */
export function normalizeLynxClass(value: LynxClassValue | unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value !== 'object') {
		return typeof value === 'number' && value ? String(value) : '';
	}
	if (value === null) return '';

	let result = '';
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++) {
			const item = value[index];
			if (!item) continue;
			const normalized = normalizeLynxClass(item);
			if (normalized) result = result ? `${result} ${normalized}` : normalized;
		}
		return result;
	}

	for (const name of Object.keys(value)) {
		if ((value as Record<string, unknown>)[name]) {
			result = result ? `${result} ${name}` : name;
		}
	}
	return result;
}

/**
 * Canonical scalar a resident Lynx program shares across both threads.
 *
 * These are the dense main-thread applier's coercions. Keeping them in a small
 * dependency-free module lets the compact renderer accept the complete public
 * class surface without carrying the general prop planner into its bundle.
 */
export function encodeLynxProgramPropValue(type: string, name: string, value: unknown): unknown {
	if (name === 'class' || name === 'className') return normalizeLynxClass(value);
	if (name === 'id') return value == null ? null : String(value);
	if (type === 'text' && name === 'text') return typeof value === 'string' ? value : '';
	return value === undefined ? null : value;
}
