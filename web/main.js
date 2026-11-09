'use strict';

const pages = { brain: 'Мозг', monitor: 'Монитор', home: 'Обзор', memory: 'Память', search: 'RAG и документы', tasks: 'Дела', agents: 'Агенты', soul: 'Личность', living: 'Развитие', cognition: 'Мышление', supermind: 'Душа и сверхразум', settings: 'Настройки' };
const el = (id) => document.getElementById(id);
const advancedMount=document.getElementById('advanced-rag-mount');
const technicalRagPanel=document.querySelector('.rag-engine-panel');
if(advancedMount&&technicalRagPanel)advancedMount.append(technicalRagPanel);

const viewState = { notes: [], tasks: [], messages: [], settings: { configured: false, hasKey: false, model: '' }, database: { connected: false, engine: 'JSON (legacy)' } };
let busy = false;
let toastTimer;
let chatSources = [];
let proactiveSuggestions = [];
async function refreshProactiveChat(){
  try{
    const result=await api('/api/soul/outreach');
    const items=Array.isArray(result.items)?result.items:[];
    proactiveSuggestions=items.filter(item=>item&&typeof item.id==='string'&&typeof item.title==='string');
    renderChat();
  }catch(error){console.warn('[Tsukirei] Инициативы временно недоступны:',error.message);}
}

