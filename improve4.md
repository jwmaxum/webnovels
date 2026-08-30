# 🎨 [Improvement Step 4] 크리에이터 스튜디오 실시간 수익 & 독자 경험 고도화

본 문서는 `needtochange1.md`의 핵심 개선 사항 중 **4단계: 작가 Creator Studio 일별/월별 수익 대시보드, 계좌 스냅샷 정산 신청 및 독자 대댓글/캐싱 경험 고도화** 작업을 위한 명세서입니다.

---

## 1. 개요 및 목적
- **작가 크리에이터 스튜디오 4대 수익 지표 실시간 렌더링**:
  - 오늘 예상 수익, 이번달 예상 수익, 확정 수익, 정산 가능 금액을 `author_earnings` DB와 실시간 연동
- **정산 신청 당시 계좌 스냅샷 보존**:
  - 작가가 출금 요청 시 당시의 은행명, 계좌번호, 예금주 정보를 스냅샷 컬럼에 영구 기록하여 계좌 변경 시에도 과거 정산 정합성 보장
- **독자 대댓글(Nested Comments) 인터랙션 지원**:
  - `comments.parent_id`를 기반으로 원댓글 아래 답글 들여쓰기 렌더링 및 답글 작성 UI 제공
- **프론트엔드 캐싱 및 실시간 동기화 최적화**:
  - 독서 진도율 및 광고 언락은 실시간 동기화(staleTime: 0), 작품 메타데이터는 안전한 로컬 캐싱 적용

---

## 2. 세부 구현 대상 (Tasks)

### 2.1. 작가 크리에이터 스튜디오 4대 수익 카드
```html
<div class="creator-kpi-grid">
  <div class="kpi-card">
    <span class="label">오늘 예상 수익</span>
    <strong id="creatorTodayEarnings">₩128,400</strong>
  </div>
  <div class="kpi-card">
    <span class="label">이번달 예상 수익</span>
    <strong id="creatorMonthEarnings">₩3,842,000</strong>
  </div>
  <div class="kpi-card">
    <span class="label">확정 수익</span>
    <strong id="creatorConfirmedEarnings">₩3,210,000</strong>
  </div>
  <div class="kpi-card highlight">
    <span class="label">정산 가능 금액</span>
    <strong id="creatorPayableEarnings">₩2,850,000</strong>
    <button id="btnOpenSettlementModal">출금 신청</button>
  </div>
</div>
```

---

### 2.2. 정산 신청 시 계좌 스냅샷 로직 (`public/supabase-admin.js`)
```javascript
async function requestSettlementWithSnapshot(authorId, amount) {
  // 1. 작가 현재 등록 계좌 정보 조회
  const { data: author } = await supabaseClient
    .from('authors')
    .select('pen_name, bank_info')
    .eq('id', authorId)
    .single();

  // 2. 스냅샷 데이터 생성 및 저장
  return await supabaseClient.from('author_settlements').insert({
    author_id: authorId,
    author_name: author.pen_name,
    author_name_snapshot: author.pen_name,
    bank_name_snapshot: parseBankName(author.bank_info),
    account_number_snapshot: parseAccountNumber(author.bank_info),
    amount: Number(amount),
    status: 'PENDING',
    requested_at: new Date().toISOString()
  });
}
```

---

### 2.3. 독자 대댓글 UI 렌더링 (`public/app.js`)
- `parent_id === null`인 최상위 댓글 조회 후, 해당 댓글의 `id`를 `parent_id`로 갖는 대댓글들을 계층형 트리로 렌더링
- [답글 달기] 버튼 클릭 시 해당 댓글 아래 대댓글 입력 폼 동적 노출

---

## 3. 코드 연동 반영
- `public/app.js`: 크리에이터 스튜디오 렌더링 함수(`renderCreatorStudioView`), 대댓글 렌더링 함수(`renderCommentsList`) 고도화
- `public/styles.css`: 대댓글 들여쓰기(`margin-left: 28px`, `border-left: 2px solid var(--border-color)`) 및 수익 카드 스타일 적용

---

## 4. 검증 계획
1. 작가 로그인 시 크리에이터 스튜디오의 4대 수익 금액이 DB 계산값과 정확히 일치하는지 확인
2. 정산 신청 후 작가가 프로필 계좌를 변경해도 기존 신청 내역의 스냅샷 계좌 정보가 유지되는지 확인
3. 독자 댓글/대댓글 등록 및 계층형 표시 정상 작동 검증
