import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const databaseUrl = process.env.TSUKIREI_DATABASE_URL;
test('PostgreSQL + pgvector migration, transaction safety and knowledge search', { skip: !databaseUrl, timeout: 120000 }, async (t) => {
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
  const documentText=('Порядок технического обслуживания: редукторная муфта требует проверки. \n').repeat(45);
  const upload={title:'Руководство обслуживания',content:documentText,source:'manual.md'};
  const imported=await api(first.base,'/api/rag/documents','POST',upload);
  assert.equal(imported.status,201,JSON.stringify(imported.data));
  assert.equal(imported.data.duplicate,false);
  const docId=imported.data.document.id;
  const docs=await api(first.base,'/api/rag/documents');
  assert.equal(docs.status,200);
  assert.ok(docs.data.items.some(x=>x.id===docId&&x.parts>1));
  const duplicate=await api(first.base,'/api/rag/documents','POST',upload);
  assert.equal(duplicate.status,200);
  assert.equal(duplicate.data.duplicate,true);
  const ragSearch=await api(first.base,'/api/rag/search','POST',{query:'редукторная муфта',limit:8});
  assert.equal(ragSearch.status,200,JSON.stringify(ragSearch.data));
  assert.ok(ragSearch.data.items.some(x=>x.kind==='document'&&x.id===docId),
    JSON.stringify(ragSearch.data));
  const merged=await api(first.base,'/api/rag/search','POST',{
    query:'Tsukirei сохраняет знания',embedding:[1,0,0],limit:8
  });
  assert.equal(merged.status,200,JSON.stringify(merged.data));
  assert.equal(merged.data.mode,'hybrid');
  assert.ok(merged.data.items.some(x=>x.kind==='knowledge'&&x.id===fact.data.knowledge.id));
  const ragStatus=await api(first.base,'/api/rag/status');
  assert.equal(ragStatus.status,200);
  assert.equal(ragStatus.data.cloudRequestsForRetrieval,0);
  assert.equal(ragStatus.data.documents,1);
  async function awaitIndex(atLeast) {
    for(let i=0;i<140;i++){
      const state=await api(first.base,'/api/rag/engine');
      assert.equal(state.status,200,JSON.stringify(state.data));
      const w=state.data.worker;
      if(w.error&&!w.running&&!w.pending)throw Error('Ошибка рабочего индекса: '+w.error);
      if(w.lastRun&&!w.pending&&!w.running&&state.data.index.records>=atLeast)
        return state.data;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw Error('Фоновый RAG-индекс не завершился');
  }
  const verifiedInitial=await awaitIndex(3);
  assert.ok(verifiedInitial.index.records>=3);
  assert.equal(verifiedInitial.provider.embeddingsEnabled,false);
  assert.equal(verifiedInitial.provider.requestsToday,0);
  const example=await api(first.base,'/api/notes','POST',{
    title:'Граф проектной памяти',
    body:'MemOS использует PostgreSQL.\nСтатус: активен\nИсходная система хранит факты.'
  });
  const exactCopy=await api(first.base,'/api/notes','POST',{
    title:'Граф проектной памяти',
    body:'MemOS использует PostgreSQL.\nСтатус: активен\nИсходная система хранит факты.'
  });
  const conflict=await api(first.base,'/api/notes','POST',{
    title:'Проверить состояние',
    body:'Статус: остановлен\nТребуется подтверждение человеком.'
  });
  assert.ok([example,exactCopy,conflict].every(item=>item.status===201));
  const indexed=await awaitIndex(6);
  assert.ok(indexed.index.relations>=1,JSON.stringify(indexed.index));
  const graph=await api(first.base,'/api/rag/graph?q=MemOS');
  assert.equal(graph.status,200);
  assert.ok(graph.data.items.some(link=>link.subject==='memos'&&link.object==='postgresql'
    &&link.source_key==='note:'+example.data.note.id+':0'),JSON.stringify(graph.data));
  const curator=await api(first.base,'/api/rag/curator');
  assert.equal(curator.status,200);
  assert.equal(curator.data.automaticDeletion,false);
  assert.ok(curator.data.items.some(x=>x.type==='duplicate'));
  assert.ok(curator.data.items.some(x=>x.type==='possible_conflict'));
  const hybridAfterIndex=await api(first.base,'/api/rag/search','POST',{
    query:'Tsukirei сохраняет знания',embedding:[1,0,0],limit:8
  });
  assert.equal(hybridAfterIndex.status,200,JSON.stringify(hybridAfterIndex.data));
  assert.ok(hybridAfterIndex.data.items.some(x=>x.id===fact.data.knowledge.id));
  const cacheOne=await api(first.base,'/api/rag/search','POST',{
    query:'MemOS PostgreSQL',limit:6
  });
  const cacheTwo=await api(first.base,'/api/rag/search','POST',{
    query:'MemOS PostgreSQL',limit:6
  });
  assert.equal(cacheTwo.data.cached,true);
  assert.equal(cacheOne.data.cloudRequests,0);
  const pause=await api(first.base,'/api/rag/engine/pause','POST',{paused:true});
  assert.equal(pause.status,200);
  assert.equal(pause.data.worker.paused,true);
  const newNote=await api(first.base,'/api/notes','POST',{
    title:'Свежая запись при паузе',body:'Уникальный токен плавикатор.'
  });
  assert.equal(newNote.status,201);
  const current=await api(first.base,'/api/rag/search','POST',{query:'плавикатор',limit:6});
  assert.ok(current.data.items.some(item=>item.id===newNote.data.note.id),
    'Fallback should see new note before index refresh: '+JSON.stringify(current.data));
  const resume=await api(first.base,'/api/rag/engine/pause','POST',{paused:false});
  assert.equal(resume.status,200);
  assert.equal(resume.data.worker.paused,false);
  await awaitIndex(7);
  const removedNote=await api(first.base,'/api/notes/'+newNote.data.note.id,'DELETE');
  assert.equal(removedNote.status,200);
  await awaitIndex(6);
  const missingAfterDeletion=await api(first.base,'/api/rag/search','POST',{
    query:'плавикатор',limit:6
  });
  assert.ok(!missingAfterDeletion.data.items.some(x=>x.id===newNote.data.note.id),
    'Deleted note must not remain in the index');
  const tooLarge=await api(first.base,'/api/rag/documents','POST',{
    title:'Большой документ',content:'A'.repeat(100001)
  });
  assert.equal(tooLarge.status,400);
  const removed=await api(first.base,'/api/rag/documents/'+docId,'DELETE');
  assert.equal(removed.status,200);
  const absent=await api(first.base,'/api/rag/documents');
  assert.equal(absent.data.items.length,0);
  assert.equal((await api(first.base,'/api/rag/documents/'+docId,'DELETE')).status,404);
  const bad = await api(first.base, '/api/knowledge', 'POST', { content: 'invalid', embedding: [Infinity, NaN] });
  assert.equal(bad.status, 400);
  const persistent=await api(first.base,'/api/rag/documents','POST',{
    title:'Долговременное хранение',content:'Текст должен сохраняться после перезапуска',
    source:'persistence.md'
  });
  assert.equal(persistent.status,201);
  first.child.kill();
  await new Promise(resolve => first.child.once('exit', resolve));
  const second = await start();
  t.after(() => second.child.kill());
  const persisted = await api(second.base, '/api/state');
  assert.equal(persisted.data.tasks.length, 12);
  assert.equal(persisted.data.notes.length, 4, 'Three curator test notes should persist across restart');
  const docsAfterRestart=await api(second.base,'/api/rag/documents');
  assert.equal(docsAfterRestart.status,200);
  assert.ok(docsAfterRestart.data.items.some(doc=>doc.id===persistent.data.document.id));
  assert.equal(readdirSync(join(dir, 'backups')).filter(name => name.endsWith('.json')).length, 1, 'Migration should not repeat');
});
