window.handleAdminLoginProcess = async function() {
  try {
    const actor = await window.WebNovelsAuth.login(document.getElementById('adminLoginId').value, document.getElementById('adminLoginPw').value);
    if (!actor.admin) { await window.WebNovelsAuth.logout(); showToast('관리자 권한이 없습니다.'); return; }
    closeAllModals();
    switchWebNovelsView('view-admin-cms');
  } catch(error) { showToast(window.WebNovelsAuth.message(error)); }
};
window.handleAdminLogoutProcess = async function() { return window.handleMemberLogout(); };

(function () {
  let panelGeneration=0;
  function panel(mode) {
    const generation=++panelGeneration;
    let backdrop = document.getElementById('modalAuthCompletion');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'modalAuthCompletion';
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `<div class="modal-dialog glass-panel auth-completion-dialog" role="dialog" aria-modal="true" aria-labelledby="authCompletionTitle" aria-describedby="authCompletionDescription">
        <div class="modal-header"><h3 id="authCompletionTitle"></h3><button type="button" class="btn btn-ghost" onclick="closeModal('modalAuthCompletion')" aria-label="가입·비밀번호 설정 창 닫기">닫기</button></div>
        <div class="modal-body"><p id="authCompletionDescription" class="auth-form-description"></p><form id="authCompletionForm" aria-describedby="authCompletionMessage">
          <div id="authCompletionProfile" class="auth-form-fields"><p class="auth-form-help">확인한 이메일로 로그인한 뒤 가입을 마쳐주세요. 기존 작가 계정 연결은 운영자에게 문의해주세요.</p>
            <label for="authCompletionKind">가입 유형</label><select id="authCompletionKind" class="form-control"><option value="author">작가</option><option value="reader">독자</option></select>
            <div id="authAuthorEnrollment"></div>
            <label for="authCompletionName">필명 / 별명 (2~40자)</label><input id="authCompletionName" class="form-control" minlength="2" maxlength="40" autocomplete="nickname" aria-describedby="authCompletionNameHelp">
            <p id="authCompletionNameHelp" class="auth-form-help">표시 이름은 로그인 이메일과 별개입니다. 계정마다 작품과 이용 권한을 따로 관리합니다.</p>
          </div>
          <div id="authCompletionPassword" class="auth-form-fields"><p id="authNewPasswordHelp" class="auth-form-help">8자 이상 입력해주세요. 저장하면 로그아웃되며 새 비밀번호로 다시 로그인합니다.</p><label for="authNewPassword">새 비밀번호</label><input id="authNewPassword" class="form-control" type="password" minlength="8" autocomplete="new-password" aria-describedby="authNewPasswordHelp">
            <label for="authNewPasswordConfirm">비밀번호 확인</label><input id="authNewPasswordConfirm" class="form-control" type="password" minlength="8" autocomplete="new-password"></div>
          <p id="authCompletionMessage" class="auth-form-status" role="status" aria-live="polite" aria-atomic="true"></p><button type="submit" class="btn btn-primary auth-form-submit">가입 완료</button>
        </form><nav class="auth-policy-links" aria-label="가입·이용 정책"><a href="/company/">회사·문의 안내</a><a href="/policies/terms/">이용약관</a><a href="/policies/refund/">환불정책</a></nav></div></div>`;
      document.body.appendChild(backdrop);
    }
    const reset = mode === 'recovery';
    document.getElementById('authCompletionTitle').textContent = reset ? '새 비밀번호 설정' : '가입 마무리';
    const description=document.getElementById('authCompletionDescription');
    if(description)description.textContent=reset?'이메일의 비밀번호 재설정 링크로 시작한 요청을 완료합니다.':'가입 유형과 표시 이름을 확인해주세요. 작가 가입에 필요한 동의와 인증 상태는 아래에서 안내합니다.';
    document.getElementById('authCompletionProfile').hidden = reset;
    document.getElementById('authCompletionPassword').hidden = !reset;
    document.getElementById('authCompletionName').required = !reset;
    document.getElementById('authNewPassword').required = reset;
    document.getElementById('authNewPasswordConfirm').required = reset;
    document.getElementById('authCompletionName').disabled = reset;
    document.getElementById('authCompletionKind').disabled = reset;
    document.getElementById('authNewPassword').disabled = !reset;
    document.getElementById('authNewPasswordConfirm').disabled = !reset;
    document.getElementById('authCompletionMessage').textContent = '';
    document.getElementById('authCompletionMessage').classList?.remove('auth-form-error');
    document.getElementById('authNewPassword').value=document.getElementById('authNewPasswordConfirm').value='';
    document.getElementById('authCompletionForm').setAttribute?.('aria-busy','false');
    const submitButton=document.getElementById('authCompletionForm').querySelector('button[type="submit"]');
    if(submitButton){submitButton.textContent=reset?'비밀번호 저장':'가입 완료';submitButton.disabled=false;}
    const currentAuthor=window.WebNovelsAuth.getActor()?.author;
    document.getElementById('authCompletionName').readOnly=!reset&&!!currentAuthor;
    document.getElementById('authCompletionName').value=!reset&&currentAuthor?currentAuthor.pen_name||'':'';
    const enrollment=document.getElementById('authAuthorEnrollment');
    const selectKind=()=>{
      enrollment.hidden=reset||document.getElementById('authCompletionKind').value!=='author';
      if(!enrollment.hidden)window.AuthorEnrollment?.mount(enrollment);else window.AuthorEnrollment?.reset();
    };
    document.getElementById('authCompletionKind').onchange=selectKind;selectKind();
    let busy=false;
    document.getElementById('authCompletionForm').onsubmit = async event => {
      event.preventDefault();
      if(busy||generation!==panelGeneration)return;
      busy=true;
      const button = event.target.querySelector('button[type="submit"]');
      if(button)button.disabled = true;
      event.target.setAttribute?.('aria-busy','true');
      const message=document.getElementById('authCompletionMessage');message.classList?.remove('auth-form-error');
      message.textContent=reset?'비밀번호를 저장하고 있습니다.':'가입 정보를 확인하고 있습니다.';
      try {
        if (reset) {
          const password = document.getElementById('authNewPassword').value;
          if (password !== document.getElementById('authNewPasswordConfirm').value) throw new Error('비밀번호가 일치하지 않습니다.');
          await window.WebNovelsAuth.changePassword(password);
          if(generation!==panelGeneration||backdrop.hidden===true)return;
          document.getElementById('authNewPassword').value = document.getElementById('authNewPasswordConfirm').value = '';
          showToast('비밀번호가 변경되었습니다. 다시 로그인해주세요.');
        } else {
          await window.WebNovelsAuth.complete(document.getElementById('authCompletionKind').value, document.getElementById('authCompletionName').value);
          if(generation!==panelGeneration||backdrop.hidden===true)return;
          showToast('가입이 완료되었습니다.');
        }
        closeModal('modalAuthCompletion');
        if (!reset) await window.openAccountHome();
      } catch(error) { if(generation===panelGeneration&&backdrop.hidden!==true){message.textContent = window.WebNovelsAuth.message(error);message.classList?.add('auth-form-error');} }
      finally { if(generation===panelGeneration){busy=false;if(button)button.disabled = false;event.target.setAttribute?.('aria-busy','false');} }
    };
    closeAllModals(); openModal('modalAuthCompletion');
  }
  window.showAuthOnboarding = () => panel('profile');
  window.showAuthRecovery = () => panel('recovery');
  window.requestAuthReset = async function() {
    const email = document.getElementById('loginEmail').value;
    if (!email.includes('@')) { showToast('이메일을 입력해주세요.'); return; }
    try { await window.WebNovelsAuth.reset(email); showToast('가입된 이메일이라면 재설정 메일을 받으실 수 있습니다.'); }
    catch(error) { showToast(window.WebNovelsAuth.message(error)); }
  };
})();
