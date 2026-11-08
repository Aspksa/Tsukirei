/* Tsukirei spatial selection — local deterministic grid index + bounded nearest set. */
(function(root){
'use strict';
function build(items, cellSize=512){
  const tiles=new Map(), records=Array.isArray(items)?items:[];
  for(let i=0;i<records.length;i++){
    const b=records[i];
    if(!Number.isFinite(b.x)||!Number.isFinite(b.y))continue;
    const cx=Math.floor(b.x/cellSize),cy=Math.floor(b.y/cellSize);
    const key=cx+','+cy;
    let group=tiles.get(key);
    if(!group){group=[];tiles.set(key,group);}
    group.push(i);
  }
  return {records,tiles,cellSize};
}
function select(index,viewport,maxBuildings=6500){
  const centerX=Number.isFinite(viewport.x)?viewport.x:0;
  const centerY=Number.isFinite(viewport.y)?viewport.y:0;
  const radius=Math.max(220,Math.min(100000,(Number.isFinite(viewport.distance)?viewport.distance:950)*1.4));
  const budget=Math.max(1,Math.min(20000,Math.floor(maxBuildings)));
  const r2=radius*radius;
  const minX=Math.floor((centerX-radius)/index.cellSize),maxX=Math.floor((centerX+radius)/index.cellSize);
  const minY=Math.floor((centerY-radius)/index.cellSize),maxY=Math.floor((centerY+radius)/index.cellSize);
  const cells=(maxX-minX+1)*(maxY-minY+1);
  const heap=[];
  let candidates=0;
  // Max heap: farthest item is dropped first. Stable tie-breaking by source index.
  const worse=(a,b)=>a.dist>b.dist || (a.dist===b.dist&&a.i>b.i);
  function put(node){
    heap.push(node);
    let i=heap.length-1;
    while(i>0){
      const parent=(i-1)>>1;
      if(!worse(heap[i],heap[parent]))break;
      [heap[i],heap[parent]]=[heap[parent],heap[i]];i=parent;
    }
  }
  function sift(){
    let i=0;
    while(true){
      let k=i*2+1;
      if(k>=heap.length)break;
      if(k+1<heap.length&&worse(heap[k+1],heap[k]))k++;
      if(!worse(heap[k],heap[i]))break;
      [heap[i],heap[k]]=[heap[k],heap[i]];i=k;
    }
  }
  function add(i){
    const b=index.records[i];
    const dx=b.x-centerX,dy=b.y-centerY,dist=dx*dx+dy*dy;
    if(dist>r2) return;
    candidates++;
    const node={i,dist};
    if(heap.length<budget)put(node);
    else if(worse(heap[0],node)){heap[0]=node;sift();}
  }
  if(cells>index.tiles.size*3){
    for(const [key,group] of index.tiles){
      const split=key.indexOf(',');
      const x=Number(key.slice(0,split)),y=Number(key.slice(split+1));
      if(x>=minX&&x<=maxX&&y>=minY&&y<=maxY)for(const id of group)add(id);
    }
  }else{
    for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){
      const group=index.tiles.get(x+','+y);
      if(group)for(const id of group)add(id);
    }
  }
  const ids=heap.map(node=>node.i).sort((a,b)=>a-b);
  return {items:ids.map(i=>index.records[i]),candidateCount:candidates,
    displayedCount:ids.length,totalCount:index.records.length,limited:candidates>budget,
    radius,centerX,centerY};
}
root.TsukireiSpatial=Object.freeze({build,select});
})(globalThis);
