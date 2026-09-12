import type { UniversalSerializableValue } from 'octane/universal/native';

import type {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
} from './transport-identity.js';

/** Root-independent native page lifetime teardown broadcast. */
export interface LynxPageDestroyMessage {
	readonly protocol: typeof LYNX_TRANSPORT_PROTOCOL_VERSION;
	readonly renderer: typeof LYNX_TRANSPORT_RENDERER;
	readonly type: 'page-destroy';
}

export type LynxPageDataOperation = 'replace' | 'update' | 'reset';

/** Immutable, structured-clone-safe record carried by the page data lifecycle. */
export type LynxLifecycleDataRecord = Readonly<Record<string, UniversalSerializableValue>>;

/** Root-independent page data delivered from the public engine lifecycle. */
export interface LynxPageDataMessage {
	readonly protocol: typeof LYNX_TRANSPORT_PROTOCOL_VERSION;
	readonly renderer: typeof LYNX_TRANSPORT_RENDERER;
	readonly type: 'page-data';
	readonly operation: LynxPageDataOperation;
	readonly data: LynxLifecycleDataRecord;
}

/** Root-independent global-props patch delivered from the public engine lifecycle. */
export interface LynxGlobalPropsMessage {
	readonly protocol: typeof LYNX_TRANSPORT_PROTOCOL_VERSION;
	readonly renderer: typeof LYNX_TRANSPORT_RENDERER;
	readonly type: 'global-props';
	readonly patch: LynxLifecycleDataRecord;
}

export type LynxDataLifecycleMessage = LynxPageDataMessage | LynxGlobalPropsMessage;
