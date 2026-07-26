/**
 * The exact server output for `_fixtures/hydrate-page.tsrx`.
 *
 * Hydration must run against CLIENT-compiled sources while this markup comes
 * from a SERVER-compiled graph, and one vitest project cannot hold both. The
 * bytes are therefore materialized here, and `tests/ssr/server-html.test.ts`
 * re-renders the same fixture and asserts it still produces exactly these
 * strings, so this file cannot drift out of sync silently. When that test
 * fails, copy the values it reports back into this file.
 */
export const SERVER_HEAD =
	'<!--rnh-8be46ed5--><title>Count 0</title><!--/rnh-8be46ed5-->' +
	'<!--rnh-9e0d8af6--><meta name="theme-color" content="#000000"><!--/rnh-9e0d8af6-->' +
	'<!--rnh-9e0d8af6--><meta name="description" content="page description"><!--/rnh-9e0d8af6-->' +
	'<!--rnh-3649fa01--><link rel="canonical" href="https://example.com/counter"><!--/rnh-3649fa01-->';

export const SERVER_BODY =
	'<!--[--><!--[--><!--[--><!--[--><!--[--><!--]--><!--[--><!--]-->' +
	'<!--[--><!--[--><!--]--><main><button id="bump">bump 0</button></main><!--]--><!--]-->' +
	'<!--[--><!--[f1--><!--[--><!--[--><!--[--><!--[--><!--]--><!--]--><!--]--><!--]-->' +
	'<!--[--><!--[--><!--[--><!--[--><!--]--><!--]--><!--]--><!--]-->' +
	'<!--[--><!--[--><!--[--><!--[--><!--]--><!--]--><!--]--><!--]-->' +
	'<!--[--><!--[--><!--[--><!--[--><!--]--><!--]--><!--]--><!--]-->' +
	'<!--]--><!--]--><!--]--><!--]--><!--]-->';
