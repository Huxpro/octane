declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type {
	UniversalHostAttachmentBatch,
	UniversalHostBatch,
	UniversalHostCapabilities,
	UniversalHostDriver,
	UniversalHostPropCodecContext,
	UniversalHostTemplateCapability,
	UniversalHostTemplateProgram,
	UniversalHostTemplateProgramBinding,
	UniversalSerializableValue,
	UniversalTemplateHostPlacement,
} from 'octane/universal/native';

import { isLynxNativeResource } from '../resource.js';
import { classifyLynxHostPropUpdate, sameLynxUniversalHostPropValue } from './host-props.js';
import { encodeLynxProgramPropValue } from './host-prop-value.js';
import { parseLynxNativeEventProp } from './native-events.js';
import { requireLynxCompactHostRefFeature } from './compact-host-ref-feature.js';
import type {
	LynxCreateSelectorQuery,
	LynxMeasureOptions,
	LynxMeasureResult,
	LynxNodesRefBinding,
	LynxNodesRefFieldsOptions,
	LynxNodesRefFieldsResult,
	LynxNodesRefPathResult,
} from './nodes-ref.js';
import type { LynxHostAttachmentChange, LynxMainThreadCapabilities } from './protocol.js';
import { LYNX_TRANSPORT_RENDERER } from './transport-identity.js';

export interface LynxPublicHandle {
	readonly renderer: typeof LYNX_TRANSPORT_RENDERER;
	readonly root: number;
	readonly id: number;
	readonly type: string;
	readonly generation: number;
	readonly active: boolean;
	readonly attached: boolean;
	readonly snapshot: UniversalSerializableValue;
	invoke<Result extends UniversalSerializableValue = UniversalSerializableValue>(
		method: string,
		params?: Readonly<Record<string, UniversalSerializableValue>>,
	): Promise<Result>;
	measure(options?: LynxMeasureOptions): Promise<LynxMeasureResult>;
	fields(options: LynxNodesRefFieldsOptions): Promise<LynxNodesRefFieldsResult>;
	path(): Promise<LynxNodesRefPathResult | null>;
	setNativeProps(props: Readonly<Record<string, UniversalSerializableValue>>): Promise<void>;
}

export interface LynxClientContainer {
	readonly renderer: typeof LYNX_TRANSPORT_RENDERER;
	getPublicHandle(id: number): LynxPublicHandle | null;
}

interface CompactHandleEntry {
	readonly root: number;
	readonly id: number;
	readonly type: string;
	readonly generation: 1;
	readonly createSelectorQuery: LynxCreateSelectorQuery;
	active: boolean;
	attached: boolean;
	attachmentEpoch: number;
	facade: LynxPublicHandle | null;
	binding: LynxNodesRefBinding | null;
	snapshot: UniversalSerializableValue | null;
}

export interface LynxCompactPublicHandleInput {
	readonly root: number;
	readonly id: number;
	readonly type: string;
	readonly attached: boolean;
}

interface CompactClientState {
	readonly createSelectorQuery: LynxCreateSelectorQuery;
	handles: Map<number, CompactHandleEntry> | null;
	templateMount: boolean;
	templateProgramMount: boolean;
	templateProgramRuns: boolean;
	deferredTemplateProgramRuns: boolean;
	addressedProgramRuns: boolean;
	programManifests: boolean;
	teardownRuns: boolean;
	lazyPublicInstances: boolean;
}

const STATES = new WeakMap<LynxClientContainer, CompactClientState>();
const COMPACT_CLIENT_ERROR = 'Octane Lynx OL498';
function compactSelector(root: number, id: number, generation: number): string {
	return '[octane-ref=r' + root + '-h' + id + '-g' + generation + ']';
}

function state(container: LynxClientContainer): CompactClientState {
	const value = STATES.get(container);
	if (value === undefined) {
		throw new TypeError(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx compact client received a foreign container.'
				: COMPACT_CLIENT_ERROR,
		);
	}
	return value;
}

function nextAttachmentEpoch(entry: CompactHandleEntry, attached: boolean): number {
	if (entry.attached === attached) return entry.attachmentEpoch;
	if (entry.attachmentEpoch === Number.MAX_SAFE_INTEGER) throw new Error(COMPACT_CLIENT_ERROR);
	return entry.attachmentEpoch + 1;
}

