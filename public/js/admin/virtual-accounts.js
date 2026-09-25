(function(){
  'use strict';
  let turn=0,kind='author',showDeleted=false;
  const actor=()=>window.WebNovelsAuth?.getActor();
  const errorText=e=>({CONFLICT:'다른 작업에서 변경되었습니다. 목록을 새로고침해 주세요.',AUTH_SYNC_REQUIRED:'로그인 차단 상태를 다시 동기화해 주세요.',ADMIN_FORBIDDEN:'최고 관리자 권한이 필요합니다.',INVALID_PROFILE:'표시 이름은 2~40자, 소개는 2,000자 이내로 입력해 주세요.'}[e?.code]||window.WebNovelsAuth.message(e));
  function el(parent,tag,text,cls){const node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;parent.append(node);return node;}
  function button(parent,label,action){const b=el(parent,'button',label,'btn btn-outline btn-sm');b.type='button';b.onclick=action;return b;}
  async function api(action,data){const owner=actor()?.userId;const result=await window.WebNovelsAuth.api('/api/v2/admin/virtual-accounts?action='+action,
    data?{method:'POST',body:JSON.stringify(data)}:undefined);if(actor()?.userId!==owner)throw Error('세션이 변경되었습니다.');return result;}
  async function render(root){
    const seq=++turn,owner=actor()?.userId;root.replaceChildren();
    if(actor()?.admin?.role!=='SUPER_ADMIN'){el(root,'p','최고 관리자만 가상 계정을 관리할 수 있습니다.');return;}
    el(root,'h3','가상 작가·독자 관리');
    const notice=el(root,'p','계정 목록을 불러오는 중입니다…');notice.setAttribute('role','status');
    try{
      const result=await api('list');if(seq!==turn||actor()?.userId!==owner)return;
      notice.textContent='표시 이름·소개를 수정하고 계정을 정지하거나 삭제할 수 있습니다. 삭제한 계정은 로그인할 수 없으며, 작품과 원고는 보존됩니다.';
      const filters=el(root,'div',null,'va-filters');
      button(filters,'작가',()=>{kind='author';render(root);});button(filters,'독자',()=>{kind='reader';render(root);});
      button(filters,showDeleted?'사용 중 계정 보기':'삭제한 계정 보기',()=>{showDeleted=!showDeleted;render(root);});
      button(filters,'새로고침',()=>render(root));
      button(filters,'변경 이력',async()=>{
        const historyTurn=++turn;root.replaceChildren();el(root,'h3','가상 계정 변경 이력');button(root,'목록으로',()=>render(root));
        try{const history=await api('audit');if(historyTurn!==turn)return;
          if(!history.events.length)el(root,'p','변경 이력이 없습니다.');
          for(const event of history.events){const card=el(root,'article',null,'co-panel');
            const action={update:'프로필 수정',delete:'계정 삭제',restore:'계정 복구',suspend:'계정 정지'}[event.action]||event.action;
            el(card,'p',`${event.created_at} · ${event.kind==='author'?'작가':'독자'} #${event.profile_id} · ${action}`);el(card,'p',event.reason);}
        }catch(e){if(historyTurn===turn)el(root,'p',errorText(e));}
      });
      const search=el(root,'input');search.type='search';search.placeholder='이메일 또는 표시 이름 검색';search.setAttribute('aria-label','가상 계정 검색');search.className='form-input';
      const cards=el(root,'div');
      function draw(){
        cards.replaceChildren();const q=search.value.trim().toLowerCase();
        const accounts=result.accounts.filter(a=>a.kind===kind&&Boolean(a.deletedAt)===showDeleted&&`${a.email} ${a.displayName}`.toLowerCase().includes(q));
        el(cards,'p',`${accounts.length}개 계정`);
        for(const item of accounts){
          const card=el(cards,'article',null,'co-panel va-account');el(card,'h4',item.displayName);el(card,'p',item.email);
          el(card,'p',`${item.deletedAt?'삭제됨':item.status==='SUSPENDED'?'정지됨':'사용 중'}${item.kind==='author'?` · 작품 ${item.works}개`:''}`);
          const feedback=el(card,'p');feedback.setAttribute('role','status');
          const form=el(card,'form');
          const nameLabel=el(form,'label',item.kind==='author'?'필명':'별명');const name=el(nameLabel,'input');name.value=item.displayName||'';name.minLength=2;name.maxLength=40;name.required=true;name.className='form-input';
          let bio;
          if(item.kind==='author'){const label=el(form,'label','소개');bio=el(label,'textarea');bio.value=item.bio||'';bio.maxLength=2000;bio.className='form-input';}
          const reasonLabel=el(form,'label','변경 사유');const reason=el(reasonLabel,'input');reason.required=true;reason.minLength=3;reason.maxLength=500;reason.className='form-input';
          const controls=el(form,'div',null,'va-filters');
          async function change(action){
            if(action!=='sync'&&reason.value.trim().length<3){feedback.textContent='변경 사유를 3자 이상 입력해 주세요.';reason.focus();return;}
            if(action==='delete'&&!confirm(`${item.email} 계정을 삭제하시겠습니까? 로그인은 차단되고 작품·원고는 보존됩니다.`))return;
            for(const b of controls.querySelectorAll('button'))b.disabled=true;
            try{await api(action,{kind:item.kind,id:item.id,revision:item.revision,reason:reason.value.trim(),
              ...(action==='update'?{displayName:name.value.trim(),bio:bio?.value||''}:{})});if(seq===turn)await render(root);}
            catch(e){if(seq!==turn)return;feedback.textContent=errorText(e);button(feedback,'목록 새로고침',()=>render(root));
              for(const b of controls.querySelectorAll('button'))b.disabled=false;}
          }
          if(item.authSyncPending){el(card,'p','로그인 차단 상태의 동기화가 필요합니다.');button(controls,'인증 상태 재동기화',()=>change('sync'));}
          else if(item.deletedAt)button(controls,'계정 복구',()=>change('restore'));
          else{
            const save=button(controls,'변경 저장',null);save.type='submit';
            button(controls,item.status==='SUSPENDED'?'정지 해제':'계정 정지',()=>change(item.status==='SUSPENDED'?'restore':'suspend'));
            button(controls,'계정 삭제',()=>change('delete'));
          }
          form.onsubmit=e=>{e.preventDefault();if(!item.deletedAt&&!item.authSyncPending)change('update');};
          if(item.deletedAt||item.authSyncPending){name.disabled=true;if(bio)bio.disabled=true;}
        }
      }
      search.oninput=draw;draw();
    }catch(e){if(seq===turn)notice.textContent=errorText(e);}
  }
  window.VirtualAccounts=Object.freeze({render,reset(){turn++;}});
})();
