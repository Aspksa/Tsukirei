import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('growth objectives reflect recorded events and survive restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-objectives-'));
 let soul=new SoulEngine(dir);
 try{
  let report=soul.growthObjectives();
  assert.equal(report.objectives.length,5);
  assert.ok(report.objectives.every(o=>o.progress===0));
  await soul.feedback('reply-1','negative','Проверяй источники перед ответом');
  await soul.observeCompletedTask('task-1','Завершить проверку');
  await soul.reviewGrowth(true);
  report=soul.growthObjectives();
  assert.equal(report.objectives.find(o=>o.id==='feedback-quality').value,1);
  assert.equal(report.objectives.find(o=>o.id==='reflection-habit').value,1);
  assert.equal(report.objectives.find(o=>o.id==='correction-memory').value,1);
  assert.equal(report.objectives.find(o=>o.id==='task-history').value,1);
  assert.equal(report.automaticCompletion,false);
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.growthReport().objectives.find(o=>o.id==='feedback-quality').value,1);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
