import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server/index.ts',import.meta.url),'utf8');

test('shutdown stops all local periodic engines before server closes',()=>{
 const match=server.match(/function shutdown\(signal:string\)\{([\s\S]*?)\n\}/);
 assert.ok(match,'shutdown handler exists');
 const body=match[1];
 for(const name of ['background.close();','ragWorker?.close();','living.close();','soul.close();','server.close(']){
  assert.ok(body.includes(name),name+' must be closed');
 }
 assert.ok(body.indexOf('background.close();')<body.indexOf('server.close('));
});
test('termination handlers are registered once and shutdown is idempotent',()=>{
 assert.match(server,/if\(shuttingDown\)return;/);
 assert.match(server,/process.once\('SIGINT'/);
 assert.match(server,/process.once\('SIGTERM'/);
});
