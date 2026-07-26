---
'@octanejs/seo': patch
---

New package: declarative document metadata that actually reaches `<head>` in the
served HTML.

```tsx
<Head>
  <Title text={product.name} />
  <Meta name="description" content={product.blurb} />
  <Link rel="canonical" href={'/p/' + product.slug} />
  <Script type="application/ld+json" json={productSchema} />
</Head>
```

There is no provider to install. `<Head>` owns the metadata when it is
outermost and is pure grouping when nested, so a page can carry its own. For two
`<Head>` blocks to merge one must contain the other; siblings each emit
separately and warn in development. `<Seo>` takes the same information as a
single object and fills in Open Graph and Twitter from `title`/`description`.

Registrations are keyed by identity and the **last** one wins, so a page
overrides an app default. That inversion is the point: the platform resolves
duplicates by taking the *first* in tree order, while authoring order puts
defaults first, so appending both would let the generic value win every time.

Metadata registers during render rather than in an effect, because effects never
run on the server and an effect-based approach hands crawlers nothing. On the
client the server's elements are adopted rather than duplicated, updated in
place, and removed when their page unmounts, so navigation cannot accumulate
stale canonicals or `og:image` tags. Misuse is loud: a tag with no enclosing
`<Head>` throws, and sibling owning blocks warn in development.
