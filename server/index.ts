import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

type Note = { id: string; title: string; body: string; createdAt: string };
type Task = { id: string; title: string; done: boolean; createdAt: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
type State = { notes: Note[]; tasks: Task[]; messages: Message[] };
type CloudSettings = { apiKey: string; model: string };
type Json = Record<string, unknown>;

const root = process.cwd();
const dataDir = process.env.TSUKIREI_DATA_DIR ? resolve(process.env.TSUKIREI_DATA_DIR) : join(root, 'data');
const statePath = join(dataDir, 'tsukirei.json');
const cloudPath = join(dataDir, 'cloudru-settings.json');
const endpoint = 'https://foundation-models.api.cloud.ru/v1';
const port = Number(process.env.PORT ?? 3000);
let cloudBusy = false;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function newState(): State { return { notes: [], tasks: [], messages: [] }; }
function readState(): State {
  if (!existsSync(statePath)) return newState();
  const data = JSON.parse(readFileSync(statePath, 'utf8')) as State;
  if (!data || !Array.isArray(data.notes) || !Array.isArray(data.tasks) || !Array.isArray(data.messages)) {
    throw new Error('Файл данных повреждён: ' + statePath);
  }
  return data;
}
function readCloud(): CloudSettings {
  if (!existsSync(cloudPath)) return { apiKey: '', model: '' };
  const value = JSON.parse(readFileSync(cloudPath, 'utf8')) as CloudSettings;
  if (typeof value.apiKey !== 'string' || typeof value.model !== 'string') throw new Error('Файл настроек Cloud.ru повреждён');
  return value;
}
function saveAtomic(path: string, data: unknown): void {
  mkdirSync(dataDir, { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
}
function json(res: ServerResponse, code: number, value: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function requiredText(value: unknown, label: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, label + ': введите текст (максимум ' + max + ' символов)');
  }
  return value.trim();
}
function validId(id: string): boolean { return /^[0-9a-f-]{36}$/i.test(id); }
async function bodyJson(req: IncomingMessage): Promise<Json> {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Нужен Content-Type: application/json');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(Buffer.from(chunk));
  }
  try {
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('not an object');
    return result as Json;
  } catch { throw new HttpError(400, 'Некорректный JSON'); }
}
function settingsPublic() {
  const c = readCloud();
  return { configured: Boolean(c.apiKey && c.model), hasKey: Boolean(c.apiKey), model: c.model, provider: 'Cloud.ru Foundation Models' };
}
function staticFile(res: ServerResponse, filename: string, type: string) {
  const data = readFileSync(filename);
  res.writeHead(200, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
  });
  res.end(data);
}
async function cloudModels() {
  const cloud = readCloud();
  if (!cloud.apiKey) throw new HttpError(400, 'Сначала сохраните API-ключ Cloud.ru');
  const response = await fetch(endpoint + '/models', {
    headers: { Authorization: 'Bearer ' + cloud.apiKey },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new HttpError(502, 'Cloud.ru: проверка подключения завершилась HTTP ' + response.status);
  const parsed = await response.json() as { data?: Array<{ id?: unknown }> };
  return (Array.isArray(parsed.data) ? parsed.data : [])
    .map(item => item.id).filter((id): id is string => typeof id === 'string')
    .slice(0, 300);
}
async function chat(prompt: string) {
  if (cloudBusy) throw new HttpError(429, 'Предыдущий запрос ещё выполняется');
  const cloud = readCloud();
  if (!cloud.apiKey || !cloud.model) throw new HttpError(400, 'В настройках укажите API-ключ и модель Cloud.ru');
  const state = readState();
  const recent = state.messages.slice(-12).map(message => ({ role: message.role, content: message.content }));
  cloudBusy = true;
  try {
    const reply = await fetch(endpoint + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cloud.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cloud.model, messages: [
        { role: 'system', content: 'Ты Цукирэй, полезная персональная ИИ-помощница. Отвечай по-русски. Не выдумывай выполненные действия.' },
        ...recent,
        { role: 'user', content: prompt }
      ], max_tokens: 1200, stream: false }),
      signal: AbortSignal.timeout(90000)
    });
    if (!reply.ok) throw new HttpError(502, 'Cloud.ru вернул HTTP ' + reply.status + '. Проверьте ключ и модель.');
    const result = await reply.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const answer = result.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) throw new HttpError(502, 'Cloud.ru вернул пустой ответ');
    const now = new Date().toISOString();
    state.messages.push({ id: randomUUID(), role: 'user', content: prompt, createdAt: now });
    state.messages.push({ id: randomUUID(), role: 'assistant', content: answer.trim(), createdAt: now });
    state.messages = state.messages.slice(-250);
    saveAtomic(statePath, state);
    return { answer: answer.trim(), messages: state.messages };
  } finally { cloudBusy = false; }
}
async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  const host = req.headers.host ?? '';
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) throw new HttpError(403, 'Доступ только с этого компьютера');
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(origin)) throw new HttpError(403, 'Запрещён межсайтовый запрос');
  if (method === 'GET' && pathname === '/api/health') {
    json(res, 200, { ok: true, name: 'Tsukirei', version: '0.1.0', local: true }); return;
  }
  if (method === 'GET' && pathname === '/api/state') {
    json(res, 200, { ...readState(), settings: settingsPublic(), agents: [] }); return;
  }
  if (method === 'POST' && pathname === '/api/notes') {
    const input = await bodyJson(req); const state = readState();
    const note: Note = { id: randomUUID(), title: requiredText(input.title, 'Название', 100), body: typeof input.body === 'string' ? input.body.trim().slice(0, 12000) : '', createdAt: new Date().toISOString() };
    if (state.notes.length >= 500) throw new HttpError(400, 'Достигнут лимит 500 заметок');
    state.notes.unshift(note); saveAtomic(statePath, state); json(res, 201, { note }); return;
  }
  if (method === 'DELETE' && pathname.startsWith('/api/notes/')) {
    const id = pathname.slice('/api/notes/'.length);
    if (!validId(id)) throw new HttpError(400, 'Неверный идентификатор');
    const state = readState(); const count = state.notes.length;
    state.notes = state.notes.filter(note => note.id !== id);
    if (count === state.notes.length) throw new HttpError(404, 'Заметка не найдена');
    saveAtomic(statePath, state); json(res, 200, { ok: true }); return;
  }
  if (method === 'POST' && pathname === '/api/tasks') {
    const input = await bodyJson(req); const state = readState();
    const task: Task = { id: randomUUID(), title: requiredText(input.title, 'Задача', 160), done: false, createdAt: new Date().toISOString() };
    if (state.tasks.length >= 500) throw new HttpError(400, 'Достигнут лимит 500 задач');
    state.tasks.unshift(task); saveAtomic(statePath, state); json(res, 201, { task }); return;
  }
  if (pathname.startsWith('/api/tasks/') && (method === 'PATCH' || method === 'DELETE')) {
    const id = pathname.slice('/api/tasks/'.length);
    if (!validId(id)) throw new HttpError(400, 'Неверный идентификатор');
    const state = readState(); const task = state.tasks.find(item => item.id === id);
    if (!task) throw new HttpError(404, 'Задача не найдена');
    if (method === 'DELETE') state.tasks = state.tasks.filter(item => item.id !== id);
    else { const input = await bodyJson(req); if (typeof input.done !== 'boolean') throw new HttpError(400, 'Поле done должно быть boolean'); task.done = input.done; }
    saveAtomic(statePath, state); json(res, 200, { ok: true }); return;
  }
  if (method === 'POST' && pathname === '/api/settings') {
    const input = await bodyJson(req); const current = readCloud();
    if (input.model !== undefined) {
      if (typeof input.model !== 'string' || input.model.length > 150 || (input.model !== '' && !/^[a-zA-Z0-9._/-]+$/.test(input.model))) throw new HttpError(400, 'Некорректное название модели');
      current.model = input.model;
    }
    if (input.apiKey !== undefined) current.apiKey = requiredText(input.apiKey, 'API-ключ', 5000);
    if (input.clearKey === true) current.apiKey = '';
    saveAtomic(cloudPath, current);
    json(res, 200, { settings: settingsPublic() }); return;
  }
  if (method === 'GET' && pathname === '/api/models') {
    json(res, 200, { models: await cloudModels() }); return;
  }
  if (method === 'POST' && pathname === '/api/chat') {
    const input = await bodyJson(req);
    json(res, 200, await chat(requiredText(input.prompt, 'Сообщение', 8000))); return;
  }
  if (method === 'POST' && pathname === '/api/chat/clear') {
    await bodyJson(req);
    const state = readState(); state.messages = []; saveAtomic(statePath, state);
    json(res, 200, { messages: [] }); return;
  }
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    staticFile(res, join(root, 'web', 'index.html'), 'text/html; charset=utf-8'); return;
  }
  if (method === 'GET' && pathname === '/styles.css') {
    staticFile(res, join(root, 'web', 'styles.css'), 'text/css; charset=utf-8'); return;
  }
  if (method === 'GET' && pathname === '/main.js') {
    staticFile(res, join(root, 'web', 'main.js'), 'text/javascript; charset=utf-8'); return;
  }
  if (method === 'GET' && pathname === '/mark.svg') {
    staticFile(res, join(root, 'web', 'mark.svg'), 'image/svg+xml'); return;
  }
  throw new HttpError(404, 'Страница не найдена');
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('[Tsukirei] Неверное значение PORT'); process.exit(2);
}
const server = createServer((req, res) => {
  route(req, res).catch((error: unknown) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error('[Tsukirei] Ошибка сервера:', error);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Внутренняя ошибка сервера. Смотрите журнал.' : (error as Error).message });
    else res.end();
  });
});
server.on('error', (error) => { console.error('[Tsukirei] Сервер не запустился:', error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = address && typeof address !== 'string' ? address.port : port;
  console.log('[Tsukirei] Готово: http://127.0.0.1:' + actualPort + '/');
  console.log('[Tsukirei] Все данные хранятся локально: ' + dataDir);
});
