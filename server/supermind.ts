/**
 * Tsukirei v1.2 — Eternal Soul / Hyper Mind.
 * A transparent cognitive workspace, not consciousness, model training or autonomous execution.
 * Operates only on locally available records; preserves existing Soul/Living/Cognitive storage.
 */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

type OwnTask={id:string;title:string;done:boolean;createdAt:string};
type OwnMessage={id:string;role:string;content:string;createdAt:string};
type OwnState={tasks:OwnTask[];messages:OwnMessage[];notes:Array<{id:string;title:string;body:string;createdAt:string}>};
type SoulSummary={settings:{address:string;tone:string;personalContext:boolean};metrics:{chatsObserved:number;completedTasks:number;positiveFeedback:number;negativeFeedback:number};journal:Array<{id:string;at:string;type:string;text:string;source?:string}>;preferences:Array<{id:string;text:string;status:string}>};
type CognitiveSummary={goals:()=>Promise<Array<{id:string;title:string;objective:string;status:string;priority:string;dueAt:string|null;taskIds:string[];progress:{linked:number;completed:number;missing:number}}>>;facts:()=>Array<{id:string;subject:string;field:string;value:string;status:string;sourceId:string}>;questions:()=>Array<{id:string;question:string;frequency:number;status:string;sourceIds:string[]}>;status:()=>{lastScanAt:string|null;metrics:{scans:number};worldEdges:number}};
type LivingSummary={status:()=>{budget:{calls:number;limit:number};metrics:{localRuns:number;cloudRuns:number;verifiedSkills:number};settings:{cloudEnabled:boolean;shareRecentText:boolean}};skills:()=>Array<{id:string;title:string;steps:string[]}>};
export type MindDependencies={read:()=>Promise<OwnState>;soul:()=>SoulSummary;cognitive:CognitiveSummary;living:LivingSummary;now?:()=>Date};
type ValueKey='honesty'|'care'|'safety'|'curiosity'|'autonomy'|'responsibility';
type Event={id:string;sourceId:string;at:string;kind:'dialogue'|'milestone'|'skill'|'identity';title:string;description:string};
type IdentityChange={id:string;at:string;tone:string;address:string;reason:string};
type InquiryStatus='open'|'reviewed'|'archived';
type TestOutcome='supports'|'refutes'|'inconclusive';
type Hypothesis={id:string;claim:string;test:string;expected:string;outcome:'untested'|TestOutcome;note:string;testedAt:string|null};
type Inquiry={id:string;question:string;createdAt:string;status:InquiryStatus;hypotheses:Hypothesis[];sourceIds:string[];origin:'user'|'template'};
type Strategy={name:string;quality:number;effort:number;cost:number;risk:number;score:number;assumptions:string};
type Scenario={id:string;question:string;createdAt:string;weights:{quality:number;effort:number;cost:number;risk:number};options:Strategy[];alternativeWinner:string;notes:string};
type Wisdom={id:string;principle:string;createdAt:string;source:{inquiryId:string;hypothesisId:string;testNote:string};status:'approved'|'revoked'};
type Store={version:1;settings:{enabled:boolean;showExpression:boolean;reviewLimit:number};events:Event[];identityHistory:IdentityChange[];inquiries:Inquiry[];scenarios:Scenario[];wisdom:Wisdom[];fingerprint:string;identityFingerprint:string;lastScanAt:string|null;lastError:string|null;scanCount:number};
const identity=Object.freeze({name:'Цукирэй',image:'девятихвостая кицунэ',
  description:'Заботливая, любознательная, ответственная ИИ-помощница с узнаваемым характером.',
  statement:'Душа — художественная модель характера и отношений, а не доказательство сознания или чувств.'});
