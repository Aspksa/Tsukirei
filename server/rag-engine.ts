import { rankSources, mergeVectorHits, keywords, type RagHit, type RagSource } from './rag.ts';
import type { State, Knowledge } from './postgres.ts';

type Db = {
  searchKnowledge(query: string, embedding?: number[], limit?: number): Promise<Knowledge[]>;
  searchRagDocuments(query: string, limit?: number): Promise<RagSource[]>;
  ragIndexSearch?(query:string,limit?:number):Promise<RagSource[]>;
  ragIndexVector?(vector:number[],model:string,limit?:number):Promise<RagSource[]>;
};
export type RagResult = { hits: RagHit[]; mode: 'lexical' | 'hybrid' };

function knowledgeSource(value: Knowledge): RagSource {
  const metaTitle = value.metadata && typeof value.metadata.title === 'string'
    ? value.metadata.title : '';
  return { kind:'knowledge', id:value.id, title:metaTitle || value.source || 'Знание',
    content:value.content, source:value.source, createdAt:value.createdAt };
}
export async function retrieveRag(
  query: string, state: State, database: Db | null,
  limit=5, embedding?: number[], vectorModel?:string, preferIndex=false
): Promise<RagResult> {
  const terms=keywords(query);
  if (!terms.length) return {hits:[],mode:embedding?'hybrid':'lexical'};
  const sources: RagSource[]=[];
  // Once the background index has completed, query its GIN-backed, bounded records.
  // Fall back to the original state while the index is still building.
  const useIndex=Boolean(preferIndex&&database?.ragIndexSearch);
  if(useIndex){
    const indexed=await database!.ragIndexSearch!(query,95);
    sources.push(...indexed);
  } else {
    for(const note of state.notes) {
      if(!note || typeof note.body!=='string')continue;
      sources.push({kind:'note',id:note.id,title:note.title,
        content:(note.title+'\n'+note.body).slice(0,13000),createdAt:note.createdAt});
    }
    for(const message of state.messages){
      if(!message || typeof message.content!=='string')continue;
      sources.push({kind:'dialogue',id:message.id,
        title:message.role==='user'?'Реплика пользователя':'Ответ Цукирэй',
        content:message.content.slice(0,8000),createdAt:message.createdAt});
    }
  }
  let vectors:RagSource[]=[];
  if(database&&!useIndex){
    const tasks:Promise<Knowledge[]>[]=[
      database.searchKnowledge(query,undefined,35).catch(()=>[])
    ];
    for(const term of terms.slice(0,3)){
      tasks.push(database.searchKnowledge(term,undefined,25).catch(()=>[]));
    }
    const [groups,documents]=await Promise.all([
      Promise.all(tasks),database.searchRagDocuments(query,60)
    ]);
    const unique=new Map<string,Knowledge>();
    for(const group of groups)for(const value of group)unique.set(value.id,value);
    for(const value of unique.values())sources.push(knowledgeSource(value));
    sources.push(...documents);
  }
  if(database&&embedding){
    if(useIndex&&vectorModel&&database.ragIndexVector){
      vectors=await database.ragIndexVector(embedding,vectorModel,50);
    }
    // Preserve historical manually saved pgvector knowledge, including embeddings
    // created before the incremental RAG index was introduced.
    const existing=await database.searchKnowledge('',embedding,Math.min(40,Math.max(10,limit*4)));
    const retained=existing.filter(value=>!vectorModel||value.embeddingModel===vectorModel)
      .map(knowledgeSource);
    const merged=new Map<string,RagSource>();
    for(const row of [...vectors,...retained])merged.set(row.kind+':'+row.id+':'+(row.part??0),row);
    vectors=[...merged.values()];
  }
  const ranked=rankSources(query,sources,Math.min(25,Math.max(10,limit*3)));
  if (embedding && vectors.length) return {
    hits:mergeVectorHits(ranked,vectors,limit), mode:'hybrid'
  };
  return {hits:ranked.slice(0,limit),mode:'lexical'};
}
