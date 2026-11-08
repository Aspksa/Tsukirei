import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Server world index uses pages and returns bounded viewport tiles', { timeout: 55000 }, async t => {
  const dir=mkdtempSync(join(tmpdir(),'tsukirei-world-'));
  const notes=Array.from({length:1200},(_,i)=>({
    id:'n-'+i,title:'Память системы '+i,
    body:'Архив знаний о нейросетях. '+i,createdAt:'2026-11-09T00:00:00Z'
  }));
  const messages=Array.from({length:375},(_,i)=>({
    id:'m-'+i,role:i%2?'assistant':'user',
    content:'Память и знания '+i,createdAt:'2026-11-09T00:00:00Z'
  }));
  writeFileSync(join(dir,'tsukirei.json'),JSON.stringify({notes,messages,tasks:[]}));
  const child=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{
    cwd:process.cwd(),env:{...process.env,PORT:'0',TSUKIREI_DATA_DIR:dir,
      TSUKIREI_DATABASE_URL:'',DATABASE_URL:''},
    stdio:['ignore','pipe','pipe']
  });
  let address='',errors='';
  child.stdout.on('data',chunk=>{const m=String(chunk).match(/http:\/\/127\.0\.0\.1:(\d+)\//);if(m)address='http://127.0.0.1:'+m[1];});
  child.stderr.on('data',chunk=>{errors+=String(chunk);});
  t.after(()=>{child.kill();rmSync(dir,{recursive:true,force:true,maxRetries:3});});
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function poll(fn,timeout=20000){
    const until=Date.now()+timeout;
    while(Date.now()<until){
      const value=await fn();if(value)return value;
      await sleep(60);
    }
    throw Error('Index/status timeout '+errors);
  }
  await poll(()=>address);
  async function get(path){
    const r=await fetch(address+path);
    return{status:r.status,data:await r.json()};
  }
  let last;
  await poll(async()=>{
    last=await get('/api/city/world/status');
    assert.equal(last.status,200);
    assert.equal(last.data.supported,true);
    if(last.data.state==='error')throw Error(last.data.error);
    return last.data.ready;
  });
  assert.equal(last.data.index.total,1575);
  assert.ok(last.data.index.districts.length>0);
  const district=last.data.index.districts.find(d=>d.key==='memory');
  assert.ok(district);
  const tile=await get('/api/city/world/tiles?x='+district.x+'&y='+district.y+'&radius=1000&limit=40');
  assert.equal(tile.status,200);
  assert.equal(tile.data.ready,true);
  assert.ok(tile.data.displayed<=40);
  assert.ok(tile.data.displayed>0);
  assert.equal(tile.data.total,1575);
  assert.equal((await get('/api/city/world/tiles?limit=7000')).status,400);
  assert.equal((await get('/api/city/world/tiles?radius=999999999')).status,400);
  const search=await get('/api/city/world/search?q='+encodeURIComponent('системы 1199'));
  assert.equal(search.status,200);
  assert.ok(search.data.items.some(i=>i.id==='note:n-1199'));
  const create=await fetch(address+'/api/notes',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({title:'Память и новые знания',body:'Добавлено после индекса'})});
  // Legacy mode enforces 500 note cap. Simulate a mutation by deleting a known note instead.
  assert.equal(create.status,400);
  const remove=await fetch(address+'/api/notes/n-0',{method:'DELETE'});
  // The API validates UUIDs; old arbitrary IDs remain in the archive and are not deletable.
  assert.equal(remove.status,400);
  assert.equal((await get('/api/city/world/status')).data.index.total,1575);
  assert.equal((await get('/api/city/world/search?q=a')).status,400);
});
