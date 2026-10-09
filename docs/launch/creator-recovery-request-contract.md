# 가져온 원고의 원래 회차 복구 검토 요청 — 28단계

이 경로는 작가가 원본 파일·저장된 원고 버전·대상 회차 관계를 명시하는 **비공개 검토 요청**이다.
권리 승인, 복구 승인, 회차 발행 또는 무료 서비스 전환 결과가 아니다.
[Author/Creator](author-creator-contract.md), [원고](creator-drafts-contract.md),
[파일](creator-files-contract.md), [게시](creator-publication-contract.md),
[원본 검토](content-review-restore-contract.md)의 소유권·보존 계약을 확장한다.

## 사용자 흐름

CreatorFiles의 저장 완료 원고와 서버 원본 목록에서 `원래 회차 복구 검토`를 선택한다.
같은 작품의 저장 원고를 기존 CreatorDraftEditor로 열고, 기존 서버 동기화/IME/seq/revision
검증을 마친 저장본만 검토한다. 파일명·회차 번호·제목으로 대상을 추정하거나 기본 선택하지 않는다.
작가가 원본 파일과 회차를 직접 선택하고 저장 버전·원본 연결 버전과 요청의 의미를 확인한다.
선택 후 입력/계정/작품/원고가 바뀌면 새 요청을 보내지 않는다. 회차 목록은 ID 문자열 cursor로
100개씩 더 불러오며 조용히 잘라내지 않는다. 응답 유실은 당시 키/요청으로 다시 확인한다.

기존 `fileImports` IndexedDB에 `kind=recovery`인 별도 메타데이터 journal을 보존한다.
업로드 queue는 import/cover만 처리한다. 원본 bytes/기존 작업·초안/backup은 덮어쓰거나 지우지 않는다.
user UUID·work ID·draft UUID로 격리하며 다른 계정에서는 표시하지 않는다. 늦은 성공 응답은
당시 계정 journal에 receipt를 보존하고 현재 다른 계정/원고 화면에는 표시하지 않는다.
인증/소유권 오류는 과거 요청 성공 여부를 증명하지 않으므로 PENDING과 같은 키를 유지한다.
receipt 조회 뒤 확정된 원고/회차/원본 충돌만 REJECTED로 보존하며 새 검토는 명시적으로 다시 연다.

## API 및 불변 증거

기존 `/api/v2/creator/drafts/:uuid/recovery?workId=:bigint` GET/POST를 확장한다.
GET의 `before`는 이 suffix에서만 회차 ID의 after cursor다. GET은 저장 버전·적격 원본
메타데이터·회차 ID/번호/제목/변경 토큰과 최근 20개 요청을 반환한다. 원문과 Storage 경로는 반환하지 않는다.
POST는 Origin·UUID Idempotency-Key와 정확한 필드 `expectedRevision`, `fileId`, `episodeId`,
`targetDigest`, `note`(최대 2,000자), `confirmed=true`만 받는다. 소유자·SHA·상태·본문·권리 승인은 받지 않는다.

`019_creator_recovery_requests.sql`은 reviewed 007 이후의 additive, service-only RPC다.
서버에서 Auth 활성성·APPROVED Author·작품/원고/회차/원본 소유권을 검증한다.
새 요청은 CLEAR/미휴지통 작품, NOVEL, ACTIVE/미연결 초안, 정확한 current revision이 필요하다.
잠금 순서는 author → work → work_state → draft → episode → 원본/업로드 참조다.
원본은 같은 user/work/draft의 IMPORT·COMMITTED job, MANUSCRIPT_ORIGINAL/private bucket,
미휴지통 파일 및 `revision_files` lineage가 필요하다. 이후 수정 버전에도 초기 원본 연결은 유효하다.
현재 revision과 원본 연결 revision을 구분하며 원본 SHA-256/크기는 서버 DB에서 가져온다.
본문 버전은 기존 불변 draft_revisions FK로, 원본 연결은 revision_files FK로 보존한다.

회차의 legacy 행·보호 본문·공개 head·alternate 본문 전체 snapshot을 잠그고 MD5 변경 토큰을
비교한다. 이 토큰은 권리나 원본 checksum이 아니다. 제출 시 정확한 대상 snapshot을 private
요청에 고정한다. 같은 user/key의 정확한 payload 재전송은 계정/소유권을 재확인한 뒤 최초
receipt를 반환하며 이후 수정/휴지통 상태에도 재제출하지 않는다. 같은 키의 다른 payload는 409다.
요청 테이블은 RLS·직접 SELECT/INSERT/UPDATE/DELETE 권한 폐쇄(service_role 포함)와
불변 trigger로 보호된다. RPC만 service_role 실행을 허용한다.

`drafts.episode_id`, 원고 본문/포인터, 공개 회차, publication_versions/heads, 예약, 권리/등급/AI,
성장 지표와 원본 파일을 변경하지 않는다. 요청 상태는 PENDING만 가능하며 관리자 승인/적용은
후속 단계의 별도 감사 결정으로 추가한다. 기존 begin-edit/publish 게이트나 출시 NO_GO를 우회하지 않는다.

## 활성화와 검증 한계

기존 파일/원고 prerequisite와 P0에 더해 `AUTHOR_RECOVERY_ENABLED=true`를 별도로 검토해야 한다.
public config에는 prerequisite가 모두 정확히 true일 때만 `authorRecoveryEnabled`를 전달한다.
기본은 비활성이고 28단계에서 실제 SQL/플래그를 적용하지 않았다. 롤백은 이 플래그를 내려
신규 요청을 닫고 기존 원본/초안/요청/receipt를 보존한다. 019는 이 선택 기능의 추가 prerequisite이며
기존 무료 전환 마이그레이션 목록을 적용 완료로 바꾸거나 생성 SQL을 임의 교체하지 않는다.

Node VM/DOM·API 대역·PGlite 합성 PostgreSQL에서 권한/타입/lineage, revision/본문 변경,
불변성/멱등성과 늦은 응답을 검증한다. 실제 작가 파일, 브라우저/기기 사용성, 운영 적용 및
격리 hosted DB/Auth/Storage 인수는 별도다. 실제 원본·권리/이미지·등급/AI 결정을 확보한 뒤
29단계에서 운영자 검토·새 snapshot 정합화와 검토된 무료 전환으로 연결한다.
