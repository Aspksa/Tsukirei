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
  return items.find(x=>x.type==='page'&&x.url?.startsWith(base))?.webSocketDebuggerUrl;
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
 await until(()=>evaluate("document.readyState === 'complete' && !!document.querySelector('#status-text') && document.querySelector('#status-text').textContent !== 'Подключение...' && !!document.querySelector('[data-page=search]') && !!document.querySelector('[data-page=living]')"),'application ready with navigation');
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
 await evaluate("document.querySelector('[data-page=living]').click();true");
 assert.equal(await evaluate("document.getElementById('page-living').hidden"),false);
 await until(()=>evaluate("document.getElementById('living-header-status')?.textContent?.includes('Только локально')"),'Living Core initial status');
 const start=await evaluate("({cloudEnabled:document.getElementById('living-cloud-enabled').checked,shareRecentText:document.getElementById('living-share-text').checked,local:document.getElementById('living-local-count').textContent,buttonDisabled:document.getElementById('living-run-cloud').disabled})");
 assert.equal(start.cloudEnabled,false);
 assert.equal(start.shareRecentText,false);
 assert.equal(start.local,'0');
 assert.equal(start.buttonDisabled,true,'Paid model action disabled until consent');
 await evaluate("document.getElementById('living-run-local').click();true");
 await until(()=>evaluate("Number(document.getElementById('living-local-count').textContent)>=1"),'Living local reflection');
 assert.equal(await evaluate("document.querySelectorAll('#living-journal .living-event').length>0"),true);
 assert.equal(await evaluate("document.getElementById('living-budget-count').textContent.trim()"),'0 / 2');
 await evaluate("document.querySelector('[data-page=cognition]').click();true");
 assert.equal(await evaluate("document.getElementById('page-cognition').hidden"),false);
 await until(()=>evaluate("document.getElementById('cog-scan-state')?.textContent?.includes('Локально')"),'Cognitive page ready');
 const initialMind=await evaluate("({facts:document.getElementById('cog-fact-count')?.textContent,goals:document.getElementById('cog-goal-count')?.textContent,trace:!!document.getElementById('cog-traces'),world:!!document.getElementById('cog-world'),timeline:!!document.getElementById('cog-timeline')})");
 assert.equal(initialMind.goals,'0');
 assert.equal(initialMind.trace,true);
 assert.equal(initialMind.world,true);
 assert.equal(initialMind.timeline,true);
 await evaluate("(()=>{document.getElementById('cog-goal-title').value='Улучшить когнитивную память';document.getElementById('cog-goal-objective').value='Провести локальные тесты и проверить источники знаний';document.getElementById('cog-goal-form').requestSubmit();return true;})()");
 await until(()=>evaluate("document.getElementById('cog-goal-count')?.textContent==='1'"),'Cognitive goal saved');
 await evaluate("document.getElementById('cog-scan').click();true");
 await until(()=>evaluate("document.querySelectorAll('#cog-traces .cog-record').length>0"),'Cognitive observable trace');
 await evaluate("(()=>{document.getElementById('cog-assess-query').value='Почему фосфокаркас не присутствует в базе данных?';document.getElementById('cog-assess-form').requestSubmit();return true;})()");
 await until(()=>evaluate("document.getElementById('cog-assessment')?.textContent.includes('Покрытие')"),'Cognitive metacognition check');
 await evaluate("document.querySelector('[data-page=supermind]').click();true");
 assert.equal(await evaluate("document.getElementById('page-supermind').hidden"),false);
 await until(()=>evaluate("document.querySelectorAll('#sm-values .sm-record').length===6"),'Eternal Soul values');
 const core=await evaluate("({title:document.getElementById('sm-title')?.textContent,governor:document.getElementById('sm-governor')?.textContent,history:document.getElementById('sm-events')?.textContent,cloudDisabled:document.getElementById('sm-governor')?.textContent.includes('выключен')})");
 assert.match(core.title,/Душа/);
 assert.equal(core.cloudDisabled,true,'Supermind must not auto-enable Cloud.ru');
 assert.ok(core.governor.includes('Самовольное выполнение кода отключено'));
 await evaluate("document.getElementById('sm-sync').click();true");
 await until(()=>evaluate("Number(document.getElementById('sm-events')?.textContent)>0"),'Autobiography sync');
 await evaluate("(()=>{document.getElementById('sm-intent-input').value='У меня ошибка запуска';document.getElementById('sm-intent-form').requestSubmit();return true;})()");
 await until(()=>evaluate("document.getElementById('sm-intent-result')?.textContent.includes('техническая проблема')"),'Social intent classification');
 await evaluate("(()=>{document.getElementById('sm-question').value='Почему программа выдаёт чёрный экран после запуска?';document.getElementById('sm-inquiry-form').requestSubmit();return true;})()");
 await until(()=>evaluate("document.getElementById('sm-inquiries')?.textContent==='1'"),'Hypothesis proposal');
 assert.equal(await evaluate("document.querySelectorAll('#sm-inquiry-list .sm-hypothesis').length>=2"),true);
 await evaluate("(()=>{document.getElementById('sm-strategy-question').value='Как улучшить автономное хранение знаний?';document.getElementById('sm-strategy-form').requestSubmit();return true;})()");
 await until(()=>evaluate("document.getElementById('sm-strategies')?.textContent.includes('Оценка:')"),'Counterfactual comparison');
 assert.equal(await evaluate("document.getElementById('sm-wisdom-count').textContent"),'0');
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
