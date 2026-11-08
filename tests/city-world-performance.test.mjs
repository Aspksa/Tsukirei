import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CityWorldIndex } from '../server/city-world.ts';

test('Server city index bounds tiles and district positions at 100,000 records', {timeout:45000}, () => {
  const index=new CityWorldIndex();
  const start=performance.now();
  for(let i=0;i<100000;i++){
    index.add('notes',{
      id:'note-'+i,title:'Память знаний '+i,
      body:'Граф долговременной памяти '+(i%40),createdAt:'2026-11-09T00:00:00Z'
    });
  }
  assert.equal(index.count,100000);
  assert.equal(index.summary().total,100000);
  const first=index.query(0,0,100000,1200);
  assert.equal(first.total,100000);
  assert.equal(first.displayed,1200);
  assert.ok(first.nearby>=1200);
  assert.equal(first.limited,true);
  assert.equal(new Set(first.buildings.map(b=>b.id)).size,1200);
  const second=index.query(0,0,100000,1200);
  assert.deepEqual(second.buildings.map(b=>b.id),first.buildings.map(b=>b.id));
  const unknown=index.query(-999999,-999999,500,500);
  assert.equal(unknown.displayed,0);
  assert.equal(index.search('знаний 99999')[0].sourceId,'note-99999');
  console.log('Server spatial index: 100k entries; 1200 selected; '+
    Math.round(performance.now()-start)+'ms total on CI runner');
});
