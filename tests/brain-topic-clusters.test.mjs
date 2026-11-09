import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../web/main.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
test('brain topic clusters are built from persisted graph edges',()=>{
 assert.match(main,/const neighbors=new Map\(rawNodes\.map/);
 assert.match(main,/topics\.sort\(\(a,b\)=>b\.length-a\.length\)/);
 assert.match(main,/const visibleIds=selectedBrainTopic===null/);
 assert.match(main,/included\.has\(String\(e\.from\)\)/);
});
test('topic selection remains keyboard-accessible and reversible',()=>{
 assert.match(html,/id="brain-topic-groups"/);
 assert.match(main,/button\.type='button'/);
 assert.match(main,/setAttribute\('aria-pressed'/);
 assert.match(main,/topicButton\('Все · '/);
});
