QL이 현재 JS보다 앞서 있습니다. supabase-setup.sql은 episode_contents, episode_panels, author_private_profiles, author_settlement_accounts, works.author_id 등의 새 구조를 갖고 있지만, JS는 여전히 password_hash, episodes.content, episodes.image_urls, ad_unlocks, author_name, bank_info 등을 참조합니다. SQL의 현재 구조를 보면 이 새 테이블들이 존재하고 works.author_id가 정의되어 있습니다.

따라서 현재 그대로 배포하면 일부 기능은 정상 작동하지만, 핵심 기능 상당수가 실패하거나 보안상 잘못 동작할 가능성이 높습니다.

1. 최종 판정
영역	판정	상태
Supabase 접속	✅	정상
작품 조회	⚠️	일부 정상
작품 등록	⚠️	DB와 필드 불일치
회차 조회	❌	구스키마 참조
독자 로그인	❌	Supabase Auth와 불일치
작가 로그인	❌	Supabase Auth와 불일치
관리자 로그인	❌	현재 SQL과 불일치
독서이력	❌	UUID/JSONB 구조 불일치
관심작품	⚠️	구조 일부 일치
작가 구독	✅/⚠️	구조는 맞지만 인증 문제
광고 Event	❌	Client가 임의 생성 가능
광고 Unlock	❌	SQL 구조와 JS 구조 불일치
광고수익	❌	실제 광고수익 자동계산 아님
작가 수익	❌	SQL/JS 필드와 계산방식 불일치
정산	❌	보안/필드/ID 불일치
콘텐츠 검수	❌	컬럼명이 다름
Realtime	⚠️	JS는 있지만 SQL publication/권한 검증 필요
영구 데이터	⚠️	일부는 DB에 남지만 전체 거래 Chain 미완성
2. 가장 심각한 문제는 SQL과 JS의 스키마가 다르다는 것입니다

현재 SQL의 authors는:

id
auth_user_id
username
pen_name
profile_image
bio
status
...

입니다.

그런데 JS에서는:

authors.password_hash
authors.email
authors.bank_info

등을 참조합니다. 실제 readerLogin()과 authorLogin()도 password_hash를 이용합니다.

즉 현재 SQL에 맞추면:

authors.password_hash

자체가 없기 때문에 작가 로그인은 정상적으로 작동할 수 없습니다.

독자도 마찬가지입니다.

SQL의 readers는 auth.users.id를 PK로 사용하는 구조인데, JS는 여전히 readers.password_hash를 읽습니다.

결론

Reader/Author 인증 부분은 반드시 Supabase Auth로 재작성해야 합니다.

3. 관리자 인증도 현재 SQL과 맞지 않습니다

현재 SQL의 admin_users에는 아직도:

password_hash TEXT NOT NULL DEFAULT '!123456'

가 있습니다.

반면 JS는:

supabaseClient.rpc('verify_admin_login', ...)

을 호출합니다.

그런데 제공된 SQL에는 verify_admin_login() 함수가 없습니다.

SQL에 존재하는 것은:

create_admin_user()
get_sub_admins()
delete_sub_admin()

뿐입니다.

즉:

JS → verify_admin_login()
SQL → 없음

입니다.

그리고 RPC가 실패하면 JS가 admin_users를 직접 조회하도록 되어 있습니다.

그런데 이것도 Production 보안 구조로는 적절하지 않습니다.

4. admin_users의 가장 큰 보안 문제가 아직 남아 있습니다

SQL에서:

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.admin_users
TO anon, authenticated, service_role;

가 존재합니다.

이것은 이전에 제거하자고 했던 위험한 구조가 현재 업로드한 SQL에도 그대로 남아 있다는 뜻입니다.

더구나 JS는:

.from('admin_users')
.select('*')

로 접근합니다.

따라서 현재 파일 조합은 Production 보안 기준을 충족하지 못합니다.

5. create_admin_user()도 지금 상태로는 Production용이 아닙니다

SQL:

SECURITY DEFINER

인데:

SET search_path = ''

가 없습니다. 그리고:

GRANT EXECUTE ... TO anon, authenticated, service_role;

