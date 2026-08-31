// Renders the Element PAPI boundary report from frozen evidence.
//
//   node stages/papi-report.mjs                       # from results/papi-*.json
//   node stages/papi-report.mjs --scales 1000,10000
//
// `papi-run.mjs` measures and writes the evidence; this module decides how it
// reads. Keeping them apart means a wording or attribution change is a
// re-render of checked-in data, never a re-measurement, and anyone can re-derive
// every table in the report from the JSON beside it.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { FIRST_SCREEN_PHASES, requireOutputStem } from './papi-analyze.mjs';

function round(value, digits = 2) {
	return value === null || value === undefined ? null : Number(value.toFixed(digits));
}

function integer(value) {
	return value === null || value === undefined ? '—' : value.toLocaleString('en-US');
}

function ratio(overhead) {
	return overhead.ratio === null ? 'n/a' : `${round(overhead.ratio, 3)}×`;
}

function controlWall(window) {
	return window.overhead.timed.control.median;
}

/**
 * Octane renders the same table two ways: the first screen materializes it
 * during mount, and the create click materializes it after mount. Both end in
 * the same composed tree measured by the same driver, so the difference between
 * them is an internal control with no cross-framework confound at all — the
 * strongest evidence available for a publication-op-count claim.
 */
export function firstScreenControl(scale) {
	const cell = scale.cells.octane;
	// A run measured without the octane cell has no internal control to render.
	if (cell === undefined || !cell.fcp.measured) return null;
	const composedControlMs = controlWall(cell.startup) + controlWall(cell.create);
	const composedCountsMs = cell.startup.counts.total.median + cell.create.counts.total.median;
	const composedCalls =
		cell.startup.counts.counts.calls.median + cell.create.counts.counts.calls.median;
	const fcpCalls = cell.fcp.counts.counts.calls.median;
	const kinds = new Set([
		...Object.keys(cell.fcp.counts.counts.byKind),
		...Object.keys(cell.create.counts.counts.byKind),
	]);
	const byKind = [...kinds]
		.map((kind) => ({
			kind,
			firstScreen: cell.fcp.counts.counts.byKind[kind]?.median ?? 0,
			create: cell.create.counts.counts.byKind[kind]?.median ?? 0,
		}))
		.map((entry) => ({ ...entry, delta: entry.firstScreen - entry.create }))
		.sort((left, right) => right.delta - left.delta || left.kind.localeCompare(right.kind));
	const stageNames = new Set([
		...Object.keys(cell.fcp.timed.stages),
		...Object.keys(cell.create.timed.stages),
	]);
	const byStage = [...stageNames].map((name) => ({
		stage: name,
		firstScreen: cell.fcp.timed.stages[name]?.median ?? 0,
		create: cell.create.timed.stages[name]?.median ?? 0,
		delta:
			(cell.fcp.timed.stages[name]?.median ?? 0) - (cell.create.timed.stages[name]?.median ?? 0),
	}));
	return {
		rows: scale.rows,
		composedControlMs,
		composedCountsMs,
		directControlMs: controlWall(cell.fcp),
		directCountsMs: cell.fcp.counts.total.median,
		excessControlMs: controlWall(cell.fcp) - composedControlMs,
		excessCountsMs: cell.fcp.counts.total.median - composedCountsMs,
		composedCalls,
		fcpCalls,
		excessCalls: fcpCalls - composedCalls,
		excessCallsPerRow: (fcpCalls - composedCalls) / scale.rows,
		firstScreenCallsPerRow: cell.fcp.counts.opsPerRow,
		createCallsPerRow: cell.create.counts.opsPerRow,
		firstScreenFlushes: cell.fcp.counts.counts.flushCount.median,
		createFlushes: cell.create.counts.counts.flushCount.median,
		byKind,
		byStage,
	};
}

/**
 * Every reference cell's FCP@N is a projection, not a measurement: the vendored
 * bundles carry no pre-populated first screen. Composing a cell's own startup
 * and create windows is the only comparison the vendored artifacts support, and
 * Octane — which has both the direct and the composed value — is the check on
 * how far the composition sits from the real thing.
 */