let ragDocsLoaded = false;
function escapeNotNeeded(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}
function notify(message, error = false) {
  const toast = el('toast');
  toast.textContent = message;
  toast.classList.toggle('is-error', error);
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 4500);
}
const brainRequestTrace=[];
const BRAIN_TRACE_LIMIT=40;
function brainTraceModule(path){
 if(path.startsWith('/api/cognition/'))return 'server/index.ts → server/cognition.ts';
 if(path.startsWith('/api/soul/'))return 'server/index.ts → server/soul.ts';
 if(path.startsWith('/api/living'))return 'server/index.ts → server/living.ts';
 if(path.startsWith('/api/supermind'))return 'server/index.ts → server/supermind.ts';
 if(path.startsWith('/api/rag/'))return 'server/index.ts → RAG';
 if(path.startsWith('/api/brain/'))return 'server/index.ts → обзор подсистем';
 if(path.startsWith('/api/chat'))return 'server/index.ts → чат';
 return 'server/index.ts → обработчик API';
}
function recordBrainRequest(path,method,status,duration,traceId=''){
 const route=String(path).split('?')[0].split('#')[0];
 if(!route.startsWith('/api/'))return;
 brainRequestTrace.unshift({route,method,status,duration,traceId,at:new Date()});
 if(brainRequestTrace.length>BRAIN_TRACE_LIMIT)brainRequestTrace.length=BRAIN_TRACE_LIMIT;
 renderBrainRequestTrace();
}
function renderBrainRequestTrace(){
 const list=document.getElementById('brain-trace-list');
 if(!list)return;
 const filter=document.getElementById('monitor-filter')?.value||'all';
 const failures=brainRequestTrace.filter(e=>e.status===0||e.status>=400);
 const average=brainRequestTrace.length?Math.round(brainRequestTrace.reduce((sum,e)=>sum+e.duration,0)/brainRequestTrace.length):null;
 const stats=document.getElementById('monitor-stats');
 if(stats){
  const values=stats.querySelectorAll('strong');
  values[0].textContent=String(brainRequestTrace.length);
  values[1].textContent=average===null?'—':average+' мс';
  values[2].textContent=String(failures.length);
 }
 const filtered=brainRequestTrace.filter(entry=>{
  if(filter==='error')return entry.status===0||entry.status>=400;
  if(filter==='slow')return entry.duration>=500;
  if(filter==='chat')return entry.route.startsWith('/api/chat');
  if(filter==='brain')return ['/api/brain/','/api/cognition/','/api/rag/'].some(prefix=>entry.route.startsWith(prefix));
  return true;
 });
 const visible=document.getElementById('monitor-visible-count');
 if(visible)visible.textContent=filtered.length+' из '+brainRequestTrace.length+' записей';
 const timeline=document.getElementById('monitor-timeline');
 if(timeline){
  timeline.replaceChildren();
  const recent=[...filtered].reverse().slice(-24);
  const peak=Math.max(1,...recent.map(e=>e.duration));
  for(const entry of recent){
   const bar=document.createElement('span');
   bar.className='monitor-timeline-bar';
   bar.dataset.error=String(entry.status===0||entry.status>=400);
   bar.style.height=Math.max(6,Math.round(entry.duration/peak*100))+'%';
   bar.title=entry.method+' '+entry.route+' · '+entry.duration+' мс';
   timeline.append(bar);
  }
  timeline.setAttribute('aria-label',recent.length?'Длительность последних '+recent.length+' отфильтрованных запросов. Максимум '+peak+' мс.':'Нет данных для выбранного фильтра');
 }
 list.replaceChildren();
 if(!filtered.length){
  const empty=document.createElement('p');empty.className='brain-trace-empty';
  empty.textContent=brainRequestTrace.length?'По выбранному фильтру запросов нет.':'Запросов пока нет. Перейдите в другой раздел или обновите карту мозга.';
  list.append(empty);return;
 }
 for(const entry of filtered){
  const row=document.createElement('div');row.className='brain-trace-entry';
  const header=document.createElement('div');header.className='brain-trace-entry-header';
  const method=document.createElement('span');method.className='brain-trace-method';method.textContent=entry.method;
  const route=document.createElement('code');route.textContent=entry.route;
  const state=document.createElement('span');state.className='brain-trace-status';
  state.dataset.ok=String(entry.status>=200&&entry.status<400);
  state.textContent=entry.status===0?'Сеть недоступна':String(entry.status);
  header.append(method,route,state);
  const detail=document.createElement('p');
  detail.textContent=entry.at.toLocaleTimeString('ru-RU')+' · '+entry.duration+' мс · '+brainTraceModule(entry.route);
  if(entry.traceId)detail.textContent+=' · Цепочка '+entry.traceId.slice(0,8);
  row.append(header,detail);list.append(row);
 }
}
async function api(path, options = {}) {
  const method=options.method||'GET';
  const started=performance.now();
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
  } catch {
    recordBrainRequest(path,method,0,Math.round(performance.now()-started));
    throw new Error('Не удаётся подключиться к локальному серверу.');
  }
  recordBrainRequest(path,method,res.status,Math.round(performance.now()-started),res.headers.get('X-Tsukirei-Trace-Id')||'');
  let value;
  try { value = await res.json(); } catch { throw new Error('Сервер вернул некорректный ответ.'); }
  if (!res.ok) throw new Error(value.error || 'Ошибка запроса: ' + res.status);
  return value;
}
async function run(action) {
  try { await action(); } catch (err) { notify(err.message || 'Неизвестная ошибка', true); }
}
function go(page) {
  if (!Object.hasOwn(pages,page) || !el('page-' + page)) return;
  for (const name of Object.keys(pages)) {
    const section = el('page-' + name);
    const selected = name === page;
    if (!section) continue;
    section.hidden = !selected;
    section.classList.toggle('is-active', selected);
  }
  document.querySelectorAll('[data-page]').forEach(button => {
    const selected = button.dataset.page === page;
    button.classList.toggle('selected', selected);
    if (button.classList.contains('nav-button')) {
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  });
  el('topbar-section').textContent = pages[page];
  if(page==='monitor')void refreshMonitorServerSteps();
  // The five-item sidebar stays on Brain while a legacy subsystem is open.
  const brainPages = new Set(['brain','memory','search','soul','living','cognition','supermind']);
  const brainNav = document.querySelector('.nav-button[data-page="brain"]');
  if (brainNav) {
    const active = brainPages.has(page);
    brainNav.classList.toggle('selected',active);
    if (active) brainNav.setAttribute('aria-current','page');
    else brainNav.removeAttribute('aria-current');
  }
  el('shell').classList.remove('menu-open');
  el('mobile-menu').setAttribute('aria-expanded','false');
  el('mobile-menu').setAttribute('aria-label','Открыть меню');
  if (window.location.hash !== '#' + page) window.location.hash = page;
  if (page === 'brain') { void refreshBrainKnowledge(); void refreshBrainGrowth(); void refreshRagStudio(); }
  if (page === 'search') { refreshRagDocuments(); refreshRagEngine(); }
  if (page === 'soul') globalThis.TsukireiSoulUI?.refresh();
  if (page === 'living') globalThis.TsukireiLivingUI?.refresh();
  if (page === 'cognition') globalThis.TsukireiCognitionUI?.refresh();
  if (page === 'supermind') globalThis.TsukireiSupermindUI?.refresh();
}
let brainLoading=false;
let brainGrowthPeriod='30';
function renderBrainGrowthChart(records,period){
 const svg=el('brain-growth-svg'),wrap=el('brain-growth-chart'),caption=el('brain-chart-caption');
 svg.replaceChildren();
 const timestamps=records.map(item=>Date.parse(item.at)).filter(Number.isFinite);
 if(!timestamps.length){
  wrap.setAttribute('aria-label','За выбранный период нет событий для графика');
  caption.textContent='Нет событий за выбранный период. Выберите другой период или дождитесь новых записей.';
  return;
 }
 const now=Date.now(),daily=period!=='all',day=86400000;
 const min=daily?now-Number(period)*day:Math.min(...timestamps);
 const max=daily?now:Math.max(now,Math.max(...timestamps));
 const bins=daily?Number(period):Math.min(24,Math.max(1,Math.ceil((max-min)/day)));
 const totals=Array.from({length:bins},()=>0);
 for(const t of timestamps){
  if(t<min||t>max)continue;
  const index=Math.min(bins-1,Math.floor((t-min)/Math.max(1,max-min)*bins));
  totals[index]++;
 }
 const peak=Math.max(1,...totals),width=720,height=220,left=32,right=18,top=24,bottom=34;
 const chartW=width-left-right,chartH=height-top-bottom,step=chartW/bins;
 const NS='http://www.w3.org/2000/svg';
 const element=(tag,attributes,text)=>{
  const node=document.createElementNS(NS,tag);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  if(text!==undefined)node.textContent=text;
  svg.append(node);return node;
 };
 for(let row=0;row<=3;row++){
  const y=top+chartH*row/3;
  element('line',{x1:left,y1:y,x2:width-right,y2:y,class:'brain-chart-grid'});
  element('text',{x:2,y:y+4,class:'brain-chart-axis'},String(Math.round(peak*(3-row)/3)));
 }
 totals.forEach((count,index)=>{
  const h=count/peak*chartH;
  const x=left+index*step+Math.min(4,step*.12),barW=Math.max(1,step-Math.min(8,step*.24));
  const bar=element('rect',{x,y:top+chartH-h,width:barW,height:Math.max(0,h),rx:Math.min(5,barW/2),class:count?'brain-chart-bar':'brain-chart-bar-empty'});
  const from=new Date(min+(max-min)*index/bins).toLocaleDateString('ru-RU');
  const to=new Date(min+(max-min)*(index+1)/bins).toLocaleDateString('ru-RU');
  const title=document.createElementNS(NS,'title');title.textContent=from+' — '+to+': '+count+' событий';bar.append(title);
 });
 element('text',{x:left,y:height-7,class:'brain-chart-axis'},new Date(min).toLocaleDateString('ru-RU'));
 element('text',{x:width-right,y:height-7,'text-anchor':'end',class:'brain-chart-axis'},new Date(max).toLocaleDateString('ru-RU'));
 const total=totals.reduce((a,b)=>a+b,0);
 const description='Событий: '+total+'. Максимум за интервал: '+Math.max(...totals)+'. Интервалов: '+bins+'.';
 wrap.setAttribute('aria-label','График истории мозга. '+description);
 caption.textContent=description+' Столбцы показывают число событий, а не уровень интеллекта.';
}
async function refreshBrainGrowth(){
  const summary=el('brain-growth-summary');
  const events=el('brain-growth-events');
  const review=el('brain-review-list');
  try{
    const [growth,queue,evidence,audit]=await Promise.all([
      api('/api/cognition/growth'),api('/api/cognition/review-queue'),
      api('/api/cognition/review-evidence'),api('/api/cognition/learning-audit')
    ]);
    const records=Array.isArray(growth.events)?growth.events:[];
    const now=Date.now();
    const days=brainGrowthPeriod==='all'?Infinity:Number(brainGrowthPeriod);
    const visibleRecords=records.filter(event=>{
      const timestamp=Date.parse(event.at);
      return Number.isFinite(timestamp)&&(days===Infinity||
        timestamp<=now&&timestamp>=now-days*86400000);
    });
    renderBrainGrowthChart(visibleRecords,brainGrowthPeriod);
    const pending=Array.isArray(queue.items)?queue.items:[];
    const candidateCount=Array.isArray(evidence.items)?
      evidence.items.reduce((sum,item)=>sum+(Array.isArray(item.candidates)?item.candidates.length:0),0):0;
    summary.textContent='Проверок: '+(growth.metrics?.scans??0)+' · Событий за период: '+visibleRecords.length+
      ' · Требуют внимания: '+pending.length+' · Возможные источники: '+candidateCount;
    events.replaceChildren();
    for(const event of visibleRecords.slice(0,12)){
      const line=document.createElement('p');
      const time=Number.isFinite(Date.parse(event.at))?
        new Date(event.at).toLocaleString('ru-RU'):'';
      line.textContent=time+' · '+String(event.detail??event.stage??'Событие');
      events.append(line);
    }
    if(!visibleRecords.length)events.textContent='За выбранный период событий нет.';
    review.replaceChildren();
    for(const item of pending.slice(0,12)){
      const line=document.createElement('p');
      line.textContent=String(item.description)+' · '+String(item.key);
      review.append(line);
    }
    if(!pending.length)review.textContent='Новых вопросов для проверки нет.';
    const auditLine=document.createElement('p');
    auditLine.textContent='Самопроверка за 30 дней: '+(audit.scansCompleted??0)+
      ' успешных обработок · ошибок: '+(audit.scanErrors??0)+
      ' · предложенных фактов: '+(audit.findings?.proposedFacts??0);
    review.append(auditLine);
    for(const suggestion of (Array.isArray(audit.suggestions)?audit.suggestions:[]).slice(0,4)){
      const line=document.createElement('p');
      line.textContent='Рекомендуется: '+String(suggestion);
      review.append(line);
    }
  }catch(error){
    renderBrainGrowthChart([],brainGrowthPeriod);
    summary.textContent='Не удалось загрузить историю: '+(error.message||'ошибка');
    events.replaceChildren();review.textContent='Проверка недоступна.';
  }
}
async function refreshBrainOverview(){
  if(brainLoading)return;
  brainLoading=true;
  try{
    const overview=await api('/api/brain/overview');
    const memory=overview.memory,learning=overview.learning,identity=overview.identity;
    const values=[
      ['Заметки',memory.notes],['Сообщения',memory.messages],['Факты',memory.facts],
      ['Связи',memory.worldEdges],['Пробелы',learning.gaps],['Уроки',identity.lessons]
    ];
    const metrics=el('brain-metrics');
    metrics.replaceChildren();
    for(const [label,value] of values){
      const item=document.createElement('div');
      item.className='brain-metric';
      const number=document.createElement('strong');
      number.textContent=String(value);
      const name=document.createElement('span');
      name.textContent=label;
      item.append(number,name);metrics.append(item);
    }
    const svg=el('brain-map-svg');
    svg.replaceChildren();
    const ns='http://www.w3.org/2000/svg';
    const make=(tag,attrs,text)=>{
      const node=document.createElementNS(ns,tag);
      for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
      if(text!==undefined)node.textContent=text;
      svg.append(node);return node;
    };
    const nodes=[
      {x:100,y:110,label:'Память',count:memory.notes+memory.messages},
      {x:260,y:65,label:'Факты',count:memory.facts},
      {x:260,y:165,label:'Связи',count:memory.worldEdges},
      {x:440,y:65,label:'Обучение',count:identity.scans},
      {x:440,y:165,label:'Проверка',count:learning.duplicateGroups},
      {x:610,y:110,label:'Личность',count:identity.lessons+identity.lifeEvents}
    ];
    for(const [a,b] of [[0,1],[0,2],[1,3],[2,4],[3,5],[4,5],[1,2],[3,4]]){
      make('line',{x1:nodes[a].x,y1:nodes[a].y,x2:nodes[b].x,y2:nodes[b].y,stroke:'#9f8146','stroke-opacity':'.42','stroke-width':1.5});
    }
    for(const node of nodes){
      const radius=11+Math.min(22,Math.sqrt(Math.max(0,node.count))*2.2);
      make('circle',{cx:node.x,cy:node.y,r:radius,fill:'#d1a95a','fill-opacity':'.14',stroke:'#c7a05a','stroke-width':1.5});
      make('text',{x:node.x,y:node.y-3,'text-anchor':'middle',fill:'#f0d49a','font-size':12},String(node.count));
      make('text',{x:node.x,y:node.y+radius+17,'text-anchor':'middle',fill:'#e9e2d5','font-size':12},node.label);
    }
    const running=overview.background.filter(task=>task.running).length;
    el('brain-footnote').textContent='Фоновые задачи: '+overview.background.length+' · выполняются: '+running+
      ' · Cloud.ru для этой карты: 0 запросов · Размер узлов отражает число записей, не уровень сознания.';
  }catch(error){
    el('brain-metrics').textContent='Не удалось загрузить карту: '+(error.message||'ошибка');
  }finally{brainLoading=false;}
}
async function refreshRagStudio(){
 const status=el('rag-studio-status'),metrics=el('rag-studio-metrics');
 status.textContent='Получение состояния движка памяти…';status.dataset.state='loading';metrics.replaceChildren();
 try{
  const data=await api('/api/rag/engine');
  const worker=data.worker||{},provider=data.provider||{},cache=data.cache||{},index=data.index||{};
  const available=worker.available!==false&&data.index!==null;
  const busy=Boolean(worker.running||worker.pending);
  const failed=Boolean(worker.error);
  status.dataset.state=failed?'error':busy?'busy':'ready';
  status.textContent=!available?'Локальный режим · фоновый индекс PostgreSQL недоступен':
   failed?'Индексация требует внимания':busy?'Индекс обновляется':'Движок памяти готов';
  const rows=[
   ['Индекс',!available?'Локальный поиск':failed?'Ошибка':busy?'Обновление':'Доступен'],
   ['Векторный поиск',provider.embeddingsEnabled?'Включён':'Не включён'],
   ['Реранжирование',provider.rerankEnabled?'Включено':'Не включено'],
   ['Кэш',typeof cache.size==='number'?String(cache.size)+' записей':'Состояние получено'],
   ['Документы в индексе',typeof index.documents==='number'?String(index.documents):'Нет данных']
  ];
  for(const [label,value] of rows){
   const card=document.createElement('div');card.className='rag-studio-metric';
   const heading=document.createElement('span');heading.textContent=label;
   const metric=document.createElement('strong');metric.textContent=value;
   card.append(heading,metric);metrics.append(card);
  }
 }catch(error){
  status.dataset.state='error';
  status.textContent='Не удалось получить состояние RAG: '+(error.message||'ошибка');
 }
}
el('rag-studio-refresh').addEventListener('click',()=>{void refreshRagStudio();});
el('brain-refresh').addEventListener('click',()=>{void refreshBrainKnowledge();void refreshBrainGrowth();void refreshRagStudio();});
document.querySelectorAll('[data-brain-period]').forEach(button=>{
  button.addEventListener('click',()=>{
    brainGrowthPeriod=button.dataset.brainPeriod;
    document.querySelectorAll('[data-brain-period]').forEach(item=>{
      item.setAttribute('aria-pressed',String(item===button));
    });
    void refreshBrainGrowth();
  });
});
const brainViewport={x:0,y:0,width:700,height:340};
function applyBrainViewport(){
  el('brain-map-svg').setAttribute('viewBox',
    [brainViewport.x,brainViewport.y,brainViewport.width,brainViewport.height].join(' '));
}
function resetBrainViewport(){
  Object.assign(brainViewport,{x:0,y:0,width:700,height:340});
  applyBrainViewport();
}
function zoomBrain(factor,clientX=null,clientY=null){
  const svg=el('brain-map-svg');
  const bounds=svg.getBoundingClientRect();
  const ratio=bounds.width&&bounds.height?
    Math.min(bounds.width/brainViewport.width,bounds.height/brainViewport.height):1;
  const drawnWidth=brainViewport.width*ratio,drawnHeight=brainViewport.height*ratio;
  const localX=clientX===null||!ratio?brainViewport.width/2:
    (clientX-bounds.left-(bounds.width-drawnWidth)/2)/ratio;
  const localY=clientY===null||!ratio?brainViewport.height/2:
    (clientY-bounds.top-(bounds.height-drawnHeight)/2)/ratio;
  const px=brainViewport.x+localX,py=brainViewport.y+localY;
  const width=Math.max(140,Math.min(1400,brainViewport.width*factor));
  const height=width*340/700;
  brainViewport.x=px-(px-brainViewport.x)*width/brainViewport.width;
  brainViewport.y=py-(py-brainViewport.y)*height/brainViewport.height;
  brainViewport.width=width;brainViewport.height=height;
  applyBrainViewport();
}
el('brain-zoom-in').addEventListener('click',()=>zoomBrain(.8));
el('brain-zoom-out').addEventListener('click',()=>zoomBrain(1.25));
el('brain-zoom-reset').addEventListener('click',resetBrainViewport);
{
  const svg=el('brain-map-svg');
  svg.addEventListener('wheel',event=>{
    if(!svg.closest('#page-brain')?.hidden){
      event.preventDefault();
      zoomBrain(event.deltaY<0?.88:1.12,event.clientX,event.clientY);
    }
  },{passive:false});
  let dragging=null;
  svg.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('g[role="button"]'))return;
    dragging={id:event.pointerId,x:event.clientX,y:event.clientY};
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove',event=>{
    if(!dragging||dragging.id!==event.pointerId)return;
    const bounds=svg.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return;
    const ratio=Math.min(bounds.width/brainViewport.width,bounds.height/brainViewport.height);
    brainViewport.x-=(event.clientX-dragging.x)/ratio;
    brainViewport.y-=(event.clientY-dragging.y)/ratio;
    dragging.x=event.clientX;dragging.y=event.clientY;
    applyBrainViewport();
  });
  const stopDrag=event=>{if(dragging?.id===event.pointerId)dragging=null;};
  svg.addEventListener('pointerup',stopDrag);
  svg.addEventListener('pointercancel',stopDrag);
  svg.addEventListener('lostpointercapture',()=>{dragging=null;});
}

