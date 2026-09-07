import { root } from '@octanejs/lynx';

import { App } from './App.lynx.tsrx';
import { blockApp } from './block-program.js';
import './app.css';

// Issue-#103 B0: one application entry, one build flag. `__BENCH_CORE__` is
// substituted beside `pluginOctane({ core })`, so the ternary folds at build
// time and `block-program.ts` — with `block-core.ts` behind it — leaves the
// `universal` bundle entirely. That fold is what makes the two cells an A/B
// with a single variable rather than two applications that resemble each other.
//
// Issue-#135 item 1b adds a third position for that one variable. `derived`
// runs the Block core on the compiled `App` itself, the way `universal` does,
// rather than on the hand-written program beside it — so `block-program.ts`
// folds out of that bundle too, and the cell measures the framework instead of
// standing in for it. The other two modes stay because the ceiling they record
// is what the derived cell is read against.
declare const __BENCH_CORE__: string;
declare const __BENCH_BLOCK_MODE__: string;

void root.render(
	__BENCH_CORE__ === 'block' && __BENCH_BLOCK_MODE__ !== 'derived' ? blockApp(App) : App,
);
