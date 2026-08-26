// One writer for every measurement record this harness checks in.
//
// `pnpm format:check` is a CI gate and it covers the `results/` directories, but
// `JSON.stringify` and Prettier do not agree about JSON: Prettier collapses a
// short array or object onto one line when it fits inside `printWidth`, and
// `JSON.stringify` never does. A record written the plain way therefore lands in
// the repository already failing that gate, for every branch above it — the wart
// #118 recorded when it formatted three such files by hand, and left with this
// harness to fix at the source rather than at each landing.
//
// So the harness formats what it writes, under the repository's own
// configuration resolved for the destination path. That is the same input
// `prettier --check` reads, which is what makes "it was clean when written" and
// "it is clean now" the same statement rather than two that can drift.
//
// There is deliberately no fallback for a Prettier that will not load or a value
// it will not print. A silent fallback writes exactly the file this module
// exists to prevent, and hides why; failing at the write names the cause while
// the measurement is still in hand.
import fs from 'node:fs';
import path from 'node:path';

import prettier from 'prettier';

/**
 * The resolved JSON options for a destination directory.
 *
 * `resolveConfig` applies the repository's `overrides`, so this is where
 * `**\/*.json` picking up `useTabs: false` comes from rather than from a copy of
 * that decision kept here. A run writes several records into one directory, so
 * the resolution is cached by directory rather than repeated per file.
 */
const configs = new Map();

async function jsonOptionsFor(file) {
	const directory = path.dirname(file);
	let pending = configs.get(directory);
	if (pending === undefined) {
		pending = prettier.resolveConfig(file, { editorconfig: true });
		configs.set(directory, pending);
	}
	const config = await pending;
	if (config === null) {
		throw new Error(
			`no Prettier configuration resolved for ${file}; the record would not be gate-clean`,
		);
	}
	return { ...config, parser: 'json' };
}

/**
 * The exact bytes one JSON record is written as, for the destination it belongs
 * to. Separate from the write so a check can ask what a record should be without
 * putting it there.
 *
 * The value is stringified expanded first and then formatted, which is not a
 * detour. Prettier preserves whatever object wrapping it is handed and reflows
 * only arrays, so handing it one long line would collapse every object that fits
 * inside `printWidth` — gate-clean, but a different shape from every record
 * already checked in, and a re-render of an untouched run would diff by hundreds
 * of lines. Handing it the expanded form leaves the shape these files have had
 * all along and changes exactly the arrays that were failing.
 */
export async function formatEvidenceJson(file, value) {
	const options = await jsonOptionsFor(file);
	return prettier.format(JSON.stringify(value, null, 2), options);
}

/**
 * Write one JSON record where `prettier --check` will accept it unchanged.
 *
 * Prettier emits its own trailing newline, so callers pass the value and nothing
 * about how it is spelled.
 */
export async function writeEvidenceJson(file, value) {
	fs.writeFileSync(file, await formatEvidenceJson(file, value));
}
