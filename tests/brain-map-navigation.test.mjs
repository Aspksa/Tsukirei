import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../web/main.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
test('brain map supports bounded zoom, pan and reset',()=>{
 for(const id of ['brain-zoom-in','brain-zoom-out','brain-zoom-reset'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(js,/Math\.max\(140,Math\.min\(1400,brainViewport\.width\*factor\)\)/);
 assert.match(js,/svg\.addEventListener\('wheel'/);
 assert.match(js,/svg\.addEventListener\('pointermove'/);
 assert.match(js,/svg\.addEventListener\('pointercancel'/);
 assert.match(js,/svg\.addEventListener\('lostpointercapture'/);
});
test('graph re-centers on refresh and node selection remains accessible',()=>{
 assert.match(js,/resetBrainViewport\(\);\s*svg\.replaceChildren\(\)/);
 assert.match(js,/group\.addEventListener\('keydown'/);
});