function bindingFor(entry: CompactHandleEntry): LynxNodesRefBinding {
	if (entry.binding !== null) return entry.binding;
	const selector = compactSelector(entry.root, entry.id, entry.generation);
	const binding = requireLynxCompactHostRefFeature().createBinding({
		identity: {
			root: entry.root,
			id: entry.id,
			type: entry.type,
			generation: entry.generation,
			selector,
		},
		createSelectorQuery: entry.createSelectorQuery,
		readState: () => ({
			root: entry.root,
			id: entry.id,
			type: entry.type,
			generation: entry.generation,
			selector,
			active: entry.active && entry.attached,
			attachmentEpoch: entry.attachmentEpoch,
		}),
	});
	entry.binding = binding;
	return binding;
}

function facadeFor(entry: CompactHandleEntry): LynxPublicHandle {
	if (entry.facade !== null) return entry.facade;
	entry.facade = Object.freeze({
		renderer: LYNX_TRANSPORT_RENDERER,
		root: entry.root,
		id: entry.id,
		type: entry.type,
		generation: entry.generation,
		get active() {
			return entry.active;
		},
		get attached() {
			return entry.attached;
		},
		get snapshot() {
			return (entry.snapshot ??= Object.freeze({
				$$kind: 'octane.lynx.element',
				renderer: LYNX_TRANSPORT_RENDERER,
				root: entry.root,
				id: entry.id,
				type: entry.type,
				generation: entry.generation,
				selector: compactSelector(entry.root, entry.id, entry.generation),
			}));
		},
		invoke: <Result extends UniversalSerializableValue>(
			method: string,
			params?: Readonly<Record<string, UniversalSerializableValue>>,
		) => bindingFor(entry).handle.invoke<Result>(method, params),
		measure: (options?: LynxMeasureOptions) => bindingFor(entry).handle.measure(options),
		fields: (options: LynxNodesRefFieldsOptions) => bindingFor(entry).handle.fields(options),
		path: () => bindingFor(entry).handle.path(),
		setNativeProps: (props: Readonly<Record<string, UniversalSerializableValue>>) =>
			bindingFor(entry).handle.setNativeProps(props),
	}) as LynxPublicHandle;
	return entry.facade;
}

export interface CreateLynxClientContainerOptions {
	readonly createSelectorQuery?: LynxCreateSelectorQuery;
}

export function createLynxClientContainer(
	options: CreateLynxClientContainerOptions = {},
): LynxClientContainer {
	const createSelectorQuery =
		options.createSelectorQuery ??
		(() => {
			throw new Error(COMPACT_CLIENT_ERROR);
		});
	if (typeof createSelectorQuery !== 'function') throw new TypeError(COMPACT_CLIENT_ERROR);
	const container: LynxClientContainer = Object.freeze({
		renderer: LYNX_TRANSPORT_RENDERER,
		getPublicHandle(id: number) {
			const entry = STATES.get(container)!.handles?.get(id);
			return entry === undefined ? null : facadeFor(entry);
		},
	});
	STATES.set(container, {
		createSelectorQuery,
		handles: null,
		templateMount: false,
		templateProgramMount: false,
		templateProgramRuns: false,
		deferredTemplateProgramRuns: false,
		addressedProgramRuns: false,
		programManifests: true,
		teardownRuns: false,
		lazyPublicInstances: false,
	});
	return container;
}

export const LYNX_PUBLIC_INSTANCE_ANNOUNCEMENTS = true;

export function setLynxClientCapabilities(
	container: LynxClientContainer,
	capabilities: LynxMainThreadCapabilities | undefined,
): void {
	const current = state(container);
	current.templateMount = capabilities?.templateMount === 1;
	current.templateProgramMount = current.templateMount && capabilities?.templateProgram === 1;
	current.templateProgramRuns = current.templateProgramMount && capabilities?.templateRuns === 1;
	current.deferredTemplateProgramRuns =
		current.templateProgramRuns && capabilities?.deferredTemplateRuns === 1;
	current.addressedProgramRuns =
		current.templateProgramRuns && capabilities?.addressedProgramRuns === 1;
	current.programManifests = false;
	current.teardownRuns = current.templateProgramMount && capabilities?.teardownRuns === 1;
	current.lazyPublicInstances = false;
}

