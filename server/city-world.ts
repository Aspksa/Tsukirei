// Read-only local spatial index for the Memory City.
// Index exists in server memory and is rebuilt from source-of-truth on demand.
export type WorldKind = 'notes' | 'messages' | 'knowledge';
type SourceRecord = Record<string, unknown>;
type WorldBuilding = {
  id: string; kind: 'note' | 'chat' | 'knowledge'; sourceId: string;
  title: string; body: string; district: string; districtName: string;
  fullLength: number; height: number; x: number; y: number; size: number; tint: number;
  wordsCount: number; date: string; source?: string
};
type WorldDistrict = {
  key: string; name: string; x: number; y: number;
  count: number; size: number; wordsCount: number
};
const TILE = 512;
const TOPICS: Array<[string, string, string[]]> = [
  ['memory','Память и знания',['памят','знан','архив','postgres','pgvector','memos','поиск']],
  ['agents','ИИ и агенты',['агент','ии','нейросет','модел','cloud.ru','claude','gpt','автоматизац']],
  ['dev','Разработка',['typescript','github','гитхаб','репозитор','программ','сервер','код','скрипт']],
  ['design','Дизайн',['дизайн','интерфейс','визуализ','изображен','анимац','цвет','логотип']],
  ['files','Документы',['документ','таблиц','excel','отчет','отчёт','файл','скан','pdf']],
  ['plans','Планы и дела',['план','задач','цель','встреч','срок','напоминан']],
  ['people','Люди',['семь','друз','коллег','контакт','человек']]
];
const LETTERS = 'abcdefghijklmnopqrstuvwxyzабвгдежзийклмнопрстуфхцчшщъыьэюя';
function category(text: string): [string,string] {
  const lower=text.toLowerCase();
  let best=0, selected: [string,string]|null=null;
  for(const [id,name,terms] of TOPICS) {
    const count=terms.reduce((score,term)=>score+(lower.includes(term)?1:0),0);
    if(count>best){best=count;selected=[id,name];}
  }
  if(selected)return selected;
  const word=lower.match(/[\p{L}]{3,}/u)?.[0];
  const first=word?.[0] || '';
  return first?['letter:'+first,'Другие темы · '+first.toUpperCase()]:['other','Разное'];
}
function location(district: string, slot: number) {
  const topicIndex=TOPICS.findIndex(x=>x[0]===district);
  const index=topicIndex>=0?topicIndex
    : district==='other'?7:8+Math.max(0,LETTERS.indexOf(district.slice(7)));
  const districtX=(index%10)*50000;
  const districtY=Math.floor(index/10)*50000;
  if(slot===0)return{x:districtX,y:districtY};
  const layer=Math.ceil((Math.sqrt(slot+1)-1)/2);
  const side=2*layer;
  const diff=(2*layer+1)**2-1-slot;
  let x=0,y=0;
  if(diff<side){x=layer-diff;y=-layer;}
  else if(diff<side*2){x=-layer;y=-layer+(diff-side);}
  else if(diff<side*3){x=-layer+(diff-side*2);y=layer;}
  else{x=layer;y=layer-(diff-side*3);}
  return{x:districtX+x*43,y:districtY+y*43};
}
function hash(text:string){
  let value=2166136261;
  for(const ch of text){value^=ch.charCodeAt(0);value=Math.imul(value,16777619);}
  return value>>>0;
}
function asText(value:unknown){return typeof value==='string'?value:'';}
function fromSource(kind:WorldKind, source:SourceRecord, slot:number, district:[string,string]):WorldBuilding|null {
  const sourceId=asText(source.id);
  if(!sourceId)return null;
  const original=kind==='notes'?asText(source.title)+' '+asText(source.body):asText(source.content);
  if(!original.trim())return null;
  const title=kind==='notes'?asText(source.title):original.slice(0,74);
  const textLength=original.length;
  const {x,y}=location(district[0],slot);
  return {
    id:(kind==='notes'?'note:':kind==='messages'?'chat:':'knowledge:')+sourceId,
    kind:kind==='notes'?'note':kind==='messages'?'chat':'knowledge',
    sourceId,title:title.slice(0,110),body:original.slice(0,240),
    district:district[0],districtName:district[1],
    x,y,size:28,height:Math.round(20+Math.min(180,Math.log2(textLength+1)*13)),
    tint:hash(sourceId)%5,fullLength:textLength,
    wordsCount:Math.min(96,original.split(/\s+/).length),
    date:asText(source.createdAt),source:kind==='knowledge'?asText(source.source):undefined
  };
}
function tileKey(x:number,y:number){return Math.floor(x/TILE)+','+Math.floor(y/TILE);}
export class CityWorldIndex {
  private rows:WorldBuilding[]=[];
  private tiles=new Map<string,number[]>();
  private districts=new Map<string,WorldDistrict>();
  private slots=new Map<string,number>();
  private discarded=0;
  get count(){return this.rows.length;}
  get districtCount(){return this.districts.size;}
  get ignoredCount(){return this.discarded;}
  add(kind:WorldKind,source:SourceRecord) {
    const body=kind==='notes'?asText(source.title)+' '+asText(source.body):asText(source.content);
    if(!source.id||!body.trim()){this.discarded++;return;}
    const district=category(body.slice(0,900));
    const slot=this.slots.get(district[0])||0;
    const row=fromSource(kind,source,slot,district);
    if(!row){this.discarded++;return;}
    this.slots.set(district[0],slot+1);
    const i=this.rows.length;this.rows.push(row);
    const key=tileKey(row.x,row.y);
    const ids=this.tiles.get(key)||[];ids.push(i);this.tiles.set(key,ids);
    const old=this.districts.get(district[0]);
    if(old){old.count++;old.size=Math.max(old.size,Math.sqrt(slot+1)*46+95);}
    else{
      const center=location(district[0],0);
      this.districts.set(district[0],{
        key:district[0],name:district[1],x:center.x,y:center.y,
        count:1,size:206,wordsCount:0
      });
    }
  }
  summary(){
    return {
      total:this.rows.length,ignored:this.discarded,mode:'server-spatial-memory',
      tileSize:TILE,districts:[...this.districts.values()].map(x=>({...x}))
    };
  }
  query(x:number,y:number,radius:number,limit:number){
    const maxRadius=Math.min(100000,Math.max(200,radius));
    const budget=Math.min(6500,Math.max(1,limit));
    const left=Math.floor((x-maxRadius)/TILE),right=Math.floor((x+maxRadius)/TILE);
    const bottom=Math.floor((y-maxRadius)/TILE),top=Math.floor((y+maxRadius)/TILE);
    const area=(right-left+1)*(top-bottom+1);
    const distLimit=maxRadius*maxRadius;
    const candidates: Array<{i:number;distance:number}>=[];
    const visit=(id:number)=>{
      const row=this.rows[id],distance=(row.x-x)**2+(row.y-y)**2;
      if(distance<=distLimit)candidates.push({i:id,distance});
    };
    if(area>this.tiles.size*3){
      for(const [key,ids] of this.tiles){
        const pos=key.indexOf(',');
        const tx=Number(key.slice(0,pos)),ty=Number(key.slice(pos+1));
        if(tx>=left&&tx<=right&&ty>=bottom&&ty<=top)for(const id of ids)visit(id);
      }
    }else{
      for(let tx=left;tx<=right;tx++)for(let ty=bottom;ty<=top;ty++){
        const ids=this.tiles.get(tx+','+ty);if(ids)for(const id of ids)visit(id);
      }
    }
    // Candidate count is capped in output, not in the source archive.
    candidates.sort((a,b)=>a.distance-b.distance||a.i-b.i);
    const selected=candidates.slice(0,budget).map(item=>this.rows[item.i]);
    return {
      buildings:selected,displayed:selected.length,nearby:candidates.length,
      total:this.rows.length,limited:candidates.length>budget
    };
  }
  search(query:string,limit=14){
    const needle=query.trim().toLowerCase().slice(0,100);
    if(needle.length<2)return[];
    const result:WorldBuilding[]=[];
    for(const item of this.rows){
      if(item.title.toLowerCase().includes(needle)||item.body.toLowerCase().includes(needle)){
        result.push(item);if(result.length>=Math.min(30,limit))break;
      }
    }
    return result;
  }
}
