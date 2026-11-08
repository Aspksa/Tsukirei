/* Tsukirei City 3D — WebGL2, instanced buildings, offline archive visualization. */
(function(root){
'use strict';
const colors=[[.78,.60,.39],[.96,.75,.46],[.62,.68,.76],[.62,.77,.69],[.81,.67,.59]];
const vertex=`#version 300 es
precision highp float;
layout(location=0) in vec3 pos;
layout(location=1) in vec3 normal;
layout(location=2) in vec4 instance;
layout(location=3) in vec3 tint;
layout(location=4) in vec3 pickid;
uniform mat4 vp;
uniform vec3 eye;
out vec3 n,uv,c,id;
out float h,d;
void main(){
 vec3 world=vec3(instance.x+pos.x*instance.z,pos.y*instance.w,instance.y+pos.z*instance.z);
 gl_Position=vp*vec4(world,1.0);
 n=normal;uv=pos;c=tint;id=pickid;h=instance.w;d=length(world-eye);
}`;
const fragment=`#version 300 es
precision highp float;
in vec3 n,uv,c,id;
in float h,d;
uniform int picking;
uniform float windows;
out vec4 outColor;
void main(){
 if(picking==1){outColor=vec4(id,1.);return;}
 float sun=max(dot(normalize(n),normalize(vec3(-.45,.92,.7))),0.);
 vec3 surface=c*(.37+.75*sun);
 if(n.y>.8)surface+=vec3(.21,.14,.07);
 if(windows>.5 && abs(n.y)<.1){
   float s=abs(n.x)<.1?uv.x:uv.z;
   vec2 tile=fract(vec2((s+.5)*5.,uv.y*h/11.));
   float win=step(.25,tile.x)*step(tile.x,.73)*step(.22,tile.y)*step(tile.y,.61);
   surface+=vec3(.83,.51,.21)*win*.67;
 }
 float fog=clamp((d-2500.)/5500.,0.,.82);
 outColor=vec4(mix(surface,vec3(.033,.047,.064),fog),1.);
}`;
const lineVertex=`#version 300 es
precision highp float;
layout(location=0)in vec3 pos;
layout(location=1)in vec3 tint;
uniform mat4 vp;
out vec3 c;
void main(){gl_Position=vp*vec4(pos,1.);c=tint;}`;
const lineFragment=`#version 300 es
precision highp float;
in vec3 c;
out vec4 outColor;
void main(){outColor=vec4(c,1.);}`;
function perspective(fov,ratio,near,far){
 const f=1/Math.tan(fov/2),d=1/(near-far),a=new Float32Array(16);
 a[0]=f/ratio;a[5]=f;a[10]=(far+near)*d;a[11]=-1;a[14]=2*far*near*d;return a;
}
function lookAt(e,t){
 const unit=a=>{let len=Math.hypot(...a)||1;return a.map(x=>x/len);};
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const z=unit([e[0]-t[0],e[1]-t[1],e[2]-t[2]]);
 const x=unit(cross([0,1,0],z)),y=cross(z,x),dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
 return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,
   -dot(x,e),-dot(y,e),-dot(z,e),1]);
}
function multiply(a,b){
 const out=new Float32Array(16);
 for(let c=0;c<4;c++)for(let r=0;r<4;r++){
  let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];out[c*4+r]=s;
 }
 return out;
}
function cubeVertices(){
 const data=[];
 const face=(n,points)=>{for(const i of [0,1,2,0,2,3])data.push(...points[i],...n);};
 face([0,1,0],[[-.5,1,-.5],[-.5,1,.5],[.5,1,.5],[.5,1,-.5]]);
 face([0,-1,0],[[-.5,0,.5],[-.5,0,-.5],[.5,0,-.5],[.5,0,.5]]);
 face([0,0,1],[[-.5,0,.5],[.5,0,.5],[.5,1,.5],[-.5,1,.5]]);
 face([0,0,-1],[[.5,0,-.5],[-.5,0,-.5],[-.5,1,-.5],[.5,1,-.5]]);
 face([1,0,0],[[.5,0,.5],[.5,0,-.5],[.5,1,-.5],[.5,1,.5]]);
 face([-1,0,0],[[-.5,0,-.5],[-.5,0,.5],[-.5,1,.5],[-.5,1,-.5]]);
 return new Float32Array(data);
}
function shader(gl,type,src){
 const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
 if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('City 3D shader: '+gl.getShaderInfoLog(s));
 return s;
}
function program(gl,v,f){
 const a=shader(gl,gl.VERTEX_SHADER,v),b=shader(gl,gl.FRAGMENT_SHADER,f),p=gl.createProgram();
 gl.attachShader(p,a);gl.attachShader(p,b);gl.linkProgram(p);gl.deleteShader(a);gl.deleteShader(b);
 if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('City 3D program: '+gl.getProgramInfoLog(p));
 return p;
}
function makeMesh(gl,cube,instances){
 const vao=gl.createVertexArray();gl.bindVertexArray(vao);
 const vb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,cube,gl.STATIC_DRAW);
 for(const [i,off] of [[0,0],[1,12]]){
  gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,24,off);
 }
 const ib=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,ib);
 gl.bufferData(gl.ARRAY_BUFFER,instances,gl.STATIC_DRAW);
 for(const [i,n,off] of [[2,4,0],[3,3,16],[4,3,28]]){
  gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,n,gl.FLOAT,false,40,off);gl.vertexAttribDivisor(i,1);
 }
 gl.bindVertexArray(null);return{vao,vb,ib,count:instances.length/10};
}
function makeLines(gl,verts){
 const vao=gl.createVertexArray();gl.bindVertexArray(vao);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
 gl.bufferData(gl.ARRAY_BUFFER,verts,gl.STATIC_DRAW);
 for(const [i,off] of [[0,0],[1,12]]){
  gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,24,off);
 }
 gl.bindVertexArray(null);return{vao,buffer,count:verts.length/6};
}
function dispose(gl,m){
 if(!m)return;
 gl.deleteVertexArray(m.vao);
 if(m.vb)gl.deleteBuffer(m.vb);
 if(m.ib)gl.deleteBuffer(m.ib);
 if(m.buffer)gl.deleteBuffer(m.buffer);
}
function startCity({canvas,detail,districtsList,onNavigate}){
 const model=root.TsukireiCityModel;
 const gl=canvas.getContext('webgl2',{alpha:false,depth:true,antialias:true});
 if(!model||!gl)return null;
 const cube=cubeVertices();
 const blockProgram=program(gl,vertex,fragment),roadProgram=program(gl,lineVertex,lineFragment);
 const uniform={
  vp:gl.getUniformLocation(blockProgram,'vp'),eye:gl.getUniformLocation(blockProgram,'eye'),
  picking:gl.getUniformLocation(blockProgram,'picking'),windows:gl.getUniformLocation(blockProgram,'windows'),
  roadVp:gl.getUniformLocation(roadProgram,'vp')
 };
 let scene=model.cityFromState({notes:[],messages:[],knowledge:[]});
 let buildings=null,plates=null,roads=null,grid=null;
 let active=false,lost=false,raf=0,dirty=true,w=1,h=1,dpr=1;
 let yaw=-.64,pitch=.89,distance=950,target=[0,0,0],selected=null;
 let drag=null,moved=false,pickFbo=null,pickTexture=null,pickDepth=null;

 function pickBuffer(){
  if(pickFbo){
   gl.deleteFramebuffer(pickFbo);gl.deleteTexture(pickTexture);gl.deleteRenderbuffer(pickDepth);
  }
  pickFbo=gl.createFramebuffer();pickTexture=gl.createTexture();pickDepth=gl.createRenderbuffer();
  gl.bindTexture(gl.TEXTURE_2D,pickTexture);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,canvas.width,canvas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.bindRenderbuffer(gl.RENDERBUFFER,pickDepth);
  gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,canvas.width,canvas.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER,pickFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,pickTexture,0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,pickDepth);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('WebGL: ошибка буфера выбора');
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 }
 function rebuild(){
  dispose(gl,buildings);dispose(gl,plates);dispose(gl,roads);dispose(gl,grid);
  const all=[],ground=[],ways=[],lines=[];
  scene.buildings.forEach((b,i)=>{
   const id=i+1,tint=colors[b.tint%colors.length];
   all.push(b.x,b.y,b.size,b.height,...tint,(id&255)/255,((id>>8)&255)/255,((id>>16)&255)/255);
  });
  scene.districts.forEach(d=>ground.push(d.x,d.y,d.size,2,.13,.12,.14,0,0,0));
  const link=(array,x1,y1,z1,x2,y2,z2,color)=>{
   array.push(x1,y1,z1,...color,x2,y2,z2,...color);
  };
  const districtByKey=new Map(scene.districts.map(d=>[d.key,d]));
  for(const edge of scene.roads){
   const a=districtByKey.get(edge.from),b=districtByKey.get(edge.to);
   if(a&&b)link(ways,a.x,3,a.y,b.x,3,b.y,[.79,.57,.32]);
  }
  const extent=scene.districts.length?Math.max(260,...scene.districts.map(d=>
   Math.max(Math.abs(d.x)+d.size,Math.abs(d.y)+d.size))):350;
  const span=Math.min(30000,Math.ceil(extent/75)*75);
  for(let x=-span;x<=span;x+=75){
   link(lines,x,-4,-span,x,-4,span,[.095,.105,.13]);
   link(lines,-span,-4,x,span,-4,x,[.095,.105,.13]);
  }
  buildings=makeMesh(gl,cube,new Float32Array(all));plates=makeMesh(gl,cube,new Float32Array(ground));
  roads=makeLines(gl,new Float32Array(ways));grid=makeLines(gl,new Float32Array(lines));
  dirty=false;
 }
 function camera(){
  const eye=[
   target[0]+distance*Math.cos(pitch)*Math.sin(yaw),
   target[1]+distance*Math.sin(pitch),
   target[2]+distance*Math.cos(pitch)*Math.cos(yaw)
  ];
  return{eye,vp:multiply(perspective(.9,Math.max(.3,w/h),1,Math.max(50000,distance*14)),lookAt(eye,target))};
 }
 function blocks(mesh,camera,picking,windows){
  if(!mesh?.count)return;
  gl.useProgram(blockProgram);
  gl.uniformMatrix4fv(uniform.vp,false,camera.vp);
  gl.uniform3fv(uniform.eye,camera.eye);
  gl.uniform1i(uniform.picking,picking?1:0);
  gl.uniform1f(uniform.windows,windows?1:0);
  gl.bindVertexArray(mesh.vao);gl.drawArraysInstanced(gl.TRIANGLES,0,36,mesh.count);
 }
 function drawLines(mesh,camera){
  if(!mesh?.count)return;
  gl.useProgram(roadProgram);gl.uniformMatrix4fv(uniform.roadVp,false,camera.vp);
  gl.bindVertexArray(mesh.vao);gl.drawArrays(gl.LINES,0,mesh.count);
 }
 function render(){
  raf=0;
  if(!active||lost)return;
  if(dirty)rebuild();
  const view=camera();gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.025,.033,.053,1);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
  drawLines(grid,view);drawLines(roads,view);
  blocks(plates,view,false,false);blocks(buildings,view,false,true);
  gl.bindVertexArray(null);
 }
 function schedule(){if(active&&!lost&&!raf)raf=root.requestAnimationFrame(render);}
 function resize(){
  const box=canvas.getBoundingClientRect();if(box.width<2||box.height<2)return;
  const factor=Math.min(2,root.devicePixelRatio||1,Math.sqrt(4000000/(box.width*box.height)));
  const cw=Math.max(2,Math.floor(box.width*factor)),ch=Math.max(2,Math.floor(box.height*factor));
  w=box.width;h=box.height;dpr=factor;
  if(cw!==canvas.width||ch!==canvas.height){
   canvas.width=cw;canvas.height=ch;pickBuffer();
  }
  schedule();
 }
 function fit(){
  if(!scene.districts.length){target=[0,0,0];distance=950;schedule();return;}
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const d of scene.districts){
   minX=Math.min(minX,d.x-d.size/2);maxX=Math.max(maxX,d.x+d.size/2);
   minZ=Math.min(minZ,d.y-d.size/2);maxZ=Math.max(maxZ,d.y+d.size/2);
  }
  target=[(minX+maxX)/2,25,(minZ+maxZ)/2];
  distance=Math.max(360,Math.hypot(maxX-minX,maxZ-minZ)*1.08+200);
  schedule();
 }
 function pick(x,y){
  if(!buildings?.count||lost)return null;
  if(dirty)rebuild();
  gl.bindFramebuffer(gl.FRAMEBUFFER,pickFbo);
  gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,1);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.disable(gl.DITHER);
  blocks(buildings,camera(),true,false);
  const pixel=new Uint8Array(4);
  gl.readPixels(Math.max(0,Math.min(canvas.width-1,Math.floor(x*dpr))),
   Math.max(0,Math.min(canvas.height-1,canvas.height-1-Math.floor(y*dpr))),
   1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  gl.enable(gl.DITHER);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  const i=pixel[0]+pixel[1]*256+pixel[2]*65536-1;
  schedule();return i>=0&&i<scene.buildings.length?scene.buildings[i].id:null;
 }
 function renderDetail(){
  const item=scene.buildings.find(b=>b.id===selected);
  detail.replaceChildren();
  const add=(tag,cls,txt)=>{
   const n=root.document.createElement(tag);if(cls)n.className=cls;
   n.textContent=txt;detail.append(n);return n;
  };
  if(!item){
   add('p','city-instruction',scene.stats.buildings?'Выберите здание для просмотра исходной записи.':
    'Нет зданий. Добавьте заметку, диалог или запись базы знаний.');return;
  }
  add('span','panel-kicker',item.kind==='note'?'ЗАМЕТКА':item.kind==='knowledge'?'БАЗА ЗНАНИЙ':'ДИАЛОГ');
  add('h3','city-detail-title',item.title);
  add('p','city-detail-meta',item.districtName+' · '+item.wordsCount+' значимых слов');
  add('p','city-detail-body',item.body.slice(0,1100));
  if(item.kind==='knowledge')add('p','city-detail-meta','Источник: '+(item.source||'не указан'));
  else{
   const b=add('button','city-open-button',item.kind==='note'?'Перейти к заметке →':'Открыть чат →');
   b.type='button';b.addEventListener('click',()=>onNavigate?.(item));
  }
 }
 function renderDistricts(){
  districtsList.replaceChildren();
  for(const d of scene.districts){
   const button=root.document.createElement('button');button.type='button';button.className='city-district-button';
   const title=root.document.createElement('span');title.textContent=d.name;
   const count=root.document.createElement('b');count.textContent=String(d.count);
   button.append(title,count);
   button.addEventListener('click',()=>{
    target=[d.x,30,d.y];distance=Math.max(290,d.size*1.25);
    selected=scene.buildings.find(b=>b.district===d.key)?.id||null;
    renderDetail();schedule();
   });
   districtsList.append(button);
  }
  if(!scene.districts.length){
   const p=root.document.createElement('p');p.className='city-instruction';
   p.textContent='Районы появятся после загрузки записей.';districtsList.append(p);
  }
 }
 function update(state){
  const prev=scene.stats.buildings;
  scene=model.cityFromState(state);
  if(scene.stats.buildings>16777214)throw Error('Город превышает предел адресации WebGL');
  if(!scene.buildings.some(b=>b.id===selected))selected=null;
  dirty=true;
  const stats=root.document.getElementById('city-stats');
  if(stats)stats.textContent=scene.stats.districts+' районов · '+scene.stats.buildings+' зданий · '+
   scene.stats.connections+' связей';
  const count=root.document.getElementById('city-count');
  if(count)count.textContent=scene.stats.buildings+' записей';
  renderDetail();renderDistricts();
  if(prev!==scene.stats.buildings)fit();
  schedule();
 }
 function activate(isActive){
  active=Boolean(isActive);
  if(!active&&raf){root.cancelAnimationFrame(raf);raf=0;}
  if(active){resize();schedule();}
 }
 const position=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
 canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0&&e.button!==2)return;
  drag={x:e.clientX,y:e.clientY,yaw,pitch,target:[...target],button:e.button};
  moved=false;canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointermove',e=>{
  if(!drag)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(Math.abs(dx)+Math.abs(dy)>3)moved=true;
  if(!moved)return;
  if(drag.button===2||e.shiftKey){
   const f=distance/Math.max(280,h)*1.4,side=[Math.cos(yaw),0,-Math.sin(yaw)];
   target=[drag.target[0]-side[0]*dx*f,drag.target[1]+dy*f*.32,drag.target[2]-side[2]*dx*f];
  }else{
   yaw=drag.yaw-dx*.007;pitch=Math.max(.16,Math.min(1.42,drag.pitch+dy*.006));
  }
  schedule();
 });
 canvas.addEventListener('pointerup',e=>{
  if(!drag)return;
  if(!moved&&drag.button===0){const p=position(e);selected=pick(p.x,p.y);renderDetail();}
  drag=null;
 });
 canvas.addEventListener('pointercancel',()=>{drag=null;});
 canvas.addEventListener('contextmenu',e=>e.preventDefault());
 canvas.addEventListener('wheel',e=>{
  e.preventDefault();distance=Math.max(55,Math.min(80000,distance*Math.exp(e.deltaY*.001)));schedule();
 },{passive:false});
 canvas.addEventListener('keydown',e=>{
  if(e.key==='+'||e.key==='=')distance=Math.max(55,distance*.84);
  else if(e.key==='-')distance=Math.min(80000,distance*1.18);
  else if(e.key==='ArrowLeft')yaw-=.14;
  else if(e.key==='ArrowRight')yaw+=.14;
  else if(e.key==='ArrowUp')pitch=Math.min(1.42,pitch+.1);
  else if(e.key==='ArrowDown')pitch=Math.max(.16,pitch-.1);
  else return;
  e.preventDefault();schedule();
 });
 root.document.getElementById('city-fit')?.addEventListener('click',fit);
 root.document.getElementById('city-zoom-in')?.addEventListener('click',()=>{
  distance=Math.max(55,distance*.80);schedule();
 });
 root.document.getElementById('city-zoom-out')?.addEventListener('click',()=>{
  distance=Math.min(80000,distance*1.25);schedule();
 });
 canvas.addEventListener('webglcontextlost',e=>{
  e.preventDefault();lost=true;if(raf){root.cancelAnimationFrame(raf);raf=0;}
  const status=root.document.getElementById('city-load-status');
  if(status)status.textContent='Потерян WebGL-контекст; ожидается восстановление.';
 });
 canvas.addEventListener('webglcontextrestored',()=>root.location.reload());
 const observer=new ResizeObserver(()=>{if(active)resize();});
 observer.observe(canvas.parentElement);
 return{update,activate,is3D:true};
}
root.TsukireiCity3D=Object.freeze({startCity});
})(globalThis);