export function setLynxClientProgramManifests(
	container: LynxClientContainer,
	enabled: boolean,
): void {
	state(container).programManifests = enabled;
}

export function lynxClientTemplateRunsNegotiated(container: LynxClientContainer): boolean {
	return state(container).templateProgramRuns;
}

// Link-compatible dead exports for the general transport/root branch. The
// compiled-program selector removes every call site; retaining the names lets
// Rspack link the source-safe module graph before dead-code elimination.
export function getLynxClientWorkletBatchExecutions(_batch: UniversalHostBatch): undefined {
	return undefined;
}

export function prepareLynxClientWorkletBatch(
	_container: LynxClientContainer,
	batch: UniversalHostBatch,
): UniversalHostBatch {
	return batch;
}

export function hasLynxCompactHandleSegment(_container: LynxClientContainer): boolean {
	return false;
}

export function invalidateLynxClientContainer(container: LynxClientContainer): void {
	const current = state(container);
	if (current.handles === null) return;
	for (const entry of current.handles.values()) {
		entry.active = false;
		entry.attached = false;
		entry.binding?.invalidate(new Error(COMPACT_CLIENT_ERROR));
	}
	current.handles = null;
}

export function prepareLynxCompactHandleDeltas(): never {
	throw new Error(COMPACT_CLIENT_ERROR);
}

export function prepareLynxHandleDeltas(): never {
	throw new Error(COMPACT_CLIENT_ERROR);
}

export function isLynxClientEventTarget(): boolean {
	return false;
}

export function activateLynxCompactPublicHandle(
	container: LynxClientContainer,
	input: LynxCompactPublicHandleInput,
): LynxPublicHandle {
	const current = state(container);
	if (
		!Number.isSafeInteger(input.root) ||
		input.root <= 0 ||
		!Number.isSafeInteger(input.id) ||
		input.id <= 0 ||
		typeof input.type !== 'string' ||
		input.type.length === 0 ||
		typeof input.attached !== 'boolean'
	) {
		throw new TypeError(COMPACT_CLIENT_ERROR);
	}
	const handles = (current.handles ??= new Map());
	const existing = handles.get(input.id);
	if (existing !== undefined) {
		if (!existing.active || existing.root !== input.root || existing.type !== input.type) {
			throw new Error(COMPACT_CLIENT_ERROR);
		}
		return facadeFor(existing);
	}
	const entry: CompactHandleEntry = {
		root: input.root,
		id: input.id,
		type: input.type,
		generation: 1,
		createSelectorQuery: current.createSelectorQuery,
		active: true,
		attached: input.attached,
		attachmentEpoch: input.attached ? 1 : 0,
		facade: null,
		binding: null,
		snapshot: null,
	};
	handles.set(input.id, entry);
	return facadeFor(entry);
}

export function releaseLynxCompactPublicHandle(container: LynxClientContainer, id: number): void {
	const current = state(container);
	const entry = current.handles?.get(id);
	if (entry === undefined) return;
	current.handles!.delete(id);
	entry.active = false;
	entry.attachmentEpoch = nextAttachmentEpoch(entry, false);
	entry.attached = false;
	entry.binding?.invalidate(new Error(COMPACT_CLIENT_ERROR));
	if (current.handles!.size === 0) current.handles = null;
}

export function applyLynxHostAttachments(
	container: LynxClientContainer,
	changes: readonly LynxHostAttachmentChange[],
): UniversalHostAttachmentBatch {
	if (!Array.isArray(changes)) throw new TypeError(COMPACT_CLIENT_ERROR);
	const current = state(container);
	const detached: number[] = [];
	const attached: number[] = [];
	const seen = new Set<number>();
	for (const change of changes) {
		if (change === null || typeof change !== 'object' || Array.isArray(change)) {
			throw new TypeError(COMPACT_CLIENT_ERROR);
		}
		const entry = current.handles?.get(change.id);
		if (
			seen.has(change.id) ||
			entry === undefined ||
			!entry.active ||
			change.generation !== 1 ||
			typeof change.attached !== 'boolean'
		) {
			throw new Error(COMPACT_CLIENT_ERROR);
		}
		seen.add(change.id);
		if (entry.attached === change.attached) continue;
		entry.attachmentEpoch = nextAttachmentEpoch(entry, change.attached);
		entry.attached = change.attached;
		if (!change.attached) entry.binding?.invalidateAttachment();
		(change.attached ? attached : detached).push(change.id);
	}
	return Object.freeze({ detached: Object.freeze(detached), attached: Object.freeze(attached) });
}

