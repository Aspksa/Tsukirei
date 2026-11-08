import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(get, name, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const value = await get(); if (value) return value; }
    catch { /* starting up */ }
    await pause(180);
  }
  throw new Error('Timed out: ' + name);
}
function binary() {
  for (const name of [process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','google-chrome','chromium']) {
    if (!name) continue;
    if (name.startsWith('/') && existsSync(name)) return name;
    if (!name.startsWith('/') && spawnSync('which', [name]).status === 0) return name;
  }
  throw new Error('Chrome/Chromium not available');
}
const dir=mkdtempSync(join(tmpdir(),'tsukirei-browser-')), profile=join(dir,'chrome'), children=[];
try {
  const server=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{
    cwd:process.cwd(),env:{...process.env,PORT:'0',TSUKIREI_DATA_DIR:dir,
      TSUKIREI_DATABASE_URL:'',DATABASE_URL:''},stdio:['ignore','pipe','pipe']
  });
  children.push(server);
  let base='', stderr='';
  server.stdout.on('data',x=>{const match=String(x).match(/http:\/\/127\.0\.0\.1:(\d+)\//);if(match)base='http://127.0.0.1:'+match[1];});
  server.stderr.on('data',x=>{stderr+=String(x);});
  await until(()=>base,'server');
  const added=await fetch(base+'/api/notes',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({
      title:'Архитектура памяти',body:'Реальная запись для проверки трёхмерного города'})});
  assert.equal(added.status,201,stderr);
  const chrome=spawn(binary(),['--headless=new','--no-sandbox','--disable-dev-shm-usage',
    '--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
    '--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,
    '--window-size=1365,900',base+'/'],{stdio:['ignore','ignore','pipe']});
  children.push(chrome);
  let chromeError='';
  chrome.stderr.on('data',x=>{chromeError=String(x).slice(-1800);});
  const port=await until(()=>{
    const f=join(profile,'DevToolsActivePort');
    if(!existsSync(f))return null;
    const n=Number(readFileSync(f,'utf8').split(/\r?\n/)[0]);return n>0?n:null;
  },'DevTools port');
  const url=await until(async ()=>{
    const list=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    return list.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
  },'DevTools tab');
  const ws=new WebSocket(url);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  const pending=new Map(),errors=[];let id=0;
  ws.addEventListener('message',e=>{
    const data=JSON.parse(e.data);
    if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails?.text||'Exception');
    if(data.id&&pending.has(data.id)){
      const p=pending.get(data.id);pending.delete(data.id);
      data.error?p.reject(Error(data.error.message)):p.resolve(data.result);
    }
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const token=++id;pending.set(token,{resolve,reject});ws.send(JSON.stringify({id:token,method,params}));
  });
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails){ const d=result.exceptionDetails; throw Error([d.text,d.exception?.description,JSON.stringify(d.stackTrace?.callFrames || [])].filter(Boolean).join('\n')); }
    return result.result?.value;
  };
  await send('Runtime.enable');await send('Page.enable');
  await until(()=>evaluate("document.readyState === 'complete' && document.getElementById('status-text')?.textContent !== 'Подключение...'"),'UI load');
  await evaluate("document.querySelector('.nav-button[data-page=city]').click(); true");
  await until(async ()=>{
    const text=await evaluate("document.getElementById('city-load-status')?.textContent || ''");
    return text.includes('Полный архив') ? text : null;
  },'full city archive');
  // Search the actual city data, not a mocked demonstration list.
  await evaluate("(() => { const el=document.getElementById('city-search-input');el.value='Архитектура';el.dispatchEvent(new Event('input',{bubbles:true}));return true; })()");
  await until(() => evaluate("document.querySelectorAll('.city-search-result').length === 1"), 'city search results');
  await evaluate("document.querySelector('.city-search-result').click(); true");
  const foundTitle = await evaluate("document.querySelector('.city-detail-title')?.textContent || ''");
  assert.match(foundTitle, /Архитектура памяти/);
  // Select a real city district, then resolve full text through the local API.
  await evaluate("document.querySelector('.city-district-button').click(); true");
  await until(() => evaluate("!!document.querySelector('.city-full-button')"), 'selected building');
  await evaluate("document.querySelector('.city-full-button').click(); true");
  await until(async () => {
    const text = await evaluate("document.querySelector('.city-full-button')?.textContent || ''");
    return text === 'Полный текст загружен';
  }, 'read original record');
  const fullText = await evaluate("document.querySelector('.city-detail-body')?.textContent || ''");
  assert.match(fullText, /Реальная запись для проверки трёхмерного города/);
  const state=await evaluate("({is3D:!!city?.is3D,loaded:!!cityLoaded,count:document.getElementById('city-count')?.textContent,width:document.getElementById('city-canvas')?.width,height:document.getElementById('city-canvas')?.height,glError:document.getElementById('city-canvas')?.getContext('webgl2')?.getError(),status:document.getElementById('city-load-status')?.textContent})");
  assert.equal(state.loaded,true,JSON.stringify(state));
  assert.equal(state.is3D,true,'WebGL2 city not active: '+JSON.stringify(state)+' / '+chromeError);
  assert.match(state.count,/1/);
  assert.ok(state.width>100&&state.height>100,JSON.stringify(state));
  assert.equal(state.glError,0,JSON.stringify(state));
  assert.deepEqual(errors,[],'Browser JS exceptions');
  console.log('City 3D browser smoke PASSED:',JSON.stringify(state));
  ws.close();
}finally{
  for(const child of children.reverse())if(!child.killed)child.kill();
  await pause(500);
  rmSync(dir,{recursive:true,force:true,maxRetries:3});
}
