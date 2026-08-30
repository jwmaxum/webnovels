# 💰 [Improvement Step 3] 원장(Ledger) 기반 수익 & 정산 엔진 및 광고 SSV 검증 체계

본 문서는 `check.md`의 프로덕션 가이드라인을 바탕으로 한 **3단계: 원장(Ledger) 기반 수익 배분, 보안 정산 신청 RPC 및 보상형 광고 SSV 검증 엔진 구축** 실행 명세서입니다.

---

## 1. 개요 및 목적
- **원장(Ledger) 기반 복식부기 수익 추적**:
  - 단순 집계 저장이 아닌 `revenue_periods`(월별 마감)와 `revenue_ledger`(수익 발생, 수수료 차감, 창작자 풀 배분, 작가 정산 예약 및 지급)를 원장 형태로 기록하여 금액의 전체 흐름을 완벽하게 역추적
- **정산 직접 INSERT 금지 및 안전한 RPC (`private.request_author_settlement`)**:
  - 작가가 브라우저에서 직접 `author_settlements`를 INSERT하는 것을 원천 차단
  - 검증 RPC를 통해 ① 작가 승인 여부, ② 최소 정산금액(기본 10,000원), ③ 실제 마감 확정 잔액, ④ 공식 인증된 1순위 정산계좌(`author_settlement_accounts`)를 검증한 후 안전하게 신청 레코드 생성
- **보상형 광고 SSV (Server-Side Verification) 및 안전 해금 RPC (`private.grant_rewarded_ad_unlock`)**:
  - 광고 시청 완료 시 발급된 `ad_event_id`와 사용자 일치 여부, 보상 지급 유효성을 서버에서 확인한 후 `episode_unlocks` 생성
- **백엔드 Express API 및 Service 연동**:
  - `src/routes/ad.router.ts`, `src/services/adUnlock.service.ts`에 보안 RPC 연동

---

## 2. 세부 구현 대상 (Tasks)

### 2.1. 정산 신청 보안 검증 RPC (`database/12_functions.sql`)
```sql
CREATE OR REPLACE FUNCTION private.request_author_settlement(
  p_author_id BIGINT,
  p_amount NUMERIC
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_author public.authors;
  v_account public.author_settlement_accounts;
  v_minimum NUMERIC;
  v_balance NUMERIC;
  v_settlement_id UUID;
BEGIN
  -- 1. 작가 본인 및 승인 상태 검증
  IF NOT EXISTS (
    SELECT 1 FROM public.authors
    WHERE id = p_author_id AND auth_user_id = (SELECT auth.uid()) AND status = 'APPROVED'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- 2. 최소 정산금액 검증
  SELECT minimum_settlement_amount INTO v_minimum FROM public.system_config WHERE id = 'default';
  IF p_amount < v_minimum THEN
    RETURN jsonb_build_object('success', false, 'error', 'BELOW_MINIMUM');
  END IF;

  -- 3. 확정 잔액 검증
  SELECT COALESCE(SUM(CASE WHEN status = 'CONFIRMED' THEN author_revenue ELSE 0 END), 0)
  INTO v_balance FROM public.author_earnings WHERE author_id = p_author_id;

  IF p_amount > v_balance THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
  END IF;

  -- 4. 인증된 정산 계좌 조회
  SELECT * INTO v_account FROM public.author_settlement_accounts
  WHERE author_id = p_author_id AND is_primary = true AND verification_status = 'VERIFIED' LIMIT 1;

  IF v_account.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SETTLEMENT_ACCOUNT_NOT_VERIFIED');
  END IF;

  -- 5. 스냅샷 데이터와 함께 정산 신청 저장
  SELECT * INTO v_author FROM public.authors WHERE id = p_author_id;
  INSERT INTO public.author_settlements (
    author_id, author_name_snapshot, bank_name_snapshot, account_number_snapshot, account_holder_snapshot, amount
  ) VALUES (
    v_author.id, v_author.pen_name, v_account.bank_name, v_account.account_number_encrypted, v_account.account_holder, p_amount
  ) RETURNING id INTO v_settlement_id;

  RETURN jsonb_build_object('success', true, 'settlement_id', v_settlement_id);
END;
$$;
```

### 2.2. 보상형 광고 안전 해금 RPC (`database/12_functions.sql`)
- `private.grant_rewarded_ad_unlock(p_user_id, p_episode_id, p_ad_event_id)`

---

## 3. 검증 계획
1. 작가가 확정 잔액 이상의 금액으로 출금 신청 시 `INSUFFICIENT_BALANCE` 에러 반환 검증
2. 계좌 미인증 작가의 정산 신청 차단 검증
3. 유효하지 않은 광고 이벤트 ID로 회차 해금 시도 시 거절 검증
