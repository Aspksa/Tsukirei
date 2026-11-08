import { CityWorldIndex, type WorldKind } from './city-world.ts';
type Page = {total:number;items:unknown[];revision:string|null};
type PageFn = (kind:WorldKind,offset:number,limit:number)=>Promise<Page>;

/** In-memory, disposable index: never modifies archive or Cloud.ru settings. */
export class CityWorldService {
  private index:CityWorldIndex|null=null;
  private generation=0;
  private job:Promise<void>|null=null;
  private progress=0;
  private total=0;
  private error:string|null=null;
  constructor(private readonly page:PageFn){}
  invalidate(){
    this.generation++;
    this.index=null;
    this.progress=0;
    this.total=0;
    this.error=null;
    // A superseded builder is allowed to finish its current DB read; its results are discarded.
    this.job=null;
  }
  status(){
    if(!this.index&&!this.job&&!this.error)this.start();
    return{
      supported:true,ready:Boolean(this.index),state:this.index?'ready':this.error?'error':'building',
      progress:this.index?.count??this.progress,total:this.index?.count??this.total,
      error:this.error,index:this.index?.summary()??null
    };
  }
  tiles(x:number,y:number,radius:number,limit:number){
    if(!this.index)return null;
    return this.index.query(x,y,radius,limit);
  }
  search(query:string,limit:number){
    if(!this.index)return null;
    return this.index.search(query,limit);
  }
  private start(){
    const generation=++this.generation;
    this.job=this.build(generation).catch(error=>{
      if(generation!==this.generation)return;
      this.error=error instanceof Error?error.message:String(error);
      console.error('[Tsukirei] Ошибка индекса города:',this.error);
    }).finally(()=>{
      if(generation===this.generation)this.job=null;
    });
  }
  private async build(token:number){
    const result=new CityWorldIndex();
    let total=0,done=0;
    const firstStateRevisions=new Map<WorldKind,string|null>();
    for(const kind of ['notes','messages','knowledge'] as WorldKind[]){
      let offset=0,hasMore=true;
      let revision:string|null=null;
      while(hasMore){
        if(token!==this.generation)return;
        const page=await this.page(kind,offset,200);
        if(token!==this.generation)return;
        if(!Number.isSafeInteger(page.total)||page.total<0||!Array.isArray(page.items)||
          page.items.length>200)throw Error('Некорректная страница индекса города');
        if(revision!==null&&page.revision!==revision)throw Error('Архив изменился при построении индекса');
        revision=page.revision;
        if(offset===0){total+=page.total;this.total=total;}
        for(const row of page.items){
          if(row&&typeof row==='object'&&!Array.isArray(row))result.add(kind,row as Record<string,unknown>);
        }
        done+=page.items.length;
        this.progress=done;
        offset+=page.items.length;
        hasMore=offset<page.total;
        if(hasMore&&!page.items.length)throw Error('Чтение архива не продвинулось');
        // Let the HTTP event loop respond while the index is built in bounded pages.
        if(done%800===0)await new Promise<void>(resolve=>setImmediate(resolve));
      }
      firstStateRevisions.set(kind,revision);
      if(kind==='messages'&&firstStateRevisions.get('notes')!==null&&
         firstStateRevisions.get('messages')!==firstStateRevisions.get('notes'))
        throw Error('История обновилась при построении индекса');
    }
    if(token!==this.generation)return;
    this.index=result;
    this.total=result.count;
    this.progress=result.count;
    console.log('[Tsukirei] Город индексирован:',result.count,'объектов');
  }
}
