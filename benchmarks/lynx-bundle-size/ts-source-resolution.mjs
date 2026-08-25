// Loading the repository's TypeScript source from a plain-`node` harness.
//
// Octane publishes every importable module as authored, so `@octanejs/lynx`'s
// build-time main-thread backend is TypeScript (issue #163 C1d). Node 22 strips
// the types by itself and needs nothing for that, but it does not rewrite a
// relative `./x.js` specifier to the `./x.ts` file beside it — the extension
// TypeScript makes an author write is the one Node then cannot find. So an
// unaided `import()` of the backend fails on its first internal import with
// ERR_MODULE_NOT_FOUND, and every module below it would fail the same way.
//
// That is the whole gap this closes. It is a measurement device rather than a
// build tool: a real Lynx build hands the backend over from a config its own
// loader understands, and `packages/octane/src/compiler/register.js` is the
// product-side hook with the same resolve shape plus the compilation a running
// application needs. This benchmark wants neither — only to reach a module.
import { statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AUTHORED_EXTENSIONS = ['.ts', '.tsx'];

function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/**
 * Let a relative `./x.js` import find the `./x.ts` beside it.
 *
 * Registered as a fallback rather than a rewrite: Node resolves first, and this
 * runs only where that threw. A specifier naming a real `.js` file therefore
 * keeps resolving to it, which matters in this repository because packages mix
 * authored `.js` and authored `.ts` in one directory on purpose.
 */
export function registerTypeScriptSourceResolution() {
	registerHooks({
		resolve(specifier, context, nextResolve) {
			try {
				return nextResolve(specifier, context);
			} catch (error) {
				if (!specifier.endsWith('.js') || context.parentURL === undefined) throw error;
				let requested;
				try {
					requested = new URL(specifier, context.parentURL);
				} catch {
					throw error;
				}
				if (requested.protocol !== 'file:') throw error;
				const stem = fileURLToPath(requested).slice(0, -'.js'.length);
				for (const extension of AUTHORED_EXTENSIONS) {
					if (isFile(stem + extension)) {
						return { url: pathToFileURL(stem + extension).href, shortCircuit: true };
					}
				}
				throw error;
			}
		},
	});
}
