import type { UNIVERSAL_TRANSPORT_PROTOCOL_VERSION } from 'octane/universal/native';

import { LYNX_RENDERER_ID } from './renderer-id.js';

/** Runtime transport identity shared without loading the general protocol graph. */
export const LYNX_TRANSPORT_PROTOCOL_VERSION: typeof UNIVERSAL_TRANSPORT_PROTOCOL_VERSION = 1;

export const LYNX_TRANSPORT_RENDERER: typeof LYNX_RENDERER_ID = LYNX_RENDERER_ID;
