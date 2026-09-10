# [Improvement Step 1] 작가 집필 스튜디오 완성 (improve1.md)

## 1. 개요 및 목적
현재 구축된 IndexedDB 1차 저장 및 서버 동기화 기반 위에, **실제 작가가 연재 집필 시 겪는 실질적인 불편(버전 간 변경점 미확인, 문단/서식 정렬 수작업, 모바일 가상 키보드 가림 현상)을 완벽히 해소**하는 고도화 작업입니다.

---

## 2. 변경 대상 파일 목록
1. `public/js/creator/creator-editor.js` : Diff 비교 로직, 문단 서식 정규화 함수, 모바일 뷰포트 대응 강화
2. `public/index.html` : 버전 비교 모달(`modalDraftDiff`), 서식 도구 툴바 버튼 추가
3. `public/styles.css` : Diff 뷰어 스타일(추가/삭제 강조), 모바일 에디터 고정 툴바 스타일

---

## 3. 세부 기능 개발 명세

### 3.1 버전 간 시각적 Diff 비교 모달 (`modalDraftDiff`)
- **기존 방식**: 단순 `window.prompt`로 버전 번호만 입력받아 복구하여 변경 내용을 사전에 볼 수 없었음.
- **개선 내용**:
  1. `버전 복구` 버튼 클릭 시 직관적인 모달 팝업 표시.
  2. 좌측: 저장된 버전 목록(생성 시각, 글자 수).
  3. 우측: 현재 원고와 선택된 이전 버전 간의 제목/작가의 말/본문 변경점(Diff)을 시각적으로 표시 (추가된 부분 녹색, 삭제된 부분 적색 하이라이트).
  4. '이 버전으로 롤백' 버튼 클릭 시 새 revision을 생성하며 안전 복구.

### 3.2 웹소설 전용 원클릭 단락/서식 정규화 도구
- 에디터 상단 툴바에 웹소설 맞춤형 서식 지원 버튼군 추가:
  1. **들여쓰기 정돈 (`Indent`)**: 각 문단의 첫머리에 전각 공백(`　`) 또는 공백 1칸 자동 부여/제거 토글.
  2. **대화문 줄바꿈 정돈 (`Dialogue`)**: 큰따옴표(`"`)로 시작하는 대화문 앞뒤 빈 줄 정규화.
  3. **다중 공백/빈줄 제거 (`Clean`)**: 3연속 이상의 빈 줄을 1~2줄로 축소하고 문장 끝 공백 일괄 정리.
  4. **따옴표 대칭 교정 (`Quotes`)**: 짝이 맞지 않는 따옴표/특수문자 경고 표시.

### 3.3 모바일 집필 UX 최적화 (폭 768px 이하)
- 모바일 브라우저에서 가상 키보드가 올라올 때 발행 버튼과 글자 수 게이지가 가려지는 문제 방지:
  1. `visualViewport` API를 활용하여 가상 키보드 높이에 맞추어 에디터 하단 툴바 자동 리사이징.
  2. 44px 이상의 원터치 단축 버튼(자동저장 상태, 버전 저장, 정규화) 상단 고정 배치.
  3. 페이지 이탈 시 미동기 변경사항 존재 시에만 브라우저 `beforeunload` 경고 발동.

---

## 4. UI 및 구현 상세 설계

### HTML 구조 (`modalDraftDiff`)
```html
<div class="modal-backdrop" id="modalDraftDiff">
  <div class="modal-dialog glass-panel dialog-lg">
    <div class="modal-header">
      <h3><i data-lucide="git-compare"></i> 원고 버전 비교 및 복구</h3>
      <button class="btn btn-icon btn-ghost modal-close"><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body diff-modal-layout">
      <div class="diff-version-sidebar" id="diffVersionList"></div>
      <div class="diff-preview-pane">
        <div class="diff-header-info" id="diffHeaderInfo"></div>
        <div class="diff-content-view" id="diffContentView"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost modal-close">취소</button>
      <button class="btn btn-primary" id="btnConfirmRestoreRevision">선택한 버전으로 복구</button>
    </div>
  </div>
</div>
```

---

## 5. 검증 체크리스트
- [ ] 6,000자 이상의 긴 원고에서 버전 저장 후, 일부 수정 후 Diff 모달을 열었을 때 변경 문단이 정확히 하이라이트되는가?
- [ ] '들여쓰기 정돈' 및 '대화문 정돈' 실행 시 의도치 않은 글자 유실이 없는가?
- [ ] 모바일 환경(DevTools 모바일 뷰)에서 입력 포커스 시 하단 툴바가 텍스트를 가리지 않는가?
- [ ] 복구 실행 시 현재 원고가 먼저 새 버전으로 백업된 후 롤백되는가?
