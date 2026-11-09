import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('inner world retains sourced biography, mood and privacy after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-world-'));
 let soul=new SoulEngine(dir);
 try{
  await soul.observeCompletedTask('t1','Проверка проекта');
  await soul.observeExchange('m1','Запомни, что я предпочитаю короткие ответы','Поняла');
  await soul.feedback('m1','negative','Не выдумывай результаты');
  await soul.feedback('m2','negative');
  const before=soul.innerWorld();
  assert.equal(before.identity.name,'Цукирэй');
  assert.equal(before.emotionalModel.mood,'сосредоточенный');
  assert.ok(before.autobiography.some(x=>x.type==='task'));
  assert.ok(before.relationship.confirmedPreferences.length>0);
  soul.close();soul=new SoulEngine(dir);
  assert.ok(soul.innerWorld().autobiography.length>0);
  await soul.changeSettings({personalContext:false});
  const privateWorld=soul.innerWorld();
  assert.equal(privateWorld.autobiography.length,0);
  assert.equal(privateWorld.relationship.confirmedPreferences.length,0);
  assert.equal(privateWorld.aspirations.length,0);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