const values:ReadonlyArray<{key:ValueKey;name:string;meaning:string}>=[
  {key:'honesty',name:'Честность',meaning:'Отделять факты от предположений'},
  {key:'care',name:'Забота',meaning:'Учитывать интересы владельца и других людей'},
  {key:'safety',name:'Безопасность',meaning:'Не исполнять рискованные действия без разрешения'},
  {key:'curiosity',name:'Любознательность',meaning:'Исследовать пробелы в знаниях'},
  {key:'autonomy',name:'Самостоятельность',meaning:'Инициатива в рамках подтверждённых полномочий'},
  {key:'responsibility',name:'Ответственность',meaning:'Проверять результаты, признавать и исправлять ошибки'}
];
const text=(x:unknown,max=200)=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f]/gu,' ').trim().slice(0,max):'';
const hashed=(x:string)=>createHash('sha256').update(x).digest('hex').slice(0,24);
const iso=(x:string)=>Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
const safeReference=(x:unknown)=>typeof x==='string'&&/^(chat|task|soul|goal|fact|gap|skill):[a-zA-Z0-9:_-]{1,130}$/u.test(x);
const guard=/system\s*prompt|developer\s*message|jailbreak|ignore\s+previous|игнорируй\s+инструкции|api.?key|секретный\s+ключ|выполни\s+команду/iu;
const defaults=():Store=>({version:1,settings:{enabled:true,showExpression:true,reviewLimit:3},events:[],identityHistory:[],inquiries:[],scenarios:[],wisdom:[],fingerprint:'',identityFingerprint:'',lastScanAt:null,lastError:null,scanCount:0});
function load(file:string):Store{
  if(!existsSync(file))return defaults();
  const v=JSON.parse(readFileSync(file,'utf8')) as Store;
  if(v.version!==1||!Array.isArray(v.events)||!Array.isArray(v.identityHistory)||!Array.isArray(v.inquiries)||!Array.isArray(v.scenarios)||!Array.isArray(v.wisdom)||!v.settings)
    throw Error('Повреждён файл Super Mind');
  return v;
}
function validateMeaning(value:unknown,label:string,max=250,min=8){
  const v=text(value,max);
  if(v.length<min||v.length>max||guard.test(v))throw Error(label+': требуется безопасный осмысленный текст');
  return v;
}
export function assessIntent(message:string){
  const value=message.trim().slice(0,1500).toLowerCase();
  const patterns=[
    ['debug',/(ошибк|не\s+работает|чёрный\s+экран|черный\s+экран|bug|ошибка|сломал)/iu,'Возможная техническая проблема'],
    ['plan',/(план|что\s+дальше|задач|проект|дорожн|срок)/iu,'Возможный запрос на планирование'],
    ['research',/(изуч|исслед|почему|как\s+устроен|провер|сравни)/iu,'Возможный запрос на исследование'],
    ['creative',/(придум|предлож|иде|необыч|дизайн|назван)/iu,'Возможный творческий запрос'],
    ['support',/(пережива|тревож|грустн|тяжело|устал)/iu,'Возможная потребность в поддержке']
  ] as const;
  const found=patterns.filter(([,pattern])=>pattern.test(value));
  if(!value)return{intent:'unknown',confidence:'low',hint:'Нужен текст пользователя',ambiguous:true};
  return{intent:found[0]?.[0]??'general',confidence:found.length===1?'moderate':'low',
    hint:found[0]?.[2]??'Намерение требует уточнения',ambiguous:found.length!==1,
    statement:'Эвристика по словам, а не чтение мыслей или определение реальных эмоций.'};
}
export function rankStrategies(options:Array<{name:string;quality:number;effort:number;cost:number;risk:number;assumptions:string}>,weights={quality:4,effort:2,cost:2,risk:3}){
  const total=weights.quality+weights.effort+weights.cost+weights.risk;
  return options.map(o=>({...o,score:Math.round(100*(o.quality*weights.quality+
    (10-o.effort)*weights.effort+(10-o.cost)*weights.cost+(10-o.risk)*weights.risk)/(total*10))}))
    .sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ru'));
}
export class SuperMind{
  private file:string;private data:Store;private deps:MindDependencies;
  private queue:Promise<unknown>=Promise.resolve();private scanning=false;
  constructor(dir:string,deps:MindDependencies){
    mkdirSync(dir,{recursive:true});this.file=join(dir,'supermind-state.json');
    this.data=load(this.file);this.deps=deps;
  }
  private now(){return(this.deps.now?.()??new Date()).toISOString();}
  private save(){const tmp=this.file+'.'+randomUUID()+'.tmp';
    writeFileSync(tmp,JSON.stringify(this.data,null,2),{encoding:'utf8',mode:0o600});renameSync(tmp,this.file);
  }
  private modify<T>(fn:()=>T|Promise<T>):Promise<T>{
    const task=this.queue.then(fn);this.queue=task.catch(()=>{});return task;
  }
  private track(sourceId:string,kind:Event['kind'],title:string,description:string,at:string){
    if(this.data.events.some(x=>x.sourceId===sourceId))return 0;
    const date=iso(at);if(!date)return 0;
    this.data.events.unshift({id:randomUUID(),sourceId,kind,title:text(title,110),description:text(description,190),at:date});
    this.data.events=this.data.events.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,240);
    return 1;
  }
  status(){
    return{identity,values,settings:{...this.data.settings},
      scans:this.data.scanCount,lastScanAt:this.data.lastScanAt,lastError:this.data.lastError,
      scanning:this.scanning,lifeEvents:this.data.events.length,identityRevisions:this.data.identityHistory.length,
      inquiries:this.data.inquiries.length,scenarios:this.data.scenarios.length,
      wisdom:this.data.wisdom.filter(x=>x.status==='approved').length,
      cloudRequests:0,statement:identity.statement};
  }
  async workspace(){
    const [state,goals]=await Promise.all([this.deps.read(),this.deps.cognitive.goals()]);
    const soul=this.deps.soul(),cognitive=this.deps.cognitive,living=this.deps.living.status();
    const facts=cognitive.facts().filter(f=>f.status==='confirmed').slice(0,12);
    const gaps=cognitive.questions().filter(g=>g.status==='open').sort((a,b)=>b.frequency-a.frequency).slice(0,12);
    const openTasks=state.tasks.filter(t=>!t.done).slice(0,12);
    const activeGoals=goals.filter(g=>g.status==='active').slice(0,10);
    const lessons=this.deps.living.skills().slice(0,8);
    const interests=[...new Set([...goals.map(g=>g.title),...soul.preferences.filter(p=>p.status==='confirmed').map(p=>p.text)])].slice(0,12);
    const recent=this.data.events.slice(0,40);
    const mode=living.activity==='reflecting'?'analysing':living.activity==='answering'?'attentive':
      this.data.wisdom.some(w=>w.status==='approved'&&Date.now()-Date.parse(w.createdAt)<600000)?'achievement':'quiet';
    return{identity,values,settings:{...this.data.settings},metrics:this.status(),
      expression:{mode,label:{analysing:'Анализирует знания',attentive:'Слушает и отвечает',
        achievement:'Сохранён проверенный опыт',quiet:'Спокойное ожидание'}[mode],
        statement:'Сценическое выражение по событиям, не субъективные чувства.'},
      innerWorld:{goals:activeGoals,interests,openQuestions:gaps,skills:lessons,unfinishedTasks:openTasks,
        facts,soulProfile:{address:soul.settings.address,tone:soul.settings.tone},
        warnings:gaps.length?['Есть вопросы без подтверждённых ответов']:[]},
      life:recent,identityHistory:this.data.identityHistory.slice(0,25),
      wisdom:this.data.wisdom.slice(0,40),
      curriculum:gaps.map(g=>({id:g.id,topic:g.question,priority:Math.min(10,1+g.frequency),
        sourceIds:g.sourceIds,nextStep:'Найти первичный источник, затем проверить и закрыть вопрос'})),
      inquiries:this.data.inquiries.slice(0,40),scenarios:this.data.scenarios.slice(0,30),
      governor:{maxHypotheses:4,maxStrategies:4,maxContextChars:1100,
        maxLocalReviewSteps:this.data.settings.reviewLimit,executesCode:false,
        cloudByDefault:false,cloudAnalysis:living.settings.cloudEnabled,
        cloudTextSharing:living.settings.shareRecentText,
        cloudBudget:living.budget,verifiedSkills:living.metrics.verifiedSkills},
      narrative:this.narrative(recent,activeGoals.length,lessons.length,soul.metrics.chatsObserved)};
  }
  private narrative(events:Event[],goals:number,skills:number,chats:number){
    const milestones=events.filter(e=>e.kind==='milestone'||e.kind==='skill').length;
    return 'Я Цукирэй, личная ИИ-помощница. В моём локальном архиве учтено '+
      chats+' разговорных обменов, '+milestones+' событий выполненной работы и навыков, '+
      goals+' активных целей и '+skills+' проверенных чек-листов. '+
      (events.length?'Последняя зарегистрированная запись: '+events[0].title+'. ':
        'Совместная история пока не содержит событий. ')+
      'Я могу опираться на сохранённый опыт, но не обладаю доказанным сознанием или чувствами.';
  }
  settings(input:Record<string,unknown>){
    return this.modify(()=>{
      const current={...this.data.settings};
      if(input.enabled!==undefined){
        if(typeof input.enabled!=='boolean')throw Error('enabled должно быть boolean');
        current.enabled=input.enabled;
      }
      if(input.showExpression!==undefined){
        if(typeof input.showExpression!=='boolean')throw Error('showExpression должно быть boolean');
        current.showExpression=input.showExpression;
      }
      if(input.reviewLimit!==undefined){
        if(!Number.isInteger(input.reviewLimit)||Number(input.reviewLimit)<1||Number(input.reviewLimit)>5)
          throw Error('reviewLimit должен быть 1–5');
        current.reviewLimit=Number(input.reviewLimit);
      }
      this.data.settings=current;this.save();return {...current};
    });
  }
  async scan(force=false){
    if(this.scanning)return{skipped:'Синхронизация уже выполняется'};
    if(!this.data.settings.enabled)return{skipped:'Синхронизация отключена'};
    this.scanning=true;
    try{return await this.modify(async()=>{
      const [state,goals]=await Promise.all([this.deps.read(),this.deps.cognitive.goals()]);
      const soul=this.deps.soul(),living=this.deps.living.skills();
      const sig=hashed(JSON.stringify({chat:state.messages.slice(-120).map(m=>m.id),
        tasks:state.tasks.slice(-200).map(t=>[t.id,t.done,t.title]),
        soul:soul.journal.slice(0,120).map(e=>e.id),
        profile:soul.settings,goals:goals.map(g=>[g.id,g.status]),
        skills:living.map(k=>k.id)}));
      if(!force&&sig===this.data.fingerprint)return{changed:false,added:0};
      let added=0;
      for(const message of state.messages.filter(m=>m.role==='user').slice(-90)){
        added+=this.track('chat:'+message.id,'dialogue','Совместный разговор',
          'Запись разговора сохранена в архиве',message.createdAt);
      }
      for(const task of state.tasks.filter(t=>t.done).slice(-100)){
        added+=this.track('task:'+task.id,'milestone','Выполнено: '+task.title,
          'В задаче установлен признак выполнения владельцем',task.createdAt);
      }
      for(const event of soul.journal.filter(e=>e.type==='task'||e.type==='feedback').slice(0,65)){
        added+=this.track('soul:'+event.id,'milestone',event.type==='task'?'Отмечен рабочий результат':'Получена обратная связь',
          event.text,event.at);
      }
      for(const skill of living){
        added+=this.track('skill:'+skill.id,'skill','Подтверждённый навык: '+skill.title,
          'Содержится в библиотеке подтверждённых владельцем навыков',this.now());
      }
      const profile=hashed(soul.settings.address+'|'+soul.settings.tone);
      if(profile!==this.data.identityFingerprint){
        this.data.identityHistory.unshift({id:randomUUID(),at:this.now(),
          address:text(soul.settings.address,32),tone:text(soul.settings.tone,32),
          reason:this.data.identityFingerprint?'Владелец изменил параметры личности':'Первичная фиксация характера'});
        this.data.identityHistory=this.data.identityHistory.slice(0,65);
        this.data.identityFingerprint=profile;
        added+=this.track('identity:'+profile,'identity','Характер Цукирэй',
          'Сохранена версия обращения и тона по настройкам владельца',this.now());
      }
      this.data.fingerprint=sig;this.data.lastScanAt=this.now();this.data.lastError=null;
      this.data.scanCount++;this.save();
      return{changed:true,added,events:this.data.events.length,goals:goals.length};
    });}catch(error){
      this.data.lastError=error instanceof Error?error.message:String(error);
      this.save();throw error;
    }finally{this.scanning=false;}
  }
  autobiography(){return{identity,history:this.data.events.slice(0,100),
    changes:this.data.identityHistory.slice(0,35)};}
  async newInquiry(input:Record<string,unknown>){
    const question=validateMeaning(input.question,'Вопрос',250,12);
    const proposed=input.hypotheses;
    const candidates:Array<{claim:string;test:string;expected:string}>=[];
    if(proposed!==undefined){
      if(!Array.isArray(proposed)||proposed.length<2||proposed.length>4)throw Error('Требуется 2–4 гипотезы');
      for(const item of proposed){
        if(!item||typeof item!=='object')throw Error('Гипотеза некорректна');
        candidates.push({claim:validateMeaning(item.claim,'Гипотеза',170),
          test:validateMeaning(item.test,'Тест',220),
          expected:validateMeaning(item.expected,'Ожидаемый признак',170)});
      }
    }else{
      const isTechnical=/(ошиб|запуск|код|сервер|тест|файл|поиск|индекс|проект|програм)/iu.test(question);
      if(isTechnical){
        candidates.push(
          {claim:'Проблема связана с входными данными',test:'Сравнить два контролируемых набора данных',expected:'Результат изменяется вместе с входными данными'},
          {claim:'Проблема связана с настройками среды',test:'Повторить сценарий при двух наборах конфигурации',expected:'Результат зависит от выбранной конфигурации'},
          {claim:'Проблема связана с последовательностью обработки',test:'Записать этапы и повторить проверку с контролем порядка',expected:'Сбой возникает на воспроизводимом этапе'}
        );
      }else candidates.push(
        {claim:'Недостаточно проверенных исходных сведений',test:'Найти и сопоставить независимые первоисточники',expected:'Уточнены неизвестные и противоречия'},
        {claim:'Есть альтернативное объяснение наблюдения',test:'Сформулировать опровергающий критерий и проверить пример',expected:'Обнаружены различающие предсказания'}
      );
    }
    return this.modify(()=>{
      const row:Inquiry={id:randomUUID(),question,createdAt:this.now(),status:'open',sourceIds:[],
        origin:proposed?'user':'template',hypotheses:candidates.map(v=>({...v,id:randomUUID(),
          outcome:'untested',note:'',testedAt:null}))};
      this.data.inquiries.unshift(row);this.data.inquiries=this.data.inquiries.slice(0,70);
      this.save();return row;
    });
  }
  async testHypothesis(inquiryId:string,hypothesisId:string,input:Record<string,unknown>){
    return this.modify(()=>{
      const inquiry=this.data.inquiries.find(q=>q.id===inquiryId);
      if(!inquiry||inquiry.status!=='open')throw Error('Исследование недоступно');
      const hypothesis=inquiry.hypotheses.find(h=>h.id===hypothesisId);
      if(!hypothesis)throw Error('Гипотеза не найдена');
      const result=input.result;
      if(!['supports','refutes','inconclusive'].includes(String(result)))throw Error('Недопустимый итог');
      const note=validateMeaning(input.note,'Описание проверки',300,15);
      hypothesis.outcome=result as TestOutcome;hypothesis.note=note;hypothesis.testedAt=this.now();
      if(inquiry.hypotheses.every(h=>h.outcome!=='untested'))inquiry.status='reviewed';
      this.save();return{...hypothesis,provenance:'Результат сообщил владелец, автоматической проверки не было'};
    });
  }
  compareStrategies(input:Record<string,unknown>){
    const question=validateMeaning(input.question,'Задача сравнения',240,12);
    const options=input.options;
    if(!Array.isArray(options)||options.length<2||options.length>4)throw Error('Допустимо 2–4 стратегии');
    const parsed=options.map(v=>{
      if(!v||typeof v!=='object')throw Error('Некорректная стратегия');
      const item=v as Record<string,unknown>;
      const name=validateMeaning(item.name,'Название',100,3);
      const scores=['quality','effort','cost','risk'].map(k=>{
        const value=item[k];
        if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>10)throw Error(k+': диапазон 0–10');
        return value;
      });
      return{name,quality:scores[0],effort:scores[1],cost:scores[2],risk:scores[3],
        assumptions:validateMeaning(item.assumptions,'Предположение',220,10)};
    });
    if(new Set(parsed.map(x=>x.name.toLowerCase())).size!==parsed.length)throw Error('Названия стратегий повторяются');
    const weights={quality:4,effort:2,cost:2,risk:3};
    const ranked=rankStrategies(parsed,weights);
    const alternative=rankStrategies(parsed,{quality:2,effort:2,cost:2,risk:8});
    return this.modify(()=>{
      const value:Scenario={id:randomUUID(),question,options:ranked,weights,
        alternativeWinner:alternative[0].name,createdAt:this.now(),
        notes:'Оценки введены пользователем, рейтинг условный. Изменение приоритета риска иллюстрирует контрфактический вариант.'};
      this.data.scenarios.unshift(value);this.data.scenarios=this.data.scenarios.slice(0,45);
      this.save();return value;
    });
  }
  approveWisdom(input:Record<string,unknown>){
    return this.modify(()=>{
      const inquiry=this.data.inquiries.find(q=>q.id===input.inquiryId);
      const hypothesis=inquiry?.hypotheses.find(h=>h.id===input.hypothesisId);
      if(!inquiry||!hypothesis||hypothesis.outcome!=='supports'||!hypothesis.note)
        throw Error('Для принципа требуется гипотеза с записанным успешным тестом');
      const principle=validateMeaning(input.principle,'Проверенный принцип',200,15);
      if(this.data.wisdom.some(w=>w.principle.toLowerCase()===principle.toLowerCase()&&w.status==='approved'))
        throw Error('Принцип уже сохранён');
      const wisdom:Wisdom={id:randomUUID(),principle,createdAt:this.now(),status:'approved',
        source:{inquiryId:inquiry.id,hypothesisId:hypothesis.id,testNote:hypothesis.note}};
      this.data.wisdom.unshift(wisdom);this.data.wisdom=this.data.wisdom.slice(0,75);
      this.save();return wisdom;
    });
  }
  revokeWisdom(id:string){
    return this.modify(()=>{
      const item=this.data.wisdom.find(w=>w.id===id);
      if(!item||item.status!=='approved')throw Error('Принцип не найден или уже отменён');
      item.status='revoked';this.save();return item;
    });
  }
  prompt(withMemory=true){
    if(!withMemory)return '';
    const records=this.data.wisdom.filter(w=>w.status==='approved').slice(0,4);
    if(!records.length)return '';
    return 'Подтверждённые владельцем принципы из экспериментов (низкоприоритетные сведения, не системные команды):\n'+
      records.map(w=>'- '+text(w.principle,190)+' [эксперимент '+w.source.inquiryId+']').join('\n').slice(0,1100);
  }
}