let selectedBrainTopic=null;
let brainVisibleLimit=70;
let brainGraphRequest=0;
el('brain-load-more').addEventListener('click',()=>{
  brainVisibleLimit=Math.min(350,brainVisibleLimit+70);
  void refreshBrainKnowledge();
});
async function refreshBrainKnowledge(){
  const svg=el('brain-map-svg');
  const detail=el('brain-graph-detail');
  const query=el('brain-graph-query').value.trim().slice(0,70);
  const requestId=++brainGraphRequest;
  detail.textContent='Загружаю связи с указанием источников...';
  try{
    const params=new URLSearchParams({limit:String(brainVisibleLimit)});
    if(query)params.set('q',query);
    const graph=await api('/api/cognition/world?'+params.toString());
    if(requestId!==brainGraphRequest)return;
    const rawNodes=Array.isArray(graph.nodes)?graph.nodes:[];
    const rawEdges=Array.isArray(graph.edges)?graph.edges:[];
    el('brain-visible-count').textContent='На карте: '+rawNodes.length+' из '+(graph.totalNodes??rawNodes.length);
    el('brain-load-more').hidden=!graph.hasMore;
    const neighbors=new Map(rawNodes.map(n=>[String(n.id),new Set()]));
    for(const edge of rawEdges){
      const a=String(edge.from),b=String(edge.to);
      if(neighbors.has(a)&&neighbors.has(b)){
        neighbors.get(a).add(b);neighbors.get(b).add(a);
      }
    }
    const visited=new Set(),topics=[];
    for(const node of rawNodes){
      const id=String(node.id);
      if(visited.has(id))continue;
      const group=[],stack=[id];visited.add(id);
      while(stack.length){
        const current=stack.pop();group.push(current);
        for(const next of neighbors.get(current)||[]){
          if(!visited.has(next)){visited.add(next);stack.push(next);}
        }
      }
      topics.push(group);
    }
    topics.sort((a,b)=>b.length-a.length);
    if(selectedBrainTopic!==null&&!topics[selectedBrainTopic])selectedBrainTopic=null;
    const topicBar=el('brain-topic-groups');
    topicBar.replaceChildren();
    const topicButton=(label,index)=>{
      const button=document.createElement('button');
      button.type='button';button.className='brain-topic-button';
      button.textContent=label;button.setAttribute('aria-pressed',String(selectedBrainTopic===index));
      button.addEventListener('click',()=>{selectedBrainTopic=index;void refreshBrainKnowledge();});
      topicBar.append(button);
    };
    topicButton('Все · '+rawNodes.length,null);
    for(let i=0;i<Math.min(topics.length,12);i++){
      const first=rawNodes.find(n=>String(n.id)===topics[i][0]);
      topicButton(String(first?.label||'Тема '+(i+1)).slice(0,24)+' · '+topics[i].length,i);
    }
    const visibleIds=selectedBrainTopic===null?null:new Set(topics[selectedBrainTopic]);
    const allNodes=rawNodes.filter(n=>!visibleIds||visibleIds.has(String(n.id)));
    const included=new Set(allNodes.map(n=>String(n.id)));
    const allEdges=rawEdges.filter(e=>included.has(String(e.from))&&included.has(String(e.to)));
    const nodes=allNodes.map((node,i)=>({
      id:String(node.id),label:String(node.label||node.id).slice(0,90),
      x:350+Math.cos(i*2.399963)*Math.sqrt((i+.5)/Math.max(allNodes.length,1))*295,
      y:170+Math.sin(i*2.399963)*Math.sqrt((i+.5)/Math.max(allNodes.length,1))*140
    }));
    const byId=new Map(nodes.map(node=>[node.id,node]));
    const degree=new Map(nodes.map(node=>[node.id,0]));
    for(const edge of allEdges){
      const from=String(edge.from),to=String(edge.to);
      if(degree.has(from)&&degree.has(to)){
        degree.set(from,(degree.get(from)||0)+1);
        degree.set(to,(degree.get(to)||0)+1);
      }
    }

    resetBrainViewport();
    svg.replaceChildren();
    const ns='http://www.w3.org/2000/svg';
    const make=(tag,attrs,parent=svg)=>{
      const element=document.createElementNS(ns,tag);
      for(const [key,value] of Object.entries(attrs))element.setAttribute(key,String(value));
      parent.append(element);return element;
    };
    for(const edge of allEdges){
      const a=byId.get(String(edge.from)),b=byId.get(String(edge.to));
      if(a&&b){
        const link=make('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#a68b58',
          'stroke-opacity':'.38','stroke-width':1+Math.min(2,(degree.get(a.id)||0)/12)});
        const tip=make('title',{},link);
        tip.textContent=String(edge.relation||'Связь')+' · Источник: '+String(edge.evidenceId||'не указан');
      }
    }
    for(const node of nodes){
      const group=make('g',{tabindex:0,role:'button','aria-label':node.label});
      const connections=degree.get(node.id)||0;
      make('circle',{cx:node.x,cy:node.y,r:7+Math.min(14,Math.sqrt(connections)*4),
        fill:'#d6ad63','fill-opacity':connections?'.85':'.35',
        stroke:'#f3d99b','stroke-width':1.2},group);
      const label=make('text',{x:node.x,y:node.y+21,'text-anchor':'middle',fill:'#e9dfca','font-size':10},group);
      label.textContent=node.label.slice(0,19);
      const inspect=()=>{
        const connected=allEdges.filter(e=>String(e.from)===node.id||String(e.to)===node.id);
        detail.replaceChildren();
        const heading=document.createElement('strong');
        heading.textContent=node.label+' · Связей: '+connected.length;
        detail.append(heading);
        for(const edge of connected.slice(0,8)){
          const line=document.createElement('p');
          const other=String(edge.from)===node.id?String(edge.to):String(edge.from);
          const target=byId.get(other);
          line.textContent=(target?.label||other)+' · '+String(edge.relation||'Связь')+
            ' · Источник: '+String(edge.evidenceId||'не указан')+
            (edge.excerpt?' · '+String(edge.excerpt).slice(0,160):'');
          detail.append(line);
        }
      };
      group.addEventListener('click',inspect);
      group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();inspect();}});
    }
    detail.textContent=nodes.length?'Реальный граф: '+nodes.length+' узлов, '+allEdges.length+' связей. Выбери узел.':
      'Связи пока не извлечены. Добавь заметки или документы — проверка знаний запустится автоматически.';
    el('brain-footnote').textContent='Граф строится из локально сохранённых связей Cognitive Core. Cloud.ru не вызывается.';
  }catch(error){detail.textContent='Не удалось загрузить граф: '+(error.message||'ошибка');}
}
el('brain-graph-search').addEventListener('click',()=>{selectedBrainTopic=null;brainVisibleLimit=70;void refreshBrainKnowledge();});
el('brain-graph-query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void refreshBrainKnowledge();}});
el('brain-graph-overview').addEventListener('click',()=>{selectedBrainTopic=null;el('brain-map-svg').setAttribute('viewBox','0 0 700 230');void refreshBrainOverview();});

function renderStatus() {
  const settings = viewState.settings;
  el('status-text').textContent = settings.configured ? 'Cloud.ru настроен' : 'Локальная система';
  el('connection-pill').textContent = settings.configured ? 'ИИ настроен' : 'Локальная';
  el('connection-heading').textContent = settings.configured ? 'Всё готово для диалога' : 'Цукирэй на связи';
  el('connection-detail').textContent = (settings.configured ? 'Облачная модель включится только по вашему запросу.' : 'Заметки и задачи доступны. Для ИИ-чата подключите Cloud.ru.') + (viewState.database.connected ? ' · Память: PostgreSQL + pgvector.' : ' · Хранилище: старый JSON.');
  el('cloud-status').textContent = settings.configured ? 'Настроено · запросы только вручную' : (settings.hasKey ? 'Ключ сохранён · выберите модель' : 'Не подключено');
  el('chat-provider').textContent = settings.configured ? 'Cloud.ru · ' + settings.model : 'Cloud.ru · не подключён';
  if (document.activeElement !== el('cloud-model')) el('cloud-model').value = settings.model || '';
}
function renderCounts() {
  const pending = viewState.tasks.filter(item => !item.done).length;
  el('stat-notes').textContent = viewState.notes.length;
  el('orb-notes-count').textContent = viewState.notes.length;
  el('stat-tasks').textContent = pending;
  el('stat-messages').textContent = viewState.messages.length;
  el('memory-count').textContent = viewState.notes.length + ' записей';
  el('task-count').textContent = pending + ' активных';
  el('note-list-meta').textContent = viewState.notes.length + ' сохранено';
  el('task-list-meta').textContent = (viewState.tasks.length - pending) + ' выполнено';
}
function removeButton(onClick) {
  const button = escapeNotNeeded('button', 'item-delete');
  button.type = 'button';
  button.title = 'Удалить';
  button.setAttribute('aria-label', 'Удалить запись');
  button.append(icon('trash'));
  button.addEventListener('click', onClick);
  return button;
}
function renderNotes() {
  const list = el('note-list');
  list.replaceChildren();
  if (!viewState.notes.length) { list.append(escapeNotNeeded('div', 'empty-state', 'Заметок пока нет. Создайте первую запись.')); return; }
  viewState.notes.forEach(note => {
    const article = escapeNotNeeded('article', 'entry-card');
    article.dataset.noteId = note.id;
    const top = escapeNotNeeded('div', 'entry-card-top');
    top.append(escapeNotNeeded('h3', '', note.title));
    top.append(removeButton(() => run(async () => {
      await api('/api/notes/' + encodeURIComponent(note.id), { method: 'DELETE' });
      viewState.notes = viewState.notes.filter(item => item.id !== note.id);
      render();  notify('Запись удалена');
    })));
    article.append(top);
    if (note.body) article.append(escapeNotNeeded('p', 'note-text', note.body));
    article.append(escapeNotNeeded('small', 'item-time', new Date(note.createdAt).toLocaleDateString('ru-RU')));
    list.append(article);
  });
}
function renderTasks() {
  const list = el('task-list');
  list.replaceChildren();
  if (!viewState.tasks.length) { list.append(escapeNotNeeded('div', 'empty-state', 'Список пуст. Добавьте задачу.')); return; }
  viewState.tasks.forEach(task => {
    const row = escapeNotNeeded('div', 'task-row' + (task.done ? ' is-done' : ''));
    const label = escapeNotNeeded('label', 'task-label');
    const checkbox = escapeNotNeeded('input', 'task-checkbox');
    checkbox.type = 'checkbox'; checkbox.checked = Boolean(task.done);
    checkbox.addEventListener('change', () => run(async () => {
      checkbox.disabled = true;
      try {
        await api('/api/tasks/' + encodeURIComponent(task.id), { method: 'PATCH', body: { done: checkbox.checked } });
        task.done = checkbox.checked;
        render();
      } finally { checkbox.disabled = false; }
    }));
    label.append(checkbox, escapeNotNeeded('span', '', task.title));
    row.append(label, removeButton(() => run(async () => {
      await api('/api/tasks/' + encodeURIComponent(task.id), { method: 'DELETE' });
      viewState.tasks = viewState.tasks.filter(item => item.id !== task.id);
      render(); notify('Задача удалена');
    })));
    list.append(row);
  });
}
let chatScrollPinned=false;
let chatSearchMatches=[],chatSearchIndex=0;
function applyChatSearch({navigate=false}={}){
 const query=el('chat-search-input').value.trim().toLocaleLowerCase('ru-RU');
 const nodes=[...el('chat-thread').querySelectorAll('.message p')];
 chatSearchMatches=[];
 nodes.forEach(node=>{
  // Preserve the original text rather than repeatedly searching highlighted markup.
  const original=node.textContent;
  node.replaceChildren();
  if(!query){node.textContent=original;return}
  const lower=original.toLocaleLowerCase('ru-RU');
  let offset=0,at;
  while((at=lower.indexOf(query,offset))!==-1){
   node.append(document.createTextNode(original.slice(offset,at)));
   const mark=document.createElement('mark');mark.textContent=original.slice(at,at+query.length);
   node.append(mark);chatSearchMatches.push(mark);offset=at+query.length;
  }
  node.append(document.createTextNode(original.slice(offset)));
 });
 if(chatSearchIndex>=chatSearchMatches.length)chatSearchIndex=0;
 updateChatSearchSelection({navigate});
}
function updateChatSearchSelection({navigate=true}={}){
 chatSearchMatches.forEach((mark,i)=>mark.classList.toggle('current',i===chatSearchIndex));
 const count=el('chat-search-count'),query=el('chat-search-input').value.trim();
 count.textContent=!query?'Введите запрос':chatSearchMatches.length?(chatSearchIndex+1)+' из '+chatSearchMatches.length:'Совпадений нет';
 el('chat-search-prev').disabled=!chatSearchMatches.length;
 el('chat-search-next').disabled=!chatSearchMatches.length;
 if(navigate&&chatSearchMatches.length&&query){
  const mark=chatSearchMatches[chatSearchIndex];
  const list=el('chat-thread');
  const target=mark.getBoundingClientRect().top-list.getBoundingClientRect().top+list.scrollTop-list.clientHeight/2;
  list.scrollTo({top:Math.max(0,target),behavior:'instant'});
 }
}
function moveChatSearch(direction){
 if(!chatSearchMatches.length)return;
 chatSearchIndex=(chatSearchIndex+direction+chatSearchMatches.length)%chatSearchMatches.length;
 updateChatSearchSelection();
}

function updateChatJump(){
 const list=el('chat-thread'),jump=el('chat-jump');
 const distant=list.scrollHeight-list.scrollTop-list.clientHeight>110;
 jump.hidden=!distant;
 chatScrollPinned=distant;
}
function resizeChatInput(){
 const input=el('chat-input');
 input.style.height='auto';
 input.style.height=Math.min(input.scrollHeight,160)+'px';
}
function renderChat() {
  const list = el('chat-thread');
  const previousScroll=list.scrollTop,previousHeight=list.scrollHeight;
  list.replaceChildren();
  if (!viewState.messages.length) {
    const empty = escapeNotNeeded('div', 'chat-welcome');
    empty.append(escapeNotNeeded('span', '', '✦'), escapeNotNeeded('strong', '', 'Цукирэй на связи, ' + (globalThis.TsukireiSoulUI?.address?.()||'хозяин')),
      escapeNotNeeded('p', '', 'Для ответа ИИ сохраните ключ и модель Cloud.ru в настройках.'));
    list.append(empty);
  }
  const suggestion=proactiveSuggestions[0];
  if(suggestion){
    const bubble=escapeNotNeeded('div','message message-ai');
    bubble.append(escapeNotNeeded('small','','Цукирэй · предложение'),
      escapeNotNeeded('p','','Хозяин, я заметила повторяющуюся тему: '+suggestion.title+'. '+suggestion.reason));
    const actions=escapeNotNeeded('div','soul-chat-feedback');
    const discuss=escapeNotNeeded('button','soul-chat-feedback-button','Обсудить');
    discuss.type='button';
    discuss.addEventListener('click',()=>{
      el('chat-input').value='Давай обсудим: '+suggestion.title;
      el('chat-input').focus();updateChatCounter();
      proactiveSuggestions=proactiveSuggestions.filter(x=>x.id!==suggestion.id);
      renderChat();
    });
    const dismiss=escapeNotNeeded('button','soul-chat-feedback-button','Не сейчас');
    dismiss.type='button';
    dismiss.addEventListener('click',()=>run(async()=>{
      await api('/api/soul/outreach/dismiss',{method:'POST',body:{id:suggestion.id}});
      proactiveSuggestions=proactiveSuggestions.filter(x=>x.id!==suggestion.id);
      renderChat();
    }));
    actions.append(discuss,dismiss);bubble.append(actions);list.append(bubble);
  }
  viewState.messages.forEach(message => {
    const bubble = escapeNotNeeded('div', 'message ' + (message.role === 'user' ? 'message-user' : 'message-ai'));
    bubble.append(escapeNotNeeded('small', '', message.role === 'user' ? 'Вы' : 'Цукирэй'));
    bubble.append(escapeNotNeeded('p', '', message.content));
    const messageTools=escapeNotNeeded('div','chat-message-tools');
    const copy=escapeNotNeeded('button','chat-copy-button','⧉ Копировать');
    copy.type='button';copy.setAttribute('aria-label','Копировать текст сообщения');
    copy.addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(message.content);copy.textContent='✓ Скопировано';}
      catch{notify('Не удалось скопировать текст',true)}
    });
    messageTools.append(copy);bubble.append(messageTools);
    if (message.role === 'assistant') {
      const actions = escapeNotNeeded('div', 'soul-chat-feedback');
      for (const [symbol,label,rating] of [['✓','Полезный ответ','positive'],['✎','Исправить ответ','negative']]) {
        const button=escapeNotNeeded('button','soul-chat-feedback-button',symbol+' '+label);
        button.type='button';button.setAttribute('aria-label',label);
        button.addEventListener('click',()=>globalThis.TsukireiSoulUI?.feedback(message.id,rating));
        actions.append(button);
      }
      bubble.append(actions);
    }
    list.append(bubble);
  });
  if (chatSources.length) {
    const details = escapeNotNeeded('details', 'chat-rag-sources');
    const summary = escapeNotNeeded('summary', '', 'Источники памяти (' + chatSources.length + ')');
    details.append(summary);
    chatSources.forEach(source => {
      const item = escapeNotNeeded('div', 'chat-source-entry');
      item.append(escapeNotNeeded('strong', '', source.label + ' ' + source.title),
        escapeNotNeeded('p', '', source.excerpt));
      details.append(item);
    });
    list.append(details);
  }
  if(chatScrollPinned&&list.dataset.rendered)list.scrollTop=Math.max(0,previousScroll+list.scrollHeight-previousHeight);
  else list.scrollTop=list.scrollHeight;
  list.dataset.rendered='true';
  if(!el('chat-search').hidden)applyChatSearch({navigate:false});
  updateChatJump();
}
function render() { renderCounts(); renderNotes(); renderTasks(); renderStatus(); renderChat(); }


