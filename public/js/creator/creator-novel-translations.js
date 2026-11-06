(function(){
  'use strict';
  const path='/api/v2/creator/novel-translations';
  const languages={en:'영어',ja:'일본어','zh-Hans':'중국어 간체'};
  const states={PROCESSING:'처리 중 · 중복 요청 차단',FAILED:'생성 실패 · 운영자 확인 필요',DRAFT:'검수 대기',APPROVED:'승인·공개'};
  function node(tag,text,classes){
    const el=document.createElement(tag);
    if(text)el.textContent=text;
    if(classes)el.className=classes;
    return el;
  }
  function mount(root,work){
    if(!root||work.content_type!=='NOVEL')return;
    const user=window.WebNovelsAuth.getActor()?.userId,workId=String(work.id);
    const live=()=>root.isConnected&&window.WebNovelsAuth.getActor()?.userId===user;
    const body=node('div'),status=node('p');status.setAttribute('role','status');
    root.append(body,status);
    const get=extra=>window.WebNovelsAuth.api(path+'?'+new URLSearchParams({workId,...extra}));
    const post=(action,data={})=>window.WebNovelsAuth.api(path,{method:'POST',body:JSON.stringify({action,workId,...data})});
    let busy=false,epoch=0,loaded=false;
    const say=text=>{if(live())status.textContent=text;};
    function button(text,action,parent,classes='btn btn-outline'){
      const b=node('button',text,classes);b.type='button';parent.append(b);
      b.onclick=async()=>{
        if(busy||!live())return;
        const controls=[...body.querySelectorAll('button:not(:disabled),select:not(:disabled)')];
        busy=true;body.setAttribute('aria-busy','true');controls.forEach(control=>{control.disabled=true;});
        try{say('처리 중입니다.');await action();}
        catch(error){say(({TRANSLATION_BUDGET_OR_PROVIDER_DISABLED:'시범 번역 예산 또는 제공자 설정을 확인해주세요.',
          TRANSLATION_REVISION_CHANGED:'검수본이 변경됐습니다. 화면을 새로 불러와 주세요.',
          TRANSLATION_SOURCE_CHANGED:'현재 발행 원문이 변경됐습니다. 화면을 새로 불러와 주세요.',
          TRANSLATION_PROVIDER_FAILED:'번역 제공자 응답을 확인해야 합니다. 운영자에게 문의해주세요.'})[error.code]||
          '번역 요청을 완료하지 못했습니다. 다시 불러온 뒤 상태를 확인해주세요.');}
        finally{busy=false;body.setAttribute('aria-busy','false');controls.forEach(control=>{control.disabled=false;});}
      };
      return b;
    }
    function select(label,options,parent){
      const wrapper=node('label',label),input=node('select',null,'form-control');
      for(const [key,text] of options){const option=node('option',text);option.value=key;input.append(option);}
      wrapper.append(input);parent.append(wrapper);return input;
    }
    async function load(){
      const seq=++epoch,state=await get();
      if(!live()||seq!==epoch)return;
      loaded=true;body.replaceChildren();
      if(!state.selected){body.append(node('p','시범 번역 대상으로 지정된 무료 웹소설에서 사용할 수 있습니다.'));say('');return;}
      if(!state.consented){
        body.append(node('p','동의하면 선택한 공개 회차의 한국어 제목과 본문을 Google Cloud Translation으로 보내 번역 초안을 만듭니다. 작가 검수와 승인을 마친 번역만 공개됩니다.'));
        const label=node('label'),agree=node('input');agree.type='checkbox';
        label.append(agree,document.createTextNode(' 이 작품의 번역 권한을 보유하고 있으며 공개 원문의 외부 번역 처리에 동의합니다.'));
        body.append(label);
        button('번역 동의 저장',async()=>{if(!agree.checked){say('동의 항목을 선택해주세요.');return;}
          await post('consent',{accepted:true,version:state.consentVersion});await load();},body);
        say('');return;
      }
      body.append(node('p','번역 동의 완료 · '+(state.glossaryVersion?'용어집 버전 '+state.glossaryVersion:'기본 번역 용어 사용')));
      button('번역 동의 철회',async()=>{if(!window.confirm('동의를 철회하면 공개된 번역도 숨겨집니다. 계속하시겠습니까?')){say('');return;}
        await post('withdraw');await load();},body);
      if(!state.episodes?.length){body.append(node('p','공개된 무료 회차가 없습니다.'));say('');return;}
      const episode=select('회차',state.episodes.map(ep=>[ep.id,ep.number+'화 · '+ep.title]),body);
      const locale=select('번역 언어',Object.entries(languages),body);
      const editor=node('section');body.append(editor);
      async function detail(){
        const revision=++epoch,selection={episodeId:episode.value,locale:locale.value};
        const data=await get(selection);
        if(!live()||revision!==epoch)return;
        editor.replaceChildren();say('');
        const job=data.job;
        if(!job){
          if(state.generationEnabled)button('자동 번역 초안 만들기',async()=>{await post('generate',selection);await detail();},editor,'btn btn-primary');
          else editor.append(node('p','운영자가 제공자와 시범 예산을 준비하면 초안을 만들 수 있습니다.'));
          return;
        }
        editor.append(node('p',states[job.state]||'상태 확인 필요'));
        if(!Array.isArray(job.segments)||!Array.isArray(data.source)||job.segments.length!==data.source.length)return;
        const inputs=data.source.map((original,index)=>{
          const group=node('fieldset',null,'studio-settings-required');
          group.append(node('legend',index===0?'회차 제목':'텍스트 '+index),node('p',original));
          const label=node('label','번역문'),input=node('textarea',null,'form-control');
          input.rows=3;input.maxLength=8000;input.value=job.segments[index];input.readOnly=job.state!=='DRAFT';
          label.append(input);group.append(label);editor.append(group);return input;
        });
        if(job.state!=='DRAFT')return;
        const edit=()=>({...selection,versionId:data.versionId,revision:job.revision,segments:inputs.map(input=>input.value.trim())});
        button('검수 초안 저장',async()=>{await post('save',edit());await detail();say('검수 초안을 저장했습니다.');},editor);
        const label=node('label'),reviewed=node('input');reviewed.type='checkbox';
        label.append(reviewed,document.createTextNode(' 원문과 번역을 대조하여 공개할 내용을 검수했습니다.'));editor.append(label);
        button('번역 승인·공개',async()=>{if(!reviewed.checked){say('검수 확인을 선택해주세요.');return;}
          await post('approve',{...edit(),reviewed:true});await detail();say('번역을 공개했습니다.');},editor,'btn btn-primary');
      }
      const changed=()=>{if(busy)return;editor.replaceChildren();detail().catch(()=>say('회차 번역을 불러오지 못했습니다.'));};
      episode.onchange=locale.onchange=changed;
      await detail();
    }
    root.addEventListener('toggle',()=>{if(root.open&&!loaded)load().catch(()=>say('시범 번역 상태를 불러오지 못했습니다.'));});
  }
  window.CreatorNovelTranslations=Object.freeze({mount});
})();
