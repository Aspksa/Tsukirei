import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('character evolution requires comparable evidence and survives restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-evolution-'));
 let soul=new SoulEngine(dir);
 try{
  const noEvidence=await soul.reviewCharacterEvolution();
  assert.equal(noEvidence.event.status,'insufficient-evidence');
  soul.close();
  const path=join(dir,'soul-state.json');
  const state=JSON.parse(readFileSync(path,'utf8'));
  const now=Date.now();
  state.characterEvolution.lastReviewedAt=null;
  state.feedbackEvents=[
   ...Array.from({length:5},(_,i)=>({at:new Date(now-(i+1)*86400000).toISOString(),rating:'positive',sourceId:'chat:recent'+i})),
   ...Array.from({length:5},(_,i)=>({at:new Date(now-(i+31)*86400000).toISOString(),rating:'negative',sourceId:'chat:previous'+i}))
  ];
  writeFileSync(path,JSON.stringify(state));
  soul=new SoulEngine(dir);
  const review=await soul.reviewCharacterEvolution();
  assert.equal(review.event.status,'validated');
  assert.equal(soul.characterEvolutionReport().activeStrategy,review.event.strategy);
  assert.match(soul.prompt(),/Проверенная стратегия общения/);
  soul.close();soul=new SoulEngine(dir);
  assert.equal(soul.characterEvolutionReport().history[0].status,'validated');
  await soul.changeSettings({personalContext:false});
  assert.equal(soul.characterEvolutionReport().activeStrategy,null);
  assert.doesNotMatch(soul.prompt(),/Проверенная стратегия общения/);
 }finally{soul.close();rmSync(dir,{recursive:true,force:true});}
});
