# [Improvement Step 1] 계층적 Semantic URL 라우팅 및 딥링크 체계

## 1. 개요 및 목적
독자 서비스, 작가센터, 관리자 관제탑을 URL 수준에서 명확히 분리하고, 특정 회차 열람(`/read/:workId/:epNum`), 작가 회차 등록(`/creator/episodes`), 관리자 회원 관리(`/admin/users`) 등으로 직접 접근할 수 있는 **Semantic URL Deep Linking & SPA History Router**를 구축합니다.

---

## 2. 라우트 매핑 테이블 (Route Mapping Specification)

### 2.1 독자 서비스 (Reader Domain)
| URL 경로 | 매핑 화면 / 뷰 | 비즈니스 로직 및 파라미터 처리 |
| :--- | :--- | :--- |
| `/` 또는 `/home` | `view-home` | 메인 홈 (계속 읽기, 인기/최신 6열 그리드) |
| `/discover` | `view-discover` | 장르별/키워드별 작품 탐색 |
| `/works/:id` | `view-work-detail` | 작품 상세 페이지 (`openWorkDetail(id)`) |
| `/read/:workId/:epNum` | `view-reader` | 해당 작품의 특정 회차 뷰어 즉시 열람 (`openEpisode(workId, epNum)`) |
| `/library` | `view-mypage` | 내 서재 (기본: 이어보기 탭) |
| `/library/:tab` | `view-mypage` | 내 서재 서브탭 (`continue`, `favorites`, `authors`) 직접 활성화 |

### 2.2 작가센터 (Creator Portal)
| URL 경로 | 매핑 화면 / 뷰 | 권한 및 파라미터 처리 |
| :--- | :--- | :--- |
| `/creator` | `view-creator` | 작가 스튜디오 대시보드 (풀스크린 모드) |
| `/creator/works` | `view-creator` | 내 연재 작품 관리 탭 (`works`) |
| `/creator/episodes` | `view-creator` | 신규 회차 등록 & AI Zero-Touch 자동발행 탭 (`new-ep`) |
| `/creator/status` | `view-creator` | 연재 상태(연재중/휴재/완결) 설정 탭 (`status`) |
| `/creator/stats` | `view-creator` | 독자 통계 및 완독률 지표 탭 (`stats`) |
| `/creator/settlement` | `view-creator` | 광고/판매 수익 및 정산 신청 탭 (`settlements`) |

### 2.3 관리자 관제탑 (Admin CMS)
| URL 경로 | 매핑 화면 / 뷰 | 권한 및 파라미터 처리 |
| :--- | :--- | :--- |
| `/admin` | `view-admin-cms` | 관제탑 01. Dashboard (`dashboard`) |
| `/admin/users` | `view-admin-cms` | 02. 회원 및 권한 관리 탭 (`users`) |
| `/admin/authors` | `view-admin-cms` | 03. 작가 승인 및 관리 탭 (`authors`) |
| `/admin/works` | `view-admin-cms` | 04. 작품 운영 및 승인 탭 (`works`) |
| `/admin/episodes` | `view-admin-cms` | 05. 회차 및 5대 검수 콘솔 탭 (`episodes`) |
| `/admin/settlements` | `view-admin-cms` | 06. 정산 승인 및 집행 탭 (`settlements`) |
| `/admin/reports` | `view-admin-cms` | 08. 신고 및 제재 관리 탭 (`reports`) |

---

## 3. 세부 아키텍처 및 구현 방안

### 3.1 서버 사이드 와일드카드 라우팅 (`src/app.ts`)
Express에서 모든 계층적 프론트엔드 라우트에 대해 `public/index.html`을 반환하도록 설정:
```typescript
app.get([
  '/',
  '/home',
  '/discover',
  '/works/:id',
  '/read/:workId/:epNum',
  '/library',
  '/library/:tab',
  '/creator',
  '/creator/:sub',
  '/admin',
  '/admin/:sub'
], (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
```

### 3.2 클라이언트 사이드 SPA 라우터 엔진 (`public/app.js`)
1. **`navigateTo(path, pushState = true)`**:
   - `window.history.pushState(null, '', path)` 실행
   - `resolveRoute(path)`를 호출하여 파라미터 추출 및 해당 뷰/탭/데이터 바인딩 실행
2. **`resolveRoute(pathname)`**:
   - 정규식 및 경로 분할을 통한 URL 파싱
   - `/works/:id` 파싱 -> `openWorkDetail(id)`
   - `/read/:workId/:epNum` 파싱 -> `openEpisode(workId, epNum)`
   - `/creator/:sub` 파싱 -> `switchWebNovelsView('view-creator')` + `switchCreatorTab(sub)`
   - `/admin/:sub` 파싱 -> `switchWebNovelsView('view-admin-cms')` + `switchAdminSubTab(sub)`
3. **`popstate` 이벤트 연동**:
   - 브라우저 뒤로가기/앞으로가기 시 완벽한 화면 및 상태 복원
