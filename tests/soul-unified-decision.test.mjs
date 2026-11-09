import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('unified decision ranks accepted commitments and active goals without changing state',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-unified-'));
 let soul=new SoulEngine(dir);
 try{
  const goal=await soul.createPlannedGoal('Проверить стабильность','manual:goal',['Собрать логи']);
  await soul.decidePlannedGoal(goal.id,'active');
  const commitment=await soul.addCommitment('Исправить отчёт','manual:commitment');
  await soul.decideCommitment(commitment.id,'accepted');
  const before=JSON.stringify(soul.plannedGoalsReport());
  const report=soul.unifiedDecisionReport();
  assert.equal(report.top.kind,'goal');
  assert.equal(report.items.some(x=>x.kind==='accepted-commitment'),true);
  assert.equal(JSON.stringify(soul.plannedGoalsReport()),before);
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.unifiedDecisionReport().top.kind,'goal');
  await soul.changeSettings({personalContext:false});
  assert.equal(soul.unifiedDecisionReport().enabled,false);
  assert.deepEqual(soul.unifiedDecisionReport().items,[]);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
