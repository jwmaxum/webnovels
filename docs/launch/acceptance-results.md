# 11단계 인수 검증 결과 — 2026-09-24

판정: **출시 보류**. 이 문서는 현재 작업 트리의 로컬 결과다. 스테이징·운영 서비스, 실제 Supabase/Storage, Cloudflare 배포, PC/모바일 브라우저 인수 결과가 아니다. 시나리오 정의는 [인수 기준](acceptance-scenarios.md), 선행 전환 상태는 [10단계 감사](stage10-cutover-audit.md)를 따른다.

## 로컬에서 실행한 검증

| 구분 | 명령·환경 | 결과와 범위 |
|---|---|---|
| 필수 회귀 | `npm test` / 로컬 Node, mock API, 격리 PGlite | 계정·원고·파일·게시·예약·독자·관리자·RLS 계약. 실서비스 요청 없음. |
| Cloudflare 소스 번들 | `npm run test:cloudflare-bundle` / esbuild Worker 대상 | Pages Functions 진입점 3개가 번들됨. Wrangler 배포·실제 바인딩·라우팅은 미검증. |
| 저장형 XSS 일부 | `node scripts/verify_stage11_xss.test.mjs` / VM | 구 관리자 독자·작가·심사·신고·감사 목록과 독자 작품 카드·댓글의 악성 제목·필명·본문·URL·ID 출력 회귀 4건. 다른 `innerHTML` 호출처 전수 검증은 미완료. |
| 긴 원고 Diff | `node scripts/verify_stage11_performance.test.mjs` / Node | 2만 줄 대 2만 줄 비교 미리보기 202행 이하, 원본 문자열 보존. 실제 편집기 입력·렌더링·자동저장 응답성은 미측정. |
| 빌드 | `npm run build` / 로컬 | Prisma 생성과 TypeScript 빌드. Cloudflare 런타임 검증과 별개. |

`npm test`는 안전한 스크립트만 호출한다. 과거 `scripts/verify_backend.ts`는 SQLite `deleteMany()`와 localhost 서버를 사용하므로 회귀 묶음에서 제외했다. CI는 `npm ci` → `npm test` → `npm run build` 순서이며 검증 실패를 무시하지 않는다. 로컬 PGlite는 테스트 전용 데이터 디렉터리다.

## 아직 실행되지 않은 인수

- [ ] AUTH-01~03: 실제 가입 메일·재설정·만료·계정 변경과 Auth/DB 연계.
- [ ] WORK/DRAFT/FILE/PUB/SCH: 스테이징 DB·private Storage·Cron에서 두 계정/두 기기, 동시성, 중단/재시도, 실제 파일 바이트·서명 URL 검증.
- [ ] READ/MOD/SEC/ADMIN: 실제 역할별 REST/RPC/Storage 우회, 구 URL·캐시, 신고·이의제기와 직접 DB 경로 전수 검증.
- [ ] OPS-01: 실제 DB와 Storage 바이트의 동일 시점 백업 및 격리 복원 훈련.
- [ ] OPS-02: GitHub Actions에서 동일 커밋의 실패 차단 확인, Cloudflare 배포와 환경 바인딩·누락 경로 확인.
- [ ] OPS-03: 실제 PC/모바일 한글 조합, 키보드·포커스·스크롤·버튼·대비·스크린리더 및 장문 입력/자동저장 측정. 프로젝트 규칙상 명시 요청 없이 localhost/브라우저 검증을 실행하지 않았다.
- [ ] OPS-04: 알림 수신자·임계치·보관 기간·지원 채널을 정하고 실제 발화/복구 확인.
- [ ] SEC-05: 모든 저장형 문자열과 URL 출력·파일 경로의 XSS 전수 점검.
- [ ] 성능: `stage8_catalog`는 현재 최대 작품 5,000건과 회차 100,000건을 한 응답에 모으며 `index.html`은 독자·작가·관리자 스크립트를 모두 적재한다. 페이지 단위 API와 역할별 로딩으로 바꾼 뒤 실제 부하·기기 측정을 해야 한다.
- [ ] 계측·정책: 가입/게시 전환·이어쓰기 시간·파일 실패율의 내용 비포함 지표와 이용·개인정보·권리·신고·탈퇴 정책 대조 및 필요한 법적 검토.

10단계 실환경 전환이 끝나지 않아 스테이징 인수의 전제가 없다. [릴리스 체크리스트](release-checklist.md)의 게이트가 모두 충족되기 전 출시 후보로 표시하지 않는다.
