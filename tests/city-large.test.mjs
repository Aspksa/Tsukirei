import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('City stays deterministic with 12,000 real archive records and compact previews', { timeout: 45000 }, () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(readFileSync('web/city-model.js', 'utf8'), sandbox);
  const { cityFromState } = sandbox.TsukireiCityModel;
  const notes = Array.from({ length: 8000 }, (_, index) => ({
    id: 'note-' + index, title: 'Память архива ' + index,
    body: 'Короткое превью сохранённой заметки.',
    createdAt: '2026-11-09T00:00:00Z',
    fullLength: 600 + index % 12000
  }));
  const messages = Array.from({ length: 4000 }, (_, index) => ({
    id: 'msg-' + index, role: index % 2 ? 'assistant' : 'user',
    content: 'Новый проект GitHub TypeScript с задачами и агентами ' + index,
    fullLength: 3000 + index % 1000
  }));
  const start = performance.now();
  const city = cityFromState({ notes, messages, knowledge: [] });
  const ms = Math.round(performance.now() - start);
  assert.equal(city.stats.notes, 8000);
  assert.equal(city.stats.dialogues, 2000);
  assert.equal(city.stats.buildings, 10000);
  assert.ok(city.stats.districts >= 2);
  assert.equal(new Set(city.buildings.map(b => b.id)).size, 10000);
  const tower = city.buildings.find(b => b.sourceId === 'note-7999');
  assert.ok(tower.height > 20);
  assert.equal(tower.fullLength, 600 + 7999 % 12000);
  console.log('City layout: 10,000 buildings from 12,000 archive records in ' + ms + 'ms (CI hardware)');
});

test('Original text length controls height even if preview is truncated', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(readFileSync('web/city-model.js', 'utf8'), sandbox);
  const { cityFromState } = sandbox.TsukireiCityModel;
  const a = cityFromState({ notes: [{ id:'n1', title:'Архив', body:'текст', fullLength:10 }], messages: [] });
  const b = cityFromState({ notes: [{ id:'n1', title:'Архив', body:'текст', fullLength:10000 }], messages: [] });
  assert.ok(b.buildings[0].height > a.buildings[0].height);
});
