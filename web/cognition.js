/* Cognitive Evolution v1.1 — source-grounded local UI, not hidden model thoughts. */
(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const node=(tag,cls,value)=>{
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(value!==undefined)n.textContent=String(value);
    return n;
  };
  const date=v=>{
    const ms=Date.parse(v);
    return Number.isFinite(ms)?new Date(ms).toLocaleString('ru-RU'):'Дата не указана';
  };
  const container=(heading,body,footer)=>{
    const box=node('article','cog-record');
    const text=node('div','cog-record-body');
    text.append(node('strong','',heading));
    if(body)text.append(node('p','',body));
    if(footer)text.append(node('small','',footer));
    box.append(text);
    return box;
  };
  const control=(card,items)=>{
    const row=node('div','cog-actions');
    for(const [label,callback] of items){
      const button=node('button','ghost-button',label);
      button.type='button';
      button.addEventListener('click',()=>run(async()=>{
        button.disabled=true;
        try{await callback();await refresh();}
        finally{button.disabled=false;}
      }));
      row.append(button);
    }
    card.append(row);
  };
  const message=(root,text)=>root.replaceChildren(node('p','cog-hint',text));
  let busy=false;
  async function refresh(){
    if(busy)return;
    busy=true;
    try{
      const [state,goals,facts,questions,world,timeline,dreams,primary]=await Promise.all([
        api('/api/state'),api('/api/cognition/goals'),api('/api/cognition/facts'),
        api('/api/cognition/questions'),api('/api/cognition/world'),
        api('/api/cognition/timeline'),api('/api/cognition/dreams'),api('/api/cognition')
      ]);
      el('cog-scan-state').textContent=primary.busy?'Сканирование…':
        primary.lastError?'Ошибка':'Локально · '+primary.metrics.scans+' циклов';
      el('cog-link-count').textContent=String(primary.worldEdges);
      el('cog-goal-count').textContent=String(primary.goals);
      el('cog-fact-count').textContent=String(primary.facts);
      el('cog-gap-count').textContent=String(primary.gaps);
      el('cog-trace-meta').textContent=primary.lastScanAt?'Обновлено '+date(primary.lastScanAt):'Пока нет сканирования';
      el('cog-dream-overview').textContent=primary.lastError?'Ошибка: '+primary.lastError:
        'Сканирований: '+primary.metrics.scans+' · Групп дубликатов: '+primary.duplicateGroups+
        '. Сохранённые записи никогда не удаляются автоматически.';
      const taskOptions=el('cog-task-options');
      // Avoid changing a partially selected goal form on every refresh.
      if(!taskOptions.contains(document.activeElement)){
        const selected=new Set([...taskOptions.querySelectorAll('input:checked')].map(input=>input.value));
        taskOptions.replaceChildren();
        if(!state.tasks.length)message(taskOptions,'Дел пока нет. Цель можно создать без привязки.');
        for(const task of state.tasks.slice(0,20)){
          const label=node('label','cog-task-option');
          const checkbox=node('input');
          checkbox.type='checkbox';checkbox.name='cognitive-task';
          checkbox.value=task.id;checkbox.checked=selected.has(task.id);
          label.append(checkbox,node('span','',task.title+(task.done?' · выполнено':'')));
          taskOptions.append(label);
        }
      }
      const goalList=el('cog-goals');goalList.replaceChildren();
      if(!goals.items.length)message(goalList,'Долгосрочных целей пока нет.');
      const statuses={planned:'План',active:'Активна',paused:'Пауза',completed:'Завершена'};
      for(const goal of goals.items.slice(0,45)){
        const item=container(goal.title,goal.objective,
          statuses[goal.status]+' · '+goal.progress.completed+'/'+goal.progress.linked+
          ' связанных дел завершено'+(goal.dueAt?' · срок '+date(goal.dueAt):''));
        const options=[];
        if(goal.status!=='active')options.push(['В работу',()=>api('/api/cognition/goals/'+goal.id,
          {method:'PATCH',body:{status:'active'}})]);
        if(goal.status==='active')options.push(['Пауза',()=>api('/api/cognition/goals/'+goal.id,
          {method:'PATCH',body:{status:'paused'}})]);
        if(goal.status!=='completed')options.push(['Завершить',()=>api('/api/cognition/goals/'+goal.id,
          {method:'PATCH',body:{status:'completed'}})]);
        options.push(['Привязать выбранные дела',()=>api('/api/cognition/goals/'+goal.id,{
          method:'PATCH',body:{taskIds:[...el('cog-task-options').querySelectorAll('input:checked')].map(x=>x.value)}
        })]);
        options.push(['Удалить',async()=>{
          if(!window.confirm('Удалить цель? Связанные дела останутся без изменений.'))return;
          await api('/api/cognition/goals/'+goal.id,{method:'DELETE'});
        }]);
        control(item,options);goalList.append(item);
      }
      const factList=el('cog-facts');factList.replaceChildren();
      if(!facts.items.length)message(factList,'Кандидаты появятся из строк «Поле: значение» в заметках.');
      const factsStatus={proposed:'Ожидает подтверждения',confirmed:'Подтверждено',
        superseded:'Историческая версия',rejected:'Отклонено',source_missing:'Источник отсутствует'};
      for(const fact of facts.items.slice(0,50)){
        const item=container(fact.subject+' · '+fact.field,fact.value,
          factsStatus[fact.status]+' · '+fact.sourceId+' · '+date(fact.observedAt));
        if(fact.status==='proposed')control(item,[
          ['Подтвердить',()=>api('/api/cognition/facts/'+fact.id,{method:'PATCH',body:{action:'confirm'}})],
          ['Отклонить',()=>api('/api/cognition/facts/'+fact.id,{method:'PATCH',body:{action:'reject'}})]
        ]);
        factList.append(item);
      }
      const gapList=el('cog-questions');gapList.replaceChildren();
      if(!questions.items.length)message(gapList,'Пробелы будут собраны после вопросов с недостаточным покрытием RAG.');
      const gapStatus={open:'Требует изучения',resolved:'Закрыт по источнику',dismissed:'Отклонён'};
      for(const gap of questions.items.slice(0,40)){
        const item=container(gap.question,
          gap.resolution||'Источник ответа пока не подтверждён.',
          gapStatus[gap.status]+' · обращений: '+gap.frequency+' · '+date(gap.lastSeen));
        if(gap.status==='open')control(item,[
          ['Указать источник',async()=>{
            const resolution=window.prompt('Напиши проверенное решение и источник (минимум 12 символов):');
            if(resolution===null)return;
            await api('/api/cognition/questions/'+gap.id,{
              method:'PATCH',body:{action:'resolve',resolution}});
          }],
          ['Не актуально',()=>api('/api/cognition/questions/'+gap.id,{method:'PATCH',body:{action:'dismiss'}})]
        ]);
        gapList.append(item);
      }
      renderWorld(world);
      const dreamList=el('cog-dreams');dreamList.replaceChildren();
      if(!dreams.items.length)message(dreamList,'Одинаковых заметок не обнаружено либо анализ ещё не запускался.');
      for(const group of dreams.items.slice(0,30)){
        dreamList.append(container('Группа совпадающих записей',
          'Исходные заметки не объединяются автоматически.',
          group.sourceIds.join(' · ')));
      }
      const time=el('cog-timeline');time.replaceChildren();
      if(!timeline.items.length)message(time,'Для хронологии нужна локальная проверка.');
      const kind={note:'Заметка',message:'Разговор',task:'Задача',fact:'Кандидат знания'};
      for(const event of timeline.items.slice(0,60)){
        time.append(container(kind[event.type]||'Событие',event.title,date(event.at)+' · '+event.sourceId));
      }
      const trace=el('cog-traces');trace.replaceChildren();
      if(!primary.trace.length)message(trace,'Реальных этапов анализа пока нет.');
      for(const event of primary.trace.slice(0,35)){
        trace.append(container(event.stage,event.detail,
          date(event.at)+' · '+event.itemCount+' объектов · '+event.durationMs+' мс'));
      }
    }catch(e){
      el('cog-scan-state').textContent='Ошибка';
      message(el('cog-assessment'),'Не удалось загрузить данные: '+e.message);
    }finally{busy=false;}
  }
  function renderWorld(result){
    const list=el('cog-world');list.replaceChildren();
    if(!result.edges.length)message(list,'Связи ещё не найдены. Они извлекаются из явных утверждений в заметках и документах.');
    const entities=new Map(result.nodes.map(n=>[n.id,n.label]));
    for(const edge of result.edges.slice(0,80)){
      list.append(container(
        (entities.get(edge.from)||edge.from)+' → '+(entities.get(edge.to)||edge.to),
        edge.relation+' · '+edge.excerpt,
        'Источник: '+edge.evidenceId));
    }
  }
  el('cog-world-form').addEventListener('submit',event=>{
    event.preventDefault();
    run(async()=>{
      const q=el('cog-world-query').value.trim();
      renderWorld(await api('/api/cognition/world?q='+encodeURIComponent(q)));
    });
  });
  el('cog-goal-form').addEventListener('submit',event=>{
    event.preventDefault();
    run(async()=>{
      const title=el('cog-goal-title').value.trim();
      const objective=el('cog-goal-objective').value.trim();
      const dueAt=el('cog-goal-deadline').value;
      const taskIds=[...el('cog-task-options').querySelectorAll('input:checked')].map(x=>x.value);
      await api('/api/cognition/goals',{method:'POST',body:{
        title,objective,priority:el('cog-goal-priority').value,
        dueAt:dueAt?dueAt+'T00:00:00Z':null,taskIds
      }});
      el('cog-goal-form').reset();
      notify('Цель добавлена. Связанные задачи остаются в «Делах».');
      await refresh();
    });
  });
  el('cog-assess-form').addEventListener('submit',event=>{
    event.preventDefault();
    run(async()=>{
      const q=el('cog-assess-query').value.trim();
      const result=await api('/api/cognition/assess',{method:'POST',body:{query:q,remember:true}});
      const assessment=result.assessment,container=el('cog-assessment');
      const labels={insufficient:'Недостаточно источников',partial:'Частичное покрытие',supported:'Хорошее текстовое покрытие'};
      container.replaceChildren();
      container.append(node('strong','',labels[assessment.level]||assessment.level),
        node('p','', 'Найдено '+assessment.sourceCount+' источников. Покрытие значимых слов вопроса: '+
          assessment.coverage+'%. Это не вероятность истинности ответа.'));
      for(const warning of assessment.warnings)container.append(node('p','cog-warning',warning));
      if(result.sources?.length)container.append(node('p','cog-hint',
        'Источники: '+result.sources.map(s=>s.label+' '+s.title).join('; ').slice(0,750)));
      if(assessment.level==='insufficient')await refresh();
    });
  });
  el('cog-scan').addEventListener('click',()=>run(async()=>{
    el('cog-scan-state').textContent='Проверяю источники…';
    await api('/api/cognition/scan',{method:'POST',body:{}});
    await refresh();
    notify('Локальная когнитивная проверка завершена.');
  }));
  globalThis.TsukireiCognitionUI=Object.freeze({refresh});
})();
