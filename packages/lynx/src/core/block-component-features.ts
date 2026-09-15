/**
 * Source-safe Block component capability defaults.
 *
 * The package must support every proved Block feature when it is consumed
 * without the Rspeedy application-graph selector. A one-shot production build
 * may replace this module only after both Lynx thread graphs prove that the
 * corresponding feature is absent from every authored entry.
 */
export const LYNX_BLOCK_TRY_BOUNDARIES = true;
export const LYNX_BLOCK_PORTALS = true;
export const LYNX_BLOCK_ACTIVITY = true;
export const LYNX_BLOCK_TRANSITIONS = true;
