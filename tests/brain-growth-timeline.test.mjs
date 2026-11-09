import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../web/main.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/styles.css',import.meta.url),'utf8');
test('growth history offers seven, thirty days and all time',()=>{
 for(const period of ['7','30','all'])assert.ok(html.includes('data-brain-period="'+period+'"'));
 assert.match(main,/const visibleRecords=records\.filter/);
 assert.match(main,/timestamp>=now-days\*86400000/);
 assert.match(main,/visibleRecords\.slice\(0,12\)/);
});
test('brain refresh reloads the real graph rather than switching to overview',()=>{
 assert.match(main,/el\('brain-refresh'\)\.addEventListener\('click',\(\)=>\{void refreshBrainKnowledge\(\);void refreshBrainGrowth\(\);\}\)/);
});
test('animation respects reduced motion and period selection is accessible',()=>{
 assert.match(css,/prefers-reduced-motion:no-preference/);
 assert.match(main,/setAttribute\('aria-pressed'/);
});
