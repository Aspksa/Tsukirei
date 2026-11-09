/* Eternal Soul / Hyper Mind v1.2. Every display value comes from actual local records. */
(() => {
  'use strict';
  const one=id=>document.getElementById(id);
  const node=(tag,css,content)=>{
    const element=document.createElement(tag);
    if(css)element.className=css;
    if(content!==undefined)element.textContent=String(content);
    return element;
  };
  const date=timestamp=>{
    const ms=Date.parse(timestamp);
    return Number.isFinite(ms)?new Date(ms).toLocaleString('ru-RU'):'без даты';
  };
  function card(title,description='',detail=''){
    const result=node('article','sm-record');
    result.append(node('strong','sm-record-title',title));
    if(description)result.append(node('p','',description));
    if(detail)result.append(node('small','',detail));
    return result;
  }
  const empty=(id,message)=>one(id).replaceChildren(node('p','sm-note',message));
  function actions(result,items){
    const row=node('div','sm-actions');
    for(const [label,action] of items){
      const button=node('button','ghost-button',label);
      button.type='button';
      button.addEventListener('click',()=>run(async()=>{
        button.disabled=true;
        try{await action();await refresh();}
        finally{button.disabled=false;}
      }));
      row.append(button);
    }
    result.append(row);
  }
  let running=false;
  async function refresh(){
    if(running)return;
    running=true;
    try{
      const data=await api('/api/supermind');
      one('sm-state').textContent=data.metrics.lastScanAt?'Обновлено '+date(data.metrics.lastScanAt):'Ожидает синхронизации';
      one('sm-events').textContent=data.metrics.lifeEvents;
      one('sm-revisions').textContent=data.metrics.identityRevisions;
      one('sm-inquiries').textContent=data.metrics.inquiries;
      one('sm-wisdom-count').textContent=data.metrics.wisdom;
      one('sm-expression').textContent=data.settings.showExpression?data.expression.label:'Выражение выключено';
      one('sm-sigil').dataset.mode=data.settings.showExpression?data.expression.mode:'quiet';
      one('sm-narrative').textContent=data.narrative;
      const values=one('sm-values');values.replaceChildren();
      for(const value of data.values)values.append(card(value.name,value.meaning));
      const life=one('sm-life');life.replaceChildren();
      if(!data.life.length)empty('sm-life','Совместная история будет собрана из реальных диалогов и достижений.');
      for(const event of data.life.slice(0,35)){
        life.append(card(event.title,event.description,date(event.at)+' · '+event.sourceId));
      }
      const world=one('sm-workspace');world.replaceChildren();
      const sections=[
        ['Текущие цели',data.innerWorld.goals.map(g=>g.title)],
        ['Незавершённые дела',data.innerWorld.unfinishedTasks.map(t=>t.title)],
        ['Подтверждённые факты',data.innerWorld.facts.map(f=>f.subject+' — '+f.field+': '+f.value)],
        ['Интересы и предпочтения',data.innerWorld.interests],
        ['Проверенные навыки',data.innerWorld.skills.map(x=>x.title)]
      ];
      for(const [heading,entries] of sections){
        const cell=node('div','sm-workspace-cell');
        cell.append(node('strong','',heading),node('p','',entries.length?entries.slice(0,6).join(' · '):'Пока нет записей'));
        world.append(cell);
      }
      const inner=one('sm-inner');inner.replaceChildren();
      inner.append(card('Обращение и стиль',
        data.innerWorld.soulProfile.address+' · '+data.innerWorld.soulProfile.tone));
      inner.append(card('Открытые вопросы',String(data.innerWorld.openQuestions.length),
        'Чего ещё не удалось подтвердить'));
      for(const gap of data.innerWorld.openQuestions.slice(0,7)){
        inner.append(card(gap.question,'Повторений: '+gap.frequency,'Источник: '+gap.id));
      }
      const curriculum=one('sm-curriculum');curriculum.replaceChildren();
      if(!data.curriculum.length)empty('sm-curriculum','Новых пробелов пока нет. Сначала задавай вопросы через RAG.');
      for(const item of data.curriculum.slice(0,10))
        curriculum.append(card('Приоритет '+item.priority+' · '+item.topic,item.nextStep));
      const governor=one('sm-governor');governor.replaceChildren();
      governor.append(card('Cloud.ru',
        data.governor.cloudAnalysis?'Фоновый анализ разрешён':'Фоновый анализ выключен',
        'Вызовов Living Core сегодня: '+data.governor.cloudBudget.calls+'/'+data.governor.cloudBudget.limit));
      governor.append(card('Контроль исполнения',
        'Самовольное выполнение кода отключено · до '+data.governor.maxStrategies+' стратегий',
        'Cloud.ru не вызывается этим экраном'));
      if(!one('sm-settings-form').contains(document.activeElement)){
        one('sm-enabled').checked=data.settings.enabled;
        one('sm-expression-enabled').checked=data.settings.showExpression;
        one('sm-depth').value=data.settings.reviewLimit;
      }
      const investigations=one('sm-inquiry-list');investigations.replaceChildren();
      if(!data.inquiries.length)empty('sm-inquiry-list','Исследований пока нет. Добавь вопрос для разбора.');
      for(const inquiry of data.inquiries.slice(0,20)){
        const result=card(inquiry.question,
          inquiry.origin==='user'?'Гипотезы введены владельцем':'Варианты автоматически сформированы по правилам',
          date(inquiry.createdAt)+' · '+inquiry.status);
        for(const hypothesis of inquiry.hypotheses){
          const sub=node('div','sm-hypothesis');
          sub.append(node('strong','',hypothesis.claim));
          sub.append(node('p','','Проверка: '+hypothesis.test));
          sub.append(node('p','','Ожидаемый признак: '+hypothesis.expected));
          sub.append(node('small','',hypothesis.outcome==='untested'?'Не проверено':
            ({supports:'Поддержано',refutes:'Опровергнуто',inconclusive:'Недостаточно данных'}[hypothesis.outcome]||hypothesis.outcome)+
            ' · '+hypothesis.note));
          if(hypothesis.outcome==='untested'){
            actions(sub,[['Записать проверку',async()=>{
              const note=window.prompt('Какой тест проведён и каков наблюдаемый результат? (не менее 15 символов)');
              if(note===null)return;
              const outcome=window.prompt('Итог: supports (поддерживает), refutes (опровергает), inconclusive (неясно)', 'inconclusive');
              if(outcome===null)return;
              await api('/api/supermind/inquiries/'+inquiry.id+'/hypotheses/'+hypothesis.id,{
                method:'PATCH',body:{result:outcome,note}
              });
            }]]);
          }else if(hypothesis.outcome==='supports'){
            actions(sub,[['Сохранить принцип',async()=>{
              const principle=window.prompt('Какой полезный принцип подтверждается этим тестом?');
              if(principle===null)return;
              await api('/api/supermind/wisdom',{method:'POST',body:{
                inquiryId:inquiry.id,hypothesisId:hypothesis.id,principle}});
            }]]);
          }
          result.append(sub);
        }
        investigations.append(result);
      }
      const wisdom=one('sm-wisdom');wisdom.replaceChildren();
      if(!data.wisdom.length)empty('sm-wisdom','Принципы появятся после твоего подтверждения успешного эксперимента.');
      for(const principle of data.wisdom.slice(0,30)){
        const result=card(principle.principle,
          'Результат проверки: '+principle.source.testNote,
          principle.status==='approved'?'Подтверждено владельцем':'Отменено');
        if(principle.status==='approved')actions(result,[['Отменить',()=>api(
          '/api/supermind/wisdom/'+principle.id,{method:'PATCH',body:{action:'revoke'}})]]);
        wisdom.append(result);
      }
      const scenarios=one('sm-strategies');scenarios.replaceChildren();
      if(!data.scenarios.length)empty('sm-strategies','Сравни два варианта для появления результатов.');
      for(const scenario of data.scenarios.slice(0,10)){
        const cardScenario=card(scenario.question,scenario.notes,date(scenario.createdAt));
        for(const option of scenario.options)cardScenario.append(card(option.name,'Оценка: '+option.score+'/100 · '+option.assumptions,
          'Качество '+option.quality+' · усилия '+option.effort+' · цена '+option.cost+' · риск '+option.risk));
        cardScenario.append(node('p','sm-note','Если сильнее учитывать риск: лучшим становится «'+scenario.alternativeWinner+'».'));
        scenarios.append(cardScenario);
      }
    }catch(error){
      one('sm-state').textContent='Ошибка';
      one('sm-narrative').textContent='Не удалось загрузить ядро: '+error.message;
    }finally{running=false;}
  }
  one('sm-sync').addEventListener('click',()=>run(async()=>{
    await api('/api/supermind/scan',{method:'POST',body:{}});
    await refresh();
    notify('Автобиография обновлена из локального архива');
  }));
  one('sm-intent-form').addEventListener('submit',event=>{
    event.preventDefault();run(async()=>{
      const result=await api('/api/supermind/intent',{method:'POST',body:{text:one('sm-intent-input').value}});
      one('sm-intent-result').textContent=result.hint+' · Уверенность: '+result.confidence+
        (result.ambiguous?' · может потребоваться уточнение':'');
    });
  });
  one('sm-inquiry-form').addEventListener('submit',event=>{
    event.preventDefault();run(async()=>{
      await api('/api/supermind/inquiries',{method:'POST',body:{question:one('sm-question').value}});
      one('sm-inquiry-form').reset();await refresh();notify('План исследования создан без внешних вызовов');
    });
  });
  function option(prefix){
    const value=type=>Number(one('sm-opt-'+prefix+'-'+type).value);
    return{name:one('sm-opt-'+prefix+'-name').value.trim(),
      quality:value('quality'),effort:value('effort'),cost:value('cost'),risk:value('risk'),
      assumptions:one('sm-opt-'+prefix+'-assumption').value.trim()};
  }
  one('sm-strategy-form').addEventListener('submit',event=>{
    event.preventDefault();run(async()=>{
      await api('/api/supermind/scenarios',{method:'POST',body:{
        question:one('sm-strategy-question').value.trim(),options:[option('a'),option('b')]
      }});
      await refresh();notify('Варианты сравнены по введённым оценкам');
    });
  });
  one('sm-settings-form').addEventListener('submit',event=>{
    event.preventDefault();run(async()=>{
      await api('/api/supermind/settings',{method:'PATCH',body:{
        enabled:one('sm-enabled').checked,
        showExpression:one('sm-expression-enabled').checked,
        reviewLimit:Number(one('sm-depth').value)
      }});
      await refresh();notify('Ограничения сверхразума сохранены локально');
    });
  });
  globalThis.TsukireiSupermindUI=Object.freeze({refresh});
})();
