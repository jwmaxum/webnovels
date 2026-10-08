// Optional author settings. Existing work creation/draft/publication contracts remain canonical.
(function () {
  'use strict';
  let epoch=0, active=null;
  const hosts={'www.munpia.com':'문피아','novel.munpia.com':'문피아','novel.naver.com':'네이버','comic.naver.com':'네이버',
    'page.kakao.com':'카카오','webtoon.kakao.com':'카카오','www.joara.com':'조아라','www.lezhin.com':'레진코믹스'};
  const errors={DISTRIBUTION_CONFLICT:'다른 화면에서 연재 방식을 수정했습니다. 입력은 유지됩니다. 최신 설정을 불러와 비교한 뒤 다시 저장해주세요.',
    INVALID_EXTERNAL_LINK:'외부 링크는 지원 플랫폼의 HTTPS 주소로 최대 5개 입력해주세요. 중복 주소·사용자 정보·포트는 사용할 수 없습니다.',
    RIGHTS_CONFIRMATION_REQUIRED:'게시 권한과 다른 플랫폼 계약에 대한 확인이 필요합니다.',
    AUTHOR_DISTRIBUTION_NOT_ACTIVATED:'연재 방식 설정이 아직 활성화되지 않았습니다.',
    WORK_RESTRICTED:'운영 제한 중에는 연재 방식을 변경할 수 없습니다.',WORK_TRASHED:'휴지통에서 먼저 복구해주세요.',
    WORK_NOT_FOUND:'작품을 찾을 수 없거나 접근 권한이 없습니다.',ACCOUNT_INACTIVE:'현재 계정으로 설정을 변경할 수 없습니다.'};
  const actor=()=>window.WebNovelsAuth?.getActor();
  function valid(state) {
    const who=actor(),parts=location.pathname.split('/').filter(Boolean);
    return active===state && epoch===state.epoch && state.container.isConnected && who?.userId===state.user && who.author?.status==='APPROVED' &&
      ['creator','author'].includes(parts[0]) && parts[1]==='works' && parts[2]===state.workId && parts[3]==='settings';
  }
  function checked(value,workId) {
    if (!value || value.workId!==workId || !['UNSET','NON_EXCLUSIVE','EXCLUSIVE_INTEREST'].includes(value.mode) ||
      typeof value.version!=='string' || !/^(0|[1-9]\d{0,18})$/.test(value.version) || BigInt(value.version)>9223372036854775807n ||
      !Array.isArray(value.externalLinks) || value.externalLinks.length>5 || value.externalLinks.some(v=>typeof v!=='string')) {
      const error=new Error('Invalid settings response');error.code='DATABASE_UNAVAILABLE';throw error;
    }
    return value;
  }
  function links(container,values) {
    container.replaceChildren();
    for (const value of values) {
      let url;try{url=new URL(value);}catch{continue;}
      const authority=value.match(/^https:\/\/([^/?#]+)/i)?.[1];
      if(url.protocol!=='https:' || !Object.hasOwn(hosts,url.hostname) || authority?.toLowerCase()!==url.hostname || /[\s\\\u0000-\u001f\u007f]/.test(value))continue;
      const item=document.createElement('li'),link=document.createElement('a');
      link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=hosts[url.hostname]+' 연재 링크 열기';
      item.appendChild(link);container.appendChild(item);
    }
  }
  async function mount(container,work) {
    reset();if(!container)return;
    if(!actor()?.userId||actor()?.author?.status!=='APPROVED'){container.replaceChildren();return;}
    const state={container,epoch,user:actor()?.userId,workId:work.id,busy:false,dirty:false,version:null};active=state;
    const disabled=!!work.trashed_at || work.moderation_state!=='CLEAR';
    container.innerHTML=`<section class="cw-distribution" aria-labelledby="cwDistributionTitle"><h4 id="cwDistributionTitle">연재 방식 · 외부 연재 링크</h4>
      <p>원작 권리와 기존 계약은 아래 선택만으로 변경되지 않습니다. 독점 상담 희망은 계약 접수·승인이나 오리지널 인증이 아닙니다.</p>
      <p id="cwDistributionMessage" role="status">연재 방식 설정을 불러오는 중입니다…</p>
      <form id="cwDistributionForm" hidden><fieldset id="cwDistributionFields" ${disabled?'disabled':''}>
        <label for="cwDistributionMode">연재 방식</label><select id="cwDistributionMode" class="form-control" required>
          <option value="">선택해주세요</option><option value="NON_EXCLUSIVE">비독점 연재</option><option value="EXCLUSIVE_INTEREST">독점 연재 상담 희망</option></select>
        <label for="cwDistributionLinks">외부 연재 링크 (선택, 한 줄에 하나, 최대 5개)</label>
        <textarea id="cwDistributionLinks" class="form-control" rows="3" maxlength="10244" aria-describedby="cwDistributionHelp"></textarea>
        <p id="cwDistributionHelp">문피아·네이버 소설/웹툰·카카오페이지/웹툰·조아라·레진의 HTTPS 작품 주소를 입력해주세요.</p>
        <label><input type="checkbox" id="cwDistributionRights" required> 이 작품의 게시 권한이 있으며, 다른 플랫폼 계약에 위배되지 않음을 확인합니다.</label>
        <p>이 확인은 권리자 진술입니다. 별도 플랫폼 이용·유통 계약에 대한 동의는 아닙니다. 설정 저장 후에도 작품의 공개 여부는 그대로입니다.</p>
        <button type="submit" class="btn btn-primary">연재 방식 저장</button></fieldset></form>
      <p id="cwDistributionDeclared"></p><ul id="cwDistributionPreview" aria-label="저장된 외부 연재 링크"></ul>
      <button type="button" id="cwDistributionReload" class="btn btn-ghost">최신 설정 불러오기 (입력 초기화)</button></section>`;
    const q=id=>container.querySelector('#'+id),message=q('cwDistributionMessage'),form=q('cwDistributionForm'),fields=q('cwDistributionFields');
    const api=options=>window.WebNovelsAuth.api('/api/v2/creator/works/'+state.workId+'/distribution',options);
    const apply=value=>{
      const data=checked(value,state.workId);state.version=data.version;
      q('cwDistributionMode').value=data.mode==='UNSET'?'':data.mode;
      q('cwDistributionLinks').value=data.externalLinks.join('\n');q('cwDistributionRights').checked=false;
      const date=data.declaredAt?new Date(data.declaredAt):null;
      q('cwDistributionDeclared').textContent=date&&!Number.isNaN(date.getTime())?'마지막 권리 확인: '+date.toLocaleString('ko-KR'):'';
      links(q('cwDistributionPreview'),data.externalLinks);form.hidden=false;state.dirty=false;
    };
    q('cwDistributionReload').onclick=()=>{
      if(state.busy)return;
      if(state.version!==null&&!window.confirm('입력 중인 연재 방식과 링크를 최신 설정으로 바꿀까요?'))return;
      return mount(container,work);
    };
    form.oninput=()=>{state.dirty=true;if(!state.busy)message.textContent='변경 내용을 확인한 뒤 연재 방식 저장을 눌러주세요.';};
    form.onsubmit=async event=>{
      event.preventDefault();if(!valid(state)||state.busy||state.version===null||disabled)return;
      state.busy=true;state.dirty=true;fields.disabled=true;q('cwDistributionReload').disabled=true;message.textContent='연재 방식 설정을 저장하는 중입니다…';
      const body={version:state.version,mode:q('cwDistributionMode').value,
        externalLinks:q('cwDistributionLinks').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean),rightsConfirmed:q('cwDistributionRights').checked};
      try {
        const result=await api({method:'PATCH',body:JSON.stringify(body)});if(!valid(state))return;
        const data=checked(result.distribution,state.workId);
        if(data.mode==='UNSET'||BigInt(data.version)!==BigInt(state.version)+1n)throw new Error('Unconfirmed save');
        apply(data);message.textContent='연재 방식 설정이 저장되었습니다. 공개 여부와 계약 상태는 변경되지 않았습니다.';
      }catch(error){if(valid(state))message.textContent=errors[error.code]||'저장 결과를 확인하지 못했습니다. 입력은 유지됩니다. 최신 설정을 불러와 비교해주세요.';}
      finally{if(valid(state)){state.busy=false;fields.disabled=disabled;q('cwDistributionReload').disabled=false;}}
    };
    try {
      const result=await api();if(!valid(state))return;apply(result.distribution);
      message.textContent=disabled?'현재 작품 상태에서는 연재 방식을 변경할 수 없습니다.':state.version==='0'?'아직 연재 방식을 선택하지 않았습니다.':'저장된 연재 방식 설정입니다.';
    }catch(error){if(valid(state))message.textContent=errors[error.code]||'연재 방식을 불러오지 못했습니다. 다시 불러오기를 눌러주세요.';}
  }
  function reset(){++epoch;active=null;}
  window.CreatorDistribution={mount,reset,hasUnsavedChanges:()=>!!active&&valid(active)&&(active.dirty||active.busy)};
})();
