# 🚀 [Improve Step 3] 광고 시청 검증 & 안전한 회차 Unlock 트랜잭션

## 1. 목적 및 배경
`improve.md` 9, 10항목에서 지적된 "클라이언트가 직접 DB에 `episode_unlocks` UPSERT 및 `logAdEvent('REWARD')` 조작 가능" 취약점을 보완합니다.

---

## 2. 세부 작업 항목

### [작업 3-1] 클라이언트 직접 `episode_unlocks` 임의 UPSERT 차단
* **대상 파일**: `public/supabase-admin.js` (`recordEpisodeUnlock`, `unlockEpisodeWithAd`), `public/app.js`
* **내용**:
  - 클라이언트에서 파라미터만 넘겨 무단으로 언락 레코드를 생성하지 못하도록 차단.
  - `ad_event_id`가 null이거나 위조된 요청을 거부하는 보안 검증 적용.

### [작업 3-2] 서버/RPC 기반 광고 완료 검증 및 언락 발급 (`unlockEpisodeWithAdSecure`)
* **대상 파일**: `public/supabase-admin.js`, `public/app.js` (`startAdSimulation`)
* **내용**:
  - 광고 시청 세션 시작(`ad_session`) ➔ 광고 완료 이벤트 기록 ➔ 서명/검증된 이벤트 ID를 기반으로 `unlock_episode_with_ad` RPC를 호출하여 안전하게 72시간 언락 권한 발급.

---

## 3. 검증 기준
- [ ] 유효한 광고 시청 이벤트 없이 임의로 4~6화가 해금되지 않는지 확인.
- [ ] 정상 광고 시청 완료 후 `episode_unlocks`에 올바른 `ad_event_id`와 함께 72시간 만료일(`expires_at`)이 정확히 기록되는지 확인.
- [ ] `npx tsc --noEmit` 통과.
