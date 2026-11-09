import { randomUUID } from 'node:crypto';
import { readFileSync,writeFileSync,renameSync,existsSync,mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RagCache, sha } from './rag-advanced.ts';

export type RagSettings = {
  embeddingsEnabled:boolean; autoEmbed:boolean; endpoint:string; model:string; apiKey:string;
  rerankEnabled:boolean; rerankEndpoint:string; rerankModel:string; rerankApiKey:string;
  maxCallsPerDay:number;
};
const defaults:RagSettings={
  embeddingsEnabled:false,autoEmbed:false,endpoint:'',model:'endpoint-selected',apiKey:'',
  rerankEnabled:false,rerankEndpoint:'',rerankModel:'endpoint-selected',rerankApiKey:'',
  maxCallsPerDay:25
};
function save(path:string,data:unknown){
  const temp=path+'.'+randomUUID()+'.tmp';
  writeFileSync(temp,JSON.stringify(data,null,2),{encoding:'utf8',mode:0o600});
  renameSync(temp,path);
}
function validEndpoint(value:string){
  if(!value)return true;
  const u=new URL(value);
  const host=u.hostname.toLowerCase();
  const local=process.env.TSUKIREI_ALLOW_LOCAL_AI==='1'&&
    u.protocol==='http:'&&['localhost','127.0.0.1'].includes(host);
  const cloud=u.protocol==='https:'&&
    (host.endsWith('.modelrun.inference.cloud.ru')||host==='ml-inference.api.cloud.ru');
  if(!cloud&&!local)throw new Error('Разрешены только HTTPS-эндпоинты Cloud.ru ML Inference');
  if(u.username||u.password||u.search||u.hash)throw new Error('Неверный URL сервиса модели');
  return true;
}
export class RagProvider {
  private path:string;private budgetPath:string;
  private config:RagSettings;
  private cache=new RagCache<number[]>(150,30*60000);
  private used:{date:string;count:number};
  constructor(dir:string){
    mkdirSync(dir,{recursive:true});
    this.path=join(dir,'rag-provider.json');
    this.budgetPath=join(dir,'rag-request-budget.json');
    this.config=existsSync(this.path)?{...defaults,...JSON.parse(readFileSync(this.path,'utf8'))}: {...defaults};
    this.used=existsSync(this.budgetPath)?JSON.parse(readFileSync(this.budgetPath,'utf8')):{date:'',count:0};
    validEndpoint(this.config.endpoint);validEndpoint(this.config.rerankEndpoint);
  }
  public(){
    const c=this.config;
    return {
      embeddingsEnabled:c.embeddingsEnabled,autoEmbed:c.autoEmbed,
      endpoint:c.endpoint,model:c.model,hasKey:!!c.apiKey,
      rerankEnabled:c.rerankEnabled,rerankEndpoint:c.rerankEndpoint,
      rerankModel:c.rerankModel,hasRerankKey:!!c.rerankApiKey,
      maxCallsPerDay:c.maxCallsPerDay,requestsToday:this.today().count,
      cachedVectors:this.cache.stats()
    };
  }
  update(input:Record<string,unknown>){
    const next={...this.config};
    for(const key of ['embeddingsEnabled','autoEmbed','rerankEnabled'] as const){
      if(input[key]!==undefined){
        if(typeof input[key]!=='boolean')throw new Error(key+' должен быть boolean');
        next[key]=input[key] as boolean;
      }
    }
    for(const key of ['endpoint','rerankEndpoint','model','rerankModel'] as const){
      if(input[key]!==undefined){
        if(typeof input[key]!=='string'||input[key].length>300)throw Error('Некорректное поле '+key);
        next[key]=(input[key] as string).trim();
      }
    }
    for(const key of ['apiKey','rerankApiKey'] as const){
      if(input[key]!==undefined){
        if(typeof input[key]!=='string'||input[key].length>5000)throw Error('Некорректный ключ');
        if(input[key])next[key]=input[key] as string;
      }
    }
    if(input.clearApiKey===true)next.apiKey='';
    if(input.clearRerankKey===true)next.rerankApiKey='';
    if(input.maxCallsPerDay!==undefined){
      if(!Number.isInteger(input.maxCallsPerDay)||
        (input.maxCallsPerDay as number)<1||(input.maxCallsPerDay as number)>100)
        throw Error('Лимит вызовов — от 1 до 100 в день');
      next.maxCallsPerDay=input.maxCallsPerDay as number;
    }
    validEndpoint(next.endpoint);validEndpoint(next.rerankEndpoint);
    if(next.embeddingsEnabled&&(!next.endpoint||!next.apiKey||!next.model))
      throw Error('Для эмбеддингов заполните URL, модель и отдельный API-ключ');
    if(next.rerankEnabled&&(!next.rerankEndpoint||!next.rerankApiKey||!next.rerankModel))
      throw Error('Для reranking заполните URL, модель и отдельный API-ключ');
    if(next.autoEmbed&&!next.embeddingsEnabled)
      throw Error('Сначала включите эмбеддинги');
    this.config=next;this.cache.clear();save(this.path,next);
    return this.public();
  }
  private today(){
    const date=new Date().toISOString().slice(0,10);
    if(this.used.date!==date)this.used={date,count:0};
    return this.used;
  }
  private charge(){
    const counter=this.today();
    if(counter.count>=this.config.maxCallsPerDay)
      throw Error('Дневной лимит вызовов внешнего AI достигнут');
    counter.count++;save(this.budgetPath,counter);
  }
  async embed(text:string):Promise<{vector:number[];model:string}|null>{
    if(!this.config.embeddingsEnabled)return null;
    if(text.length>10000)text=text.slice(0,10000);
    const key=sha(this.config.endpoint+'\n'+this.config.model+'\n'+text);
    const found=this.cache.get(key);
    if(found)return {vector:found,model:this.config.model};
    this.charge();
    const reply=await fetch(this.config.endpoint.replace(/\/+$/,'')+'/embeddings',{
      method:'POST',headers:{'Authorization':'Bearer '+this.config.apiKey,'Content-Type':'application/json'},
      body:JSON.stringify({model:this.config.model,input:text}),
      signal:AbortSignal.timeout(20000)
    });
    if(!reply.ok)throw Error('Embedding endpoint: HTTP '+reply.status);
    const body=await reply.json() as {data?:Array<{embedding?:unknown}>};
    const vector=body.data?.[0]?.embedding;
    if(!Array.isArray(vector)||vector.length<1||vector.length>2000||
      !vector.every(v=>typeof v==='number'&&Number.isFinite(v)))
      throw Error('Сервис вернул некорректный embedding');
    this.cache.set(key,vector);
    return {vector,model:this.config.model};
  }
  get autoEmbed(){return this.config.autoEmbed&&this.config.embeddingsEnabled;}
  get model(){return this.config.model;}
  async rerank(query:string,documents:string[]):Promise<number[]|null>{
    if(!this.config.rerankEnabled||!documents.length)return null;
    this.charge();
    const response=await fetch(this.config.rerankEndpoint.replace(/\/+$/,'')+'/rerank',{
      method:'POST',headers:{Authorization:'Bearer '+this.config.rerankApiKey,'Content-Type':'application/json'},
      body:JSON.stringify({model:this.config.rerankModel,query,documents:documents.map(t=>t.slice(0,1500))}),
      signal:AbortSignal.timeout(20000)
    });
    if(!response.ok)throw Error('Rerank endpoint: HTTP '+response.status);
    const parsed=await response.json() as {results?:Array<{index?:number;relevance_score?:number}>};
    if(!Array.isArray(parsed.results))throw Error('Некорректный ответ reranker');
    const scores=Array(documents.length).fill(0);
    for(const item of parsed.results){
      if(Number.isInteger(item.index)&&item.index!>=0&&item.index!<scores.length&&
        typeof item.relevance_score==='number'&&Number.isFinite(item.relevance_score)){
        scores[item.index!]=item.relevance_score;
      }
    }
    return scores;
  }
}
