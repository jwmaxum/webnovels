# 🗄️ WebNovels 데이터베이스 스키마 및 DB 구축 명세서

본 문서는 `WebNovels` (광고 기반 무료 웹소설 & 웹툰 플랫폼) 서비스 구현 및 Supabase / Prisma DB 구축 현황을 반영한 종합 데이터베이스 명세서입니다.

---

## 1. DB 아키텍처 개요

*   **클라우드 데이터베이스 (Supabase PostgreSQL)**: Cloudflare Pages 정적 배포 및 클라이언트 라이브러리(`supabase-admin.js`)를 통해 실시간 데이터 조회 및 CUD 처리를 전담합니다.
*   **로컬 ORM (Prisma SQLite)**: 백엔드 API 서비스 (`src/server.ts`) 개발/테스트 및 마이그레이션을 위한 1:1 대응 스키마 구조를 가집니다.
*   **실시간 동기화 (Realtime Sync)**: 오프라인 폴백 방어벽(SSOT 보존)을 갖추어 DB 연결 지연 시 로컬 상태를 보호하고, 데이터가 있을 경우 100% 실시간 DB 원본 데이터로 UI를 갱신합니다.

---

## 2. 구축 완료된 주요 테이블 및 실데이터 현황

| 테이블명 | 역할 및 설명 | 구축 데이터 수 | 비고 |
| :--- | :--- | :--- | :--- |
| **`readers`** | 독자 회원 계정 (닉네임, 이메일, 구독 상태, PASS 성인인증) | **10명** (`reader1` ~ `reader10`) | 프리미엄/VIP/일반 구독, 성인 인증여부 포함 |
| **`authors`** | 등록 작가 계정 (필명, 대표작, 정산계좌, 생년월일, 인증 상태) | **30명** (`writer1` ~ `writer30`) | 공식 인증 작가 데이터 구축 완료 |
| **`works`** | 작품 메타데이터 (웹소설 17작품 + 웹툰 13작품) | **30작품** | 정상 연재 25작품, 완결 5작품 |
| **`episodes`** | 회차 정보 (소설 텍스트 본문 & 웹툰 컷 이미지, 광고 언락 설정) | **180회차** (작품당 6회차) | 1~3화 무료, 4~6화 광고 해금 연동 |
| **`admin_users`** | 관리자 및 서브 관리자 계정 (RBAC 권한 제어) | 최고관리자 + 서브관리자 | `verify_admin_login` RPC 연동 |
| **`revenue_events`** | 월별 광고 총매출, 수수료, 작가 배분 Pool (62.5%) 집계 | 월별 정산 내역 | Revenue Engine 연동 |
| **`author_settlements`**| 작가 출금 정산 신청 및 지급 처리 상태 관리 | PENDING / PAID | 작가 크리에이터 스튜디오 연동 |
| **`platform_stats`** | 대시보드 5대 KPI 플랫폼 실시간 통계 | 실시간 집계 | Zero-Touch 관제탑 연동 |

---

## 3. 상세 스키마 정의 (Schema Specifications)

### 3.1. 사용자 및 권한 관리 (User & Auth)

#### 1) `readers` (독자 회원)
- `id` (INTEGER / UUID, PK): 회원 고유 ID
- `username` (VARCHAR, UNIQUE): 독자 아이디 (`reader1`, `reader2` 등)
- `nickname` (VARCHAR, NULLABLE): 독자 닉네임 (`소설마니아`, `새벽독자` 등)
- `email` (VARCHAR, UNIQUE): 이메일 주소
- `phone` (VARCHAR): 연락처
- `subscription_status` (VARCHAR): 구독 등급 (`일반 회원`, `프리미엄 구독중`, `VIP 회원`)
- `is_adult_verified` (BOOLEAN): KCP/PASS 성인 인증 완료 여부
- `reading_history` (JSONB): 열람 이력
- `favorites` (JSONB): 관심 작품 목록
- `subscribed_authors` (JSONB): 구독 작가 목록
- `created_at` (TIMESTAMPTZ): 가입일시

#### 2) `authors` (등록 작가)
- `id` (INTEGER / UUID, PK): 작가 고유 ID
- `username` (VARCHAR, UNIQUE): 작가 아이디 (`writer1` ~ `writer30`)
- `pen_name` (VARCHAR): 작가 필명
- `email` (VARCHAR): 이메일 주소
- `work_title` (VARCHAR): 대표 연재작 제목
- `bank_info` (VARCHAR): 정산 받으실 은행/계좌번호
- `status` (VARCHAR): 작가 상태 (`공식 인증 작가`, `승인 대기`)
- `created_at` (TIMESTAMPTZ): 등록일시

