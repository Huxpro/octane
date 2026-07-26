import { Head, Title } from '@octanejs/seo';

/** A tag with no enclosing <Head>: must fail loudly, not silently do nothing. */
export function NoHead() @{
	<>
		<Title text="Orphan" />
		<main>orphan</main>
	</>
}

/** Two <Head> blocks, neither containing the other: works, but warns. */
export function SiblingOwners() @{
	<>
		<Head>
			<Title text="Outer" />
		</Head>
		<Head>
			<Title text="Inner" />
		</Head>
		<main>siblings</main>
	</>
}
