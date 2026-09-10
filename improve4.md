# [Improvement Step 4] 문단 댓글 UX 고도화 & 작가 안심 모더레이션 콘솔 (improve4.md)

## 1. 개요 및 목적
문단 댓글의 백엔드 필드와 기본적인 클릭 선택 기능은 구축되었습니다. 본 단계에서는 **독자가 본문을 읽으며 각 문단별 반응(댓글 수)을 직관적으로 확인하고, 작가는 작품 관리 화면에서 악성 댓글러나 비방 댓글을 손쉽게 필터링/차단할 수 있는 전용 모더레이션 콘솔 UI**를 완성합니다.

---

## 2. 변경 대상 파일 목록
1. `public/js/reader/reader.js` : 문단 우측 댓글 카운트 뱃지 표시, 문단 클릭 시 해당 문단 댓글만 필터링하는 퀵 뷰어
2. `public/index.html` : 문단 댓글 사이드 시트, 작가 스튜디오 내 '작품 댓글 관리 모달(`modalWorkCommentPolicy`)' UI
3. `public/js/creator/creator.js` : 작가 댓글 정책 모달 연동 (금칙어 사전 관리, 최소 열람 회차 슬라이더, 차단 독자 목록 조회 및 차단 해제)
4. `public/styles.css` : 문단 댓글 뱃지(`.paragraph-badge`), 스포일러 블러/펼침 효과 스타일

---

## 3. 세부 기능 개발 명세

### 3.1 리더 문단별 댓글 카운트 뱃지 & 필터링 뷰
- **문단 댓글 인디케이터**:
  - 댓글이 등록된 문단 우측에 말풍선 아이콘과 개수 뱃지(`💬 3`) 표시.
  - 마우스 호버 또는 탭 시 뱃지가 활성화되며, 클릭 시 하단 전체 댓글 대신 '해당 문단의 댓글'만 팝업 또는 강조 필터링.
- **스포일러 블라인드 개선**:
  - 스포일러 체크된 댓글은 기본 블러(Blur) 처리.
  - `⚠️ 스포일러가 포함된 감상입니다 [보기]` 버튼 클릭 시 부드럽게 내용 노출.

### 3.2 작가 안심 모더레이션 콘솔 (`modalWorkCommentPolicy`)
- **기존 방식**: 단순 `window.prompt`로 금칙어를 입력받아 사용성이 열악했음.
- **개선 내용**: 전용 그래픽 모달 제공
  1. **작품별 댓글 ON/OFF 스위치**: 악플 폭격 발생 시 긴급하게 새 댓글 작성 차단.
  2. **금칙어 사전 관리 칩 UI**: 등록된 금칙어를 칩 형태로 조회하고, 새 금칙어 추가/삭제. (욕설, 스포일러성 키워드 등)
  3. **댓글 작성 자격 제한 (안티 분탕 방지)**:
     - "최소 N회차 이상 읽은 독자만 댓글 작성 허용" (0~30화 슬라이더 설정).
     - 1화만 대충 보고 악플을 달고 도망가는 체리피커 악플러 원천 차단.
  4. **차단 독자 목록 및 해제 관리**:
     - 작가가 차단한 독자 ID 목록 및 차단 일시 테이블 조회.
     - 오해로 차단된 독자의 차단 해제 버튼 제공.

---

## 4. UI 설계 및 모달 명세

```html
<!-- Modal: 작가 작품 댓글 관리 콘솔 -->
<div class="modal-backdrop" id="modalWorkCommentPolicy">
  <div class="modal-dialog glass-panel dialog-md">
    <div class="modal-header">
      <h3><i data-lucide="shield-alert"></i> 작품 댓글 및 클린존 관리</h3>
      <button class="btn btn-icon btn-ghost modal-close"><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="form-group mb-4">
        <label class="toggle-label">
          <input type="checkbox" id="policyCommentsEnabled" checked>
          <span>이 작품의 독자 댓글 작성 허용</span>
        </label>
      </div>
      <div class="form-group mb-4">
        <label class="small text-muted block mb-1">댓글 작성 최소 열람 조건 (분탕 방지)</label>
        <div class="flex-between">
          <input type="range" id="policyMinReadRange" min="0" max="20" value="0" class="form-range">
          <span id="policyMinReadDisplay" class="font-bold text-pink">전체 독자 가능</span>
        </div>
      </div>
      <div class="form-group mb-4">
        <label class="small text-muted block mb-1">작가 지정 금칙어 사전 (쉼표 또는 엔터로 등록)</label>
        <div class="tag-chips-box" id="policyBlockedTermsChips"></div>
        <input type="text" id="policyNewTermInput" class="form-input" placeholder="금지할 단어 입력 후 Enter">
      </div>
      <div class="form-group">
        <label class="small text-muted block mb-1">현재 차단된 악성 독자 목록</label>
        <div class="blocked-readers-table-box" id="policyBlockedReadersList"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" id="btnSaveCommentPolicy">설정 저장 및 즉시 적용</button>
    </div>
  </div>
</div>
```

---

## 5. 검증 체크리스트
- [ ] 특정 문단에 문단 댓글을 등록했을 때 해당 문단 옆에 댓글 카운트 뱃지가 정상 생성되는가?
- [ ] 스포일러 댓글이 블러 처리되어 있고, '보기' 클릭 시에만 본문이 노출되는가?
- [ ] 작가가 최소 열람 회차를 '3화'로 설정했을 때, 1화만 읽은 독자가 댓글을 쓰려고 하면 차단 경고가 뜨는가?
- [ ] 작가가 금칙어로 등록한 단어가 포함된 댓글 작성 시 서버 및 클라이언트에서 차단되는가?
