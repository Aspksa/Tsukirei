'use strict';

const pages = { brain: 'Мозг', home: 'Обзор', memory: 'Память', search: 'RAG и документы', tasks: 'Дела', agents: 'Агенты', soul: 'Личность', living: 'Развитие', cognition: 'Мышление', supermind: 'Душа и сверхразум', settings: 'Настройки' };
const el = (id) => document.getElementById(id);
const advancedMount=document.getElementById('advanced-rag-mount');
const technicalRagPanel=document.querySelector('.rag-engine-panel');
if(advancedMount&&technicalRagPanel)advancedMount.append(technicalRagPanel);

const viewState = { notes: [], tasks: [], messages: [], settings: { configured: false, hasKey: false, model: '' }, database: { connected: false, engine: 'JSON (legacy)' } };
let busy = false;
let toastTimer;
let chatSources = [];
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
async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      method: options.method || 'GET',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
  } catch { throw new Error('Не удаётся подключиться к локальному серверу.'); }
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
  if (window.location.hash !== '#' + page) window.location.hash = page;
  if (page === 'brain') void refreshBrainOverview();
  if (page === 'search') { refreshRagDocuments(); refreshRagEngine(); }
  if (page === 'soul') globalThis.TsukireiSoulUI?.refresh();
  if (page === 'living') globalThis.TsukireiLivingUI?.refresh();
  if (page === 'cognition') globalThis.TsukireiCognitionUI?.refresh();
  if (page === 'supermind') globalThis.TsukireiSupermindUI?.refresh();
}
let brainLoading=false;
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
el('brain-refresh').addEventListener('click',()=>{void refreshBrainOverview();});
async function refreshBrainKnowledge(){
  const svg=el('brain-map-svg');
  const detail=el('brain-graph-detail');
  const query=el('brain-graph-query').value.trim().slice(0,70);
  detail.textContent='Загружаю подтверждённые источниками связи...';
  try{
    const graph=await api('/api/cognition/world'+(query?'?q='+encodeURIComponent(query):''));
    const allNodes=Array.isArray(graph.nodes)?graph.nodes.slice(0,70):[];
    const allEdges=Array.isArray(graph.edges)?graph.edges.slice(0,140):[];
    const nodes=allNodes.map((node,i)=>({
      id:String(node.id),label:String(node.label||node.id).slice(0,90),
      x:350+Math.cos(i*2.399963)*Math.sqrt((i+.5)/Math.max(allNodes.length,1))*295,
      y:170+Math.sin(i*2.399963)*Math.sqrt((i+.5)/Math.max(allNodes.length,1))*140
    }));
    const byId=new Map(nodes.map(node=>[node.id,node]));
    svg.setAttribute('viewBox','0 0 700 340');
    svg.replaceChildren();
    const ns='http://www.w3.org/2000/svg';
    const make=(tag,attrs,parent=svg)=>{
      const element=document.createElementNS(ns,tag);
      for(const [key,value] of Object.entries(attrs))element.setAttribute(key,String(value));
      parent.append(element);return element;
    };
    for(const edge of allEdges){
      const a=byId.get(String(edge.from)),b=byId.get(String(edge.to));
      if(a&&b)make('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#a68b58','stroke-opacity':'.5','stroke-width':1.3});
    }
    for(const node of nodes){
      const group=make('g',{tabindex:0,role:'button','aria-label':node.label});
      make('circle',{cx:node.x,cy:node.y,r:8,fill:'#d6ad63',stroke:'#f3d99b','stroke-width':1.2},group);
      const label=make('text',{x:node.x,y:node.y+21,'text-anchor':'middle',fill:'#e9dfca','font-size':10},group);
      label.textContent=node.label.slice(0,19);
      const inspect=()=>{
        const connected=allEdges.filter(e=>String(e.from)===node.id||String(e.to)===node.id);
        detail.textContent=node.label+' · Связей: '+connected.length+
          (connected.length?' · '+connected.slice(0,5).map(e=>String(e.from)===node.id?String(e.to):String(e.from)).join(', '):'');
      };
      group.addEventListener('click',inspect);
      group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();inspect();}});
    }
    detail.textContent=nodes.length?'Реальный граф: '+nodes.length+' узлов, '+allEdges.length+' связей. Выбери узел.':
      'Связи пока не извлечены. Добавь документы и запусти проверку знаний.';
    el('brain-footnote').textContent='Граф строится из локально сохранённых связей Cognitive Core. Cloud.ru не вызывается.';
  }catch(error){detail.textContent='Не удалось загрузить граф: '+(error.message||'ошибка');}
}
el('brain-graph-search').addEventListener('click',()=>{void refreshBrainKnowledge();});
el('brain-graph-query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void refreshBrainKnowledge();}});
el('brain-graph-overview').addEventListener('click',()=>{el('brain-map-svg').setAttribute('viewBox','0 0 700 230');void refreshBrainOverview();});

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
function renderChat() {
  const list = el('chat-thread');
  list.replaceChildren();
  if (!viewState.messages.length) {
    const empty = escapeNotNeeded('div', 'chat-welcome');
    empty.append(escapeNotNeeded('span', '', '✦'), escapeNotNeeded('strong', '', 'Цукирэй на связи, ' + (globalThis.TsukireiSoulUI?.address?.()||'хозяин')),
      escapeNotNeeded('p', '', 'Для ответа ИИ сохраните ключ и модель Cloud.ru в настройках.'));
    list.append(empty); return;
  }
  viewState.messages.forEach(message => {
    const bubble = escapeNotNeeded('div', 'message ' + (message.role === 'user' ? 'message-user' : 'message-ai'));
    bubble.append(escapeNotNeeded('small', '', message.role === 'user' ? 'Вы' : 'Цукирэй'));
    bubble.append(escapeNotNeeded('p', '', message.content));
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
  list.scrollTop = list.scrollHeight;
}
function render() { renderCounts(); renderNotes(); renderTasks(); renderStatus(); renderChat(); }


document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => go(button.dataset.page)));
window.addEventListener('hashchange',()=>{
  const target=window.location.hash.slice(1);
  go(Object.hasOwn(pages,target)?target:'home');
});
el('orb-open').addEventListener('click', () => go('memory'));
el('mobile-menu').addEventListener('click', () => el('shell').classList.toggle('menu-open'));
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
  el('chat-panel').hidden = !open;
  el('chat-toggle').setAttribute('aria-expanded', String(open));
  if (open) { renderChat(); el('chat-input').focus(); }
}
el('chat-toggle').addEventListener('click', () => toggleChat(el('chat-panel').hidden));
el('chat-close').addEventListener('click', () => toggleChat(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !el('chat-panel').hidden) toggleChat(false);
  if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); toggleChat(el('chat-panel').hidden); }
});
el('chat-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); el('chat-form').requestSubmit(); }
});
el('chat-form').addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  run(async () => {
    const prompt = el('chat-input').value.trim();
    if (!prompt) return;
    if (!viewState.settings.configured) { notify('Сначала подключите Cloud.ru в настройках', true); go('settings'); return; }
    busy = true; el('chat-send').disabled = true; el('chat-input').disabled = true;
    try {
      const result = await api('/api/chat', { method: 'POST', body: { prompt, useMemory: el('chat-use-memory').checked } });
      viewState.messages = result.messages;
      chatSources = Array.isArray(result.sources) ? result.sources : [];
      el('chat-input').value = '';
      render(); 
    } finally { busy = false; el('chat-send').disabled = false; el('chat-input').disabled = false; el('chat-input').focus(); }
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
  const page = window.location.hash.slice(1);
  go(pages[page] ? page : 'home');
}).catch(err => showFailedStart(err.message));
