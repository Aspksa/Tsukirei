import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const core=readFileSync(new URL('../server/cognition.ts',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/index.ts',import.meta.url),'utf8');
const js=readFileSync(new URL('../web/main.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
test('graph API limits output and returns only edges with visible endpoints',()=>{
 assert.match(core,/Math\.min\(3000,Math\.max\(1/);
 assert.match(core,/visible\.has\(e\.from\)&&visible\.has\(e\.to\)/);
 assert.match(core,/totalNodes:candidates\.length,hasMore/);
 assert.match(server,/Number\.isSafeInteger\(requested\)/);
});
test('UI progressively loads and discards stale graph responses',()=>{
 assert.match(html,/id="brain-load-more"/);
 assert.match(js,/brainVisibleLimit=Math\.min\(350,brainVisibleLimit\+70\)/);
 assert.match(js,/if\(requestId!==brainGraphRequest\)return/);
 assert.match(js,/el\('brain-load-more'\)\.hidden=!graph\.hasMore/);
});
