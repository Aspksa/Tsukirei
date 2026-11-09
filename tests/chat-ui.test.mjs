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

test('chat v2 includes message copy, scroll affordance and expanding composer',()=>{
 assert.match(html,/id="chat-jump"/);
 assert.match(html,/class="chat-thread-wrap"/);
 assert.match(js,/navigator\.clipboard\.writeText\(message\.content\)/);
 assert.match(js,/function resizeChatInput\(/);
 assert.match(js,/function updateChatJump\(/);
 assert.match(js,/chatScrollPinned/);
 assert.match(css,/\.chat-jump\[hidden\]\{display:none\}/);
});

test('chat v3 search remains local and renders safe DOM highlights',()=>{
 for(const id of ['chat-search','chat-search-toggle','chat-search-input','chat-search-count','chat-search-prev','chat-search-next'])
   assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(js,/function applyChatSearch\(/);
 assert.match(js,/document\.createTextNode\(original\.slice/);
 assert.match(js,/mark\.textContent=original\.slice/);
 assert.match(js,/previousScroll\+list\.scrollHeight-previousHeight/);
 assert.match(css,/\.chat-search\[hidden\]\{display:none!important\}/);
});

test('chat search keeps scrolling scoped to its message viewport',()=>{
 assert.match(js,/list\.scrollTo\(\{top:Math\.max\(0,target\)/);
 assert.doesNotMatch(js,/chatSearchMatches\[chatSearchIndex\]\.scrollIntoView/);
 assert.match(js,/applyChatSearch\(\{navigate:false\}\)/);
 assert.match(js,/applyChatSearch\(\{navigate:true\}\)/);
 assert.match(js,/updateChatCounter\(\);\s*proactiveSuggestions/);
});
