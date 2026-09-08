import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '../app/src');
const app = fs.readFileSync(path.join(appRoot, 'App.lynx.tsrx'), 'utf8');
const entry = fs.readFileSync(path.join(appRoot, 'index.ts'), 'utf8');

function nestedBlock(source, anchor) {
	const anchorStart = source.indexOf(anchor);
	assert.notEqual(anchorStart, -1, `missing block anchor: ${anchor}`);
	const blockStart = source.indexOf('{', anchorStart + anchor.length);
	assert.notEqual(blockStart, -1, `missing block start after: ${anchor}`);
	let depth = 0;
	for (let index = blockStart; index < source.length; index++) {
		if (source[index] === '{') depth++;
		if (source[index] !== '}') continue;
		depth--;
		if (depth === 0) return source.slice(blockStart + 1, index);
	}
	assert.fail(`missing block end after: ${anchor}`);
}

test('Native benchmark source does not construct unavailable Web scheduling globals', () => {
	assert.match(app, /typeof MessageChannel === 'function' \? new MessageChannel\(\) : null/);
	const nativeSchedule = nestedBlock(app, 'if (_stormChannel === null)');
	assert.match(nativeSchedule, /lynx\.setTimeout\(cb, 0\)/);
	assert.doesNotMatch(nativeSchedule, /(?<!\.)\bsetTimeout\(/);
});

test('Native tap receipt encloses action, transport ACK, two frames, and semantic state', () => {
	const measurement = nestedBlock(app, 'function measureNative(');
	const start = measurement.indexOf('const startMs = Date.now()');
	const action = measurement.indexOf('action()');
	const flush = measurement.indexOf('stormEvidence) => flush().then');
	const firstFrame = measurement.indexOf('nextNativeFrame()');
	const secondFrame = measurement.indexOf('nextNativeFrame()', firstFrame + 1);
	const postState = measurement.indexOf('__LYNX_BENCH_SNAPSHOT__?.()', secondFrame);
	const publication = measurement.indexOf("'__NATIVE_BENCH_RESULT__'", postState);

	assert.ok(start !== -1 && start < action);
	assert.ok(action < flush && flush < firstFrame && firstFrame < secondFrame);
	assert.ok(secondFrame < postState && postState < publication);
	assert.match(measurement, /protocol: 'lynx-native-bench-v2'/);
	assert.match(measurement, /kind: 'octane-root\.flushTransport'/);
	assert.match(measurement, /boundary: 'native-input-handler-to-second-native-frame'/);
	assert.match(measurement, /preState,/);
	assert.match(measurement, /postState,/);
	assert.match(measurement, /stormEvidence === undefined/);
});

test('Native storms await every transport ACK and frame before publishing tick evidence', () => {
	const storm = nestedBlock(app, 'function runStorm(');
	const native = nestedBlock(storm, 'if (_stormChannel === null)');
	const loop = nestedBlock(native, 'for (let tick = 1; tick <= ticks; tick++)');
	const task = loop.indexOf('await new Promise<void>');
	const step = loop.indexOf('step(tick)');
	const flush = loop.indexOf('await flush()');
	const completed = loop.indexOf('completedTicks = tick');
	const frame = loop.indexOf('await nextNativeFrame()');
	const barrier = loop.indexOf('renderBarriers++');

	assert.ok(task !== -1 && task < step && step < flush);
	assert.ok(flush < completed && completed < frame && frame < barrier);
	assert.match(native, /expectedTicks: ticks, completedTicks, renderBarriers/);
	assert.match(app, /tickAcknowledgements: stormEvidence\.completedTicks/);
	assert.match(app, /const stormUpdate = useCallback\(\(\) => \{\s*return runStorm\(/);
	assert.match(app, /const stormSelect = useCallback\(\(\) => \{\s*return runStorm\(/);
	assert.match(app, /measureNativeTap\('updateStorm', stormUpdate\)/);
	assert.match(app, /measureNativeTap\('selectStorm', stormSelect\)/);
});

test('Native startup receipt is emitted only after render ACK, two frames, and state', () => {
	const background = nestedBlock(entry, "if (rendered !== null && typeof rendered === 'object'");
	const renderAck = nestedBlock(background, 'void rendered.then(');
	const firstFrame = nestedBlock(renderAck, 'lynx.requestAnimationFrame(');
	const secondFrame = nestedBlock(firstFrame, 'lynx.requestAnimationFrame(');

	assert.match(renderAck, /commitAckMs = Date\.now\(\)/);
	assert.match(secondFrame, /__LYNX_BENCH_SNAPSHOT__\?\.\(\)/);
	assert.match(secondFrame, /protocol: 'lynx-native-startup-v1'/);
	assert.match(secondFrame, /kind: 'octane-root\.render'/);
	assert.match(secondFrame, /__LYNX_BENCH_STARTUP__ = receipt/);
	assert.match(secondFrame, /'__NATIVE_BENCH_STARTUP__'/);
	assert.equal((entry.match(/__LYNX_BENCH_STARTUP__ = receipt/g) ?? []).length, 1);
});
