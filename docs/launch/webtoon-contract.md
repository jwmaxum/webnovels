# 웹툰 원고·이미지·열람 계약 — 18단계

2026-10-09. 적용 계획: [improve18](../../improve18.md). 기존 [명칭·신원](author-creator-contract.md), [원고](creator-drafts-contract.md), [파일](creator-files-contract.md), [게시](creator-publication-contract.md), [독자 탐색](reader-discovery-contract.md) 계약을 유지한다.

## 유형과 저장

작품 생성에 `contentType: NOVEL | WEBTOON`을 추가한다. 생략은 NOVEL이다. 작품 유형은 생성 영수증에 포함하며 생성 이후 API에서 변경하지 않는다. Auth UUID, author 프로필 ID, 작품 bigint, 원고/이미지 UUID는 각각 다른 값이다. 작가 신원은 기존 서버 검증 `actor.author`와 최신 DB 계정·소유권이다.

웹툰 원고는 제목·작가의 말과 다음 `webtoon` 객체를 같은 원고 revision에 저장한다. 본문 `content`는 빈 문자열이다. 소설은 기존 본문 계약을 그대로 사용한다.

```json
{
  "schemaVersion": 1,
  "assetIds": ["완료된 원본 이미지 UUID, 표시 순서대로"],
  "thumbnailAssetId": "대표 원본 UUID 또는 빈 원고의 null",
  "credits": {"writer": "글", "artist": "그림", "original": "원작"}
}
```

이미지 UUID는 같은 작품의 READY 파일만 허용한다. 중복, 다른 작품, 미완료, 취소 파일은 거절한다. 빈 원고 저장은 가능하지만 공개·예약은 이미지가 있어야 한다. 대표 이미지는 선택한 원본의 첫 파생 컷이다. 크레딧은 항목별 100자 이하다. 분할 컷은 원본 내 순서를 유지하며 원본 파일 단위로 순서를 변경한다.

DraftEngine은 manifest를 깊은 복사해 IndexedDB 백업·보류 요청·충돌 사본에 보관한다. 기존 `CreatorDraftEditor`의 revision CAS, 요청 UUID, 서버 확인, 게시 후 수정 사본 보존을 사용한다. JSON 키 순서만 달라진 서버 응답은 같은 snapshot으로 비교한다. TXT/DOCX 가져오기는 웹툰을 텍스트 원고로 덮어쓰지 못한다. 내부 5인자 `save_draft` 호환 호출도 기존 manifest를 유지한다.

## 업로드와 재개

새 `/api/v2/creator/webtoon` 경로를 기존 Creator 네임스페이스 안에 추가한다. 모든 작가 요청에는 인증이 필요하다. 변경 요청은 정확한 Origin을 검증한다.

| 요청 | 동작 |
| --- | --- |
| `GET ?workId=…` | 본인 작품 이미지 journal 목록·진행·파생 컷 크기 |
| `POST /upload/{UUID}?workId=…` | raw JPEG/PNG 하나, 같은 UUID의 Idempotency-Key, 인코딩한 X-File-Name |
| `POST /process/{UUID}?workId=…` | 분할 한 개의 WebP/PNG 생성과 완료 기록 |
| `POST /cancel/{UUID}?workId=…` | 취소 tombstone; 최초 업로드보다 먼저 도착해도 적용 |
| `GET /original/{UUID}?workId=…` | 소유자 원본 attachment 다운로드 |
| `GET /panel/{UUID}?workId=…&panelId=…&format=webp 또는 png` | 소유자 미리보기 바이트 |

한 원본은 8 MiB, 변당 12,000px, 12MP 이하인 정적 JPEG/PNG다. 회차는 원본 100개/128 MiB까지다. 베타 보호 한도는 작품별 512개/1 GiB의 원본 journal, 업로드 전 취소 기록 512개다. 보존된 파일도 한도에 포함한다. 한도 조정·페이지네이션은 실제 작가 회차와 저장 비용을 확인한 후 한다. 클라이언트 전체 회차를 Canvas에 decode하지 않으며 원본 bytes를 localStorage나 원고 JSON에 넣지 않는다.