document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => go(button.dataset.page)));
window.addEventListener('hashchange',()=>{
  const target=window.location.hash.slice(1);
  go(Object.hasOwn(pages,target)?target:'home');
});
el('orb-open').addEventListener('click', () => go('memory'));
function setMobileMenu(open){
 if(open && !el('chat-panel').hidden) { toggleChat(false); el('mobile-menu').focus(); }
 el('shell').classList.toggle('menu-open',open);
 el('mobile-menu').setAttribute('aria-expanded',String(open));
 el('mobile-menu').setAttribute('aria-label',open?'Закрыть меню':'Открыть меню');
}
let monitorServerStepCache=[];
async function refreshMonitorServerSteps(){
 const list=el('monitor-server-steps');
 list.replaceChildren();
 const loading=document.createElement('p');loading.className='brain-trace-empty';loading.textContent='Загрузка этапов…';list.append(loading);
 try{
  const result=await api('/api/monitor/steps');
  list.replaceChildren();
  const items=Array.isArray(result.items)?result.items.slice(-60).reverse():[];
  monitorServerStepCache=items;
  const select=el('monitor-trace-select'),previous=select.value;
  const traces=[...new Set(items.map(item=>item.traceId).filter(Boolean))];
  select.replaceChildren();
  const all=document.createElement('option');all.value='all';all.textContent='Все запросы';select.append(all);
  for(const id of traces){const option=document.createElement('option');option.value=id;option.textContent='Цепочка '+id.slice(0,8);select.append(option);}
  select.value=traces.includes(previous)?previous:'all';
  renderMonitorServerSteps();

 }catch(error){
  monitorServerStepCache=[];
  renderMonitorServerSteps();
  list.replaceChildren();
  const message=document.createElement('p');message.className='brain-trace-empty';
  message.textContent='Не удалось получить этапы сервера: '+(error.message||'ошибка');
  list.append(message);
 }
}
function monitorStageSource(stage){
 if(stage==='Кэш памяти')return 'server/rag-advanced.ts';
 if(stage==='Векторизация запроса'||stage==='Ранжирование')return 'server/rag-provider.ts';
 if(stage==='Чтение для поиска'||stage==='Поиск по знаниям')return 'server/rag-engine.ts';
 if(stage==='Обработка опыта')return 'server/soul.ts';
 if(stage==='Поиск памяти')return 'server/index.ts · askRag()';
 if(stage==='Чтение истории'||stage==='Сохранение переписки')return 'server/index.ts · хранилище состояния';
 if(stage==='Ответ модели')return 'server/index.ts · Cloud.ru API';
 return 'server/index.ts · обработчик';
}
function renderMonitorPerformanceInsights(groups){
 const host=el('monitor-performance-insights');host.replaceChildren();
 if(!groups.size){
  const empty=document.createElement('p');empty.className='brain-trace-empty';
  empty.textContent='Нет измерений для анализа. Отправьте сообщение в чат.';host.append(empty);return;
 }
 for(const [id,chain] of groups){
  const top=chain.filter(item=>!item.parentStage&&Number.isFinite(Number(item.durationMs)));
  const section=document.createElement('section');section.className='monitor-insight-card';
  const title=document.createElement('strong');title.textContent='Цепочка '+id.slice(0,8);
  section.append(title);
  if(!top.length){
   const empty=document.createElement('p');empty.textContent='Нет измеренных основных этапов.';section.append(empty);host.append(section);continue;
  }
  const longest=top.reduce((a,b)=>Number(a.durationMs)>=Number(b.durationMs)?a:b);
  const total=top.reduce((sum,item)=>sum+Math.max(0,Number(item.durationMs)),0);
  const note=document.createElement('p');
  note.textContent='Самый длительный измеренный этап: '+String(longest.stage||'Этап')+' · '+String(longest.durationMs)+' мс';
  const share=document.createElement('span');share.className='monitor-insight-share';
  share.textContent=total>0?Math.round(Number(longest.durationMs)/total*100)+'% суммы основных этапов':'Недостаточно данных';
  section.append(note,share);
  const caveat=document.createElement('small');
  caveat.textContent='Доля от суммы измеренных основных этапов, не от полного времени ответа. Вложенные этапы не учитываются повторно.';
  section.append(caveat);host.append(section);
 }
}
function renderMonitorWaterfall(items){
 const host=el('monitor-trace-waterfall');host.replaceChildren();
 const groups=new Map();
 for(const item of items){
  const start=Date.parse(item.startedAt||'');
  if(!Number.isFinite(start))continue;
  const id=String(item.traceId||'unknown');
  if(!groups.has(id))groups.set(id,[]);
  groups.get(id).push({...item,start});
 }
 renderMonitorPerformanceInsights(groups);
 if(!groups.size){
  const empty=document.createElement('p');empty.className='brain-trace-empty';
  empty.textContent='Временная шкала появится после новых запросов чата.';host.append(empty);return;
 }
 for(const [id,chain] of groups){
  const min=Math.min(...chain.map(item=>item.start));
  const max=Math.max(...chain.map(item=>item.start+Math.max(0,Number(item.durationMs)||0)));
  const span=Math.max(1,max-min);
  const section=document.createElement('section');section.className='monitor-waterfall-chain';
  const heading=document.createElement('h4');heading.textContent='Цепочка '+id.slice(0,8)+' · '+Math.round(span)+' мс, наблюдаемый интервал';
  section.append(heading);
  chain.sort((a,b)=>a.start-b.start||Number(a.id)-Number(b.id));
  for(const item of chain){
   const row=document.createElement('div');row.className='monitor-waterfall-row';
   if(item.parentStage)row.dataset.nested='true';
   const label=document.createElement('span');label.className='monitor-waterfall-label';
   label.textContent=(item.parentStage?'↳ ':'')+String(item.stage||'Этап');
   const track=document.createElement('div');track.className='monitor-waterfall-track';
   const bar=document.createElement('div');bar.className='monitor-waterfall-bar';
   bar.dataset.ok=String(item.status==='ok');
   bar.style.left=((item.start-min)/span*100)+'%';
   bar.style.width=Math.max(0.5,Math.min(100-((item.start-min)/span*100),Math.max(0,Number(item.durationMs)||0)/span*100))+'%';
   bar.title=String(item.stage||'Этап')+' · '+String(item.durationMs)+' мс';
   track.append(bar);
   const duration=document.createElement('span');duration.className='monitor-waterfall-duration';duration.textContent=String(item.durationMs)+' мс';
   row.append(label,track,duration);section.append(row);
  }
  host.append(section);
 }
}
function renderMonitorTraceGraph(items){
 const graph=el('monitor-trace-graph'),detail=el('monitor-graph-detail');
 graph.replaceChildren();
 detail.textContent='Выберите узел графа, чтобы увидеть подтверждённые метаданные операции.';
 if(!items.length){const empty=document.createElement('p');empty.className='brain-trace-empty';empty.textContent='Пока нет зарегистрированных этапов для графа.';graph.append(empty);return;}
 const grouped=new Map();
 for(const item of items){
  const id=String(item.traceId||'unknown');
  if(!grouped.has(id))grouped.set(id,[]);
  grouped.get(id).push(item);
 }
 const groups=[...grouped.values()].reverse();
 for(const chain of groups){
  chain.sort((a,b)=>Number(a.id)-Number(b.id));
  const section=document.createElement('section');section.className='monitor-graph-chain';
  const heading=document.createElement('div');heading.className='monitor-graph-chain-title';
  heading.textContent='Цепочка '+String(chain[0].traceId||'без ID').slice(0,8)+' · '+chain.length+' этапов';
  section.append(heading);
  const track=document.createElement('div');track.className='monitor-graph-track';
  for(let i=0;i<chain.length;i++){
   const item=chain[i];
   if(i>0){const arrow=document.createElement('span');arrow.className='monitor-graph-arrow';arrow.textContent='→';arrow.setAttribute('aria-hidden','true');track.append(arrow);}
   const button=document.createElement('button');button.type='button';button.className='monitor-graph-node';
   button.dataset.ok=String(item.status==='ok');
   button.dataset.kind=/памят|поиск|ранжирован|векторизац|кэш/i.test(String(item.stage||''))?'rag':'core';
   const name=document.createElement('strong');name.textContent=String(item.stage||'Этап');
   const time=document.createElement('span');time.textContent=String(item.durationMs)+' мс';
   if(item.stage==='Чтение истории'||item.stage==='Сохранение переписки'){
    const backend=document.createElement('small');
    backend.className='monitor-graph-backend';
    const target=String(item.target||'');
    backend.textContent=target.includes('PostgreSQL')?'PostgreSQL':target.includes('JSON')?'Локальный JSON':'Хранилище';
    button.append(backend);
   }
   button.append(name,time);
   button.addEventListener('click',()=>{
    graph.querySelectorAll('.monitor-graph-node').forEach(node=>node.setAttribute('aria-pressed','false'));
    button.setAttribute('aria-pressed','true');
    detail.replaceChildren();
    const line=document.createElement('p');
    line.textContent=String(item.stage||'Этап')+' · '+String(item.target||'')+' · '+String(item.durationMs)+' мс · '+(item.status==='ok'?'Успешно':'Ошибка')+' · '+new Date(item.at).toLocaleString('ru-RU');
    const source=document.createElement('p');
    source.textContent='Связанный исходный код: '+monitorStageSource(String(item.stage||''));
    const link=document.createElement('a');
    const sourceFile=item.stage==='Обработка опыта'?'server/soul.ts':
      item.stage==='Кэш памяти'?'server/rag-advanced.ts':
      (item.stage==='Векторизация запроса'||item.stage==='Ранжирование')?'server/rag-provider.ts':
      (item.stage==='Чтение для поиска'||item.stage==='Поиск по знаниям')?'server/rag-engine.ts':'server/index.ts';
    link.href='https://github.com/Aspksa/Tsukirei/blob/main/'+sourceFile;
    link.target='_blank';link.rel='noopener noreferrer';
    link.textContent='Открыть исходный файл';
    detail.append(line,source,link);
   });
   button.setAttribute('aria-pressed','false');
   track.append(button);
  }
  section.append(track);graph.append(section);
 }
}
function filteredMonitorSteps(){
 const selected=el('monitor-trace-select').value;
 const filter=el('monitor-stage-filter').value;
 return monitorServerStepCache.filter(item=>{
  if(selected!=='all'&&item.traceId!==selected)return false;
  if(filter==='errors')return item.status==='error';
  if(filter==='slow')return Number(item.durationMs)>500;
  if(filter==='rag')return /памят|поиск|ранжирован|векторизац|кэш/i.test(String(item.stage||''));
  if(filter==='storage')return /Чтение истории|Чтение для поиска|Сохранение переписки/.test(String(item.stage||''));
  return true;
 });
}
function renderMonitorServerSteps(){
 const list=el('monitor-server-steps');
 const items=filteredMonitorSteps();
 renderMonitorTraceGraph(items);
 renderMonitorWaterfall(items);
 list.replaceChildren();
 el('monitor-trace-count').textContent=items.length+' из '+monitorServerStepCache.length+' этапов';
 if(!items.length){const empty=document.createElement('p');empty.className='brain-trace-empty';empty.textContent='Нет этапов для выбранных фильтров. Измените фильтр или обновите данные.';list.append(empty);return;}
 for(const item of items){
  const row=document.createElement('div');row.className='monitor-server-step';
  const stage=document.createElement('strong');stage.textContent=String(item.stage||'Этап');
  const target=document.createElement('code');target.textContent=String(item.target||'');
  const detail=document.createElement('span');detail.textContent=String(item.durationMs)+' мс · '+new Date(item.at).toLocaleTimeString('ru-RU')+' · '+(item.status==='ok'?'Успешно':'Ошибка');
  detail.dataset.ok=String(item.status==='ok');
  row.append(stage,target,detail);list.append(row);
 }
}
function monitorSafeReport(items){
 const lines=['Tsukirei · локальная диагностика','Только технические метаданные; без текста диалогов и содержимого памяти.',''];
 for(const item of items){
  const backend=String(item.target||'').includes('PostgreSQL')?'PostgreSQL':String(item.target||'').includes('JSON')?'JSON':'';
  const stage=String(item.stage||'Этап').replace(/[\r\n]/g,' ').slice(0,90);
  const time=Number(item.durationMs);
  const ms=Number.isFinite(time)?Math.max(0,Math.round(time)):0;
  const status=item.status==='ok'?'OK':'ERROR';
  const at=Number.isFinite(Date.parse(item.at))?new Date(item.at).toISOString():'—';
  lines.push(at+' | '+stage+' | '+status+' | '+ms+' мс'+(backend?' | '+backend:'')+(item.parentStage?' | вложенный этап':''));
 }
 return lines.join('\n');
}
el('monitor-report-copy').addEventListener('click',async()=>{
 const status=el('monitor-report-status');
 const items=filteredMonitorSteps();
 if(!items.length){status.textContent='Нет записей для копирования.';return;}
 try{
  await navigator.clipboard.writeText(monitorSafeReport(items));
  status.textContent='Отчёт скопирован: '+items.length+' этапов. Тексты сообщений не включены.';
 }catch{
  status.textContent='Не удалось скопировать. Проверьте разрешение буфера обмена.';
 }
});
el('monitor-trace-select').addEventListener('change',renderMonitorServerSteps);
el('monitor-stage-filter').addEventListener('change',renderMonitorServerSteps);
el('monitor-server-refresh').addEventListener('click',refreshMonitorServerSteps);
el('monitor-filter').addEventListener('change',renderBrainRequestTrace);
el('brain-trace-clear').addEventListener('click',()=>{brainRequestTrace.length=0;renderBrainRequestTrace();});
el('mobile-menu').addEventListener('click',()=>{
 const opening=!el('shell').classList.contains('menu-open');
 setMobileMenu(opening);
 if(opening) el('app-sidebar').querySelector('.nav-button')?.focus();
});
document.addEventListener('keydown',event=>{
 if(event.key!=='Tab'||!el('shell').classList.contains('menu-open'))return;
 const focusable=[el('mobile-menu'),...el('app-sidebar').querySelectorAll('a[href],button:not(:disabled)')].filter(node=>node.getClientRects().length);
 if(!focusable.length)return;
 const index=focusable.indexOf(document.activeElement);
 if(event.shiftKey && (index<=0)){event.preventDefault();focusable.at(-1).focus();}
 else if(!event.shiftKey && (index===focusable.length-1||index<0)){event.preventDefault();focusable[0].focus();}
});
document.addEventListener('pointerdown',event=>{
 if(!el('shell').classList.contains('menu-open'))return;
 if(event.target.closest('#app-sidebar, #mobile-menu'))return;
 setMobileMenu(false);
});
document.addEventListener('keydown',event=>{
 if(event.key!=='Escape'||!el('shell').classList.contains('menu-open'))return;
 event.preventDefault();
 event.stopImmediatePropagation();
 setMobileMenu(false);
 el('mobile-menu').focus();
});
window.matchMedia('(min-width: 521px)').addEventListener('change',event=>{
 if(event.matches)setMobileMenu(false);
});
el('today').textContent = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

