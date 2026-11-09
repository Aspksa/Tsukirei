/* Soul Engine page: all numbers and events come from the local server. */
(() => {
  'use strict';
  const one=id=>document.getElementById(id);
  let loading=false;
  function dom(tag,className,text){
    const n=document.createElement(tag);
    if(className)n.className=className;
    if(text!==undefined)n.textContent=String(text);
    return n;
  }
  function empty(target,message){
    target.replaceChildren(dom('p','soul-hint',message));
  }
  function entry(title,description,meta){
    const card=dom('article','soul-item');
    const body=dom('div','soul-item-main');
    body.append(dom('strong','',title));
    if(description)body.append(dom('p','',description));
    if(meta)body.append(dom('small','',meta));
    card.append(body);
    return card;
  }
  function actions(card,items){
    const box=dom('div','soul-item-actions');
    for(const [label,click] of items){
      const button=dom('button','',label);
      button.type='button';
      button.addEventListener('click',()=>run(async()=>{
        button.disabled=true;
        try {await click();await refresh();}
        finally {button.disabled=false;}
      }));
      box.append(button);
    }
    card.append(box);
  }
  function date(value){
    const n=Date.parse(value);
    return Number.isFinite(n)?new Date(n).toLocaleDateString('ru-RU'):'' ;
  }
  function show(data){
    const s=data.settings,m=data.metrics;
    one('soul-state').textContent='Локально · '+s.tone;
    one('soul-chat-count').textContent=String(m.chatsObserved);
    one('soul-preference-count').textContent=String(m.confirmedPreferences);
    one('soul-lessons-count').textContent=String(m.lessons);
    one('soul-initiative-count').textContent=String(m.proposals);
    one('soul-task-count').textContent=String(m.completedTasks||0);
    one('soul-journal-total').textContent=data.journal.length+' событий';
    // Preserve edited input while the form has keyboard focus.
    if(!one('soul-settings-form').contains(document.activeElement)){
      one('soul-address').value=s.address;
      one('soul-tone').value=s.tone;
      one('soul-context').checked=s.personalContext;
      one('soul-reflect').checked=s.reflectionsEnabled;
      one('soul-initiative').checked=s.initiativeEnabled;
    }
    const prefs=one('soul-preferences');
    prefs.replaceChildren();
    if(!data.preferences.length)empty(prefs,'Подтверждённых предпочтений пока нет.');
    for(const item of data.preferences){
      const card=entry(item.text,item.status==='suggested'?'Ожидает подтверждения':'Подтверждено',
        date(item.createdAt));
      const buttons=[];
      if(item.status==='suggested')buttons.push(['Подтвердить',()=>api('/api/soul/preferences/'+encodeURIComponent(item.id),{
        method:'PATCH',body:{status:'confirmed'}
      })]);
      buttons.push(['Удалить',()=>api('/api/soul/preferences/'+encodeURIComponent(item.id),{method:'DELETE'})]);
      actions(card,buttons);
      prefs.append(card);
    }
    const lessons=one('soul-lessons');lessons.replaceChildren();
    if(!data.lessons.length)empty(lessons,'Нет зафиксированных замечаний.');
    for(const item of data.lessons.slice(0,25)){
      const card=entry(item.text,'Отзыв владельца · '+item.source,date(item.createdAt));
      actions(card,[['Удалить',()=>api('/api/soul/lessons/'+encodeURIComponent(item.id),{method:'DELETE'})]]);
      lessons.append(card);
    }
    const journal=one('soul-journal');journal.replaceChildren();
    if(!data.journal.length)empty(journal,'Дневник появится после первого обмена и обратной связи.');
    const types={preference:'Предпочтение',feedback:'Отзыв',reflection:'Урок',
      initiative:'Инициатива',setting:'Настройка',task:'Выполненная задача'};
    for(const item of data.journal.slice(0,50)){
      journal.append(entry(types[item.type]||'Событие',item.text,date(item.at)));
    }
    const initiatives=one('soul-initiatives');initiatives.replaceChildren();
    if(!data.initiatives.length)empty(initiatives,'Повторяющихся проблем пока не найдено.');
    for(const item of data.initiatives){
      const card=entry(item.title,item.reason,
        date(item.at)+' · '+({new:'Ожидает решения',accepted:'Одобрена',dismissed:'Отклонена'}[item.status]||''));
      if(item.status==='new'){
        actions(card,[
          ['Одобрить',()=>api('/api/soul/initiatives/'+encodeURIComponent(item.id),
            {method:'PATCH',body:{status:'accepted'}})],
          ['Отклонить',()=>api('/api/soul/initiatives/'+encodeURIComponent(item.id),
            {method:'PATCH',body:{status:'dismissed'}})]
        ]);
      }
      initiatives.append(card);
    }
  }
  async function refresh(){
    if(loading)return;
    loading=true;
    try{show(await api('/api/soul'));}
    catch(error){
      one('soul-state').textContent='Ошибка';
      notify('Личность: '+error.message,true);
    }finally{loading=false;}
  }
  async function feedback(messageId,rating){
    let note='';
    if(rating==='negative'){
      const value=window.prompt('Что Цукирэй должна исправить в следующем ответе? (необязательно)', '');
      if(value===null)return;
      note=value.trim().slice(0,240);
    }
    await run(async()=>{
      await api('/api/soul/feedback',{method:'POST',body:{messageId,rating,note}});
      notify(note?'Цукирэй сохранила замечание':'Оценка ответа сохранена');
      await refresh();
    });
  }
  one('soul-settings-form').addEventListener('submit',event=>{
    event.preventDefault();
    run(async()=>{
      const settings={
        address:one('soul-address').value.trim(),tone:one('soul-tone').value,
        personalContext:one('soul-context').checked,
        reflectionsEnabled:one('soul-reflect').checked,
        initiativeEnabled:one('soul-initiative').checked
      };
      await api('/api/soul/settings',{method:'PATCH',body:settings});
      one('soul-settings-feedback').textContent='Настройки характера сохранены на локальном диске.';
      await refresh();
    });
  });
  one('soul-preference-form').addEventListener('submit',event=>{
    event.preventDefault();
    run(async()=>{
      await api('/api/soul/preferences',{method:'POST',body:{
        text:one('soul-preference-input').value.trim()
      }});
      one('soul-preference-form').reset();
      await refresh();
      notify('Цукирэй запомнила предпочтение');
    });
  });
  one('soul-check').addEventListener('click',()=>{
    run(async()=>{
      const result=await api('/api/soul/reflect',{method:'POST',body:{}});
      show(result.soul);
      notify(result.created?'Найдены предложения на основе повторений':'Новых повторяющихся проблем нет');
    });
  });
  globalThis.TsukireiSoulUI=Object.freeze({refresh,feedback});
})();