외부 URL, SVG, 애니메이션 PNG, 회전 EXIF 원고는 받지 않는다. 회전된 JPEG 또는 eXIf PNG는 표시 방향을 픽셀에 적용해 메타데이터 없이 다시 내보내도록 안내한다. 작은 원본을 확대하지 않고 최대 폭 800px/컷 높이 4096px로 변환한다. 이 값은 이번 서비스의 보수적 정책값이며 Cloudflare의 높이 한계라는 뜻이 아니다.

원본 헤더·용량·SHA를 먼저 검증하고 immutable private 객체에 저장한다. 처리에서 Images `info(stream)`의 형식·파일 크기·치수를 다시 확인하고, 정수 원본 좌표 `trim` 뒤 `scale-down`을 적용한다. WebP 품질 90, PNG 대체본을 각각 순차 생성한다. 파생본의 실제 치수·형식도 확인한다. 두 포맷이 일치할 때만 컷을 commit한다. 원본 객체는 `authoring-originals`, 파생본은 `authoring-webtoons`의 private bucket이다.

상태는 PREPARED → UPLOADED → PROCESSING → UPLOADED/READY이며 FAILED 재시도와 CANCELLED 종료가 있다. 2분 lease, 분할 cursor, 최대 5회 실패 기록을 사용한다. 만료 후 새 lease를 받은 작업만 이전 작업을 대체할 수 있다. UI는 파일·컷을 순차 요청한다. 탭을 닫으면 자동으로 계속 처리하지 않으며 다음 접속에서 ‘이어서 처리’한다. 재선택이 필요한 원본은 같은 요청 UUID와 SHA로만 재업로드한다.

Storage의 x-upsert=false와 SHA 확인으로 응답 유실을 복구한다. 파생 객체 이름에 결과 SHA를 포함해 인코더 결과가 달라져도 이전 파일을 덮어쓰지 않는다. commit된 컷은 불변이다. 취소는 늦은 작업의 commit을 차단하며 원본과 부분 결과는 삭제하지 않는다. READY 파일·원고 참조 파일은 취소로 삭제하지 않는다. 회차에서 제외하면 새 manifest만 변경한다.

## 게시와 접근

`015_webtoon.sql`은 기존 표·행·URL 배열을 보존하는 증분이다. 원고 revision의 manifest는 publication_versions에 복사되어 현재 head 또는 예약 version에 고정된다. 새 `creator_publications_v18`, `run_creator_schedules_v18`, `stage18_catalog/episode_content/reader/image` RPC는 service_role만 실행한다. 기존 소설용 진입점과 새 기능이 꺼진 예약 실행기는 웹툰 예약을 실패시키지 않고 보류한다.

Reader API는 내부 bucket/path/SHA·원본 참조를 반환하지 않는다. 공개 컷에는 ID·치수·같은 출처 앱 API 주소만 반환한다. `/api/v2/webtoon/images/{episode}/{panel}?versionId=…&format=…`는 요청마다 현재 공개 head에 포함된 컷인지, 작품/회차의 공개·제재·무료·이용등급 상태를 DB에서 확인하고 Storage 바이트를 전달한다. 이전 head, 예약본, 비공개, 철회, PAID, AGE_19는 차단한다. 이번 공개 범위는 ALL/AGE_15의 무료 회차다.

응답은 `private, no-store`, `nosniff`, `Cross-Origin-Resource-Policy: same-origin`이다. CDN/브라우저가 보관하는 Storage signed URL은 독자에게 발급하지 않는다. 만료 토큰에 의존하는 캐시 우회를 없애고 현재 DB 권한으로 판정한다. 이미 내려받은 화면이나 진행 중 응답을 회수한다는 보장은 하지 않는다. 소유자 미리보기 역시 인증 fetch → object URL이며 계정 전환 시 폐기한다.

