// Report rendering for the publication-floor control (`dom-attach-floor.mjs`).
//
// Separate from the probe so a finished run can be re-rendered from its frozen
// samples: the verdict is recomputed from the checked-in per-scale summaries,
// so a correction to how the claim is decided reaches the evidence already
// measured instead of costing another window.
//
//   node stages/dom-attach-report.mjs --label dom-attach-floor
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { DECIDING_PAIR, FLAT_DRIFT, LOCALIZING_PAIR, verdictFor } from './dom-attach-analyze.mjs';

const round = (value, digits = 1) => Number(value.toFixed(digits));

/**
 * Render one run's report. `meta` and `scales` come from the run; the verdict is
 * recomputed here rather than read from the file, so re-rendering an older run
 * decides it under the current rules.
 */
export function renderFloorReport(meta, perScale) {
	const ARMS = meta.arms;
	const scales = perScale.map((scale) => scale.rows);
	const verdict = verdictFor(perScale, ARMS);
	const { deciding, drifts, localizing, rates } = verdict;
	const loadStart = meta.loadStart;
	const lines = [
		'# Publication floor — what the platform charges to attach a first screen',
		'',
		`- measured: ${meta.date}`,
		`- host: ${meta.cpus}× ${meta.cpuModel}; ${meta.platform} ${meta.release}; Node ${meta.node}; Chromium ${meta.chromium}`,
		`- host load: start ${loadStart.map((value) => value.toFixed(2)).join('/')} (1/5/15m), end ${meta.loadEnd.map((value) => value.toFixed(2)).join('/')}`,
		`- repetitions: n=${meta.repetitions} per arm per scale; arms: ${ARMS.join(', ')}`,
		`- protocol: ${meta.protocol}`,
		'',
		'## What this controls for',
		'',
		"#148 W2 resolved publication's share into a swap plus a rate. The swap is exact — a detached first screen pays its insertions inside `papi_flush` where the post-mount path pays the identical insertions inside `papi_topology` — and what survives it is a per-node rate that rises with the tree on the first-screen path while staying flat on the post-mount one. This probe asks whether the browser reproduces that split with no framework in the page.",
		'',
		'Nothing measured here belongs to Octane or to web-core. `__AppendElement` is `parent.appendChild(child)` and the first flush publishes with `rootDom.appendChild(page)` on a shadow root, so the arms below are those two calls and nothing else. The tree is built with the tag names, per-row shape, attributes, class names, and scoped stylesheet `createElementAPI.js` produces, so the browser resolves the same styles over the same unregistered elements.',
		'',
		'| arm | what it does |',
		'|---|---|',
		'| `build` | every node created and linked within its row, nothing ever attached — the allocation floor every other arm also pays |',
		'| `live-incremental` | rows created and appended one at a time into a container already in the document — the post-mount shape |',
		'| `live-bulk` | rows created and appended one at a time into a detached container, then one `appendChild` publishes the tree — the first-screen shape |',
		'| `split-incremental` | every row built first, then all of them appended into an attached container |',
		'| `split-bulk` | every row built first, then all of them appended into a detached container, then one `appendChild` publishes it |',
		'',
		'`frameMs` is the next animation frame with a forced layout read, so style and layout are inside the measurement rather than after it. It is reported beside the command cost and never folded into it: the rate this control has to explain is `papi_topology (+ papi_flush)` self time, which is time inside `appendChild` and contains no style, layout, or paint. The verdict therefore reads command cost, and the reading registered before the run — command plus frame — is printed at the end so the two can be compared.',
		'',
		'The two pairs answer the same question at different costs. `live-*` interleaves creation and attachment exactly as the command stream does, so it needs no deviation from what Octane pays and its whole loop is comparable to `papi_topology` — plus `papi_flush` on the bulk side. It cannot separate attachment from creation without a clock read per append, so its rate is the loop plus the frame. `split-*` buys a separable `attachMs` by building first and attaching second, which the command stream never does; it localizes whatever the live pair finds and can never overturn it.',
		'',
		'The deciding pair is therefore `' +
			DECIDING_PAIR.incremental +
			'` against `' +
			DECIDING_PAIR.bulk +
			'`, with `' +
			LOCALIZING_PAIR.incremental +
			'`/`' +
			LOCALIZING_PAIR.bulk +
			'` reported beside it as corroboration.',
		'',
	];

	for (const [index, scale] of perScale.entries()) {
		lines.push(
			`## ${scale.rows.toLocaleString('en-US')} rows — ${scale.arms.build.nodes.toLocaleString('en-US')} nodes`,
			'',
		);
		lines.push(
			// The last two columns come from the same functions the verdict reads,
			// rather than being recomputed here. `command` is what the stream itself
			// pays — a live arm's whole loop, a split arm's attach span — and the
			// frame is kept beside it rather than folded in.
			'| arm | build ms | attach ms | frame ms | total ms | command µs/node | frame µs/node |',
			'|---|---:|---:|---:|---:|---:|---:|',
		);
		for (const arm of ARMS) {
			const summary = scale.arms[arm];
			lines.push(
				`| \`${arm}\` | ${round(summary.spans.buildMs.median)} | ${round(summary.spans.attachMs.median)} | ${round(summary.spans.frameMs.median)} | ${round(summary.spans.totalMs.median)} | ${round(rates[arm][index], 3)} | ${round(verdict.frames[arm][index], 2)} |`,
			);
		}
		lines.push('');
	}

	lines.push('## Does the platform reproduce the split?', '');
	lines.push(
		'Command cost per node — what the stream pays inside the calls it makes, with the frame held out. `build` is omitted: it attaches nothing, so it has no command rate to compare.',
		'',
	);
	const scaleColumns = scales.map((rows) => `${rows.toLocaleString('en-US')} µs/node`).join(' | ');
	lines.push(
		`| arm | ${scaleColumns} | drift | trend | flat |`,
		'|---|' + scales.map(() => '---:').join('|') + '|---:|---:|---|',
	);
	const paired = ARMS.filter((arm) => arm !== 'build');
	for (const arm of paired) {
		const armDrift = drifts[arm];
		const armTrend = verdict.trends[arm];
		lines.push(
			`| \`${arm}\` | ${rates[arm].map((rate) => round(rate, 3)).join(' | ')} | ${armDrift === null ? 'n/a' : `${round(armDrift * 100)}%`} | ${armTrend === null ? 'n/a' : `${armTrend > 0 ? '+' : ''}${round(armTrend * 100)}%`} | ${armDrift === null ? 'n/a' : armDrift <= FLAT_DRIFT ? 'yes' : 'no'} |`,
		);
	}
	lines.push('');
	// The prediction as one number: does the detached shape cost more than the
	// attached one? Drifts describe each arm on its own; this compares them.
	lines.push(
		`| pair | ${scaleColumns.replaceAll('µs/node', 'bulk ÷ incremental')} | gap opens |`,
		'|---|' + scales.map(() => '---:').join('|') + '|---|',
	);
	for (const [role, result] of [
		['deciding', deciding],
		['localizing', localizing],
	]) {
		lines.push(
			`| ${role} (\`${result.pair.incremental.replace(/-incremental$/, '-*')}\`) | ${result.gaps.length === 0 ? scales.map(() => 'n/a').join(' | ') : result.gaps.map((gap) => `${round(gap, 3)}×`).join(' | ')} | ${result.evaluable ? (result.gapOpens ? 'yes' : 'no') : 'n/a'} |`,
		);
	}
	lines.push('');

	const percent = (value) => (value === null ? 'n/a' : `${round(value * 100)}%`);
	const gate = round(FLAT_DRIFT * 100, 0);
	const pairVerdict = (result, role) => {
		const incremental = percent(drifts[result.pair.incremental]);
		const bulk = percent(drifts[result.pair.bulk]);
		if (!result.evaluable) {
			return `**Not evaluable (${role} pair).** A drift needs at least two scales and this run measured ${scales.length}, so \`${result.pair.incremental}\` against \`${result.pair.bulk}\` neither confirms nor refutes the prediction.`;
		}
		const widest = round(Math.max(...result.gaps), 3);
		return result.predictionConfirmed
			? `**Prediction confirmed (${role} pair).** \`${result.pair.incremental}\` is flat at ${incremental} drift, inside the ${gate}% gate, while \`${result.pair.bulk}\` rises ${percent(verdict.trends[result.pair.bulk])} across the range, opening a gap of up to ${widest}× — with no framework in the page.`
			: [
					`**Prediction refuted (${role} pair).** The prediction needs \`${result.pair.incremental}\` flat and \`${result.pair.bulk}\` rising.`,
					result.incrementalFlat
						? `Incremental is flat, at ${incremental} drift.`
						: `Incremental is not flat: it drifts ${incremental}, outside the ${gate}% gate.`,
					result.bulkRising
						? `Bulk does rise, by ${percent(verdict.trends[result.pair.bulk])} across the range.`
						: `Bulk does not rise: its trend across the range is ${percent(verdict.trends[result.pair.bulk])}, against a ${gate}% gate, on a ${bulk} drift.`,
					// Both arms moving the same way is the refutation this control was
					// built to be able to reach, so it is named rather than left to be
					// inferred from two drifts.
					!result.incrementalFlat && result.bulkRising
						? 'Both arms rise together, which is a cost that grows with the tree on either shape — not a cost the detached shape pays and the attached one does not.'
						: '',
					result.gapOpens
						? `The widest gap between them is ${widest}×.`
						: `The two arms never separate: the widest gap between them is ${widest}×.`,
				]
					.filter(Boolean)
					.join(' ');
	};

	lines.push(pairVerdict(deciding, 'deciding'), '', pairVerdict(localizing, 'localizing'), '');
	// Nothing is said about agreement when a pair was not decided: two undecided
	// pairs are not two pairs that agree, and the sentences above already said so.
	if (verdict.pairsAgree !== null) {
		lines.push(
			verdict.pairsAgree
				? 'Both pairs land the same way, so the deviation the localizing pair carries changes nothing about the answer.'
				: "The pairs disagree, and the deciding one stands: it measures in the command stream's own interleaved shape, while the localizing pair pays a deviation — every row built before any is attached — that the command stream never pays. The disagreement is a finding about where the cost sits and is recorded rather than averaged away.",
			'',
		);
	}
	lines.push(
		!deciding.evaluable
			? 'W2 stays open: this run decided nothing. The rates above stand as measured.'
			: deciding.predictionConfirmed
				? "Publication's residue on the first-screen path is the platform's own cost for attaching a large tree in one call, and W2 closes under #148's second oracle branch."
				: "Publication's rise is not the platform's, so it belongs to web-core or to Octane with a named owner. W2 stays open.",
	);
	lines.push('');
	// The registered reading, printed rather than dropped: the run was designed
	// around it, and a reader must be able to see that both readings agree.
	lines.push(
		'### The reading registered before the run',
		'',
		`Command cost plus the frame, which is how the deciding rate was defined when the prediction was registered. It is reported and not used: on this host the frame is the larger part by an order of magnitude, so it decides any verdict it enters, and the rate this control exists to explain — \`papi_topology (+ papi_flush)\` self time — contains no frame at all. Both readings are shown so the substitution can be checked rather than taken on trust.`,
		'',
		`| arm | ${scaleColumns} | drift |`,
		'|---|' + scales.map(() => '---:').join('|') + '|---:|',
	);
	for (const arm of paired) {
		lines.push(
			`| \`${arm}\` | ${verdict.registered[arm].map((rate) => round(rate, 2)).join(' | ')} | ${percent(verdict.registeredDrifts[arm])} |`,
		);
	}
	lines.push(
		'',
		'The frame is measured with a forced layout read on the next animation frame, so the whole tree is laid out inside it. First contentful paint does not require that, so this frame is an upper bound on what a first screen pays before FCP, not a transfer of it.',
		'',
		'Milliseconds here are host-bound and belong to this window only. The µs/node rates and the drift across scales are the portable claims.',
	);

	return lines.join('\n');
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	const { values: args } = parseArgs({
		options: { label: { type: 'string', default: 'dom-attach-floor' } },
	});
	const stem = args.label.trim();
	if (!/^[a-z0-9][a-z0-9-]*$/.test(stem)) {
		throw new TypeError('--label must be lowercase alphanumeric with dashes.');
	}
	const output = path.join(import.meta.dirname, 'results');
	const file = path.join(output, `${stem}.json`);
	const run = JSON.parse(fs.readFileSync(file, 'utf8'));
	const text = renderFloorReport(run.meta, run.scales);
	fs.writeFileSync(path.join(output, `${stem}.md`), text + '\n');
	// The verdict travels with the samples, so a re-render refreshes it too;
	// leaving the stale one in the JSON beside a corrected report would let the
	// two disagree.
	run.verdict = verdictFor(run.scales, run.meta.arms);
	fs.writeFileSync(file, JSON.stringify(run, null, 2) + '\n');
	console.log(text);
}
