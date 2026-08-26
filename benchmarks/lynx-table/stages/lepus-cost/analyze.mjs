const MIN_REPETITIONS = 5;

function finite(value, label) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`${label} must be a finite number.`);
	}
	return value;
}

export function median(values) {
	if (!Array.isArray(values) || values.length === 0) throw new Error('median needs samples.');
	const sorted = values.map((value) => finite(value, 'sample')).sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function linearFit(points) {
	if (!Array.isArray(points) || points.length < 2) throw new Error('linear fit needs two points.');
	const xs = points.map((point) => finite(point.x, 'x'));
	const ys = points.map((point) => finite(point.y, 'y'));
	const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
	const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
	let numerator = 0;
	let denominator = 0;
	for (let index = 0; index < xs.length; index += 1) {
		numerator += (xs[index] - meanX) * (ys[index] - meanY);
		denominator += (xs[index] - meanX) ** 2;
	}
	if (denominator === 0) throw new Error('linear fit needs distinct x values.');
	const slopeMsPerOp = numerator / denominator;
	const interceptMs = meanY - slopeMsPerOp * meanX;
	const residualsMs = points.map((point) => point.y - (interceptMs + slopeMsPerOp * point.x));
	const rmseMs = Math.sqrt(
		residualsMs.reduce((sum, residual) => sum + residual * residual, 0) / residualsMs.length,
	);
	return {
		slopeMsPerOp,
		nsPerOp: slopeMsPerOp * 1e6,
		interceptMs,
		rmseMs,
		maxAbsResidualMs: Math.max(...residualsMs.map(Math.abs)),
		residualsMs,
	};
}

export function analyzeMessages(messages) {
	if (!Array.isArray(messages)) throw new TypeError('messages must be an array.');
	const meta = messages.find((message) => message.type === 'meta');
	const done = messages.find((message) => message.type === 'done');
	if (!meta || !done) throw new Error('measurement window is missing meta or done.');
	if (!Number.isSafeInteger(meta.repetitions) || meta.repetitions < MIN_REPETITIONS) {
		throw new Error(`measurement window needs at least ${MIN_REPETITIONS} repetitions.`);
	}
	const samples = messages.filter((message) => message.type === 'sample');
	const caseIds = [...new Set(samples.map((sample) => sample.case))];
	const rows = [];
	for (const caseId of caseIds) {
		const caseSamples = samples.filter((sample) => sample.case === caseId);
		const byN = [];
		const fitPoints = [];
		for (const n of meta.iterations) {
			const sizeSamples = caseSamples.filter((sample) => sample.n === n);
			const deltasMs = [];
			for (let repetition = 0; repetition < meta.repetitions; repetition += 1) {
				const pair = sizeSamples.filter((sample) => sample.repetition === repetition);
				if (pair.length !== 2 || new Set(pair.map((sample) => sample.arm)).size !== 2) {
					throw new Error(`${caseId}/${n}/${repetition} is not a complete pair.`);
				}
				const expectedOrder = repetition % 2 === 0 ? 'controlcandidate' : 'candidatecontrol';
				if (pair[0].order !== expectedOrder || pair[0].arm + pair[1].arm !== expectedOrder) {
					throw new Error(`${caseId}/${n}/${repetition} violates AB/BA order.`);
				}
				if (pair[0].hostCallsWholeArm !== pair[1].hostCallsWholeArm) {
					throw new Error(`${caseId}/${n}/${repetition} violates callsBefore identity.`);
				}
				const control = pair.find((sample) => sample.arm === 'control');
				const candidate = pair.find((sample) => sample.arm === 'candidate');
				finite(control.durationMs, 'control duration');
				finite(candidate.durationMs, 'candidate duration');
				const deltaMs = candidate.durationMs - control.durationMs;
				deltasMs.push(deltaMs);
				fitPoints.push({ x: n, y: deltaMs });
			}
			byN.push({
				n,
				medianDeltaMs: median(deltasMs),
				minDeltaMs: Math.min(...deltasMs),
				maxDeltaMs: Math.max(...deltasMs),
				deltasMs,
			});
		}
		rows.push({
			case: caseId,
			group: caseSamples[0].group,
			fit: linearFit(fitPoints),
			byN,
		});
	}
	return { meta, done, sampleCount: samples.length, rows };
}

export function parseLogMessages(logText) {
	const marker = '__OCTANE_LEPUS_COST__';
	const messages = [];
	for (const line of String(logText).split(/\r?\n/)) {
		const markerIndex = line.indexOf(marker);
		if (markerIndex === -1) continue;
		let payload = line.slice(markerIndex + marker.length);
		const finalQuote = payload.lastIndexOf('"');
		if (finalQuote !== -1 && payload.slice(finalQuote + 1).trim() === '')
			payload = payload.slice(0, finalQuote);
		payload = payload.replaceAll('\\"', '"').replaceAll('\\\\', '\\');
		messages.push(JSON.parse(payload));
	}
	return messages;
}
