/**
 * Development check for the one arrangement context cannot catch: two SIBLING
 * owning `<Head>` blocks.
 *
 * A nested owner is caught by reading context, but siblings each see `null` and
 * each create a registry, so both emit, and the document gets two `<title>`
 * elements, of which the browser silently keeps the first. Counting live owners
 * on the client is the only way to see it.
 *
 * Client-only by construction: it counts in an effect, and effects never run on
 * the server, so concurrent SSR requests can never inflate a shared counter.
 */
import { useEffect } from 'octane';

let liveOwners = 0;
let warned = false;

export function useOwnershipWarning(owns: boolean): void {
	if (process.env.NODE_ENV === 'production') return;
	useEffect(() => {
		if (!owns) return;
		liveOwners++;
		if (liveOwners > 1 && !warned) {
			warned = true;
			console.warn(
				'[@octanejs/seo] More than one <Head> is mounted without one containing the ' +
					'other, so each merges and emits separately: the document will contain ' +
					'duplicate tags and the FIRST in document order will win. Nest them, put ' +
					"the outer <Head>'s children (including the page) inside it, so they " +
					'contribute to one merged set.',
			);
		}
		return () => {
			liveOwners--;
			if (liveOwners <= 1) warned = false;
		};
	});
}
