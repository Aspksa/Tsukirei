import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('reflection plans give sourced options and risks without executing actions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-plans-'));
 let soul=new SoulEngine(dir);
 try{
  await soul.observeExchange('a','Не запускается сайт','Проверим');
  await soul.observeExchange('b','Опять не запускается сайт','Нужны логи');
  await soul.reflectOnGoals();
  let report=soul.reflectionActionPlans();
  assert.equal(report.items.length,1);
  assert.equal(report.items[0].sourceIds.length,2);
  assert.equal(report.items[0].options.length,2);
  assert.ok(report.items[0].options.every(o=>o.risk&&o.benefit));
  assert.equal(report.items[0].requiresOwnerApproval,true);
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.reflectionActionPlans().items.length,1);
  await soul.changeSettings({personalContext:false});
  assert.equal(soul.reflectionActionPlans().items.length,0);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
