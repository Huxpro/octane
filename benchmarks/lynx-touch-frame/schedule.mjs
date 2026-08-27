export const TOPOLOGIES = Object.freeze(['T0', 'T1', 'T2', 'T3']);
export const SHAPES = Object.freeze(['local-toggle', 'cross-component', 'structural-delete']);
export const LOADS = Object.freeze(['idle', 'sustained-scroll']);

export const FORMAL_PAIR_COUNT = 8;
export const L2_TOPOLOGIES = Object.freeze(['T1', 'T2']);

export function createFormalSchedule(pairCount = FORMAL_PAIR_COUNT) {
	if (!Number.isSafeInteger(pairCount) || pairCount < 1) {
		throw new TypeError('pairCount must be a positive safe integer');
	}

	const schedule = [];
	let sequence = 0;
	for (const shape of SHAPES) {
		for (const load of LOADS) {
			for (let pair = 0; pair < pairCount; pair += 1) {
				for (const [direction, order] of [
					['AB', TOPOLOGIES],
					['BA', [...TOPOLOGIES].reverse()],
				]) {
					for (let position = 0; position < order.length; position += 1) {
						schedule.push({
							sequence: sequence++,
							shape,
							load,
							pair,
							direction,
							position,
							topology: order[position],
						});
					}
				}
			}
		}
	}
	return schedule;
}

export function createL2Schedule(pairCount = FORMAL_PAIR_COUNT) {
	if (!Number.isSafeInteger(pairCount) || pairCount < 1) {
		throw new TypeError('pairCount must be a positive safe integer');
	}

	const schedule = [];
	let sequence = 0;
	for (const shape of SHAPES) {
		for (const load of LOADS) {
			for (let pair = 0; pair < pairCount; pair += 1) {
				for (const [direction, order] of [
					['AB', L2_TOPOLOGIES],
					['BA', [...L2_TOPOLOGIES].reverse()],
				]) {
					for (let position = 0; position < order.length; position += 1) {
						schedule.push({
							sequence: sequence++,
							shape,
							load,
							pair,
							direction,
							position,
							topology: order[position],
						});
					}
				}
			}
		}
	}
	return schedule;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.stdout.write(`${JSON.stringify(createFormalSchedule(), null, 2)}\n`);
}
