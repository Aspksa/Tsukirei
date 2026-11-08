'use strict';

const pages = { home: 'Обзор', memory: 'Память', city: 'Город памяти', tasks: 'Дела', agents: 'Агенты', settings: 'Настройки' };
const el = (id) => document.getElementById(id);
const viewState = { notes: [], tasks: [], messages: [], settings: { configured: false, hasKey: false, model: '' }, database: { connected: false, engine: 'JSON (legacy)' } };
let busy = false;
let toastTimer;
let city = null;
let cityArchive = null;
let cityLoadGeneration = 0;
let cityLoading = false;
let cityLoaded = false;
let citySearchDelay;

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
  if (!pages[page]) return;
  for (const name of Object.keys(pages)) {
    const section = el('page-' + name);
    const selected = name === page;
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
  el('shell').classList.remove('menu-open');
  city?.activate(page === 'city');
  if (page !== 'city' && cityLoading) {
    // Stop the incremental import when the city is no longer visible.
    cityLoadGeneration++;
    cityLoading = false;
    cityArchive = null;
  }
  if (page === 'city' && !cityLoaded && !cityLoading) loadCityArchive();
  window.location.hash = page;
}
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
      render(); staleCity(); notify('Запись удалена');
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
    empty.append(escapeNotNeeded('span', '', '✦'), escapeNotNeeded('strong', '', 'Ваш диалог с Цукирэй'),
      escapeNotNeeded('p', '', 'Для ответа ИИ сохраните ключ и модель Cloud.ru в настройках.'));
    list.append(empty); return;
  }
  viewState.messages.forEach(message => {
    const bubble = escapeNotNeeded('div', 'message ' + (message.role === 'user' ? 'message-user' : 'message-ai'));
    bubble.append(escapeNotNeeded('small', '', message.role === 'user' ? 'Вы' : 'Цукирэй'));
    bubble.append(escapeNotNeeded('p', '', message.content));
    list.append(bubble);
  });
  list.scrollTop = list.scrollHeight;
}
function render() { renderCounts(); renderNotes(); renderTasks(); renderStatus(); renderChat(); if (!cityArchive) city?.update(viewState); }


function renderCitySearch() {
  const results = el('city-search-results');
  const query = el('city-search-input').value.trim();
  results.replaceChildren();
  if (query.length < 2) {
    if (query) results.append(escapeNotNeeded('p', 'city-search-hint', 'Введите минимум 2 символа.'));
    return;
  }
  const matches = city?.search?.(query, 14) || [];
  if (!matches.length) {
    results.append(escapeNotNeeded('p', 'city-search-hint', cityLoading ?
      'Записи ещё загружаются…' : 'Совпадений в городе нет.'));
    return;
  }
  for (const entry of matches) {
    const button = escapeNotNeeded('button', 'city-search-result');
    button.type = 'button';
    button.setAttribute('role', 'listitem');
    button.append(escapeNotNeeded('span', '', entry.title),
      escapeNotNeeded('small', '', entry.districtName));
    button.addEventListener('click', () => {
      city?.focus?.(entry.id);
      el('city-canvas').focus();
    });
    results.append(button);
  }
}

function cityStatus(message, isError = false) {
  const target = el('city-load-status');
  if (target) {
    target.textContent = message;
    target.classList.toggle('is-error', isError);
  }
}
function staleCity() {
  cityArchive = null;
  cityLoaded = false;
  cityLoadGeneration++;
  cityLoading = false;
  if (window.location.hash === '#city') loadCityArchive();
  else city?.update(viewState);
}
async function loadCityArchive() {
  if (cityLoading || !city) return;
  const generation = ++cityLoadGeneration;
  cityLoading = true;
  cityLoaded = false;
  cityStatus('Читаю локальный архив…');
  // Compact entries: one preview and original text length per record.
  // Full text remains in PostgreSQL/JSON and is requested on demand.
  const archive = { notes: [], messages: [], knowledge: [] };
  cityArchive = archive;
  let loaded = 0, total = 0, redrawAt = 400;
  try {
    let stateRevision = null;
    for (const kind of ['notes', 'messages', 'knowledge']) {
      let offset = 0, revision = null, more = true;
      while (more) {
        const page = await api('/api/city/archive?compact=1&kind=' + kind +
          '&offset=' + offset + '&limit=200');
        if (generation !== cityLoadGeneration) return;
        if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total) ||
            page.total < 0 || page.items.length > 200 ||
            page.offset !== offset || page.kind !== kind) {
          throw new Error('Сервер вернул некорректную страницу архива.');
        }
        if (revision !== null && page.revision !== revision) {
          throw new Error('Архив изменился во время чтения. Нажмите «Обновить город».');
        }
        if (kind !== 'knowledge' && stateRevision !== null && page.revision !== stateRevision) {
          throw new Error('Архив изменился между загрузкой заметок и сообщений.');
        }
        revision = page.revision;
        if (kind === 'notes' && page.revision !== null) stateRevision = page.revision;
        archive[kind].push(...page.items);
        loaded += page.items.length;
        if (offset === 0) total += page.total;
        offset += page.items.length;
        more = Boolean(page.hasMore);
        cityStatus('Читаю память: ' + loaded.toLocaleString('ru-RU') +
          ' / ' + total.toLocaleString('ru-RU') + ' записей…');
        if (more && page.items.length === 0) {
          throw new Error('Сервер не продвинул позицию архива.');
        }
        // Logarithmic drawing checkpoints: 400, 800, 1600, 3200 ...
        // This is much cheaper than rebuilding the whole 3D scene after every page.
        if (loaded >= redrawAt && city && window.location.hash === '#city') {
          city.update(archive);
          renderCitySearch();
          redrawAt *= 2;
          await new Promise(resolve => requestAnimationFrame(resolve));
          if (generation !== cityLoadGeneration) return;
        }
      }
    }
    if (generation !== cityLoadGeneration) return;
    cityLoaded = true;
    city.update(archive);
    renderCitySearch();
    const count = archive.notes.length + archive.messages.length + archive.knowledge.length;
    cityStatus('Полный архив: ' + count.toLocaleString('ru-RU') +
      ' записей · ' + (city.is3D ? 'WebGL 3D' : 'Canvas 2D') +
      ' · превью сохранены локально');
  } catch (error) {
    if (generation !== cityLoadGeneration) return;
    cityLoaded = false;
    cityStatus('Ошибка загрузки: ' + (error.message || 'неизвестная'), true);
    notify('Не удалось загрузить полный архив города', true);
  } finally {
    if (generation === cityLoadGeneration) cityLoading = false;
  }
}


