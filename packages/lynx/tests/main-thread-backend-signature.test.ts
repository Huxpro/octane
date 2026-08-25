// Issue-#163 C1d: the backend's build identity cannot go stale silently.
//
// A build salts its persistent transform cache with `signature`, so a cache
// entry survives across builds and is reused whenever the salt matches. If the
// emitter changes and the signature does not, a rebuild reuses compiled create
// functions the previous emitter wrote — a first screen painted by code that is
// no longer in the tree, with nothing red anywhere.
//
// Nothing derives the signature automatically: computing it from the source at
// import time would make a build-tool module depend on its own files being on
// disk, and a soft fallback for when they are not is the same silent staleness
// by another route. So it is a constant, and this is the gate that makes the
// constant honest.
//
// When this fails, the fix is to bump the revision in `signature` and repin the
// digest below. It is deliberately sensitive to every byte, comments included:
// over-invalidating a cache costs one cold build, and reasoning about which
// edits change emitted output is exactly the judgement that goes wrong.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { signature } from '../src/compiler/index.js';

const BACKEND_DIRECTORY = fileURLToPath(new URL('../src/compiler/', import.meta.url));

/** Every module the backend is made of, hashed in a stable order. */
function backendDigest(): string {
	const files = readdirSync(BACKEND_DIRECTORY).sort();
	const hash = createHash('sha256');
	for (const file of files) {
		hash.update(file);
		hash.update('\0');
		hash.update(readFileSync(join(BACKEND_DIRECTORY, file)));
		hash.update('\0');
	}
	return hash.digest('hex');
}

describe('the main-thread backend signature', () => {
	it('names the emitter that is actually here', () => {
		expect(signature).toBe('lynx-main-thread-program/1');
		expect(backendDigest()).toBe(
			'9d0dcc9b8777928e31a87fa24e3b0dd78db97793734e75011eef872fa3eb8ecf',
		);
	});

	it('covers every module the backend is made of', () => {
		// A backend that grew a file the digest does not read would let that file
		// change without the signature moving, which is the failure this exists
		// to prevent rather than a detail of how it is spelled.
		const files = readdirSync(BACKEND_DIRECTORY).sort();
		expect(files).toEqual([
			'derive-main-thread-program.ts',
			'emit-main-thread-program.ts',
			'index.ts',
		]);
	});
});