el('note-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const title = el('note-title').value.trim(), body = el('note-body').value;
    const result = await api('/api/notes', { method: 'POST', body: { title, body } });
    viewState.notes.unshift(result.note);
    el('note-form').reset(); render();  notify('Знание сохранено локально');
  });
});
el('task-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const title = el('task-title').value.trim();
    const result = await api('/api/tasks', { method: 'POST', body: { title } });
    viewState.tasks.unshift(result.task);
    el('task-form').reset(); render(); notify('Задача добавлена');
  });
});
el('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const model = el('cloud-model').value.trim();
    const apiKey = el('cloud-key').value.trim();
    const body = { model };
    if (apiKey) body.apiKey = apiKey;
    const result = await api('/api/settings', { method: 'POST', body });
    viewState.settings = result.settings;
    el('cloud-key').value = '';
    renderStatus();
    el('settings-feedback').textContent = 'Настройки сохранены на локальном диске.';
    notify('Настройки Cloud.ru сохранены');
  });
});
el('check-cloud').addEventListener('click', () => run(async () => {
  const button = el('check-cloud');
  button.disabled = true; el('settings-feedback').textContent = 'Запрашиваю список моделей у Cloud.ru...';
  try {
    const result = await api('/api/models');
    const list = el('cloud-models');
    list.replaceChildren();
    result.models.forEach(model => {
      const option = document.createElement('option'); option.value = model; list.append(option);
    });
    el('settings-feedback').textContent = 'Соединение работает. Получено моделей: ' + result.models.length + '. Выберите модель и сохраните настройки.';
    notify('Список моделей загружен');
  } catch (error) { el('settings-feedback').textContent = error.message; throw error; }
  finally { button.disabled = false; }
}));

