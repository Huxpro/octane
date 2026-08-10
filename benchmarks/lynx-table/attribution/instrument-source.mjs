import fs from 'node:fs';
import path from 'node:path';

function replaceOnce(source, search, replacement, file) {
	const first = source.indexOf(search);
	if (first === -1)
		throw new Error(`S3 attribution anchor missing in ${file}: ${search.slice(0, 80)}`);
	if (source.indexOf(search, first + search.length) !== -1) {
		throw new Error(`S3 attribution anchor is ambiguous in ${file}: ${search.slice(0, 80)}`);
	}
	return source.slice(0, first) + replacement + source.slice(first + search.length);
}

export function instrumentLynxAttributionSources(repositoryRoot) {
	const file = path.join(repositoryRoot, 'packages/octane/src/universal-core.ts');
	const original = fs.readFileSync(file, 'utf8');
	const originals = new Map([[file, original]]);
	let source = original;
	try {
		source = replaceOnce(
			source,
			'export function universalValue(\n',
			`function s3AttributionCount(name: string, amount = 1): void {
\tconst globals = globalThis as any;
\tconst profile = (globals.__OCTANE_LYNX_S3_PROFILE__ ??= Object.create(null));
\tprofile[name] = (profile[name] ?? 0) + amount;
}

function s3AttributionDuration(name: string, started: number): void {
\ts3AttributionCount(name, performance.now() - started);
}

let S3_EXECUTE_OWNER_DEPTH = 0;

export function universalValue(
`,
			file,
		);
		source = replaceOnce(
			source,
			`): UniversalPlanValue {
\tif (plan?.$$kind !== UNIVERSAL_PLAN)
`,
			`): UniversalPlanValue {
\ts3AttributionCount('planValues');
\tif (plan?.$$kind !== UNIVERSAL_PLAN)
`,
			file,
		);
		source = replaceOnce(
			source,
			`): UniversalPropsValue {
\tconst props: Record<string, unknown> = {};
`,
			`): UniversalPropsValue {
\ts3AttributionCount('propPrograms');
\tconst props: Record<string, unknown> = {};
`,
			file,
		);
		source = replaceOnce(
			source,
			`): DraftOwner {
\treturn {
`,
			`): DraftOwner {
\ts3AttributionCount('ownerDrafts');
\treturn {
`,
			file,
		);
		source = replaceOnce(
			source,
			'function createLogicalRecord(id: number, blueprint: BlueprintNode): LogicalRecord {\n\treturn {\n',
			"function createLogicalRecord(id: number, blueprint: BlueprintNode): LogicalRecord {\n\ts3AttributionCount('logicalRecords');\n\treturn {\n",
			file,
		);
		source = replaceOnce(
			source,
			`\treturn [
\t\t{
\t\t\tkind: 'host',
`,
			`\ts3AttributionCount('blueprintHosts');
\treturn [
\t\t{
\t\t\tkind: 'host',
`,
			file,
		);
		source = replaceOnce(
			source,
			`function materializePlanValue(
\tvalue: UniversalPlanValue,
`,
			`function materializePlanValue(
\tvalue: UniversalPlanValue,
`,
			file,
		);
		source = replaceOnce(
			source,
			`): BlueprintNode[] {
\tif (value.plan.renderer !== expectedRenderer) {
`,
			`): BlueprintNode[] {
\ts3AttributionCount('planMaterializations');
\tif (value.plan.renderer !== expectedRenderer) {
`,
			file,
		);
		source = replaceOnce(
			source,
			`\tconst attempt = currentAttempt();
\tconst warmPlanCheckpoint = ACTIVE_UNIVERSAL_WARM_PLANS.length;
\tlet output: BlueprintNode[] = [];
\tfor (let renderCount = initialRenderCount; ; renderCount++) {
`,
			`\tconst attempt = currentAttempt();
\tconst warmPlanCheckpoint = ACTIVE_UNIVERSAL_WARM_PLANS.length;
\tlet output: BlueprintNode[] = [];
\tconst s3OuterOwner = S3_EXECUTE_OWNER_DEPTH++ === 0;
\tconst s3OwnerStarted = s3OuterOwner ? performance.now() : 0;
\ttry {
\tfor (let renderCount = initialRenderCount; ; renderCount++) {
`,
			file,
		);
		source = replaceOnce(
			source,
			`\t\tif (!owner.needsRender) return output;
\t}
}

function renderLazyLeafItem(
`,
			`\t\tif (!owner.needsRender) return output;
\t}
\t} finally {
\t\tS3_EXECUTE_OWNER_DEPTH--;
\t\tif (s3OuterOwner) s3AttributionDuration('ownerMaterializationMs', s3OwnerStarted);
\t}
}

function renderLazyLeafItem(
`,
			file,
		);
		const lazyLeafAnchor = 'function renderLazyLeafItem(';
		const lazyLeafStart = source.indexOf(lazyLeafAnchor);
		if (lazyLeafStart !== -1) {
			const body = source.indexOf(' {\n', lazyLeafStart);
			if (body === -1) throw new Error(`S3 attribution lazy-leaf body missing in ${file}.`);
			source =
				source.slice(0, body + 3) +
				"\ts3AttributionCount('forItemCallbacks');\n" +
				source.slice(body + 3);
		}
		source = replaceOnce(
			source,
			`\t\t\t\toutput.push(
\t\t\t\t\t...materializeScoped(parent, [...path, 'for'], itemKey, () =>
\t\t\t\t\t\tlist.render(item, itemIndex),
`,
			`\t\t\t\toutput.push(
\t\t\t\t\t...materializeScoped(parent, [...path, 'for'], itemKey, () => {
\t\t\t\t\t\ts3AttributionCount('forItemCallbacks');
\t\t\t\t\t\treturn list.render(item, itemIndex);
\t\t\t\t\t},
`,
			file,
		);
		source = replaceOnce(
			source,
			`function cloneSerializableValue(
\tvalue: unknown,
\tseen: WeakSet<object> = new WeakSet(),
): UniversalSerializableValue {
`,
			`function cloneSerializableValue(
\tvalue: unknown,
\tseen: WeakSet<object> = new WeakSet(),
): UniversalSerializableValue {
\ts3AttributionCount('cloneVisits');
`,
			file,
		);
		const hasPlanInstances = source.includes(
			'planInstances: readonly UniversalPlanInstance[] | null = null,',
		);
		source = replaceOnce(
			source,
			`): UniversalHostBatch {
\tfor (const command of commands) {
`,
			`): UniversalHostBatch {
\ts3AttributionCount('commands', commands.length);
\ts3AttributionCount('frozenObjects', commands.length + 2);
${hasPlanInstances ? "\ts3AttributionCount('planInstances', planInstances?.length ?? 0);\n" : ''}\tfor (const command of commands) {
`,
			file,
		);
		source = replaceOnce(
			source,
			`\t): UniversalTransactionImpl<Container, PublicInstance> {
\t\tlet nextId = this.nextId;
`,
			`\t): UniversalTransactionImpl<Container, PublicInstance> {
\t\tconst s3TransactionStarted = performance.now();
\t\tlet nextId = this.nextId;
`,
			file,
		);
		source = replaceOnce(
			source,
			`\t\treturn transaction;
\t}

\tfinish(transaction: UniversalTransactionImpl<Container, PublicInstance>): void {
`,
			`\t\ts3AttributionDuration('transactionStagingMs', s3TransactionStarted);
\t\treturn transaction;
\t}

\tfinish(transaction: UniversalTransactionImpl<Container, PublicInstance>): void {
`,
			file,
		);
		fs.writeFileSync(file, source);

		const planFile = path.join(repositoryRoot, 'packages/lynx/src/core/plan-wire.ts');
		if (fs.existsSync(planFile)) {
			const planOriginal = fs.readFileSync(planFile, 'utf8');
			originals.set(planFile, planOriginal);
			let planSource = planOriginal;
			planSource = replaceOnce(
				planSource,
				`): LynxWireHostBatch {
\tconst instances = batch.planInstances;
`,
				`): LynxWireHostBatch {
\tconst s3PlanFoldStarted = performance.now();
\ttry {
\tconst instances = batch.planInstances;
`,
				planFile,
			);
			planSource = replaceOnce(
				planSource,
				`\treturn Object.freeze({
\t\trenderer: batch.renderer,
\t\tversion: batch.version,
\t\tcommands: Object.freeze(commands),
\t});
}

/* ------------------------------------------------------------------------- *
 * Main-thread expansion
`,
				`\treturn Object.freeze({
\t\trenderer: batch.renderer,
\t\tversion: batch.version,
\t\tcommands: Object.freeze(commands),
\t});
\t} finally {
\t\tconst globals = globalThis as any;
\t\tconst profile = (globals.__OCTANE_LYNX_S3_PROFILE__ ??= Object.create(null));
\t\tprofile.planFoldingMs =
\t\t\t(profile.planFoldingMs ?? 0) + performance.now() - s3PlanFoldStarted;
\t}
}

/* ------------------------------------------------------------------------- *
 * Main-thread expansion
`,
				planFile,
			);
			fs.writeFileSync(planFile, planSource);
		}
	} catch (error) {
		for (const [target, contents] of originals) fs.writeFileSync(target, contents);
		throw error;
	}
	return () => {
		for (const [target, contents] of originals) fs.writeFileSync(target, contents);
	};
}
