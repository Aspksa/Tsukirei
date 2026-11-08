import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('City archive reads all records in bounded pages without Cloud.ru or 250-message truncation', { timeout: 40000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tsukirei-city-'));
  const messages = Array.from({ length: 625 }, (_, i) => ({
    id: 'msg-' + i, role: i % 2 ? 'assistant' : 'user',
    content: 'Сохранённая история ' + i, createdAt: '2026-11-08T10:00:00Z'
  }));
  const notes = Array.from({ length: 3 }, (_, i) => ({
    id: 'note-' + i, title: 'Память ' + i,
    body: 'Реальные сохранённые данные', createdAt: '2026-11-08T10:00:00Z'
  }));
  writeFileSync(join(dir, 'tsukirei.json'), JSON.stringify({ notes, tasks: [], messages }), 'utf8');
  const child = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '0', TSUKIREI_DATA_DIR: dir, TSUKIREI_DATABASE_URL: '', DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', b => { stderr += b; });
  t.after(() => { child.kill(); rmSync(dir, { recursive: true, force: true }); });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Startup timeout ' + stderr)), 15000);
    child.stdout.on('data', c => {
      const match = String(c).match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) { clearTimeout(timeout); resolve('http://127.0.0.1:' + match[1]); }
    });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('Exit ' + code + '. ' + stderr)); });
  });
  async function page(kind, offset, limit) {
    const response = await fetch(base + '/api/city/archive?kind=' + kind + '&offset=' + offset + '&limit=' + limit);
    return { status: response.status, data: await response.json() };
  }
  const compactRes = await fetch(base + '/api/city/archive?kind=messages&offset=0&limit=3&compact=1');
  const compact = await compactRes.json();
  assert.equal(compactRes.status, 200);
  assert.equal(compact.total, 625);
  assert.equal(compact.items.length, 3);
  assert.equal(compact.items[0].fullLength, messages[0].content.length);
  assert.equal(compact.items[0].content, messages[0].content);
  const originalRes = await fetch(base + '/api/city/entry?kind=messages&id=msg-0');
  const original = await originalRes.json();
  assert.equal(originalRes.status, 200);
  assert.equal(original.entry.content, messages[0].content);
  const badEntry = await fetch(base + '/api/city/entry?kind=messages&id=%3Cscript%3E');
  assert.equal(badEntry.status, 400);
  const missing = await fetch(base + '/api/city/entry?kind=notes&id=missing');
  assert.equal(missing.status, 404);
  const all = [];
  for (let offset = 0; offset < messages.length; offset += 200) {
    const response = await page('messages', offset, 200);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.total, messages.length);
    assert.equal(response.data.kind, 'messages');
    assert.equal(response.data.offset, offset);
    assert.equal(response.data.hasMore, offset + response.data.items.length < messages.length);
    assert.ok(response.data.items.length <= 200);
    all.push(...response.data.items);
  }
  assert.equal(all.length, 625);
  assert.deepEqual(all.map(x => x.id), messages.map(x => x.id));
  const notePage = await page('notes', 1, 2);
  assert.equal(notePage.data.total, 3);
  assert.deepEqual(notePage.data.items.map(x => x.id), ['note-1','note-2']);
  const knowledge = await page('knowledge', 0, 200);
  assert.equal(knowledge.data.total, 0);
  assert.deepEqual(knowledge.data.items, []);
  assert.equal((await page('notes', 0, 201)).status, 400);
  assert.equal((await page('messages', 0, 0)).status, 400);
  assert.equal((await page('messages', -1, 10)).status, 400);
  assert.equal((await page('bogus', 0, 10)).status, 400);
  const foreign = await fetch(base + '/api/city/archive?kind=messages', { headers: { Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
});
