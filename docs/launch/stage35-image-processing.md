# 35단계 — 비공개 이미지 처리 Worker

2026-10-22. 웹툰 원본·분할 이미지와 표지는 Supabase private Storage에 보관한다.
Pages는 `IMAGE_PROCESSOR` Service binding으로 별도 `webnovels-image-processor` Worker를
호출한다. Worker에만 `IMAGES`를 연결한다. 전용 `IMAGE_PROCESSOR_SHARED_SECRET`을 양쪽의
암호화 secret으로 설정하여 호출을 검증한다. 기존 소유권·용량·원본 검증·공개본 검증은
Pages API에 그대로 있으며, 이미지 Worker에는 Storage/Auth/API 비밀을 전달하지 않는다.

## 선택 근거

Cloudflare 공식 [Pages 지원 바인딩](https://developers.cloudflare.com/pages/functions/bindings/)은
Service binding을 지원한다. Images는 그 지원 목록에 없으며
[Images 문서](https://developers.cloudflare.com/images/optimization/binding/)는 Worker별 바인딩을
명시한다. 따라서 Pages에서 `env.IMAGES`가 존재할 것으로 가정하지 않는다.
기존 Worker 및 테스트에서 쓰는 직접 `IMAGES` 경로는 호환 유지한다.

[Images 가격](https://developers.cloudflare.com/images/pricing/)의 무료 변환 한도를 이용할 수 있다.
2026-10-22 확인 기준 월 5,000개 고유 변환이며 `.info()`는 무료다. 이 구현은 Images 유료 저장소를
이용하지 않는다. 계정의 사용량과 실제 바인딩 사용 가능 여부는 배포 시 확인해야 한다.
무료 한도 초과나 제공자 장애 시 업로드를 성공으로 처리하지 않고 재시도 가능한 실패로 남긴다.

## 배포와 검증

1. 아래 배포 도구를 우선 사용한다. 수동 CLI 배포를 사용할 경우 전용 256비트 랜덤 secret을
   먼저 양쪽에 설정하고 `wrangler deploy --config image-worker/wrangler.toml`로 배포한다.
   `workers_dev=false`, `preview_urls=false`를 유지하고 public route/custom domain을 추가하지 않는다.
2. Pages production의 Service binding 이름을 `IMAGE_PROCESSOR`, 대상 Worker를
   `webnovels-image-processor`로 설정하고 Pages를 재배포한다. Preview는 독립 설정을 사용한다.
3. `authoring-originals`, `authoring-covers`, `authoring-webtoons` 세 버킷이 private인지 확인한다.
   Storage SQL/RLS와 무료 공개 마이그레이션을 적용하고 서버 API를 통해서만 파일을 읽는다.
4. 실제 Auth 세션으로 표지 600×900 업로드, 긴 웹툰 두 장의 순차 처리·공개·본문 이미지 조회,
   취소/재시도 및 공개 후 변경 검토를 인수한다. 사용자 요청 없는 브라우저 시험은 실행하지 않는다.

Worker는 원본 바이트만 받으며 원격 URL을 가져오지 않는다. `/info`, `/cover`, `/panel`만 처리하고
크기·픽셀·MIME·분할 위치·출력 치수를 다시 검사한다. 실패 응답에 제공자 진단을 노출하지 않는다.
`image-processor.internal` 호스트 검사는 요청 형식 검사이며 인증 장치가 아니다. 외부 라우트 없는
Cloudflare Service binding과 전용 secret이 접근 경계다.

단위 테스트는 메모리의 Images 대역으로 요청 프로토콜과 실패 동작을 검사한다. 실제 이미지
디코딩·Cloudflare 바인딩·Storage 파일·브라우저 인수의 성공을 대신하지 않는다.

## 반복 가능한 Cloudflare 설정 도구

`node scripts/configure_stage35_cloudflare.mjs`는 읽기 전용 점검이 기본값이다.
인증은 `.env.local`의 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`만 사용한다.
계정의 Pages 프로젝트 목록에서 `webnovels-db4.pages.dev`가 유일하게 일치하는 항목을 찾고
GitHub `jwmaxum/webnovels`, `main`을 검증한 뒤 실제 프로젝트 이름으로 호출한다.
사이트의 subdomain을 프로젝트 이름으로 추정하지 않는다.

- `--apply`: 이미지·예약 Worker, 매분 Cron, Pages production Service binding, 제공자 설정용
  암호화 master key를 준비한다. 공개·회원가입 플래그를 새로 켜지 않는다.
- `--apply --activate`: 위 준비와 함께 무료 서비스 플래그를 활성화한다. 같은 DB의 최근
  `artifacts/stage35-auth-config.json`에서 SMTP/확인메일/공개 redirect 설정 적용과 검증을
  확인하고, 실제 `new_serials_ready()`가 true여야 한다. 메일 설정 존재가 실제 배달 성공을
  증명하지는 않으며 별도 가입·수신 인수가 필요하다.

신규 Worker는 404만 반환하는 모듈로 먼저 생성하고 workers.dev/preview를 닫은 다음 실제
모듈·바인딩을 올린다. 기존 Worker의 공용 route/custom domain이 발견되면 적용을 중단한다.
새 Worker만 만드는 첫 실행은 Zone 권한을 요구하지 않는다. 기존 Worker 감사에는 그 계정의
Zone Read/Worker Routes Read가 추가로 필요하다. Pages Edit/Workers Scripts Edit는 기본적으로 필요하다.

Pages의 무관한 변수·비밀·preview 설정은 보존한다. 제공자 master key는 한 번만 생성하고
기존 키를 자동 교체하지 않는다. 생성한 키와 변경 전후 원본 설정은 Git 제외 경로
`scratch/launch/cloudflare-stage35/`에 저장되며, 콘솔과 공개 보고에는 키를 쓰지 않는다.
이 비공개 키 파일을 보호하여 백업하고 잃어버린 경우 임의로 새 키를 생성하지 않는다.
부분 실패 시 단계별 보고를 남기며, 성공 후에도 Pages 재배포와 실제 API 인수를 확인해야 한다.

API 계약 근거는 [Worker 업로드](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/),
[Cron 갱신](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/update/),
[Pages 설정](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/)과
[Wrangler의 비밀 부분 PATCH 구현](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/pages/secret/index.ts)이다.
