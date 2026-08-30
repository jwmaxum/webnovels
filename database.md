# 🗄️ WebNovels 데이터베이스 스키마 및 DB 구축 명세서 (최종 권장 구조)

본 문서는 `WebNovels` (광고 기반 무료 웹소설 & 웹툰 플랫폼) 서비스의 최종 권장 시스템 구조(`needtochange.md`) 및 정규화 데이터 모델을 반영한 종합 데이터베이스 명세서입니다.

---

## 1. 최종 권장 시스템 구조 (Architecture Overview)

```
                         ┌──────────────────┐
                         │   Supabase Auth   │
                         │ 인증 / Session    │
                         └────────┬─────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
        ┌──────────┐        ┌──────────┐        ┌────────────┐
        │ Readers  │        │ Authors  │        │ Admin Users│
        └────┬─────┘        └────┬─────┘        └─────┬──────┘
             │                   │                    │
             │                   ▼                    │
             │             ┌──────────┐               │
             └────────────►│  Works   │◄──────────────┘
                           └────┬─────┘
                                │
                                ▼
                         ┌────────────┐
                         │  Episodes  │
                         └─────┬──────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
       ┌─────────────┐  ┌──────────────┐  ┌────────────┐
       │ Read History│  │  Ad Unlocks  │  │  Comments  │
       └─────────────┘  └──────┬───────┘  └────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Revenue Events  │
                       └────────┬────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Author Revenues │
                       └────────┬────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │  Settlements    │
                       └─────────────────┘
```

---

## 2. 주요 정규화 및 개선 핵심

1. **`works` 테이블의 작가 참조 정규화**:
   - `works.author_id INT REFERENCES authors(id)` 외래키 관계를 도입하여 작가명 수정 시 모든 작품을 일괄 변경해야 하는 이상 현상 제거.
2. **독자 데이터의 JSONB 구조 분리**:
   - 대용량 트래픽 및 수백만 건의 독서 이력 누적을 안전하게 처리하기 위해 `reading_history`, `favorites`, `author_subscriptions` 독립 정규화 테이블로 분리.
3. **회차 광고 해금(Ad Unlocks) 엔티티 명세화**:
   - `ad_unlocks` 테이블을 통해 72시간 동안 유효한 독자의 무료 열람 권한 상태를 정확하게 검증 및 관리.
4. **월별 작가 수익 배분(Author Revenues) 풀 연동**:
   - 월 광고 총매출(`revenue_events`) -> 작가 풀(62.5%) -> 작가별 추정/확정 정산금(`author_revenues`) -> 출금 신청(`author_settlements`)으로 이어지는 수익 순환 고리 완성.

---

## 3. 상세 테이블 및 스키마 명세 (Schema Specifications)

### 3.1. 사용자 및 권한 관리 (User & Auth)

#### 1) `readers` (독자 회원)
- `id` (INTEGER / UUID, PK): 회원 고유 ID
- `username` (VARCHAR, UNIQUE): 독자 아이디 (`reader1`, `reader2` 등)
- `password_hash` (VARCHAR): 비밀번호 해시
- `nickname` (VARCHAR, NULLABLE): 독자 닉네임
- `email` (VARCHAR, UNIQUE): 이메일 주소
- `phone` (VARCHAR): 연락처
- `subscription_status` (VARCHAR): 구독 등급 (`일반 회원`, `프리미엄 구독중`, `VIP 회원`)
- `is_adult_verified` (BOOLEAN): KCP/PASS 성인 인증 완료 여부
- `reading_history` (JSONB): 하위 호환용 보조 데이터
- `favorites` (JSONB): 하위 호환용 보조 데이터
- `subscribed_authors` (JSONB): 하위 호환용 보조 데이터
- `created_at` (TIMESTAMPTZ): 가입일시

#### 2) `authors` (등록 작가)
- `id` (SERIAL / INT, PK): 작가 고유 ID
- `username` (VARCHAR, UNIQUE): 작가 아이디 (`writer1` ~ `writer30`)
- `password_hash` (VARCHAR): 비밀번호 해시
- `pen_name` (VARCHAR): 작가 공식 필명
- `email` (VARCHAR, UNIQUE): 이메일 주소
- `work_title` (VARCHAR): 대표 연재작 제목
- `birthdate` (VARCHAR): 생년월일
- `address` (VARCHAR): 주소
- `bank_info` (VARCHAR): 정산 계좌번호
- `status` (VARCHAR): 작가 상태 (`공식 인증 작가`, `승인 대기`)
- `created_at` (TIMESTAMPTZ): 등록일시

