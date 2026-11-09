import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const cognition=readFileSync(new URL('../server/cognition.ts',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/index.ts',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const main=readFileSync(new URL('../web/main.js',import.meta.url),'utf8');
test('review evidence uses only locally confirmed facts and keeps provenance',()=>{
 assert.match(cognition,/reviewEvidence\(\)/);
 assert.match(cognition,/this\.data\.facts\.filter\(f=>f\.status==='confirmed'\)/);
 assert.match(cognition,/verified:false,requiresOwnerReview:true/);
 assert.match(server,/pathname === '\/api\/cognition\/review-evidence'/);
 assert.match(server,/localOnly:true,readOnly:true/);
});
test('brain page shows persisted growth events and collapsible review',()=>{
 for(const id of ['brain-growth-summary','brain-growth-events','brain-review-list'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(main,/api\('\/api\/cognition\/growth'\)/);
 assert.match(main,/api\('\/api\/cognition\/review-queue'\)/);
 assert.match(main,/api\('\/api\/cognition\/review-evidence'\)/);
 assert.match(main,/events\.replaceChildren\(\)/);
});