export function projectedFcp(scale) {
	const rowsLabel = scale.rows;
	return Object.keys(scale.cells).map((id) => {
		const cell = scale.cells[id];
		const projectedMs = controlWall(cell.startup) + controlWall(cell.create);
		return {
			cell: id,
			rows: rowsLabel,
			projectedMs,
			directMs: cell.fcp.measured ? controlWall(cell.fcp) : null,
			errorMs: cell.fcp.measured ? controlWall(cell.fcp) - projectedMs : null,
			callsPerRow: cell.create.counts.opsPerRow,
			directCallsPerRow: cell.fcp.measured ? cell.fcp.counts.opsPerRow : null,
		};
	});
}

/**
 * A profile build carries the phase marker a shipping build folds away, so its
 * milliseconds are a different configuration and no ratio may be taken across
 * the two — `run-web.mjs` already withholds one between a profiled and a
 * non-profiled cell for exactly this reason. What licenses reading the split as
 * the shipping build's is not an assertion that the probe is free but a
 * measurement of it: both cells run in the same window, and their first-screen
 * walls are reported side by side on the uninstrumented control pages.
 *
 * The bias has a known direction. The probe's own cost lands inside Octane's
 * phases, never in the residue, so any residual inflation over-attributes to the
 * framework and under-attributes to the browser — which can only make Octane
 * look worse than it is.
 */
const PROFILE_SUFFIX = '-profile';

export function profileTransfer(scale, profiledId = 'octane-profile') {
	// A profile cell's shipping counterpart is its own id without the suffix.
	// Naming the pair by convention rather than by a table is what lets a run
	// carry more than one: issue #163 needs `octane-mts-program-profile` read
	// against `octane-mts-program`, not against `octane`, because a split is
	// only licensed by the wall clock of the build it was measured beside.
	if (!profiledId.endsWith(PROFILE_SUFFIX)) return null;
	const shippingId = profiledId.slice(0, -PROFILE_SUFFIX.length);
	const shipping = scale.cells[shippingId];
	const profiled = scale.cells[profiledId];
	// The report module re-renders any frozen JSON handed to it, so evidence
	// without the shipping cell degrades to "no transfer" like the sibling
	// firstScreenControl, rather than crashing on the dereference.
	if (shipping === undefined || profiled === undefined) return null;
	if (!shipping.fcp.measured || !profiled.fcp.measured) return null;
	const split = profiled.fcp.timed.firstScreen ?? null;
	if (split === null) {
		// A measured profile cell with no split is a broken probe, not an absent
		// feature. The likeliest cause is the cross-realm one: the marker is written
		// on the main-thread script realm's global and has to be read through the
		// install target, so a probe reading the page realm's own global finds
		// nothing and reports every phase as absent. Rendering that as a missing
		// section would publish the failure as silence.
		throw new Error(
			`the ${profiledId} cell measured an FCP window but carried no first-screen split: the probe read no profile record.`,
		);
	}
	const shippingMs = controlWall(shipping.fcp);
	const profiledMs = controlWall(profiled.fcp);
	return {
		profiledId,
		shippingId,
		shippingMs,
		profiledMs,
		deltaMs: profiledMs - shippingMs,
		spread: shippingMs === 0 ? null : profiledMs / shippingMs - 1,
		shippingOffBoundaryMs: shipping.fcp.timed.stages.off_boundary?.median ?? 0,
		profiledOffBoundaryMs: profiled.fcp.timed.stages.off_boundary?.median ?? 0,
		split,
	};
}

/** Every profile cell in a run, in the order the run declared them. */
export function profiledCellIds(meta) {
	return meta.cells.filter((id) => id.endsWith(PROFILE_SUFFIX));
}

function countTable(scale, cellIds) {
	const kinds = new Set();
	for (const id of cellIds) {
		for (const name of Object.keys(scale.cells[id].create.counts.counts.byKind)) kinds.add(name);
	}
	const lines = [
		`| host call | ${cellIds.join(' | ')} |`,
		`|---|${cellIds.map(() => '---:').join('|')}|`,
	];
	for (const name of [...kinds].sort()) {
		const values = cellIds.map(
			(id) => scale.cells[id].create.counts.counts.byKind[name]?.median ?? 0,
		);
		if (values.every((value) => value === 0)) continue;
		lines.push(`| \`${name}\` | ${values.map(integer).join(' | ')} |`);
	}
	lines.push(
		`| **total host calls** | ${cellIds.map((id) => integer(scale.cells[id].create.counts.counts.calls.median)).join(' | ')} |`,
		`| **host calls per row** | ${cellIds.map((id) => round(scale.cells[id].create.counts.opsPerRow, 2)).join(' | ')} |`,
	);
	return lines;
}