document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => go(button.dataset.page)));
el('city-reload').addEventListener('click', staleCity);
el('city-search-input').addEventListener('input', () => {
  clearTimeout(citySearchDelay);
  citySearchDelay = setTimeout(renderCitySearch, 180);
});
el('orb-open').addEventListener('click', () => go('city'));
el('mobile-menu').addEventListener('click', () => el('shell').classList.toggle('menu-open'));
el('today').textContent = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

el('note-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const title = el('note-title').value.trim(), body = el('note-body').value;
    const result = await api('/api/notes', { method: 'POST', body: { title, body } });
    viewState.notes.unshift(result.note);
    el('note-form').reset(); render(); staleCity(); notify('Знание сохранено локально');
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
      const result = await api('/api/chat', { method: 'POST', body: { prompt } });
      viewState.messages = result.messages;
      el('chat-input').value = '';
      render(); staleCity();
    } finally { busy = false; el('chat-send').disabled = false; el('chat-input').disabled = false; el('chat-input').focus(); }
  });
});
el('clear-chat').addEventListener('click', () => run(async () => {
  if (!viewState.messages.length || !window.confirm('Очистить историю диалога на этом устройстве?')) return;
  const result = await api('/api/chat/clear', { method: 'POST', body: {} });
  viewState.messages = result.messages; render(); staleCity(); notify('История диалога очищена');
}));

function showFailedStart(message) {
  el('status-text').textContent = 'Ошибка локального сервера';
  el('connection-heading').textContent = 'Не удалось загрузить данные';
  el('connection-detail').textContent = message + ' Проверьте окно BAT и журналы в папке logs.';
  notify(message, true);
}

const cityConfig = {
  canvas: el('city-canvas'),
  detail: el('city-detail'),
  districtsList: el('city-district-list'),
  async onInspect(record, container, button) {
    const kind = record.kind === 'note' ? 'notes'
      : record.kind === 'chat' ? 'messages' : 'knowledge';
    const selected = container.dataset.selectedRecord;
    button.disabled = true;
    button.textContent = 'Читаю исходную запись…';
    try {
      const result = await api('/api/city/entry?kind=' + kind +
        '&id=' + encodeURIComponent(record.sourceId));
      if (container.dataset.selectedRecord !== selected) return;
      const entry = result.entry;
      const content = record.kind === 'note' ? ((entry.title || '') + '\n\n' + (entry.body || ''))
        : entry.content;
      const field = container.querySelector('.city-detail-body');
      if (field) {
        field.textContent = String(content || '');
        field.classList.add('city-full-text');
      }
      button.textContent = 'Полный текст загружен';
    } catch (error) {
      if (container.dataset.selectedRecord !== selected) return;
      button.textContent = 'Повторить чтение';
      button.disabled = false;
      notify(error.message || 'Не удалось прочитать запись', true);
    }
  },
  onNavigate(record) {
    if (record.kind === 'note') {
      go('memory');
      const note = Array.from(document.querySelectorAll('[data-note-id]')).find(item => item.dataset.noteId === record.sourceId);
      if (note) {
        note.scrollIntoView({ behavior: 'smooth', block: 'center' });
        note.classList.add('city-highlight-note');
        setTimeout(() => note.classList.remove('city-highlight-note'), 1400);
      }
    } else if (record.kind === 'chat') {
      toggleChat(true);
    }
  }
};
try {
  city = globalThis.TsukireiCity3D?.startCity(cityConfig);
} catch (error) {
  console.warn('3D renderer failed; switching to Canvas 2D:', error);
  const old = cityConfig.canvas;
  const replacement = old.cloneNode(false);
  old.replaceWith(replacement);
  cityConfig.canvas = replacement;
}
if (!city) city = globalThis.TsukireiCity?.startCity(cityConfig);
if (!city) cityStatus('Визуализация недоступна в этом браузере.', true);

api('/api/state').then(data => {
  Object.assign(viewState, data);
  render();
  const page = window.location.hash.slice(1);
  go(pages[page] ? page : 'home');
}).catch(err => showFailedStart(err.message));
