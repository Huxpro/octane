import { describe, expect, it } from 'vitest';

import {
	installLynxApplicationSelectionReplacement,
	selectedLynxApplication,
} from '../src/application-selection.js';
import {
	installLynxBlockComponentFeatureReplacement,
	selectedLynxBlockComponentFeatures,
} from '../src/block-component-features.js';
import {
	installLynxCompiledProgramFeatureReplacement,
	selectedLynxCompiledProgramFeatures,
} from '../src/compiled-program-features.js';

describe('Lynx application source specialization', () => {
	it('publishes the paired feature decision to encoder metadata', () => {
		const compiler = {
			webpack: {
				NormalModuleReplacementPlugin: class {
					constructor(_test: RegExp, _callback: (resource: { request: string }) => void) {}
					apply() {}
				},
			},
		};
		expect(selectedLynxBlockComponentFeatures(compiler)).toBe('full');
		installLynxBlockComponentFeatureReplacement(compiler, () => 'structural');
		expect(selectedLynxBlockComponentFeatures(compiler)).toBe('structural');
	});

	it('replaces compact thread-function support only after a proved selection', () => {
		const replacements: Array<{
			test: RegExp;
			callback: (resource: { request: string }) => void;
		}> = [];
		const compiler = {
			webpack: {
				NormalModuleReplacementPlugin: class {
					constructor(test: RegExp, callback: (resource: { request: string }) => void) {
						replacements.push({ test, callback });
					}
					apply() {}
				},
			},
		};
		expect(selectedLynxCompiledProgramFeatures(compiler)).toBe('full');
		installLynxCompiledProgramFeatureReplacement(compiler, () => 'no-thread-functions');
		expect(selectedLynxCompiledProgramFeatures(compiler)).toBe('no-thread-functions');

		const resource = { request: './core/compiled-program-features.js' };
		for (const replacement of replacements) {
			if (replacement.test.test(resource.request)) replacement.callback(resource);
		}
		expect(resource.request).toBe('./core/compiled-program-features.no-thread-functions.js');
	});

	it('uses the Element Template owner while retaining the proved compiled background seams', () => {
		const replacements: Array<{
			test: RegExp;
			callback: (resource: { request: string }) => void;
		}> = [];
		const compiler = {
			webpack: {
				NormalModuleReplacementPlugin: class {
					constructor(test: RegExp, callback: (resource: { request: string }) => void) {
						replacements.push({ test, callback });
					}
					apply() {}
				},
			},
		};
		installLynxApplicationSelectionReplacement(compiler, () => 'compiled-program-element-template');
		expect(selectedLynxApplication(compiler)).toBe('compiled-program-element-template');

		const replace = (request: string): string => {
			const resource = { request };
			for (const replacement of replacements) {
				if (replacement.test.test(resource.request)) replacement.callback(resource);
			}
			return resource.request;
		};
		expect(replace('./core/main-thread-application-selection.js')).toBe(
			'./core/main-thread-application-selection.element-template.js',
		);
		expect(replace('./core/application-selection.js')).toBe(
			'./core/application-selection.compiled-program.js',
		);
		expect(replace('./core/client-driver.js')).toBe('./core/client-driver.compiled-program.js');
		expect(replace('./core/main-renderer-selection.js')).toBe(
			'./core/main-renderer-selection.compiled-program.js',
		);
		expect(replace('@octanejs/lynx/first-screen')).toBe(
			'@octanejs/lynx/first-screen-compiled-program',
		);
	});
});
