/** Map the current app-owned Native v2 receipt onto the historical #194 runner fields. */
export function normalizeIssue194NativeReceipt(value, interactionOrdinal) {
	const workload = value.name;
	return {
		...value,
		interactionOrdinal:
			Number.isSafeInteger(value.interactionOrdinal) && value.interactionOrdinal > 0
				? value.interactionOrdinal
				: interactionOrdinal,
		workload,
		scale: workload === 'clear' ? value.preState?.rowCount : value.postState?.rowCount,
	};
}

export function issue194DeviceCompletionMode(argumentList) {
	return argumentList.includes('--native-only')
		? 'native-only'
		: argumentList.includes('--direct-result')
			? 'direct-result'
			: argumentList.includes('--first-screen-ready')
				? 'first-screen-ready'
				: 'commit';
}

export function validateIssue194ProcessMemoryControls({
	processMemory,
	mode,
	createClearRecreate,
	settleMs,
}) {
	if (!Number.isSafeInteger(settleMs) || settleMs < 1) {
		throw new TypeError('--settle-ms must be a positive integer.');
	}
	if (processMemory && mode !== 'native-only') {
		throw new Error('--process-memory requires --native-only.');
	}
	if (processMemory && !createClearRecreate) {
		throw new Error('--process-memory requires --create-clear-recreate.');
	}
}

/** Fail closed when a checkpoint would splice a different runner or device into one cohort. */
export function issue194DeviceResumeMismatch(resumed, current) {
	for (const field of [
		'protocol',
		'question',
		'octaneCommit',
		'serial',
		'scale',
		'targetAcceptedSamplesPerCell',
	]) {
		if (resumed[field] !== current[field]) return field;
	}
	for (const field of ['device', 'controls', 'disableDevToolBundle', 'cells']) {
		if (JSON.stringify(resumed[field]) !== JSON.stringify(current[field])) return field;
	}
	return null;
}

export function issue194CollectionState({
	acceptedSamples,
	targetSamples,
	newlyAcceptedSamples,
	maxNewSamples,
}) {
	for (const [label, value] of [
		['acceptedSamples', acceptedSamples],
		['targetSamples', targetSamples],
		['newlyAcceptedSamples', newlyAcceptedSamples],
	]) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new TypeError(`${label} must be a non-negative integer.`);
		}
	}
	if (targetSamples < 1) throw new TypeError('targetSamples must be positive.');
	if (maxNewSamples !== null && (!Number.isSafeInteger(maxNewSamples) || maxNewSamples < 1)) {
		throw new TypeError('maxNewSamples must be null or a positive integer.');
	}
	if (acceptedSamples >= targetSamples) return 'complete';
	if (maxNewSamples !== null && newlyAcceptedSamples >= maxNewSamples) return 'paused';
	return 'collecting';
}

/** Keep a bounded resumed run on the last complete cell group within its budget. */
export function issue194CompleteGroupSampleLimit({
	acceptedSamples,
	targetSamples,
	maxNewSamples,
	cellGroupSize,
}) {
	if (!Number.isSafeInteger(acceptedSamples) || acceptedSamples < 0) {
		throw new TypeError('acceptedSamples must be non-negative.');
	}
	for (const [label, value] of [
		['targetSamples', targetSamples],
		['cellGroupSize', cellGroupSize],
	]) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new TypeError(`${label} must be positive.`);
		}
	}
	if (acceptedSamples > targetSamples || targetSamples % cellGroupSize !== 0) {
		throw new Error('accepted and target samples must describe complete target cell groups.');
	}
	if (maxNewSamples === null) return null;
	if (!Number.isSafeInteger(maxNewSamples) || maxNewSamples < 1) {
		throw new TypeError('maxNewSamples must be null or a positive integer.');
	}
	if (acceptedSamples === targetSamples) return maxNewSamples;
	const requestedStop = Math.min(targetSamples, acceptedSamples + maxNewSamples);
	const completeStop = requestedStop - (requestedStop % cellGroupSize);
	if (completeStop <= acceptedSamples && acceptedSamples < targetSamples) {
		throw new Error('maxNewSamples cannot reach the next complete cell group.');
	}
	return completeStop - acceptedSamples;
}

