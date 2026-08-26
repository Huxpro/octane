import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

import { analyzeMessages, parseLogMessages } from './analyze.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
const outputFile = path.join(
	repositoryRoot,
	'benchmarks/lynx-table/stages/results/lepus-cost-m1-v8-context-2026-08-26.json',
);
const variants = [
	{ phase: 'M1-dispatch-property', file: 'runtime.js' },
	{ phase: 'M1-allocation-string-branch', file: 'runtime-m1b.js' },
];

function sha256(source) {
	return crypto.createHash('sha256').update(source).digest('hex');
}

function runVariant(source, filename) {
	let log = '';
	const console = {
		info(value) {
			log += `${String(value)}\n`;
		},
	};
	const sandbox = {
		console,
		performance,
		__CreateView(pageId) {
			return { pageId, id: 1, attributes: Object.create(null) };
		},
		__GetElementUniqueID(node) {
			return node.id;
		},
		__SetAttribute(node, name, value) {
			node.attributes[name] = value;
		},
		__lepus_version__() {
			return `V8 ${process.versions.v8}`;
		},
	};
	const context = vm.createContext(sandbox, { name: 'octane-lepus-cost-v8-context' });
	// First execution warms this V8 context. Only the second execution is kept.
	vm.runInContext(source, context, { filename });
	log = '';
	vm.runInContext(source, context, { filename });
	const messages = parseLogMessages(log);
	const fatal = messages.find((message) => message.type === 'fatal');
	if (fatal) throw new Error(`${filename}: ${fatal.message}`);
	return { messages, analysis: analyzeMessages(messages) };
}

const startedAt = new Date().toISOString();
const phases = variants.map(({ phase, file }) => {
	const source = fs.readFileSync(path.join(import.meta.dirname, file), 'utf8');
	const result = runVariant(source, file);
	return {
		phase,
		source: { file: `benchmarks/lynx-table/stages/lepus-cost/${file}`, sha256: sha256(source) },
		runtime: result.analysis.meta,
		fullSamples: result.messages.filter((message) => message.type === 'sample'),
		analysis: {
			sampleCount: result.analysis.sampleCount,
			rows: result.analysis.rows,
		},
	};
});

const record = {
	schema: 'octane.lepus-cost.v8-context.v1',
	issue: 'https://github.com/Huxpro/octane/issues/196',
	protocol: 'https://github.com/Huxpro/octane/issues/194',
	phase: 'M1-v8-context',
	window: { startedAt, endedAt: new Date().toISOString() },
	engine: {
		name: 'V8',
		v8Version: process.versions.v8,
		nodeVersion: process.version,
		platform: process.platform,
		arch: process.arch,
	},
	protocolChecks: {
		repetitions: 5,
		abBa: true,
		callsBeforeIdentity: true,
		warmupExecutionsDiscardedPerPhase: 1,
	},
	scope: {
		decisionUse: 'context-only',
		hostPapiRowsComparable: false,
		reason:
			'V8 host globals are JavaScript mocks, not Lynx Element PAPI FFI. This run is never used for device decisions or M2 predictions.',
	},
	phases,
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(record, null, 2)}\n`);
console.log(outputFile);
