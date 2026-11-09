import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CognitiveCore,assessEvidence} from '../server/cognition.ts';

function setup(t){
  const dir=mkdtempSync(join(tmpdir(),'tsukirei-cognitive-'));
  const state={
    notes:[
      {id:'n-1',title:'Tsukirei',body:'База: PostgreSQL\nСостояние: работает\nMemOS использует PostgreSQL.',
        createdAt:'2026-01-11T11:30:00Z'},
      {id:'n-2',title:'Tsukirei',body:'База: SQLite\nСостояние: работает',
        createdAt:'2026-02-12T11:30:00Z'},
      {id:'n-3',title:'Руководство',body:'Эта техническая инструкция повторяется и помогает с поиском знаний.',
        createdAt:'2026-03-10T09:00:00Z'},
      {id:'n-4',title:'Руководство',body:'Эта техническая инструкция повторяется и помогает с поиском знаний.',
        createdAt:'2026-03-11T09:00:00Z'}
    ],
    tasks:[
      {id:'t-1',title:'Проверить RAG',done:false,createdAt:'2026-05-04T11:00:00Z'},
      {id:'t-2',title:'Исправить индекс',done:true,createdAt:'2026-05-05T11:00:00Z'}
    ],
    messages:[
      {id:'m-1',role:'user',content:'Что мы решили о памяти?',createdAt:'2026-07-11T11:00:00Z'},
      {id:'m-2',role:'assistant',content:'Нужно уточнить источники.',createdAt:'2026-07-11T11:01:00Z'}
    ]
  };
  const indexed=[{key:'knowledge:k-1:0',kind:'knowledge',title:'RAG',
    content:'Graphiti зависит от MemOS.',createdAt:'2026-08-01T00:00:00Z'}];
  const deps={read:async()=>state,indexed:async()=>indexed,now:()=>new Date('2026-11-09T12:00:00Z')};
  const core=new CognitiveCore(dir,deps);
  t.after(()=>rmSync(dir,{recursive:true,force:true,maxRetries:3}));
  return {dir,state,indexed,core,deps};
}
test('Metacognition scores retrieval coverage, not factual truth',()=>{
  const none=assessEvidence('Как работает новый индекс памяти?',[]);
  assert.equal(none.level,'insufficient');
  assert.equal(none.coverage,0);
  assert.match(none.explanation,/не вероятность истинности/);
  const supported=assessEvidence('PostgreSQL память',[
    {kind:'note',id:'a',title:'PostgreSQL',content:'Система хранит память.'},
    {kind:'knowledge',id:'b',title:'Архитектура',content:'PostgreSQL содержит память и документы.'}
  ]);
  assert.equal(supported.level,'supported');
  assert.equal(supported.sourceCount,2);
  assert.ok(supported.coverage>=70);
  const single=assessEvidence('PostgreSQL память',[
    {kind:'note',id:'a',title:'PostgreSQL',content:'Система хранит память.'}
  ]);
  assert.equal(single.level,'partial');
  assert.ok(single.warnings.some(x=>x.includes('один источник')));
});
test('World and chronological memory contain only real source relationships and dates',async t=>{
  const {core}=setup(t);
  assert.equal((await core.scan()).changed,true);
  const world=core.world();
  assert.ok(world.edges.some(e=>e.relation==='использует'&&e.evidenceId==='note:n-1'));
  assert.ok(world.edges.some(e=>e.relation==='зависит от'&&e.evidenceId==='rag:knowledge:k-1:0'));
  assert.ok(!world.edges.some(e=>e.evidenceId==='chat:made-up'));
  assert.ok(world.nodes.length>=3);
  assert.ok(core.world('memos').edges.length>=1);
  const timeline=core.timeline();
  assert.ok(timeline.some(e=>e.type==='note'&&e.sourceId==='note:n-1'&&e.at==='2026-01-11T11:30:00.000Z'));
  assert.ok(timeline.some(e=>e.type==='message'&&e.sourceId==='chat:m-1'));
  assert.ok(timeline.every(e=>e.observedAt&&e.at));
  assert.equal(timeline[0].at,'2026-07-11T11:01:00.000Z');
  const initial=core.status().metrics.scans;
  assert.equal((await core.scan()).changed,false);
  assert.equal(core.status().metrics.scans,initial);
  assert.ok(core.status().trace.some(e=>e.stage==='temporal'));
  assert.ok(core.status().trace.some(e=>e.stage==='world'));
  assert.ok(core.status().trace.every(e=>Number.isFinite(e.durationMs)));
});
test('Long-term goals are linked to real tasks and progress is derived, not invented',async t=>{
  const {core,state}=setup(t);
  const goal=await core.addGoal({title:'Повысить качество RAG',
    objective:'Пройти 50 тестовых вопросов с подтверждёнными ссылками',
    priority:'high',taskIds:['t-1','t-2']});
  assert.equal(goal.status,'planned');
  let view=(await core.goals())[0];
  assert.equal(view.progress.linked,2);
  assert.equal(view.progress.completed,1);
  state.tasks[0].done=true;
  view=(await core.goals())[0];
  assert.equal(view.progress.completed,2);
  await core.changeGoal(goal.id,{status:'active',priority:'normal'});
  assert.match(core.prompt(),/Пройти 50 тестовых/);
  await assert.rejects(core.addGoal({title:'Второе',objective:'Выполнить проверяемые действия',taskIds:['bad-id']}),/существующие/);
  const scan=await core.scan();
  assert.ok(scan.changed);
  assert.ok(core.world().edges.some(e=>e.evidenceId==='goal:'+goal.id));
  await core.removeGoal(goal.id);
  assert.equal(state.tasks.length,2);
  assert.equal((await core.goals()).length,0);
  assert.equal(core.prompt(),'');
});
test('Facts require approval, preserve previous versions and refuse missing sources',async t=>{
  const {core,state,dir,deps}=setup(t);
  await core.scan();
  const facts=core.facts().filter(f=>f.key==='tsukirei::база');
  assert.equal(facts.length,2);
  assert.ok(facts.every(f=>f.status==='proposed'));
  const pg=facts.find(f=>f.value==='PostgreSQL'),sql=facts.find(f=>f.value==='SQLite');
  assert.ok(pg);assert.ok(sql);
  await core.decideFact(pg.id,'confirm');
  assert.match(core.prompt(),/PostgreSQL/);
  await core.decideFact(sql.id,'confirm');
  const after=core.facts();
  assert.equal(after.find(f=>f.id===pg.id).status,'superseded');
  assert.equal(after.find(f=>f.id===sql.id).status,'confirmed');
  assert.ok(core.timeline().some(e=>e.type==='fact'));
  const reopened=new CognitiveCore(dir,deps);
  assert.equal(reopened.facts().find(f=>f.id===sql.id).status,'confirmed');
  // A new candidate cannot be confirmed after the original is deleted.
  state.notes.push({id:'n-5',title:'Tsukirei',body:'База: MariaDB',createdAt:'2026-11-08T10:00:00Z'});
  await core.scan();
  const next=core.facts().find(f=>f.value==='MariaDB');
  assert.ok(next);
  state.notes=state.notes.filter(x=>x.id!=='n-5');
  await assert.rejects(core.decideFact(next.id,'confirm'),/изменилась или удалена/);
  await core.scan();
  assert.equal(core.facts().find(f=>f.id===next.id).status,'source_missing');
  assert.equal(core.facts().find(f=>f.id===sql.id).status,'confirmed');
});
test('Active learning tracks missing evidence questions and requires a source to resolve',async t=>{
  const {core}=setup(t);
  const question='Почему PostgreSQL медленно отвечает на большой запрос?';
  const assessment=assessEvidence(question,[]);
  assert.equal((await core.registerGap(question,assessment)).frequency,1);
  assert.equal((await core.registerGap(question,assessment)).frequency,2);
  const gap=core.questions()[0];
  assert.equal(core.status().gaps,1);
  await assert.rejects(core.resolveGap(gap.id,'resolve','готово'),/источник/);
  await core.resolveGap(gap.id,'resolve','Проверено тестами PostgreSQL на демо-таблице');
  assert.equal(core.status().gaps,0);
  assert.equal((await core.registerGap(question,{...assessment,level:'partial'})),null);
  await core.registerGap(question,assessment);
  assert.equal(core.questions().filter(x=>x.status==='open').length,1);
});
test('Dreaming detects duplicates and never changes user data, with bounded trace',async t=>{
  const {core,state,dir}=setup(t);
  const original=JSON.stringify(state);
  const result=await core.scan();
  assert.equal(result.duplicateGroups,1);
  assert.equal(core.dreams()[0].sourceIds.length,2);
  assert.equal(JSON.stringify(state),original);
  assert.ok(existsSync(join(dir,'cognitive-state.json')));
  const raw=readFileSync(join(dir,'cognitive-state.json'),'utf8');
  assert.ok(!raw.includes('apiKey'));
  for(let i=0;i<5;i++)await core.scan(true);
  assert.ok(core.status().trace.length<=125);
});
