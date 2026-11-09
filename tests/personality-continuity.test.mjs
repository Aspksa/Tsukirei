import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SoulEngine} from '../server/soul.ts';

test('personality remains stable across restart and only confirmed preferences shape it',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tsukirei-persona-'));
 let soul;
 try{
  soul=new SoulEngine(dir);
  const initial=soul.personalityProfile();
  assert.equal(initial.name,'Цукирэй');
  assert.equal(initial.consciousnessClaim,false);
  await soul.addPreference('Отвечай коротко и по существу','confirmed','manual');
  await soul.addPreference('Мне нравится необычная музыка','suggested','chat:test');
  await soul.feedback('message-1','negative','Проверяй точность ответа');
  const updated=soul.personalityProfile();
  assert.equal(updated.relationship.confirmedPreferences,1);
  assert.equal(updated.preferences.length,1);
  assert.equal(updated.reflections.length,1);
  assert.match(soul.prompt(),/Устойчивое самоописание/);
  soul.close();soul=null;
  const restored=new SoulEngine(dir);
  try{
   const after=restored.personalityProfile();
   assert.equal(after.character.tone,initial.character.tone);
   assert.equal(after.relationship.confirmedPreferences,1);
   assert.equal(after.reflections.length,1);
   assert.equal(after.consciousnessClaim,false);
  }finally{restored.close();}
 }finally{soul?.close();rmSync(dir,{recursive:true,force:true});}
});
