/**
 * Metadata descriptors and the merge that decides precedence.
 *
 * Renderer-free on purpose: server and client both merge with this exact code,
 * so the two emit the identical set and hydration adopts instead of duplicating.
 *
 * WHY A MERGE EXISTS AT ALL. The platform resolves duplicates by taking the
 * FIRST occurrence in tree order, `document.title` is defined as the first
 * `<title>` element in the document, and a crawler reads the first
 * `<meta name="description">`. Authoring order runs the other way: defaults come
 * from the outer layout and the specific value from the inner page, so appending
 * both would let the generic one win every time. Registrations are therefore
 * keyed by identity and the LAST one wins, which is the precedence every SEO
 * system uses and the one authors expect.
 */

export type MetaAttributes = Record<string, string | number | boolean | null | undefined>;

/** One head element to render, plus the identity that decides what it replaces. */
export interface SeoDescriptor {
	tag: 'title' | 'meta' | 'link' | 'script';
	/** Identity key: a later descriptor with the same key replaces this one. */
	key: string;
	attrs: MetaAttributes;
	/** Text content, for `<title>` and for script bodies. */
	text?: string;
	/** A title that already had a template applied, so it is not templated twice. */
	templated?: boolean;
}

/**
 * Settings that belong to the app rather than to one declaration. They are
 * registered like any other metadata and merged last-wins, so setting them once
 * near the root applies them to every page's title and URLs.
 */
export interface SeoConfig {
	/** Origin used to absolute-ise canonical, og:url, and image URLs. */
	site?: string;
	/** `%s` is replaced by the page title, e.g. `'%s · Acme'`. */
	titleTemplate?: string;
}

/**
 * Attributes holding a URL that scrapers will not resolve relative to the page,
 * so they are absolute-ised against the configured origin at emit time, once the
 * whole tree's config is known.
 */
function urlAttribute(descriptor: SeoDescriptor): string | null {
	if (descriptor.tag === 'link') return 'href';
	if (descriptor.tag !== 'meta') return null;
	const property = descriptor.attrs.property;
	if (property === 'og:url' || property === 'og:image') return 'content';
	if (descriptor.attrs.name === 'twitter:image') return 'content';
	return null;
}

/**
 * Apply app-level config to the merged set. Deferred to emit time because a page
 * registers its title and canonical before, or without ever seeing, the root's
 * `site` and `titleTemplate`.
 */
export function applyConfig(
	descriptors: readonly SeoDescriptor[],
	config: SeoConfig,
): SeoDescriptor[] {
	const { site, titleTemplate } = config;
	if (site === undefined && titleTemplate === undefined) return descriptors as SeoDescriptor[];
	return descriptors.map((descriptor) => {
		if (
			titleTemplate !== undefined &&
			descriptor.tag === 'title' &&
			descriptor.templated !== true &&
			descriptor.text !== undefined &&
			descriptor.text !== ''
		) {
			// Function replacement: see applyTitleTemplate. The title is data, so its
			// dollar patterns must not expand against the `%s` match.
			return {
				...descriptor,
				text: titleTemplate.replace('%s', () => descriptor.text as string),
				templated: true,
			};
		}
		const attr = site === undefined ? null : urlAttribute(descriptor);
		if (attr !== null) {
			const value = descriptor.attrs[attr];
			if (typeof value === 'string') {
				const resolved = resolveUrl(value, site);
				if (resolved !== value) {
					return { ...descriptor, attrs: { ...descriptor.attrs, [attr]: resolved } };
				}
			}
		}
		return descriptor;
	});
}

/**
 * How a `<link>`'s identity is derived. It has to differ by `rel`, because
 * `href` is sometimes the value being set and sometimes the thing being
 * identified, and getting that backwards breaks overrides in one direction or
 * drops tags in the other.
 *
 * - **Singleton**: one per document, so `rel` alone is the identity.
 * - **Slot-keyed**: the listed attributes name a slot and `href` is its value.
 *   A page replacing a layout's German alternate, or the same-sized icon, must
 *   win, so `href` is deliberately NOT part of the key.
 * - **URL-keyed** (everything else): the target IS the identity, so two font
 *   preloads or two stylesheets coexist. Unknown rels default here on purpose,
 *   since dropping someone's tag is worse than emitting two.
 */
