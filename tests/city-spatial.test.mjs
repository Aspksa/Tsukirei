import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function spatial() {
  const box = {};
  vm.createContext(box);
  vm.runInContext(readFileSync('web/city-spatial.js', 'utf8'), box);
  return box.TsukireiSpatial;
}
const { build, select } = spatial();

test('empty world and negative coordinates', () => {
  const empty=select(build([]),{x:0,y:0,distance:900},1500);
  assert.equal(empty.displayedCount,0);
  const items=[{id:'minus',x:-480,y:-480},{id:'plus',x:3000,y:3000}];
  const result=select(build(items),{x:-480,y:-480,distance:500},1500);
  assert.deepEqual(result.items.map(x=>x.id),['minus']);
  assert.equal(result.totalCount,2);
});

test('visible buildings are capped and nearest entries win', () => {
  const data=Array.from({length:24000},(_,i)=>({
    id:'building-'+i,x:(i%160)*40,y:Math.floor(i/160)*40
  }));
  const index=build(data);
  const query={x:3100,y:2800,distance:6000};
  const a=select(index,query,1500),b=select(index,query,1500);
  assert.equal(a.totalCount,24000);
  assert.equal(a.displayedCount,1500);
  assert.equal(a.limited,true);
  assert.deepEqual(a.items.map(x=>x.id),b.items.map(x=>x.id));
  const radiusSq=a.radius*a.radius;
  assert.ok(a.items.every(p=>(p.x-query.x)**2+(p.y-query.y)**2<=radiusSq));
  const farthest=Math.max(...a.items.map(p=>(p.x-query.x)**2+(p.y-query.y)**2));
  const nearestOutside=data.filter(p=>!new Set(a.items).has(p))
    .map(p=>(p.x-query.x)**2+(p.y-query.y)**2)
    .filter(x=>x<=radiusSq);
  assert.ok(nearestOutside.every(x=>x>=farthest));
});

test('large archive index never sends entire world to GPU', {timeout:45000}, () => {
  const length=200000;
  const items=Array.from({length},(_,i)=>({
    id:String(i),x:(i%1000)*43,y:Math.floor(i/1000)*43
  }));
  const start=performance.now();
  const index=build(items);
  const result=select(index,{x:12000,y:6000,distance:10000},3500);
  const ms=Math.round(performance.now()-start);
  assert.equal(result.totalCount,length);
  assert.ok(result.displayedCount<=3500);
  assert.ok(result.displayedCount>0);
  assert.ok(index.tiles.size<length);
  console.log('Spatial index: '+length+' records; '+result.displayedCount+' GPU instances; '+ms+' ms (CI hardware)');
});

test('long-range request is bounded even if caller sends excessive radius and limit', () => {
  const data=Array.from({length:100},(_,i)=>({id:i,x:0,y:i*15}));
  const index=build(data);
  const result=select(index,{x:0,y:0,distance:1e12},5);
  assert.equal(result.displayedCount,5);
  assert.equal(result.limited,true);
  assert.equal(result.radius,100000);
});
