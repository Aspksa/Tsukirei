import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function createModel() {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync('web/city-model.js', 'utf8'), sandbox, { filename: 'city-model.js' });
  return sandbox.TsukireiCityModel;
}
const model = createModel();

function note(id, title, body = '') {
  return { id, title, body, createdAt: '2026-11-08T10:00:00Z' };
}
function message(id, role, content) {
  return { id, role, content, createdAt: '2026-11-08T10:00:00Z' };
}

test('empty store renders empty city — never demo buildings', () => {
  const city = model.cityFromState({ notes: [], messages: [] });
  assert.equal(city.stats.buildings, 0);
  assert.equal(city.stats.connections, 0);
  assert.equal(city.stats.districts, 0);
  assert.equal(city.buildings.length, 0);
});

test('each real note produces exactly one building; growth tracks entries and content', () => {
  const one = model.cityFromState({ notes: [note('n1', 'Память знаний', 'Коротко')], messages: [] });
  assert.equal(one.stats.buildings, 1);
  assert.equal(one.stats.notes, 1);
  assert.equal(one.buildings[0].sourceId, 'n1');
  assert.equal(one.buildings[0].districtName, 'Память и знания');
  const expanded = model.cityFromState({
    notes: [note('n1', 'Память знаний', ('Память для важных фактов и событий. ').repeat(35)),
      note('n2', 'Архив документов', 'Реестр файлов')],
    messages: []
  });
  assert.equal(expanded.stats.buildings, 2);
  assert.ok(expanded.buildings.find(b => b.sourceId === 'n1').height > one.buildings[0].height);
  assert.equal(expanded.stats.notes, 2);
});

test('dialogue user + answer is one source-backed building; orphan answer is separate', () => {
  const city = model.cityFromState({
    notes: [],
    messages: [message('u1', 'user', 'Нарисуй дизайн главной страницы'),
      message('a1', 'assistant', 'Макет интерфейса построен'),
      message('a2', 'assistant', 'Отдельный ответ')]
  });
  assert.equal(city.stats.buildings, 2);
  assert.equal(city.stats.dialogues, 2);
  assert.ok(city.buildings.some(b => b.sourceId === 'u1' && b.body.includes('Макет интерфейса')));
  assert.ok(!city.buildings.some(b => b.sourceId === 'a1'));
  assert.ok(city.buildings.some(b => b.sourceId === 'a2'));
});

test('roads only represent shared meaningful words, not fabricated relationships', () => {
  const city = model.cityFromState({
    notes: [note('n1', 'Память библиотеки', 'Память архитектура связь'),
      note('n2', 'Дизайн интерфейса', 'Архитектура связь визуализация')],
    messages: []
  });
  assert.equal(city.stats.districts, 2);
  assert.equal(city.stats.connections, 1);
  assert.equal(city.roads.length, 1);
  assert.ok(city.roads[0].shared.includes('архитектура'));
  const noRoad = model.cityFromState({ notes: [note('n1', 'Семья', 'Мама'),
    note('n2', 'Дизайн', 'Анимация')], messages: [] });
  assert.equal(noRoad.stats.connections, 0);
});

test('topics and coordinates remain deterministic for identical content', () => {
  const state = { notes: [note('n1', 'Обсуждение API', 'Cloud.ru и модель'),
    note('n2', 'Excel', 'Таблица расходов')], messages: [] };
  assert.deepEqual(JSON.parse(JSON.stringify(model.cityFromState(state))),
    JSON.parse(JSON.stringify(model.cityFromState(state))));
});

test('tokens strip common stop words and numeric-only tokens', () => {
  const tokens = model.tokens('Это очень важная память 123 у меня');
  assert.ok(tokens.includes('важная'));
  assert.ok(tokens.includes('память'));
  assert.ok(!tokens.includes('123'));
  assert.ok(!tokens.includes('это'));
});
