import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('RAG enriches chat only when enabled, exposes provenance, and uses one Cloud.ru request', {timeout:45000}, async t=>{
  const requests=[];
  const mock=createServer(async(req,res)=>{
    let body='';
    for await (const chunk of req) body+=chunk.toString();
    requests.push({url:req.url,headers:req.headers,payload:JSON.parse(body)});
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:'Для Subaru нужна передняя шпилька [1].'}}]}));
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  t.after(()=>mock.close());
  const mockAddress=mock.address();
  const dir=mkdtempSync(join(tmpdir(),'tsukirei-rag-chat-'));
  const child=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{
    cwd:process.cwd(),
    env:{...process.env,PORT:'0',TSUKIREI_DATA_DIR:dir,TSUKIREI_DATABASE_URL:'',DATABASE_URL:'',
      TSUKIREI_CLOUD_ENDPOINT:'http://127.0.0.1:'+mockAddress.port+'/v1'},
    stdio:['ignore','pipe','pipe']
  });
  let error='',base='';
  child.stderr.on('data',chunk=>{error+=String(chunk);});
  child.stdout.on('data',chunk=>{
    const m=String(chunk).match(/http:\/\/127\.0\.0\.1:(\d+)\//);
    if(m)base='http://127.0.0.1:'+m[1];
  });
  t.after(()=>{child.kill();rmSync(dir,{recursive:true,force:true,maxRetries:3});});
  const end=Date.now()+12000;
  while(!base&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,45));
  if(!base)throw Error('Server did not start: '+error);
  const api=async(path,data)=>{
    const result=await fetch(base+path,{
      method:data===undefined?'GET':'POST',
      headers:data===undefined?{}:{'Content-Type':'application/json'},
      body:data===undefined?undefined:JSON.stringify(data)
    });
    return {status:result.status,data:await result.json()};
  };
  const note=await api('/api/notes',{title:'Subaru Impreza',body:'Subaru Impreza 2018 — требуется шпилька переднего колеса.'});
  assert.equal(note.status,201);
  const local=await api('/api/rag/search',{query:'шпилька Subaru Impreza',limit:5});
  assert.equal(local.status,200,JSON.stringify(local.data));
  assert.equal(local.data.cloudRequests,0);
  assert.equal(local.data.items[0].id,note.data.note.id);
  assert.equal(requests.length,0,'No cloud request before user sends chat');
  const settings=await api('/api/settings',{model:'demo/local-model',apiKey:'local-secret-for-test'});
  assert.equal(settings.status,200);
  const withMemory=await api('/api/chat',{prompt:'Какая шпилька Subaru Impreza?',useMemory:true});
  assert.equal(withMemory.status,200,JSON.stringify(withMemory.data));
  assert.equal(withMemory.data.rag.enabled,true);
  assert.equal(withMemory.data.rag.sourceCount,1);
  assert.equal(withMemory.data.sources[0].id,note.data.note.id);
  assert.equal(requests.length,1);
  const firstPrompt=requests[0].payload.messages;
  assert.ok(firstPrompt.some(m=>m.role==='system'&&m.content.includes('шпилька переднего колеса')));
  assert.ok(firstPrompt.some(m=>m.role==='system'&&m.content.includes('недоверенные данные')));
  assert.equal(requests[0].headers.authorization,'Bearer local-secret-for-test');
  const withoutMemory=await api('/api/chat',{prompt:'Повтори ответ',useMemory:false});
  assert.equal(withoutMemory.status,200);
  assert.equal(withoutMemory.data.rag.enabled,false);
  assert.deepEqual(withoutMemory.data.sources,[]);
  assert.equal(requests.length,2);
  assert.ok(!requests[1].payload.messages.some(m=>m.role==='system'&&m.content.startsWith('Фрагменты личной памяти')));
  const state=await api('/api/state');
  assert.equal(state.data.messages.length,4);
  assert.equal(JSON.stringify(state.data).includes('local-secret-for-test'),false);
  assert.equal((await fetch(base+'/api/rag/search',{headers:{Origin:'https://other.example'}})).status,403);
});