function stageTable(summary) {
	const lines = ['| segment | median ms | min–max ms | share |', '|---|---:|---:|---:|'];
	for (const [name, stage] of Object.entries(summary.stages)) {
		lines.push(
			`| ${name} | ${round(stage.median)} | ${round(stage.min)}–${round(stage.max)} | ${(stage.share * 100).toFixed(1)}% |`,
		);
	}
	return lines;
}

/**
 * The first-screen phase split of `off_boundary`. Only a profile-built cell
 * carries one: the phase marker it reads folds away in a shipping bundle, which
 * is the whole point of the build flag.
 */
function firstScreenTable(split) {
	const lines = [
		'| first-screen phase | host calls | host self ms | off-boundary ms |',
		'|---|---:|---:|---:|',
	];
	for (const phase of FIRST_SCREEN_PHASES) {
		const entry = split.phases[phase];
		lines.push(
			`| ${phase} | ${integer(entry.calls.median)} | ${round(entry.selfMs.median, 1)} | ${round(entry.offBoundaryMs.median, 1)} |`,
		);
	}
	// Both totals are medians of their own samples, so they need not add to the
	// per-phase medians above; each row is reported as measured rather than
	// reconciled.
	lines.push(
		`| **Octane first-screen script** | — | — | ${round(split.frameworkMs.median, 1)} |`,
		`| **residue — web-core script and the browser frame** | — | — | ${round(split.residueMs.median, 1)} |`,
	);
	return lines;
}

function deltaTable(attributed) {
	const lines = [
		'| candidate owner | delta ms | share of delta | verdict | directly observed |',
		'|---|---:|---:|---|---|',
	];
	for (const owner of attributed.owners) {
		lines.push(
			`| ${owner.hypothesis} | ${round(owner.deltaMs, 1)} | ${owner.share === null ? 'n/a' : (owner.share * 100).toFixed(1) + '%'} | ${owner.verdict} | ${owner.evidence} |`,
		);
	}
	// The per-sample identity is exact, but each term above is a median and
	// medians do not add. Naming that residual as median non-additivity is the
	// honest reading; calling it unexplained physics would not be.
	lines.push(
		`| **median non-additivity** | ${round(attributed.unattributedMs, 2)} | ${(attributed.unattributedShare * 100).toFixed(1)}% | — | the identity is exact per sample; each owner above is a median of its own sample |`,
	);
	return lines;
}

// The heading names the cells the run actually carried. `--label` exists so a
// different cell set can be measured beside the checked-in baseline, and a
// heading pinned to the baseline's three cells captions those runs with cells
// they do not contain — which the checked-in `papi-firstscreen-boundary.md` did.
// An unknown id renders as itself rather than being dropped, so a new cell shows
// up in the heading before anyone remembers to name it here.
const CELL_HEADINGS = Object.freeze({
	octane: 'Octane',
	'octane-profile': 'Octane (profile build)',
	'octane-mts-program': 'Octane (main-thread program)',
	'octane-mts-program-profile': 'Octane (main-thread program, profile build)',
	'octane-direct': 'L0 direct-emission prototype',
	react: 'ReactLynx',
	'vue-vdom': 'Vue vdom+IFR+ET',
});

function headingFor(cells) {
	return cells.map((id) => CELL_HEADINGS[id] ?? id).join(' vs ');
}

