import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const main=readFileSync(new URL('../web/main.js',import.meta.url),'utf8');

test('five primary sidebar destinations',()=>{
 const sidebar=html.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1]??'';
 const bottom=html.match(/<div class="nav-bottom">([\s\S]*?)<\/div>/)?.[1]??'';
 const pages=[...sidebar.matchAll(/class="nav-button[^\"]*" data-page="([^\"]+)"/g),...bottom.matchAll(/class="nav-button[^\"]*" data-page="([^\"]+)"/g)].map(x=>x[1]);
 assert.deepEqual(pages,['home','brain','tasks','agents','settings']);
});
test('all legacy brain sections remain available without data migration',()=>{
 for(const name of ['memory','search','soul','living','cognition','supermind']){
  assert.match(html,new RegExp('id="page-'+name+'"'));
  assert.match(html,new RegExp('data-page="'+name+'"'));
 }
 assert.match(html,/id="page-brain"/);
 assert.match(main,/brainPages\.has\(page\)/);
});
