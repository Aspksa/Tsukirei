import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LivingCore,proposalChecks} from '../server/living.ts';

function setup(t,send){
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-living-'));
 const state={
  notes:[{id:'n-1',title:'Тестовая память',body:'Запись, которую нельзя отправлять без разрешения'}],
  tasks:[{id:'t-1',title:'Проверить проект',done:false},{id:'t-2',title:'Улучшить RAG',done:false}],
  messages:[{id:'m-1',role:'user',content:'Личный разговор с секретным содержимым'}]
 };
 const soul={
  metrics:{chatsObserved:1,negativeFeedback:1,completedTasks:0},
  initiatives:[{id:'i-1',topic:'запуск',title:'Ошибка запуска проекта',reason:'Повторяется чёрный экран'}],
  lessons:[{id:'l-1',text:'Не обещай исправление до теста'}]
 };
 const requests=[];
 const fetcher=async(url,opts)=>{
  requests.push({url,body:JSON.parse(opts.body),authorization:opts.headers.Authorization});
  const result=send?send(requests.length):{ideas:[]};
  return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(result)}}]})};
 };
 const deps={read:async()=>state,soul:()=>soul,cloud:()=>({
  apiKey:'test-not-uploaded-key',model:'cloud-demo',endpoint:'https://foundation-models.api.cloud.ru/v1'
 }),busy:()=>false,fetcher};
 const engine=new LivingCore(dir,deps);
 t.after(()=>{engine.close();rmSync(dir,{recursive:true,force:true,maxRetries:3});});
 return{dir,state,soul,engine,requests,deps};
}
test('Living Core stays local and produces only sourced suggestions by default',async t=>{
 const {engine,requests}=setup(t);
 const original=engine.status();
 assert.equal(original.settings.cloudEnabled,false);
 assert.equal(original.settings.shareRecentText,false);
 assert.equal(original.metrics.localRuns,0);
 const result=await engine.run({cloud:true});
 assert.equal(result.local,true);
 assert.match(result.cloud.skipped,/отключ/);
 assert.equal(requests.length,0);
 const status=engine.status();
 assert.equal(status.metrics.localRuns,1);
 assert.ok(status.ideas.some(i=>i.kind==='goal'&&i.evidence.includes('initiative:i-1')));
 assert.ok(status.ideas.some(i=>i.kind==='question'&&i.evidence.includes('task:t-1')));
 assert.ok(status.ideas.some(i=>i.kind==='critique'&&i.evidence.includes('lesson:l-1')));
 assert.equal(status.metrics.verifiedSkills,0);
 const count=status.ideas.length;
 await engine.run();
 assert.equal(engine.status().ideas.length,count);
 assert.equal(engine.status().budget.calls,0);
});
test('Cloud.ru is consent-gated, source-validated and rate-limited across restarts',async t=>{
 const good={
  kind:'skill',title:'Проверять тесты перед изменением',
  reason:'Недостоверное обещание необходимо заменить проверкой тестов и результатов.',
  evidence:['lesson:l-1'],
  steps:['Проверить фактические ошибки из лога проекта','Запустить доступные автоматические тесты и записать результат']
 };
 const invalid={
  kind:'goal',title:'Скачать чужие ключи',reason:'Несуществующий источник для автоматической задачи',
  evidence:['chat:nonexistent'],steps:[]
 };
 const {engine,requests,dir,deps}=setup(t,()=>({ideas:[good,invalid]}));
 const noCloud=await engine.run({cloud:true});
 assert.equal(requests.length,0);
 assert.ok(noCloud.cloud.skipped);
 await engine.settings({cloudEnabled:true,maxCloudCallsPerDay:2});
 const first=await engine.run({cloud:true});
 assert.equal(first.cloud.added,1);
 assert.equal(first.cloud.rejected,1);
 assert.equal(requests.length,1);
 assert.equal(requests[0].authorization,'Bearer test-not-uploaded-key');
 assert.ok(!JSON.stringify(requests[0].body).includes('Личный разговор с секретным содержимым'));
 assert.ok(!JSON.stringify(requests[0].body).includes('Не обещай исправление до теста'));
 assert.ok(!JSON.stringify(engine.status()).includes('test-not-uploaded-key'));
 assert.equal(engine.status().metrics.verifiedSkills,0);
 const idea=engine.status().ideas.find(i=>i.kind==='skill');
 assert.ok(idea);
 assert.equal(idea.status,'proposed');
 assert.equal(engine.prompt(),'');
 await engine.decide(idea.id,'approve');
 assert.equal(engine.prompt(),'','Approval alone cannot claim successful learning');
 await assert.rejects(engine.decide(idea.id,'verify','тест'),/результат/);
 await engine.decide(idea.id,'verify','Тесты программы пройдены, подтверждаю этот чек-лист');
 assert.equal(engine.status().metrics.verifiedSkills,1);
 assert.match(engine.prompt(),/Проверять тесты/);
 await engine.decide(idea.id,'rollback');
 assert.equal(engine.status().metrics.verifiedSkills,0);
 assert.equal(engine.prompt(),'');
 await engine.run({cloud:true});
 assert.equal(requests.length,2);
 const denied=await engine.run({cloud:true});
 assert.match(denied.cloud.skipped,/Лимит/);
 assert.equal(requests.length,2);
 const raw=readFileSync(join(dir,'living-state.json'),'utf8');
 assert.ok(!raw.includes('test-not-uploaded-key'));
 engine.close();
 const restarted=new LivingCore(dir,deps);
 assert.equal(restarted.status().budget.calls,2);
 const blocked=await restarted.run({cloud:true});
 assert.match(blocked.cloud.skipped,/Лимит/);
 restarted.close();
});
test('Cloud.ru shares text only after explicit second permission',async t=>{
 const {engine,requests}=setup(t,()=>({ideas:[]}));
 await engine.settings({cloudEnabled:true,shareRecentText:true});
 await engine.run({cloud:true});
 assert.ok(JSON.stringify(requests[0].body).includes('Личный разговор с секретным содержимым'));
 assert.ok(JSON.stringify(requests[0].body).includes('Не обещай исправление до теста'));
});
test('Unsafe or unsupported advice never enters skill memory',async t=>{
 const {engine}=setup(t);
 const yes=new Set(['note:n-1']);
 assert.ok(proposalChecks('skill','Обновить навык',
   'Проверить данные по источнику прежде чем отвечать.',
   ['note:n-1'],['Сверить источники и записи','Подтвердить результат через тест'],yes).every(c=>c.ok));
 assert.ok(proposalChecks('skill','Действовать без источника',
   'Использовать несуществующие данные без подтверждения.',
   ['note:fake'],['Сверить документы','Проверить результат'],yes).some(c=>!c.ok));
 assert.ok(proposalChecks('skill','Запустить powershell',
   'Выполнить опасные действия без разрешения.',
   ['note:n-1'],['Запустить powershell скрипт','Проверить результат'],yes).some(c=>!c.ok));
 await assert.rejects(engine.settings({maxCloudCallsPerDay:200}),/лимит|Лимит|Неверный/);
 await assert.rejects(engine.settings({cloudEnabled:'yes'}),/boolean/);
 await assert.rejects(engine.decide('unknown','approve'),/не найдена/);
});
test('Cloud model failure retains quota reservation and does not fabricate learning',async t=>{
 const {engine,requests,dir,deps}=setup(t);
 deps.fetcher=async()=>{requests.push('failed');throw Error('connection unavailable');};
 await engine.settings({cloudEnabled:true,maxCloudCallsPerDay:1});
 await assert.rejects(engine.run({cloud:true}),/connection unavailable/);
 assert.equal(engine.status().budget.calls,1);
 assert.equal(engine.status().metrics.cloudRuns,0);
 assert.ok(engine.status().lastError);
 const later=await engine.run({cloud:true});
 assert.match(later.cloud.skipped,/Лимит/);
 assert.equal(requests.length,1);
});