export function renderBoundaryReport(scaleReports) {
	const first = scaleReports[0];
	const meta = first.meta;
	const cellIds = meta.cells;
	// One evaluation per scale, before the first line is emitted: the contract
	// prose below and the tables further down then cannot disagree about whether
	// this run carries a split, and a broken probe throws before a header claims
	// otherwise.
	// One entry per scale, holding every profile cell's transfer rather than a
	// single one, so a run that carries two profile builds reports two splits
	// instead of silently publishing whichever came first.
	const profiled = profiledCellIds(meta);
	const transfers = new Map(
		scaleReports.map((scale) => [
			scale.rows,
			profiled.map((id) => profileTransfer(scale, id)).filter((transfer) => transfer !== null),
		]),
	);
	const anySplit = [...transfers.values()].some((list) => list.length !== 0);
	const lines = [
		`# Element PAPI boundary decomposition — ${headingFor(meta.cells)}`,
		'',
		`- measured: ${meta.date}`,
		`- host: ${meta.cpus}× ${meta.cpuModel}; ${meta.platform} ${meta.release}; Node ${meta.node}; Chromium ${meta.chromium}; @lynx-js/web-core ${meta.webCore}`,
		`- host clock granularity: ${meta.clockGranularityMs === null ? 'unknown' : `${round(meta.clockGranularityMs, 4)} ms`}; a single host call is far below it, so only per-kind aggregates over many calls carry meaning`,
		`- host load: start ${meta.loadStart.map((value) => value.toFixed(2)).join('/')} (1/5/15m), end ${meta.loadEnd.map((value) => value.toFixed(2)).join('/')}`,
		`- repetitions: n=${meta.repetitions} per variant per cell; variants: ${meta.variants.join(', ')}`,
		`- protocol: ${meta.protocol}`,
		meta.referenceManifest === null
			? '- references: manifest missing'
			: `- references: ${meta.referenceManifest.source} @ ${meta.referenceManifest.commit}; the vendored bundles are used as built, and the probe changes no bundle byte`,
		'',
		'## Observation contract',
		'',
		'The probe wraps the single `Object.assign` with which `@lynx-js/web-core` installs the Element PAPI onto the hidden main-thread script realm, so it observes the host boundary rather than any framework. Every cell is measured by that identical instrument, and no bundle — including the vendored ReactLynx and Vue references — is modified or rebuilt.',
		'',
		'Each timed window obeys one identity:',
		'',
		'```',
		'wall = start_delay + Σ host-group self time + off_boundary',
		'```',
		'',
		"`start_delay` is the observed gap from the window's start boundary to the first host call. Each host group is directly observed and exclusive: a host call re-entered through a framework callback is counted once. `off_boundary` is the named exclusive remainder — framework script, the browser's own style, layout, paint, and observer-frame delay, and the timed probe's own bookkeeping — because the host exposes no boundary separating those. `__FlushElementTree` self time covers the synchronous publication Web Core performs inside it; the browser's layout and paint that follow it stay in `off_boundary`.",
		'',
		...(anySplit
			? [
					"`off_boundary` is a remainder for every cell, and on a profile-built Octane cell it splits further. The framework publishes which first-screen phase is running — render, publish, capture, announce — and the probe attributes each host call to the phase that issued it, so a phase's own off-boundary time is its wall span minus the host time observed inside it. What no phase claims is the residue: web-core's own script between host calls, plus the browser's style, layout, paint, and observer frame. The dependency runs one way — the framework publishes a marker and never reads the probe — and `render` crosses the boundary not at all, so its whole span is framework script by construction rather than by subtraction. The marker is compiled out of a shipping bundle, so the split is measured on a separate profile-built cell and no ratio is ever taken across the two builds.",
					'',
					"The residue is an upper bound on the platform's share rather than a measurement of it, though a tight one. Framework script before the first host call is `start_delay`, a separate term of the identity, so the bundle's own evaluation and most of the install are already excluded. What can still land in the residue is framework script inside the window but outside the four phases: whatever the entry does after the first screen returns, and any install work that follows the first host call. That is the flattering direction for Octane and the conservative one for a floor claim — a control built against this residue must beat a number that may still hold a little framework cost the split did not measure.",
					'',
				]
			: []),
		"Host call counts, flush cadence, and start delay are read from the counts build, whose wall clock carries no per-call clock reads. The timed build supplies host self time. Both builds count identically by construction, and the agreement is reported per cell as the control on the timed build's cost.",
		'',
		'Two window predicates differ and the difference is not corrected away: the create window resolves on a shallow scan of the row container, while the FCP window resolves on the composed-tree content count `stages/run.mjs` already uses. The FCP predicate is the more expensive walk, so an FCP window carries up to one polling frame of that walk that a create window does not. Host call counts are exact and carry no such term.',
		'',
	];
	for (const scale of scaleReports) {
		const rows = scale.rows;
		lines.push(`## ${rows.toLocaleString('en-US')} rows`, '');
		lines.push(`### Host call counts and flush cadence — create@${rows}`, '');
		lines.push(...countTable(scale, cellIds), '');
		lines.push(
			`| measure | ${cellIds.join(' | ')} |`,
			`|---|${cellIds.map(() => '---:').join('|')}|`,
			`| wall ms, control | ${cellIds.map((id) => round(controlWall(scale.cells[id].create), 1)).join(' | ')} |`,
			`| wall ms, counts build | ${cellIds.map((id) => round(scale.cells[id].create.counts.total.median, 1)).join(' | ')} |`,
			`| wall ms, timed build | ${cellIds.map((id) => round(scale.cells[id].create.timed.total.median, 1)).join(' | ')} |`,
			`| \`__FlushElementTree\` calls | ${cellIds.map((id) => scale.cells[id].create.counts.counts.flushCount.median).join(' | ')} |`,
			`| start delay ms | ${cellIds.map((id) => round(scale.cells[id].create.counts.startDelay.median, 1)).join(' | ')} |`,
			`| host op time ms, timed | ${cellIds.map((id) => round(scale.cells[id].create.timed.rates.opSelfMs, 1)).join(' | ')} |`,
			`| host ms per call, timed | ${cellIds.map((id) => round(scale.cells[id].create.timed.rates.msPerOp, 5)).join(' | ')} |`,
			`| flush time ms, timed | ${cellIds.map((id) => round(scale.cells[id].create.timed.rates.flushSelfMs, 2)).join(' | ')} |`,
			`| off-boundary ms, timed | ${cellIds.map((id) => round(scale.cells[id].create.timed.stages.off_boundary?.median ?? 0, 1)).join(' | ')} |`,
			`| counts-build overhead | ${cellIds.map((id) => ratio(scale.cells[id].create.overhead.counts)).join(' | ')} |`,
			`| timed-build overhead | ${cellIds.map((id) => ratio(scale.cells[id].create.overhead.timed)).join(' | ')} |`,
			`| counts agree across builds | ${cellIds.map((id) => (scale.cells[id].create.agreement.agree ? 'yes' : `no (${scale.cells[id].create.agreement.mismatches.length} kinds)`)).join(' | ')} |`,
			'',
		);
		lines.push('### Startup to first composed paint — app shell, no rows', '');
		lines.push(
			`| measure | ${cellIds.join(' | ')} |`,
			`|---|${cellIds.map(() => '---:').join('|')}|`,
			`| slice start → paint ms, control | ${cellIds.map((id) => round(controlWall(scale.cells[id].startup), 1)).join(' | ')} |`,
			`| slice start → paint ms, counts | ${cellIds.map((id) => round(scale.cells[id].startup.counts.total.median, 1)).join(' | ')} |`,
			`| start delay ms | ${cellIds.map((id) => round(scale.cells[id].startup.counts.startDelay.median, 1)).join(' | ')} |`,
			`| host calls | ${cellIds.map((id) => integer(scale.cells[id].startup.counts.counts.calls.median)).join(' | ')} |`,
			`| \`__FlushElementTree\` calls | ${cellIds.map((id) => scale.cells[id].startup.counts.counts.flushCount.median).join(' | ')} |`,
			`| host op time ms, timed | ${cellIds.map((id) => round(scale.cells[id].startup.timed.rates.opSelfMs, 1)).join(' | ')} |`,
			`| off-boundary ms, timed | ${cellIds.map((id) => round(scale.cells[id].startup.timed.stages.off_boundary?.median ?? 0, 1)).join(' | ')} |`,
			`| counts-build overhead | ${cellIds.map((id) => ratio(scale.cells[id].startup.overhead.counts)).join(' | ')} |`,
			'',
		);
		for (const id of cellIds) {
			const fcp = scale.cells[id].fcp;
			if (!fcp.measured) {
				lines.push(`FCP@${rows} for \`${id}\`: **not measured** — ${fcp.reason}.`, '');
				continue;
			}
			lines.push(
				`### \`${id}\` FCP@${rows} — pre-populated first screen, slice start → all rows painted`,
				'',
				...stageTable(fcp.timed),
				'',
				`Host calls ${integer(fcp.counts.counts.calls.median)} (${round(fcp.counts.opsPerRow, 2)} per row), ${fcp.counts.counts.flushCount.median} \`__FlushElementTree\`, start delay ${round(fcp.counts.startDelay.median, 1)} ms. Wall ${round(controlWall(fcp), 1)} ms control / ${round(fcp.counts.total.median, 1)} ms counts / ${round(fcp.timed.total.median, 1)} ms timed; overhead ${ratio(fcp.overhead.counts)} counts, ${ratio(fcp.overhead.timed)} timed.`,
				'',
			);
		}
		for (const transfer of transfers.get(rows)) {
			lines.push(
				`### \`${transfer.shippingId}\` first-screen phase split @${rows} — what off-boundary time is Octane's`,
				'',
				`Measured on \`${transfer.profiledId}\`, the profile build of \`${transfer.shippingId}\`. Its first-screen wall on the uninstrumented control pages is ${round(transfer.profiledMs, 1)} ms against that shipping cell's ${round(transfer.shippingMs, 1)} ms in the same window — ${transfer.deltaMs > 0 ? '+' : ''}${round(transfer.deltaMs, 1)} ms, ${transfer.spread === null ? 'n/a' : `${transfer.spread > 0 ? '+' : ''}${(transfer.spread * 100).toFixed(1)}%`}. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.`,
				'',
				...firstScreenTable(transfer.split),
				'',
				`Off-boundary in the profiled cell's own timed FCP window is ${round(transfer.profiledOffBoundaryMs, 1)} ms, against ${round(transfer.shippingOffBoundaryMs, 1)} ms in \`${transfer.shippingId}\`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.`,
				'',
			);
		}
		const control = firstScreenControl(scale);
		if (control !== null) {
			lines.push(
				`### Octane internal control — first-screen path vs create path @${rows}`,
				'',
				`Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives ${round(control.composedControlMs, 1)} ms on the control pages; its direct pre-populated FCP@${rows} is ${round(control.directControlMs, 1)} ms — an excess of **${round(control.excessControlMs, 1)} ms (${((control.directControlMs / control.composedControlMs - 1) * 100).toFixed(1)}%)** for the same rendered result. The counts build agrees: ${round(control.composedCountsMs, 1)} ms composed against ${round(control.directCountsMs, 1)} ms direct.`,
				'',
				`The first-screen path issues ${round(control.firstScreenCallsPerRow, 2)} host calls per row against the create path's ${round(control.createCallsPerRow, 2)}, and flushes ${control.firstScreenFlushes} times against ${control.createFlushes}. The excess is ${integer(control.excessCalls)} calls, ${round(control.excessCallsPerRow, 2)} per row.`,
				'',
				'| host call | first screen | create | delta |',
				'|---|---:|---:|---:|',
			);
			for (const entry of control.byKind) {
				if (entry.delta === 0 && entry.firstScreen === 0) continue;
				lines.push(
					`| \`${entry.kind}\` | ${integer(entry.firstScreen)} | ${integer(entry.create)} | ${entry.delta > 0 ? '+' : ''}${integer(entry.delta)} |`,
				);
			}
			lines.push(
				'',
				'| segment | first screen ms | create ms | delta ms |',
				'|---|---:|---:|---:|',
			);
			for (const entry of control.byStage) {
				lines.push(
					`| ${entry.stage} | ${round(entry.firstScreen, 1)} | ${round(entry.create, 1)} | ${entry.delta > 0 ? '+' : ''}${round(entry.delta, 1)} |`,
				);
			}
			lines.push('');
		}
		for (const id of Object.keys(scale.deltas)) {
			const delta = scale.deltas[id];
			lines.push(
				`### Octane − \`${id}\`, create@${rows}`,
				'',
				`Certified wall-clock delta: ${round(delta.createControlDeltaMs, 1)} ms on the control pages, ${round(delta.createCountsDeltaMs, 1)} ms on the counts build. The attribution below runs on the timed build, whose delta is ${round(delta.create.deltaMs, 1)} ms; a candidate owner is authorized only by a positive directly observed contribution of at least ${(delta.create.gate * 100).toFixed(0)}% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.`,
				'',
				...deltaTable(delta.create),
				'',
				`### Octane − \`${id}\`, startup`,
				'',
				`Certified wall-clock delta: ${round(delta.startupCountsDeltaMs, 1)} ms on the counts build.`,
				'',
				...deltaTable(delta.startup),
				'',
			);
			// The first-screen delta, when the reference carries a pre-populated
			// bundle of its own. This is the only window where the two cells run the
			// same code path they would run in production for the same result, so it
			// is the one whose delta answers "how far behind is the first screen"
			// without composing two windows and inheriting the composition's error.
			if (delta.fcp !== undefined) {
				lines.push(
					`### Octane − \`${id}\`, FCP@${rows}`,
					'',
					`Certified wall-clock delta: ${round(delta.fcpControlDeltaMs, 1)} ms on the control pages, ${round(delta.fcpCountsDeltaMs, 1)} ms on the counts build. The attribution below runs on the timed build, whose delta is ${round(delta.fcp.deltaMs, 1)} ms; a candidate owner is authorized only by a positive directly observed contribution of at least ${(delta.fcp.gate * 100).toFixed(0)}% of it.`,
					'',
					...deltaTable(delta.fcp),
					'',
				);
			}
		}
	}
	const projections = scaleReports.map((scale) => ({
		rows: scale.rows,
		rowsData: projectedFcp(scale),
	}));
	lines.push(
		'## Projected FCP@N',
		'',
		'The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.',
		'',
		`| cell | ${scaleReports.map((scale) => `${scale.rows.toLocaleString('en-US')} projected`).join(' | ')} | ${scaleReports.map((scale) => `${scale.rows.toLocaleString('en-US')} direct`).join(' | ')} |`,
		`|---|${scaleReports.map(() => '---:').join('|')}|${scaleReports.map(() => '---:').join('|')}|`,
	);
	for (const id of cellIds) {
		const projected = projections.map(
			(entry) => round(entry.rowsData.find((row) => row.cell === id).projectedMs, 1) ?? '—',
		);
		const direct = projections.map((entry) => {
			const value = entry.rowsData.find((row) => row.cell === id).directMs;
			return value === null ? 'not measured' : round(value, 1);
		});
		lines.push(`| ${id} | ${projected.join(' | ')} | ${direct.join(' | ')} |`);
	}
	lines.push('');
	if (scaleReports.length >= 2) {
		const scaling = first.scaling ?? {};
		if (Object.keys(scaling).length > 0) {
			lines.push(
				'## Scaling',
				'',
				`| cell | ${scaleReports.map((scale) => `${scale.rows.toLocaleString('en-US')} ops/row`).join(' | ')} | drift | flush count constant |`,
				`|---|${scaleReports.map(() => '---:').join('|')}|---:|---|`,
			);
			for (const id of cellIds) {
				const verdicts = scaling[id];
				lines.push(
					`| ${id} | ${verdicts.points.map((point) => round(point.opsPerRow, 2)).join(' | ')} | ${(verdicts.opsPerRowDrift * 100).toFixed(1)}% | ${verdicts.flushConstant ? 'yes' : 'no'} |`,
				);
			}
			lines.push('');
		}
	}
	return lines.join('\n');
}

