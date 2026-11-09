import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Script} from 'node:vm';
const html=readFileSync(join(import.meta.dirname,'../web/studio.html'),'utf8');
test('studio inline script parses and keeps local API routes',()=>{
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,1);
 assert.doesNotThrow(()=>new Script(scripts[0][1],{filename:'studio-inline.js'}));
 for(const path of ['/api/soul/unified-decision','/api/soul/planned-goals','/api/soul/plan-reviews','/api/soul/commitment-watch'])
   assert.ok(html.includes(path),path);
});
test('goal form is labelled and confirmation is explicit',()=>{
 for(const id of ['goal-dialog','goal-form','goal-title','goal-step-1','goal-submit','proposed-goals'])
   assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes("status:b.dataset.activate?'active':'cancelled'"));
 assert.ok(html.includes('prefers-reduced-motion'));
 assert.ok(html.includes('role="alert"'));
});

test('goal detail and evidence confirmation are available',()=>{
 for(const id of ['goal-details','step-dialog','step-form','step-evidence','step-confirm','add-step','extra-steps'])
   assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes("evidenceId:'manual:'"));
 assert.ok(html.includes("data-open-step"));
 assert.ok(html.includes("count>=12"));
});

test('studio supports keyboard and asynchronous accessibility states',()=>{
 assert.match(html,/class="skip-link" href="#main-content"/);
 assert.match(html,/id="main-content" tabindex="-1"/);
 assert.match(html,/id="updated" role="status" aria-live="polite"/);
 assert.match(html,/dialog id="detail" aria-labelledby="detail-title"/);
 assert.match(html,/\.btn:focus-visible/);
 assert.match(html,/const sequence=\+\+loadSequence/);
 assert.match(html,/if\(sequence!==loadSequence\)return/);
 assert.match(html,/aria-busy/);
});
