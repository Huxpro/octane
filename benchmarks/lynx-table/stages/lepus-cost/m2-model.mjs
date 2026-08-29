function rowMap(record) {
	return new Map(record.analysis.rows.map((row) => [row.case, row.fit.nsPerOp]));
}

function required(rows, name) {
	const value = rows.get(name);
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`M1 record has no finite ${name} slope.`);
	}
	return value;
}

function fitCallCost(points) {
	const meanX = points.reduce((sum, point) => sum + point.args, 0) / points.length;
	const meanY = points.reduce((sum, point) => sum + point.ns, 0) / points.length;
	let numerator = 0;
	let denominator = 0;
	for (const point of points) {
		numerator += (point.args - meanX) * (point.ns - meanY);
		denominator += (point.args - meanX) ** 2;
	}
	const perArgumentNs = numerator / denominator;
	return { zeroArgumentNs: meanY - perArgumentNs * meanX, perArgumentNs };
}

export function buildPrimitiveModel(dispatchRecord, allocationRecord) {
	const dispatch = rowMap(dispatchRecord);
	const allocation = rowMap(allocationRecord);
	const callFit = fitCallCost([
		{ args: 0, ns: required(dispatch, 'call_0_args') },
		{ args: 3, ns: required(dispatch, 'call_3_args') },
		{ args: 8, ns: required(dispatch, 'call_8_args') },
	]);
	const hostBoundaryNs = required(dispatch, 'host_papi_vs_lepus_call');
	const call3Ns = callFit.zeroArgumentNs + 3 * callFit.perArgumentNs;
	// The M1 string-crossing candidate calls __SetAttribute(node, name, value):
	// subtract its three-argument call/crossing cost, then divide the remainder
	// between the two string arguments. This is an explicit decomposition, not a
	// second fitted device constant.
	const stringArgumentNs =
		(required(allocation, 'string_host_crossing_vs_stays') - call3Ns - hostBoundaryNs) / 2;
	return {
		callFit,
		hostBoundaryNs,
		stringArgumentNs,
		propertyMethodVsLocalNs: required(dispatch, 'property_method_vs_local_binding'),
		arrayAllocationNs: required(allocation, 'array_literal_vs_scalar'),
		arrayStoreNs: required(dispatch, 'array_index_store_vs_local'),
		emptyLoopIterationNs: required(dispatch, 'empty_loop'),
		propertyLoadNs: required(dispatch, 'property_load_vs_local'),
	};
}

function callNs(model, args) {
	return model.callFit.zeroArgumentNs + args * model.callFit.perArgumentNs;
}

export function emittedProgramInventory(rows) {
	if (!Number.isSafeInteger(rows) || rows < 1)
		throw new TypeError('rows must be a positive integer.');
	return {
		// Static emitted shape: view 1, text 3, raw text 3 per row.
		hostCallsByArgumentCount: { 1: 7 * rows, 2: 11 * rows, 4: 2 * rows },
		// raw text 3 + setClasses 4 + two strings in each of two events.
		hostStringArguments: 11 * rows,
		// setClasses 4 + setEvent 2 are reached through `papi.<method>`.
		propertyMethodCalls: 6 * rows,
		// The compiler emits one seven-node row program and the first-screen plan
		// invokes it once per row; bundle size stays constant across row scales.
		returnedArrayAllocations: rows,
		returnedArrayStores: 7 * rows,
		unpriced: [
			'parse/eval of emitted source',
			'large-arity outer create-function entry',
			'native work inside individual Element PAPI operations',
			'conditional-event branch absolute cost',
		],
	};
}

export function predictEmittedProgram(model, rows) {
	const inventory = emittedProgramInventory(rows);
	let hostCallNs = 0;
	for (const [args, count] of Object.entries(inventory.hostCallsByArgumentCount)) {
		hostCallNs += count * (callNs(model, Number(args)) + model.hostBoundaryNs);
	}
	const componentsNs = {
		hostCalls: hostCallNs,
		hostStringArguments: inventory.hostStringArguments * model.stringArgumentNs,
		propertyMethodLookup: inventory.propertyMethodCalls * model.propertyMethodVsLocalNs,
		returnedArrayAllocation: inventory.returnedArrayAllocations * model.arrayAllocationNs,
		returnedArrayStores: inventory.returnedArrayStores * model.arrayStoreNs,
	};
	const predictedNs = Object.values(componentsNs).reduce((sum, value) => sum + value, 0);
	return { rows, predictedMs: predictedNs / 1e6, componentsNs, inventory };
}

export function predictTemplateLowerBound(model, rows) {
	const program = predictEmittedProgram(model, rows);
	// A deliberately conservative lower bound: the same painting primitives plus
	// one interpreter-loop iteration and one property load per emitted node. The
	// actual template interpreter performs more routing/bookkeeping; M1 cannot
	// infer that static count without using a downstream measurement.
	const extraNs = 7 * rows * (model.emptyLoopIterationNs + model.propertyLoadNs);
	return {
		rows,
		predictedLowerBoundMs: program.predictedMs + extraNs / 1e6,
		extraInterpreterFloorNs: extraNs,
		orderingPrediction: 'program-faster-than-template',
	};
}
