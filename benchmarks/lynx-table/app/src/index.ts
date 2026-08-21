import { root } from '@octanejs/lynx';

import { App } from './App.lynx.tsrx';
import { blockApp } from './block-program.js';
import './app.css';

// Issue-#103 B0: one application entry, one build flag. `__BENCH_CORE__` is
// substituted beside `pluginOctane({ core })`, so the ternary folds at build
// time and `block-program.ts` — with `block-core.ts` behind it — leaves the
// `universal` bundle entirely. That fold is what makes the two cells an A/B
// with a single variable rather than two applications that resemble each other.
declare const __BENCH_CORE__: string;

void root.render(__BENCH_CORE__ === 'block' ? blockApp(App) : App);
