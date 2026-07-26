import { useContext, useRef, useSyncExternalStore } from 'octane';
import type { OctaneNode } from 'octane';
import { SeoContext } from './context.ts';
import { createSeoRegistry, type SeoRegistry } from './registry.ts';
import { linkKey, metaKey, type MetaAttributes, type SeoDescriptor } from './descriptors.ts';
import { expandSeo, jsonLdDescriptor, type SeoInput } from './expand.ts';
import { useRegisterSeo } from './useRegister.ts';
import { useOwnershipWarning } from './useOwnershipWarning.ts';

/**
 * One rendered head element.
 *
 * `<title>`/`<meta>`/`<link>` are hoisted by the compiler into the render's head
 * channel, so they reach the real `<head>` and are adopted on hydration rather
 * than recreated. `<script type="application/ld+json">` is NOT hoistable and
 * stays where it renders, which is valid: JSON-LD is explicitly supported in the
 * body. Its content goes through `dangerouslySetInnerHTML` because `<script>` is
 * a raw-text element; the renderer escapes inline script content itself.
 */
function SeoTag(props: { descriptor: SeoDescriptor }) @{
	@switch (props.descriptor.tag) {
		@case 'title': {
			<title>{(props.descriptor.text ?? '') as string}</title>
		}
		@case 'meta': {
			<meta {...props.descriptor.attrs} />
		}
		@case 'link': {
			<link {...props.descriptor.attrs} />
		}
		@default: {
			<script
				{...props.descriptor.attrs}
				dangerouslySetInnerHTML={{ __html: props.descriptor.text ?? '' }}
			/>
		}
	}
}

/**
 * Emits the merged metadata. An owning `<Head>` renders this AFTER its children,
 * so every descendant registration is already in the registry by the time this
 * reads it, that ordering is what makes an inner page's title beat an outer
 * layout's, which the platform's own first-wins rule would otherwise invert.
 */
function SeoOutlet() @{
	const registry = useContext(SeoContext);
	if (registry === null) {
		throw new Error('[@octanejs/seo] internal: <SeoOutlet> rendered with no registry.');
	}
	const descriptors = useSyncExternalStore(
		registry.subscribe,
		registry.getSnapshot,
		registry.getSnapshot,
	);
	<>
		@for (const descriptor of descriptors; key descriptor.key) {
			<SeoTag descriptor={descriptor} />
		}
	</>
}

/**
 * `<Title text="Page name" />`, the innermost one rendered wins.
 *
 * The text is a prop, not JSX children, and deliberately so: the compiler turns
 * element children into a children block (a function), and coercing one to a
 * string would silently put source code in the document title. `children` is
 * accepted in its string prop form for convenience; anything else is rejected
 * loudly rather than serialized.
 */
export function Title(props: { text?: string; children?: string }) {
	useRegisterSeo([
		{ tag: 'title', key: 'title', attrs: {}, text: titleText(props) },
	]);
	return null;
}

function titleText(props: { text?: string; children?: string }): string {
	const value = props.text ?? props.children;
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	if (value === undefined || value === null) return '';
	throw new Error('[@octanejs/seo] <Title> needs a string: use <Title text="…" /> or <Seo title="…" />. ' +
		'JSX children compile to a children block, which is not a string.');
}

/** `<Meta name="description" content="…" />` / `<Meta property="og:title" … />`. */
export function Meta(props: MetaAttributes & { seoKey?: string }) {
	const { seoKey, ...attrs } = props;
	useRegisterSeo([
		{ tag: 'meta', key: seoKey ?? metaKey(attrs), attrs },
	]);
	return null;
}

/** `<Link rel="canonical" href="…" />`. */
export function Link(props: MetaAttributes & { seoKey?: string }) {
	const { seoKey, ...attrs } = props;
	useRegisterSeo([
		{ tag: 'link', key: seoKey ?? linkKey(attrs), attrs },
	]);
	return null;
}

/**
 * Groups metadata for readability:
 *
 * ```tsx
 * <Head>
 *   <Title text="Post title" />
 *   <Meta name="description" content="…" />
 *   <Link rel="canonical" href="/post" />
 *   <Script type="application/ld+json" json={article} />
 * </Head>
 * ```
 *
 * There is nothing else to set up: no provider, no root wrapper. `<Head>` adapts
 * to where it sits.
 *
 * - **Outermost** it owns the metadata: it creates the registry and renders the
 *   merged tags after its children. A page can therefore carry its own `<Head>`
 *   and work on its own.
 * - **Nested** inside another `<Head>` it is pure grouping.
 *
 * To let defaults merge with overrides, nest them the way the UI already nests:
 * a layout's `<Head>` contains the page, so the page's `<Head>` is grouping and
 * both contribute to one merged set.
 *
 * ```tsx
 * function Layout(props: { children?: OctaneNode }) @{
 *   <Head>
 *     <>
 *       <Title text="Acme" />
 *       {props.children}
 *     </>
 *   </Head>
 * }
 * ```
 *
 * Precedence never depends on nesting depth: the LAST registration of a given
 * identity wins wherever it was written.
 */
export function Head(props: { children?: OctaneNode }) @{
	// Reads any enclosing registry; this component has not supplied one yet.
	const outer = useContext(SeoContext);
	const registryRef = useRef<SeoRegistry | null>(null);
	// The registry lives here rather than in module scope so concurrent server
	// renders cannot see each other's metadata.
	if (outer === null && registryRef.current === null) registryRef.current = createSeoRegistry();
	useOwnershipWarning(outer === null);
	@if (outer === null) {
		<SeoContext.Provider value={registryRef.current}>
			{props.children}
			<SeoOutlet />
		</SeoContext.Provider>
	} @else {
		<>
			{props.children}
		</>
	}
}

/**
 * A head script, typically JSON-LD.
 *
 * Pass `json` for structured data (serialized for you) or `text` for a raw body.
 * Unlike `<title>`/`<meta>`/`<link>`, a `<script>` is not hoisted into `<head>`
 * and renders where the outlet sits, which is valid: JSON-LD is explicitly
 * supported in the body. The renderer escapes inline script content.
 */
export function Script(props: {
	type?: string;
	json?: unknown;
	text?: string;
	seoKey?: string;
	[attr: string]: unknown;
}) {
	const { json, text, seoKey, ...attrs } = props;
	const type =
		typeof attrs.type === 'string' ? attrs.type : 'application/ld+json';
	// ONE registration call site. Hooks are keyed by call site, so branching into
	// two `useRegisterSeo` calls would give a `<Script>` that switches between
	// `json` and `text` a second slot, and the abandoned branch's source would
	// stay registered, a stale script no unmount ever removes.
	const descriptor: SeoDescriptor =
		json !== undefined
			? jsonLdDescriptor(json, seoKey)
			: {
					tag: 'script',
					key: 'script:' + (seoKey ?? type),
					attrs: { ...attrs as MetaAttributes, type },
					text: text ?? '',
				};
	useRegisterSeo([descriptor]);
	return null;
}

/** Structured data. Identity is `@type` (plus `@id`) unless `seoKey` is given. */
export function JsonLd(props: { data: unknown; seoKey?: string }) {
	useRegisterSeo([jsonLdDescriptor(props.data, props.seoKey)]);
	return null;
}

/** The whole metadata object in one element; expands to the tags above. */
export function Seo(props: SeoInput) {
	useRegisterSeo(expandSeo(props));
	return null;
}
