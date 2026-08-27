export function median(values) {
	if (!Array.isArray(values) || values.length === 0) throw new Error('median needs samples.');
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function parseQ2Messages(logText) {
	const marker = '__OCTANE_LEPUS_Q2__';
	const messages = [];
	for (const line of String(logText).split(/\r?\n/)) {
		const index = line.indexOf(marker);
		if (index === -1) continue;
		let payload = line.slice(index + marker.length);
		const finalQuote = payload.lastIndexOf('"');
		if (finalQuote !== -1 && payload.slice(finalQuote + 1).trim() === '') {
			payload = payload.slice(0, finalQuote);
		}
		payload = payload.replaceAll('\\"', '"').replaceAll('\\\\', '\\');
		messages.push(JSON.parse(payload));
	}
	return messages;
}

function stableCounts(sample) {
	return JSON.stringify(
		Object.fromEntries(
			Object.entries(sample.profile.q2PapiCounts ?? {}).sort(([a], [b]) => a.localeCompare(b)),
		),
	);
}

export function analyzeQ2Samples(samples, repetitions) {
	if (!Number.isSafeInteger(repetitions) || repetitions < 1)
		throw new TypeError('bad repetitions.');
	const rows = [...new Set(samples.map((sample) => sample.rows))];
	const scales = [];
	for (const rowCount of rows) {
		const atScale = samples.filter((sample) => sample.rows === rowCount);
		for (let repetition = 0; repetition < repetitions; repetition += 1) {
			const pair = atScale.filter((sample) => sample.repetition === repetition);
			if (pair.length !== 2) throw new Error(`${rowCount}/${repetition} is not a complete pair.`);
			const expected = repetition % 2 === 0 ? 'templateprogram' : 'programtemplate';
			if (pair.map((sample) => sample.arm).join('') !== expected) {
				throw new Error(`${rowCount}/${repetition} violates AB/BA order.`);
			}
		}
		const arms = {};
		for (const arm of ['template', 'program']) {
			const armSamples = atScale.filter((sample) => sample.arm === arm);
			const values = armSamples.map((sample) => sample.scriptSelfMs);
			if (new Set(armSamples.map(stableCounts)).size !== 1) {
				throw new Error(`${rowCount}/${arm} has unstable callsBefore counts.`);
			}
			arms[arm] = {
				medianMs: median(values),
				minMs: Math.min(...values),
				maxMs: Math.max(...values),
				fullSamplesMs: values,
			};
		}
		scales.push({
			rows: rowCount,
			arms,
			ordering:
				arms.program.medianMs < arms.template.medianMs
					? 'program-faster'
					: arms.program.medianMs > arms.template.medianMs
						? 'template-faster'
						: 'tie',
		});
	}
	return { sampleCount: samples.length, scales };
}