입니다.

특히 anon에게 관리자 생성 RPC를 실행할 수 있게 한 것은 매우 위험합니다.

현재 코드 역시 이 RPC를 일반 브라우저에서 호출합니다.

이것은 반드시 변경해야 합니다.

관리자 생성은:

Admin Browser
        ↓
Secure Admin API / Edge Function
        ↓
Supabase Service Role
        ↓
admin_users

구조로 바꾸는 것이 맞습니다.

6. works.author_id는 좋은 방향이지만 JS가 아직 구버전입니다

SQL:

works.author_id

가 있습니다.

JS의 createWorkInDB()는:

author: ...

를 여전히 넣고 있고, 뒤에서 조건부로 author_id를 넣습니다.

문제는 works의 Production schema에는 author 컬럼이 없습니다.

따라서 이 부분:

author: typeof workData.author === 'string'
  ? workData.author
  : ...

은 제거해야 합니다.

올바른 구조
{
  title,
  author_id,
  content_type,
  genre,
  tags,
  ...
}

입니다.

7. 가장 치명적인 부분: Episode

SQL은 이미:

episodes
episode_contents
episode_panels

으로 분리했습니다.

그런데 JS는 아직:

.from('episodes')
.select('id, work_id, episode_number, title, is_free, is_ad_free, content, image_urls,...')

를 사용합니다.

그리고:

content: ep.content
imageUrls: ep.image_urls

를 사용합니다.

즉:

SQL
episodes.content ❌
episodes.image_urls ❌

JS
episodes.content ✅라고 가정
episodes.image_urls ✅라고 가정

입니다.

이건 즉시 수정해야 합니다.
8. fetchEpisodeContentSecure()는 이름만 Secure입니다

현재 코드가:

RPC
 ↓ 실패
episode_contents 직접 SELECT
 ↓ 실패
episodes.content 직접 SELECT

순서입니다.

특히 마지막:

.from('episodes').select('content')

은 현재 Production SQL에는 아예 해당 컬럼이 없습니다.

더 중요한 것은:

RPC가 실패했다고 해서 보호된 데이터를 직접 조회하는 Fallback을 두면 안 됩니다.

즉:

Secure RPC 실패
→ Public Table 직접 SELECT

구조는 제거해야 합니다.

9. 광고 Unlock은 현재 SQL과 완전히 맞지 않습니다

SQL:

episode_unlocks
 ├─ user_id UUID
 ├─ episode_id BIGINT
 ├─ unlock_type
 ├─ source_event_id UUID
 ├─ granted_at
 ├─ expires_at
 └─ status

입니다.

그런데 JS는:

ad_network
ad_event_id
unlocked_at

을 INSERT합니다.

즉:

SQL: source_event_id
JS:  ad_event_id

SQL: granted_at
JS:  unlocked_at

입니다.

직접적인 schema mismatch입니다.

10. ad_unlocks는 SQL에 없는데 JS가 사용합니다

JS:

.from('ad_unlocks')
.upsert(...)

를 실행합니다.

그런데 현재 supabase-setup.sql에는 ad_unlocks 테이블이 없습니다.

따라서 이 쿼리는 실패합니다.

물론 .catch(() => {}) 때문에 개발자가 오류를 눈치채지 못할 수도 있습니다.

이런 패턴도 좋지 않습니다.

실패를 숨기는 catch(() => {})는 Production 코드에서는 핵심 DB 작업에 사용하지 않는 것이 좋습니다.

11. 광고 보안은 아직 해결되지 않았습니다

현재:

logAdEvent(...)

가 Browser에서 직접 ad_events INSERT합니다.

그리고:

reward_granted:
  eventType === 'REWARD' || eventType === 'COMPLETE'

로 판단합니다.

이것은 사용자가 브라우저에서 직접:

COMPLETE
REWARD

를 호출할 수 있다는 의미입니다.

따라서 실제 광고를 보지 않아도 Reward를 발생시키는 공격 가능성이 있습니다.

현재 구조는:
Browser
 ↓
logAdEvent()
 ↓
DB
변경해야 하는 구조:
Browser
 ↓
Ad Network
 ↓
