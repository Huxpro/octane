/* global __CreateView, __SetAttribute, __lepus_version__ */

// Issue #196 M1b: allocation/string/branch primitives. M1a dispatch/property
// is a separate device window so its rows exist before any of these rows.
(function runLepusCostM1b() {
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

	const scalarLoop = Function('n', 'var value=0;for(var i=0;i<n;i+=1)value+=i;return value;');
	const objectLiteralLoop = Function(
		'n',
		'var value=0;for(var i=0;i<n;i+=1){var item={x:i};value+=item.x;}return value;',
	);
	const arrayLiteralLoop = Function(
		'n',
		'var value=0;for(var i=0;i<n;i+=1){var item=[i];value+=item[0];}return value;',
	);
	const closureAllocationLoop = Function(
		'n',
		'var last;for(var i=0;i<n;i+=1){last=(function(value){return function(){return value;};})(i);}return last();',
	);
	const scalarCaptureLoop = Function('n', 'var last=0;for(var i=0;i<n;i+=1)last=i;return last;');
	const concatLoop = Function(
		'n',
		'var last="";for(var i=0;i<n;i+=1)last="row-"+i+"-value";return last.length;',
	);
	const templateLoop = Function(
		'n',
		'var last="";for(var i=0;i<n;i+=1)last=`row-${i}-value`;return last.length;',
	);

	const hostTextNode = __CreateView(0);
	const localStringLoop = Function(
		'n',
		'var value=0;for(var i=0;i<n;i+=1){var text="row-"+i;value+=text.length;}return value;',
	);
	function hostStringLoop(n) {
		let value = 0;
		for (let i = 0; i < n; i += 1) {
			const text = 'row-' + i;
			__SetAttribute(hostTextNode, 'data-cost-model', text);
			value += text.length;
		}
		return value;
	}

	function buildBranchLoop(kind, slots) {
		let expression;
		if (kind === 'if') {
			expression = Array.from(
				{ length: slots - 1 },
				(_, index) => `if(key===${index})value+=${index + 1};else `,
			).join('');
			expression += `value+=${slots};`;
		} else if (kind === 'switch') {
			expression = 'switch(key){';
			for (let index = 0; index < slots; index += 1) {
				expression += `case ${index}:value+=${index + 1};break;`;
			}
			expression += '}';
		} else {
			expression = 'value+=table[key];';
		}
		const args = kind === 'table' ? ['n', 'table'] : ['n'];
		return Function(
			...args,
			`var value=0,key=0;for(var i=0;i<n;i+=1){key=i&${slots - 1};${expression}}return value;`,
		);
	}

	const branchLoops = {};
	for (const slots of [4, 16, 64]) {
		const table = Array.from({ length: slots }, (_, index) => index + 1);
		branchLoops[`if_${slots}`] = buildBranchLoop('if', slots);
		branchLoops[`switch_${slots}`] = buildBranchLoop('switch', slots);
		const tableLoop = buildBranchLoop('table', slots);
		branchLoops[`table_${slots}`] = (n) => tableLoop(n, table);
	}

	const cases = [
		{
			id: 'object_literal_vs_scalar',
			group: 'allocation',
			control: scalarLoop,
			candidate: objectLiteralLoop,
		},
		{
			id: 'array_literal_vs_scalar',
			group: 'allocation',
			control: scalarLoop,
			candidate: arrayLiteralLoop,
		},
		{
			id: 'closure_allocation_vs_scalar',
			group: 'allocation',
			control: scalarCaptureLoop,
			candidate: closureAllocationLoop,
		},
		{
			id: 'template_literal_vs_concat',
			group: 'string',
			control: concatLoop,
			candidate: templateLoop,
		},
		{ id: 'string_host_crossing_vs_stays', group: 'string', hostBalanced: true },
	];
	for (const slots of [4, 16, 64]) {
		cases.push(
			{
				id: `switch_vs_if_${slots}`,
				group: 'branch',
				control: branchLoops[`if_${slots}`],
				candidate: branchLoops[`switch_${slots}`],
			},
			{
				id: `table_vs_if_${slots}`,
				group: 'branch',
				control: branchLoops[`if_${slots}`],
				candidate: branchLoops[`table_${slots}`],
			},
		);
	}

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
			checksum += hostStringLoop(n);
			durationMs = measure(localStringLoop, n);
		} else {
			checksum += localStringLoop(n);
			durationMs = measure(hostStringLoop, n);
		}
		return durationMs;
	}

	try {
		emit({
			type: 'meta',
			phase: 'M1-allocation-string-branch',
			engine: 'LepusNG',
			lepusVersion: engineVersion(),
			clock: CLOCK_NAME,
			clockResolutionMs: clockResolution(),
			iterations: ITERATIONS,
			repetitions: REPETITIONS,
		});
		for (const benchmark of cases) {
			if (benchmark.hostBalanced) {
				checksum += hostStringLoop(1000) + localStringLoop(1000);
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