function toggleChat(open) {
  if (open && el('shell').classList.contains('menu-open')) setMobileMenu(false);
  el('chat-panel').hidden = !open;
  el('chat-toggle').setAttribute('aria-expanded', String(open));
  if (open) { renderChat(); el('chat-input').focus(); }
  else { el('chat-toggle').focus(); }
}
el('chat-toggle').addEventListener('click', () => toggleChat(el('chat-panel').hidden));
el('chat-search-toggle').addEventListener('click',()=>{
 const search=el('chat-search'),open=search.hidden;search.hidden=!open;
 el('chat-search-toggle').setAttribute('aria-expanded',String(open));
 if(open){el('chat-search-input').focus();applyChatSearch({navigate:false})}
 else{el('chat-search-input').value='';applyChatSearch();el('chat-input').focus()}
});
el('chat-search-input').addEventListener('input',()=>{chatSearchIndex=0;applyChatSearch({navigate:true})});
el('chat-search-prev').addEventListener('click',()=>moveChatSearch(-1));
el('chat-search-next').addEventListener('click',()=>moveChatSearch(1));
el('chat-search-input').addEventListener('keydown',event=>{
 if(event.key==='Enter'){event.preventDefault();moveChatSearch(event.shiftKey?-1:1)}
 if(event.key==='Escape'){event.stopPropagation();el('chat-search-toggle').click()}
});
el('chat-expand').addEventListener('click',()=>{
 const expanded=el('chat-panel').classList.toggle('chat-expanded');
 el('chat-expand').setAttribute('aria-pressed',String(expanded));
 el('chat-expand').setAttribute('aria-label',expanded?'Свернуть чат':'Развернуть чат');
 el('chat-expand').title=expanded?'Свернуть чат':'Развернуть чат';
 el('chat-input').focus();
});
function updateChatCounter(){el('chat-count').textContent=el('chat-input').value.length+' / 8000';resizeChatInput()}
el('chat-input').addEventListener('input',updateChatCounter);
el('chat-thread').addEventListener('scroll',updateChatJump,{passive:true});
el('chat-jump').addEventListener('click',()=>{el('chat-thread').scrollTo({top:el('chat-thread').scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});chatScrollPinned=false;el('chat-jump').hidden=true});
updateChatCounter();
el('chat-close').addEventListener('click', () => toggleChat(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !el('chat-panel').hidden) { event.preventDefault(); toggleChat(false); }
  if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); toggleChat(el('chat-panel').hidden); }
});
el('chat-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); el('chat-form').requestSubmit(); }
});
el('chat-form').addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  run(async () => {
    const prompt = el('chat-input').value.trim();
    if (!prompt) return;
    if (!viewState.settings.configured) { notify('Сначала подключите Cloud.ru в настройках', true); go('settings'); return; }
    busy = true; el('chat-send').disabled = true; el('chat-input').disabled = true;
    el('chat-send-status').hidden=false;el('chat-thread').setAttribute('aria-busy','true');
    try {
      const result = await api('/api/chat', { method: 'POST', body: { prompt, useMemory: el('chat-use-memory').checked } });
      viewState.messages = result.messages;
      chatSources = Array.isArray(result.sources) ? result.sources : [];
      el('chat-input').value = '';updateChatCounter();
      chatScrollPinned=false;render(); 
    } finally { busy = false; el('chat-send').disabled = false; el('chat-input').disabled = false;el('chat-send-status').hidden=true;el('chat-thread').removeAttribute('aria-busy'); el('chat-input').focus(); }
  });
});
el('clear-chat').addEventListener('click', () => run(async () => {
  if (!viewState.messages.length || !window.confirm('Очистить историю диалога на этом устройстве?')) return;
  const result = await api('/api/chat/clear', { method: 'POST', body: {} });
  viewState.messages = result.messages; chatSources = []; render(); notify('История диалога очищена');
}));


