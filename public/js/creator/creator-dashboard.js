(function () {
  'use strict';
  let generation=0;
  const ids=['creatorHomeContent','creatorEarningsContent','creatorProfileContent'];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const active=()=>window.WebNovelsAuth?.getActor()?.author?.status==='APPROVED'&&window.WebNovelsAuth.getActor().authorWorkspaceReady===true;
  const api=(action,data)=>window.WebNovelsAuth.api('/api/v2/creator/dashboard?action='+action,data?{method:'POST',body:JSON.stringify(data)}:undefined);
  function reset(){generation++;ids.forEach(id=>document.getElementById(id)?.replaceChildren());}
  function message(e){return ({PROFILE_CONFLICT:'다른 곳에서 정보가 변경되었습니다. 새로고침 후 다시 수정해주세요.',INVALID_PROFILE:'필명은 2~40자, 소개는 2,000자 이하로 입력해주세요.',INVALID_BANK_DETAILS:'은행명, 실명과 8~20자리 계좌번호를 확인해주세요.',BANK_REAUTH_REQUIRED:'현재 로그인 계정의 비밀번호를 확인해주세요. 추가 인증이 설정된 계정은 운영자에게 문의해주세요.',RATE_LIMITED:'확인 요청이 많습니다. 15분 후 다시 시도해주세요.'})[e?.code]||'정보를 처리하지 못했습니다. 다시 조회하여 저장 상태를 확인해주세요.';}
  function begin(id){
    const root=document.getElementById(id),seq=++generation,user=window.WebNovelsAuth?.getActor()?.userId;
    if(!root||!active())return null;
    root.innerHTML='<p role="status">불러오는 중입니다.</p>';
    return {root,valid:()=>seq===generation&&active()&&window.WebNovelsAuth.getActor().userId===user};
  }
  function failed(state,e,retry){if(!state.valid())return;state.root.innerHTML='<p role="alert">'+esc(message(e))+'</p><button type="button" class="btn btn-outline">다시 조회</button>';state.root.querySelector('button').onclick=retry;}
  async function home(){
    const state=begin(ids[0]);if(!state)return;
    try{
      const data=await api('home');if(!state.valid())return;
      state.root.innerHTML=`<div class="author-section-heading"><div><h2>작가 대시보드</h2><p class="text-muted">작품 현황과 수익, 내 정보를 한곳에서 관리하세요.</p></div><button type="button" class="btn btn-outline" id="adRefresh">새로고침</button></div>
        <div class="author-dashboard-stats">${[['내 작품',data.counts.works,'편'],['등록 회차',data.counts.episodes,'화'],['작성 중 원고',data.counts.drafts,'개'],['예상수익','집계 전','']].map(([label,n,unit])=>`<div class="author-stat"><span>${esc(label)}</span><strong>${esc(n)}<small>${esc(unit)}</small></strong></div>`).join('')}</div>
        <div class="author-dashboard-actions"><button type="button" class="btn btn-primary" data-go="works">작품 관리·원고 작성</button><button type="button" class="btn btn-outline" data-go="earnings">수익 내역 조회</button><button type="button" class="btn btn-outline" data-go="profile">내 정보·정산 계좌</button></div>
        <p class="text-muted">수익 집계는 광고·결제 연동 후 시작됩니다. ${data.bankRegistered?'정산 계좌가 등록되어 있습니다. 계좌 확인은 대기 중입니다.':'정산을 위한 본인 명의 계좌를 등록해주세요.'}</p>
        <h3>최근 작품</h3><div class="author-recent-works">${data.recentWorks.length?data.recentWorks.map(w=>`<button type="button" class="btn btn-outline" data-work="${esc(w.id)}"><span>${esc(w.title)}</span><small>${w.visibility==='PUBLIC'?'공개':'비공개'}</small></button>`).join(''):'<p>첫 작품을 등록해보세요.</p>'}</div>`;
      state.root.querySelector('#adRefresh').onclick=home;
      state.root.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>window.switchCreatorTab(b.dataset.go));
      state.root.querySelectorAll('[data-work]').forEach(b=>b.onclick=()=>window.CreatorWorks.navigate('/creator/works/'+b.dataset.work));
    }catch(e){failed(state,e,home);}
  }
  async function earnings(month='',page=0){
    const state=begin(ids[1]);if(!state)return;
    try{
      const data=await api('earnings&month='+encodeURIComponent(month)+'&page='+page);if(!state.valid())return;
      const money=n=>n===null?'—':Number(n).toLocaleString('ko-KR',{maximumFractionDigits:2})+'원';
      const status={ESTIMATED:'예상',CONFIRMED:'확정',PAYABLE:'지급 가능',PAID:'지급',SETTLED:'정산',PENDING:'대기',VOID:'취소'};
      state.root.innerHTML=`<h2>수익 내역</h2><div class="author-stat"><span>예상수익</span><strong>집계 전</strong></div>
        <p>광고·결제 연동 전입니다. 아래 이전 기록은 검증 대기 자료이며 실제 정산 가능 금액에 포함되지 않습니다.</p>
        <div class="author-section-heading"><h3>이전 수익 기록</h3><label>조회 기간 <select id="adMonth" class="form-input"><option value="">전체 기간</option>${data.months.map(m=>`<option value="${esc(m)}" ${m===month?'selected':''}>${esc(m)}</option>`).join('')}</select></label><button type="button" class="btn btn-outline" id="adEarningsRefresh">조회</button></div>
        <p role="status">${esc(data.total)}건 · 검증 대기</p><div class="author-table-scroll"><table class="author-earnings-table"><thead><tr><th>기준일</th><th>작품</th><th>기록 금액</th><th>기록상 구분</th><th>현재 상태</th></tr></thead><tbody>${data.records.length?data.records.map(r=>`<tr><td>${esc(r.date||'미지정')}</td><td>${esc(r.workTitle||'작가 수익')}</td><td>${esc(money(r.amount))}</td><td>${esc(status[r.recordedStatus]||'기타')}</td><td>검증 대기</td></tr>`).join(''):'<tr><td colspan="5">해당 기간에 등록된 수익 내역이 없습니다.</td></tr>'}</tbody></table></div>
        <div class="author-dashboard-actions"><button type="button" class="btn btn-outline" id="adPrev" ${page===0?'disabled':''}>이전</button><span>${page+1} / ${Math.max(1,Math.ceil(data.total/50))}</span><button type="button" class="btn btn-outline" id="adNext" ${(page+1)*50>=data.total?'disabled':''}>다음</button></div>`;
      const filter=state.root.querySelector('#adMonth');filter.onchange=()=>earnings(filter.value,0);
      state.root.querySelector('#adEarningsRefresh').onclick=()=>earnings(filter.value,0);
      state.root.querySelector('#adPrev').onclick=()=>earnings(month,page-1);
      state.root.querySelector('#adNext').onclick=()=>earnings(month,page+1);
    }catch(e){failed(state,e,()=>earnings(month,page));}
  }
  function bankSummary(bank,legacy){return bank?`${esc(bank.bankName)} · ${esc(bank.maskedNumber)} · 예금주 ${esc(bank.holder)}<br><small>등록 완료 · 계좌 확인 대기</small>`:legacy?'이전 계좌 자료가 있습니다. 본인 명의 계좌를 다시 등록해주세요.':'등록된 정산 계좌가 없습니다.';}
  async function profile(){
    const state=begin(ids[2]);if(!state)return;
    try{
      const data=await api('profile');if(!state.valid())return;
      let profileVersion=data.profile.version,bankRevision=data.bank?.revision||'0';
      state.root.innerHTML=`<div class="author-section-heading"><h2>내 정보·정산 계좌</h2><button type="button" class="btn btn-outline" id="adProfileRefresh">새로고침</button></div>
        <div class="author-profile-grid"><form id="adProfileForm" class="author-profile-form"><h3>작가 정보</h3>
          <label>로그인 이메일<input class="form-input" type="email" value="${esc(data.profile.email)}" readonly autocomplete="username"></label>
          <label>필명<input class="form-input" name="penName" value="${esc(data.profile.penName)}" required minlength="2" maxlength="40"></label>
          <label>소개<textarea class="form-input" name="bio" rows="5" maxlength="2000">${esc(data.profile.bio)}</textarea></label>
          <p class="text-muted">필명과 소개는 독자에게 공개됩니다.</p><button type="submit" class="btn btn-primary">작가 정보 저장</button><p id="adProfileStatus" role="status" aria-live="polite"></p>
        </form><form id="adBankForm" class="author-profile-form" autocomplete="off"><h3>정산 계좌</h3><p id="adBankSummary">${bankSummary(data.bank,data.legacyBankExists)}</p>
          <label>은행명<input class="form-input" name="bankName" value="${esc(data.bank?.bankName||'')}" placeholder="은행명" required minlength="2" maxlength="60"></label>
          <label>실명(예금주)<input class="form-input" name="holder" value="${esc(data.bank?.holder||'')}" placeholder="본인 실명" required minlength="2" maxlength="80" autocomplete="off"></label>
          <label>계좌번호<input class="form-input" name="accountNumber" inputmode="numeric" placeholder="저장할 전체 계좌번호를 입력하세요" required minlength="8" maxlength="32" autocomplete="off"></label>
          <label>현재 로그인 비밀번호<input class="form-input" name="password" type="password" required maxlength="256" autocomplete="current-password"></label>
          <label class="author-bank-consent"><input type="checkbox" name="consent" required> 본인 명의 계좌이며, 정산을 위해 계좌 정보를 저장하는 데 동의합니다.</label>
          <p class="text-muted">계좌번호는 암호화하여 저장하고 끝 4자리만 표시합니다. 저장만으로 실명·계좌 확인이나 지급이 완료되지는 않습니다.</p>
          <button type="submit" class="btn btn-primary">계좌 정보 저장</button><p id="adBankStatus" role="status" aria-live="polite"></p>
        </form></div>`;
      state.root.querySelector('#adProfileRefresh').onclick=profile;
      const profileForm=state.root.querySelector('#adProfileForm'),bankForm=state.root.querySelector('#adBankForm');
      profileForm.onsubmit=async event=>{
        event.preventDefault();const button=profileForm.querySelector('button'),status=state.root.querySelector('#adProfileStatus');if(button.disabled)return;
        button.disabled=true;status.textContent='저장 중입니다.';
        try{
          const result=await api('save-profile',{version:profileVersion,penName:profileForm.elements.penName.value,bio:profileForm.elements.bio.value});if(!state.valid())return;
          profileVersion=result.profile.version;status.textContent='작가 정보를 저장했습니다.';
          const name=document.getElementById('creatorAuthorPenName');if(name)name.textContent=result.profile.penName;
          try{await window.WebNovelsAuth.validate();}catch{if(state.valid())status.textContent='저장되었습니다. 다시 로그인하면 변경한 필명이 표시됩니다.';}
        }catch(e){if(state.valid())status.textContent=message(e);}finally{if(state.valid())button.disabled=false;}
      };
      bankForm.onsubmit=async event=>{
        event.preventDefault();const button=bankForm.querySelector('button'),status=state.root.querySelector('#adBankStatus');if(button.disabled||!bankForm.elements.consent.checked)return;
        button.disabled=true;status.textContent='본인 확인 후 저장 중입니다.';
        const payload={revision:bankRevision,bankName:bankForm.elements.bankName.value,holder:bankForm.elements.holder.value,accountNumber:bankForm.elements.accountNumber.value,password:bankForm.elements.password.value};
        bankForm.elements.password.value='';bankForm.elements.accountNumber.value='';
        try{
          const result=await api('save-bank',payload);if(!state.valid())return;
          bankRevision=result.bank.revision;state.root.querySelector('#adBankSummary').innerHTML=bankSummary(result.bank,false);
          bankForm.elements.consent.checked=false;status.textContent='계좌 정보를 저장했습니다. 계좌 확인은 대기 중입니다.';
        }catch(e){if(state.valid())status.textContent=message(e);}finally{payload.password='';payload.accountNumber='';if(state.valid())button.disabled=false;}
      };
    }catch(e){failed(state,e,profile);}
  }
  window.CreatorDashboard={active,home,earnings,profile,reset};
})();
