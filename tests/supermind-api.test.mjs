import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('Eternal Soul API is local-first; only owner-verified wisdom reaches Cloud.ru chat', {timeout:60000},async t=>{
 const cloudRequests=[];
 const mock=createServer(async(req,res)=>{
  let body='';
  for await(const chunk of req)body+=String(chunk);
  cloudRequests.push(JSON.parse(body));
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{content:'Хозяин, я проверила локальные записи.'}}]}));
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 t.after(()=>mock.close());
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-supermind-api-'));
 const child=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{
  cwd:process.cwd(),env:{...process.env,PORT:'0',TSUKIREI_DATA_DIR:dir,
   TSUKIREI_DATABASE_URL:'',DATABASE_URL:'',
   TSUKIREI_CLOUD_ENDPOINT:'http://127.0.0.1:'+mock.address().port+'/v1'},
  stdio:['ignore','pipe','pipe']
 });
 let base='',stderr='';
 child.stdout.on('data',chunk=>{
  const match=String(chunk).match(/http:\/\/127\.0\.0\.1:(\d+)\//);
  if(match)base='http://127.0.0.1:'+match[1];
 });
 child.stderr.on('data',chunk=>{stderr+=String(chunk);});
 t.after(()=>{child.kill();rmSync(dir,{recursive:true,force:true,maxRetries:4});});
 for(let i=0;i<180&&!base;i++)await new Promise(r=>setTimeout(r,70));
 if(!base)throw Error('Server failed to start: '+stderr);
 const api=async(path,method='GET',body)=>{
  const response=await fetch(base+path,{method,
   headers:body===undefined?{}:{'Content-Type':'application/json'},
   body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
 };
 assert.equal((await api('/api/health')).data.version,'1.2.0');
 const start=await api('/api/supermind');
 assert.equal(start.status,200);
 assert.equal(start.data.identity.name,'Цукирэй');
 assert.equal(start.data.values.length,6);
 assert.equal(start.data.innerWorld.soulProfile.address,'хозяин');
 assert.equal(start.data.governor.executesCode,false);
 assert.equal(start.data.governor.cloudBudget.calls,0);
 assert.equal(cloudRequests.length,0);
 const task=await api('/api/tasks','POST',{title:'Проверить переносной запуск'});
 assert.equal(task.status,201);
 assert.equal((await api('/api/tasks/'+task.data.task.id,'PATCH',{done:true})).status,200);
 const scan=await api('/api/supermind/scan','POST',{});
 assert.equal(scan.status,200,JSON.stringify(scan.data));
 assert.ok(scan.data.result.added>=2);
 const biography=await api('/api/supermind/autobiography');
 assert.equal(biography.status,200);
 assert.ok(biography.data.history.some(e=>e.kind==='milestone'&&e.sourceId.startsWith('soul:')));
 assert.equal(biography.data.changes[0].address,'хозяин');
 const check=await api('/api/supermind/intent','POST',{text:'Не запускается сайт, чёрный экран'});
 assert.equal(check.status,200);
 assert.equal(check.data.intent,'debug');
 const inquiry=await api('/api/supermind/inquiries','POST',{
  question:'Почему запуск сайта завершается чёрным экраном?'});
 assert.equal(inquiry.status,201);
 assert.ok(inquiry.data.inquiry.hypotheses.length>=2);
 const h=inquiry.data.inquiry.hypotheses[0],id=inquiry.data.inquiry.id;
 const unverified=await api('/api/supermind/wisdom','POST',{
  inquiryId:id,hypothesisId:h.id,
  principle:'Проверять входные данные перед изменением программы'});
 assert.equal(unverified.status,400);
 const tested=await api('/api/supermind/inquiries/'+id+'/hypotheses/'+h.id,'PATCH',{
  result:'supports',note:'Провёл контрольный запуск и сравнил тестовые входные данные'});
 assert.equal(tested.status,200);
 assert.equal(tested.data.hypothesis.outcome,'supports');
 const accepted=await api('/api/supermind/wisdom','POST',{
  inquiryId:id,hypothesisId:h.id,
  principle:'Проверять входные данные перед изменением программы'});
 assert.equal(accepted.status,201);
 assert.equal((await api('/api/supermind')).data.metrics.wisdom,1);
 assert.equal(cloudRequests.length,0,'Cognitive operations must not contact Cloud.ru');
 const scenario=await api('/api/supermind/scenarios','POST',{
  question:'Какой подход лучше для переносимой памяти?',
  options:[
   {name:'Локальный поиск',quality:8,effort:3,cost:1,risk:1,
    assumptions:'Сохраняются только локальные файлы и тесты'},
   {name:'Облачный анализ',quality:9,effort:5,cost:7,risk:5,
    assumptions:'Необходим платный API с настройкой разрешений'}
  ]});
 assert.equal(scenario.status,201,JSON.stringify(scenario.data));
 assert.equal(scenario.data.scenario.options.length,2);
 assert.ok(scenario.data.scenario.options.every(x=>x.score>=0&&x.score<=100));
 const settings=await api('/api/settings','POST',{model:'mock-model',apiKey:'local-supermind-mock-key'});
 assert.equal(settings.status,200);
 const withMemory=await api('/api/chat','POST',{prompt:'Что проверить сначала?',useMemory:true});
 assert.equal(withMemory.status,200,JSON.stringify(withMemory.data));
 assert.equal(cloudRequests.length,1);
 assert.ok(cloudRequests[0].messages.some(m=>m.role==='system'&&
   m.content.includes('Проверять входные данные перед изменением программы')));
 const withoutMemory=await api('/api/chat','POST',{prompt:'А без памяти?',useMemory:false});
 assert.equal(withoutMemory.status,200);
 assert.equal(cloudRequests.length,2);
 assert.ok(!cloudRequests[1].messages.some(m=>m.role==='system'&&
   m.content.includes('Проверять входные данные перед изменением программы')));
 const revoke=await api('/api/supermind/wisdom/'+accepted.data.principle.id,'PATCH',{action:'revoke'});
 assert.equal(revoke.status,200);
 assert.equal((await api('/api/supermind')).data.metrics.wisdom,0);
 const wrong=await api('/api/supermind/settings','PATCH',{reviewLimit:500});
 assert.equal(wrong.status,400);
 const off=await api('/api/supermind/settings','PATCH',{enabled:false});
 assert.equal(off.status,200);
 const denied=await api('/api/supermind/scan','POST',{});
 assert.equal(denied.data.result.skipped,'Синхронизация отключена');
 assert.ok(existsSync(join(dir,'supermind-state.json')));
 assert.equal((await fetch(base+'/api/supermind',{headers:{Origin:'https://attacker.example'}})).status,403);
 assert.equal(JSON.stringify((await api('/api/supermind')).data).includes('local-supermind-mock-key'),false);
 assert.equal((await api('/api/state')).data.tasks.length,1,'Supermind must not modify user tasks');
});
