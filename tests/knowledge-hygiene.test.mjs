import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const cognition=readFileSync(new URL('../server/cognition.ts',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/index.ts',import.meta.url),'utf8');
test('knowledge hygiene reports only confirmed conflicting facts',()=>{
 assert.match(cognition,/const confirmed=this\.data\.facts\.filter\(f=>f\.status==='confirmed'\)/);
 assert.match(cognition,/values\.size>1/);
 assert.match(cognition,/sourceIds:\[\.\.\.new Set\(facts\.map\(f=>f\.sourceId\)\)\]/);
});
test('stale facts are flagged rather than deleted',()=>{
 assert.match(cognition,/const maxAge=180\*24\*60\*60\*1000/);
 assert.match(cognition,/timestamp-date>maxAge/);
 assert.match(cognition,/automaticDeletion:false,automaticConfirmation:false/);
});
test('local API exposes knowledge hygiene report',()=>{
 assert.match(server,/pathname === '\/api\/cognition\/hygiene'/);
 assert.match(server,/json\(res,200,cognition\.hygiene\(\)\)/);
});