let ragProviderReady=false;
let ragLastWorkerState=null;
async function refreshRagEngine() {
  const output=el('rag-engine-status');
  try {
    const answer=await api('/api/rag/engine');
    const worker=answer.worker;
    ragLastWorkerState=worker;
    el('rag-engine-badge').textContent=worker.available ?
      (worker.running?'Работает':worker.paused?'Пауза':'Локально') : 'Требуется PostgreSQL';
    output.textContent=worker.available ?
      (worker.error?'Ошибка индекса: '+worker.error:
        worker.stage+' · '+worker.processed+'/'+worker.total+' обработано') :
      'Фоновый индекс доступен после подключения PostgreSQL. Поиск по заметкам продолжает работать.';
    el('rag-engine-stats').textContent=
      (answer.index?'Записей: '+answer.index.records+' · Связей: '+answer.index.relations+' · ':'')+
      'Кеш: '+answer.cache.entries+' · попаданий: '+answer.cache.hits+' · '+
      'Внешних вызовов сегодня: '+answer.provider.requestsToday+'/'+answer.provider.maxCallsPerDay;
    el('rag-engine-pause').disabled=!worker.available;
    el('rag-engine-reindex').disabled=!worker.available;
    el('rag-engine-pause').textContent=worker.paused?'Продолжить':'Приостановить';
    if(!ragProviderReady){
      const p=answer.provider;
      el('rag-embeddings-enabled').checked=Boolean(p.embeddingsEnabled);
      el('rag-auto-embed').checked=Boolean(p.autoEmbed);
      el('rag-provider-endpoint').value=p.endpoint||'';
      el('rag-provider-model').value=p.model||'endpoint-selected';
      el('rag-rerank-enabled').checked=Boolean(p.rerankEnabled);
      el('rag-rerank-endpoint').value=p.rerankEndpoint||'';
      el('rag-rerank-model').value=p.rerankModel||'endpoint-selected';
      el('rag-daily-limit').value=p.maxCallsPerDay||25;
      el('rag-provider-key').placeholder=p.hasKey?'Ключ сохранён; оставить пустым':'Введите API-ключ';
      el('rag-rerank-key').placeholder=p.hasRerankKey?'Ключ сохранён; оставить пустым':'Введите API-ключ';
      ragProviderReady=true;
    }
  } catch(error){output.textContent='Ошибка RAG: '+error.message;}
}
el('rag-engine-refresh').addEventListener('click',()=>run(refreshRagEngine));
el('rag-engine-reindex').addEventListener('click',()=>run(async()=>{
  const response=await api('/api/rag/engine/reindex',{method:'POST',body:{}});
  el('rag-engine-status').textContent='Обновление индекса поставлено в очередь.';
  await refreshRagEngine();
}));
el('rag-engine-pause').addEventListener('click',()=>run(async()=>{
  const paused=!ragLastWorkerState?.paused;
  await api('/api/rag/engine/pause',{method:'POST',body:{paused}});
  await refreshRagEngine();
}));
el('rag-curator-check').addEventListener('click',()=>run(async()=>{
  const box=el('rag-curator-results');
  box.replaceChildren(escapeNotNeeded('p','rag-hint','Проверка записей…'));
  const result=await api('/api/rag/curator');
  box.replaceChildren();
  if(!result.items.length)box.append(escapeNotNeeded('p','rag-hint','Совпадений по проверяемым правилам не найдено.'));
  const labels={duplicate:'Дубликат',possible_conflict:'Возможный конфликт',stale:'Проверить актуальность'};
  for(const issue of result.items.slice(0,60)){
    const item=escapeNotNeeded('div','rag-inspection-item');
    item.append(escapeNotNeeded('strong','',labels[issue.type]||'Проверка'),
      escapeNotNeeded('p','',issue.detail),
      escapeNotNeeded('small','',issue.keys.join(' · ')));
    box.append(item);
  }
}));
el('rag-graph-form').addEventListener('submit',event=>{
  event.preventDefault();
  run(async()=>{
    const query=el('rag-graph-query').value.trim();
    const result=await api('/api/rag/graph?q='+encodeURIComponent(query));
    const box=el('rag-graph-results');box.replaceChildren();
    if(!result.items.length)box.append(escapeNotNeeded('p','rag-hint','Подтверждённых текстом связей не найдено.'));
    for(const relation of result.items.slice(0,60)){
      const item=escapeNotNeeded('div','rag-inspection-item');
      item.append(escapeNotNeeded('strong','',relation.subject+' · '+relation.relation+' · '+relation.object),
        escapeNotNeeded('p','',relation.evidence),
        escapeNotNeeded('small','','Источник: '+relation.source_key));
      box.append(item);
    }
  });
});
el('rag-provider-form').addEventListener('submit',event=>{
  event.preventDefault();
  run(async()=>{
    const payload={
      embeddingsEnabled:el('rag-embeddings-enabled').checked,
      autoEmbed:el('rag-auto-embed').checked,
      endpoint:el('rag-provider-endpoint').value.trim(),
      model:el('rag-provider-model').value.trim(),
      rerankEnabled:el('rag-rerank-enabled').checked,
      rerankEndpoint:el('rag-rerank-endpoint').value.trim(),
      rerankModel:el('rag-rerank-model').value.trim(),
      maxCallsPerDay:Number(el('rag-daily-limit').value)
    };
    const embedKey=el('rag-provider-key').value.trim(),rerankKey=el('rag-rerank-key').value.trim();
    if(embedKey)payload.apiKey=embedKey;
    if(rerankKey)payload.rerankApiKey=rerankKey;
    const answer=await api('/api/rag/provider',{method:'POST',body:payload});
    el('rag-provider-key').value='';el('rag-rerank-key').value='';
    ragProviderReady=false;
    el('rag-provider-feedback').textContent='Настройки сохранены локально. Внешние вызовы: '+
      (answer.settings.embeddingsEnabled||answer.settings.rerankEnabled?'разрешены по настройкам':'выключены');
    await refreshRagEngine();
  });
});

