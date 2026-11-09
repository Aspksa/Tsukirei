import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('proactive inbox is grounded, throttled, dismissible and persistent',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-outreach-'));
 let soul=new SoulEngine(dir);
 try{
  assert.equal((await soul.prepareOutreach()).created,0);
  await soul.observeExchange('a','Не запускается приложение','Нужны логи');
  await soul.observeExchange('b','Опять не запускается приложение','Проверим');
  const date=new Date(Date.now()+86400000);
  assert.equal((await soul.prepareOutreach(date)).created,1);
  let inbox=soul.outreachInbox();
  assert.equal(inbox.items.length,1);
  assert.equal(inbox.items[0].sourceIds.length,2);
  assert.equal((await soul.prepareOutreach(date)).created,0);
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.outreachInbox().items.length,1);
  await soul.dismissOutreach(inbox.items[0].id);
  assert.equal(soul.outreachInbox().items.length,0);
  await soul.changeSettings({initiativeEnabled:false});
  assert.equal((await soul.prepareOutreach(new Date(date.getTime()+86400000))).created,0);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
