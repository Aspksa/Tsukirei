import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('conversation plan uses confirmed interests and grounded recurring initiatives',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-dialogue-'));
 let soul=new SoulEngine(dir);
 try{
  await soul.addPreference('Общайся со мной естественно','confirmed','manual');
  await soul.addPreference('Люблю неподтверждённые слухи','suggested','chat:maybe');
  await soul.observeExchange('one','Сайт не запускается','Проверим');
  await soul.observeExchange('two','Опять не запускается','Нужны логи');
  let plan=soul.conversationPlan();
  assert.equal(plan.interests.length,1);
  assert.equal(plan.initiatives.length,1);
  assert.equal(plan.initiatives[0].sourceIds.length,2);
  assert.match(soul.conversationGuidance(),/Не утверждай/);
  soul.close();soul=new SoulEngine(dir);
  plan=soul.conversationPlan();
  assert.equal(plan.initiatives.length,1);
  await soul.changeSettings({initiativeEnabled:false,personalContext:false});
  plan=soul.conversationPlan();
  assert.equal(plan.initiatives.length,0);
  assert.equal(plan.interests.length,0);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
