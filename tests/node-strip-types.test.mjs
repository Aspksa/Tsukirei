import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const serverDir=new URL('../server/',import.meta.url);
test('server TypeScript avoids constructor parameter properties unsupported by Node strip-types',()=>{
 for(const file of readdirSync(serverDir).filter(name=>name.endsWith('.ts'))){
  const source=readFileSync(new URL(file,serverDir),'utf8');
  const constructors=[...source.matchAll(/constructor\s*\(([^)]*)\)/g)];
  for(const match of constructors){
   assert.doesNotMatch(match[1],/\b(?:public|private|protected|readonly)\s+\w+\s*:/,file);
  }
 }
});
test('unified cores preserve their constructor dependencies as ordinary fields',()=>{
 const source=readFileSync(new URL('../server/unified-cores.ts',import.meta.url),'utf8');
 for(const field of ['soul','supermind','living','cognition']){
  assert.match(source,new RegExp('this\\.'+field+'\\s*=\\s*'+field));
 }
});