#### 3) `admin_users` (관리자 RBAC)
- `id` (UUID, PK): 관리자 ID
- `username` (VARCHAR, UNIQUE): 관리자 계정명
- `email` (VARCHAR, UNIQUE): 이메일
- `password_hash` (VARCHAR): Bcrypt 해시
- `nickname` (VARCHAR): 관리자 닉네임
- `role` (VARCHAR): `SUPER_ADMIN` / `SUB_ADMIN`
- `permissions` (JSONB): 부여된 RBAC 권한 배열 (`DASHBOARD`, `USER_MGMT`, `WORK_MGMT` 등)
- `is_active` (BOOLEAN): 활성화 여부

---

### 3.2. 콘텐츠 & 연재 관리 (Content & Series)

#### 1) `works` (연재 작품)
- `id` (SERIAL / INT, PK): 작품 ID
- `author_id` (INT, FK → `authors.id`): 작가 외래키 (ON DELETE SET NULL)
- `title` (VARCHAR): 작품 제목
- `author` (VARCHAR): 작가 필명 (스냅샷/하위 호환)
- `content_type` (VARCHAR): 콘텐츠 구분 (`NOVEL`: 웹소설, `WEBTOON`: 웹툰)
- `genre` (TEXT[]): 장르 배열 (`판타지`, `무협`, `로맨스`, `SF`, `성인` 등)
- `tags` (TEXT[]): 태그 배열
- `description` (TEXT): 줄거리 소개
- `cover_image` (VARCHAR): 커버 이미지 파일명
- `view_count` (INTEGER): 누적 조회수
- `like_count` (INTEGER): 추천수
- `status` (VARCHAR): 연재 상태 (`ONGOING`, `PAUSED`, `COMPLETED`)
- `is_completed` (BOOLEAN): 완결 여부
- `is_top_recommended` (BOOLEAN): 메인 상단 추천작 여부
- `is_popular_work` (BOOLEAN): 인기 작품 여부
- `is_new_work` (BOOLEAN): 신작 여부

#### 2) `episodes` (회차 상세)
- `id` (SERIAL / INT, PK): 회차 고유 ID
- `work_id` (INT, FK → `works.id`): 작품 ID (ON DELETE CASCADE)
- `episode_number` (INT): 회차 번호 (1화 ~ 6화)
- `title` (VARCHAR): 회차 제목
- `content` (TEXT): 웹소설 본문 텍스트
- `image_urls` (JSONB): 웹툰 컷 이미지 URL 배열
- `is_free` (BOOLEAN): 무료 열람 여부 (1~3화: `true`)
- `is_ad_free` (BOOLEAN): 광고 시청 후 해금 여부 (4~6화: `true`)
- `author_comment` (TEXT): 작가의 말
- `status` (VARCHAR): `PUBLISHED` / `SCHEDULED`
- `scheduled_at` (TIMESTAMPTZ): 예약 연재 일시
- `UNIQUE(work_id, episode_number)`

---

### 3.3. 독자 활동 정규화 (Reader Activity Entities)

#### 1) `reading_history` (독서 진행률 및 최근 열람 기록)
- `id` (UUID, PK): 독서 기록 고유 ID
- `user_id` (TEXT): 독자 ID / 사용자명
- `work_id` (INT, FK → `works.id`): 작품 ID (ON DELETE CASCADE)
- `episode_id` (INT, FK → `episodes.id`): 에피소드 ID (ON DELETE CASCADE)
- `progress` (NUMERIC): 독서 진도율 (0 ~ 100)
- `last_read_at` (TIMESTAMPTZ): 최종 열람 시각
- `UNIQUE(user_id, episode_id)`

#### 2) `favorites` (작품 관심 등록 / 북마크)
- `id` (UUID, PK): 북마크 고유 ID
- `user_id` (TEXT): 독자 ID / 사용자명
- `work_id` (INT, FK → `works.id`): 관심 작품 ID (ON DELETE CASCADE)
- `created_at` (TIMESTAMPTZ): 등록일시
- `UNIQUE(user_id, work_id)`

