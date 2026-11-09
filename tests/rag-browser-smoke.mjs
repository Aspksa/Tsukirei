import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,title,timeout=25000){
 const deadline=Date.now()+timeout,last={error:null};
 while(Date.now()<deadline){
  try{const value=await fn();if(value)return value;}catch(e){last.error=e;}
  await wait(170);
 }
 throw Error('Browser timeout '+title+(last.error?': '+last.error.message:''));
}
function chromePath(){
 for(const bin of [process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','google-chrome','chromium']){
  if(!bin)continue;
  if(bin.startsWith('/')&&existsSync(bin))return bin;
  if(!bin.startsWith('/')&&spawnSync('which',[bin]).status===0)return bin;
 }
 throw Error('Chrome/Chromium не найден');
}
const tmp=mkdtempSync(join(tmpdir(),'tsukirei-rag-browser-'));
const profile=join(tmp,'chrome');const children=[];
try{
 const server=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{
  cwd:process.cwd(),env:{...process.env,PORT:'0',TSUKIREI_DATA_DIR:tmp,TSUKIREI_DATABASE_URL:'',DATABASE_URL:''},
  stdio:['ignore','pipe','pipe']
 });children.push(server);
 let base='',serverErrors='';
 server.stdout.on('data',chunk=>{
  const match=String(chunk).match(/http:\/\/127\.0\.0\.1:(\d+)\//);
  if(match)base='http://127.0.0.1:'+match[1];
 });
 server.stderr.on('data',chunk=>{serverErrors+=String(chunk);});
 await until(()=>base,'local server');
 const response=await fetch(base+'/api/notes',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({title:'Двигатель Impreza',body:'Subaru Impreza передняя шпилька колеса'})
 });
 assert.equal(response.status,201,serverErrors);
 const chrome=spawn(chromePath(),[
  '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
  '--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=1300,950',base+'/'
 ],{stdio:['ignore','ignore','pipe']});children.push(chrome);
 let stderr='';
 chrome.stderr.on('data',part=>{stderr+=String(part).slice(-2000);});
 const port=await until(()=>{
  const file=join(profile,'DevToolsActivePort');
  if(!existsSync(file))return null;
  const n=Number(readFileSync(file,'utf8').split(/\r?\n/)[0]);
  return n>0?n:null;
 },'Chrome DevTools port');
 const wsUrl=await until(async()=>{
  const items=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  return items.find(x=>x.type==='page')?.webSocketDebuggerUrl;
 },'Chrome tab');
 const ws=new WebSocket(wsUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let nextId=0;
 const pending=new Map();const errors=[];
 ws.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails?.exception?.description||message.params.exceptionDetails?.text);
  if(message.id&&pending.has(message.id)){
   const p=pending.get(message.id);pending.delete(message.id);
   message.error?p.reject(Error(message.error.message)):p.resolve(message.result);
  }
 });
 const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++nextId;pending.set(id,{resolve,reject});
  ws.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
  return result.result?.value;
 };
 await send('Runtime.enable');
 await until(()=>evaluate("document.readyState === 'complete' && document.querySelector('#status-text')?.textContent !== 'Подключение...'"),'application ready');
 await evaluate("document.querySelector('[data-page=search]').click();true");
 assert.equal(await evaluate("document.getElementById('page-search').hidden"),false);
 await evaluate("(()=>{const input=document.getElementById('rag-query');input.value='шпилька Subaru';document.getElementById('rag-search-form').requestSubmit();return true;})()");
 await until(()=>evaluate("document.querySelector('.rag-result-card h3')?.textContent.includes('Двигатель Impreza')"),'RAG search result');
 await until(()=>evaluate("document.getElementById('rag-engine-badge')?.textContent.includes('PostgreSQL')"),'advanced panel');
 const advanced=await evaluate("({engine:!!document.getElementById('rag-engine-status'),pauseDisabled:document.getElementById('rag-engine-pause').disabled,embeddingEnabled:document.getElementById('rag-embeddings-enabled').checked,autoEmbed:document.getElementById('rag-auto-embed').checked,rerankEnabled:document.getElementById('rag-rerank-enabled').checked,curator:!!document.getElementById('rag-curator-check'),graph:!!document.getElementById('rag-graph-form')})");
 assert.equal(advanced.engine,true);
 assert.equal(advanced.pauseDisabled,true,'Cannot start index without PostgreSQL');
 assert.equal(advanced.embeddingEnabled,false,'Paid embeddings must start disabled');
 assert.equal(advanced.autoEmbed,false,'Background AI must start disabled');
 assert.equal(advanced.rerankEnabled,false,'Paid reranker must start disabled');
 assert.equal(advanced.curator,true);assert.equal(advanced.graph,true);
 await evaluate("document.querySelector('[data-page=soul]').click();true");
 assert.equal(await evaluate("document.getElementById('page-soul').hidden"),false);
 await until(()=>evaluate("document.getElementById('soul-state')?.textContent?.includes('нежный')"),'Soul page profile');
 const initialSoul=await evaluate("({address:document.getElementById('soul-address')?.value,exchanges:document.getElementById('soul-chat-count')?.textContent,preferences:document.getElementById('soul-preference-count')?.textContent})");
 assert.equal(initialSoul.address,'хозяин');
 assert.equal(initialSoul.exchanges,'0');
 assert.equal(initialSoul.preferences,'0');
 await evaluate("(()=>{document.getElementById('soul-preference-input').value='Я предпочитаю код на TypeScript';document.getElementById('soul-preference-form').requestSubmit();return true;})()");
 await until(()=>evaluate("document.getElementById('soul-preference-count')?.textContent==='1'"),'Soul saved preference');
 await evaluate("(()=>{document.getElementById('soul-tone').value='деловой';document.getElementById('soul-settings-form').requestSubmit();return true;})()");
 await until(()=>evaluate("document.getElementById('soul-state')?.textContent?.includes('деловой')"),'Soul updated tone');
 const hasSoulControl=await evaluate("({lesson:!!document.getElementById('soul-lessons'),journal:!!document.getElementById('soul-journal'),initiative:!!document.getElementById('soul-initiatives'),feedbackButton:!!document.querySelector('.soul-chat-feedback-button')})");
 assert.equal(hasSoulControl.lesson,true);
 assert.equal(hasSoulControl.journal,true);
 assert.equal(hasSoulControl.initiative,true);
 const result=await evaluate("({title:document.querySelector('.rag-result-card h3')?.textContent,meta:document.getElementById('rag-results-meta')?.textContent,hasImport:!!document.getElementById('rag-import-form'),hasChatToggle:!!document.getElementById('chat-use-memory'),hasCity:!!document.getElementById('page-city')})");
 assert.match(result.title,/Двигатель Impreza/);
 assert.equal(result.hasImport,true);assert.equal(result.hasChatToggle,true);
 assert.equal(result.hasCity,false);
 assert.deepEqual(errors,[]);
 console.log('RAG browser smoke PASSED:',JSON.stringify(result));
 ws.close();
}finally{
 for(const child of children.reverse())if(!child.killed)child.kill();
 await wait(450);
 rmSync(tmp,{recursive:true,force:true,maxRetries:4});
}
