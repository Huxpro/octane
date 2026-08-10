export const STACK_TARGETS = Object.freeze([
	Object.freeze({ id: 'main', sha: 'cdb501c945801d449d5d098b1b52341f23a0f80f' }),
	Object.freeze({ id: 'pr-1', sha: 'e14d6001ae1ffe21a82a08116555ed6877696440' }),
	Object.freeze({ id: 'pr-10', sha: '34d530da299849397cd495c4f7b2709599ab09a7' }),
	Object.freeze({ id: 'pr-11', sha: 'adfad409867733a524c5ab200c15b0510535586d' }),
	Object.freeze({ id: 'pr-12', sha: 'b4b0ab92df2f4b4ec0cf3b1a203158f8aa6943ec' }),
	Object.freeze({ id: 'pr-13', sha: 'dcb334afa415fda63e94c09a77a31d107dea6128' }),
	Object.freeze({ id: 'pr-14', sha: 'e627ca5979ed77fbaf8ef5eafbea86c482f64cf5' }),
	Object.freeze({ id: 'pr-15', sha: '4a53620fe811a016cb9966fab53ca181a89159c8' }),
	Object.freeze({ id: 'pr-22', sha: '3f251a8a7033adf2afa135c146536a57dfa58426' }),
]);

const REFERENCE_SHA = '02376ecd1cd62d3797ff1de1209d82dc2f9d91d9';
export const REFERENCE_TARGETS = Object.freeze([
	Object.freeze({
		id: 'vue-vdom',
		sha: REFERENCE_SHA,
		bundle: '../reference/vdom-ifr-et/main.web.bundle',
		reference: true,
	}),
	Object.freeze({
		id: 'vue-vapor',
		sha: REFERENCE_SHA,
		bundle: '../reference/vapor-ifr/main.web.bundle',
		reference: true,
	}),
	Object.freeze({
		id: 'react',
		sha: REFERENCE_SHA,
		bundle: '../reference/react/main.web.bundle',
		reference: true,
	}),
]);

export const WORKSPACE_TARGET = Object.freeze({
	id: 'workspace',
	sha: 'workspace',
	workspace: true,
});

export function selectTargets(ids) {
	if (ids === undefined || ids.length === 0) return STACK_TARGETS;
	const wanted = new Set(ids);
	const selected = [...STACK_TARGETS, ...REFERENCE_TARGETS, WORKSPACE_TARGET].filter((target) =>
		wanted.has(target.id),
	);
	const missing = [...wanted].filter((id) => !selected.some((target) => target.id === id));
	if (missing.length !== 0) throw new Error(`unknown attribution target(s): ${missing.join(', ')}`);
	return selected;
}