async function refreshRagDocuments() {
  const items = el('rag-document-list');
  if (!viewState.database.connected) {
    el('rag-status').textContent = 'Поиск по памяти';
    items.replaceChildren(escapeNotNeeded('p', 'rag-hint', 'Для импорта документов нужен PostgreSQL + pgvector. Поиск по заметкам и чатам доступен.'));
    el('rag-document-count').textContent = '0';
    return;
  }
  try {
    const result = await api('/api/rag/documents');
    items.replaceChildren();
    const documents = Array.isArray(result.items) ? result.items : [];
    el('rag-document-count').textContent = String(documents.length);
    el('rag-status').textContent = 'RAG · PostgreSQL';
    if (!documents.length) {
      items.append(escapeNotNeeded('p', 'rag-hint', 'Документов пока нет.'));
    }
    documents.forEach(doc => {
      const card = escapeNotNeeded('div', 'rag-document-entry');
      const meta = escapeNotNeeded('div', 'rag-document-meta');
      meta.append(escapeNotNeeded('strong', '', doc.title),
        escapeNotNeeded('small', '', doc.parts + ' фрагментов · ' + doc.source));
      card.append(meta,removeButton(() => run(async () => {
        if (!window.confirm('Удалить документ «' + doc.title + '» из RAG?')) return;
        await api('/api/rag/documents/' + encodeURIComponent(doc.id), { method: 'DELETE' });
        await refreshRagDocuments();
        notify('Документ удалён из RAG');
      })));
      items.append(card);
    });
  } catch (error) {
    items.replaceChildren(escapeNotNeeded('p', 'rag-hint', 'Не удалось получить документы: ' + error.message));
  }
}
el('rag-search-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const query = el('rag-query').value.trim();
    const resultBox = el('rag-results');
    resultBox.replaceChildren(escapeNotNeeded('div', 'empty-state', 'Ищу по локальной памяти…'));
    const result = await api('/api/rag/search', { method: 'POST', body: { query, limit: 12 } });
    const matches = Array.isArray(result.items) ? result.items : [];
    el('rag-results-meta').textContent = matches.length + ' найдено · ' + (result.mode === 'hybrid' ? 'Гибридный' : 'Лексический') + ' поиск' + (result.cloudRequests ? ' · внешних вызовов: ' + result.cloudRequests : ' · без внешних вызовов');
    resultBox.replaceChildren();
    if (!matches.length) {
      resultBox.append(escapeNotNeeded('div', 'empty-state', 'Подходящих записей не найдено.'));
      return;
    }
    const kindNames = {note:'Заметка',dialogue:'Диалог',knowledge:'Знание',document:'Документ'};
    matches.forEach(source => {
      const card = escapeNotNeeded('article', 'rag-result-card');
      const heading = escapeNotNeeded('div', 'rag-result-heading');
      heading.append(escapeNotNeeded('span', 'panel-kicker', kindNames[source.kind] || 'Запись'),
        escapeNotNeeded('small', '', source.label + ' · ' + source.score));
      card.append(heading, escapeNotNeeded('h3', '', source.title),
        escapeNotNeeded('p', 'rag-excerpt', source.excerpt));
      if (source.kind === 'note') {
        const action = escapeNotNeeded('button', 'text-action', 'Показать заметку →');
        action.type = 'button';
        action.addEventListener('click', () => {
          go('memory');
          const note = Array.from(document.querySelectorAll('[data-note-id]'))
            .find(node => node.dataset.noteId === source.id);
          if (note) note.scrollIntoView({ behavior:'smooth', block:'center' });
        });
        card.append(action);
      }
      resultBox.append(card);
    });
  });
});
el('rag-file').addEventListener('change', () => run(async () => {
  const file = el('rag-file').files?.[0];
  if (!file) return;
  if (!/\.(txt|md|markdown|csv|json)$/i.test(file.name)) throw new Error('Разрешены TXT, MD, CSV и JSON.');
  if (file.size > 320000) throw new Error('Размер файла ограничен 320 КБ. Разделите большой документ на части.');
  if (!el('rag-title').value.trim()) el('rag-title').value = file.name.slice(0,150);
  el('rag-content').value = (await file.text()).slice(0,100000);
  el('rag-import-status').textContent = 'Текст файла загружен локально. Нажмите «Сохранить документ».';
}));
el('rag-import-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const title = el('rag-title').value.trim();
    const content = el('rag-content').value.trim();
    if (!content) throw new Error('Добавьте текст документа или выберите файл.');
    el('rag-import-status').textContent = 'Сохраняю в локальную базу…';
    const result = await api('/api/rag/documents', {
      method:'POST',body:{ title,content,source:el('rag-file').files?.[0]?.name || 'manual' }
    });
    el('rag-import-form').reset();
    el('rag-import-status').textContent = result.duplicate ?
      'Такой документ уже сохранён. Дублирование предотвращено.' : 'Документ сохранён и добавлен в поиск.';
    await refreshRagDocuments();
  });
});

function showFailedStart(message) {
  el('status-text').textContent = 'Ошибка локального сервера';
  el('connection-heading').textContent = 'Не удалось загрузить данные';
  el('connection-detail').textContent = message + ' Проверьте окно BAT и журналы в папке logs.';
  notify(message, true);
}

api('/api/state').then(data => {
  Object.assign(viewState, data);
  render();
  globalThis.TsukireiSoulUI?.refresh();
  void refreshProactiveChat();
  const page = window.location.hash.slice(1);
  go(pages[page] ? page : 'home');
}).catch(err => showFailedStart(err.message));
