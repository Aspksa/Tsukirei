import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('Cognitive v1.1 APIs are offline, preserve history and expose only real processing', {timeout:45000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-cognitive-api-'));
 const child=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{
  cwd:process.cwd(),env:{...process.env,PORT:'0',TSUKIREI_DATA_DIR:dir,
    TSUKIREI_DATABASE_URL:'',DATABASE_URL:''},stdio:['ignore','pipe','pipe']
 });
 let base='',errors='';
 child.stdout.on('data',part=>{
  const hit=String(part).match(/http:\/\/127\.0\.0\.1:(\d+)\//);
  if(hit)base='http://127.0.0.1:'+hit[1];
 });
 child.stderr.on('data',part=>{errors+=String(part);});
 t.after(()=>{child.kill();rmSync(dir,{recursive:true,force:true,maxRetries:3});});
 for(let i=0;i<180&&!base;i++)await new Promise(r=>setTimeout(r,70));
 if(!base)throw Error('Server did not start: '+errors);
 const api=async(path,method='GET',body)=>{
  const res=await fetch(base+path,{method,
   headers:body===undefined?{}:{'Content-Type':'application/json'},
   body:body===undefined?undefined:JSON.stringify(body)});
  const value=await res.json();
  return{status:res.status,data:value};
 };
 assert.equal((await api('/api/health')).data.version,'1.2.0');
 assert.equal((await api('/api/cognition')).data.metrics.scans,0);
 const note=await api('/api/notes','POST',{title:'Модуль памяти',body:'Состояние: рабочее\nMemOS использует PostgreSQL.'});
 assert.equal(note.status,201);
 const task=await api('/api/tasks','POST',{title:'Проверить RAG'});
 assert.equal(task.status,201);
 const goal=await api('/api/cognition/goals','POST',{title:'Улучшить память Tsukirei',
   objective:'Проверить поиск и устранить ошибки на контрольных вопросах',
   priority:'high',taskIds:[task.data.task.id]});
 assert.equal(goal.status,201,JSON.stringify(goal.data));
 const run=await api('/api/cognition/scan','POST',{});
 assert.equal(run.status,200,JSON.stringify(run.data));
 assert.equal(run.data.result.changed,true);
 assert.ok(run.data.status.worldEdges>=1);
 assert.equal(run.data.status.metrics.scans,1);
 const world=await api('/api/cognition/world?q=memos');
 assert.equal(world.status,200);
 assert.ok(world.data.edges.some(e=>e.evidenceId==='note:'+note.data.note.id));
 const factList=await api('/api/cognition/facts');
 assert.equal(factList.status,200);
 const f=factList.data.items.find(x=>x.field==='Состояние');
 assert.ok(f);
 assert.equal(f.status,'proposed');
 assert.equal((await api('/api/cognition/facts/'+f.id,'PATCH',{action:'confirm'})).status,200);
 assert.equal((await api('/api/cognition/facts')).data.items.find(x=>x.id===f.id).status,'confirmed');
 const links=await api('/api/cognition/goals');
 assert.equal(links.data.items[0].progress.completed,0);
 assert.equal((await api('/api/tasks/'+task.data.task.id,'PATCH',{done:true})).status,200);
 const progress=await api('/api/cognition/goals');
 assert.equal(progress.data.items[0].progress.completed,1);
 assert.equal((await api('/api/cognition/goals/'+goal.data.goal.id,'PATCH',{status:'active'})).status,200);
 const time=await api('/api/cognition/timeline');
 assert.equal(time.status,200);
 assert.ok(time.data.items.some(x=>x.sourceId==='note:'+note.data.note.id));
 assert.ok(time.data.items.some(x=>x.type==='task'));
 const checks=await api('/api/cognition/assess','POST',{query:'Что нам известно об очень редкой гипотезе по птицам?',remember:true});
 assert.equal(checks.status,200);
 assert.equal(checks.data.cloudRequests,0);
 assert.equal(checks.data.assessment.level,'insufficient');
 assert.ok((await api('/api/cognition/questions')).data.items.some(x=>x.status==='open'));
 const question=(await api('/api/cognition/questions')).data.items[0];
 assert.equal((await api('/api/cognition/questions/'+question.id,'PATCH',{
  action:'resolve',resolution:'Проверено в исходном документе и подтверждено владельцем'})).status,200);
 const trace=(await api('/api/cognition')).data.trace;
 assert.ok(trace.some(x=>x.stage==='world'));
 assert.ok(trace.some(x=>x.stage==='complete'));
 const dream=await api('/api/cognition/dreams');
 assert.equal(dream.status,200);
 assert.equal((await fetch(base+'/api/cognition',{headers:{Origin:'https://external.example'}})).status,403);
 assert.equal((await api('/api/cognition/goals','POST',{title:'Задача',objective:'Подтверждённый результат',taskIds:['no-such-task']})).status,400);
 assert.equal((await api('/api/cognition/goals/'+goal.data.goal.id,'DELETE')).status,200);
 assert.equal((await api('/api/state')).data.tasks.length,1,'Deleting goal must not delete user task');
});
