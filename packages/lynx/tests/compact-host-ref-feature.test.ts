import { describe, expect, it } from 'vitest';

import {
	activateLynxCompactPublicHandle,
	createLynxClientContainer,
} from '../src/core/client-driver.compiled-program.js';
import { enableLynxCompilerProgramRefs } from '../src/core/compact-host-refs.js';
import type {
	LynxCreateSelectorQuery,
	LynxNativeInvokeOptions,
	LynxNativeNodesRef,
} from '../src/core/nodes-ref.js';

describe('@octanejs/lynx compact host-ref feature', () => {
	it('activates the real NodesRef query path for compiler-proven ref modules', async () => {
		let selector = '';
		let invoke: LynxNativeInvokeOptions | null = null;
		const nativeRef: LynxNativeNodesRef = {
			invoke(options) {
				invoke = options;
				return { exec() {} };
			},
			fields() {
				throw new Error('unused');
			},
			path() {
				throw new Error('unused');
			},
			setNativeProps() {
				throw new Error('unused');
			},
		};
		const createSelectorQuery: LynxCreateSelectorQuery = () => ({
			select(value) {
				selector = value;
				return nativeRef;
			},
		});
		enableLynxCompilerProgramRefs();
		const container = createLynxClientContainer({ createSelectorQuery });
		const handle = activateLynxCompactPublicHandle(container, {
			root: 9,
			id: 7,
			type: 'view',
			attached: true,
		});

		const result = handle.invoke('focus');
		expect(selector).toBe('[octane-ref=r9-h7-g1]');
		expect(invoke).toMatchObject({ method: 'focus', params: {} });
		invoke!.success({ focused: true });
		await expect(result).resolves.toEqual({ focused: true });
	});
});