Server Side Verification
 ↓
Edge Function
 ↓
ad_events
 ↓
episode_unlocks

입니다.

12. unlockEpisodeWithAdSecure()도 실제로 Secure하지 않습니다

함수 이름은 Secure이지만:

logAdEvent(... 'COMPLETE', ..., 20)

를 먼저 실행합니다.

그리고 그 ID를 가지고 Unlock RPC를 호출합니다.

문제는 광고 서버가 이 이벤트를 검증한 것이 아니라 브라우저가 직접 만든 이벤트라는 점입니다.

즉:

JS 함수 이름 = Secure
실제 보안 = ❌

입니다.

13. 가장 위험한 부분 중 하나: 광고수익이 임의의 숫자입니다

현재:

revenue: 20

을 사용합니다.

그리고 allocateRevenue()에서는:

Number(e.revenue || 20)

를 사용합니다.

즉 광고수익이 실제 광고 네트워크의 실적이 아니라:

"광고 한 번 = 20"

으로 계산될 수 있습니다.

이것은 실제 회계용 Revenue Engine이 아닙니다.

14. 더 큰 문제: 작가 수익을 작가 수로 균등 분배합니다

현재:

const perAuthorPool = Math.floor(writerPool / authors.length);

입니다.

즉 작가 30명이 있으면:

Writer Pool ÷ 30

으로 동일하게 나눕니다.

작품별 조회수/광고완료/기여도와 무관합니다.

따라서:

작품 A 광고 100만회
작품 B 광고 10회

여도 두 작가가 동일한 금액을 받을 수 있습니다.

현재 사용자가 기획한 사업 모델의 작가별 광고 기여수익 배분 구조와 맞지 않습니다.

15. author_earnings INSERT 컬럼도 SQL과 다릅니다

SQL:

author_earnings
 ├─ author_id
 ├─ work_id
 ├─ period_date
 ├─ gross_revenue
 ├─ platform_fee
 ├─ author_revenue
 └─ status

입니다.

그런데 JS:

author_name
settlement_status

를 넣습니다.

즉 이것도 schema mismatch입니다.

16. period_date = ${periodMonth}-28도 잘못된 설계입니다

현재:

period_date: `${periodMonth}-28`

입니다.

예를 들어:

2026-02 → 2026-02-28
2026-03 → 2026-03-28

로 기록합니다.

월별 정산을 나타내기 위해 임의의 28일을 사용하는 것은 좋지 않습니다.

revenue_periods.period_month와 명확하게 연결하거나:

period_month = 2026-08-01

같은 기준을 사용해야 합니다.

17. 정산도 현재 JS와 SQL이 충돌합니다

SQL:

author_settlements
 ├─ author_id
 ├─ author_name_snapshot
 ├─ bank_name_snapshot
 ├─ account_number_snapshot
 ├─ account_holder_snapshot
 ├─ amount
 └─ status

입니다.

그런데 JS는:

author_name
bank_info

등을 INSERT합니다.

즉 직접 INSERT는 실패할 가능성이 높습니다.

18. requestSettlementSecure()의 Fallback도 삭제해야 합니다

현재:

RPC 실패
 ↓
requestSettlement()
 ↓
직접 INSERT

입니다.

그런데 Secure 함수가 실패하면 보안이 더 강해지는 것이 아니라 오히려 일반 INSERT 경로로 내려갑니다.

Production에서는:

Secure RPC 실패
→ 실패 반환

이어야 합니다.

보안 작업에 fallback은 "편의성" 때문에 넣으면 안 됩니다.

19. 정산 승인도 똑같은 문제입니다

approveSettlementSecure()는 RPC 실패 시:

author_settlements.update({
   status: 'PAID'
})

으로 fallback합니다.

이 구조 역시 제거해야 합니다.

그리고 더 중요한 것은:

PAID

는 단순 상태 변경이 아니라

정산 가능 잔액 차감
+
Settlement Ledger
+
지급 Transaction
+
Audit Log

과 같이 처리되어야 합니다.

20. Reader Activity는 현재 구조와 완전히 충돌합니다

현재 SQL에는:

readers

