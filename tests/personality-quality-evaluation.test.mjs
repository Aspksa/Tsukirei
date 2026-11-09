import test from 'node:test';
import assert from 'node:assert/strict';
import {feedbackQuality} from '../server/personality-evaluation.ts';
import {SoulEngine} from '../server/soul.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('feedback trend requires evidence in both windows',()=>{
 const now=new Date('2026-11-09T12:00:00Z');
 const event=(age,rating,id)=>({at:new Date(now.getTime()-age*86400000).toISOString(),rating,sourceId:id});
 const previous=Array.from({length:5},(_,i)=>event(40,i===0?'positive':'negative','old-'+i));
 const current=Array.from({length:5},(_,i)=>event(5,i===0?'negative':'positive','new-'+i));
 const result=feedbackQuality([...previous,...current],now);
 assert.equal(result.previous.positiveRate,20);
 assert.equal(result.current.positiveRate,80);
 assert.equal(result.deltaPercentagePoints,60);
 assert.equal(result.trend,'improving');
 assert.equal(result.current.sourceIds.length,5);
 assert.equal(feedbackQuality(current,now).trend,'insufficient-data');
 assert.equal(feedbackQuality([...previous,...current,event(-1,'positive','future')],now).current.count,5);
});
test('real feedback events persist and quality report is honest about small samples',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-quality-'));
 let soul=new SoulEngine(dir);
 try{
  await soul.feedback('reply-1','positive');
  assert.equal(soul.qualityReport().current.count,1);
  assert.equal(soul.qualityReport().trend,'insufficient-data');
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.growthReport().quality.current.count,1);
  assert.deepEqual(soul.qualityReport().current.sourceIds,['chat:reply-1']);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
