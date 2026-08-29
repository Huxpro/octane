// Issue #230 Order 3 — how the four measured builds were made.
//
// `issue230-order3-split.mjs` records four bundle digests. This is the recipe
// that produces them, so the digests can be checked rather than believed:
//
//   node benchmarks/lynx-table/stages/issue230-order3-arms.mjs patch o3tear \
//     | git apply -
//   BENCH_DIST_TAG=o3tear node benchmarks/lynx-table/scripts/build-app.mjs
//   node benchmarks/lynx-table/stages/issue230-order3-arms.mjs patch o3tear \
//     | git apply -R -
//
// The record used to cite a path in a scratch directory, which did not survive
// the machine it was written on. A digest whose recipe is unreachable is a
// number you can only take on trust, and this file exists so these four are not
// that.
//
// ## These builds must never ship
//
// Every non-control arm relaxes the compact acknowledgement guard so a second
// segment can be applied over a live one. PR #239 pins why that is unsafe: the
// staged segment *replaces* the old one, so hosts nobody happened to observe
// yet become unreachable, silently. These are measurement instruments, and the
// guard relaxation is what lets an arm reach the rung a shipping build reaches
// once. Nothing here is imported by product code.
//
// ## Why an ablation, and what an ablation costs
//
// `o3cmp` only *adds* a line, so it measures what reaching the rung costs.
// `o3tear` and `o3gen` fold a candidate to `false`, and a constant-folding
// ablation removes more than the code it deleted — the dead branch, its
// operands, and whatever the optimiser then proves about them. They are upper
// bounds, and the record says so.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The commit the hunks were read from, and the commit the bundles were built at. */
export const ORDER3_ARMS_COMMIT = '8938c12608524d1a259b5e81f0903ffa5b5eb4d5';

/**
 * The four edits, each stated as the exact text it replaces. An exact-text
 * replacement refuses to apply to a tree it does not describe, which a line
 * number would not: it would happily patch the wrong line of a moved file.
 */
export const HUNKS = {
	ENABLER: {
		file: 'packages/lynx/src/core/transport.ts',
		why: 'Set the post-first-tree gate on the no-first-tree branch, which the shipping build never takes.',
		from: '\t\tcompactAcknowledgements = capabilities?.compactAck === 1;\n\t\tlazyPublicInstances = capabilities?.lazyPublicInstances === 1;\n\t\tsetLynxClientCapabilities(container, capabilities);',
		to: '\t\tcompactAcknowledgements = capabilities?.compactAck === 1;\n\t\tlazyPublicInstances = capabilities?.lazyPublicInstances === 1;\n\t\tpostFirstTreeLazyPublicInstances = capabilities?.lazyPublicInstances === 1;\n\t\tsetLynxClientCapabilities(container, capabilities);',
	},
	GUARD: {
		file: 'packages/lynx/src/core/client-driver.ts',
		why: 'Let the client accept a second compact segment over a live one, so an arm can reach the rung twice.',
		from: '\tif (\n\t\tstate.compactHosts !== null ||\n\t\t(!incremental && (state.handles.size !== 0 || state.generations.size !== 0))\n\t) {',
		to: '\tif (\n\t\t(!incremental && state.compactHosts !== null) ||\n\t\t(!incremental && (state.handles.size !== 0 || state.generations.size !== 0))\n\t) {',
	},
	OFF_INCREMENTAL: {
		file: 'packages/lynx/src/core/host-driver.ts',
		why: 'Fold the incremental-compact candidate to false, leaving the teardown mirror as the only consequence.',
		from: '\tconst incrementalCompactCandidate =\n\t\toptions?.compact === true &&',
		to: '\tconst incrementalCompactCandidate =\n\t\t(false as boolean) &&\n\t\toptions?.compact === true &&',
	},
	OFF_TEARDOWN: {
		file: 'packages/lynx/src/core/host-driver.ts',
		why: 'Fold the teardown-mirror candidate to false, leaving incremental compact as the only consequence.',
		from: '\tconst teardownMirrorCandidate =\n\t\toptions?.compact === true &&',
		to: '\tconst teardownMirrorCandidate =\n\t\t(false as boolean) &&\n\t\toptions?.compact === true &&',
	},
};

/**
 * The arms, keyed as `issue230-order3-split.mjs` and the record key them.
 * `o3ctl` carries no hunks: it is the tree as committed, and the record's claim
 * that it is byte-identical to the separately-built reference is only worth
 * something because nothing here touched it.
 */
export const ARM_RECIPES = {
	o3ctl: { label: 'O3 control', hunks: [] },
	o3cmp: { label: 'O3 whole chain', hunks: ['ENABLER', 'GUARD'] },
	o3tear: { label: 'O3 teardown only', hunks: ['ENABLER', 'GUARD', 'OFF_INCREMENTAL'] },
	o3gen: { label: 'O3 incremental only', hunks: ['ENABLER', 'GUARD', 'OFF_TEARDOWN'] },
};

/** Replace `hunk.from` with `hunk.to`, refusing anything but exactly one match. */
export function applyHunk(source, hunk) {
	const occurrences = source.split(hunk.from).length - 1;
	if (occurrences !== 1) {
		throw new Error(
			`Octane issue #230 arm hunk in ${hunk.file} matched ${occurrences} times, expected exactly 1.`,
		);
	}
	return source.replace(hunk.from, hunk.to);
}

