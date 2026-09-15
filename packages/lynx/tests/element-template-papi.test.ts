import { describe, expect, it, vi } from 'vitest';

import {
	createLynxElementTemplatePAPI,
	type LynxElementTemplateHandle,
} from '../src/core/element-template-papi.js';

describe('Lynx Element Template PAPI', () => {
	it('normalizes the branded whole-root SDK surface without ordinary Element calls', () => {
		const page = {} as LynxElementTemplateHandle;
		const row = {} as LynxElementTemplateHandle;
		const target = {
			__CreateTypedElementTemplate: vi.fn(() => page),
			__CreateElementTemplate: vi.fn(() => row),
			__SetAttributeOfElementTemplate: vi.fn(),
			__InsertNodeToElementTemplate: vi.fn(),
			__RemoveNodeFromElementTemplate: vi.fn(),
			__SerializeElementTemplate: vi.fn(() => ({ uid: 0 })),
			__FlushElementTree: vi.fn(),
		};
		const papi = createLynxElementTemplatePAPI(target);

		expect(papi.createPage()).toBe(page);
		expect(target.__CreateTypedElementTemplate).toHaveBeenCalledWith('page', null, null, 0, null);
		expect(papi.create('_octane_et_row', ['row', 7, false], [[row]], 2)).toBe(row);
		expect(target.__CreateElementTemplate).toHaveBeenCalledWith(
			'_octane_et_row',
			null,
			['row', 7, false],
			[[row]],
			2,
		);
		papi.insert(page, 0, row, null);
		papi.setAttribute(row, 1, 'next');
		expect(target.__SetAttributeOfElementTemplate).toHaveBeenCalledWith(row, 1, 'next', null);
		papi.remove(page, 0, row);
		expect(papi.serialize(page)).toEqual({ uid: 0 });
		papi.flush(undefined, { reloadVersion: 1 });
		expect(target.__FlushElementTree).toHaveBeenCalledWith(undefined, { reloadVersion: 1 });
	});

	it('fails before page creation when the realm lacks one required template primitive', () => {
		expect(() => createLynxElementTemplatePAPI({})).toThrow(/requires __CreateElementTemplate/);
	});
});
