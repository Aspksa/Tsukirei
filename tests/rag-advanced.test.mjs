import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphLinks, curatorFindings, rerankLocal, smartContext, RagCache, sha } from '../server/rag-advanced.ts';

test('Local graph extracts only explicit source-grounded relationships',()=>{
  const text='MemOS использует PostgreSQL. Graphiti зависит от MemOS. Обычная фраза тут.';
  const links=graphLinks(text);
  assert.ok(links.some(e=>e.from==='memos'&&e.relation==='использует'&&e.to==='postgresql'));
  assert.ok(links.some(e=>e.from==='graphiti'&&e.relation==='зависит от'&&e.to==='memos'));
  assert.ok(links.every(e=>text.includes(e.evidence)));
  assert.deepEqual(graphLinks('Сервер работает и хранит заметки.'),[]);
});
test('Memory curator flags duplicates, old facts and possible conflicts without editing sources',()=>{
  const sources=[
    {key:'note:old:0',kind:'note',sourceId:'old',title:'План',
      content:'Статус: работает\nСистема должна хранить знания с подтверждёнными источниками.',
      createdAt:'2021-01-01T00:00:00Z'},
    {key:'note:clone:0',kind:'note',sourceId:'clone',title:'План',
      content:'Статус: работает\nСистема должна хранить знания с подтверждёнными источниками.',
      createdAt:'2026-11-09T00:00:00Z'},
    {key:'note:new:0',kind:'note',sourceId:'new',title:'План',
      content:'Статус: остановлен\nДополнительная проверка.',createdAt:'2026-11-09T00:00:00Z'}
  ];
  const snapshot=JSON.stringify(sources);
  const result=curatorFindings(sources,Date.parse('2026-11-09T12:00:00Z'));
  assert.ok(result.some(x=>x.type==='duplicate'));
  assert.ok(result.some(x=>x.type==='possible_conflict'));
  assert.ok(result.some(x=>x.type==='stale'));
  assert.ok(result.every(x=>x.keys.length>0));
  assert.equal(JSON.stringify(sources),snapshot);
});
test('MMR local reranking diversifies nearly-identical high-score documents',()=>{
  const input=[
    {kind:'document',id:'a',title:'PostgreSQL память',content:'PostgreSQL хранит память проекта.',score:30,evidenceId:'document:a:0'},
    {kind:'document',id:'b',title:'PostgreSQL память',content:'PostgreSQL хранит память проекта.',score:29,evidenceId:'document:b:0'},
    {kind:'note',id:'c',title:'Индекс',content:'pgvector индекс ускоряет поиск проекта.',score:28,evidenceId:'note:c:0'}
  ];
  const result=rerankLocal('PostgreSQL память поиск',input,2);
  assert.equal(result.length,2);
  assert.equal(result[0].id,'a');
  assert.equal(result[1].id,'c');
  const context=smartContext('PostgreSQL память',result);
  assert.ok(context.context.length<=context.budget);
  assert.match(context.context,/\[1\]/);
});
test('LRU and TTL cache bounded, invalidatable, preserves original values',()=>{
  const cache=new RagCache(2,10000);
  cache.set('a',10);cache.set('b',20);
  assert.equal(cache.get('a'),10);
  cache.set('c',30);
  assert.equal(cache.get('b'),undefined);
  assert.equal(cache.get('a'),10);
  assert.equal(cache.get('c'),30);
  assert.equal(cache.stats().entries,2);
  assert.equal(cache.stats().hits,3);
  cache.clear();assert.equal(cache.stats().entries,0);
  assert.equal(sha('same'),sha('same'));
  assert.notEqual(sha('same'),sha('different'));
});