/** The files one arm touches, in a stable order. */
export function armFiles(armId) {
	const recipe = ARM_RECIPES[armId];
	if (recipe === undefined) {
		throw new Error(`Octane issue #230 has no arm named ${armId}.`);
	}
	const files = [];
	for (const name of recipe.hunks) {
		const file = HUNKS[name].file;
		if (!files.includes(file)) files.push(file);
	}
	return files;
}

/**
 * Apply an arm to sources supplied by `read`, returning file -> patched text.
 * Takes a reader rather than touching the disk so the caller decides which tree
 * is being patched, and so a test can pass the recorded commit's bytes.
 */
export function applyArm(armId, read) {
	const recipe = ARM_RECIPES[armId];
	if (recipe === undefined) {
		throw new Error(`Octane issue #230 has no arm named ${armId}.`);
	}
	const patched = new Map();
	for (const name of recipe.hunks) {
		const hunk = HUNKS[name];
		const before = patched.get(hunk.file) ?? read(hunk.file);
		patched.set(hunk.file, applyHunk(before, hunk));
	}
	return patched;
}

/**
 * Count what each of an arm's hunks matches, without applying anything. A count
 * other than `from: 1, to: 0` means the recipe no longer describes the tree,
 * which is the only way these digests silently stop being reproducible.
 */
export function auditArm(armId, read) {
	const recipe = ARM_RECIPES[armId];
	if (recipe === undefined) {
		throw new Error(`Octane issue #230 has no arm named ${armId}.`);
	}
	return recipe.hunks.map((name) => {
		const hunk = HUNKS[name];
		const source = read(hunk.file);
		return {
			hunk: name,
			file: hunk.file,
			from: source.split(hunk.from).length - 1,
			to: source.split(hunk.to).length - 1,
		};
	});
}

/**
 * One unified-diff hunk spanning everything between the common prefix and the
 * common suffix. Deliberately not a general diff: trimming the two ends is
 * correct for any pair of texts, and every edit here is one localized block, so
 * the emitted hunk stays tight without an algorithm that could be subtly wrong.
 */
export function unifiedDiff(file, before, after, { context = 3 } = {}) {
	if (before === after) return '';
	// Split the trailing newline off first. Splitting with it attached leaves a
	// synthetic empty element that the common-suffix walk happily treats as a
	// line, and a change close enough to the end then emits it as context — a
	// context line for a line the file does not have, which git rejects.
	if (!before.endsWith('\n') || !after.endsWith('\n')) {
		throw new Error(`Octane issue #230 cannot diff ${file}: it does not end with a newline.`);
	}
	const a = before.slice(0, -1).split('\n');
	const b = after.slice(0, -1).split('\n');

	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
	let tail = 0;
	while (
		tail < a.length - head &&
		tail < b.length - head &&
		a[a.length - 1 - tail] === b[b.length - 1 - tail]
	) {
		tail += 1;
	}

	const start = Math.max(0, head - context);
	const aEnd = Math.min(a.length, a.length - tail + context);
	const bEnd = Math.min(b.length, b.length - tail + context);

	const lines = [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`];
	lines.push(`@@ -${start + 1},${aEnd - start} +${start + 1},${bEnd - start} @@`);
	for (let i = start; i < head; i += 1) lines.push(` ${a[i]}`);
	for (let i = head; i < a.length - tail; i += 1) lines.push(`-${a[i]}`);
	for (let i = head; i < b.length - tail; i += 1) lines.push(`+${b[i]}`);
	for (let i = a.length - tail; i < aEnd; i += 1) lines.push(` ${a[i]}`);
	return `${lines.join('\n')}\n`;
}

/** The whole arm as one patch, ready for `git apply`. */
export function armPatch(armId, read) {
	const patched = applyArm(armId, read);
	let patch = '';
	for (const file of armFiles(armId)) {
		patch += unifiedDiff(file, read(file), patched.get(file));
	}
	return patch;
}

/** Read a repository-relative path from the working tree. */
export function worktreeReader(root) {
	return (file) => fs.readFileSync(path.join(root, file), 'utf8');
}

function main(argv) {
	const [command, armId] = argv;
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
	const read = worktreeReader(root);

	if (command === 'patch') {
		try {
			process.stdout.write(armPatch(armId, read));
		} catch (error) {
			// A recipe that no longer matches must not print a partial patch to
			// stdout, where it would be piped straight into `git apply`.
			process.stderr.write(`${error.message}\n`);
			return 1;
		}
		return 0;
	}
	if (command === 'audit') {
		let drifted = false;
		for (const id of Object.keys(ARM_RECIPES)) {
			for (const row of auditArm(id, read)) {
				const ok = row.from === 1 && row.to === 0;
				if (!ok) drifted = true;
				process.stdout.write(
					`${ok ? 'ok  ' : 'DRIFT'} ${id.padEnd(7)} ${row.hunk.padEnd(16)} from=${row.from} to=${row.to} ${row.file}\n`,
				);
			}
		}
		process.stdout.write(
			drifted
				? `\nThe recipe no longer describes this tree. It was read at ${ORDER3_ARMS_COMMIT}.\n`
				: `\nAll arms still describe this tree.\n`,
		);
		return drifted ? 1 : 0;
	}
	process.stderr.write('usage: issue230-order3-arms.mjs <patch <arm> | audit>\n');
	return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
