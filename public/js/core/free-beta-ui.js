// Presentation only: the server independently enforces free-beta feature restrictions.
(function () {
 'use strict';
 const blocked='[data-beta-unavailable], [onclick*="openWalletModal"], [onclick*="SupportCreator"], [onclick*="handlePassAdultVerify"], [onclick*="toggleAdultContentMode"], #btnStartPassVerify, #btnWatchAdSubmit, #btnUsePointUnlock, #btnSupportSubmit';
 function element(tag,text,className){const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;}
 function help(form){
  if(!form||form.querySelector('[data-beta-email-help]'))return;
  const details=element('details',null,'free-beta-email-help');details.dataset.betaEmailHelp='true';
  details.appendChild(element('summary','이메일 확인 메일이 오지 않나요?'));
  details.appendChild(element('p','입력한 이메일 주소와 스팸함을 확인해주세요. 발송이 지연되면 잠시 기다린 뒤 확인 링크를 열어주세요. 이메일 확인 후 로그인하여 가입 마무리를 진행할 수 있습니다.'));
  const p=element('p','계속 메일을 받지 못하거나 링크가 만료되면 '),link=element('a','운영자에게 문의');
  link.href='mailto:bazier.stage@gmail.com';p.appendChild(link);p.appendChild(document.createTextNode('해주세요. 문의에 비밀번호나 인증 코드를 포함하지 마세요.'));details.appendChild(p);form.appendChild(details);
 }
 function init(){
  if(window.WEBNOVELS_CONFIG?.freeBetaEnabled!==true)return;
  document.documentElement.dataset.freeBeta='true';
  if(!document.getElementById('freeBetaNotice')){
   const host=document.querySelector('.webnovels-body')||document.getElementById('mainContentWrapper');
   if(host){const notice=element('aside',null,'free-beta-notice');notice.id='freeBetaNotice';notice.setAttribute('aria-label','무료 베타 안내');
    notice.appendChild(element('strong','무료 베타','free-beta-badge'));
    notice.appendChild(element('p','웹소설·웹툰을 무료로 연재하고 읽어보세요. 결제·유료 후원·PASS 인증은 아직 제공하지 않습니다.'));
    const link=element('a','문의·오류 제보');link.href='mailto:bazier.stage@gmail.com';notice.appendChild(link);host.prepend(notice);}
  }
  const intro=document.querySelector('#authForm-signup-author > p');
  if(intro)intro.textContent='무료 베타에서는 이메일 확인과 저작권 동의 후 필명으로 가입합니다. PASS 실명 인증은 추후 제공하며, 현재 본인확인 완료로 표시하지 않습니다. 별도 이메일 ID·필명 가입과 계정별 웹소설·웹툰 연재가 가능합니다.';
  for(const id of ['authForm-login','authForm-signup','authForm-signup-author'])help(document.getElementById(id));
  document.querySelectorAll('[data-creator-tab="profile"]').forEach(button=>{button.textContent='내 정보';});
 }
 document.addEventListener('click',event=>{
  if(window.WEBNOVELS_CONFIG?.freeBetaEnabled!==true||!event.target?.closest?.(blocked))return;
  event.preventDefault();event.stopImmediatePropagation();window.showToast?.('무료 베타에서는 결제·후원·PASS 인증을 제공하지 않습니다.');
 },true);
 window.FreeBetaUI={init};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
