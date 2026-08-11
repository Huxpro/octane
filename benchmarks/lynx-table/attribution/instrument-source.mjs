import fs from 'node:fs';
import path from 'node:path';

function replaceOnce(source, search, replacement, file) {
	const first = source.indexOf(search);
	if (first === -1)
		throw new Error(`attribution anchor missing in ${file}: ${search.slice(0, 80)}`);
	if (source.indexOf(search, first + search.length) !== -1) {
		throw new Error(`attribution anchor is ambiguous in ${file}: ${search.slice(0, 80)}`);
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
			`function attributionCount(name: string, amount = 1): void {
\tconst globals = globalThis as any;
\tconst profile = (globals.__OCTANE_LYNX_ATTRIBUTION__ ??= Object.create(null));
\tprofile[name] = (profile[name] ?? 0) + amount;
}

function attributionDuration(name: string, started: number): void {
\tattributionCount(name, performance.now() - started);
}

let ATTRIBUTION_EXECUTE_OWNER_DEPTH = 0;

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
\tattributionCount('planValues');
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
\tattributionCount('propPrograms');
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
\tattributionCount('ownerDrafts');
\treturn {
`,
			file,
		);
		source = replaceOnce(
			source,
			'function createLogicalRecord(id: number, blueprint: BlueprintNode): LogicalRecord {\n\treturn {\n',
			"function createLogicalRecord(id: number, blueprint: BlueprintNode): LogicalRecord {\n\tattributionCount('logicalRecords');\n\treturn {\n",
			file,
		);
		source = replaceOnce(
			source,
			`\treturn [
\t\t{
\t\t\tkind: 'host',
`,
			`\tattributionCount('blueprintHosts');
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
\tattributionCount('planMaterializations');
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
\tconst attributionOuterOwner = ATTRIBUTION_EXECUTE_OWNER_DEPTH++ === 0;
\tconst attributionOwnerStarted = attributionOuterOwner ? performance.now() : 0;
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
\t\tATTRIBUTION_EXECUTE_OWNER_DEPTH--;
\t\tif (attributionOuterOwner) attributionDuration('ownerMaterializationMs', attributionOwnerStarted);
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
			if (body === -1) throw new Error(`attribution lazy-leaf body missing in ${file}.`);
			source =
				source.slice(0, body + 3) +
				"\tattributionCount('forItemCallbacks');\n" +
				source.slice(body + 3);
		}
		const directListRender = `\t\t\t\toutput.push(
\t\t\t\t\t...materializeScoped(parent, [...path, 'for'], itemKey, () =>
\t\t\t\t\t\tlist.render(item, itemIndex),
`;
		const materializedListRender = `\t\t\t\toutput.push(
\t\t\t\t\t...materializeScoped(parent, [...path, 'for'], itemKey, () => {
\t\t\t\t\t\treturn materializeRawUniversalListValue(
`;
		if (source.includes(directListRender)) {
			source = replaceOnce(
				source,
				directListRender,
				`\t\t\t\toutput.push(
\t\t\t\t\t...materializeScoped(parent, [...path, 'for'], itemKey, () => {
\t\t\t\t\t\tattributionCount('forItemCallbacks');
\t\t\t\t\t\treturn list.render(item, itemIndex);
\t\t\t\t\t},
`,
				file,
			);
		} else {
			source = replaceOnce(
				source,
				materializedListRender,
				`\t\t\t\toutput.push(
\t\t\t\t\t...materializeScoped(parent, [...path, 'for'], itemKey, () => {
\t\t\t\t\t\tattributionCount('forItemCallbacks');
\t\t\t\t\t\treturn materializeRawUniversalListValue(
`,
				file,
			);
		}
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
\tattributionCount('cloneVisits');
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
\tattributionCount('commands', commands.length);
\tattributionCount('frozenObjects', commands.length + 2);
${hasPlanInstances ? "\tattributionCount('planInstances', planInstances?.length ?? 0);\n" : ''}\tfor (const command of commands) {
`,
			file,
		);
		source = replaceOnce(
			source,
			`\t): UniversalTransactionImpl<Container, PublicInstance> {
\t\tlet nextId = this.nextId;
`,
			`\t): UniversalTransactionImpl<Container, PublicInstance> {
\t\tconst attributionTransactionStarted = performance.now();
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
			`\t\tattributionDuration('transactionStagingMs', attributionTransactionStarted);
\t\treturn transaction;
\t}

\tfinish(transaction: UniversalTransactionImpl<Container, PublicInstance>): void {
`,
			file,
		);
		fs.writeFileSync(file, source);

		// P5 made total bidirectional message count/bytes permanent profile fields.
		// Inject the same build-flag-gated counters into older comparison targets,
		// so an exact parent SHA and the candidate use one measurement boundary.
		const profileFile = path.join(repositoryRoot, 'packages/lynx/src/core/profiling.ts');
		const profileOriginal = fs.readFileSync(profileFile, 'utf8');
		originals.set(profileFile, profileOriginal);
		if (!profileOriginal.includes('\tmessageBytes: number;')) {
			let profileSource = profileOriginal;
			profileSource = replaceOnce(
				profileSource,
				'export interface LynxWireProfile {\n\t/** Commit messages dispatched (background) or applied (main). */\n',
				`export interface LynxWireProfile {
\t/** All messages dispatched by this realm, in either protocol direction. */
\tmessages: number;
\t/** JSON size of every dispatched message, as a structured-clone-cost proxy. */
\tmessageBytes: number;
\t/** Commit messages dispatched (background) or applied (main). */
`,
				profileFile,
			);
			profileSource = replaceOnce(
				profileSource,
				'\treturn (globals.__OCTANE_LYNX_PROF ??= {\n\t\tcommits: 0,\n',
				`\treturn (globals.__OCTANE_LYNX_PROF ??= {
\t\tmessages: 0,
\t\tmessageBytes: 0,
\t\tcommits: 0,
`,
				profileFile,
			);
			profileSource = replaceOnce(
				profileSource,
				`\tif (record.type !== 'commit') return;
\tprofile.commits += 1;
\tif (record.pace === true) profile.pacedCommits += 1;
\tprofile.commands += record.batch?.commands?.length ?? 0;
\ttry {
\t\tprofile.bytes += JSON.stringify(message).length;
\t} catch {
\t\t// Wire messages are serializable by contract; a failure here must not
\t\t// turn a measurement run into a commit failure.
\t}
`,
				`\tprofile.messages += 1;
\tlet serializedBytes = 0;
\ttry {
\t\tserializedBytes = JSON.stringify(message).length;
\t\tprofile.messageBytes += serializedBytes;
\t} catch {
\t\t// Measurement must not turn a dispatch into a failure.
\t}
\tif (record.type !== 'commit') return;
\tprofile.commits += 1;
\tif (record.pace === true) profile.pacedCommits += 1;
\tprofile.commands += record.batch?.commands?.length ?? 0;
\tprofile.bytes += serializedBytes;
`,
				profileFile,
			);
			fs.writeFileSync(profileFile, profileSource);

			const mainFile = path.join(repositoryRoot, 'packages/lynx/src/main-thread.ts');
			const mainOriginal = fs.readFileSync(mainFile, 'utf8');
			originals.set(mainFile, mainOriginal);
			let mainSource = replaceOnce(
				mainOriginal,
				"import { LYNX_PROFILE, lynxWireProfile } from './core/profiling.js';",
				"import { LYNX_PROFILE, lynxWireProfile, profileOutboundMessage } from './core/profiling.js';",
				mainFile,
			);
			mainSource = replaceOnce(
				mainSource,
				`\tconst dispatch = (message: LynxBackgroundInboundMessage): void => {
\t\tconst validated = selfCheckLynxBackgroundInboundMessage(message);
\t\tcontext.dispatchEvent({ type: LYNX_MAIN_TO_BACKGROUND_EVENT, data: validated });
\t};
`,
				`\tconst dispatch = (message: LynxBackgroundInboundMessage): void => {
\t\tconst validated = selfCheckLynxBackgroundInboundMessage(message);
\t\tcontext.dispatchEvent({ type: LYNX_MAIN_TO_BACKGROUND_EVENT, data: validated });
\t\tif (LYNX_PROFILE) profileOutboundMessage(lynxWireProfile(), message);
\t};
`,
				mainFile,
			);
			fs.writeFileSync(mainFile, mainSource);
		}

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
\tconst attributionPlanFoldStarted = performance.now();
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
\t\tconst profile = (globals.__OCTANE_LYNX_ATTRIBUTION__ ??= Object.create(null));
\t\tprofile.planFoldingMs =
\t\t\t(profile.planFoldingMs ?? 0) + performance.now() - attributionPlanFoldStarted;
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
