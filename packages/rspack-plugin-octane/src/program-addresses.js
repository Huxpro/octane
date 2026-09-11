/** Worker-transfer key for the addresses one module compile derived. */
export const PROGRAM_ADDRESSES_BUILD_INFO_KEY = '__octaneProgramAddresses';

/**
 * Issue #246 — cross-check positional program addresses between thread layers.
 *
 * Serial loaders call this directly. Parallel loaders transfer their addresses
 * to the finalizer, which calls the same check in the main compilation process.
 */
const COMPILATION_PROGRAM_DIGESTS = new WeakMap();

export function crossCheckProgramAddresses(compilation, addresses) {
	if (compilation === undefined || compilation === null || addresses == null) return;
	let digests = COMPILATION_PROGRAM_DIGESTS.get(compilation);
	if (digests === undefined) COMPILATION_PROGRAM_DIGESTS.set(compilation, (digests = new Map()));
	for (const address of addresses) {
		const key = `${address.module}#${address.index}`;
		const seen = digests.get(key);
		if (seen === undefined) {
			digests.set(key, address.digest);
			continue;
		}
		if (seen === address.digest) continue;
		throw new Error(
			`@octanejs/rspack-plugin: the thread layers of this build disagree about program ` +
				`${key}. One compiled a program whose wire surface digests to ${seen}, the other ` +
				`to ${address.digest}. A program address is positional, so a background run naming ` +
				`this one would mount whatever the main thread compiled in that slot. Addressing ` +
				`requires both layers to compile the same module graph; a build that specializes ` +
				`the two differently must set \`programAddressing: false\`.`,
		);
	}
}
