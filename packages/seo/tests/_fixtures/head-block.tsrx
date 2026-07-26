import { Head, Link, Meta, Script, Title } from '@octanejs/seo';

/** One <Head> owning everything: no provider, no root wrapper to install. */
export function Grouped() @{
	<Head>
		<>
			<Title text="Grouped" />
			<Meta name="description" content="grouped description" />
			<Link rel="canonical" href="https://x.dev/grouped" />
			<Script type="application/ld+json" json={{ '@type': 'Article', headline: 'Grouped' }} />
			<main>grouped</main>
		</>
	</Head>
}

/**
 * The "only use <Head> where needed" case: a page deep in the tree carries its
 * own <Head> with nothing wrapping it, and owns its metadata on its own.
 */
function StandalonePage() @{
	<>
		<Head>
			<>
				<Title text="Grouped" />
				<Meta name="description" content="grouped description" />
				<Link rel="canonical" href="https://x.dev/grouped" />
				<Script type="application/ld+json" json={{ '@type': 'Article', headline: 'Grouped' }} />
			</>
		</Head>
		<main>grouped</main>
	</>
}

export function Standalone() @{
	<section>
		<StandalonePage />
	</section>
}

/**
 * The nesting that lets defaults and overrides merge: the outer <Head> contains
 * the page, so the page's own <Head> is grouping rather than a second owner.
 */
function ProductPage() @{
	<>
		<Head>
			<>
				<Title text="Deep" />
				<Link rel="canonical" href="https://x.dev/deep" />
			</>
		</Head>
		<main>product</main>
	</>
}

export function Nested() @{
	<Head>
		<>
			<Title text="Outer" />
			<Meta name="description" content="outer" />
			<section>
				<ProductPage />
			</section>
		</>
	</Head>
}

/** A raw (non-JSON) script body. */
export function RawScript() @{
	<Head>
		<>
			<Script type="text/plain" seoKey="notes" text="hello & goodbye" />
			<main>raw</main>
		</>
	</Head>
}
