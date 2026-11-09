import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('accepted commitment completes only on its explicitly linked task',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-task-link-'));
 let soul=new SoulEngine(dir);
 try{
  const item=await soul.addCommitment('Проверить запуск','manual:owner');
  await assert.rejects(soul.linkCommitmentTask(item.id,'task1'));
  await soul.decideCommitment(item.id,'accepted');
  await soul.linkCommitmentTask(item.id,'task1');
  assert.equal((await soul.reconcileCompletedTask('other')).completed,0);
  assert.equal(soul.commitmentReport().items[0].status,'accepted');
  assert.equal((await soul.reconcileCompletedTask('task1')).completed,1);
  assert.equal((await soul.reconcileCompletedTask('task1')).completed,0);
  assert.deepEqual(soul.commitmentReport().items[0].evidenceIds,['task:task1']);
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.commitmentReport().items[0].status,'completed');
  await soul.changeSettings({personalContext:false});
  assert.equal((await soul.reconcileCompletedTask('task1')).completed,0);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
