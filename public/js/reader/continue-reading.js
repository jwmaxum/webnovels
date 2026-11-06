// Continue cards use account-bound history and verify the actual published chapter.
(function() {
  'use strict';
  let generation=0, selected=null;
  const user=()=>window.WebNovelsAuth?.getActor()?.userId||null;
  const t = (source, params = {}) => window.ReaderI18n?.t(source, params) ?? source.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '');
  function localized(id,label,attribute) {
    const el = document.getElementById(id);
    if (!el) return;
    const render = typeof label === 'function' ? label : () => t(label);
    if (window.ReaderFeatureCopy) window.ReaderFeatureCopy.bind(el, render, attribute);
    else if (attribute) el.setAttribute(attribute, render());
    else el.textContent = render();
  }
  function reset(){generation++;selected=null;const section=document.getElementById('sectionContinueReading');if(section)section.style.display='none';}
  async function render() {
    const section=document.getElementById('sectionContinueReading');if(!section)return;
    const ticket=++generation,account=user(),valid=()=>ticket===generation&&account===user();
    selected=null;section.style.display='none';
    const card=document.getElementById('continueReadingCardHome');
    card?.setAttribute('aria-busy','true');
    try {
      let history;
      if(window.ReaderHub?.active()){
        if(!window.WebNovelsAuth?.getActor()?.reader)return;
        history=(await window.ReaderHub.activity()).readingHistory||[];
      }else{
        if(!localStorage.getItem('webnovels_user'))return;
        history=JSON.parse(localStorage.getItem('webnovels_reading_history')||'[]');
      }
      if(!valid())return;
      const entry=await window.ReaderLibrary.latest(history,valid);if(!valid()||!entry)return;
      const {work,item}=entry,progress=Math.max(0,Math.min(100,Math.round(Number(item.progress)||0)));
      document.getElementById('continueCardCover').src=getWorkCover(work);
      const copy = () => window.ReaderI18n?.work(work) || work;
      localized('continueCardTitle',() => copy().title);
      localized('continueCardTitle',() => copy().titleLanguage || work.originalLanguage || 'ko','lang');
      localized('continueCardMeta',() => t('{number}화 이어보기 · {genre}', {
        number:item.episodeNumber,genre:(Array.isArray(work.genre)?work.genre:String(work.genre||'').split(',')).map(item=>t(item.trim())).join(', ')
      }));
      localized('continueCardPct',() => t('현재 회차 {progress}%',{progress}));
      document.getElementById('continueCardFill').style.width=`${progress}%`;
      selected={workId:work.id,episodeNumber:item.episodeNumber,account};
      card.onclick=()=>{if(valid())window.openReaderDirect(work.id,item.episodeNumber);};
      card.setAttribute('role','button');card.tabIndex=0;
      card.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();card.onclick();}};
      section.style.display='';
    }catch(error){
      if(!valid())return;
      localized('continueCardTitle','이어서 읽을 회차를 확인하지 못했습니다.');
      localized('continueCardTitle','','lang');
      localized('continueCardMeta','연결 상태를 확인한 뒤 다시 시도해주세요.');
      localized('continueCardPct','다시 시도');
      document.getElementById('continueCardFill').style.width='0%';
      document.getElementById('continueCardCover').removeAttribute('src');
      card.onclick=render;card.setAttribute('role','button');card.tabIndex=0;
      card.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();card.onclick();}};
      section.style.display='';
    }finally{if(valid())card?.setAttribute('aria-busy','false');}
  }
  window.ContinueReading=Object.freeze({reset,render,async open(){
    const account=user();
    if(!selected||selected.account!==account)await render();
    if(account!==user())return;
    if(selected&&selected.account===account)return window.openReaderDirect(selected.workId,selected.episodeNumber);
    if(document.getElementById('sectionContinueReading')?.style.display==='none')window.switchWebNovelsView?.('view-mypage');
  }});
  window.renderContinueReadingHome=render;
  window.addEventListener?.('reader:localechange', () => {
    if (window.currentActiveView === 'view-home') void render();
  });
})();