#### 3) `author_subscriptions` (작가 팬 구독)
- `id` (UUID, PK): 구독 고유 ID
- `user_id` (TEXT): 독자 ID / 사용자명
- `author_id` (INT, FK → `authors.id`): 구독 작가 ID (ON DELETE CASCADE)
- `created_at` (TIMESTAMPTZ): 구독 시작일시
- `UNIQUE(user_id, author_id)`

#### 4) `ad_unlocks` (회차 광고 해금 관리)
- `id` (UUID, PK): 해금 고유 ID
- `user_id` (TEXT): 독자 ID / 사용자명
- `work_id` (INT, FK → `works.id`): 작품 ID (ON DELETE CASCADE)
- `episode_id` (INT, FK → `episodes.id`): 해금된 회차 ID (ON DELETE CASCADE)
- `unlocked_at` (TIMESTAMPTZ): 광고 시청 해금 시각
- `expires_at` (TIMESTAMPTZ): 권한 만료 시각 (기본 `NOW() + INTERVAL '72 hours'`)
- `UNIQUE(user_id, episode_id)`

---

### 3.4. 수익 배분 & 정산 (Monetization & Settlements)

#### 1) `revenue_events` (월별 광고 총매출 및 분배 풀)
- `id` (UUID, PK): 정산 이벤트 ID
- `period_month` (TEXT): 정산 대상 월 (`YYYY-MM`)
- `gross_revenue` (NUMERIC): 광고 총 매출액
- `ad_network_fee` (NUMERIC): 애드네트워크/결제 수수료
- `net_revenue` (NUMERIC): 순수익 (gross - fee)
- `writer_pool_ratio` (NUMERIC): 작가 풀 배분율 (기본 `0.625` = 62.5%)
- `writer_pool` (NUMERIC): 작가 분배 총액
- `platform_revenue` (NUMERIC): 플랫폼 귀속 수익
- `is_closed` (BOOLEAN): 월 정산 마감 여부

#### 2) `author_revenues` (작가별 월별 수익 분배 내역)
- `id` (UUID, PK): 수익 분배 ID
- `author_id` (INT, FK → `authors.id`): 작가 ID (ON DELETE CASCADE)
- `revenue_event_id` (UUID, FK → `revenue_events.id`): 대상 수익 이벤트
- `period_month` (TEXT): 대상 월 (`YYYY-MM`)
- `contribution_score` (NUMERIC): 조회수/체류시간 기반 기여도 점수
- `estimated_amount` (NUMERIC): 실시간 추정 수익
- `confirmed_amount` (NUMERIC): 월 마감 후 확정 정산금
- `status` (VARCHAR): `PENDING` / `CONFIRMED` / `PAID` / `REJECTED`

#### 3) `author_settlements` (작가 정산 출금 신청)
- `id` (UUID, PK): 정산 신청 ID
- `author_id` (INT, FK → `authors.id`): 작가 ID
- `author_name` (TEXT): 작가명 스냅샷
- `amount` (NUMERIC): 출금 신청 금액
- `bank_info` (TEXT): 송금 계좌 스냅샷
- `status` (VARCHAR): `PENDING` / `CONFIRMED` / `PAID` / `REJECTED`
- `requested_at` (TIMESTAMPTZ): 신청 일시
- `processed_at` (TIMESTAMPTZ): 송금 처리 일시

---

## 4. 프론트엔드 - DB 실시간 연동 원칙

1. **실시간 DB 우선 렌더링 (Realtime DB First)**:
   - 관리자 CMS, 작가 스튜디오, 독자 내 서재 진입 시 Supabase DB의 최신 실데이터를 100% 실시간 조회 및 렌더링합니다.
2. **독자 활동 실시간 정규화 저장**:
   - 열람 진도(`reading_history`), 찜(`favorites`), 작가 구독(`author_subscriptions`), 광고 해금(`ad_unlocks`) 발생 시 DB와 로컬 스토리지에 즉시 동기화합니다.
3. **Event-Driven UI 갱신**:
   - 데이터 변경 시 `webnovels:works-changed`, `webnovels:readers-changed`, `webnovels:authors-changed` 커스텀 이벤트를 발행하여 전체 화면을 즉각 동기화합니다.