/* Tsukirei v1.0 — local, evidence-backed Living Core dashboard. */
(() => {
  'use strict';
  const one=id=>document.getElementById(id);
  const item=(tag,cls,text)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(text!==undefined)node.textContent=String(text);
    return node;
  };
  const kindNames={
    goal:'Цель',question:'Любопытство',skill:'Навык',
    critique:'Самопроверка',reflection:'Рефлексия'
  };
  let loaded=false;
  let updating=false;
  const recent=stamp=>{
    const time=Date.parse(stamp);
    return Number.isFinite(time)?new Date(time).toLocaleString('ru-RU'):'';
  };
  function eventCard(title,text,subtitle){
    const card=item('article','living-event');
    const main=item('div','living-event-content');
    main.append(item('strong','',title),item('p','',text));
    if(subtitle)main.append(item('small','',subtitle));
    card.append(main);return card;
  }
  async function refresh(){
    if(updating)return;
    updating=true;
    try {
      const data=await api('/api/living');
      loaded=true;
      const {settings,metrics,budget}=data;
      const mode=data.activity;
      const modeNames={idle:'Ожидание',reflecting:'Анализирует локальную память',answering:'Отвечает в чате'};
      one('living-presence-orb').dataset.mode=mode;
      one('living-current-state').textContent=settings.enabled?
        modeNames[mode]||'Работает':'Фоновое развитие отключено';
      one('living-header-status').textContent=data.running?'Идёт проверка':settings.cloudEnabled?'Локально + Cloud.ru':'Только локально';
      one('living-last-summary').textContent=data.lastError?
        'Ошибка последней проверки: '+data.lastError:(data.lastSummary||'Запустите локальную проверку или оставьте приложение открытым.');
      one('living-local-count').textContent=String(metrics.localRuns);
      one('living-cloud-count').textContent=String(metrics.cloudRuns);
      one('living-skill-count').textContent=String(metrics.verifiedSkills);
      one('living-budget-count').textContent=budget.calls+' / '+budget.limit;
      if(!one('living-settings-form').contains(document.activeElement)){
        one('living-enabled').checked=settings.enabled;
        one('living-cloud-enabled').checked=settings.cloudEnabled;
        one('living-share-text').checked=settings.shareRecentText;
        one('living-idle').value=settings.idleMinutes;
        one('living-interval').value=settings.intervalMinutes;
        one('living-cloud-limit').value=settings.maxCloudCallsPerDay;
      }
      one('living-run-cloud').disabled=!settings.enabled||!settings.cloudEnabled||data.running;
      one('living-run-local').disabled=!settings.enabled||data.running;
      one('living-idea-count').textContent=data.ideas.filter(x=>x.status==='proposed').length+' новых · '+data.ideas.length+' всего';
      const board=one('living-ideas');
      board.replaceChildren();
      if(!data.ideas.length)board.append(item('p','living-note','Пока нет предложений. Они появятся по результатам наблюдений.'));
      for(const idea of data.ideas.slice(0,45)){
        const statusNames={proposed:'Ожидает решения',approved:'Одобрено',verified:'Результат подтверждён',
          rejected:'Отклонено',rolled_back:'Отменено'};
        const card=eventCard(kindNames[idea.kind]||'Наблюдение',idea.title,idea.origin==='cloud'?'Cloud.ru · предложение':'Локальная проверка');
        card.append(item('p','living-reason',idea.reason));
        const source=item('p','living-source','Основание: '+idea.evidence.join(' · '));
        card.append(source);
        if(idea.steps?.length){
          const detail=item('details','living-steps');
          detail.append(item('summary','', 'Посмотреть чек-лист ('+idea.steps.length+')'));
          const list=item('ol','');
          for(const step of idea.steps)list.append(item('li','',step));
          detail.append(list);card.append(detail);
        }
        card.append(item('small','living-status',statusNames[idea.status]||idea.status+' · '+recent(idea.createdAt)));
        if(idea.verification?.note)card.append(item('p','living-verified','Подтверждение владельца: '+idea.verification.note));
        const buttons=[];
        if(idea.status==='proposed'){
          buttons.push(['Одобрить','approve'],['Отклонить','reject']);
        }else if(idea.kind==='skill'&&idea.status==='approved'){
          buttons.push(['Подтвердить результат','verify'],['Отменить','rollback']);
        }else if(['approved','verified'].includes(idea.status)){
          buttons.push(['Откатить','rollback']);
        }
        if(buttons.length){
          const row=item('div','living-idea-actions');
          for(const [label,action] of buttons){
            const button=item('button','ghost-button',label);
            button.type='button';
            button.addEventListener('click',()=>run(async()=>{
              let note;
              if(action==='verify'){
                note=window.prompt('Как вы проверили улучшение? Укажите конкретный результат (не менее 12 символов):');
                if(note===null)return;
              }
              const body={action,...(note!==undefined?{note}: {})};
              await api('/api/living/ideas/'+encodeURIComponent(idea.id),{method:'PATCH',body});
              notify(action==='verify'?'Результат навыка подтверждён':'Решение сохранено');
              await refresh();
            }));
            row.append(button);
          }
          card.append(row);
        }
        board.append(card);
      }
      const journal=one('living-journal');
      journal.replaceChildren();
      one('living-event-count').textContent=data.journal.length+' записей';
      if(!data.journal.length)journal.append(item('p','living-note','Локальная работа пока не выполнялась.'));
      for(const event of data.journal.slice(0,40)){
        journal.append(eventCard(recent(event.at),event.message,event.kind));
      }
    }catch(e){
      one('living-header-status').textContent='Ошибка';
      one('living-last-summary').textContent='Не удалось загрузить Living Core: '+e.message;
    }finally{updating=false;}
  }
  one('living-refresh').addEventListener('click',()=>run(refresh));
  one('living-settings-form').addEventListener('submit',e=>{
    e.preventDefault();
    run(async()=>{
      const settings={
        enabled:one('living-enabled').checked,
        cloudEnabled:one('living-cloud-enabled').checked,
        shareRecentText:one('living-share-text').checked,
        idleMinutes:Number(one('living-idle').value),
        intervalMinutes:Number(one('living-interval').value),
        maxCloudCallsPerDay:Number(one('living-cloud-limit').value)
      };
      if(settings.cloudEnabled&&settings.shareRecentText){
        if(!window.confirm('Cloud.ru будет получать короткие фрагменты личной памяти при фоновом анализе. Разрешить?'))return;
      }
      const status=await api('/api/living/settings',{method:'PATCH',body:settings});
      one('living-settings-feedback').textContent=status.settings.cloudEnabled?
        'Разрешено до '+status.settings.maxCloudCallsPerDay+' обращений Cloud.ru в день.':
        'Облачный анализ отключён. Локальные проверки продолжаются.';
      await refresh();
    });
  });
  one('living-run-local').addEventListener('click',()=>run(async()=>{
    one('living-last-summary').textContent='Выполняется локальная проверка…';
    const output=await api('/api/living/run',{method:'POST',body:{cloud:false}});
    notify(output.result?.skipped||'Локальная проверка завершена');
    await refresh();
  }));
  one('living-run-cloud').addEventListener('click',()=>run(async()=>{
    if(!window.confirm('Отправить разрешённые сводные сведения в Cloud.ru для предложения улучшений? Может расходовать платные токены.'))return;
    one('living-last-summary').textContent='Cloud.ru анализирует выбранный контекст…';
    const output=await api('/api/living/run',{method:'POST',body:{cloud:true}});
    notify(output.result?.cloud?.skipped||'Анализ Cloud.ru завершён');
    await refresh();
  }));
  const poll=setInterval(()=>{
    if(!one('page-living').hidden)void refresh();
  },25000);
  // Modern tab lifecycle: do not poll while hidden, no persistent websocket or model calls.
  globalThis.TsukireiLivingUI=Object.freeze({refresh});
})();