function issue194LogEpochMs(line) {
	const match = line.match(/^\s*(\d+\.\d+)/);
	return match === null ? null : Number(match[1]) * 1000;
}

/**
 * Keep one logcat observation inside its unique marker's epoch even when the
 * ring evicts the marker itself. Sandbox shells may report success for
 * `logcat -c` without clearing every readable buffer, so falling back to the
 * whole merged log can import DevTool or crash evidence from an older window.
 */
export function issue194LogWindow(fullLog, marker, markerEpochMs = null) {
	if (typeof fullLog !== 'string' || typeof marker !== 'string' || marker.length === 0) {
		throw new TypeError('fullLog and a non-empty marker must be strings.');
	}
	if (markerEpochMs !== null && (!Number.isFinite(markerEpochMs) || markerEpochMs < 0)) {
		throw new TypeError('markerEpochMs must be null or a non-negative finite number.');
	}
	const lines = fullLog.split('\n');
	const markerLineIndex = lines.findLastIndex((line) => line.includes(marker));
	if (markerLineIndex !== -1) {
		const observedEpochMs = issue194LogEpochMs(lines[markerLineIndex]);
		return {
			log: lines.slice(markerLineIndex).join('\n'),
			markerEpochMs: observedEpochMs ?? markerEpochMs,
		};
	}
	if (markerEpochMs === null) return { log: '', markerEpochMs: null };
	const firstCurrentLine = lines.findIndex((line) => {
		const lineEpochMs = issue194LogEpochMs(line);
		return lineEpochMs !== null && lineEpochMs >= markerEpochMs;
	});
	return {
		log: firstCurrentLine === -1 ? '' : lines.slice(firstCurrentLine).join('\n'),
		markerEpochMs,
	};
}

export function issue194RejectionReasons(checks) {
	return Object.entries(checks)
		.filter(([, passed]) => passed !== true)
		.map(([name]) => name);
}

/** Repeated lifecycle cycles with an explicit reset between populated end states. */
export function issue194LifecycleSequence(cycles, create, clear) {
	if (!Number.isSafeInteger(cycles) || cycles < 1) {
		throw new TypeError('issue #194 lifecycle cycles must be a positive integer.');
	}
	const sequence = [];
	for (let cycle = 0; cycle < cycles; cycle++) {
		if (cycle !== 0) sequence.push({ cycle, phase: 'reset', workload: 'clear', ...clear });
		sequence.push(
			{ cycle, phase: 'create', workload: 'create', ...create },
			{ cycle, phase: 'clear', workload: 'clear', ...clear },
			{ cycle, phase: 'recreate', workload: 'create', ...create },
		);
	}
	return sequence;
}

/**
 * Prove every clear returns logical ownership to baseline. Lynx 4.1 Template
 * removals retain their Android weak globals, so a safe owner recycles those
 * detached handles: the first clear may establish a bounded pool, every later
 * clear must reproduce it exactly, and active + recycled host refs must remain
 * on the first populated plateau.
 */
