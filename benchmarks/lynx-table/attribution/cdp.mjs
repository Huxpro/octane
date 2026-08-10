import fs from 'node:fs';

export class NestedCDPSession {
	#browserSession;
	#sessionId;
	#nextId = 1;
	#pending = new Map();
	#events = new Map();
	#onMessage;

	constructor(browserSession, sessionId) {
		this.#browserSession = browserSession;
		this.#sessionId = sessionId;
		this.#onMessage = (event) => {
			if (event.sessionId !== this.#sessionId) return;
			const message = JSON.parse(event.message);
			if (message.id !== undefined) {
				const pending = this.#pending.get(message.id);
				if (pending === undefined) return;
				this.#pending.delete(message.id);
				if (message.error) pending.reject(new Error(message.error.message));
				else pending.resolve(message.result ?? {});
				return;
			}
			const listeners = this.#events.get(message.method);
			if (listeners !== undefined) for (const listener of listeners) listener(message.params ?? {});
		};
		browserSession.on('Target.receivedMessageFromTarget', this.#onMessage);
	}

	on(method, listener) {
		const listeners = this.#events.get(method);
		if (listeners === undefined) this.#events.set(method, [listener]);
		else listeners.push(listener);
	}

	off(method, listener) {
		const listeners = this.#events.get(method);
		if (listeners === undefined) return;
		const index = listeners.indexOf(listener);
		if (index !== -1) listeners.splice(index, 1);
	}

	async send(method, params = {}) {
		const id = this.#nextId++;
		const response = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
		await this.#browserSession.send('Target.sendMessageToTarget', {
			sessionId: this.#sessionId,
			message: JSON.stringify({ id, method, params }),
		});
		return response;
	}

	async detach() {
		this.#browserSession.off('Target.receivedMessageFromTarget', this.#onMessage);
		for (const pending of this.#pending.values())
			pending.reject(new Error('CDP session detached.'));
		this.#pending.clear();
		await this.#browserSession
			.send('Target.detachFromTarget', { sessionId: this.#sessionId })
			.catch(() => {});
	}
}

export async function attachOnlyWorker(browser) {
	const browserSession = await browser.newBrowserCDPSession();
	const { targetInfos } = await browserSession.send('Target.getTargets');
	const workers = targetInfos.filter(
		(target) => target.type === 'worker' && target.url.includes('web-core-worker-chunk.js'),
	);
	if (workers.length !== 1) {
		await browserSession.detach();
		throw new Error(`expected exactly one benchmark worker target, found ${workers.length}.`);
	}
	const { sessionId } = await browserSession.send('Target.attachToTarget', {
		targetId: workers[0].targetId,
		flatten: false,
	});
	return {
		target: workers[0],
		session: new NestedCDPSession(browserSession, sessionId),
		async detach() {
			await this.session.detach();
			await browserSession.detach();
		},
	};
}

export async function collectHeap(session) {
	await session.send('HeapProfiler.enable');
	await session.send('HeapProfiler.collectGarbage');
	return session.send('Runtime.getHeapUsage');
}

export async function takeHeapSnapshot(session, file) {
	const descriptor = fs.openSync(file, 'w');
	let chunks = 0;
	const onChunk = ({ chunk }) => {
		fs.writeSync(descriptor, chunk);
		chunks++;
	};
	session.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
	try {
		await session.send('HeapProfiler.enable');
		await session.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
	} finally {
		session.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
		fs.closeSync(descriptor);
	}
	if (chunks === 0) throw new Error('heap snapshot completed without chunks.');
	return { chunks, bytes: fs.statSync(file).size };
}

export async function startCpuProfile(session) {
	await session.send('Profiler.enable');
	await session.send('Profiler.setSamplingInterval', { interval: 100 });
	await session.send('Profiler.start');
}

export async function stopCpuProfile(session) {
	const { profile } = await session.send('Profiler.stop');
	return profile;
}

function stageFor(frame) {
	const name = frame.functionName || '(anonymous)';
	const url = frame.url || '';
	if (url.includes('universal-core') || url.includes('main.web.bundle')) {
		if (
			/materialize|universal(Value|Props|For)|renderLazyLeaf|executeOwner|renderComponent/i.test(
				name,
			)
		) {
			return 'owner_and_materialization';
		}
		if (/reconcile|draft|createLogical|freezeUniversalHostBatch|cloneSerializable/i.test(name)) {
			return 'blueprint_and_transaction';
		}
	}
	if (/fold.*plan|plan.*fold|wire/i.test(name)) return 'plan_folding_and_wire';
	if (/dispatch|transport|commit/i.test(name)) return 'transport';
	if (/App|Row|buildData|runLots|run3k|run20k|run30k/i.test(name)) return 'app_component';
	if (name === '(idle)' || name === '(program)') return 'idle';
	return 'other';
}

export function summarizeCpuProfile(profile, top = 40) {
	const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
	const selfMicros = new Map();
	const stages = new Map();
	let activeMicros = 0;
	let totalMicros = 0;
	for (let index = 0; index < (profile.samples?.length ?? 0); index++) {
		const delta = profile.timeDeltas?.[index] ?? 0;
		const node = nodes.get(profile.samples[index]);
		if (node === undefined) continue;
		const stage = stageFor(node.callFrame);
		totalMicros += delta;
		if (stage !== 'idle') activeMicros += delta;
		selfMicros.set(node.id, (selfMicros.get(node.id) ?? 0) + delta);
		stages.set(stage, (stages.get(stage) ?? 0) + delta);
	}
	const functions = [...selfMicros]
		.map(([id, micros]) => {
			const frame = nodes.get(id).callFrame;
			return {
				function: frame.functionName || '(anonymous)',
				url: frame.url || '',
				line: frame.lineNumber + 1,
				selfMs: micros / 1000,
				activeShare: activeMicros === 0 ? 0 : micros / activeMicros,
			};
		})
		.filter((entry) => entry.function !== '(idle)')
		.sort((left, right) => right.selfMs - left.selfMs)
		.slice(0, top);
	return {
		activeMs: activeMicros / 1000,
		totalMs: totalMicros / 1000,
		stages: Object.fromEntries(
			[...stages]
				.filter(([stage]) => stage !== 'idle')
				.map(([stage, micros]) => [
					stage,
					{ ms: micros / 1000, activeShare: activeMicros === 0 ? 0 : micros / activeMicros },
				]),
		),
		functions,
	};
}
