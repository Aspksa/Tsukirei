import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const databaseUrl = process.env.TSUKIREI_DATABASE_URL;
test('PostgreSQL + pgvector migration, transaction safety and knowledge search', { skip: !databaseUrl, timeout: 60000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tsukirei-pg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const legacy = { notes: [{ id: randomUUID(), title: 'Старая запись', body: 'данные не теряются', createdAt: new Date().toISOString() }], tasks: [], messages: [] };
  writeFileSync(join(dir, 'tsukirei.json'), JSON.stringify(legacy));
  const start = async () => {
    const child = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], {
      cwd: process.cwd(), env: { ...process.env, PORT: '0', TSUKIREI_DATA_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '', errors = '';
    child.stdout.on('data', part => { output += part.toString(); });
    child.stderr.on('data', part => { errors += part.toString(); });
    const base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('PostgreSQL startup timeout. ' + output + errors)), 25000);
      const listen = chunk => {
        const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)\//);
        if (match) { clearTimeout(timeout); child.stdout.off('data', listen); resolve('http://127.0.0.1:' + match[1]); }
      };
      child.stdout.on('data', listen);
      child.once('exit', code => { clearTimeout(timeout); reject(new Error('PostgreSQL server exit ' + code + '. ' + output + errors)); });
    });
    return { child, base };
  };
  const api = async (base, route, method = 'GET', data) => {
    const result = await fetch(base + route, {
      method, headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
    return { status: result.status, data: await result.json() };
  };
  const first = await start();
  t.after(() => first.child.kill());
  const initial = await api(first.base, '/api/state');
  assert.equal(initial.status, 200);
  assert.equal(initial.data.database.engine, 'PostgreSQL + pgvector');
  assert.equal(initial.data.notes.length, 1);
  assert.equal(initial.data.notes[0].title, 'Старая запись');
  assert.ok(existsSync(join(dir, 'postgres-active.json')));
  assert.equal(readdirSync(join(dir, 'backups')).filter(name => name.endsWith('.json')).length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'tsukirei.json'), 'utf8')), legacy);
  const tasks = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    api(first.base, '/api/tasks', 'POST', { title: 'Задача ' + index })));
  assert.ok(tasks.every(item => item.status === 201));
  const after = await api(first.base, '/api/state');
  assert.equal(after.data.tasks.length, 12, 'Concurrent task writes must not overwrite one another');
  const fact = await api(first.base, '/api/knowledge', 'POST', {
    content: 'Tsukirei сохраняет знания о памяти', source: 'manual',
    embeddingModel: 'test-vector', embedding: [1, 0, 0], metadata: { verified: true }
  });
  assert.equal(fact.status, 201, JSON.stringify(fact.data));
  const search = await api(first.base, '/api/knowledge/search', 'POST', { query: 'Tsukirei' });
  assert.equal(search.status, 200);
  assert.ok(search.data.items.some(item => item.id === fact.data.knowledge.id));
  const pagedNotes = await api(first.base, '/api/city/archive?kind=notes&offset=0&limit=1');
  assert.equal(pagedNotes.status, 200, JSON.stringify(pagedNotes.data));
  assert.equal(pagedNotes.data.total, 1);
  assert.equal(pagedNotes.data.items[0].id, legacy.notes[0].id);
  assert.equal(pagedNotes.data.hasMore, false);
  const pagedMessages = await api(first.base, '/api/city/archive?kind=messages&offset=0&limit=20');
  assert.equal(pagedMessages.status, 200, JSON.stringify(pagedMessages.data));
  assert.equal(pagedMessages.data.total, 0);
  assert.deepEqual(pagedMessages.data.items, []);
  const pagedKnowledge = await api(first.base, '/api/city/archive?kind=knowledge&offset=0&limit=20');
  assert.equal(pagedKnowledge.status, 200, JSON.stringify(pagedKnowledge.data));
  assert.equal(pagedKnowledge.data.total >= 1, true);
  assert.ok(pagedKnowledge.data.items.some(item => item.id === fact.data.knowledge.id));
  const originalNote = await api(first.base, '/api/city/entry?kind=notes&id=' + legacy.notes[0].id);
  assert.equal(originalNote.status, 200, JSON.stringify(originalNote.data));
  assert.equal(originalNote.data.entry.body, 'данные не теряются');
  const originalKnowledge = await api(first.base, '/api/city/entry?kind=knowledge&id=' + fact.data.knowledge.id);
  assert.equal(originalKnowledge.status, 200, JSON.stringify(originalKnowledge.data));
  assert.equal(originalKnowledge.data.entry.content, 'Tsukirei сохраняет знания о памяти');
  const smallPreview = await api(first.base, '/api/city/archive?kind=notes&offset=0&limit=1&compact=1');
  assert.equal(smallPreview.status, 200);
  assert.equal(smallPreview.data.items[0].fullLength, legacy.notes[0].title.length + legacy.notes[0].body.length);
    const vector = await api(first.base, '/api/knowledge/search', 'POST', { embedding: [1, 0, 0] });
  assert.equal(vector.status, 200);
  assert.equal(vector.data.items[0].id, fact.data.knowledge.id);
  async function readyWorld(total) {
    for (let retry=0;retry<100;retry++) {
      const state=await api(first.base,'/api/city/world/status');
      assert.equal(state.status,200);
      if(state.data.state==='error')throw new Error(state.data.error);
      if(state.data.ready && state.data.index.total===total)return state.data;
      await new Promise(resolve=>setTimeout(resolve,80));
    }
    throw new Error('Индекс города PostgreSQL не обновился');
  }
  const indexed = await readyWorld(2);
  assert.equal(indexed.index.total,2);
  const district=indexed.index.districts[0];
  const tile=await api(first.base,
    '/api/city/world/tiles?x='+district.x+'&y='+district.y+'&radius=800&limit=50');
  assert.equal(tile.status,200,JSON.stringify(tile.data));
  assert.ok(tile.data.buildings.some(b=>b.sourceId===legacy.notes[0].id));
  const match=await api(first.base,'/api/city/world/search?q='+encodeURIComponent('Tsukirei'));
  assert.equal(match.status,200);
  assert.ok(match.data.items.some(b=>b.id==='knowledge:'+fact.data.knowledge.id));
  const created=await api(first.base,'/api/notes','POST',{title:'Знание в новом районе'});
  assert.equal(created.status,201);
  await readyWorld(3);
  const deleted=await api(first.base,'/api/notes/'+created.data.note.id,'DELETE');
  assert.equal(deleted.status,200);
  await readyWorld(2);
  const bad = await api(first.base, '/api/knowledge', 'POST', { content: 'invalid', embedding: [Infinity, NaN] });
  assert.equal(bad.status, 400);
  first.child.kill();
  await new Promise(resolve => first.child.once('exit', resolve));
  const second = await start();
  t.after(() => second.child.kill());
  const persisted = await api(second.base, '/api/state');
  assert.equal(persisted.data.tasks.length, 12);
  assert.equal(persisted.data.notes.length, 1);
  assert.equal(readdirSync(join(dir, 'backups')).filter(name => name.endsWith('.json')).length, 1, 'Migration should not repeat');
});
