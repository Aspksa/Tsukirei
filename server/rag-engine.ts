import { rankSources, mergeVectorHits, keywords, type RagHit, type RagSource } from './rag.ts';
import type { State, Knowledge } from './postgres.ts';

type Db = {
  searchKnowledge(query: string, embedding?: number[], limit?: number): Promise<Knowledge[]>;
  searchRagDocuments(query: string, limit?: number): Promise<RagSource[]>;
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
  limit=5, embedding?: number[]
): Promise<RagResult> {
  const terms=keywords(query);
  if (!terms.length) return {hits:[],mode:embedding?'hybrid':'lexical'};
  const sources: RagSource[]=[];
  for(const note of state.notes) {
    if(!note || typeof note.body!=='string')continue;
    sources.push({kind:'note',id:note.id,title:note.title,
      content:(note.title+'\n'+note.body).slice(0,13000),createdAt:note.createdAt});
  }
  // Keep all preserved messages, including historical conversations.
  // Do not store or hallucinate a summary of previous user turns.
  for(const message of state.messages){
    if(!message || typeof message.content!=='string')continue;
    // Assistant answers are searchable too, but not ranked above user-authored facts by default.
    sources.push({kind:'dialogue',id:message.id,
      title:message.role==='user'?'Реплика пользователя':'Ответ Цукирэй',
      content:message.content.slice(0,8000),createdAt:message.createdAt});
  }
  let vectors:RagSource[]=[];
  if(database){
    // All retrieval runs against the local database. No Cloud.ru calls.
    const tasks:Promise<Knowledge[]>[]=[
      database.searchKnowledge(query,undefined,35).catch(()=>[])
    ];
    for(const term of terms.slice(0,3)){
      tasks.push(database.searchKnowledge(term,undefined,25).catch(()=>[]));
    }
    const [knowledgeGroups,documents]=await Promise.all([
      Promise.all(tasks),database.searchRagDocuments(query,60)
    ]);
    const unique=new Map<string,Knowledge>();
    for(const group of knowledgeGroups)for(const value of group)unique.set(value.id,value);
    for(const knowledge of unique.values())sources.push(knowledgeSource(knowledge));
    sources.push(...documents);
    if(embedding){
      const vectorHits=await database.searchKnowledge('',embedding,Math.min(40,Math.max(10,limit*4)));
      vectors=vectorHits.map(knowledgeSource);
    }
  }
  const ranked=rankSources(query,sources,Math.min(25,Math.max(10,limit*3)));
  if (embedding && vectors.length) return {
    hits:mergeVectorHits(ranked,vectors,limit), mode:'hybrid'
  };
  return {hits:ranked.slice(0,limit),mode:'lexical'};
}
