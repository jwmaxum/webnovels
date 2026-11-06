# 독자 작품 정보 번역 운영 계약

ML-01·02의 작품 정보는 승인된 작품 제목, 소개, 검색어와 회차 제목으로 구성한다. 독자 화면의 한국어·영어·일본어·중국어 간체 설정은 인증이나 열람 권한에 영향을 주지 않는다.

## 공개 응답과 검색

- `GET /api/v2/catalog?action=home|list|work|episodes|chapter`와 `GET /api/v2/display`가 선택적 `locale=ko|en|ja|zh-Hans`를 받는다. 값을 생략한 기존 요청의 동작과 한국어 요청의 커서를 보존한다. 다른 언어의 커서는 해당 언어로 새 검색을 시작해야 한다.
- 허용된 원본 항목에 번역이 있으면 `localization`에 `{locale, sourceLocale, title, description?}`을 추가한다. 원래 제목·소개·회차 및 ID가 유지되고 권리, 본문, 승인 근거, 검색 키워드는 번역 응답에 포함하지 않는다.
- 현재 공개 범위를 통과한 작품을 대상으로 원제, 작가명, 원문 소개, 선택 언어의 승인된 제목·소개·키워드와 현재 공개 무료 회차의 승인 제목을 검색한다. 유니코드 호환 정규화와 소문자 변환 후 연속 부분 문자열을 비교한다. 띄어쓰기 없는 일본어·중국어 질의와 전각 로마자 혼용을 지원한다. 검색어를 SQL 와일드카드로 해석하지 않는다. 공개 조건·장르·태그·정렬은 기존 탐색 계약을 적용하고, 검색 조건은 커서 페이지 경계 전에 평가한다.
- 작품 정보는 승인 당시 제목과 소개가 둘 다 현재 원문과 일치할 때만 사용한다. 회차 제목은 해당 회차의 현재 공개본 UUID와 일치할 때만 사용한다. 작품/회차가 비공개로 바뀌면 원래 탐색 범위를 따르며 번역도 노출되지 않는다.

## 승인된 정보 반영

1. 실제 DB의 백업·복원, `authoring-015` 이력과 서비스 역할을 격리 환경에서 대조한 뒤 [032 마이그레이션](../../database/authoring/032_reader_catalog_localization.sql)을 적용한다. 운영 사용 전 `service_role` RPC 실행과 `anon`, `authenticated`의 RPC 및 테이블 접근 거절을 확인한다. 배포 시 기본값은 원문 제공이다.
2. 편집 담당자가 원제·소개·대상 회차의 현재 공개본 UUID를 기록한다. 작가와 번역 문구·언어·검색어를 검수하고 승인 참조를 발급한다. 미검수 초안은 이 저장소에 올리지 않는다.
3. DB 소유자 작업으로 `authoring.reader_work_translations`에 작품 ID, 목표 언어, 원문 언어, 승인 시점의 제목·소개, 현지어 제목과 선택적 소개·키워드, 승인 참조를 넣는다. `authoring.reader_episode_translations`에는 회차 ID, 정확한 공개본 UUID, 원문·목표 언어, 현지어 제목과 승인 참조를 넣는다. 변경할 때는 현재 원본과 검수본을 대조해 작품별·언어별 행을 교체한다. 회차의 승인 행은 공개본 UUID별로 남길 수 있다. 승인 참조에는 비밀이나 개인정보 대신 운영 기록 키를 사용한다.
4. 검토된 데이터로 검색과 원문 대체를 확인한 환경에서만 `READER_METADATA_LOCALIZATION_ENABLED=true`를 설정한다. 이 값 없이 배포한 경우 기존 카탈로그 RPC가 원문을 제공한다. 번역 철회는 해당 승인 행을 제거하고 카탈로그에서 노출 여부를 재검증한다. 기능 전환에는 독자 계정이나 원문 변경이 필요 없다.

검증은 `node --test scripts/verify_reader_catalog_localization.test.mjs`로 실행한다. PGlite에 합성 작품·공개본·권한을 구성하고 현지어 검색과 원문 대체, 현재 공개본 대조, 커서 분리, 요청 중 언어 변경을 검증한다. 실제 승인 번역과 운영 DB 반영은 콘텐츠 검수 절차에서 이루어진다.

## 소유자 반영 예시

다음 SQL은 미리 검토한 원문과 승인 정보를 `psql` 변수로 전달하는 작업 템플릿이다. 아래 문장에 원문이나 승인 근거를 직접 이어 붙이지 않는다. 승인 근거 기록과 작업 결과를 대조하고 `RETURNING` 행이 정확히 하나일 때만 커밋한다. 소개가 없는 원문·번역은 별도 표시 변수 `source_has_description`, `translation_has_description`를 `false`로 전달한다. 키워드는 쉼표로 구분한 검수 문구를 사용한다.

```sql
begin;
with approved_source as (
 select id, title, description
 from public.works
 where id = :'work_id'::bigint
   and title = :'reviewed_source_title'
   and description is not distinct from case when :'source_has_description'::boolean then :'reviewed_source_description' end
 for share
)
insert into authoring.reader_work_translations
 (work_id, locale, source_locale, source_title, source_description, title, description, keywords, approval_ref)
select id, :'target_locale', :'source_locale', title, description, :'approved_title',
 case when :'translation_has_description'::boolean then :'approved_description' end,
 string_to_array(:'approved_keywords_csv', ','), :'approval_ref'
from approved_source
on conflict (work_id,locale) do update
 set source_locale=excluded.source_locale, source_title=excluded.source_title,
 source_description=excluded.source_description, title=excluded.title, description=excluded.description,
 keywords=excluded.keywords, approval_ref=excluded.approval_ref, approved_at=now()
returning work_id, locale, approved_at;
```

회차 제목은 검수 당시 공개본이 여전히 head인지 확인한 뒤 기록한다. 원문 변경으로 `RETURNING` 행이 없으면 롤백하고 변경본을 다시 검수한다.

```sql
begin;
with approved_head as (
 select h.episode_id, h.version_id
 from authoring.publication_heads h
 join authoring.publication_versions v on v.id=h.version_id and v.episode_id=h.episode_id
 where h.episode_id = :'episode_id'::bigint
   and h.version_id = :'reviewed_version_id'::uuid
   and v.title = :'reviewed_source_title'
 for share of h
)
insert into authoring.reader_episode_translations (episode_id,version_id,locale,source_locale,title,approval_ref)
select episode_id, version_id, :'target_locale', :'source_locale', :'approved_title', :'approval_ref'
from approved_head
on conflict (episode_id,version_id,locale) do update
 set source_locale=excluded.source_locale, title=excluded.title,
 approval_ref=excluded.approval_ref, approved_at=now()
returning episode_id, version_id, locale, approved_at;
```
