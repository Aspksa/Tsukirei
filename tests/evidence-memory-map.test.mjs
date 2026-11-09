import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../web/main.js',import.meta.url),'utf8');
test('brain opens persisted knowledge map by default',()=>{
 assert.match(main,/if \(page === 'brain'\) \{ void refreshBrainKnowledge\(\); void refreshBrainGrowth\(\); \}/);
 assert.match(main,/api\('\/api\/cognition\/world'/);
});
test('graph nodes reflect real edge counts and show provenance',()=>{
 assert.match(main,/const degree=new Map/);
 assert.match(main,/Math\.sqrt\(connections\)\*4/);
 assert.match(main,/edge\.evidenceId/);
 assert.match(main,/edge\.excerpt/);
 assert.match(main,/detail\.replaceChildren\(\)/);
});
test('graph preserves keyboard inspection and conceptual overview',()=>{
 assert.match(main,/group\.addEventListener\('keydown'/);
 assert.match(main,/brain-graph-overview/);
});
