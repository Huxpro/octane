import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as CompilerBackend from '../src/compiler/index.js';
import { lynxBlockBackgroundRenderer, lynxMainThreadRenderer } from '../src/config.js';

const MODULE = 'tests/_fixtures/native-list-worklet.lynx.tsrx';
const SOURCE = readFileSync(
	fileURLToPath(new URL('./_fixtures/native-list-worklet.lynx.tsrx', import.meta.url)),
	'utf8',
);

function compileLayer(
	renderer: typeof lynxBlockBackgroundRenderer | typeof lynxMainThreadRenderer,
	thread: 'background' | 'main-thread',
): string {
	const compilerPath = fileURLToPath(
		new URL('../../octane/src/compiler/compile.js', import.meta.url),
	);
	const { compile } = createRequire(import.meta.url)(
		compilerPath,
	) as typeof import('../../octane/src/compiler/compile.js');
	return compile(SOURCE, `/${MODULE}`, {
		hmr: false,
		renderer: { ...renderer, id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread },
		mainThreadProgramBackend: CompilerBackend,
		programModuleId: MODULE,
	}).code;
}

describe('compiled native-list worklet authoring', () => {
	it('emits resident programs for both compact thread layers', () => {
		const background = compileLayer(lynxBlockBackgroundRenderer, 'background');
		const main = compileLayer(lynxMainThreadRenderer, 'main-thread');
		const address = '"module": "tests/_fixtures/native-list-worklet.lynx.tsrx"';
		expect(background.split(address)).toHaveLength(3);
		expect(background).toContain('"name": "main-thread:bindtap"');
		expect(main.split(address)).toHaveLength(3);
		expect(main).toContain('"p:main-thread:bindtap"');
		expect(main).toContain('papi.setEvent(n0, "bindEvent", "tap", v1);');
		expect(main).toContain('Create.run = function');
		expect(main).toContain('Create.set = function');
	});
});
