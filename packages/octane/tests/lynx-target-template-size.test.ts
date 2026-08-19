// Issue-58 L1 accepted a gzip penalty on the `target: 'lynx'` create-function
// encoding as a trade to be repaid at L5. The penalty was not a constant: it
// grew with node count, because every repeated subtree differed from the last
// by the bytes of its per-node local, which is exactly what LZ77 matches on.
// Naming locals by depth removes that, and these cases keep it removed — the
// structural pin first, the compression it buys second.
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compiler/compile.js';
import { lynxMainThreadRenderer } from '../../lynx/src/config.js';

function toolbarSource(buttons: number): string {
	const items = Array.from(
		{ length: buttons },
		(_unused, index) =>
			`\t\t<view class="btn b${index}" bindtap={press}>\n` +
			`\t\t\t<text class="cap">{labels[${index}] as string}</text>\n` +
			`\t\t</view>`,
	).join('\n');
	return `import { useCallback } from 'octane';

export function Toolbar(props: { labels: string[] }) @{
\tconst labels = props.labels;
\tconst press = useCallback(() => {}, []);
\t<view class="toolbar">
${items}
\t</view>
}
`;
}

function compiled(source: string, target: 'lynx' | 'universal'): string {
	return compile(source, '/src/Toolbar.lynx.tsrx', {
		hmr: false,
		renderer: { ...lynxMainThreadRenderer, target, id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread: 'main-thread' },
	}).code;
}

const gzipped = (text: string): number => gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).length;

describe('lynx template encoding size', () => {
	it('names create-function locals by depth, not by node', () => {
		// The toolbar is three levels deep at any width, so a create function for
		// 4 buttons and one for 120 must use the same identifiers.
		const locals = (buttons: number): string[] => {
			const code = compiled(toolbarSource(buttons), 'lynx');
			return [...new Set(code.match(/\bn\d+\b/g) ?? [])].sort();
		};
		const narrow = locals(4);
		const wide = locals(120);
		expect(wide).toEqual(narrow);
		expect(wide.length).toBeLessThanOrEqual(4);
	});

	it('keeps the gzipped create-function encoding at parity with the interpreted plan', () => {
		for (const buttons of [4, 40, 120]) {
			const source = toolbarSource(buttons);
			const lynx = compiled(source, 'lynx');
			const universal = compiled(source, 'universal');

			// Raw output was always the smaller of the two; gzip is what regressed.
			expect(lynx.length, `toolbar-${buttons} raw`).toBeLessThan(universal.length);
			// A per-node local costs ~1% of the gzipped module at 4 buttons and
			// more than 100% at 120, so a ratio that holds across the ladder is
			// what proves the growth is gone rather than merely small somewhere.
			expect(gzipped(lynx) / gzipped(universal), `toolbar-${buttons} gzip ratio`).toBeLessThan(1.1);
		}
	});
});