세로 뷰어는 전체 컷 치수를 먼저 예약한다. 최대 3개 요청, 가까운 컷 5개까지만 바이트를 유지하며 화면 밖 object URL을 폐기한다. WebP decode 실패 시 같은 큐에서 PNG를 요청한다. 실패 컷만 재시도할 수 있다. 위치는 `{versionId,panelIndex,offset}`이며 현재 head와 컷 개수를 DB에서 검증한다. 기존 소설의 paragraph 위치를 재해석하지 않는다. 자리 표시자 상태에서는 진도를 기록하지 않는다. 버전 변경 시 이전 독서 이력은 유지하고 처음부터 표시한다.

## 적용·복구·인수

기본 `WEBTOON_SERVICE_ENABLED=false`다. Pages는 P0·WORKS·DRAFTS·FILES·PUBLISH·READER_SERVICE·READER_DISCOVERY 게이트까지 모두 true일 때만 새 모드를 사용한다. 새 boolean만 공개 설정에 포함한다. Images 바인딩은 기존 표지 처리와 같은 `IMAGES`를 사용한다. 실제 바인딩 없이는 처리하지 않는다.

검토된 014까지의 스키마와 격리 백업·복원 근거를 확인한 뒤, `webnovels.authoring_apply_verified=true` 세션에서 015를 수동 적용한다. 새 bucket이 기존 public bucket이면 적용을 중단한다. 원본 bucket의 기존 restrictive 정책과 새 파생 bucket의 anon/authenticated deny를 유지한다. 실제 DB와 Storage를 이번 코드 작업에서 변경하지 않았다.

중지 시 Pages와 별도 scheduler의 웹툰 플래그를 함께 false로 돌린다. 기존 소설은 유지하고 웹툰 예약·원고·원본은 보존한다. SQL이나 bucket을 삭제해 되돌리지 않는다. 새 manifest 참조는 별도 FK 표로 보호되며 기존 파일 cleanup 대상이 아니다. 웹툰 자동 삭제 기능은 없다. DB+원본+파생본을 함께 백업해야 한다.

기존 외부 URL 배열은 검토 이관 대상이다. URL을 서버에서 가져오거나 빈 본문을 이유로 삭제하지 않는다. 기존 공개 웹툰을 편집할 때 manifest가 없으면 명시적인 검토 안내로 막는다. 원본 출처·권리·정렬을 확인하고 작가가 원본을 업로드한 새 버전을 검토한다. 비공개 웹툰의 관리자 이미지 예외 열람은 17단계의 감사된 텍스트 열람을 확장하지 않았으며, 별도 사유·범위·감사 계약을 갖춘 후 제공해야 한다.

로컬 대역/합성 DB·단위 검증과 실제 서비스 인수는 구분한다. 19단계에서 실제 JPEG/PNG, EXIF, 투명도·색감·가독성·1px 경계, 느린 업로드·lease 만료·Storage 응답 유실, 공개 철회/CDN 규칙, PC·모바일 메모리/복원·접근성, 예약 경쟁 및 DB/Storage 복원을 확인한다. localhost/브라우저 검증은 사용자 명시 요청 후 수행한다. 이 근거가 없으면 웹툰 운영 출시를 완료로 표시하지 않는다.

## 재사용 조사 근거

기존 Images 바인딩이 private bytes와 연속 변환을 지원하므로 신규 패키지 없이 확장했다. [Cloudflare Images binding](https://developers.cloudflare.com/images/optimization/binding/), [trim 규격](https://developers.cloudflare.com/images/optimization/features/#trim), [형식·크기 제한](https://developers.cloudflare.com/images/get-started/limits/), [공식 타입](https://github.com/cloudflare/workerd/blob/main/types/defines/images.d.ts)을 확인했다.

Storage 서명 토큰 만료와 CDN cache TTL은 별개이므로 공개 철회는 매 요청 앱 프록시 검증으로 구현했다. [Supabase Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn#signed-urls-and-cdn-caching), [Storage 접근 제어](https://supabase.com/docs/guides/storage/security/access-control)를 참조한다. 실제 CDN 설정의 캐시 우회 여부는 별도 인수가 필요하다.
