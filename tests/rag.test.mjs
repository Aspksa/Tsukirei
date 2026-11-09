import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, keywords, rankSources, mergeVectorHits, groundedContext, publicSources } from '../server/rag.ts';

test('RAG chunking covers the full text with bounded overlap and no empty fragments', () => {
  const input=Array.from({length:300},(_,i)=>'Абзац '+i+' объясняет устройство базы памяти.').join('\n');
  const chunks=chunkText(input,900,110);
  assert.ok(chunks.length>5);
  assert.ok(chunks.every(x=>x.length>=20&&x.length<=900));
  assert.match(chunks[0],/Абзац 0/);
  assert.match(chunks.at(-1),/Абзац 299/);
  assert.ok(chunks.length<200);
  assert.deepEqual(chunkText('  '),[]);
  assert.throws(()=>chunkText('abc',100,20));
});
test('Russian/English keyword normalization and relevant source scoring', () => {
  const terms=keywords('Какие знания о PostgreSQL и памяти проекта?');
  assert.ok(terms.includes('postgresql'));
  assert.ok(terms.some(t=>t.startsWith('памят')));
  const sources=[
    {kind:'note',id:'a',title:'PostgreSQL память',content:'В PostgreSQL хранится память и знание проекта.'},
    {kind:'note',id:'b',title:'Задачи ремонта',content:'Ремонтные работы запланированы.'},
    {kind:'document',id:'d',part:0,title:'Инструкция',content:'Система pgvector использует PostgreSQL для поиска знаний.'}
  ];
  const ranked=rankSources('PostgreSQL память',sources,4);
  assert.equal(ranked[0].id,'a');
  assert.ok(ranked.some(x=>x.id==='d'));
  assert.ok(!ranked.some(x=>x.id==='b'));
  assert.deepEqual(rankSources('и в о',sources),[]);
});
test('RAG sources and context are bounded with traceable evidence numbers', () => {
  const sources=[
    {kind:'note',id:'n1',title:'Сохранённая заметка',content:'Имеются данные. '.repeat(180),score:25,evidenceId:'note:n1:0'},
    {kind:'document',id:'d1',part:2,title:'Документ',content:'Источник с фактами.',score:11,evidenceId:'document:d1:2'}
  ];
  const text=groundedContext(sources,1800);
  assert.ok(text.length<=1800);
  assert.match(text,/\[1\]/);
  assert.match(text,/\[2\]/);
  const citation=publicSources(sources);
  assert.equal(citation[0].label,'[1]');
  assert.equal(citation[1].part,2);
  assert.ok(!Object.prototype.hasOwnProperty.call(citation[0],'content'));
});
test('Vector and lexical results fuse without duplicates',()=>{
  const lex=[{kind:'knowledge',id:'a',title:'A',content:'факт A',evidenceId:'knowledge:a:0',score:20},
    {kind:'note',id:'n',title:'N',content:'факт N',evidenceId:'note:n:0',score:15}];
  const vec=[{kind:'knowledge',id:'b',title:'B',content:'факт B'},
    {kind:'knowledge',id:'a',title:'A',content:'факт A'}];
  const mixed=mergeVectorHits(lex,vec,6);
  assert.equal(mixed.filter(x=>x.id==='a').length,1);
  assert.ok(mixed.some(x=>x.id==='b'));
});
test('RAG detects matching words later in a long chunk',()=>{
  const text='технические сведения разные '.repeat(35)+' редукторный механизм';
  const hits=rankSources('редукторный',[{kind:'document',id:'late',title:'Инструкция',content:text}],5);
  assert.equal(hits.length,1);
});

test('context numbering remains complete inside a 4200-character budget',()=>{
  const hits=Array.from({length:5},(_,i)=>({
    kind:'note',id:'record-'+i,title:'Факт №'+i,content:'Полный факт '.repeat(200),
    evidenceId:'note:record-'+i+':0',score:12
  }));
  const text=groundedContext(hits,4200);
  assert.ok(text.length<=4200);
  for(let i=1;i<=5;i++)assert.ok(text.includes('['+i+']'));
});
test('Russian inflections match stored memories',()=>{
  const hits=rankSources('о редукторных муфтах',[
    {kind:'document',id:'m',title:'Ремонт',content:'редукторная муфта нуждается в ремонте.'}
  ]);
  assert.equal(hits[0]?.id,'m');
});
