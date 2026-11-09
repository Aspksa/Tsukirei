import postgres from 'postgres';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { chunkText, keywords, type RagSource } from './rag.ts';
import { graphLinks, sha, type SourceDoc } from './rag-advanced.ts';

export type Note = { id: string; title: string; body: string; createdAt: string };
export type Task = { id: string; title: string; done: boolean; createdAt: string };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
export type State = { notes: Note[]; tasks: Task[]; messages: Message[] };

export type Knowledge = {
  id: string; content: string; source: string; embeddingModel: string | null;
  metadata: Record<string, unknown>; createdAt: string; distance?: number;
};

export function emptyState(): State { return { notes: [], tasks: [], messages: [] }; }
export function validateState(value: unknown): State {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректный архив данных');
  const state = value as State;
  if (!Array.isArray(state.notes) || !Array.isArray(state.tasks) || !Array.isArray(state.messages)) {
    throw new Error('В архиве отсутствуют заметки, задачи или сообщения');
  }
  return state;
}

function readConnection(dataDir: string): string | null {
  const env = process.env.TSUKIREI_DATABASE_URL || process.env.DATABASE_URL;
  if (env) return env;
  const filename = join(dataDir, 'postgres-settings.json');
  if (!existsSync(filename)) return null;
  const settings: unknown = JSON.parse(readFileSync(filename, 'utf8'));
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      typeof (settings as { url?: unknown }).url !== 'string') {
    throw new Error('В data/postgres-settings.json требуется строковое поле url');
  }
  return (settings as { url: string }).url;
}

