(function () {
  function panel(mode) {
    let backdrop = document.getElementById('modalAuthCompletion');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'modalAuthCompletion';
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `<div class="modal-dialog glass-panel" role="dialog" aria-modal="true" aria-labelledby="authCompletionTitle">
        <div class="modal-header"><h3 id="authCompletionTitle"></h3><button type="button" class="btn" onclick="closeModal('modalAuthCompletion')">닫기</button></div>
        <div class="modal-body"><form id="authCompletionForm">
          <div id="authCompletionProfile"><p>확인한 이메일로 로그인한 뒤 가입을 마쳐주세요. 기존 작가 계정 연결은 운영자에게 문의해주세요.</p>
            <label for="authCompletionKind">가입 유형</label><select id="authCompletionKind" class="form-control"><option value="author">작가</option><option value="reader">독자</option></select>
            <label for="authCompletionName">필명 / 별명 (2~40자)</label><input id="authCompletionName" class="form-control" minlength="2" maxlength="40" autocomplete="nickname">
          </div>
          <div id="authCompletionPassword"><label for="authNewPassword">새 비밀번호</label><input id="authNewPassword" class="form-control" type="password" minlength="8" autocomplete="new-password">
            <label for="authNewPasswordConfirm">비밀번호 확인</label><input id="authNewPasswordConfirm" class="form-control" type="password" minlength="8" autocomplete="new-password"></div>
          <p id="authCompletionMessage" role="status"></p><button type="submit" class="btn btn-primary">저장</button>
        </form></div></div>`;
      document.body.appendChild(backdrop);
    }
    const reset = mode === 'recovery';
    document.getElementById('authCompletionTitle').textContent = reset ? '새 비밀번호 설정' : '가입 마무리';
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
    document.getElementById('authCompletionForm').onsubmit = async event => {
      event.preventDefault();
      const button = event.target.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        if (reset) {
          const password = document.getElementById('authNewPassword').value;
          if (password !== document.getElementById('authNewPasswordConfirm').value) throw new Error('비밀번호가 일치하지 않습니다.');
          await window.WebNovelsAuth.changePassword(password);
          document.getElementById('authNewPassword').value = document.getElementById('authNewPasswordConfirm').value = '';
          showToast('비밀번호가 변경되었습니다. 다시 로그인해주세요.');
        } else {
          await window.WebNovelsAuth.complete(document.getElementById('authCompletionKind').value, document.getElementById('authCompletionName').value);
          showToast('가입이 완료되었습니다.');
        }
        closeModal('modalAuthCompletion');
      } catch(error) { document.getElementById('authCompletionMessage').textContent = window.WebNovelsAuth.message(error); }
      finally { button.disabled = false; }
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
