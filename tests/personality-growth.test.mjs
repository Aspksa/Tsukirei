import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('personality growth records sourced local reviews, throttles and persists across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-growth-'));
 let soul=new SoulEngine(dir);
 try{
  await soul.observeExchange('exchange-1','Запомни, что отвечать нужно кратко','Принято');
  await soul.feedback('exchange-1','negative','Проверяй факты перед ответом');
  const first=await soul.reviewGrowth();
  assert.equal(first.reviewed,true);
  assert.equal(first.event.signals.chats,1);
  assert.ok(first.event.sourceIds.includes('chat:exchange-1'));
  const again=await soul.reviewGrowth();
  assert.match(again.skipped,/24 часа/);
  assert.equal(soul.growthReport().reviews,1);
  assert.equal(soul.personalityProfile().growth.reviews,1);
  soul.close();
  soul=new SoulEngine(dir);
  assert.equal(soul.growthReport().reviews,1);
  assert.equal(soul.growthReport().history.length,1);
  const forced=await soul.reviewGrowth(true);
  assert.equal(forced.reviewed,true);
  assert.equal(soul.growthReport().reviews,2);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
test('growth can be disabled without changing memory',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-growth-disabled-'));
 const soul=new SoulEngine(dir);
 try{
  await soul.changeSettings({reflectionsEnabled:false});
  const result=await soul.reviewGrowth(true);
  assert.match(result.skipped,/отключена/);
  assert.equal(soul.growthReport().reviews,0);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
