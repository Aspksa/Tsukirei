import { randomUUID } from 'node:crypto';
import { sha, curatorFindings, type SourceDoc } from './rag-advanced.ts';
import type { RagProvider } from './rag-provider.ts';

export type IndexKind='notes'|'messages'|'knowledge'|'document';
export type RagDatabase={
  ragSourcePage(kind:IndexKind,offset:number,limit:number):Promise<{total:number;revision:string|null;items:SourceDoc[]}>;
  upsertRagSource(item:SourceDoc,scanToken:string):Promise<{changed:boolean}>;
  finishRagScan(token:string):Promise<number>;
  ragInspect(limit?:number):Promise<SourceDoc[]>;
  ragGraph(term:string,limit?:number):Promise<unknown[]>;
  ragIndexStats():Promise<{records:number;relations:number}>;
  ragPendingVectors(limit:number,model:string):Promise<Array<{key:string;checksum:string;content:string}>>;
  ragSaveVector(key:string,checksum:string,model:string,embedding:number[]):Promise<boolean>;
};
export class RagWorker {
  private timer:ReturnType<typeof setTimeout>|null=null;
  private periodic:ReturnType<typeof setInterval>|null=null;
  private active=false;
  private stopped=false;
  private pending=false;
  private paused=false;
  private processed=0;
  private total=0;
  private changed=0;
  private removed=0;
  private lastRun:string|null=null;
  private error:string|null=null;
  private indexingStage='Ожидание';
  private revision=0;
  private db:RagDatabase;
  private provider:RagProvider;
  private invalidated:()=>void;
  constructor(db:RagDatabase,provider:RagProvider,invalidated:()=>void,periodic=true){
    this.db=db;this.provider=provider;this.invalidated=invalidated;
    this.schedule();
    if(periodic){
      this.periodic=setInterval(()=>this.schedule(),5*60*1000);
      this.periodic.unref?.();
    }
  }
  get generation(){return this.revision;}
  status(){
    return {available:true,running:this.active,paused:this.paused,pending:this.pending,
      processed:this.processed,total:this.total,changed:this.changed,removed:this.removed,
      lastRun:this.lastRun,error:this.error,stage:this.indexingStage,revision:this.revision,
      autoEmbeddings:this.provider.autoEmbed};
  }
  schedule(){
    if(this.stopped)return;
    this.pending=true;
    this.invalidated();
    if(this.active||this.paused||this.timer)return;
    this.timer=setTimeout(()=>{this.timer=null;void this.run();},400);
    this.timer.unref?.();
  }
  setPaused(value:boolean){
    this.paused=value;
    if(!value&&this.pending)this.schedule();
    return this.status();
  }
  async force(){
    this.schedule();
    return this.status();
  }
  private async run(){
    if(this.active||this.paused||this.stopped||!this.pending)return;
    this.active=true;this.pending=false;this.error=null;
    this.processed=0;this.total=0;this.changed=0;this.removed=0;
    this.indexingStage='Индексация';
    const token=randomUUID();
    try{
      const kinds:IndexKind[]=['notes','messages','knowledge','document'];
      let noteRevision:string|null=null;
      for(const kind of kinds){
        let offset=0,expectedRevision:string|null=null;
        for(;;){
          const page=await this.db.ragSourcePage(kind,offset,100);
          if(!Number.isInteger(page.total)||page.total<0||page.items.length>100)throw Error('Ошибка страницы индекса');
          if(offset===0){this.total+=page.total;expectedRevision=page.revision;}
          else if(page.revision!==expectedRevision)throw Error('Архив изменился во время индексации');
          if(kind==='notes')noteRevision=page.revision;
          if(kind==='messages'&&noteRevision!==null&&noteRevision!==page.revision)
            throw Error('История и заметки изменились одновременно — повтор индексации');
          for(const row of page.items){
            if(!row.key||!row.content)continue;
            const out=await this.db.upsertRagSource(row,token);
            if(out.changed)this.changed++;
            this.processed++;
          }
          offset+=page.items.length;
          if(offset>=page.total)break;
          if(!page.items.length)throw Error('Нулевая страница индекса');
          await new Promise<void>(resolve=>setImmediate(resolve));
        }
      }
      // Never remove absent rows before the complete scan succeeds.
      this.removed=await this.db.finishRagScan(token);
      if(this.changed||this.removed){this.revision++;this.invalidated();}
      this.lastRun=new Date().toISOString();
      this.indexingStage='Готово';
      if(this.provider.autoEmbed&&!this.paused){
        this.indexingStage='Эмбеддинги по разрешению пользователя';
        const pending=await this.db.ragPendingVectors(20,this.provider.model);
        for(const item of pending){
          if(this.paused||this.stopped||this.pending)break;
          try{
            const result=await this.provider.embed(item.content.slice(0,3000));
            if(!result)break;
            await this.db.ragSaveVector(item.key,item.checksum,result.model,result.vector);
          }catch(e){
            this.indexingStage='Индексация готова; эмбеддинги приостановлены: '+(e instanceof Error?e.message:String(e));
            break;
          }
        }
      }
    }catch(e){
      this.error=e instanceof Error?e.message:String(e);
      this.indexingStage='Ошибка индекса: '+this.error;
      // An incomplete scan never deletes entries. Retry at the next scheduled
      // maintenance tick or after a user write, not in a hot failure loop.
      this.pending=false;
    }finally{
      this.active=false;
      if(this.pending&&!this.paused&&!this.stopped){
        this.timer=setTimeout(()=>{this.timer=null;void this.run();},1000);
        this.timer.unref?.();
      }
    }
  }
  async curator(){return curatorFindings(await this.db.ragInspect(1500));}
  async graph(query:string){return this.db.ragGraph(query,100);}
  async dbStats(){return this.db.ragIndexStats();}
  close(){
    this.stopped=true;
    if(this.timer)clearTimeout(this.timer);
    if(this.periodic)clearInterval(this.periodic);
  }
}
