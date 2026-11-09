import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundScheduler} from '../server/background-scheduler.ts';

test('scheduler prevents concurrent execution of the same task',async()=>{
 const s=new BackgroundScheduler();let count=0;let release;
 const gate=new Promise(resolve=>{release=resolve;});
 s.add({name:'memory',intervalMs:60000,run:async()=>{count++;await gate;}});
 const first=s.run('memory');
 assert.equal(await s.run('memory'),false);
 release();assert.equal(await first,true);assert.equal(count,1);
 s.close();
});
test('scheduler records failures and continues on subsequent runs',async()=>{
 const s=new BackgroundScheduler();let attempts=0;
 s.add({name:'check',intervalMs:60000,run:()=>{if(++attempts===1)throw Error('test failure');}});
 assert.equal(await s.run('check'),false);
 assert.match(s.status()[0].lastError,/test failure/);
 assert.equal(await s.run('check'),true);
 assert.equal(s.status()[0].lastError,null);
 s.close();
});
test('closed scheduler cannot execute jobs',async()=>{
 const s=new BackgroundScheduler();let called=false;
 s.add({name:'closed',intervalMs:60000,run:()=>{called=true;}});
 s.close();assert.equal(await s.run('closed'),false);assert.equal(called,false);
});
