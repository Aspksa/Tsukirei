import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../server/index.ts',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../web/main.js',import.meta.url),'utf8');
test('brain overview is a local read-only endpoint',()=>{
 assert.match(server,/method === 'GET' && pathname === '\/api\/brain\/overview'/);
 assert.match(server,/cloudRequestsForOverview:0/);
 assert.match(server,/background:background\.status\(\)/);
});
test('brain page renders metrics and an accessible topology',()=>{
 for(const id of ['brain-refresh','brain-metrics','brain-map-svg','brain-footnote'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(ui,/refreshBrainOverview\(\)/);
 assert.match(ui,/createElementNS\(ns,tag\)/);
 assert.match(ui,/if \(page === 'brain'\)/);
});