에 다음 JSONB가 없습니다.

reading_history
favorites
subscribed_authors

그런데 JS는 계속:

readerData.reading_history
readerData.favorites
readerData.subscribed_authors

를 사용합니다.

또한:

updateReaderActivity()

에서 해당 컬럼을 update하려고 합니다.

현재 SQL 구조상 이 부분은 제거해야 합니다.

21. Reader ID 타입도 잘못되어 있습니다

SQL:

reading_history.user_id UUID
favorites.user_id UUID
author_subscriptions.user_id UUID

입니다.

그런데 JS에서는:

user_id: String(userId)

입니다.

Supabase Auth UUID가 문자열로 전달되는 것은 JS 관점에서는 가능하지만, 사용자가 reader1 같은 username을 넘기면 DB UUID FK와 맞지 않습니다.

현재:

cleanUser = username

을 user_id로 사용하는 부분이 있습니다.

예:

user_id = "reader1"

이면 Production schema에서는:

user_id UUID

와 맞지 않습니다.

22. 댓글도 컬럼명이 바뀌었습니다

SQL:

nickname_snapshot

인데 JS:

nickname

을 INSERT합니다.

이 역시 수정이 필요합니다.

23. 콘텐츠 검수도 컬럼명이 맞지 않습니다

SQL:

work_title_snapshot
author_name_snapshot

입니다.

그런데 JS는:

work_title
author_name

으로 INSERT/조회합니다.

따라서 검수 등록 기능도 현재 SQL과 호환되지 않습니다.

24. Realtime은 “코드가 존재한다”와 “실제로 작동한다”가 다릅니다

JS에는:

.channel('public-db-changes')
.on('postgres_changes', ...)

가 구현되어 있습니다.

좋습니다.

하지만 SQL 파일에는 제가 확인한 범위에서:

CREATE PUBLICATION supabase_realtime

또는 해당 테이블을 Realtime publication에 추가하는 설정이 없습니다.

그리고 RLS/권한 역시 현재 SQL에는 Production 수준의 정책이 없습니다.

따라서 Realtime JS가 있다고 해서 실제 DB 변경이 자동으로 UI에 전달된다고 단정하면 안 됩니다.

25. 더 중요한 문제: Realtime 대상도 부족합니다

현재 JS는:

works
episodes
author_settlements
reports

만 구독합니다.

하지만 관리자 CMS에서 실시간성이 중요한 것은:

readers
authors
works
episodes
content_reviews
reports
ad_events
revenue_periods
author_earnings
author_settlements

등입니다.

특히 수익/정산 Dashboard를 실시간으로 보여주려면 해당 데이터의 변경 이벤트를 별도 설계해야 합니다.

26. 가장 좋은 점도 있습니다

전체가 잘못된 것은 아닙니다.

현재 수정된 코드에서 좋은 방향은 분명합니다.

좋은 부분

① Dummy KPI fallback 제거

현재 KPI는 null을 기본값으로 사용하고 DB 오류 시 null을 반환합니다.

이전보다 훨씬 좋아졌습니다.

② 작품 ID를 max+1로 생성하던 로직 제거

현재 createWorkInDB()는 DB에서 자동 ID를 받는 방향으로 개선되었습니다.

③ Atomic increment RPC를 우선 사용하는 방향

increment_work_view RPC를 먼저 호출하는 방향은 맞습니다. 다만 현재 SQL에 해당 RPC가 없습니다.

④ Realtime 채널 코드 추가

방향은 맞습니다. 다만 DB 측 publication/권한 설정까지 마쳐야 합니다.

⑤ Episode Content 분리 시도

fetchEpisodeContentSecure()가 episode_contents를 먼저 사용하는 것은 설계 방향 자체는 맞습니다.

27. 하지만 지금 가장 중요한 것은 “양쪽을 다시 맞추는 것”입니다

현재 상태는 다음과 같습니다.

           현재 SQL
              │
       Production 구조
              │
              ▼
       ┌─────────────┐
       │             │
       │   DB v2     │
       │             │
       └──────┬──────┘
              │
       schema mismatch
              │
              ▼
       ┌─────────────┐
       │ supabase-   │
       │ admin.js    │
       │ old + new   │
       └─────────────┘

