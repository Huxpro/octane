// A first screen has exactly one of these representation costs. The command
// path walks the interpreted plan; a resident-program build calls emitted
// create code instead. Requiring either keeps the coverage gate meaningful
// after the program backend became the normal application default, while still
// rejecting a profile that names neither critical render path.
const REQUIRED_BUCKET_GROUPS = [['applier walk', 'compiled program create']];

function medianOf(value, label) {
	const median = value?.median;
	if (typeof median !== 'number' || !Number.isFinite(median) || median < 0) {
		throw new TypeError(`${label} median must be a finite number greater than or equal to zero.`);
	}
	return median;
}

/**
 * Refuse a CPU-profile smoke whose probe table no longer names the critical
 * framework work or whose unnamed remainder crossed the frozen ceiling.
 */
export function assertMtsProfileCoverage(cell, maxUnmatchedShare) {
	if (
		typeof maxUnmatchedShare !== 'number' ||
		!Number.isFinite(maxUnmatchedShare) ||
		maxUnmatchedShare <= 0 ||
		maxUnmatchedShare >= 1
	) {
		throw new TypeError('max unmatched share must be a finite number between 0 and 1.');
	}
	const named = medianOf(cell?.namedMs, 'named self time');
	const unmatched = medianOf(cell?.unmatchedMs, 'unmatched self time');
	const total = medianOf(cell?.totalMs, 'total self time');
	const share = medianOf(cell?.unmatchedShare, 'unmatched share');
	if (named === 0 || total === 0) {
		throw new Error('main-thread profile named no framework self time.');
	}
	for (const alternatives of REQUIRED_BUCKET_GROUPS) {
		const hasNamedTime = alternatives.some((bucket) => {
			const value = cell?.buckets?.[bucket];
			return value === undefined ? false : medianOf(value, bucket) > 0;
		});
		if (!hasNamedTime) {
			throw new Error(
				`main-thread profile named no self time in required bucket group ` +
					alternatives.map((bucket) => JSON.stringify(bucket)).join(' or ') +
					'.',
			);
		}
	}
	if (share > maxUnmatchedShare) {
		throw new Error(
			`main-thread profile left ${(share * 100).toFixed(1)}% unmatched, above the ${(maxUnmatchedShare * 100).toFixed(1)}% ceiling.`,
		);
	}
	return { named, unmatched, total, unmatchedShare: share };
}
