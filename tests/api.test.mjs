import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Tsukirei startup, API, persistence and static assets', { timeout: 40000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tsukirei-test-'));
  const child = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '0', TSUKIREI_DATA_DIR: dir, TSUKIREI_DATABASE_URL: '', DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  t.after(() => { child.kill(); rmSync(dir, { recursive: true, force: true }); });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server boot timeout. ' + stderr)), 15000);
    child.stdout.on('data', chunk => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) { clearTimeout(timeout); resolve('http://127.0.0.1:' + match[1]); }
    });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('Server exited ' + code + '. ' + stderr)); });
  });
  const call = async (path, method = 'GET', data) => {
    const response = await fetch(base + path, { method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, data: await response.json() };
  };
  const health = await call('/api/health');
  assert.equal(health.status, 200); assert.equal(health.data.ok, true);
  const state = await call('/api/state');
  assert.equal(state.status, 200); assert.deepEqual(state.data.notes, []);
  assert.equal(state.data.settings.hasKey, false);
  const note = await call('/api/notes', 'POST', { title: 'Первая заметка', body: 'Привет' });
  assert.equal(note.status, 201);
  const task = await call('/api/tasks', 'POST', { title: 'Проверить проект' });
  assert.equal(task.status, 201);
  const patch = await call('/api/tasks/' + task.data.task.id, 'PATCH', { done: true });
  assert.equal(patch.status, 200);
  const updated = await call('/api/state');
  assert.equal(updated.data.notes[0].title, 'Первая заметка');
  assert.equal(updated.data.tasks[0].done, true);
  const settings = await call('/api/settings', 'POST', { model: 'ai-sage/GigaChat3-10B-A1.8B', apiKey: 'local-test-secret' });
  assert.equal(settings.status, 200);
  assert.equal(settings.data.settings.hasKey, true);
  assert.equal(JSON.stringify((await call('/api/state')).data).includes('local-test-secret'), false);
  const remove = await call('/api/notes/' + note.data.note.id, 'DELETE');
  assert.equal(remove.status, 200);
  const removeTask = await call('/api/tasks/' + task.data.task.id, 'DELETE');
  assert.equal(removeTask.status, 200);
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Tsukirei/);
  for (const asset of ['/main.js', '/city.js', '/city-model.js', '/styles.css', '/mark.svg']) {
    const res = await fetch(base + asset);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).length > 50);
  }
  assert.equal((await call('/api/unknown')).status, 404);
  const foreign = await fetch(base + '/api/state', { headers: { Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
});
