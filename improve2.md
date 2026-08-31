# 🚀 [Improve Step 2] 콘텐츠 보안 보호 & 유료/광고 회차 본문 분리

## 1. 목적 및 배경
`improve.md` 7, 8항목에서 지적된 "전체 회차 본문 일괄 다운로드(잠긴 본문 노출 취약점)"를 해결하고 메타데이터와 본문을 분리합니다.

---

## 2. 세부 작업 항목

### [작업 2-1] 초기 작품 로드 시 잠긴 본문 일괄 전송 차단
* **대상 파일**: `public/supabase-admin.js` (`fetchWorksFromSupabase`), `public/app.js`
* **내용**:
  - `fetchWorksFromSupabase` 호출 시 `episodes` 테이블에서 `content`(본문) 전체를 불러오지 않고, 메타데이터(제목, 회차번호, 무료여부 등)만 로드.
  - 리더 화면 진입 전 불필요한 대용량 본문 트래픽 및 유료 회차 본문 노출 방지.

### [작업 2-2] 회차 열람 시 안전한 본문 개별 호출 (`getEpisodeContentSecure`)
* **대상 파일**: `public/supabase-admin.js`, `public/app.js` (`openReaderDirect`)
* **내용**:
  - 독자가 실제 회차를 클릭하여 열람할 때만 `get_episode_content` RPC 또는 `episode_contents` 테이블에서 해당 회차의 본문만 실시간 fetch.
  - 무료 회차(1~3화) 또는 유효한 Unlock 권한이 있는 경우에만 본문 반환.

---

## 3. 검증 기준
- [ ] 브라우저 네트워크 탭에서 메인 페이지 로드 시 4~6화 본문이 미리 다운로드되지 않는지 확인.
- [ ] 1~3화 및 언락된 회차 클릭 시 정상적으로 개별 본문이 로드되어 뷰어에 표시되는지 확인.
- [ ] `npx tsc --noEmit` 통과.
