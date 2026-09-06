# [Improvement Step 2] 프론트엔드 실용적 모듈화 (FSD 아키텍처 점진 도입)

## 1. 개요 및 배경
현재 `public/app.js`는 약 6,700줄에 달하는 단일 파일로 구성되어 있어, 비즈니스 로직(독서 뷰어, 결제/정산, 작가 스튜디오, 관리자 CMS, Supabase 실시간 동기화)이 한곳에 집중되어 있습니다.
무리한 React 전면 재작성 대신, **Native ES Modules(ESM) 기반의 점진적 모듈 분할**을 통해 `improve.md`의 FSD(Feature-Sliced Design) 아키텍처를 안전하게 실현합니다.

---

## 2. 모듈 분할 디렉토리 설계 (FSD 매핑)

```
public/
├── js/
│   ├── core/                      # 앱의 공통 인프라 레이어
│   │   ├── router.js              # History API 라우터 (Semantic URL 해석)
│   │   ├── event-bus.js           # 컴포넌트 간 이벤트 발행/구독 (Decoupled)
│   │   ├── state.js               # 전역 클라이언트 상태 (User, ActiveWork 등)
│   │   └── ui-utils.js            # Toast, Modal, Formatters
│   │
│   ├── entities/                  # 도메인 모델 및 데이터 CRUD
│   │   ├── work.js                # 작품 모델, 목록 조회, 필터링
│   │   ├── episode.js             # 회차 모델, 잠금/해금 판별
│   │   ├── user.js                # 독자 프로필, 포인트, 성인인증 상태
│   │   └── author.js              # 작가 프로필, 정산 계좌
│   │
│   ├── features/                  # 사용자 상호작용 기능 단위
│   │   ├── auth/                  # 로그인/회원가입/로그아웃
│   │   ├── reader/                # 웹소설/웹툰 뷰어, 글자크기/테마, 독서진행률
│   │   ├── library/               # 이어보기, 관심작품, 구독작가 동기화
│   │   ├── creator/               # 원고 에디터, AI 자동검수, 연재상태 관리
│   │   └── admin/                 # 16대 관제 메뉴, 5대 검수 콘솔
│   │
│   └── app.js                     # 진입점 (Entry Point: 부트스트랩 및 모듈 초기화)
```

---

## 3. 점진적 마이그레이션 원칙 (Zero-Regression Principles)

### 3.1 호환성 브릿지 (Global Bridge Pattern)
- 기존 `index.html`의 인라인 이벤트 핸들러(예: `onclick="switchWebNovelsView(...)"`)가 중단 없이 작동할 수 있도록 `window` 전역 객체에 네임스페이스 브릿지를 유지합니다.
- 모듈화 작업 중에도 브라우저 콘솔 오류 및 기존 기능 중단이 발생하지 않도록 샌드박스 방식으로 분할합니다.

### 3.2 단계별 전환 로드맵
1. **Phase 2-1 (Core 추출)**: 라우터(`router.js`)와 전역 상태(`state.js`)를 먼저 분리하여 1단계 URL 라우팅과 완벽 결합.
2. **Phase 2-2 (독자 기능 분리)**: 웹소설 뷰어(`reader.js`), 서재(`library.js`) 기능 분리.
3. **Phase 2-3 (포털 기능 분리)**: 작가 스튜디오(`creator.js`) 및 관리자 관제탑(`admin.js`) 분리.