export async function connectPostgres(dataDir: string) {
  const url = readConnection(dataDir);
  if (!url) {
    if (existsSync(join(dataDir, 'postgres-active.json'))) {
      throw new Error('PostgreSQL ранее был включён. Восстановите data/postgres-settings.json или TSUKIREI_DATABASE_URL; нельзя молча переключаться на старый JSON.');
    }
    return null;
  }
  if (!/^postgres(ql)?:\/\//i.test(url)) throw new Error('Подключение PostgreSQL должно начинаться с postgres:// или postgresql://');
  const sql = postgres(url, { max: 3, connect_timeout: 6, idle_timeout: 20, max_lifetime: 60 * 30 });
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await sql`CREATE TABLE IF NOT EXISTS tsukirei_state (
      id smallint PRIMARY KEY CHECK (id = 1),
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS tsukirei_knowledge (
      id uuid PRIMARY KEY,
      content text NOT NULL,
      source text NOT NULL DEFAULT 'manual',
      embedding vector,
      embedding_model text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS tsukirei_rag_documents (
      id uuid PRIMARY KEY,
      title text NOT NULL,
      source text NOT NULL,
      checksum text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS tsukirei_rag_chunks (
      document_id uuid NOT NULL REFERENCES tsukirei_rag_documents(id) ON DELETE CASCADE,
      part integer NOT NULL CHECK (part >= 0),
      content text NOT NULL,
      searchable tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
      PRIMARY KEY (document_id, part)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS tsukirei_rag_chunks_text_idx
      ON tsukirei_rag_chunks USING gin(searchable)`;
    await sql`CREATE TABLE IF NOT EXISTS tsukirei_rag_index (
      source_key text PRIMARY KEY,
      kind text NOT NULL,
      source_id text NOT NULL,
      title text NOT NULL,
      content text NOT NULL,
      part integer NOT NULL DEFAULT 0,
      checksum text NOT NULL,
      source_created_at timestamptz,
      embedding vector,
      embedding_model text,
      scan_token text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`ALTER TABLE tsukirei_rag_index
      ADD COLUMN IF NOT EXISTS source_created_at timestamptz`;
    await sql`CREATE INDEX IF NOT EXISTS tsukirei_rag_index_text_idx
      ON tsukirei_rag_index USING gin (to_tsvector('simple',title || ' ' || content))`;
    await sql`CREATE INDEX IF NOT EXISTS tsukirei_rag_index_source_idx
      ON tsukirei_rag_index (kind,source_id)`;
    await sql`CREATE TABLE IF NOT EXISTS tsukirei_rag_graph (
      source_key text NOT NULL REFERENCES tsukirei_rag_index(source_key) ON DELETE CASCADE,
      subject text NOT NULL,
      relation text NOT NULL,
      object text NOT NULL,
      evidence text NOT NULL,
      PRIMARY KEY (source_key,subject,relation,object)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS tsukirei_rag_graph_subject_idx
      ON tsukirei_rag_graph (subject)`;
    await sql`CREATE INDEX IF NOT EXISTS tsukirei_knowledge_text_idx ON tsukirei_knowledge
      USING gin (to_tsvector('simple', content))`;
    await sql`CREATE INDEX IF NOT EXISTS tsukirei_knowledge_vector_1024_idx ON tsukirei_knowledge
      USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
      WHERE embedding IS NOT NULL AND vector_dims(embedding) = 1024`;

    const existing = await sql`SELECT id FROM tsukirei_state WHERE id = 1`;
    if (!existing.length) {
      const legacy = join(dataDir, 'tsukirei.json');
      let initial = emptyState();
      if (existsSync(legacy)) {
        initial = validateState(JSON.parse(readFileSync(legacy, 'utf8')));
        const backups = join(dataDir, 'backups');
        mkdirSync(backups, { recursive: true });
        const backup = join(backups, 'tsukirei-before-postgres-' + Date.now() + '-' + randomUUID() + '.json');
        copyFileSync(legacy, backup);
        console.log('[Tsukirei] Резервная копия JSON: ' + backup);
      }
      await sql`INSERT INTO tsukirei_state (id, value) VALUES (1, ${sql.json(initial)})
        ON CONFLICT (id) DO NOTHING`;
    }
    // Marker prevents accidentally reading stale JSON if a database configuration is lost later.
    mkdirSync(dataDir, { recursive: true });
    const marker = join(dataDir, 'postgres-active.json');
    if (!existsSync(marker)) writeFileSync(marker, JSON.stringify({ activatedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    console.log('[Tsukirei] PostgreSQL + pgvector подключены.');

    return {
      async read(): Promise<State> {
        const rows = await sql`SELECT value FROM tsukirei_state WHERE id = 1`;
        if (!rows.length) throw new Error('В PostgreSQL отсутствует основная запись данных');
        return validateState(rows[0].value);
      },
      async mutate<T>(change: (state: State) => T): Promise<T> {
        return await sql.begin(async tx => {
          const rows = await tx`SELECT value FROM tsukirei_state WHERE id = 1 FOR UPDATE`;
          if (!rows.length) throw new Error('В PostgreSQL отсутствует основная запись данных');
          const state = validateState(rows[0].value);
          const result = change(state);
          await tx`UPDATE tsukirei_state SET value = ${tx.json(state)}, updated_at = now() WHERE id = 1`;
          return result;
        });
      },
      async addKnowledge(content: string, source: string, metadata: Record<string, unknown>, embedding?: number[], model?: string): Promise<Knowledge> {
        const id = randomUUID();
        const vector = embedding ? '[' + embedding.join(',') + ']' : null;
        const rows = await sql`INSERT INTO tsukirei_knowledge (id, content, source, embedding, embedding_model, metadata)
          VALUES (${id}, ${content}, ${source}, ${vector}::vector, ${model ?? null}, ${sql.json(metadata)})
          RETURNING id, content, source, embedding_model, metadata, created_at`;
        return toKnowledge(rows[0]);
      },
      async searchKnowledge(query: string, embedding?: number[], limit = 25): Promise<Knowledge[]> {
        if (embedding) {
          const vector = '[' + embedding.join(',') + ']';
          const rows = await sql`SELECT id, content, source, embedding_model, metadata, created_at,
            (embedding <=> ${vector}::vector) AS distance
            FROM tsukirei_knowledge WHERE embedding IS NOT NULL AND vector_dims(embedding) = ${embedding.length}
            ORDER BY embedding <=> ${vector}::vector LIMIT ${limit}`;
          return rows.map(toKnowledge);
        }
        const rows = await sql`SELECT id, content, source, embedding_model, metadata, created_at
          FROM tsukirei_knowledge
          WHERE to_tsvector('simple', content) @@ websearch_to_tsquery('simple', ${query})
          ORDER BY ts_rank(to_tsvector('simple', content), websearch_to_tsquery('simple', ${query})) DESC, created_at DESC
          LIMIT ${limit}`;
        return rows.map(toKnowledge);
      },
      async addRagDocument(title: string, content: string, source: string) {
        const checksum = createHash('sha256').update(title).update('\n').update(content).digest('hex');
        const parts = chunkText(content);
        if (!parts.length) throw new Error('Документ пустой');
        return sql.begin(async tx => {
          const id = randomUUID();
          const inserted = await tx`INSERT INTO tsukirei_rag_documents (id,title,source,checksum)
            VALUES (${id},${title},${source},${checksum})
            ON CONFLICT (checksum) DO NOTHING RETURNING id,title,source,created_at`;
          if (!inserted.length) {
            const existing=await tx`SELECT id,title,source,created_at FROM tsukirei_rag_documents WHERE checksum=${checksum}`;
            if (!existing.length) throw new Error('Конфликт индекса документов');
            return { document: toRagMeta(existing[0]), duplicate: true };
          }
          for(let i=0;i<parts.length;i++){
            await tx`INSERT INTO tsukirei_rag_chunks (document_id,part,content)
              VALUES (${id},${i},${parts[i]})`;
          }
          return { document: toRagMeta(inserted[0]), duplicate: false };
        });
      },
      async listRagDocuments(limit=100) {
        const rows=await sql`SELECT d.id,d.title,d.source,d.created_at,
          (SELECT count(*)::integer FROM tsukirei_rag_chunks c WHERE c.document_id=d.id) AS parts
          FROM tsukirei_rag_documents d ORDER BY d.created_at DESC LIMIT ${limit}`;
        return rows.map(row=>({...toRagMeta(row),parts:Number(row.parts)}));
      },
      async deleteRagDocument(id:string) {
        const rows=await sql`DELETE FROM tsukirei_rag_documents WHERE id=${id}::uuid RETURNING id`;
        return rows.length>0;
      },
      async searchRagDocuments(query:string, limit=35):Promise<RagSource[]> {
        const tokens=keywords(query,12).slice(0,8);
        if(!tokens.length)return [];
        // GIN-backed prefix query covers Russian inflections without a model request.
        const terms=[...new Set(tokens)].map(token=>token+':*').join(' | ');
        const rows=await sql`SELECT d.id,d.title,d.source,d.created_at,c.part,c.content
          FROM tsukirei_rag_chunks c JOIN tsukirei_rag_documents d ON d.id=c.document_id
          WHERE c.searchable @@ to_tsquery('simple', ${terms})
            OR d.title ILIKE ${'%' + query.slice(0,110) + '%'}
          ORDER BY ts_rank_cd(c.searchable,to_tsquery('simple', ${terms})) DESC,
            d.created_at DESC
          LIMIT ${limit}`;
        return rows.map(row=>({
          kind:'document',id:String(row.id),title:String(row.title),content:String(row.content),
          source:String(row.source),part:Number(row.part),
          createdAt:row.created_at instanceof Date?row.created_at.toISOString():String(row.created_at)
        }));
      },
      async ragSourcePage(kind:'notes'|'messages'|'knowledge'|'document',offset:number,limit:number) {
        if(kind==='notes'||kind==='messages'){
          const rows=await sql`SELECT jsonb_array_length(value -> ${kind})::integer AS total,
            COALESCE((SELECT jsonb_agg(value -> ${kind} -> n ORDER BY n)
              FROM generate_series(${offset},
                LEAST(${offset + limit},jsonb_array_length(value -> ${kind}))-1) AS n
            ),'[]'::jsonb) AS items,
            updated_at::text AS revision
            FROM tsukirei_state WHERE id=1`;
          if(!rows.length)throw Error('Архив не найден');
          const items=(rows[0].items || []) as Record<string,unknown>[];
          return {total:Number(rows[0].total),revision:String(rows[0].revision),
            items:items.map(value=>{
              const id=String(value.id || '');
              const note=kind==='notes';
              const title=note?String(value.title || ''):value.role==='user'?'Реплика пользователя':'Ответ Цукирэй';
              const content=note?String(value.title||'')+'\n'+String(value.body||''):String(value.content||'');
              return {key:(note?'note:':'dialogue:')+id+':0',
                kind:note?'note':'dialogue',sourceId:id,title,content,
                createdAt:String(value.createdAt||''),part:0};
            })};
        }
        if(kind==='knowledge'){
          const count=await sql`SELECT count(*)::integer AS total FROM tsukirei_knowledge`;
          const rows=await sql`SELECT id,content,source,created_at FROM tsukirei_knowledge
            ORDER BY created_at,id LIMIT ${limit} OFFSET ${offset}`;
          return {total:Number(count[0].total),revision:null,
            items:rows.map(row=>({
              key:'knowledge:'+row.id+':0',kind:'knowledge',sourceId:String(row.id),
              title:String(row.source||'Знание'),content:String(row.content),
              createdAt:row.created_at instanceof Date?row.created_at.toISOString():String(row.created_at),part:0
            }))};
        }
        const count=await sql`SELECT count(*)::integer AS total FROM tsukirei_rag_chunks`;
        const rows=await sql`SELECT d.id,d.title,d.created_at,c.part,c.content
          FROM tsukirei_rag_chunks c JOIN tsukirei_rag_documents d ON d.id=c.document_id
          ORDER BY d.id,c.part LIMIT ${limit} OFFSET ${offset}`;
        return {total:Number(count[0].total),revision:null,
          items:rows.map(row=>({
            key:'document:'+row.id+':'+row.part,kind:'document',sourceId:String(row.id),
            title:String(row.title),content:String(row.content),
            createdAt:row.created_at instanceof Date?row.created_at.toISOString():String(row.created_at),
            part:Number(row.part)
          }))};
      },
      async upsertRagSource(item:SourceDoc,scanToken:string):Promise<{changed:boolean}> {
        const checksum=sha(item.title+'\n'+item.content);
        const parsedDate=Date.parse(item.createdAt);
        const sourceDate=Number.isFinite(parsedDate)?new Date(parsedDate).toISOString():null;
        const result=await sql`INSERT INTO tsukirei_rag_index
          (source_key,kind,source_id,title,content,part,checksum,scan_token,source_created_at)
          VALUES (${item.key},${item.kind},${item.sourceId},
            ${item.title},${item.content},${item.part??0},${checksum},${scanToken},${sourceDate})
          ON CONFLICT (source_key) DO UPDATE SET
            kind=EXCLUDED.kind,source_id=EXCLUDED.source_id,
            title=EXCLUDED.title,content=EXCLUDED.content,part=EXCLUDED.part,
            checksum=EXCLUDED.checksum,embedding=NULL,embedding_model=NULL,
            scan_token=EXCLUDED.scan_token,source_created_at=EXCLUDED.source_created_at,
            updated_at=now()
          WHERE tsukirei_rag_index.checksum IS DISTINCT FROM EXCLUDED.checksum
          RETURNING source_key`;
        if(!result.length){
          await sql`UPDATE tsukirei_rag_index
            SET scan_token=${scanToken},
              source_created_at=COALESCE(source_created_at,${sourceDate})
            WHERE source_key=${item.key}`;
          return {changed:false};
        }
        await sql`DELETE FROM tsukirei_rag_graph WHERE source_key=${item.key}`;
        for(const link of graphLinks(item.content)){
          await sql`INSERT INTO tsukirei_rag_graph
            (source_key,subject,relation,object,evidence)
            VALUES (${item.key},${link.from},${link.relation},
              ${link.to},${link.evidence}) ON CONFLICT DO NOTHING`;
        }
        return {changed:true};
      },
      async finishRagScan(token:string) {
        const rows=await sql`DELETE FROM tsukirei_rag_index WHERE scan_token <> ${token}
          RETURNING source_key`;
        return rows.length;
      },
      async ragIndexSearch(query:string,limit=65):Promise<RagSource[]> {
        const terms=keywords(query,16).slice(0,10);
        if(!terms.length)return [];
        const tsquery=[...new Set(terms)].map(t=>t+':*').join(' | ');
        const rows=await sql`SELECT kind,source_id,title,content,part,updated_at,
            ts_rank_cd(to_tsvector('simple',title || ' ' || content),
              to_tsquery('simple',${tsquery})) AS relevance
          FROM tsukirei_rag_index
          WHERE to_tsvector('simple',title || ' ' || content) @@ to_tsquery('simple',${tsquery})
          ORDER BY relevance DESC,updated_at DESC LIMIT ${limit}`;
        return rows.map(row=>({
          kind:row.kind,id:String(row.source_id),title:String(row.title),
          content:String(row.content),part:Number(row.part),
          createdAt:row.updated_at instanceof Date?row.updated_at.toISOString():String(row.updated_at)
        })) as RagSource[];
      },
      async ragVectorCount(model:string) {
        const index=await sql`SELECT count(*)::integer AS total FROM tsukirei_rag_index
          WHERE embedding IS NOT NULL AND embedding_model=${model}`;
        const knowledge=await sql`SELECT count(*)::integer AS total FROM tsukirei_knowledge
          WHERE embedding IS NOT NULL AND embedding_model=${model}`;
        return Number(index[0].total)+Number(knowledge[0].total);
      },
      async ragIndexVector(vector:number[],model:string,limit=35):Promise<RagSource[]> {
        const repr='['+vector.join(',')+']';
        const rows=await sql`SELECT kind,source_id,title,content,part,updated_at
          FROM tsukirei_rag_index
          WHERE embedding IS NOT NULL AND embedding_model=${model}
            AND vector_dims(embedding)=${vector.length}
          ORDER BY embedding <=> ${repr}::vector LIMIT ${limit}`;
        return rows.map(row=>({
          kind:row.kind,id:String(row.source_id),title:String(row.title),
          content:String(row.content),part:Number(row.part),
          createdAt:row.updated_at instanceof Date?row.updated_at.toISOString():String(row.updated_at)
        })) as RagSource[];
      },
      async ragPendingVectors(limit=20,model=''):Promise<Array<{key:string;checksum:string;content:string}>>{
        const rows=await sql`SELECT source_key,checksum,content FROM tsukirei_rag_index
          WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM ${model}
          ORDER BY updated_at DESC LIMIT ${limit}`;
        return rows.map(row=>({key:String(row.source_key),checksum:String(row.checksum),
          content:String(row.content)}));
      },
      async ragSaveVector(key:string,checksum:string,model:string,embedding:number[]) {
        const repr='['+embedding.join(',')+']';
        const rows=await sql`UPDATE tsukirei_rag_index
          SET embedding=${repr}::vector,embedding_model=${model}
          WHERE source_key=${key} AND checksum=${checksum}
          RETURNING source_key`;
        return Boolean(rows.length);
      },
      async ragInspect(limit=1000):Promise<SourceDoc[]>{
        const rows=await sql`SELECT source_key,kind,source_id,title,content,part,source_created_at,updated_at
          FROM tsukirei_rag_index ORDER BY updated_at DESC LIMIT ${limit}`;
        return rows.map(row=>({
          key:String(row.source_key),kind:row.kind,sourceId:String(row.source_id),
          title:String(row.title),content:String(row.content),part:Number(row.part),
          createdAt:(row.source_created_at||row.updated_at) instanceof Date
            ?(row.source_created_at||row.updated_at).toISOString()
            :String(row.source_created_at||row.updated_at)
        })) as SourceDoc[];
      },
      async ragGraph(term:string,limit=60) {
        const q='%'+term.trim().toLowerCase().slice(0,65)+'%';
        const rows=await sql`SELECT source_key,subject,relation,object,evidence
          FROM tsukirei_rag_graph
          WHERE subject ILIKE ${q} OR object ILIKE ${q}
          ORDER BY subject,object LIMIT ${limit}`;
        return rows.map(row=>({...row}));
      },
      async ragIndexStats(){
        const count=await sql`SELECT count(*)::integer AS total FROM tsukirei_rag_index`;
        const graph=await sql`SELECT count(*)::integer AS total FROM tsukirei_rag_graph`;
        return {records:Number(count[0].total),relations:Number(graph[0].total)};
      },
      async close() { await sql.end({ timeout: 3 }); }
    };
  } catch (error) {
    await sql.end({ timeout: 1 }).catch(() => {});
    throw new Error('PostgreSQL/pgvector недоступны: ' + (error instanceof Error ? error.message : String(error)));
  }
}

function toKnowledge(row: Record<string, any>): Knowledge {
  return {
    id: row.id, content: row.content, source: row.source,
    embeddingModel: row.embedding_model ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    ...(row.distance == null ? {} : { distance: Number(row.distance) })
  };
}

function toRagMeta(row: Record<string, any>) {
  return { id:String(row.id), title:String(row.title), source:String(row.source),
    createdAt:row.created_at instanceof Date?row.created_at.toISOString():String(row.created_at) };
}
