// `<Head>` groups tags for readability and nothing more: it does not own
// metadata, so where a block sits cannot change the result. These pin that.
import { describe, it, expect } from 'vitest';
import { prerender } from 'octane/static';
import { Bare, Grouped, Nested, RawScript } from '../_fixtures/head-block.tsrx';

async function render(Component: any) {
	const { html, head } = await prerender(Component, undefined, { headChannel: 'separate' });
	return { html, head: head ?? '' };
}

describe('<Head> grouping', () => {
	it('treats a <Head> block as grouping only, matching bare tags exactly', async () => {
		const grouped = await render(Grouped);
		// The same tags written directly under the provider, with no block.
		const bare = await render(Bare);
		expect(bare.head).toBe(grouped.head);
		expect(grouped.head).toContain('<title>Grouped</title>');
		expect(grouped.head).toContain('content="grouped description"');
		expect(grouped.head).toContain('rel="canonical"');
	});

	it('renders the grouped JSON-LD script', async () => {
		const { html } = await render(Grouped);
		expect(html).toContain('application/ld+json');
		expect(html).toContain('"headline":"Grouped"');
	});

	it('merges a page block with the app-level one, emitting a single set', async () => {
		const { head } = await render(Nested);
		// The page block renders later, so its title wins.
		expect(head).toContain('<title>Deep</title>');
		expect(head).not.toContain('Outer');
		// The app-level block's other tag is untouched.
		expect(head).toContain('content="outer"');
		// One merged set, not one per <Head>.
		expect(head.match(/<title/g)).toHaveLength(1);
		expect(head.match(/rel="canonical"/g)).toHaveLength(1);
	});

	it('renders a raw script body escaped by the renderer', async () => {
		const { html } = await render(RawScript);
		expect(html).toContain('type="text/plain"');
		expect(html).toContain('hello');
	});
});
