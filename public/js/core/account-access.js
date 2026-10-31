(function(){
  'use strict';
  window.showAccountAccessSummary=function(viewId){
    if(!['view-creator','view-mypage'].includes(viewId))return false;
    const root=document.getElementById(viewId),who=window.WebNovelsAuth?.getActor();if(!root)return false;
    const workspace=viewId==='view-creator'&&who?.author?.status==='APPROVED'&&who?.authorWorkspaceReady===true;
    const limited=!!who?.accountServiceOnly&&!workspace;
    root.classList.toggle('private-author-workspace',workspace);
    const notice=document.getElementById('authorWorkspaceNotice');if(notice)notice.hidden=!workspace;
    root.classList.toggle('account-only',limited);
    root.querySelector('.account-access-summary')?.remove();
    if(!limited)return false;
    const section=document.createElement('section');section.className='account-access-summary container section-padding';
    function text(tag,value,parent=section){const n=document.createElement(tag);n.textContent=value;parent.append(n);return n;}
    const profile=who.author||who.reader;
    const heading=text('h2',who.author?'작가 계정':'내 계정');heading.id='accountAccessTitle-'+viewId;
    section.setAttribute?.('aria-labelledby',heading.id);
    const status=text('p','로그인 완료 · 계정 서비스 연결');status.className='account-access-status';
    text('p',`${profile?.pen_name||profile?.nickname||profile?.username||'회원'}님, 로그인되었습니다.`);
    text('p',who.author?'현재 이 계정은 작품 관리 기능을 이용할 수 없습니다. 이용 범위가 열리면 작가 스튜디오에서 안내합니다.':
      '현재 이 계정은 개인 서재 기능을 이용할 수 없습니다. 공개된 작품은 홈에서 탐색할 수 있습니다.');
    const actions=document.createElement('div');actions.className='account-access-actions';section.append(actions);
    const home=text('button','작품 둘러보기',actions);home.type='button';home.className='btn btn-primary';home.onclick=()=>switchWebNovelsView('view-home');
    const logout=text('button','로그아웃',actions);logout.type='button';logout.className='btn btn-outline';logout.onclick=()=>window.handleMemberLogout();
    const links=document.createElement('nav');links.className='account-access-links';links.setAttribute?.('aria-label','계정 이용 안내');section.append(links);
    for(const [label,href]of [['회사·문의 안내','/company/'],['이용약관','/policies/terms/'],['환불정책','/policies/refund/']]){
      const link=text('a',label,links);link.href=href;
    }
    root.prepend(section);return true;
  };
})();
