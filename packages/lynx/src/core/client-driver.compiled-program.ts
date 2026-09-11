declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type {
	UniversalHostBatch,
	UniversalHostCapabilities,
	UniversalHostDriver,
	UniversalHostPropCodecContext,
	UniversalHostTemplateCapability,
	UniversalHostTemplateProgram,
	UniversalHostTemplateProgramBinding,
	UniversalTemplateHostPlacement,
} from 'octane/universal/native';

import { isLynxNativeResource } from '../resource.js';
import { classifyLynxHostPropUpdate, sameLynxUniversalHostPropValue } from './host-props.js';
import { encodeLynxProgramPropValue } from './host-prop-value.js';
import { parseLynxNativeEventProp } from './native-events.js';
import type { LynxMainThreadCapabilities } from './protocol.js';
import { LYNX_TRANSPORT_RENDERER } from './transport-identity.js';

export interface LynxPublicHandle {
	readonly renderer: typeof LYNX_TRANSPORT_RENDERER;
}

export interface LynxClientContainer {
	readonly renderer: typeof LYNX_TRANSPORT_RENDERER;
	getPublicHandle(id: number): LynxPublicHandle | null;
}

interface CompactClientState {
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

export function createLynxClientContainer(): LynxClientContainer {
	const container: LynxClientContainer = Object.freeze({
		renderer: LYNX_TRANSPORT_RENDERER,
		getPublicHandle(_id: number) {
			return null;
		},
	});
	STATES.set(container, {
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

export function invalidateLynxClientContainer(_container: LynxClientContainer): void {}

export function prepareLynxCompactHandleDeltas(): never {
	throw new Error(COMPACT_CLIENT_ERROR);
}

export function prepareLynxHandleDeltas(): never {
	throw new Error(COMPACT_CLIENT_ERROR);
}

export function isLynxClientEventTarget(): boolean {
	return false;
}

export function applyLynxHostAttachments(): { readonly detached: []; readonly attached: [] } {
	return Object.freeze({ detached: [], attached: [] });
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
		if (type === 'list') return 'none';
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
