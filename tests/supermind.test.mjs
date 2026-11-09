import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SuperMind,assessIntent,rankStrategies} from '../server/supermind.ts';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-supermind-'));
 const state={
  tasks:[{id:'t-1',title:'Проверить запуск',done:true,createdAt:'2026-10-02T09:00:00Z'},
    {id:'t-2',title:'Улучшить RAG',done:false,createdAt:'2026-10-02T10:00:00Z'}],
  messages:[{id:'m-1',role:'user',content:'Секретная переписка пользователя',
    createdAt:'2026-10-03T11:00:00Z'}],
  notes:[{id:'n-1',title:'Проект',body:'Локальные записи',createdAt:'2026-10-03T12:00:00Z'}]
 };
 const soul={settings:{address:'хозяин',tone:'нежный',personalContext:true},
  metrics:{chatsObserved:4,completedTasks:1,positiveFeedback:1,negativeFeedback:1},
  preferences:[{id:'p-1',text:'Предпочитаю короткие инструкции',status:'confirmed'}],
  journal:[{id:'j-task',at:'2026-11-08T14:00:00Z',type:'task',
    text:'Владелец отметил выполненной: Проверить запуск',source:'task:t-1'}]
 };
 const goal={id:'g-1',title:'Улучшить поиск',objective:'Пройти контрольные тесты',
   status:'active',priority:'high',dueAt:null,taskIds:['t-2'],
   progress:{linked:1,completed:0,missing:0}};
 const cognitive={goals:async()=>[goal],facts:()=>[
   {id:'f-1',subject:'Tsukirei',field:'База',value:'PostgreSQL',status:'confirmed',sourceId:'note:n-1'}],
  questions:()=>[
   {id:'q-1',question:'Как ускорить локальный поиск знаний?',frequency:3,status:'open',sourceIds:['note:n-1']}],
  status:()=>({lastScanAt:null,metrics:{scans:1},worldEdges:3})};
 const living={status:()=>({
    budget:{calls:0,limit:2},metrics:{localRuns:4,cloudRuns:0,verifiedSkills:1},
    settings:{cloudEnabled:false,shareRecentText:false},activity:'idle'}),
  skills:()=>[{id:'s-1',title:'Проверять запуск',steps:['Выполнить безопасный тест','Сверить журнал']}]};
 const deps={read:async()=>state,soul:()=>soul,cognitive,living,
  now:()=>new Date('2026-11-09T10:00:00Z')};
 const core=new SuperMind(dir,deps);
 t.after(()=>rmSync(dir,{recursive:true,force:true,maxRetries:4}));
 return{dir,core,state,soul,goal,cognitive,living,deps};
}
test('Eternal Soul has stable six-value identity and sources, without invented consciousness',async t=>{
 const {core,state,soul,dir,deps}=fixture(t);
 const before=JSON.stringify(state);
 const first=await core.workspace();
 assert.equal(first.identity.name,'Цукирэй');
 assert.equal(first.values.length,6);
 assert.equal(first.innerWorld.soulProfile.address,'хозяин');
 assert.equal(first.innerWorld.goals.length,1);
 assert.equal(first.innerWorld.openQuestions[0].frequency,3);
 assert.equal(first.curriculum[0].priority,4);
 assert.equal(first.governor.cloudAnalysis,false);
 assert.equal(first.governor.executesCode,false);
 assert.equal(first.governor.maxHypotheses,4);
 assert.match(first.narrative,/не обладаю доказанным сознанием/);
 assert.equal(first.metrics.cloudRequests,0);
 assert.equal(core.prompt(false),'');
 const observed=await core.scan();
 assert.equal(observed.changed,true);
 assert.ok(observed.added>=4);
 const biography=core.autobiography();
 assert.ok(biography.history.some(x=>x.sourceId==='chat:m-1'));
 const milestone=biography.history.find(x=>x.sourceId==='soul:j-task');
 assert.equal(milestone.at,'2026-11-08T14:00:00.000Z');
 assert.ok(!biography.history.some(x=>x.sourceId==='task:t-1'),
  'Task creation time must not be reported as completion time');
 assert.equal(biography.changes.length,1);
 assert.equal(JSON.stringify(state),before,'Scanning cannot mutate user data');
 assert.ok(existsSync(join(dir,'supermind-state.json')));
 const persisted=readFileSync(join(dir,'supermind-state.json'),'utf8');
 assert.ok(!persisted.includes('Секретная переписка'));
 assert.equal((await core.scan()).changed,false,'Unchanged sources are not reprocessed');
 soul.settings.tone='деловой';
 assert.equal((await core.scan()).changed,true);
 assert.equal(core.autobiography().changes.length,2);
 const reopened=new SuperMind(dir,deps);
 assert.equal(reopened.status().identityRevisions,2);
 assert.ok(reopened.autobiography().history.some(x=>x.sourceId==='soul:j-task'));
});
test('Social interpretation returns uncertainty instead of claiming knowledge of real feelings',()=>{
 const debug=assessIntent('У меня ошибка запуска и чёрный экран');
 assert.equal(debug.intent,'debug');
 assert.equal(debug.confidence,'moderate');
 const mixed=assessIntent('Придумай план проекта');
 assert.equal(mixed.confidence,'low');
 assert.equal(mixed.ambiguous,true);
 assert.equal(assessIntent('').intent,'unknown');
 assert.match(assessIntent('Я переживаю').statement,/не чтение мыслей/);
});
test('Scientific investigation requires explicit test observation and owner approval for wisdom',async t=>{
 const {core,dir,deps}=fixture(t);
 const investigation=await core.newInquiry({question:'Почему Tsukirei показывает чёрный экран после запуска?'});
 assert.equal(investigation.hypotheses.length,3);
 assert.equal(investigation.origin,'template');
 assert.ok(investigation.hypotheses.every(h=>h.outcome==='untested'));
 await assert.rejects(core.approveWisdom({inquiryId:investigation.id,
  hypothesisId:investigation.hypotheses[0].id,
  principle:'Сначала проверять фактические результаты тестов'}),/успешным тестом/);
 const hypothesis=investigation.hypotheses[0];
 await assert.rejects(core.testHypothesis(investigation.id,hypothesis.id,{
   result:'supports',note:'не проверено'}),/осмысленный/);
 const response=await core.testHypothesis(investigation.id,hypothesis.id,{
  result:'supports',note:'На локальных примерах связь с набором данных воспроизведена'});
 assert.equal(response.outcome,'supports');
 assert.match(response.provenance,/сообщил владелец/);
 const wisdom=await core.approveWisdom({inquiryId:investigation.id,hypothesisId:hypothesis.id,
  principle:'Проверять входные данные на контрольном примере перед изменением кода'});
 assert.match(core.prompt(),/Проверять входные данные/);
 assert.equal(core.status().wisdom,1);
 await core.testHypothesis(investigation.id,hypothesis.id,{
  result:'refutes',note:'Повторная проверка с контрольной выборкой опровергла гипотезу'});
 assert.equal(core.status().wisdom,0,'New contrary evidence automatically revokes the principle');
 assert.equal(core.prompt(),'');
 const reopened=new SuperMind(dir,deps);
 assert.equal(reopened.status().wisdom,0);
});
test('User-supplied hypotheses are bounded; generated plans never execute scripts',async t=>{
 const {core}=fixture(t);
 const inquiry=await core.newInquiry({question:'Как выбрать безопасную архитектуру памяти?',
  hypotheses:[
   {claim:'Портативная база быстрее на тестах',test:'Измерить скорость на одинаковых примерах',
    expected:'Среднее время выполнения уменьшается'},
   {claim:'Внешний сервис надёжнее локального',test:'Сравнить доступность при отключённом интернете',
    expected:'Результаты отличаются в сетевом режиме'}
  ]});
 assert.equal(inquiry.hypotheses.length,2);
 assert.equal(inquiry.origin,'user');
 await assert.rejects(core.newInquiry({question:'Коротко'}),/осмысленный/);
 await assert.rejects(core.newInquiry({question:'Объясни, какой вариант работает лучше?',
  hypotheses:[{claim:'Один',test:'Без теста',expected:'Ничего'}]}),/2–4/);
 assert.equal(core.status().cloudRequests,0);
});
test('Counterfactual and multi-strategy scores use explicit user numbers, not invented measurements',async t=>{
 const {core}=fixture(t);
 const options=[
  {name:'Вариант локальный',quality:8,effort:4,cost:1,risk:2,
   assumptions:'Потребуется контролировать локальную установку'},
  {name:'Вариант облачный',quality:9,effort:2,cost:7,risk:7,
   assumptions:'Потребуется платный доступ и постоянный интернет'}
 ];
 const result=await core.compareStrategies({question:'Как выбрать память для локального проекта?',options});
 assert.equal(result.options.length,2);
 assert.ok(result.options.every(o=>o.score>=0&&o.score<=100));
 assert.equal(result.options[0].name,'Вариант локальный');
 assert.equal(result.alternativeWinner,'Вариант локальный');
 assert.match(result.notes,/условный/);
 assert.equal(rankStrategies(options)[0].score,result.options[0].score);
 assert.throws(()=>core.compareStrategies({question:'Как выбрать память для локального проекта?',
  options:[{...options[0],risk:11},options[1]]}),/диапазон/);
 assert.throws(()=>core.compareStrategies({question:'Как выбрать память для локального проекта?',options:[options[0]]}),/2–4/);
});
test('Governor prevents unbounded deep review, preserves Soul identity and supports toggles',async t=>{
 const {core}=fixture(t);
 await assert.rejects(core.settings({reviewLimit:300}),/1–5/);
 await assert.rejects(core.settings({enabled:'yes'}),/boolean/);
 await core.settings({enabled:false,showExpression:false,reviewLimit:2});
 const snapshot=await core.workspace();
 assert.equal(snapshot.settings.showExpression,false);
 assert.equal(snapshot.governor.maxLocalReviewSteps,2);
 assert.equal((await core.scan()).skipped,'Синхронизация отключена');
 assert.equal(snapshot.identity.name,'Цукирэй');
 assert.equal(snapshot.innerWorld.soulProfile.address,'хозяин');
 await core.settings({enabled:true});
 assert.equal((await core.scan()).changed,true);
});
