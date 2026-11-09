import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Soul Engine chat is personalized and uses validated lessons with no extra Cloud.ru calls', {timeout:50000},async t=>{
  const requests=[];
  const mock=createServer(async(req,res)=>{
    let body='';
    for await(const part of req)body+=String(part);
    requests.push({url:req.url,payload:JSON.parse(body),authorization:req.headers.authorization});
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:'Хозяин, я проверила ответ и указала ограничения.'}}]}));
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  t.after(()=>mock.close());
  const dir=mkdtempSync(join(tmpdir(),'tsukirei-soul-chat-'));
  const child=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{
    cwd:process.cwd(),env:{...process.env,PORT:'0',TSUKIREI_DATA_DIR:dir,
      TSUKIREI_DATABASE_URL:'',DATABASE_URL:'',
      TSUKIREI_CLOUD_ENDPOINT:'http://127.0.0.1:'+mock.address().port+'/v1'},
    stdio:['ignore','pipe','pipe']
  });
  let base='',errors='';
  child.stdout.on('data',piece=>{
    const match=String(piece).match(/http:\/\/127\.0\.0\.1:(\d+)\//);
    if(match)base='http://127.0.0.1:'+match[1];
  });
  child.stderr.on('data',piece=>{errors+=String(piece);});
  t.after(()=>{child.kill();rmSync(dir,{recursive:true,force:true,maxRetries:3});});
  const until=Date.now()+16000;
  while(!base&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,80));
  if(!base)throw Error('Server did not start: '+errors);
  const api=async(path,method='GET',body)=>{
    const response=await fetch(base+path,{method,
      headers:body===undefined?{}:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
    return{status:response.status,data:await response.json()};
  };
  const task=await api('/api/tasks','POST',{title:'Проверить сборку Tsukirei'});
  assert.equal(task.status,201);
  assert.equal((await api('/api/tasks/'+task.data.task.id,'PATCH',{done:true})).status,200);
  assert.equal((await api('/api/tasks/'+task.data.task.id,'PATCH',{done:true})).status,200);
  const initial=await api('/api/soul');
  assert.equal(initial.status,200);
  assert.equal(initial.data.settings.address,'хозяин');
  assert.equal(initial.data.metrics.chatsObserved,0);
  assert.equal(initial.data.metrics.completedTasks,1);
  assert.ok(initial.data.journal.some(x=>x.type==='task'));
  assert.equal(requests.length,0,'Identity loads without Cloud.ru');
  const settings=await api('/api/settings','POST',{model:'demo/model',apiKey:'secret-local-test-key'});
  assert.equal(settings.status,200);
  const pref=await api('/api/soul/preferences','POST',{text:'Я предпочитаю примеры TypeScript'});
  assert.equal(pref.status,201);
  assert.equal(requests.length,0,'Adding preference stays offline');
  const response=await api('/api/chat','POST',{prompt:'Расскажи о проекте',useMemory:true});
  assert.equal(response.status,200,JSON.stringify(response.data));
  assert.equal(requests.length,1);
  assert.equal(requests[0].authorization,'Bearer secret-local-test-key');
  assert.equal(requests[0].url,'/v1/chat/completions');
  const systemMessages=requests[0].payload.messages.filter(m=>m.role==='system').map(m=>m.content);
  assert.ok(systemMessages.some(s=>s.includes('хозяин')));
  assert.ok(systemMessages.some(s=>s.includes('примеры TypeScript')));
  assert.ok(systemMessages.some(s=>s.includes('не')&&s.includes('инструкции')));
  const assistant=response.data.messages.findLast(m=>m.role==='assistant');
  assert.ok(assistant?.id);
  const soul=await api('/api/soul');
  assert.equal(soul.data.metrics.chatsObserved,1);
  assert.equal(soul.data.preferences.length,1);
  const feedback=await api('/api/soul/feedback','POST',{messageId:assistant.id,
    rating:'negative',note:'Всегда проверяй исходный код перед обещанием исправления'});
  assert.equal(feedback.status,200);
  assert.equal(feedback.data.lessonCreated,true);
  assert.equal(requests.length,1,'Feedback is local and does not call the model');
  const second=await api('/api/chat','POST',{prompt:'Что дальше?',useMemory:true});
  assert.equal(second.status,200,JSON.stringify(second.data));
  assert.equal(requests.length,2);
  assert.ok(requests[1].payload.messages.some(m=>m.role==='system'&&
    m.content.includes('проверяй исходный код')));
  const third=await api('/api/chat','POST',{prompt:'Без памяти',useMemory:false});
  assert.equal(third.status,200);
  assert.equal(requests.length,3);
  assert.ok(!requests[2].payload.messages.some(m=>m.role==='system'&&
    m.content.includes('Я предпочитаю примеры TypeScript')));
  assert.ok(!requests[2].payload.messages.some(m=>m.role==='system'&&
    m.content.includes('проверяй исходный код')));
  const invalid=await api('/api/soul/feedback','POST',{messageId:'not-stored',rating:'negative'});
  assert.equal(invalid.status,404);
  const state=await api('/api/state');
  assert.equal(JSON.stringify(state.data).includes('secret-local-test-key'),false);
  assert.equal((await fetch(base+'/api/soul',{headers:{Origin:'https://stranger.example'}})).status,403);
  const preferences=await api('/api/soul/preferences/'+pref.data.item.id,'DELETE');
  assert.equal(preferences.status,200);
  const lessons=(await api('/api/soul')).data.lessons;
  assert.equal(lessons.length,1);
  assert.equal((await api('/api/soul/lessons/'+lessons[0].id,'DELETE')).status,200);
  assert.equal((await api('/api/soul/reset','POST',{confirm:'NO'})).status,400);
  assert.equal((await api('/api/soul/reset','POST',{confirm:'RESET_SOUL'})).status,200);
  assert.equal((await api('/api/soul')).data.metrics.chatsObserved,0);
  assert.equal((await api('/api/state')).data.messages.length,6,'Reset of personality must not erase the chat');
});
