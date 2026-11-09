import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('stalled plan creates proposal; only explicit approval adds a step',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-plan-review-'));
 let soul=new SoulEngine(dir);
 try{
  const goal=await soul.createPlannedGoal('Проверить качество','manual:goal',['Собрать измерения']);
  await soul.decidePlannedGoal(goal.id,'active');
  soul.close();
  const path=join(dir,'soul-state.json'),state=JSON.parse(readFileSync(path,'utf8'));
  state.plannedGoals[0].updatedAt=new Date(Date.now()-9*86400000).toISOString();
  writeFileSync(path,JSON.stringify(state));
  soul=new SoulEngine(dir);
  assert.equal((await soul.reviewPlannedGoals()).created,1);
  assert.equal((await soul.reviewPlannedGoals()).created,0);
  assert.equal(soul.plannedGoalsReport().items[0].steps.length,1);
  const review=soul.planReviewReport().items[0];
  await soul.decidePlanReview(review.id,'accepted');
  assert.equal(soul.plannedGoalsReport().items[0].steps.length,2);
  await assert.rejects(soul.decidePlanReview(review.id,'accepted'));
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.plannedGoalsReport().items[0].steps.length,2);
  await soul.changeSettings({personalContext:false});
  assert.deepEqual(soul.planReviewReport().items,[]);
  assert.equal((await soul.reviewPlannedGoals()).created,0);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
