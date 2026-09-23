# [Improvement Step 2] 리더 개인화 환경설정 및 동기화 (improve2.md)

## 1. 개요 및 목적
현재 뷰어는 3가지 기본 테마(화이트/세피아/다크)와 단순 글자 크기(A-/A+)만 지원합니다. 장시간 모바일/PC로 소설을 읽는 독자의 시각 피로를 최소화하고 몰입도를 극대화하기 위해 **OLED True Black 테마, 전문 글꼴(명조/고딕) 전환, 줄간격/여백 조절, 그리고 기기 간 설정 동기화 체계**를 완성합니다.

---

## 2. 변경 대상 파일 목록
1. `public/index.html` : 뷰어 환경설정 모달(`modalReaderSettings`) 내 글꼴, 줄간격, 여백, OLED 블랙 UI 추가
2. `public/js/reader/reader.js` : 리더 환경설정 스토어(`ReaderPreferencesManager`), CSS 변수 주입 로직, 동기화 연동
3. `public/styles.css` : `--reader-font-family`, `--reader-line-height`, `--reader-padding-x`, `.theme-oled` 등 스타일 정의
4. `database/19_reader_preferences.sql` (선택적) 또는 Supabase/Express 설정 저장 API 연동

---

## 3. 세부 기능 개발 명세

### 3.1 테마 확장: OLED True Black (`theme-oled`)
- 완벽한 `#000000` 배경 및 부드러운 회색조 텍스트(`#E2E8F0`)를 적용하여 스마트폰 배터리 절약 및 암실 독서 시 눈부심 완벽 차단.
- 테마 선택 버튼에 `다크 블랙`, `OLED 블랙`, `세피아`, `화이트` 4종 그리드 배치.

### 3.2 독서 타이포그래피 개인화 옵션
1. **글꼴 계열 (Font Family)**:
   - **가독 명조 (Serif)**: `KoPub 바탕`, `Noto Serif KR` — 정통 문학/소설 몰입감
   - **깔끔 고딕 (Sans-serif)**: `Pretendard`, `Noto Sans KR` — 모바일 빠른 가독성
2. **줄간격 (Line Height)**:
   - 1.5배 (좁게), 1.8배 (보통 - 기본값), 2.2배 (넓게)
3. **좌우 여백 (Horizontal Padding)**:
   - 12px (화면 가득), 20px (기본), 36px (여유 있게)
4. **문단 간격 (Paragraph Gap)**:
   - 문단 사이 여백을 0.8em ~ 1.5em 사이에서 유연하게 조절.

### 3.3 로컬 & 서버 원격 동기화 파이프라인
- **비로그인 사용자**: `localStorage('webnovels_reader_pref')`에 영구 보관.
- **로그인 사용자**:
  - 로그인 성공 또는 설정 변경 시 서버 API/Supabase `readers.reader_preferences` 필드로 백그라운드 동기화.
  - 다른 브라우저나 스마트폰에서 로그인 시 기존 설정이 즉시 복원되어 동일한 독서 경험 제공.

---

## 4. UI 및 CSS 변수 바인딩 구조

```css
/* #readerPaper에 적용되는 CSS Custom Properties */
.reader-paper {
  font-family: var(--reader-font, 'Pretendard', sans-serif);
  font-size: var(--reader-font-size, 18px);
  line-height: var(--reader-line-height, 1.8);
  padding-left: var(--reader-padding-x, 20px);
  padding-right: var(--reader-padding-x, 20px);
}

.reader-paragraph {
  margin-bottom: var(--reader-paragraph-gap, 1.2em);
}

/* OLED Black */
.main-view.full-screen-reader.theme-oled {
  background-color: #000000 !important;
  color: #E2E8F0 !important;
}
.main-view.full-screen-reader.theme-oled .reader-paper {
  background-color: #000000 !important;
  color: #E2E8F0 !important;
}
```

---

## 5. 검증 체크리스트
- [ ] 뷰어 설정 모달에서 글꼴을 명조로 변경 시 본문 글꼴이 즉시 변경되는가?
- [ ] 줄간격 및 여백 슬라이더 조절 시 리더 본문에 실시간 반영되는가?
- [ ] OLED 블랙 테마 선택 시 배경이 순수 블랙(`#000000`)으로 렌더링되는가?
- [ ] 브라우저를 새로고침하거나 다음 회차로 넘어가도 개인화 설정이 온전히 유지되는가?
