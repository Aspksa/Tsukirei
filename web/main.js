'use strict';

const pages = { home: 'Обзор', memory: 'Память', tasks: 'Дела', agents: 'Агенты', settings: 'Настройки' };
const el = (id) => document.getElementById(id);
const viewState = { notes: [], tasks: [], messages: [], settings: { configured: false, hasKey: false, model: '' } };
let busy = false;
let toastTimer;

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
  window.location.hash = page;
}
function renderStatus() {
  const settings = viewState.settings;
  el('status-text').textContent = settings.configured ? 'Cloud.ru настроен' : 'Локальная система';
  el('connection-pill').textContent = settings.configured ? 'ИИ настроен' : 'Локальная';
  el('connection-heading').textContent = settings.configured ? 'Всё готово для диалога' : 'Цукирэй на связи';
  el('connection-detail').textContent = settings.configured ? 'Облачная модель включится только по вашему запросу.' : 'Заметки и задачи доступны. Для ИИ-чата подключите Cloud.ru.';
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
    const top = escapeNotNeeded('div', 'entry-card-top');
    top.append(escapeNotNeeded('h3', '', note.title));
    top.append(removeButton(() => run(async () => {
      await api('/api/notes/' + encodeURIComponent(note.id), { method: 'DELETE' });
      viewState.notes = viewState.notes.filter(item => item.id !== note.id);
      render(); notify('Запись удалена');
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
function render() { renderCounts(); renderNotes(); renderTasks(); renderStatus(); renderChat(); }

document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => go(button.dataset.page)));
el('orb-open').addEventListener('click', () => go('memory'));
el('mobile-menu').addEventListener('click', () => el('shell').classList.toggle('menu-open'));
el('today').textContent = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

el('note-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const title = el('note-title').value.trim(), body = el('note-body').value;
    const result = await api('/api/notes', { method: 'POST', body: { title, body } });
    viewState.notes.unshift(result.note);
    el('note-form').reset(); render(); notify('Знание сохранено локально');
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
      render();
    } finally { busy = false; el('chat-send').disabled = false; el('chat-input').disabled = false; el('chat-input').focus(); }
  });
});
el('clear-chat').addEventListener('click', () => run(async () => {
  if (!viewState.messages.length || !window.confirm('Очистить историю диалога на этом устройстве?')) return;
  const result = await api('/api/chat/clear', { method: 'POST', body: {} });
  viewState.messages = result.messages; render(); notify('История диалога очищена');
}));

function showFailedStart(message) {
  el('status-text').textContent = 'Ошибка локального сервера';
  el('connection-heading').textContent = 'Не удалось загрузить данные';
  el('connection-detail').textContent = message + ' Проверьте окно BAT и журналы в папке logs.';
  notify(message, true);
}
run(async () => {
  const data = await api('/api/state');
  Object.assign(viewState, data);
  render();
  const page = window.location.hash.slice(1);
  go(pages[page] ? page : 'home');
}).catch(err => showFailedStart(err.message));
