import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../web/main.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/styles.css',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/index.ts',import.meta.url),'utf8');
test('technical core pages and their data bindings are retained',()=>{
 for(const id of ['page-soul','page-living','page-cognition','page-supermind','rag-provider-form','rag-engine-reindex']){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 for(const page of ['soul','living','cognition','supermind']){
  assert.match(html,new RegExp('data-page="'+page+'"'));
 }
});
test('primary navigation excludes technical pages and agents',()=>{
 const nav=html.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1]??'';
 assert.deepEqual([...nav.matchAll(/data-page="([^"]+)"/g)].map(m=>m[1]),['home','brain','tasks']);
});
test('RAG controls move to advanced settings and manual actions are hidden',()=>{
 assert.match(js,/advancedMount\.append\(technicalRagPanel\)/);
 assert.match(html,/id="advanced-rag-mount"/);
 for(const id of ['rag-engine-reindex','rag-engine-refresh','rag-curator-check','cog-scan'])assert.ok(css.includes('#'+id));
});
test('automatic knowledge and index jobs remain enabled',()=>{
 assert.match(server,/name:'knowledge-check'/);
 assert.match(server,/name:'rag-index-watch'/);
 assert.match(server,/name:'living-tick'/);
});
