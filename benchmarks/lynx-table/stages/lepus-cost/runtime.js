/* global __CreateView, __GetElementUniqueID, __lepus_version__ */

// Issue #196 M1a: LepusNG dispatch and property/environment primitives.
// This file is injected into the native main-thread entry by build.mjs. It is
// plain ES2019 on purpose: the measured operations must remain recognizable in
// the emitted script, and the device runtime—not Node—is the observation point.
(function runLepusCostM1a() {
	const MARKER = '__OCTANE_LEPUS_COST__';
	const ITERATIONS = [50000, 100000, 200000, 400000];
	const REPETITIONS = 5;
	const HAS_PERFORMANCE_CLOCK =
		typeof performance !== 'undefined' && typeof performance.now === 'function';
	const CLOCK_NAME = HAS_PERFORMANCE_CLOCK ? 'performance.now' : 'Date.now';
	let checksum = 0;

	function emit(value) {
		console.info(MARKER + JSON.stringify(value));
	}

	function clock() {
		return HAS_PERFORMANCE_CLOCK ? performance.now() : Date.now();
	}

	// Runtime construction keeps the production minifier from replacing the
	// micro-call with its constant body before LepusNG sees it.
	const dynamic0 = Function('return 1;');
	const dynamic3 = Function('a', 'b', 'c', 'return a+b+c;');
	const dynamic8 = Function('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'return a+b+c+d+e+f+g+h;');

	function emptyLoop(n) {
		for (let i = 0; i < n; i += 1) {
			// Deliberately empty: this row prices dispatch through the loop itself.
		}
		return n;
	}

	function inline1Loop(n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) value += 1;
		return value;
	}

	function inline6Loop(n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) value += 6;
		return value;
	}

	function inline36Loop(n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) value += 36;
		return value;
	}

	function call0Loop(n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) value += dynamic0();
		return value;
	}

	function call3Loop(n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) value += dynamic3(1, 2, 3);
		return value;
	}

	function call8Loop(n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) value += dynamic8(1, 2, 3, 4, 5, 6, 7, 8);
		return value;
	}

	const methodObject = { f: dynamic0 };
	function localFunctionLoop(n) {
		const f = methodObject.f;
		let value = 0;
		for (let i = 0; i < n; i += 1) value += f();
		return value;
	}

	function propertyFunctionLoop(n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) value += methodObject.f();
		return value;
	}

	const localReadLoop = Function(
		'n',
		'var local=7,value=0;for(var i=0;i<n;i+=1)value+=local;return value;',
	);
	const closureReadLoop = Function(
		'captured',
		'return function(n){var value=0;for(var i=0;i<n;i+=1)value+=captured;return value;};',
	)(7);

	globalThis.__OCTANE_LEPUS_GLOBAL_READ__ = 7;
	const globalReadLoop = Function(
		'n',
		'var value=0;for(var i=0;i<n;i+=1)value+=__OCTANE_LEPUS_GLOBAL_READ__;return value;',
	);

	const monoObject = { x: 7 };
	function propertyLoadLoop(n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) value += monoObject.x;
		return value;
	}

	function localStoreLoop(n) {
		let target = 0;
		for (let i = 0; i < n; i += 1) target = i;
		return target;
	}

	function propertyStoreLoop(n) {
		for (let i = 0; i < n; i += 1) monoObject.x = i;
		return monoObject.x;
	}

	const monoArray = [7];
	function arrayLoadLoop(n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) value += monoArray[0];
		return value;
	}

	function arrayStoreLoop(n) {
		for (let i = 0; i < n; i += 1) monoArray[0] = i;
		return monoArray[0];
	}

	function makeShapes(count) {
		const shapes = [];
		for (let index = 0; index < count; index += 1) {
			const shape = {};
			for (let field = 0; field < index; field += 1) shape['p' + field] = field;
			shape.x = 7;
			shapes.push(shape);
		}
		return shapes;
	}

	const shapes1 = makeShapes(1);
	const shapes2 = makeShapes(2);
	const shapes8 = makeShapes(8);
	function shapeReadLoop(shapes, mask, n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) value += shapes[i & mask].x;
		return value;
	}

	const hostNode = __CreateView(0);
	const lepusIdentity = Function('node', 'expected', 'return node===expected?1:0;');

	function lepusCallLoop(n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) value += lepusIdentity(hostNode, hostNode);
		return value;
	}

	function hostCallLoop(n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) value += __GetElementUniqueID(hostNode);
		return value;
	}

	const cases = [
		{ id: 'empty_loop', group: 'dispatch', control: () => 0, candidate: emptyLoop },
		{ id: 'call_0_args', group: 'dispatch', control: inline1Loop, candidate: call0Loop },
		{ id: 'call_3_args', group: 'dispatch', control: inline6Loop, candidate: call3Loop },
		{ id: 'call_8_args', group: 'dispatch', control: inline36Loop, candidate: call8Loop },
		{
			id: 'property_method_vs_local_binding',
			group: 'dispatch',
			control: localFunctionLoop,
			candidate: propertyFunctionLoop,
		},
		{ id: 'host_papi_vs_lepus_call', group: 'dispatch', hostBalanced: true },
		{
			id: 'closure_read_vs_local',
			group: 'environment',
			control: localReadLoop,
			candidate: closureReadLoop,
		},
		{
			id: 'global_read_vs_local',
			group: 'environment',
			control: localReadLoop,
			candidate: globalReadLoop,
		},
		{
			id: 'property_load_vs_local',
			group: 'property',
			control: localReadLoop,
			candidate: propertyLoadLoop,
		},
		{
			id: 'property_store_vs_local',
			group: 'property',
			control: localStoreLoop,
			candidate: propertyStoreLoop,
		},
		{
			id: 'array_index_load_vs_local',
			group: 'property',
			control: localReadLoop,
			candidate: arrayLoadLoop,
		},
		{
			id: 'array_index_store_vs_local',
			group: 'property',
			control: localStoreLoop,
			candidate: arrayStoreLoop,
		},
		{
			id: 'property_load_2_shapes_vs_1',
			group: 'shape',
			control: (n) => shapeReadLoop(shapes1, 0, n),
			candidate: (n) => shapeReadLoop(shapes2, 1, n),
		},
		{
			id: 'property_load_8_shapes_vs_1',
			group: 'shape',
			control: (n) => shapeReadLoop(shapes1, 0, n),
			candidate: (n) => shapeReadLoop(shapes8, 7, n),
		},
	];

	function engineVersion() {
		try {
			if (typeof __lepus_version__ === 'function') return String(__lepus_version__());
			if (typeof __lepus_version__ !== 'undefined') return String(__lepus_version__);
		} catch (error) {
			return 'error:' + String(error);
		}
		return 'unavailable';
	}

	function clockResolution() {
		let minimum = Infinity;
		let previous = clock();
		for (let i = 0; i < 10000; i += 1) {
			const next = clock();
			const delta = next - previous;
			if (delta > 0 && delta < minimum) minimum = delta;
			previous = next;
		}
		return minimum === Infinity ? null : minimum;
	}

	function measure(fn, n) {
		const started = clock();
		const value = fn(n);
		const durationMs = clock() - started;
		checksum += Number(value) || 0;
		return durationMs;
	}

	function measureHostBalanced(arm, n) {
		let durationMs;
		if (arm === 'control') {
			checksum += hostCallLoop(n);
			durationMs = measure(lepusCallLoop, n);
		} else {
			checksum += lepusCallLoop(n);
			durationMs = measure(hostCallLoop, n);
		}
		return durationMs;
	}

	try {
		emit({
			type: 'meta',
			phase: 'M1-dispatch-property',
			engine: 'LepusNG',
			lepusVersion: engineVersion(),
			clock: CLOCK_NAME,
			clockResolutionMs: clockResolution(),
			iterations: ITERATIONS,
			repetitions: REPETITIONS,
		});

		for (const benchmark of cases) {
			if (benchmark.hostBalanced) {
				checksum += hostCallLoop(1000) + lepusCallLoop(1000);
			} else {
				checksum += benchmark.control(1000) + benchmark.candidate(1000);
			}
			for (const n of ITERATIONS) {
				for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
					const order = repetition % 2 === 0 ? ['control', 'candidate'] : ['candidate', 'control'];
					for (const arm of order) {
						const durationMs = benchmark.hostBalanced
							? measureHostBalanced(arm, n)
							: measure(benchmark[arm], n);
						emit({
							type: 'sample',
							case: benchmark.id,
							group: benchmark.group,
							n,
							repetition,
							order: order.join(''),
							arm,
							durationMs,
							hostCallsWholeArm: benchmark.hostBalanced ? n : 0,
						});
					}
				}
			}
		}
		emit({ type: 'done', checksum, caseCount: cases.length });
	} catch (error) {
		emit({ type: 'fatal', message: String(error), stack: error && error.stack });
		throw error;
	}
})();
