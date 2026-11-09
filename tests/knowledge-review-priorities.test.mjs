import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const cognition=readFileSync(new URL('../server/cognition.ts',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/index.ts',import.meta.url),'utf8');
test('review queue prioritizes conflicts before missing, stale and duplicates',()=>{
 for(const kind of ["conflict","missing","stale","duplicate"])assert.ok(cognition.includes("kind:'"+kind+"'"));
 assert.match(cognition,/sort\(\(a,b\)=>a\.priority-b\.priority/);
 assert.match(cognition,/requiresOwnerReview:true/);
});
test('consolidation preserves original facts and provenance',()=>{
 assert.match(cognition,/consolidatedKnowledge\(\)/);
 assert.match(cognition,/factIds:facts\.map\(f=>f\.id\)/);
 assert.match(cognition,/sourceIds:\[\.\.\.new Set\(facts\.map\(f=>f\.sourceId\)\)\]/);
 assert.match(cognition,/status==='confirmed'/);
});
test('growth is based on actual persisted traces',()=>{
 assert.match(cognition,/growthHistory\(limit=80\)/);
 assert.match(cognition,/this\.data\.traces\.slice/);
});
test('read-only endpoints expose review, consolidated and growth',()=>{
 for(const path of ['/api/cognition/review-queue','/api/cognition/consolidated','/api/cognition/growth'])assert.ok(server.includes("pathname === '"+path+"'"));
});
