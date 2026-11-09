import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('Living Core API uses existing Cloud.ru key only when explicitly enabled', {timeout:60000},async t=>{
  const requests=[];
  const mock=createServer(async(req,res)=>{
    let raw='';
    for await(const chunk of req)raw+=String(chunk);
    const body=JSON.parse(raw);
    requests.push({headers:req.headers,body});
    const reflection=body.messages[0].content.includes('аналитик качества')||
      body.messages[0].content.includes('анализируешь подтверждённые');
    const id=body.messages[1]?.content.match(/note:([0-9a-f-]{36})/i)?.[0];
    const answer=reflection?JSON.stringify({ideas:[{
      kind:'skill',title:'Проверять проект перед утверждением об исправлении',
      reason:'Перед обещанием выполненной работы необходимо подтвердить запуск и результаты.',
      evidence:id?[id]:['note:unknown'],
      steps:['Собрать описание ошибки и проверить воспроизведение',
        'Запустить тесты и записать их результат до ответа владельцу']
    }]}):'Хозяин, я проверила данные и сформулировала ответ.';
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:answer}}]}));
  });
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  t.after(()=>mock.close());
  const dir=mkdtempSync(join(tmpdir(),'tsukirei-living-api-'));
  const child=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{
    cwd:process.cwd(),
    env:{...process.env,PORT:'0',TSUKIREI_DATA_DIR:dir,TSUKIREI_DATABASE_URL:'',DATABASE_URL:'',
      TSUKIREI_CLOUD_ENDPOINT:'http://127.0.0.1:'+mock.address().port+'/v1'},
    stdio:['ignore','pipe','pipe']
  });
  let base='',errors='';
  child.stdout.on('data',data=>{
    const match=String(data).match(/http:\/\/127\.0\.0\.1:(\d+)\//);
    if(match)base='http://127.0.0.1:'+match[1];
  });
  child.stderr.on('data',data=>{errors+=String(data);});
  t.after(()=>{child.kill();rmSync(dir,{recursive:true,force:true,maxRetries:3});});
  for(let i=0;i<120&&!base;i++)await new Promise(r=>setTimeout(r,80));
  if(!base)throw Error('Server did not start: '+errors);
  const api=async(path,method='GET',body)=>{
    const response=await fetch(base+path,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
    return{status:response.status,data:await response.json()};
  };
  const initial=await api('/api/living');
  assert.equal(initial.status,200);
  assert.equal(initial.data.settings.cloudEnabled,false);
  assert.equal(initial.data.settings.shareRecentText,false);
  const note=await api('/api/notes','POST',{title:'Личное описание',body:'Очень чувствительный текст из личного файла'});
  assert.equal(note.status,201);
  await api('/api/settings','POST',{model:'test/model',apiKey:'secret-test-cloud-key'});
  const local=await api('/api/living/run','POST',{cloud:true});
  assert.equal(local.status,200);
  assert.equal(local.data.result.local,true);
  assert.equal(local.data.result.cloud.skipped.includes('отключ'),true);
  assert.equal(requests.length,0);
  const wrong=await api('/api/living/settings','PATCH',{cloudEnabled:'yes'});
  assert.equal(wrong.status,400);
  const changed=await api('/api/living/settings','PATCH',{cloudEnabled:true,maxCloudCallsPerDay:1});
  assert.equal(changed.status,200);
  assert.equal(changed.data.settings.shareRecentText,false);
  const output=await api('/api/living/run','POST',{cloud:true});
  assert.equal(output.status,200,JSON.stringify(output.data));
  assert.equal(output.data.result.cloud.added,1);
  assert.equal(requests.length,1);
  assert.equal(requests[0].headers.authorization,'Bearer secret-test-cloud-key');
  assert.ok(!JSON.stringify(requests[0].body).includes('Очень чувствительный текст'));
  const idea=output.data.status.ideas.find(i=>i.kind==='skill');
  assert.ok(idea);
  assert.equal(idea.status,'proposed');
  const noAuto=await api('/api/living/ideas/'+idea.id,'PATCH',{action:'verify',note:'Тесты программы прошли'});
  assert.equal(noAuto.status,400,'Cannot verify without approval');
  assert.equal((await api('/api/living/ideas/'+idea.id,'PATCH',{action:'approve'})).status,200);
  const checked=await api('/api/living/ideas/'+idea.id,'PATCH',{
    action:'verify',note:'Тесты запущены и фактически прошли на Windows'
  });
  assert.equal(checked.status,200,JSON.stringify(checked.data));
  assert.equal(checked.data.idea.status,'verified');
  const answer=await api('/api/chat','POST',{prompt:'Хозяин, что делать дальше?',useMemory:true});
  assert.equal(answer.status,200);
  assert.equal(requests.length,2);
  assert.ok(requests[1].body.messages.some(m=>m.role==='system'&&m.content.includes('Проверять проект перед утверждением')));
  const rollback=await api('/api/living/ideas/'+idea.id,'PATCH',{action:'rollback'});
  assert.equal(rollback.status,200);
  assert.equal(rollback.data.idea.status,'rolled_back');
  const over=await api('/api/living/run','POST',{cloud:true});
  assert.equal(over.status,200);
  assert.match(over.data.result.cloud.skipped,/Лимит/);
  assert.equal(requests.length,2);
  assert.equal((await api('/api/living')).data.budget.calls,1);
  assert.equal((await api('/api/state')).status,200);
  assert.equal(JSON.stringify((await api('/api/living')).data).includes('secret-test-cloud-key'),false);
  assert.equal((await fetch(base+'/api/living',{headers:{Origin:'https://example.org'}})).status,403);
});
