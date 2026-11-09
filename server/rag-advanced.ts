import { createHash } from 'node:crypto';
import { keywords, groundedContext, type RagHit } from './rag.ts';

export function sha(text:string) {
  return createHash('sha256').update(text).digest('hex');
}
export type SourceDoc = {
  key:string; kind:'note'|'dialogue'|'knowledge'|'document'; sourceId:string;
  title:string; content:string; createdAt:string; part?:number;
};
export type GraphLink = {from:string; relation:string; to:string; evidence:string};
export function graphLinks(text:string):GraphLink[] {
  const links:GraphLink[]=[];
  const pattern=/([\p{L}\p{N}_-]{3,48})\s+(использует|зависит\s+от|связан[аоы]?\s+с|применяет)\s+([\p{L}\p{N}_.-]{3,48})/giu;
  for(const match of text.matchAll(pattern)) {
    const [whole,rawFrom,relation,rawTo]=match;
    const from=rawFrom.toLowerCase(),to=rawTo.toLowerCase();
    if(from===to)continue;
    const link={from,relation:relation.toLowerCase().replace(/\s+/g,' '),to,evidence:whole.slice(0,160)};
    if(!links.some(x=>x.from===link.from&&x.to===link.to&&x.relation===link.relation))links.push(link);
    if(links.length>=32)break;
  }
  return links;
}
export type CuratorFinding = {
  type:'duplicate'|'possible_conflict'|'stale'; keys:string[]; detail:string; severity:'low'|'medium';
};
export function curatorFindings(sources:SourceDoc[],now=Date.now()):CuratorFinding[] {
  const unique=new Map<string,SourceDoc>(), facts=new Map<string,{value:string;key:string}>(), findings:CuratorFinding[]=[];
  for(const source of sources.slice(0,2500)) {
    const value=source.content.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
    if(value.length>=35){
      const digest=sha(value);
      const prev=unique.get(digest);
      if(prev&&prev.key!==source.key)findings.push({
        type:'duplicate',keys:[prev.key,source.key],severity:'low',
        detail:'Совпадающий текст в двух источниках'
      });
      else unique.set(digest,source);
    }
    for(const match of source.content.matchAll(/^([\p{L}\p{N}_ -]{4,45}):\s*([^\r\n]{1,90})$/gmu)) {
      const field=match[1].trim().toLowerCase(), val=match[2].trim().toLowerCase();
      const prev=facts.get(field);
      if(prev&&prev.value!==val&&prev.key!==source.key){
        findings.push({type:'possible_conflict',keys:[prev.key,source.key],
          severity:'medium',detail:'Различаются значения поля «'+field.slice(0,45)+'»; необходима проверка человеком'});
      } else if(!prev)facts.set(field,{value:val,key:source.key});
    }
    const date=Date.parse(source.createdAt);
    if(Number.isFinite(date)&&now-date>365*86400000)
      findings.push({type:'stale',keys:[source.key],severity:'low',
        detail:'Источник старше 365 дней — проверьте актуальность'});
    if(findings.length>=150)break;
  }
  return findings;
}
function overlap(a:string,b:string) {
  const aw=new Set(keywords(a,60)),bw=keywords(b,60);
  return bw.length ? bw.filter(word=>aw.has(word)).length/bw.length : 0;
}
export function rerankLocal(query:string,items:RagHit[],limit=5):RagHit[] {
  const ordered=[...items].sort((a,b)=>b.score-a.score);
  const selected:RagHit[]=[];
  const cap=Math.max(1,Math.min(15,limit));
  while(ordered.length&&selected.length<cap){
    let best=0,bestScore=-Infinity;
    for(let i=0;i<ordered.length;i++){
      const item=ordered[i];
      const relevance=item.score + overlap(query,item.title+' '+item.content)*4;
      const redundancy=selected.length ? Math.max(...selected.map(x=>overlap(item.content,x.content))) : 0;
      const score=relevance - 6*redundancy;
      if(score>bestScore){best=i;bestScore=score;}
    }
    selected.push(ordered.splice(best,1)[0]);
  }
  return selected;
}
export function smartContext(query:string,hits:RagHit[]){
  const budget=query.length>500?2200:query.length>180?3200:4200;
  const selected=rerankLocal(query,hits,Math.min(5,hits.length));
  return {hits:selected,context:groundedContext(selected,budget),budget};
}
export class RagCache<T> {
  private values=new Map<string,{value:T;until:number}>();
  hits=0;misses=0;
  constructor(private max=128,private ttlMs=90000){}
  get(key:string):T|undefined {
    const item=this.values.get(key);
    if(!item||item.until<Date.now()){this.values.delete(key);this.misses++;return;}
    this.values.delete(key);this.values.set(key,item);this.hits++;return item.value;
  }
  set(key:string,value:T) {
    this.values.delete(key);
    this.values.set(key,{value,until:Date.now()+this.ttlMs});
    while(this.values.size>this.max)this.values.delete(this.values.keys().next().value!);
  }
  clear(){this.values.clear();}
  stats(){return {hits:this.hits,misses:this.misses,entries:this.values.size};}
}
