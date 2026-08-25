import assert from 'node:assert/strict';
import test from 'node:test';

import { firstScreenControl } from './papi-report.mjs';

// The deltas and the first-screen control are octane-vs-reference by
// construction. `--cells` accepts any subset, so a run measured without the
// octane cell must degrade to "no control" instead of crashing after the whole
// measurement window has already been spent.
test('firstScreenControl declines a run measured without the octane cell', () => {
	assert.equal(firstScreenControl({ cells: {} }), null);
});
