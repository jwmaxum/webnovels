# ⚙️ [Improvement Step 3] 관리자 CMS 15대 메뉴 & 심사 워크플로우 및 상태값 표준화

본 문서는 `needtochange1.md`의 핵심 개선 사항 중 **3단계: 작품/회차 상태값 표준화, 콘텐츠 심사 Workflow 완성 및 관리자 CMS 15대 관제탑 고도화** 작업을 위한 명세서입니다.

---

## 1. 개요 및 목적
- **작품/회차 상태값(Enum) 통일**:
  - 임의 문자열 사용을 방지하고 DB, 백엔드, 프론트엔드 전반에서 일관된 상태 라이프사이클 적용
- **콘텐츠 심사(Content Review) 엔드투엔드 워크플로우 구축**:
  - 작가 원고 작성(`DRAFT`) → 검수 신청(`PENDING`) → 관리자 심사(`APPROVED` / `REJECTED`) → 연재 공개(`PUBLISHED`)
- **관리자 CMS 15대 표준 메뉴 체계화**:
  - 대시보드부터 보안 관제까지 15대 메뉴와 세부 RBAC 권한(`SUB_ADMIN` 권한 분기) 완벽 매핑
- **Zero-Touch 관제탑 Action Queue 실시간 조치 고도화**:
  - 원클릭 심사 승인, 신고 블라인드, 정산 승인이 즉시 상태값과 연동되어 화면 전체에 전파

---

## 2. 세부 구현 대상 (Tasks)

### 2.1. 작품 및 회차 상태 표준 정의
```sql
-- 작품(Works) 상태 통일
-- DRAFT, REVIEW, PUBLISHED, PAUSED, COMPLETED, REJECTED
ALTER TABLE works ADD COLUMN IF NOT EXISTS work_status TEXT DEFAULT 'PUBLISHED'
  CHECK (work_status IN ('DRAFT', 'REVIEW', 'PUBLISHED', 'PAUSED', 'COMPLETED', 'REJECTED'));

-- 회차(Episodes) 상태 통일
-- DRAFT, REVIEW, SCHEDULED, PUBLISHED, HIDDEN, DELETED
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS episode_status TEXT DEFAULT 'PUBLISHED'
  CHECK (episode_status IN ('DRAFT', 'REVIEW', 'SCHEDULED', 'PUBLISHED', 'HIDDEN', 'DELETED'));
```

---

### 2.2. 콘텐츠 심사 워크플로우 (`content_reviews`)
```
[작가 원고 작성] (DRAFT)
       ↓
[검수 요청 버튼 클릭] (episode_status: 'REVIEW', content_reviews: 'PENDING')
       ↓
[관리자 Action Queue 감지] (🟠 검수 대기)
   ↙              ↘
[심사 승인]      [심사 반려]
status: APPROVED   status: REJECTED (사유 입력)
episode: PUBLISHED episode: DRAFT
```

---

### 2.3. 관리자 CMS 15대 메뉴 및 RBAC 권한 매핑
| 메뉴 번호 | 메뉴명 | 주요 역할 | 권한 코드 |
| :--- | :--- | :--- | :--- |
| **01** | **Dashboard** | 5대 KPI, 연재 현황, 실시간 Action Queue | `DASHBOARD` |
| **02** | **회원관리** | 독자 목록, 성인인증 승인, 구독/이용제한 | `USER_MGMT` |
| **03** | **작가관리** | 공식 인증 작가 승인, 작가별 작품/정산 현황 | `AUTHOR_MGMT` |
| **04** | **작품관리** | 웹소설/웹툰 작품 등록·수정, 추천/인기/신작 배지 | `WORK_MGMT` |
| **05** | **회차관리** | 회차 등록, 예약 연재(Zero-Touch), 무료/광고 설정 | `EPISODE_MGMT` |
| **06** | **콘텐츠 검수** | 심사 대기 원고 검수, 승인 및 반려 사유 관리 | `CONTENT_REVIEW` |
| **07** | **댓글/신고** | 독자 신고 처리, 악성 댓글 블라인드/차단 | `COMMENT_REPORT` |
| **08** | **광고관리** | 애드네트워크 연동, 슬롯 설정, 광고 이벤트 통계 | `AD_MGMT` |
| **09** | **수익/정산** | 월 광고 매출 확정, 작가 Pool 분배, 출금 송금 승인 | `AD_REVENUE` |
| **10** | **팬미팅** | 작가 팬미팅 티켓팅 등록 및 참가자 관리 | `FAN_MEETING` |
| **11** | **Goods** | 굿즈 상품 등록, 주문/배송 관리 | `GOODS_MGMT` |
| **12** | **이벤트** | 플랫폼 프로모션 및 쿠폰 관리 | `EVENT_MGMT` |
| **13** | **Analytics** | DAU/MAU, 완독률, 광고 전환율, 작가별 성과 | `ANALYTICS` |
| **14** | **System** | 서브관리자 RBAC 권한 부여, 플랫폼 환경설정 | `SYSTEM_MGMT` |
| **15** | **Security** | 관리자 활동 로그, 비정상 접근 감시 | `SECURITY_MGMT` |

---

## 3. 코드 연동 반영 (`public/app.js`, `public/supabase-admin.js`, `public/index.html`)
- 관리자 네비게이션 메뉴를 15대 메뉴 구조로 정돈
- `fetchActionQueueFromDB` 및 `resolveActionQueueItemInDB`: 상태 변경과 `episodes.status` 자동 전이 연동
- 서브관리자 로그인 시 `permissions` 배열에 따른 메뉴 접근 차단 및 UI 조건부 렌더링

---

## 4. 검증 계획
1. 작가가 회차 검수 요청 시 관리자 Action Queue에 실시간 등록되는지 확인
2. 관리자가 [심사 승인] 클릭 시 회차가 즉시 `PUBLISHED`로 변경되어 독자 뷰어에 노출되는지 검증
3. [심사 반려] 시 반려 사유가 작가 스튜디오에 표시되는지 검증
4. 서브관리자 권한별 메뉴 접근 제어 테스트
