declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { LynxCreateSelectorQuery, LynxNodesRefBinding } from './nodes-ref.js';

export interface LynxCompactHostRefIdentity {
	readonly root: number;
	readonly id: number;
	readonly type: string;
	readonly generation: number;
	readonly selector: string;
}

export interface LynxCompactHostRefState extends LynxCompactHostRefIdentity {
	readonly active: boolean;
	readonly attachmentEpoch: number;
}

export interface LynxCompactHostRefFeature {
	createBinding(options: {
		readonly identity: LynxCompactHostRefIdentity;
		readonly createSelectorQuery: LynxCreateSelectorQuery;
		readonly readState: () => LynxCompactHostRefState;
	}): LynxNodesRefBinding;
}

let providedFeature: LynxCompactHostRefFeature | null = null;

/** Install the heavy selector-query implementation only in a ref-bearing compiled graph. */
export function provideLynxCompactHostRefFeature(feature: LynxCompactHostRefFeature): void {
	if (providedFeature === feature) return;
	if (providedFeature !== null) {
		throw new Error(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? 'Octane Lynx compact host-ref feature was provided twice.'
				: 'Octane Lynx OL499',
		);
	}
	providedFeature = feature;
}

export function requireLynxCompactHostRefFeature(): LynxCompactHostRefFeature {
	if (providedFeature !== null) return providedFeature;
	throw new Error(
		typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
			? 'Octane Lynx used a compact host ref, but this bundle compiled no host-ref feature.'
			: 'Octane Lynx OL499',
	);
}
