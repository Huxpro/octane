import {
	LYNX_BLOCK_ACTIVITY,
	LYNX_BLOCK_TRANSITIONS,
	LYNX_BLOCK_TRY_BOUNDARIES,
} from './block-component-features.js';

/**
 * Whether this application can retain a mounted Block while hiding it.
 *
 * Source-safe builds keep every semantic capability. A one-shot production
 * graph proved to need structural semantics only replaces the imported feature
 * module, so Element Template definitions and instances can both omit their
 * otherwise permanent `hidden` slot.
 */
export const LYNX_ELEMENT_TEMPLATE_VISIBILITY =
	LYNX_BLOCK_ACTIVITY || LYNX_BLOCK_TRANSITIONS || LYNX_BLOCK_TRY_BOUNDARIES;
