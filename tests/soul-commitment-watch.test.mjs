import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('watch flags stale accepted commitments, avoids duplicates and respects privacy',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-watch-'));
 let soul=new SoulEngine(dir);
 try{
  const item=await soul.addCommitment('Проверить отчёт','manual:request');
  await soul.decideCommitment(item.id,'accepted');
  soul.close();
  const path=join(dir,'soul-state.json');
  const state=JSON.parse(readFileSync(path,'utf8'));
  state.commitments[0].updatedAt=new Date(Date.now()-9*86400000).toISOString();
  writeFileSync(path,JSON.stringify(state));
  soul=new SoulEngine(dir);
  assert.equal((await soul.reviewCommitments()).created,1);
  assert.equal((await soul.reviewCommitments()).created,0);
  const reminder=soul.commitmentWatchReport().items[0];
  assert.equal(reminder.commitmentId,item.id);
  await soul.dismissCommitmentWatch(reminder.id);
  assert.equal(soul.commitmentWatchReport().items.length,0);
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.commitmentWatchReport().items.length,0);
  await soul.changeSettings({personalContext:false});
  assert.equal((await soul.reviewCommitments()).created,0);
  assert.deepEqual(soul.commitmentWatchReport().items,[]);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
