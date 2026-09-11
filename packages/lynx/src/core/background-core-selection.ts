/**
 * Default background-core selection for source consumers and unsupported builds.
 *
 * A production `@octanejs/rspeedy-plugin` application may replace this module
 * with `background-core-selection.block.ts` after its complete dual-thread
 * graph proves the Block subset. Keeping the fallback as authored source makes
 * every build outside that exact controller conservative by construction.
 */
export const LYNX_BLOCK_BACKGROUND_CORE = false;
