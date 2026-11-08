/* Tsukirei City — deterministic, offline model. Nothing is sent to Cloud.ru. */
(function (root) {
  'use strict';
  const STOP = new Set(
    ('это того или как для при все если есть будет были был была чтобы когда который которая которые ' +
     'только очень еще уже тоже просто здесь можно нужно надо наши ваши своё свои мое мой моя ' +
     'проекта проекте проектах такой таким тот эта этот эти его она они мне тебе нас вам ' +
     'что чем где кто тут там нет да из под над без не по на за от до во ко со об а и ' +
     'the and with from for this that into your have has are was were you our not ' +
     'как же ещё того после перед между можно какой всех всех все').split(/\s+/)
  );
  const CATEGORIES = [
    { id: 'memory', name: 'Память и знания', terms: ['памят', 'знан', 'архив', 'memos', 'pgvector', 'postgres', 'граф', 'поиск'] },
    { id: 'agents', name: 'ИИ и агенты', terms: ['агент', 'нейросет', 'модел', 'искусственн', 'интеллект', 'cloud.ru', 'автоматизац', 'claude', 'gpt', 'бот'] },
    { id: 'dev', name: 'Разработка', terms: ['github', 'гитхаб', 'typescript', 'javascript', 'репозитор', 'программ', 'сервер', 'скрипт', 'ошибк', 'npm', 'код', 'разработ'] },
    { id: 'design', name: 'Дизайн', terms: ['дизайн', 'интерфейс', 'визуализ', 'эскиз', 'рисунок', 'картин', 'анимац', 'цвет', 'логотип'] },
    { id: 'files', name: 'Документы', terms: ['документ', 'таблиц', 'excel', 'отчёт', 'отчет', 'файл', 'скан', 'pdf', 'реестр'] },
    { id: 'plans', name: 'Планы и дела', terms: ['план', 'задач', 'встреч', 'расписан', 'срок', 'цель', 'напоминан'] },
    { id: 'people', name: 'Люди', terms: ['семь', 'друз', 'знаком', 'контакт', 'человек', 'коллег'] }
  ];
  function tokens(text) {
    const words = String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
    return words.filter(word => !STOP.has(word) && !/^\d+$/.test(word)).slice(0, 96);
  }
  function hash(value) {
    let result = 2166136261;
    for (const char of String(value)) {
      result ^= char.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }
  function knowledgeItems(state) {
    const notes = Array.isArray(state?.notes) ? state.notes : [];
    const messages = Array.isArray(state?.messages) ? state.messages : [];
    const items = [];
    for (const note of notes) {
      if (!note || !note.id || typeof note.title !== 'string') continue;
      const title = note.title.trim() || 'Без названия';
      const body = typeof note.body === 'string' ? note.body : '';
      items.push({ id: 'note:' + note.id, kind: 'note', sourceId: note.id, title,
        body, fullLength: Number.isFinite(note.fullLength) ? note.fullLength : title.length + body.length,
        date: note.createdAt || '', words: tokens(title + ' ' + body) });
    }
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message || !message.id || typeof message.content !== 'string') continue;
      // User turn + adjacent answer form one real dialogue building. No invented content.
      if (message.role === 'assistant' && i > 0 && messages[i - 1]?.role === 'user') continue;
      const response = message.role === 'user' && messages[i + 1]?.role === 'assistant'
        ? String(messages[i + 1].content || '') : '';
      const text = message.content.trim();
      if (!text) continue;
      const title = text.length > 74 ? text.slice(0, 71) + '…' : text;
      const combined = text + ' ' + response;
      const sourceLength = Number.isFinite(message.fullLength) ? message.fullLength : text.length;
      const answerLength = message.role === 'user' && messages[i + 1]?.role === 'assistant'
        ? (Number.isFinite(messages[i + 1].fullLength) ? messages[i + 1].fullLength : response.length)
        : 0;
      items.push({ id: 'chat:' + message.id, kind: 'chat', sourceId: message.id, title,
        body: combined, fullLength: sourceLength + answerLength,
        date: message.createdAt || '', words: tokens(combined) });
    }
    const knowledge = Array.isArray(state?.knowledge) ? state.knowledge : [];
    for (const entry of knowledge) {
      if (!entry || !entry.id || typeof entry.content !== 'string') continue;
      const body = entry.content.trim();
      if (!body) continue;
      const title = body.length > 74 ? body.slice(0, 71) + '…' : body;
      const source = typeof entry.source === 'string' ? entry.source : 'knowledge';
      items.push({ id: 'knowledge:' + entry.id, kind: 'knowledge', sourceId: entry.id,
        title, body, source,
        fullLength: Number.isFinite(entry.fullLength) ? entry.fullLength : body.length,
        date: entry.createdAt || '', words: tokens(body) });
    }
    return items;
  }
  function classify(item) {
    const primary = String(item.title).toLowerCase();
    const all = (primary + ' ' + String(item.body).slice(0, 700)).toLowerCase();
    let best = null;
    let score = 0;
    for (const category of CATEGORIES) {
      let value = 0;
      for (const term of category.terms) {
        if (primary.includes(term)) value += 3;
        if (all.includes(term)) value++;
      }
      if (value > score) { score = value; best = category; }
    }
    if (best) return { key: best.id, name: best.name };
    const first = tokens(primary)[0] || tokens(all)[0];
    return first ? { key: 'letter:' + first[0], name: 'Другие темы · ' + first[0].toUpperCase() }
      : { key: 'other', name: 'Разное' };
  }
  function cityFromState(state) {
    const items = knowledgeItems(state);
    const map = new Map();
    for (const item of items) {
      const topic = classify(item);
      if (!map.has(topic.key)) map.set(topic.key, { key: topic.key, name: topic.name, items: [], words: new Set() });
      const group = map.get(topic.key);
      group.items.push(item);
      for (const word of item.words) group.words.add(word);
    }
    const districts = [...map.values()].sort((a, b) => a.key.localeCompare(b.key, 'ru'));
    const columns = Math.max(1, Math.ceil(Math.sqrt(districts.length)));
    const maxGrid = Math.max(1, ...districts.map(d => Math.ceil(Math.sqrt(d.items.length))));
    const spacing = Math.max(300, maxGrid * 44 + 98);
    const rows = Math.ceil(districts.length / columns);
    const buildings = [];
    for (let i = 0; i < districts.length; i++) {
      const district = districts[i];
      district.x = (i % columns - (columns - 1) / 2) * spacing;
      district.y = (Math.floor(i / columns) - (rows - 1) / 2) * spacing;
      district.size = Math.max(206, Math.ceil(Math.sqrt(district.items.length)) * 43 + 70);
      const ncol = Math.ceil(Math.sqrt(district.items.length));
      const nrow = Math.ceil(district.items.length / ncol);
      for (let j = 0; j < district.items.length; j++) {
        const item = district.items[j];
        const lexical = item.words.length;
        const height = Math.round(20 + Math.min(180, Math.log2(Math.max(1, item.fullLength) + 1) * 13));
        const x = district.x + (j % ncol - (ncol - 1) / 2) * 43;
        const y = district.y + (Math.floor(j / ncol) - (nrow - 1) / 2) * 43;
        buildings.push({ ...item, district: district.key, districtName: district.name, height,
          wordsCount: lexical, x, y, size: 28, tint: hash(item.id) % 5 });
      }
      district.count = district.items.length;
      district.wordsCount = district.items.reduce((sum, item) => sum + item.words.length, 0);
      // Return JSON-safe data; grouping indices hold real records, not inferred knowledge.
      delete district.items;
    }
    const roads = [];
    for (let i = 0; i < districts.length; i++) {
      for (let j = i + 1; j < districts.length; j++) {
        const shared = [...districts[i].words].filter(word =>
          word.length > 3 && districts[j].words.has(word));
        if (shared.length) roads.push({ from: districts[i].key, to: districts[j].key,
          shared: shared.slice(0, 5), strength: shared.length });
      }
    }
    for (const district of districts) delete district.words;
    return { districts, buildings, roads,
      stats: { districts: districts.length, buildings: buildings.length, connections: roads.length,
        notes: buildings.filter(b => b.kind === 'note').length,
        dialogues: buildings.filter(b => b.kind === 'chat').length,
        knowledge: buildings.filter(b => b.kind === 'knowledge').length } };
  }
  root.TsukireiCityModel = Object.freeze({ cityFromState, tokens });
})(globalThis);