const DISCRETE_EVENTS = new Set([
	'blur',
	'change',
	'focus',
	'input',
	'longpress',
	'longtap',
	'tap',
	'touchend',
	'touchstart',
]);
const CONTINUOUS_EVENTS = new Set(['layoutchange', 'scroll', 'touchmove', 'wheel']);
const EMPTY_TEMPLATE_BINDINGS: readonly UniversalHostTemplateProgramBinding[] = Object.freeze([]);
const TEMPLATE_HOSTS: UniversalHostTemplateCapability = Object.freeze({
	placement(type: string): UniversalTemplateHostPlacement {
		if (type === 'list') return 'any';
		return type === 'list-item' ? 'root' : 'any';
	},
	defer(parentType: string, program: UniversalHostTemplateProgram): boolean {
		if (parentType !== 'list') return false;
		for (const node of program.nodes) {
			for (const binding of node.bindings ?? EMPTY_TEMPLATE_BINDINGS) {
				if (binding.name.startsWith('main-thread:')) return false;
			}
		}
		return true;
	},
});

export function createLynxClientDriver(
	container?: LynxClientContainer,
): UniversalHostDriver<LynxClientContainer, LynxPublicHandle> {
	const negotiated = container === undefined ? null : state(container);
	return Object.freeze({
		id: LYNX_TRANSPORT_RENDERER,
		capabilities: Object.freeze({
			text: 'host' as const,
			visibility: true,
			stableStaticHostProps: true,
			collapsedTemplateMount: true,
			get templateMount() {
				return negotiated?.templateMount === true;
			},
			get templateProgramMount() {
				return negotiated?.templateProgramMount === true;
			},
			get templateProgramRuns() {
				return negotiated?.templateProgramRuns === true;
			},
			get deferredTemplateProgramRuns() {
				return negotiated?.deferredTemplateProgramRuns === true;
			},
			get addressedProgramRuns() {
				return negotiated?.addressedProgramRuns === true;
			},
			get programManifests() {
				return negotiated?.programManifests === true;
			},
			get teardownRuns() {
				return negotiated?.teardownRuns === true;
			},
			get lazyPublicInstances() {
				return negotiated?.lazyPublicInstances === true;
			},
			publicInstanceAnnouncements: LYNX_PUBLIC_INSTANCE_ANNOUNCEMENTS,
		}) satisfies UniversalHostCapabilities,
		templates: TEMPLATE_HOSTS,
		props: Object.freeze({
			encode(context: UniversalHostPropCodecContext<LynxClientContainer>) {
				if (isLynxNativeResource(context.value)) {
					return {
						kind: 'resource' as const,
						handle: context.createResourceHandle(context.value.id),
					};
				}
				if (context.name.startsWith('main-thread:')) {
					throw new TypeError(
						typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
							? 'Octane Lynx compact client cannot encode a main-thread prop.'
							: COMPACT_CLIENT_ERROR,
					);
				}
				return {
					kind: 'value' as const,
					value: encodeLynxProgramPropValue(context.hostType, context.name, context.value) as never,
				};
			},
		}),
		events: Object.freeze({
			classify(name: string) {
				const binding = parseLynxNativeEventProp(name);
				if (binding === null) return null;
				return {
					type: name,
					priority: DISCRETE_EVENTS.has(binding.name)
						? ('discrete' as const)
						: CONTINUOUS_EVENTS.has(binding.name)
							? ('continuous' as const)
							: ('default' as const),
				};
			},
		}),
		updates: Object.freeze({
			classify: classifyLynxHostPropUpdate,
			same: sameLynxUniversalHostPropValue,
		}),
		prepareBatch() {
			throw new Error(
				typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
					? 'Octane Lynx compact client requires its async transport.'
					: COMPACT_CLIENT_ERROR,
			);
		},
		getPublicInstance() {
			return null;
		},
	});
}
