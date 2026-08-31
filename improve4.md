# 🚀 [Improve Step 4] 62.5% 작가 수익 자동 배분 및 정산(Settlement) 보안 강화

## 1. 목적 및 배경
`improve.md` 11, 12, 13항목에서 지적된 "광고 발생 ➔ 작가 수익 자동 배분 누락" 및 "클라이언트가 직접 정산 상태를 `PAID`로 변경하는 금융 취약점"을 해결합니다.

---

## 2. 세부 작업 항목

### [작업 4-1] 광고 이벤트 기반 작가 수익(62.5%) 자동 배분 계산 엔진
* **대상 파일**: `public/supabase-admin.js` (`fetchAuthorEarnings`, `allocateRevenue`), `public/app.js`
* **내용**:
  - 광고 시청 이벤트 및 완독률/조회수 기여도에 따라 순수익의 62.5%를 `author_earnings` 원장에 자동으로 누적 계산하는 로직 연동.
  - 관리자가 임의 숫자를 수동 입력하던 방식을 정산 원장(Ledger) 기반 자동 집계로 대체.

### [작업 4-2] 안전한 출금 신청 및 송금 승인 RPC 연동 (`requestSettlementSecure`, `approveSettlementSecure`)
* **대상 파일**: `public/supabase-admin.js`, `public/app.js` (`handleCreatorSettlementReq`, `handleApproveSettlement`)
* **내용**:
  - 프론트엔드가 `author_settlements` 테이블을 직접 INSERT/UPDATE하는 취약점 제거.
  - 작가는 `request_author_settlement` RPC를 통해 잔액 검증 후 출금 신청(`PENDING`).
  - 관리자는 `approve_author_settlement` RPC를 통해 관리자 권한 검증 후 안전하게 `PAID` 승인 및 원장 차감 처리.

---

## 3. 검증 기준
- [ ] 작가 크리에이터 스튜디오에서 출금 신청 시 잔액 한도 내에서만 접수되는지 확인.
- [ ] 관리자가 정산 승인 시 DB 상에서 상태가 `PAID`로 원자적으로 전이되고 처리 일시가 기록되는지 확인.
- [ ] `npx tsc --noEmit` 통과.
