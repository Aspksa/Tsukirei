import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('reflection goals are sourced, persisted, throttled and respect settings',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-reflect-'));
 let soul=new SoulEngine(dir);
 try{
  await soul.observeExchange('one','Не запускается сайт','Проверю логи');
  await soul.observeExchange('two','Сайт не запускается','Нужна диагностика');
  const first=await soul.reflectOnGoals();
  assert.equal(first.created,1);
  assert.equal(first.goals[0].sourceIds.length,2);
  assert.equal((await soul.reflectOnGoals()).created,0);
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.reflectionGoalReport().history.length,1);
  assert.equal((await soul.reflectOnGoals(new Date(Date.now()+2*86400000))).created,0);
  await soul.changeSettings({reflectionsEnabled:false});
  assert.equal((await soul.reflectOnGoals(new Date(Date.now()+9*86400000))).created,0);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
