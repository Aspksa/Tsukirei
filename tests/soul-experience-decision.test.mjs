import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('personality decision uses grounded negative feedback and survives restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-experience-'));
 let soul=new SoulEngine(dir);
 try{
  await soul.feedback('m1','negative');
  await soul.feedback('m2','negative');
  const decision=soul.experienceDecision();
  assert.equal(decision.focus,'исправление качества ответов');
  assert.deepEqual(decision.evidence,['chat:m2','chat:m1']);
  assert.match(soul.prompt(),/Текущий приоритет поведения/);
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.experienceDecision().focus,'исправление качества ответов');
  await soul.changeSettings({personalContext:false});
  assert.equal(soul.experienceDecision().enabled,false);
  assert.deepEqual(soul.reflectionGoalReport().history,[]);
  assert.deepEqual(soul.outreachInbox().items,[]);
  assert.doesNotMatch(soul.prompt(),/Текущий приоритет поведения/);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});

test('reflection disabled prevents background goal formation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-private-'));
 const soul=new SoulEngine(dir);
 try{
  await soul.changeSettings({reflectionsEnabled:false});
  const result=await soul.reflectOnGoals();
  assert.equal(result.created,0);
  assert.deepEqual(soul.reflectionGoalReport().history,[]);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
