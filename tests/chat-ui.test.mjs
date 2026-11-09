import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Script} from 'node:vm';
const root=join(import.meta.dirname,'..');
const html=readFileSync(join(root,'web/index.html'),'utf8');
const css=readFileSync(join(root,'web/styles.css'),'utf8');
const js=readFileSync(join(root,'web/main.js'),'utf8');
test('chat script is syntactically valid',()=>assert.doesNotThrow(()=>new Script(js)));
test('chat has accessible dialog and composer controls',()=>{
 for(const id of ['chat-panel','chat-title','chat-expand','chat-thread','chat-form','chat-input','chat-send-status','chat-count'])
   assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/role="log" aria-label="История сообщений"/);
 assert.match(html,/aria-describedby="chat-compose-hint"/);
 assert.match(html,/aria-labelledby="chat-title"/);
});
test('chat is hidden by default and responsive on mobile',()=>{
 assert.match(css,/\.chat-panel\[hidden\]\{display:none!important\}/);
 assert.match(css,/height:100dvh!important/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
test('send state and draft preservation are explicit',()=>{
 assert.match(js,/chat-send-status/);
 assert.match(js,/chat-thread'\)\.setAttribute\('aria-busy'/);
 assert.match(js,/!event\.isComposing/);
 assert.match(js,/updateChatCounter/);
 assert.match(js,/if \(!viewState\.settings\.configured\)/);
});