const isMain =
	process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
	// `--label` mirrors the runner's: it stems every basename, so the evidence a
	// labelled run wrote is re-renderable under the same name it was written to.
	const { values } = parseArgs({
		options: { scales: { type: 'string' }, label: { type: 'string', default: 'papi' } },
	});
	const output = path.join(import.meta.dirname, 'results');
	const stem = requireOutputStem(values.label);
	const scalePattern = new RegExp(`^${stem}-(\\d+)\\.json$`);
	const scales =
		values.scales === undefined
			? fs
					.readdirSync(output)
					.map((file) => scalePattern.exec(file)?.[1])
					.filter(Boolean)
					.map(Number)
					.sort((left, right) => left - right)
			: values.scales.split(',').map((value) => Number(value.trim()));
	if (scales.length === 0) throw new Error(`no frozen ${stem}-<rows>.json evidence to render.`);
	const reports = scales.map((rows) =>
		JSON.parse(fs.readFileSync(path.join(output, `${stem}-${rows}.json`), 'utf8')),
	);
	const scaling = JSON.parse(
		fs.readFileSync(path.join(output, `${stem}-scaling.json`), 'utf8'),
	).scaling;
	reports[0].scaling = scaling;
	fs.writeFileSync(path.join(output, `${stem}-boundary.md`), renderBoundaryReport(reports) + '\n');
	console.log(`[papi] rendered results/${stem}-boundary.md from ${scales.length} frozen scale(s).`);
}