const SINGLETON_LINK_RELS = new Set(['canonical', 'manifest', 'author', 'license', 'prev', 'next']);

const SLOT_KEYED_LINK_RELS = new Map<string, readonly string[]>([
	['alternate', ['hreflang', 'type', 'media', 'title']],
	['icon', ['sizes', 'type', 'media']],
	['shortcut icon', ['sizes', 'type']],
	['apple-touch-icon', ['sizes', 'type']],
	['apple-touch-icon-precomposed', ['sizes', 'type']],
	['mask-icon', ['color']],
	['search', ['type', 'title']],
]);

const URL_KEYED_LINK_ATTRS = ['href', 'as', 'media', 'type', 'hreflang', 'sizes'] as const;

function attrString(attrs: MetaAttributes, name: string): string | null {
	const value = attrs[name];
	if (value === null || value === undefined || value === false) return null;
	return String(value);
}

/**
 * Identity for a `<meta>`: whichever naming attribute it uses. Open Graph uses
 * `property`, most others use `name`, and `http-equiv` is its own namespace, so
 * `og:title` and a `name="og:title"` never collide by accident.
 */
export function metaKey(attrs: MetaAttributes): string {
	if (attrs.charSet !== undefined || attrs.charset !== undefined) return 'meta:charset';
	for (const naming of ['name', 'property', 'http-equiv', 'httpEquiv', 'itemprop']) {
		const value = attrString(attrs, naming);
		if (value !== null) {
			const channel = naming === 'httpEquiv' ? 'http-equiv' : naming;
			return 'meta:' + channel + '=' + value;
		}
	}
	// No naming attribute: keep every such tag by giving it a content-derived
	// identity rather than silently collapsing unrelated tags together.
	return 'meta:raw=' + JSON.stringify(attrs);
}

export function linkKey(attrs: MetaAttributes): string {
	const rel = attrString(attrs, 'rel') ?? '';
	if (SINGLETON_LINK_RELS.has(rel)) return 'link:' + rel;
	const slotAttrs = SLOT_KEYED_LINK_RELS.get(rel);
	let key = 'link:' + rel;
	if (slotAttrs !== undefined) {
		let named = false;
		for (const name of slotAttrs) {
			const value = attrString(attrs, name);
			if (value !== null) {
				key += '|' + name + '=' + value;
				named = true;
			}
		}
		// A slot-keyed rel carrying none of its discriminators names no slot, so
		// fall through to the URL rather than collapsing unrelated tags together.
		if (named) return key;
	}
	for (const name of URL_KEYED_LINK_ATTRS) {
		const value = attrString(attrs, name);
		if (value !== null) key += '|' + name + '=' + value;
	}
	return key;
}

/**
 * Merge registrations into the set to render, last-wins per identity.
 *
 * Insertion order is preserved for keys that survive: replacing a descriptor
 * updates it in place rather than moving it to the end, so server and client
 * produce the same order and hydration adoption stays positional. That also
 * makes the merge idempotent across SSR suspense passes, where the same
 * component re-registers the same key on every pass.
 */
export function mergeDescriptors(registrations: readonly SeoDescriptor[]): SeoDescriptor[] {
	const byKey = new Map<string, number>();
	const out: SeoDescriptor[] = [];
	for (const descriptor of registrations) {
		const at = byKey.get(descriptor.key);
		if (at === undefined) {
			byKey.set(descriptor.key, out.length);
			out.push(descriptor);
		} else {
			out[at] = descriptor;
		}
	}
	return out;
}

/** Absolute-ise a canonical/og:url style value against the configured site origin. */
export function resolveUrl(value: string, site: string | undefined): string {
	if (site === undefined || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
		return value;
	}
	return site.replace(/\/+$/, '') + (value.startsWith('/') ? value : '/' + value);
}