export function summarizeIssue194LifecycleCensus(sequenceEvidence, initial) {
	const populated =
		sequenceEvidence.find((entry) => entry.phase === 'create')?.attribution?.census ?? null;
	const cleared =
		sequenceEvidence.find((entry) => entry.workload === 'clear')?.attribution?.census ?? null;
	const logicalKeys = ['handles', 'ranges', 'listenerSlots', 'retainedHostRefs'];
	const same = (left, right, keys = logicalKeys) =>
		left !== null &&
		right !== null &&
		keys.every((key) => Number.isSafeInteger(left[key]) && left[key] === right[key]);
	const poolKeys = ['recycledHandles', 'recycledHostRefs'];
	const censuses = [
		initial,
		populated,
		cleared,
		...sequenceEvidence.map((entry) => entry.attribution?.census),
	].filter((census) => census !== null && census !== undefined);
	const poolObserved = censuses.some((census) =>
		poolKeys.some((key) => Object.hasOwn(census, key)),
	);
	const hasPoolCensus = censuses.every((census) =>
		poolKeys.every((key) => Number.isSafeInteger(census[key])),
	);
	const recycling =
		hasPoolCensus &&
		cleared !== null &&
		(cleared.recycledHandles > 0 || cleared.recycledHostRefs > 0);
	const stableLogicalLifecycle =
		initial !== null &&
		populated !== null &&
		cleared !== null &&
		same(cleared, initial) &&
		sequenceEvidence.every((entry) =>
			same(entry.attribution?.census ?? null, entry.workload === 'clear' ? cleared : populated),
		);
	const stablePool = recycling
		? hasPoolCensus &&
			initial.recycledHandles === 0 &&
			initial.recycledHostRefs === 0 &&
			populated.recycledHandles === 0 &&
			populated.recycledHostRefs === 0 &&
			sequenceEvidence.every((entry) =>
				same(
					entry.attribution?.census ?? null,
					entry.workload === 'clear' ? cleared : populated,
					poolKeys,
				),
			) &&
			cleared.retainedHostRefs + cleared.recycledHostRefs === populated.retainedHostRefs
		: !poolObserved ||
			(hasPoolCensus &&
				censuses.every((census) => census.recycledHandles === 0 && census.recycledHostRefs === 0));
	return {
		valid: stableLogicalLifecycle && stablePool,
		initial,
		populated,
		cleared,
		recycling,
	};
}

function androidMemoryKeyValues(text) {
	return Object.fromEntries(
		text
			.trim()
			.split(/\r?\n/)
			.map((line) => line.match(/^([A-Za-z_]+):\s+(\d+) kB$/))
			.filter((match) => match !== null)
			.map((match) => [match[1], Number(match[2])]),
	);
}

/** Parse the three Android process-memory sources without relabeling a sampled checkpoint as peak. */
export function parseIssue194AndroidProcessMemory(smapsText, statusText, meminfoText) {
	const smaps = androidMemoryKeyValues(smapsText);
	const status = androidMemoryKeyValues(statusText);
	const native = meminfoText.match(
		/^\s*Native Heap\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m,
	);
	const dalvik = meminfoText.match(
		/^\s*Dalvik Heap\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m,
	);
	const total = meminfoText.match(/^\s*TOTAL\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
	if (
		![smaps.Rss, smaps.Pss, smaps.Private_Clean, smaps.Private_Dirty, status.VmRSS].every(
			Number.isFinite,
		) ||
		native === null ||
		dalvik === null ||
		total === null
	) {
		throw new Error('issue #194 could not parse Android process memory accounting.');
	}
	return {
		smapsRollupKb: smaps,
		statusKb: status,
		dumpsysKb: {
			totalPss: Number(total[1]),
			totalPrivateDirty: Number(total[2]),
			totalPrivateClean: Number(total[3]),
			totalSwapDirty: Number(total[4]),
			nativePss: Number(native[1]),
			nativePrivateDirty: Number(native[2]),
			nativePrivateClean: Number(native[3]),
			nativeHeapSize: Number(native[5]),
			nativeHeapAlloc: Number(native[6]),
			nativeHeapFree: Number(native[7]),
			dalvikPss: Number(dalvik[1]),
			dalvikPrivateDirty: Number(dalvik[2]),
			dalvikPrivateClean: Number(dalvik[3]),
			dalvikHeapSize: Number(dalvik[5]),
			dalvikHeapAlloc: Number(dalvik[6]),
			dalvikHeapFree: Number(dalvik[7]),
		},
	};
}
