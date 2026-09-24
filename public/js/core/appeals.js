// Case appeals shared by reader and author account surfaces.
(function(){
  'use strict';
  const versions=new WeakMap();
  const roots=new Set();
  const active=()=>window.WEBNOVELS_CONFIG?.adminOperationsEnabled===true;
  const actor=()=>window.WebNovelsAuth?.getActor();
  function add(parent,tag,value){const node=document.createElement(tag);node.textContent=String(value??'');parent.append(node);return node;}
  async function api(action,data){
    return window.WebNovelsAuth.api('/api/v2/appeals?action='+action,
      data?{method:'POST',body:JSON.stringify(data)}:undefined);
  }
  async function mount(root){
    if(!root||!active())return;
    roots.add(root);
    const user=actor()?.userId,seq=(versions.get(root)||0)+1;versions.set(root,seq);
    root.replaceChildren();add(root,'p','이의제기 내역을 불러오는 중입니다…');
    if(!user){root.replaceChildren();add(root,'p','로그인 후 이용할 수 있습니다.');return;}
    try{
      const [eligible,mine]=await Promise.all([api('eligible'),api('my')]);
      if(versions.get(root)!==seq||actor()?.userId!==user)return;
      root.replaceChildren();add(root,'h4','이의제기');
      if(!eligible.cases?.length)add(root,'p','새로 신청할 수 있는 사건이 없습니다.');
      for(const item of eligible.cases||[]){
        const row=add(root,'p',`${item.label} · ${item.source} · ${item.created_at}`);
        const button=add(row,'button','이의제기 신청');button.type='button';button.className='btn btn-outline btn-sm';
        button.onclick=async()=>{
          const reason=prompt('이의제기 사유 (3~500자)');if(!reason||reason.trim().length<3)return;
          button.disabled=true;
          try{await api('submit',{source:item.source,sourceId:item.sourceId,reason:reason.trim()});await mount(root);}
          catch(error){button.disabled=false;add(root,'p','신청 실패: '+(error?.code||error?.message||'요청 실패'));}
        };
      }
      add(root,'h4','내 신청');
      if(!mine.appeals?.length)add(root,'p','신청 내역이 없습니다.');
      for(const item of mine.appeals||[])
        add(root,'p',`${item.source} · ${item.status} · ${item.reason}${item.resolution_reason?' · 처리 사유: '+item.resolution_reason:''}`);
    }catch(error){if(versions.get(root)===seq&&actor()?.userId===user){root.replaceChildren();add(root,'p','이의제기를 불러오지 못했습니다. '+(error?.code||error?.message||''));}}
  }
  function reset(){for(const root of roots){versions.set(root,(versions.get(root)||0)+1);root.replaceChildren();}roots.clear();}
  window.WebNovelsAppeals=Object.freeze({active,mount,reset});
})();
