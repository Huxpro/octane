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
	'<!--rnh-1f1a8fc2--><title>Count 0</title><!--/rnh-1f1a8fc2--><!--rnh-cc322685--><meta name' +
	'="theme-color" content="#000000"><!--/rnh-cc322685--><!--rnh-cc322685--><meta name="descri' +
	'ption" content="page description"><!--/rnh-cc322685--><!--rnh-37078ec4--><link rel="canoni' +
	'cal" href="https://example.com/counter"><!--/rnh-37078ec4-->';

export const SERVER_BODY =
	'<!--[--><!--[--><!--[--><!--[--><!--[--><!--[--><!--[--><!--[--><!--[--><!--]--><!--[--><!' +
	'--]--><!--]--><!--]--><!--]--><!--]--><!--[--><!--[--><!--]--><main><button id="bump">bump' +
	' 0</button></main><!--]--><!--]--><!--[--><!--[f1--><!--[--><!--[--><!--[--><!--[--><!--]-' +
	'-><!--]--><!--]--><!--]--><!--[--><!--[--><!--[--><!--[--><!--]--><!--]--><!--]--><!--]-->' +
	'<!--[--><!--[--><!--[--><!--[--><!--]--><!--]--><!--]--><!--]--><!--[--><!--[--><!--[--><!' +
	'--[--><!--]--><!--]--><!--]--><!--]--><!--]--><!--]--><!--]--><!--]--><!--]-->';
