import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectPostgres, emptyState, validateState, type Note, type Task, type State } from './postgres.ts';
import { CityWorldService } from './city-world-service.ts';
import type { WorldKind } from './city-world.ts';

type CloudSettings = { apiKey: string; model: string };
type Json = Record<string, unknown>;

const root = process.cwd();
const dataDir = process.env.TSUKIREI_DATA_DIR ? resolve(process.env.TSUKIREI_DATA_DIR) : join(root, 'data');
const statePath = join(dataDir, 'tsukirei.json');
const cloudPath = join(dataDir, 'cloudru-settings.json');
const endpoint = 'https://foundation-models.api.cloud.ru/v1';
const port = Number(process.env.PORT ?? 3000);
let cloudBusy = false;
const database = await connectPostgres(dataDir);
const cityWorld = new CityWorldService(async (kind:WorldKind,offset:number,limit:number) => {
  if(database)return database.pageCity(kind,offset,limit);
  const state=readLegacyState();
  const values=kind==='knowledge'?[]:state[kind];
  return {total:values.length,items:values.slice(offset,offset+limit),revision:null};
});

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function readLegacyState(): State {
  if (!existsSync(statePath)) return emptyState();
  return validateState(JSON.parse(readFileSync(statePath, 'utf8')));
}
async function readState(): Promise<State> {
  return database ? database.read() : readLegacyState();
}
// Serialise legacy writes; PostgreSQL uses SELECT ... FOR UPDATE inside a transaction.
let legacyQueue: Promise<unknown> = Promise.resolve();
async function mutateState<T>(change: (state: State) => T): Promise<T> {
  if (database) { const result=await database.mutate(change); cityWorld.invalidate(); return result; }
  const pending = legacyQueue.then(() => {
    const state = readLegacyState();
    const result = change(state);
    saveAtomic(statePath, state);
    cityWorld.invalidate();
    return result;
  });
  legacyQueue = pending.catch(() => {});
  return pending;
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
  const state = await readState();
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
    const messages = await mutateState(state => {
      state.messages.push({ id: randomUUID(), role: 'user', content: prompt, createdAt: now });
      state.messages.push({ id: randomUUID(), role: 'assistant', content: answer.trim(), createdAt: now });
      // PostgreSQL keeps the complete archive; only the legacy JSON mode is capped.
      if (!database) state.messages = state.messages.slice(-250);
      return state.messages.slice(-250);
    });
    return { answer: answer.trim(), messages };
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
    json(res, 200, { ok: true, name: 'Tsukirei', version: '0.5.0', local: true, storage: database ? 'postgresql+pgvector' : 'legacy-json' }); return;
  }
  if (method === 'GET' && pathname === '/api/city/world/status') {
    json(res,200,cityWorld.status());return;
  }
  if (method === 'GET' && pathname === '/api/city/world/tiles') {
    const params=new URL(req.url??'/','http://127.0.0.1').searchParams;
    const parse=(key:string,defaultValue:number,min:number,max:number) => {
      const raw=params.get(key);
      const value=raw===null?defaultValue:Number(raw);
      if(!Number.isFinite(value)||value<min||value>max)
        throw new HttpError(400,'Неверный параметр '+key);
      return value;
    };
    const x=parse('x',0,-1e8,1e8),y=parse('y',0,-1e8,1e8);
    const radius=parse('radius',900,200,100000);
    const limit=parse('limit',3500,1,6500);
    if(!Number.isInteger(limit))throw new HttpError(400,'limit должен быть целым');
    const data=cityWorld.tiles(x,y,radius,limit);
    if(!data){json(res,202,cityWorld.status());return;}
    json(res,200,{ready:true,...data});return;
  }
  if (method === 'GET' && pathname === '/api/city/world/search') {
    const params=new URL(req.url??'/','http://127.0.0.1').searchParams;
    const q=params.get('q')??'';
    if(q.length<2||q.length>100)throw new HttpError(400,'Введите от 2 до 100 символов');
    const data=cityWorld.search(q,14);
    if(!data){json(res,202,cityWorld.status());return;}
    json(res,200,{ready:true,items:data.map(b=>({
      id:b.id,title:b.title,districtName:b.districtName,kind:b.kind,x:b.x,y:b.y
    }))});return;
  }
  if (method === 'GET' && pathname === '/api/city/entry') {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const kind = url.searchParams.get('kind');
    const id = url.searchParams.get('id');
    if (kind !== 'notes' && kind !== 'messages' && kind !== 'knowledge')
      throw new HttpError(400, 'kind: notes, messages или knowledge');
    if (!id || id.length > 100 || (kind === 'knowledge' ? !validId(id) : !/^[\p{L}\p{N}_:-]{1,100}$/u.test(id)))
      throw new HttpError(400, 'Неверный идентификатор записи');
    const entry = database ? await database.cityEntry(kind, id)
      : kind === 'knowledge' ? null : readLegacyState()[kind].find(item => item.id === id) ?? null;
    if (!entry) throw new HttpError(404, 'Исходная запись не найдена');
    json(res, 200, { kind, entry }); return;
  }
  if (method === 'GET' && pathname === '/api/city/archive') {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const kind = url.searchParams.get('kind');
    if (kind !== 'notes' && kind !== 'messages' && kind !== 'knowledge')
      throw new HttpError(400, 'kind: notes, messages или knowledge');
    const offsetRaw = url.searchParams.get('offset') ?? '0';
    const limitRaw = url.searchParams.get('limit') ?? '200';
    if (!/^\d{1,9}$/.test(offsetRaw) || !/^\d{1,3}$/.test(limitRaw))
      throw new HttpError(400, 'offset и limit должны быть целыми числами');
    const offset = Number(offsetRaw), limit = Number(limitRaw);
    if (limit < 1 || limit > 200) throw new HttpError(400, 'limit должен быть от 1 до 200');
    let page: { total: number; items: unknown[]; revision: string | null };
    if (database) page = await database.pageCity(kind, offset, limit);
    else {
      const state = readLegacyState();
      const rows = kind === 'knowledge' ? [] : state[kind];
      page = { total: rows.length, items: rows.slice(offset, offset + limit), revision: null };
    }
    const compact = url.searchParams.get('compact') === '1';
    // Transfers only titles/previews, never full bodies for the city overview.
    // The original text is fetched separately on selection. No Cloud.ru calls.
    const items = compact ? page.items.map(value => {
      const record = value as Record<string, unknown>;
      const str = (v: unknown) => typeof v === 'string' ? v : '';
      const length = kind === 'notes'
        ? str(record.title).length + str(record.body).length
        : kind === 'messages' ? str(record.content).length : str(record.content).length;
      if (kind === 'notes') return {
        id: record.id, title: str(record.title).slice(0, 130),
        body: str(record.body).slice(0, 650), createdAt: record.createdAt, fullLength: length
      };
      if (kind === 'messages') return {
        id: record.id, role: record.role, content: str(record.content).slice(0, 650),
        createdAt: record.createdAt, fullLength: length
      };
      return {
        id: record.id, source: str(record.source).slice(0, 100),
        content: str(record.content).slice(0, 650), createdAt: record.createdAt,
        fullLength: length
      };
    }) : page.items;
    json(res, 200, {
      kind, offset, limit, total: page.total,
      hasMore: offset + page.items.length < page.total,
      items, revision: page.revision
    });
    return;
  }
  if (method === 'GET' && pathname === '/api/state') {
    const state = await readState();
    json(res, 200, { ...state, messages: state.messages.slice(-250), settings: settingsPublic(), agents: [],
      database: { engine: database ? 'PostgreSQL + pgvector' : 'JSON (legacy)', connected: Boolean(database) } }); return;
  }
  if (method === 'POST' && pathname === '/api/notes') {
    const input = await bodyJson(req);
    const note: Note = { id: randomUUID(), title: requiredText(input.title, 'Название', 100), body: typeof input.body === 'string' ? input.body.trim().slice(0, 12000) : '', createdAt: new Date().toISOString() };
    await mutateState(state => {
      if (!database && state.notes.length >= 500) throw new HttpError(400, 'Достигнут лимит 500 заметок');
      state.notes.unshift(note);
    });
    json(res, 201, { note }); return;
  }
  if (method === 'DELETE' && pathname.startsWith('/api/notes/')) {
    const id = pathname.slice('/api/notes/'.length);
    if (!validId(id)) throw new HttpError(400, 'Неверный идентификатор');
    await mutateState(state => {
      const count = state.notes.length;
      state.notes = state.notes.filter(note => note.id !== id);
      if (count === state.notes.length) throw new HttpError(404, 'Заметка не найдена');
    });
    json(res, 200, { ok: true }); return;
  }
  if (method === 'POST' && pathname === '/api/tasks') {
    const input = await bodyJson(req);
    const task: Task = { id: randomUUID(), title: requiredText(input.title, 'Задача', 160), done: false, createdAt: new Date().toISOString() };
    await mutateState(state => {
      if (!database && state.tasks.length >= 500) throw new HttpError(400, 'Достигнут лимит 500 задач');
      state.tasks.unshift(task);
    });
    json(res, 201, { task }); return;
  }
  if (pathname.startsWith('/api/tasks/') && (method === 'PATCH' || method === 'DELETE')) {
    const id = pathname.slice('/api/tasks/'.length);
    if (!validId(id)) throw new HttpError(400, 'Неверный идентификатор');
    const input = method === 'PATCH' ? await bodyJson(req) : null;
    await mutateState(state => {
      const task = state.tasks.find(item => item.id === id);
      if (!task) throw new HttpError(404, 'Задача не найдена');
      if (method === 'DELETE') state.tasks = state.tasks.filter(item => item.id !== id);
      else {
        if (typeof input?.done !== 'boolean') throw new HttpError(400, 'Поле done должно быть boolean');
        task.done = input.done;
      }
    });
    json(res, 200, { ok: true }); return;
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
    await mutateState(state => { state.messages = []; });
    json(res, 200, { messages: [] }); return;
  }
  if (method === 'POST' && pathname === '/api/knowledge') {
    if (!database) throw new HttpError(409, 'Для базы знаний настройте PostgreSQL + pgvector');
    const input = await bodyJson(req);
    const content = requiredText(input.content, 'Знание', 12000);
    const source = input.source === undefined ? 'manual' : requiredText(input.source, 'Источник', 100);
    const metadata = input.metadata === undefined ? {} : input.metadata;
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata) || JSON.stringify(metadata).length > 8000) {
      throw new HttpError(400, 'metadata должен быть небольшим JSON-объектом');
    }
    let embedding: number[] | undefined;
    if (input.embedding !== undefined) {
      if (!Array.isArray(input.embedding) || input.embedding.length < 1 || input.embedding.length > 2000 ||
          !input.embedding.every(value => typeof value === 'number' && Number.isFinite(value))) {
        throw new HttpError(400, 'embedding должен содержать от 1 до 2000 конечных чисел');
      }
      embedding = input.embedding as number[];
    }
    const model = embedding ? requiredText(input.embeddingModel, 'Модель эмбеддингов', 150) : undefined;
    const knowledge = await database.addKnowledge(content, source, metadata as Json, embedding, model);
    cityWorld.invalidate();
    json(res, 201, { knowledge }); return;
  }
  if (method === 'POST' && pathname === '/api/knowledge/search') {
    if (!database) throw new HttpError(409, 'Для поиска знаний настройте PostgreSQL + pgvector');
    const input = await bodyJson(req);
    let embedding: number[] | undefined;
    if (input.embedding !== undefined) {
      if (!Array.isArray(input.embedding) || input.embedding.length < 1 || input.embedding.length > 2000 ||
          !input.embedding.every(value => typeof value === 'number' && Number.isFinite(value))) {
        throw new HttpError(400, 'Некорректный поисковый вектор');
      }
      embedding = input.embedding as number[];
    }
    const query = embedding ? '' : requiredText(input.query, 'Поисковый запрос', 500);
    const limit = input.limit === undefined ? 25 : input.limit;
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100) throw new HttpError(400, 'Лимит: 1–100');
    const items = await database.searchKnowledge(query, embedding, limit as number);
    json(res, 200, { items }); return;
  }
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    staticFile(res, join(root, 'web', 'index.html'), 'text/html; charset=utf-8'); return;
  }
  if (method === 'GET' && pathname === '/styles.css') {
    staticFile(res, join(root, 'web', 'styles.css'), 'text/css; charset=utf-8'); return;
  }
  if (method === 'GET' && pathname === '/city-model.js') {
    staticFile(res, join(root, 'web', 'city-model.js'), 'text/javascript; charset=utf-8'); return;
  }
  if (method === 'GET' && pathname === '/city-spatial.js') {
    staticFile(res, join(root, 'web', 'city-spatial.js'), 'text/javascript; charset=utf-8'); return;
  }
  if (method === 'GET' && pathname === '/city-3d.js') {
    staticFile(res, join(root, 'web', 'city-3d.js'), 'text/javascript; charset=utf-8'); return;
  }
  if (method === 'GET' && pathname === '/city.js') {
    staticFile(res, join(root, 'web', 'city.js'), 'text/javascript; charset=utf-8'); return;
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
