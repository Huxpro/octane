import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Stage the exact M1.5 primitive bodies into a native LepusNG bundle.
 *
 * The measured source remains byte-identical to the V8 input. Only this
 * build-only driver supplies ordering, repetitions, clocks, and evidence.
 */
export function instrumentIssue196M15NativeSources(repositoryRoot, stagedAppRoot) {
	const sourceFile = path.join(
		repositoryRoot,
		'benchmarks/lynx-table/stages/ledger-primitives.source.mjs',
	);
	const measuredSource = fs.readFileSync(sourceFile);
	fs.copyFileSync(sourceFile, path.join(stagedAppRoot, 'src/ledger-primitives.source.mjs'));

	const entryFile = path.join(stagedAppRoot, 'src/index.ts');
	const entry = fs.readFileSync(entryFile, 'utf8');
	const importAnchor = "import { root } from '@octanejs/lynx';";
	if (
		entry.indexOf(importAnchor) === -1 ||
		entry.indexOf(importAnchor) !== entry.lastIndexOf(importAnchor)
	) {
		throw new Error('issue-196 M1.5 entry import anchor is missing or ambiguous.');
	}
	const renderAnchor = `void root.render(
	__BENCH_CORE__ === 'block' && __BENCH_BLOCK_MODE__ !== 'derived' ? blockApp(App) : App,
);
`;
	if (
		entry.indexOf(renderAnchor) === -1 ||
		entry.indexOf(renderAnchor) !== entry.lastIndexOf(renderAnchor)
	) {
		throw new Error('issue-196 M1.5 render anchor is missing or ambiguous.');
	}
	const sourceSha256 = crypto.createHash('sha256').update(measuredSource).digest('hex');
	const driver = `

const issue196Reps = 5;

function issue196Rotated<T>(values: readonly T[], by: number): T[] {
	const offset = by % values.length;
	return [...values.slice(offset), ...values.slice(0, offset)];
}

function runIssue196M15(): void {
	'background only';
	for (const primitive of PRIMITIVES) primitive.run(SERIES[0]);
	const samples: Record<string, Record<string, number[]>> = {};
	const checksums: Record<string, Record<string, number[]>> = {};
	for (const primitive of PRIMITIVES) {
		const perCount: Record<string, number[]> = {};
		const perCountChecksums: Record<string, number[]> = {};
		for (const count of SERIES) {
			perCount[String(count)] = [];
			perCountChecksums[String(count)] = [];
		}
		samples[primitive.name] = perCount;
		checksums[primitive.name] = perCountChecksums;
	}
	const windowStartMs = Date.now();
	for (let rep = 0; rep < issue196Reps; rep++) {
		for (const primitive of issue196Rotated(PRIMITIVES, rep)) {
			for (const count of issue196Rotated(SERIES, rep)) {
				const startedMs = Date.now();
				const checksum = primitive.run(count);
				const elapsedMs = Date.now() - startedMs;
				if (!Number.isFinite(checksum)) throw new Error(primitive.name + ' returned a non-finite checksum');
				samples[primitive.name][String(count)].push(elapsedMs);
				checksums[primitive.name][String(count)].push(checksum);
			}
		}
		console.log('__ISSUE196_M15_PROGRESS__' + JSON.stringify({
			rep: rep + 1,
			atMs: Date.now(),
		}));
	}
	const windowEndMs = Date.now();
	for (const primitive of PRIMITIVES) {
		console.log('__ISSUE196_M15_ROW__' + JSON.stringify({
			name: primitive.name,
			note: primitive.note,
			subtract: primitive.subtract ?? null,
			samples: samples[primitive.name],
			checksums: checksums[primitive.name],
		}));
	}
	console.log('__ISSUE196_M15_RESULT__' + JSON.stringify({
		protocol: 'octane-issue196-m15-lepus-v1',
		slice: 'M1.5',
		clock: 'Date.now',
		reps: issue196Reps,
		series: SERIES,
		source: 'stages/ledger-primitives.source.mjs',
		sourceSha256: '${sourceSha256}',
		windowStartMs,
		windowEndMs,
		windowMs: windowEndMs - windowStartMs,
		rows: PRIMITIVES.map((primitive) => primitive.name),
	}));
}

setTimeout(runIssue196M15, 1000);
`;
	fs.writeFileSync(
		entryFile,
		entry
			.replace(
				importAnchor,
				`${importAnchor}\nimport { PRIMITIVES, SERIES } from './ledger-primitives.source.mjs';`,
			)
			.replace(renderAnchor, `${renderAnchor}${driver}`),
	);
}
