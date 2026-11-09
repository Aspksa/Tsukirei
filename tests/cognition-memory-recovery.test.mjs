import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CognitiveCore} from '../server/cognition.ts';

const deps={read:async()=>({notes:[],tasks:[],messages:[]}),indexed:async()=>[]};
test('cognitive store survives restart and recovers from corrupted primary',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-cognition-'));
 try{
  const core=new CognitiveCore(dir,deps);
  const first=await core.addGoal({title:'Первая цель',objective:'Проверить сохранение данных'});
  await core.addGoal({title:'Вторая цель',objective:'Проверить резервное копирование'});
  const path=join(dir,'cognitive-state.json');
  assert.equal(existsSync(path+'.bak'),true);
  assert.equal((await new CognitiveCore(dir,deps).goals()).length,2);
  writeFileSync(path,'{broken');
  const recovered=new CognitiveCore(dir,deps);
  assert.equal((await recovered.goals()).length,1);
  assert.equal((await recovered.goals())[0].id,first.id);
  assert.equal(recovered.learningAudit().modelTrainingPerformed,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('world query returns bounded nodes and only edges with present endpoints',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-graph-'));
 try{
  const core=new CognitiveCore(dir,deps);
  const path=join(dir,'cognitive-state.json');
  const initial={version:1,goals:[],facts:[],gaps:[],timeline:[],nodes:[],edges:[],
   dreams:[],traces:[],metrics:{scans:0,factsObserved:0,duplicateGroups:0,links:0},
   lastScanAt:null,lastError:null,fingerprint:''};
  for(let i=0;i<450;i++)initial.nodes.push({id:'entity:'+i,label:'Тема '+i,kind:'entity'});
  for(let i=0;i<449;i++)initial.edges.push({from:'entity:'+i,to:'entity:'+(i+1),
   relation:'связано',evidenceId:'note:source',excerpt:'Проверка'});
  writeFileSync(path,JSON.stringify(initial));
  const loaded=new CognitiveCore(dir,deps);
  const small=loaded.world('',70);
  assert.equal(small.nodes.length,70);
  assert.equal(small.hasMore,true);
  assert.equal(small.totalNodes,450);
  assert.equal(small.edges.length,69);
  const large=loaded.world('',1000);
  assert.equal(large.nodes.length,450);
  assert.equal(large.edges.length,449);
  assert.equal(large.hasMore,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
