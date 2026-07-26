// What happens when a nested component renders its own <Head>?
//
// It depends entirely on whether that <Head> sits INSIDE the outer one or beside
// it, and the difference is easy to write by accident, so both arrangements are
// pinned here with the real outcome rather than the hoped-for one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, drainPassiveEffects, flushSync } from 'octane';
import { NestedHeads, SiblingHeads } from './_fixtures/sibling-heads.tsrx';

function settle(): void {
	flushSync(() => {});
	drainPassiveEffects();
	flushSync(() => {});
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	document.head.innerHTML = '';
	container = document.createElement('div');
	document.body.appendChild(container);
	root = createRoot(container);
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	root.unmount();
	container.remove();
	document.head.innerHTML = '';
	warn.mockRestore();
});

const toggle = () => {
	container.querySelector<HTMLButtonElement>('#toggle')!.click();
	settle();
};
const titles = () => Array.from(document.head.querySelectorAll('title')).map((t) => t.textContent);

describe('a nested component rendering its own <Head>', () => {
	it('WINS when its <Head> is inside the outer one', () => {
		root.render(NestedHeads);
		settle();
		expect(titles()).toEqual(['XYZ']);

		toggle();

		// One merged set, and the inner component's title wins because it
		// registered last.
		expect(titles()).toEqual(['ZZZ']);
		expect(document.title).toBe('ZZZ');

		// And it hands the title back when it goes away.
		toggle();
		expect(titles()).toEqual(['XYZ']);
		expect(document.title).toBe('XYZ');
	});

	it('does NOT win when its <Head> is a sibling of the outer one', () => {
		root.render(SiblingHeads);
		settle();
		expect(titles()).toEqual(['XYZ']);

		toggle();

		// Neither <Head> contains the other, so each owns and emits its own merged
		// set. The document ends up with two <title> elements and the platform
		// keeps the FIRST, so the inner component's title does not take effect.
		expect(titles()).toEqual(['XYZ', 'ZZZ']);
		expect(document.title).toBe('XYZ');
	});

	it('warns in development about the sibling arrangement', () => {
		root.render(SiblingHeads);
		settle();
		toggle();

		const messages = warn.mock.calls.map((call) => String(call[0])).join('\n');
		expect(messages).toContain('@octanejs/seo');
		expect(messages).toContain('Nest them');
	});
});
