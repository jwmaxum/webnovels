// Continue cards use account-bound history and verify the actual published chapter.
(function() {
  'use strict';
  let generation=0, selected=null;
  const user=()=>window.WebNovelsAuth?.getActor()?.userId||null;
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
      document.getElementById('continueCardTitle').textContent=work.title;
      document.getElementById('continueCardMeta').textContent=`${item.episodeNumber}화 이어보기 · ${Array.isArray(work.genre)?work.genre.join(', '):work.genre||''}`;
      document.getElementById('continueCardPct').textContent=`현재 회차 ${progress}%`;
      document.getElementById('continueCardFill').style.width=`${progress}%`;
      selected={workId:work.id,episodeNumber:item.episodeNumber,account};
      card.onclick=()=>{if(valid())window.openReaderDirect(work.id,item.episodeNumber);};
      card.setAttribute('role','button');card.tabIndex=0;
      card.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();card.onclick();}};
      section.style.display='';
    }catch(error){
      if(!valid())return;
      document.getElementById('continueCardTitle').textContent='이어서 읽을 회차를 확인하지 못했습니다.';
      document.getElementById('continueCardMeta').textContent='연결 상태를 확인한 뒤 다시 시도해주세요.';
      document.getElementById('continueCardPct').textContent='다시 시도';
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
})();
