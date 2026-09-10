# [Improvement Step 5] 투명한 수익 원장(Ledger) 표 & 독자 후원 시스템 완성 (improve5.md)

## 1. 개요 및 목적
현재 DB에는 불변 수익 원장(`earning_ledger`)과 후원(`creator_supports`) RPC가 구현되어 있으나, 작가 스튜디오에서는 3대 요약 수익(예상/확정/출금가능)만 볼 수 있어 **"내 수익이 어느 회차의 어떤 광고/후원에서 나왔는지"** 구체적 근거를 확인할 수 없습니다. 본 단계에서는 **회차별/일자별 투명 수익 원장 데이터 테이블 뷰어와 독자 전용 포인트 후원 모달/명예의 전당**을 완성합니다.

---

## 2. 변경 대상 파일 목록
1. `public/index.html` : 작가 스튜디오 정산 탭 내 '수익 상세 원장(Ledger) 내역' 테이블, 독자 '작가 응원/후원 팝업 모달(`modalSupportCreator`)' 추가
2. `public/js/creator/creator.js` : `earning_ledger` 조회 및 데이터 테이블 바인딩 (수익원: AD, SUPPORT, POINT_SALE / 상태: ESTIMATED, CONFIRMED, SETTLED)
3. `public/js/reader/reader.js` : 작품 상세 및 뷰어 내 후원 모달 트리거, 포인트 잔액 실시간 차감 반영, '오늘의 후원자 명단' 위젯
4. `public/supabase-admin.js` : `fetchAuthorEarningLedger(authorId)` 원장 조회 함수 보강
5. `src/routes/creator.router.ts` : `/api/creator/ledger` 엔드포인트 연동

---

## 3. 세부 기능 개발 명세

### 3.1 작가 스튜디오: 회차별/수익원별 투명 원장 데이터 테이블
- 작가 스튜디오 정산 관리 탭 하단에 **[수익 발생 상세 내역 (원장)]** 그리드 탑재:
  1. **발생 일시**: `YYYY-MM-DD HH:mm`
  2. **작품 / 회차**: 예: `[폭풍의 여왕 서약] 4화`
  3. **수익 유형 (Source)**:
     - 📺 보상형 광고 시청 (`AD`)
     - 💖 독자 포인트 후원 (`SUPPORT`)
     - 🔑 유료 포인트 열람 (`POINT_SALE`)
  4. **금액 및 통화**: `+₩25 (KRW)` 또는 `+1,000P`
  5. **상태 (Status)**:
     - `추정(ESTIMATED)`: 실시간 발생 중 (당월 마감 전)
     - `확정(CONFIRMED)`: 월말 마감 완료 (출금 가능 잔액 산입)
     - `정산완료(SETTLED)`: 작가 계좌로 실제 송금 집행 완료
  6. 날짜별 / 작품별 필터링 기능 제공.

### 3.2 독자 후원(Support) 전용 인터랙티브 모달 (`modalSupportCreator`)
- **기존 방식**: 단순 `window.prompt`로 포인트 숫자만 입력받던 방식 개선.
- **개선 내용**:
  1. 작가 프로필, 필명, 현재 보유 독자 포인트 표시.
  2. 퀵 선택 버튼: `1,000P`, `3,000P`, `5,000P`, `10,000P`, `50,000P` 및 직접 입력.
  3. 따뜻한 한 줄 응원 메시지 입력 필드 (작가의 스튜디오에 전달).
  4. '익명으로 후원하기' 체크박스 지원.
  5. 후원 완료 시 화려한 콘페티(Confetti) 효과와 함께 감사 토스트 표시.
  6. 작품 상세 페이지 하단에 **"오늘의 후원 랭킹 (Top Supporters)"** 위젯 노출.

---

## 4. UI 컴포넌트 설계

### 독자 후원 모달 HTML 구조
```html
<div class="modal-backdrop" id="modalSupportCreator">
  <div class="modal-dialog glass-panel dialog-sm">
    <div class="modal-header">
      <h3><i data-lucide="heart" style="color:var(--cdg-pink);"></i> 작가님 응원하기 (후원)</h3>
      <button class="btn btn-icon btn-ghost modal-close"><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body text-center">
      <p class="text-muted small mb-3"><strong id="supportTargetAuthorName">작가</strong>님에게 창작 지원금을 전달합니다.</p>
      <div class="support-preset-grid mb-3">
        <button type="button" class="btn btn-outline support-btn" onclick="selectSupportAmount(1000)">1,000P</button>
        <button type="button" class="btn btn-outline support-btn" onclick="selectSupportAmount(3000)">3,000P</button>
        <button type="button" class="btn btn-outline support-btn active" onclick="selectSupportAmount(5000)">5,000P</button>
        <button type="button" class="btn btn-outline support-btn" onclick="selectSupportAmount(10000)">10,000P</button>
      </div>
      <input type="number" id="customSupportPoints" class="form-input text-center mb-3" value="5000" min="1000" max="50000">
      <input type="text" id="supportMessage" class="form-input mb-3" placeholder="작가님께 남길 응원 한마디 (선택사항)">
      <div class="text-left mb-3">
        <label class="small text-muted flex-center-start gap-2">
          <input type="checkbox" id="supportIsAnonymous"> 후원자 명단에 닉네임을 숨깁니다 (익명)
        </label>
      </div>
      <div class="text-muted small">보유 포인트: <span id="supportCurrentPoints" class="text-pink font-bold">0P</span></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary w-full" id="btnConfirmSupport"><i data-lucide="gift"></i> 포인트 전달하기</button>
    </div>
  </div>
</div>
```

---

## 5. 검증 체크리스트
- [ ] 독자가 1,000P를 후원했을 때 포인트가 즉시 차감되고 `creator_supports` 및 `earning_ledger`에 CONFIRMED 상태로 기록되는가?
- [ ] 동일한 멱등키(idempotency key)로 중복 후원 요청 시 포인트가 이중 차감되지 않는가?
- [ ] 작가 스튜디오 정산 탭에서 광고 시청 및 후원 내역이 회차별 상세 원장 테이블에 실시간으로 표시되는가?
- [ ] 익명 후원 체크 시 후원자 명단에 닉네임 대신 '익명의 독자'로 표기되는가?
