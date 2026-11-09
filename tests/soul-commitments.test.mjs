import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('commitments require explicit acceptance and evidence, persist and respect privacy',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-commitments-'));
 let soul=new SoulEngine(dir);
 try{
  const proposal=await soul.addCommitment('Проверить проект','manual:request1');
  assert.equal(proposal.status,'proposed');
  await assert.rejects(soul.decideCommitment(proposal.id,'completed','manual:verified'));
  await soul.decideCommitment(proposal.id,'accepted');
  assert.match(soul.prompt(),/Принятые, но не завершённые обязательства/);
  await assert.rejects(soul.decideCommitment(proposal.id,'completed'));
  await soul.decideCommitment(proposal.id,'completed','task:verified1');
  assert.equal(soul.commitmentReport().items[0].status,'completed');
  await assert.rejects(soul.decideCommitment(proposal.id,'accepted'));
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.commitmentReport().items[0].evidenceIds[0],'task:verified1');
  await soul.changeSettings({personalContext:false});
  assert.deepEqual(soul.commitmentReport().items,[]);
  await assert.rejects(soul.addCommitment('Новая задача','manual:new'));
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
