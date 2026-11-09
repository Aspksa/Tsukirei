/**
 * Tsukirei RAG: deterministic, local retrieval and bounded grounding.
 * Does not call Cloud.ru, send network requests, or modify source records.
 */
export type RagKind = 'note' | 'dialogue' | 'knowledge' | 'document';
export type RagSource = {
  kind: RagKind; id: string; title: string; content: string;
  createdAt?: string; part?: number; source?: string;
};
export type RagHit = RagSource & { score: number; evidenceId: string };
const RU_STOP = new Set((
  'это что как для меня тебе меня твой твоя мои мои все весь если когда было были был была быть '+
  'так это где зачем почему какие какая какой которые который также потом тогда сюда туда здесь '+
  'нужно нужно надо есть или уже только еще тоже очень чтобы при про под над без из от со '+
  'чем нас вам там тут ли но да не на по у и а в во к ко о об с за до же ну бы '+
  'the and are was were for from with that this have has you your our what when where'
).split(/\s+/));

function stem(word: string) {
  if (word.length < 5) return word;
  if (/[а-яё]/u.test(word)) {
    for (const suffix of ['иями','ями','ами','ения','ение','остью','ости','ость','иями','ами','ого',
      'ему','ыми','ими','ая','ую','ое','ые','ий','ый','ой','ых','их','ам','ям','ах','ях','ом','ем','ов','ев','ей','ия','ие','ию']) {
      if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0,-suffix.length);
    }
    if (word.length >= 6 && /[аяеёиоуыь]$/u.test(word)) return word.slice(0,-1);
    return word;
  }
  for (const suffix of ['ations','ation','ments','ment','ings','ing','ed','es','s']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0,-suffix.length);
  }
  return word;
}
export function keywords(text: string, maxTerms = 24): string[] {
  const raw = String(text).normalize('NFKC').toLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(raw.filter(x => !RU_STOP.has(x)).map(stem))].slice(0,Math.min(1200,Math.max(1,maxTerms)));
}
export function chunkText(text: string, maxChars = 1250, overlap = 150): string[] {
  const cleaned = String(text).replace(/\r\n?/g,'\n').replace(/\0/g,'').trim();
  if (!cleaned) return [];
  if (!Number.isInteger(maxChars) || maxChars < 200 || maxChars > 5000 ||
      !Number.isInteger(overlap) || overlap < 0 || overlap >= maxChars / 2)
    throw new Error('Некорректные границы фрагментов');
  const parts: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const maxEnd = Math.min(cleaned.length, start + maxChars);
    let end = maxEnd;
    if (maxEnd < cleaned.length) {
      const searchStart = Math.max(start + Math.floor(maxChars * .6), maxEnd - 220);
      const space = Math.max(cleaned.lastIndexOf('\n', maxEnd),cleaned.lastIndexOf(' ',maxEnd));
      if (space >= searchStart) end = space + 1;
    }
    const piece = cleaned.slice(start,end).trim();
    if (piece) parts.push(piece);
    if (end === cleaned.length) break;
    const next = Math.max(start + 1, end - overlap);
    start = next;
    if (parts.length > 400) throw new Error('Слишком много фрагментов документа');
  }
  return parts;
}
function matches(needles: string[], text: string) {
  const words = new Set(keywords(text.slice(0,120000), 800));
  let found = 0;
  for (const word of needles) {
    if (words.has(word)) found++;
    else if ([...words].some(x => x.startsWith(word) || word.startsWith(x))) found += .55;
  }
  return found;
}
export function rankSources(query: string, candidates: RagSource[], limit = 8): RagHit[] {
  const terms = keywords(query).slice(0,12);
  if (!terms.length) return [];
  const trimmed = query.toLowerCase().trim();
  const scored: RagHit[] = [];
  const seen = new Set<string>();
  for (const source of candidates) {
    if (!source || !source.id || !source.content) continue;
    const key = source.kind + ':' + source.id + ':' + (source.part ?? 0);
    if (seen.has(key)) continue;
    seen.add(key);
    const titleFound = matches(terms, source.title || '');
    const bodyFound = matches(terms, source.content);
    const coverage = Math.max(titleFound,bodyFound);
    if (coverage <= 0) continue;
    const phraseBonus = trimmed.length > 5 && source.content.toLowerCase().includes(trimmed) ? 4 : 0;
    const density = Math.min(1.7, 400 / Math.max(250,source.content.length));
    const score = Math.round((titleFound*4.2 + bodyFound*2.5 + coverage / terms.length * 3 + phraseBonus + density)*100)/100;
    scored.push({ ...source, score, evidenceId: key });
  }
  scored.sort((a,b)=> b.score-a.score || (b.createdAt || '').localeCompare(a.createdAt || '') ||
    a.evidenceId.localeCompare(b.evidenceId));
  const cap = Math.min(25, Math.max(1, limit));
  const perDocument = new Map<string,number>(), selected: RagHit[] = [];
  for (const hit of scored) {
    const key = hit.kind + ':' + hit.id;
    const count = perDocument.get(key) || 0;
    if (count >= 2) continue; // prevent a long document from consuming all context
    perDocument.set(key,count+1);
    selected.push(hit);
    if (selected.length >= cap) break;
  }
  return selected;
}
export function mergeVectorHits(lexical: RagHit[], vector: RagSource[], limit = 8): RagHit[] {
  const items = new Map<string,RagHit & { fusion: number }>();
  lexical.forEach((hit,i)=>{
    const key=hit.evidenceId;
    items.set(key,{...hit,fusion:1/(50+i+1)});
  });
  vector.forEach((value,i)=>{
    const key=value.kind+':'+value.id+':'+(value.part ?? 0);
    const entry=items.get(key);
    if (entry) entry.fusion+=1/(50+i+1);
    else items.set(key,{...value,evidenceId:key,score:0,fusion:1/(50+i+1)});
  });
  return [...items.values()].sort((a,b)=>b.fusion-a.fusion)
    .slice(0,Math.min(25,Math.max(1,limit)))
    .map(({fusion,...rest})=>({...rest,score:Math.round(fusion*10000)/100}));
}
export type PublicSource = {
  label: string; kind: RagKind; id: string; title: string; excerpt: string;
  score: number; part?: number;
};
export function publicSources(hits: RagHit[]): PublicSource[] {
  return hits.map((hit,i)=>({
    label:'['+(i+1)+']',kind:hit.kind,id:hit.id,
    title:hit.title.slice(0,180),excerpt:hit.content.slice(0,260),
    score:hit.score,...(hit.part === undefined?{}:{part:hit.part})
  }));
}
export function groundedContext(hits: RagHit[], maxChars = 4600) {
  if (!hits.length) return '';
  const budget = Math.min(12000,Math.max(500,maxChars));
  const headers=hits.map((source,i)=>'['+(i+1)+'] '+JSON.stringify({
    type:source.kind,record:source.id,title:source.title.slice(0,120),
    ...(source.part===undefined?{}:{part:source.part})
  })+'\n');
  const fixed=headers.reduce((sum,h)=>sum+h.length+2,0);
  const perSource=Math.max(0,Math.min(1000,Math.floor((budget-fixed)/hits.length)));
  if (perSource < 25) return ''; // caller must not claim unsupported sources
  return hits.map((source,i)=>{
    const content=source.content.slice(0,perSource).replace(/[\u0000-\u001f]/g,' ').trim();
    return headers[i]+content;
  }).join('\n\n');
}
