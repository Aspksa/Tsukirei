import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const main=readFileSync(new URL('../web/main.js',import.meta.url),'utf8');

test('four primary sidebar destinations',()=>{
 const sidebar=html.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1]??'';
 const bottom=html.match(/<div class="nav-bottom">([\s\S]*?)<\/div>/)?.[1]??'';
 const pages=[...sidebar.matchAll(/class="nav-button[^\"]*" data-page="([^\"]+)"/g),...bottom.matchAll(/class="nav-button[^\"]*" data-page="([^\"]+)"/g)].map(x=>x[1]);
 assert.deepEqual(pages,['home','brain','tasks','settings']);
});
test('all legacy brain sections remain available without data migration',()=>{
 for(const name of ['memory','search','soul','living','cognition','supermind']){
  assert.match(html,new RegExp('id="page-'+name+'"'));
  assert.match(html,new RegExp('data-page="'+name+'"'));
 }
 assert.match(html,/id="page-brain"/);
 assert.match(main,/brainPages\.has\(page\)/);
});

test('brain workspace groups knowledge, identity and learning without removing legacy views',()=>{
 for(const heading of ['Память и RAG','Личность и сверхразум','Развитие и мышление'])assert.ok(html.includes(heading));
 assert.equal((html.match(/class="glass-panel brain-workspace"/g)??[]).length,3);
 for(const page of ['memory','search','soul','supermind','living','cognition']){
  assert.match(html,new RegExp('data-page="'+page+'"'));
 }
});
test('navigation guards against absent panels and handles browser history',()=>{
 assert.match(main,/if \(!section\) continue/);
 assert.match(main,/addEventListener\('hashchange'/);
 assert.match(main,/window\.location\.hash !== '#' \+ page/);
});
