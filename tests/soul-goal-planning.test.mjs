import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('goal planning requires approval and evidence, tracks progress and survives restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-goals-'));
 let soul=new SoulEngine(dir);
 try{
  const goal=await soul.createPlannedGoal('Улучшить запуск','manual:goal1',['Собрать логи','Проверить исправление']);
  assert.equal(goal.status,'proposed');
  await assert.rejects(soul.completePlannedStep(goal.id,goal.steps[0].id,'manual:verified'));
  await soul.decidePlannedGoal(goal.id,'active');
  await soul.completePlannedStep(goal.id,goal.steps[0].id,'manual:verified1');
  assert.equal(soul.plannedGoalsReport().items[0].progress.completed,1);
  await soul.completePlannedStep(goal.id,goal.steps[1].id,'task:verified2');
  assert.equal(soul.plannedGoalsReport().items[0].status,'completed');
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.plannedGoalsReport().items[0].progress.completed,2);
  await soul.changeSettings({personalContext:false});
  assert.deepEqual(soul.plannedGoalsReport().items,[]);
  await assert.rejects(soul.createPlannedGoal('Новая цель','manual:new',['Шаг']));
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
