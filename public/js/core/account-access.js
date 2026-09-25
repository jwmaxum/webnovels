(function(){
  'use strict';
  window.showAccountAccessSummary=function(viewId){
    if(!['view-creator','view-mypage'].includes(viewId))return false;
    const root=document.getElementById(viewId),who=window.WebNovelsAuth?.getActor();if(!root)return false;
    const limited=!!who?.accountServiceOnly;
    root.classList.toggle('account-only',limited);
    root.querySelector('.account-access-summary')?.remove();
    if(!limited)return false;
    const section=document.createElement('section');section.className='account-access-summary container section-padding';
    function text(tag,value){const n=document.createElement(tag);n.textContent=value;section.append(n);return n;}
    const profile=who.author||who.reader;
    text('h2',who.author?'작가 계정':'내 계정');
    text('p',`${profile?.pen_name||profile?.nickname||profile?.username||''}님, 로그인되었습니다.`);
    text('p','작품 관리와 개인 서재 기능을 준비 중입니다. 이용 가능한 기능은 순차적으로 안내하겠습니다.');
    const home=text('button','홈으로');home.className='btn btn-primary';home.onclick=()=>switchWebNovelsView('view-home');
    const logout=text('button','로그아웃');logout.className='btn btn-outline';logout.onclick=()=>window.handleMemberLogout();
    root.prepend(section);return true;
  };
})();
