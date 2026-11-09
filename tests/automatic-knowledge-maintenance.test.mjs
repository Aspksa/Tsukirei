import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../server/index.ts',import.meta.url),'utf8');
test('knowledge maintenance is debounced and nonoverlapping',()=>{
 assert.match(server,/if\(knowledgeRefreshTimer\|\|shuttingDown\)return/);
 assert.match(server,/void background\.run\('knowledge-check'\)/);
 assert.match(server,/15\*1000/);
});
test('writes and startup queue knowledge maintenance',()=>{
 assert.match(server,/database\.mutate\(change\); queueRagIndex\(\); queueKnowledgeRefresh\(\)/);
 assert.match(server,/saveAtomic\(statePath, state\);\s*queueRagIndex\(\);\s*queueKnowledgeRefresh\(\)/);
 assert.match(server,/server\.listen\([\s\S]*?queueKnowledgeRefresh\(\);/);
});
test('shutdown cancels pending knowledge maintenance',()=>{
 assert.match(server,/if\(knowledgeRefreshTimer\)\{clearTimeout\(knowledgeRefreshTimer\);knowledgeRefreshTimer=null;\}/);
 assert.match(server,/background\.close\(\)/);
});
