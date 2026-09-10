# [Improvement Step 3] 작품 발견성 & 태그·검색 시스템 고도화 (improve3.md)

## 1. 개요 및 목적
이미 백엔드(`src/config/tags.ts`, `src/routes/work.router.ts`)에는 표준 태그 정규화와 다차원 검색 필터가 구현되어 있습니다. 본 단계에서는 **작가와 독자 양쪽의 프론트엔드 UI를 대폭 보강하여, 신규/신인 작품이 독자에게 자연스럽게 발견되고 독자가 원하는 조건의 작품을 정밀하게 탐색**할 수 있도록 합니다.

---

## 2. 변경 대상 파일 목록
1. `public/index.html` : 작가 작품 등록 폼의 태그 입력기 개편, 탐색(Discover) 화면의 다차원 필터 바(완결, 회차 구간, 복수 태그) UI 추가
2. `public/js/creator/creator.js` : 표준 태그 자동완성 칩(Chips) 입력 컴포넌트 연동
3. `public/js/reader/reader.js` : 다중 태그 AND/OR 필터링, 완결작 필터, 회차 수 슬라이더/버튼 연동, Golden Best 랭킹 카드 뱃지 및 추천 이유 툴팁
4. `public/styles.css` : 태그 칩(tag chips), 골든베스트 전용 뱃지 스타일

---

## 3. 세부 기능 개발 명세

### 3.1 작가 작품 등록 시 표준 태그 칩(Chips) 자동완성
- **기존 방식**: 단순 텍스트 인풋에 쉼표로 입력하여 오타나 비표준 태그가 난립함.
- **개선 내용**:
  1. `STANDARD_TAGS` 카테고리별(장르특성, 주인공 성향, 스토리 전개, 배경/세계관) 태그 사전 탑재.
  2. 태그 입력창에 키워드 입력 시 실시간 추천 드롭다운 표시.
  3. 클릭 또는 Enter 시 시각적 뱃지 칩(`[판타지 ✕]`, `[먼치킨 ✕]`) 형태로 등록 (최대 10개 제한).
  4. 자주 쓰이는 추천 태그 퀵 클릭 버튼 제공.

### 3.2 독자 탐색(Discover) 화면 다차원 복합 필터 UI
- 상단 카테고리 아래에 접이식 '상세 필터' 토글 바 구축:
  1. **연재 상태**: 전체 / 연재중 / 완결
  2. **회차 수 구간**: 전체 / 단편(1~25화) / 중편(26~100화) / 장편(101화 이상)
  3. **연령 등급**: 전체이용가 / 15세 이상 / 19세 이상
  4. **다중 태그 교집합(AND) 필터**: 복수 개의 태그를 선택하여 모든 조건을 만족하는 작품만 정밀 추출.
  5. 조건 변경 시 0.2초 debounce로 실시간 결과 갱신 및 총 검색 건수 표시.

### 3.3 Golden Best 신인 추천 뷰어 고도화
- 홈 화면 및 랭킹 탭에 `골든 베스트 (신인 1~15화 급상승)` 전용 섹션 강화:
  - 1~6위 랭킹 뱃지 (`GOLDEN 1위` ~ `6위`).
  - 카드 하단에 추천 근거 뱃지 노출: `💡 최근 신작 · 관심 48 · 유효 댓글 12`.
  - 알고리즘 투명성: 누적 조회수 몰아주기가 아닌 '최근 독자 반응 품질' 기반임을 안내하는 툴팁 제공.

---

## 4. UI 컴포넌트 설계

### 태그 칩 입력기 UI 구조
```html
<div class="tag-input-container" id="workTagInputContainer">
  <div class="tag-chips-box" id="workTagChips">
    <!-- 동적으로 칩 추가: <span class="tag-chip">회귀물 <button type="button">&times;</button></span> -->
  </div>
  <input type="text" id="workTagSearchInput" class="tag-search-input" placeholder="태그를 입력하거나 아래에서 선택하세요">
  <div class="tag-autocomplete-dropdown hidden" id="tagAutocompleteDropdown"></div>
</div>
<div class="quick-tag-suggestions" id="quickTagSuggestions">
  <!-- 추천 퀵 태그 버튼 목록 -->
</div>
```

---

## 5. 검증 체크리스트
- [ ] 신규 작품 등록 시 태그 검색창에 '회귀' 입력 시 '회귀물', '회귀' 추천이 뜨고 칩 형태로 등록되는가?
- [ ] 탐색 화면에서 '판타지' + '완결' + '100화 이상' 복합 필터 선택 시 정확히 일치하는 작품만 필터링되는가?
- [ ] Golden Best 카드에 계산된 스코어 기반 랭킹과 추천 사유 뱃지가 정상 노출되는가?
