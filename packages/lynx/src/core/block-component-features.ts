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
export const LYNX_BLOCK_EMPTY_RANGES = true;
export const LYNX_BLOCK_SCOPED_ROWS = true;
export const LYNX_BLOCK_NESTED_RANGES = true;
export const LYNX_BLOCK_BRANCH_REGIONS = true;
export const LYNX_BLOCK_CONTEXT_REGIONS = true;
export const LYNX_BLOCK_CHILD_REGIONS = true;
export const LYNX_BLOCK_RESIDENT_WIRE = true;
