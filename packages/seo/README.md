# `@octanejs/seo`

Declarative document metadata for Octane: server-rendered into `<head>`, adopted
on hydration, and merged so the most specific declaration wins.

```tsx
import { Head, Title, Meta, Link, Script } from '@octanejs/seo';

function App() @{
	<Head>
		<>
			<Title text="Acme" />
			<Meta name="description" content="Widgets for everyone" />
			<Router />
		</>
	</Head>
}

function ProductPage(props: { product: Product }) @{
	<>
		<Head>
			<>
				<Title text={props.product.name} />
				<Meta name="description" content={props.product.blurb} />
				<Link rel="canonical" href={'/p/' + props.product.slug} />
				<Script type="application/ld+json" json={{ '@type': 'Product', name: props.product.name }} />
			</>
		</Head>
		<main>…</main>
	</>
}
```

The product page's title and description replace the app-level ones. Everything
else the app declared stays.

## Why a merge exists

The platform resolves duplicates by taking the **first** in tree order:
`document.title` is defined as the first `<title>` element in the document, and
a crawler reads the first `meta[name="description"]`. Authoring order runs the
other way, with app defaults written before page specifics, so simply emitting
both would let the generic value win every time. Registrations are therefore
keyed by identity and the **last** one wins.

Identity is what the tag names, not the tag type: `meta[name]`,
`meta[property]`, and `meta[http-equiv]` are separate channels, `link[rel]`
collapses for `canonical`/`manifest` but stays distinct per `hreflang`/`sizes`
for `alternate`/`icon`, and JSON-LD is keyed by `@type` (plus `@id`), so an
`Article` replaces an `Article` while a `BreadcrumbList` sits alongside it.

## `<Head>` and where to put it

There is no provider to install. `<Head>` adapts to where it sits:

- **Outermost** it owns the metadata: it creates the registry and renders the
  merged tags after its children.
- **Nested** inside another `<Head>` it is pure grouping.

A page can therefore carry its own `<Head>` and work on its own. Tags outside any
`<Head>` throw with an actionable message rather than silently doing nothing.

**The one rule that matters:** for two `<Head>` blocks to merge, one must
*contain* the other. Nesting follows the tree, not the file, so this works:

```tsx
function Layout(props: { children?: OctaneNode }) @{
	<Head>
		<>
			<Title text="Acme" />
			{props.children}          {/* the page's <Head> is now nested */}
		</>
	</Head>
}
```

and this does **not**:

```tsx
function Layout(props: { children?: OctaneNode }) @{
	<>
		<Head><Title text="Acme" /></Head>
		{props.children}              {/* a sibling, it owns separately */}
	</>
}
```

Two `<Head>` blocks where neither contains the other each emit their own merged
set, so the document gets duplicate tags and the platform keeps the **first**,
which means the outer, more generic value wins and the page's is ignored.
Development warns when it happens.

## Components

| Component | Purpose |
| --- | --- |
| `<Title text="…" />` | Document title |
| `<Meta name/property/http-equiv … />` | Any meta tag |
| `<Link rel="…" href="…" />` | canonical, alternate, icon, manifest |
| `<Script type json / text />` | JSON-LD and other head scripts |
| `<Seo … />` | The whole metadata object at once |

`<Title>` takes its text as a **prop**, not JSX children. Element children
compile to a children block (a function), and coercing one to a string would put
source code in the document title, so that case throws instead.

`<Seo>` is the object form and expands to the tags above, filling in Open Graph
and Twitter from `title`/`description` unless you override them, and making
`canonical`, `og:url`, and image URLs absolute against `site`:

```tsx
<Seo
	title="Post title"
	description="Post summary"
	canonical="/blog/post"
	site="https://example.com"
	titleTemplate="%s · Example"
	openGraph={{ type: 'article', images: [{ url: '/og.png', alt: 'Post', width: 1200, height: 630 }] }}
	twitter={{ card: 'summary_large_image', site: '@example' }}
	languages={{ de: '/de/blog/post', 'x-default': '/blog/post' }}
	robots={{ index: true, follow: true, maxImagePreview: 'large' }}
	jsonLd={{ '@type': 'Article', headline: 'Post title' }}
/>
```

## Server rendering

Metadata registered during render reaches `<head>` in the served HTML, which is
the point: an effect-based approach never runs on the server, so crawlers would
see nothing. Under `@octanejs/vite-plugin` this works with no configuration.

For a custom server, render with `headChannel: 'separate'` and splice the
returned metadata into your template's `<head>`:

```ts
const { html, css, head } = await prerender(App, props, { headChannel: 'separate' });
```

Streaming uses `onHeadReady(head)`, which fires before the shell is written. See
`docs/ssr.md`.

Two caveats worth knowing:

- **Remove any static `<title>` from `index.html`.** The hoisted metadata is
  spliced at `<!--ssr-head-->`, after it, so a template title would win.
- **Metadata that depends on suspended data does not reach a streamed shell.**
  The shell flushes before the data settles. Derive metadata from data you
  already have, or use the buffered renderer for those routes.

## Hydration and navigation

The client adopts the server's elements instead of appending its own, updates
them in place rather than replacing them (a swapped `<link>` would re-fetch its
resource), and removes what it owns when a page unmounts, so navigating between
routes never accumulates stale canonicals or `og:image` tags.
