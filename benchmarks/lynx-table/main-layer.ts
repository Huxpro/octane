/**
 * Main-thread layer of the benchmark app: the same App source compiled with
 * the main-thread renderer, exactly as a dual-bundle Rspeedy build would
 * produce it. Evaluating this module registers the app's hoisted universal
 * plans in this bundle's plan registry; run.mjs bridges those plans into the
 * workload bundle, mirroring a device where each thread's bundle carries its
 * own copy of the structurally identical plan constants.
 */
export { App } from './app/src/App.lynx.tsrx';
export {
	lynxPlanRegistrySnapshot,
	resolveLynxPlan,
} from '../../packages/lynx/src/core/plan-wire.js';
