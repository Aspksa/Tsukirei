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
  const vector = await api(first.base, '/api/knowledge/search', 'POST', { embedding: [1, 0, 0] });
  assert.equal(vector.status, 200);
  assert.equal(vector.data.items[0].id, fact.data.knowledge.id);
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
