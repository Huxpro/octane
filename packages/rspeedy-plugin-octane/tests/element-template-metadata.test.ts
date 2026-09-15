import { describe, expect, it } from 'vitest';

import { collectLynxElementTemplates } from '../src/application.js';

function compilerModule(
	id: string,
	total: number,
	lowered: number,
	templates: readonly {
		readonly templateId: string;
		readonly compiledTemplate: Readonly<Record<string, unknown>>;
	}[],
	visibilitySlots = lowered,
): object {
	return {
		buildInfo: {
			octane: {
				canonicalId: id,
				transformKind: 'compile',
				serverRpc: false,
				universalRuntime: { runtime: 'lynx', thread: 'main-thread' },
				lynxElementTemplateCoverage: { total, lowered, visibilitySlots },
				lynxElementTemplates: templates.map((template) => ({
					...template,
					sourceFile: id,
				})),
			},
		},
	};
}

function collect(
	modules: readonly object[],
	retainVisibility = true,
): Readonly<Record<string, unknown>> {
	const chunk = {};
	return collectLynxElementTemplates(
		{
			chunkGraph: {
				getChunkModules(candidate: object) {
					expect(candidate).toBe(chunk);
					return modules;
				},
			},
		},
		[{ chunks: [chunk] }],
		retainVisibility,
	);
}

describe('Lynx Element Template encoder metadata', () => {
	it('deduplicates compiler-proved templates in stable template-id order', () => {
		const row = {
			kind: 'element',
			type: 'view',
			attributesArray: [],
			children: [],
		};
		const result = collect([
			compilerModule('src/z.lynx.tsrx', 1, 1, [
				{ templateId: '_octane_et_b', compiledTemplate: row },
			]),
			compilerModule('src/a.lynx.tsrx', 2, 2, [
				{ templateId: '_octane_et_a', compiledTemplate: { ...row, type: 'text' } },
				{ templateId: '_octane_et_b', compiledTemplate: { ...row } },
			]),
		]);

		expect(Object.keys(result)).toEqual(['_et_builtin_raw_text', '_octane_et_a', '_octane_et_b']);
		expect(result).toEqual({
			_et_builtin_raw_text: {
				kind: 'element',
				type: 'raw-text',
				attributesArray: [{ kind: 'slot', key: 'text', attrSlotIndex: 0 }],
				children: [],
			},
			_octane_et_a: { ...row, type: 'text' },
			_octane_et_b: row,
		});
		expect(Object.isFrozen(result)).toBe(true);
	});

	it('fails closed when any main-thread plan lacks a Template Definition', () => {
		expect(() =>
			collect([
				compilerModule('src/App.lynx.tsrx', 2, 1, [
					{
						templateId: '_octane_et_a',
						compiledTemplate: {
							kind: 'element',
							type: 'view',
							attributesArray: [],
							children: [],
						},
					},
				]),
			]),
		).toThrow(/covered 1 of 2 main-thread plans/);
	});

	it('passes through the structurally specialized compiler definition unchanged', () => {
		const nestedHidden = {
			kind: 'element',
			type: 'text',
			attributesArray: [{ kind: 'static', key: 'hidden', value: true }],
			children: [],
		};
		const definition = {
			kind: 'element',
			type: 'view',
			attributesArray: [{ kind: 'slot', key: 'class', attrSlotIndex: 0 }],
			children: [nestedHidden],
		};
		const result = collect(
			[
				compilerModule(
					'src/App.lynx.tsrx',
					1,
					1,
					[{ templateId: '_octane_et_row', compiledTemplate: definition }],
					0,
				),
			],
			false,
		);

		expect(result._octane_et_row).toBe(definition);
	});

	it('fails closed when compiler output disagrees with the graph visibility proof', () => {
		expect(() =>
			collect(
				[
					compilerModule('src/App.lynx.tsrx', 1, 1, [
						{
							templateId: '_octane_et_row',
							compiledTemplate: { kind: 'element', type: 'view' },
						},
					]),
				],
				false,
			),
		).toThrow(/retained 1 of 1 visibility slots, expected 0/);
	});

	it('rejects collisions instead of letting module order select native structure', () => {
		expect(() =>
			collect([
				compilerModule('src/a.lynx.tsrx', 1, 1, [
					{ templateId: '_octane_et_same', compiledTemplate: { kind: 'element', type: 'view' } },
				]),
				compilerModule('src/b.lynx.tsrx', 1, 1, [
					{ templateId: '_octane_et_same', compiledTemplate: { kind: 'element', type: 'text' } },
				]),
			]),
		).toThrow(/id collision/);
	});
});
