import postgres from 'postgres';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

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
      // Bounded JSONB slices, not full history transfer. Read-only, no migration.
      async pageCity(kind: 'notes' | 'messages' | 'knowledge', offset: number, limit: number) {
        if (kind === 'knowledge') {
          const totals = await sql`SELECT count(*)::int AS total FROM tsukirei_knowledge`;
          const records = await sql`SELECT id, content, source, metadata, created_at
            FROM tsukirei_knowledge ORDER BY created_at ASC, id ASC
            LIMIT ${limit} OFFSET ${offset}`;
          return {
            total: Number(totals[0].total),
            items: records.map(row => ({
              id: String(row.id), content: row.content, source: row.source,
              metadata: row.metadata ?? {},
              createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
            })),
            revision: null
          };
        }
        const rows = await sql`
          SELECT
            jsonb_array_length(value -> ${kind})::int AS total,
            COALESCE(
              (SELECT jsonb_agg(value -> ${kind} -> n ORDER BY n)
               FROM generate_series(${offset}, LEAST(${offset + limit}, jsonb_array_length(value -> ${kind})) - 1) AS n),
              '[]'::jsonb
            ) AS items,
            updated_at::text AS revision
          FROM tsukirei_state WHERE id = 1`;
        if (!rows.length) throw new Error('Архив PostgreSQL отсутствует');
        return { total: Number(rows[0].total), items: rows[0].items, revision: rows[0].revision };
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