#### 3) `admin_users` (관리자 RBAC)
- `id` (UUID, PK): 관리자 ID
- `username` (VARCHAR, UNIQUE): 관리자 계정명
- `email` (VARCHAR, UNIQUE): 이메일
- `password_hash` (VARCHAR): 비밀번호 해시
- `role` (VARCHAR): `SUPER_ADMIN` / `SUB_ADMIN`
- `permissions` (JSONB): 부여된 RBAC 권한 배열 (`DASHBOARD`, `USER_MGMT`, `WORK_MGMT` 등)

---

### 3.2. 콘텐츠 & 연재 관리 (Content & Series)

#### 1) `works` (연재 작품)
- `id` (INTEGER, PK): 작품 ID (1 ~ 30)
- `title` (VARCHAR): 작품 제목
- `author` (VARCHAR): 작가 필명
- `content_type` (VARCHAR): 콘텐츠 구분 (`NOVEL`: 웹소설 17작품, `WEBTOON`: 웹툰 13작품)
- `genre` (ARRAY / VARCHAR): 장르 (`판타지`, `무협`, `로맨스`, `현대 판타지`, `SF`, `성인` 등)
- `tags` (ARRAY / VARCHAR): 태그 배열
- `description` (TEXT): 작품 줄거리 설명
- `cover_image` (VARCHAR): 커버 이미지 파일명
- `view_count` (INTEGER): 누적 조회수
- `status` (VARCHAR): 연재 상태 (`ONGOING`: 25작품, `COMPLETED`: 5작품, `PAUSED`, `DELAYED`)
- `is_completed` (BOOLEAN): 완결 여부
- `is_top_recommended` (BOOLEAN): 메인 상단 추천작 여부
- `is_popular_work` (BOOLEAN): 인기 작품 여부
- `is_new_work` (BOOLEAN): 신작 여부

#### 2) `episodes` (회차 상세)
- `id` (INTEGER, PK): 에피소드 ID
- `work_id` (INTEGER, FK): 작품 ID
- `episode_number` (INTEGER): 회차 번호 (1화 ~ 6화)
- `title` (VARCHAR): 회차 제목
- `content` (TEXT): 웹소설 본문 텍스트
- `image_urls` (JSONB): 웹툰 컷 이미지 URL 배열
- `is_free` (BOOLEAN): 100% 무료 여부 (1~3화: `true`)
- `is_ad_free` (BOOLEAN): 광고 시청 후 해금 여부 (4~6화: `true`)
- `author_comment` (TEXT): 작가의 말

---

### 3.3. 수익배분 & 정산 (Monetization & Settlement)

#### 1) `revenue_events` (수익 배분 이벤트)
- `id` (UUID, PK): 이벤트 ID
- `period_month` (VARCHAR): 대상 월 (`YYYY-MM`)
- `gross_revenue` (NUMERIC): 광고 총 매출액
- `ad_network_fee` (NUMERIC): 수수료
- `net_revenue` (NUMERIC): 순수익 (gross - fee)
- `writer_pool_ratio` (NUMERIC): 작가 풀 비중 (기본 `0.625` = 62.5%)
- `writer_pool` (NUMERIC): 작가 분배 총액
- `platform_revenue` (NUMERIC): 플랫폼 귀속 수익
- `is_closed` (BOOLEAN): 정산 마감 여부

#### 2) `author_settlements` (작가 정산 신청)
- `id` (UUID, PK): 정산 ID
- `author_name` (VARCHAR): 작가명
- `amount` (NUMERIC): 정산 신청 금액
- `bank_info` (VARCHAR): 정산 계좌 정보
- `status` (VARCHAR): 상태 (`PENDING`: 대기, `PAID`: 지급완료, `REJECTED`: 반려)
- `requested_at` (TIMESTAMPTZ): 신청 일시
- `processed_at` (TIMESTAMPTZ): 처리 완료 일시

---

## 4. 프론트엔드 - DB 실시간 연동 원칙

1. **실시간 DB 렌더링**: 관리자 대시보드(DASHBOARD), 독자 관리(USER_MGMT), 작가 관리(AUTHOR_MGMT), 작품 관리(WORK_MGMT) 접근 시 DB의 최신 데이터(`readers` 10명, `authors` 30명, `works` 30개/180회차)를 100% 실시간 렌더링합니다.
2. **로컬 방어벽 보존**: 네트워크 장애나 빈 데이터 반환 시 로컬 상태(SSOT)가 파괴되지 않도록 오프라인 폴백 방어 로직을 준수합니다.
3. **Event-Driven UI 갱신**: DB CUD(생성/수정/삭제) 발생 시 `webnovels:works-changed`, `webnovels:readers-changed`, `webnovels:authors-changed` 커스텀 이벤트를 발행하여 UI 전체에 즉각 반영합니다.