즉 JS가 이전 schema와 새 schema를 동시에 지원하려고 하는 상태입니다.

이 방식은 개발 초기에는 편하지만 Production에서는 상당히 위험합니다.

28. 제가 최종적으로 권하는 구조

이제 더 이상 "fallback"을 늘리지 않는 것이 좋습니다.

DB
Production Schema
      ↓
Single Source of Truth
Frontend
supabase-admin.js
      ↓
Production API contract만 사용
실패
DB 오류
→ 명확한 오류 반환
금지
DB 오류
→ LocalStorage
→ Dummy Data
→ 구 DB
→ 다른 Table

이런 식의 다중 fallback을 핵심 데이터에 적용하지 않습니다.

29. 최종적으로 반드시 수정해야 할 12개
🔴 P0

1. Reader/Author Login → Supabase Auth

2. Admin Login → Supabase Auth + admin profile

3. episodes.content 제거 → episode_contents 사용

4. episodes.image_urls 제거 → episode_panels 사용

5. episode_unlocks 컬럼명 통일

6. ad_events 생성 → Edge Function/SSV 전용

7. Settlement Client CRUD 제거

8. Revenue 계산 Client 코드 제거

9. readers JSONB 활동 필드 제거

10. UUID user_id 통일

11. nickname → nickname_snapshot 등 컬럼명 통일

12. Realtime publication + RLS + 실제 subscriber 동작 검증

30. 실제 운영 관점에서 판정하면

현재 코드를 그대로 운영환경에 올리는 것은 추천하지 않습니다.

제가 점수를 준다면:

Architecture        80 / 100
DB 설계             78 / 100
Frontend 연동       55 / 100
실시간성            60 / 100
데이터 영속성       65 / 100
보안                35 / 100
광고수익 Engine     30 / 100
정산 Engine         35 / 100

전체 Production Readiness: 약 50~55% 수준으로 판단합니다.

가장 큰 이유는 코드 자체가 나쁘다기보다 현재 SQL과 JS가 서로 다른 버전의 데이터 모델을 동시에 사용하고 있기 때문입니다.

31. 특히 “실제 데이터가 향후에도 그대로 유지되느냐?”에 대한 답

지금 상태에서는:

작품

일부 정상 저장 가능

작품 조회수

DB에 기록되지만 동시접속/권한/RPC에 따라 문제가 있을 수 있음

독서이력

현재 UUID와 username 혼용 때문에 불안정

광고

이벤트 기록은 가능하지만 신뢰 가능한 광고수익 원장이라고 볼 수 없음

Unlock

현재는 스키마 불일치 + Client 생성 구조 때문에 Production 불가

작가 수익

실제 광고매출 기반이 아니므로 Production 불가

정산

DB record 자체는 남을 수 있지만 금융 transaction의 안전한 원장 구조는 미완성

결론

“실제 사용자가 들어오면 DB에 데이터가 쌓인다”는 수준은 일부 충족하지만, “모든 실제 사용자 활동과 광고수익·작가수익·정산 기록이 정확한 원장으로 장기 보존된다”는 수준은 아직 아닙니다.

32. 가장 중요한 다음 조치

지금은 SQL을 또 바꾸는 것보다 두 파일의 계약(Contract)을 하나로 고정하는 것이 먼저입니다.

최종 구조를:

WebNovels Production DB v1
            ↕
WebNovels API Contract v1
            ↕
supabase-admin.js v1
            ↕
Reader / Creator / Admin UI

로 고정해야 합니다.

그리고 supabase-admin.js에서는 다음 네 가지를 완전히 제거해야 합니다.

❌ password_hash 기반 Login
❌ LocalStorage를 영구 DB처럼 사용하는 Fallback
❌ Client가 광고 Reward 생성
❌ Client가 정산/수익 상태 직접 변경

반대로 다음 네 가지를 넣어야 합니다.

✅ Supabase Auth
✅ Protected Episode Content API
✅ Ad SSV → Edge Function → Unlock
✅ Revenue Ledger → Earnings → Settlement RPC
