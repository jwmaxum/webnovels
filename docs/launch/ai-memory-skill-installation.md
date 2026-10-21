# ai-memory 스킬 설치 기록

2026-10-21. 사용자가 지정한 [akitaonrails/ai-memory](https://github.com/akitaonrails/ai-memory)의
공식 `plugins/codex/skills`를 설치했다. 검토·설치한 고정 커밋은
`5519b89cc653bec4cfccbb770c6b4e5dcfcda759`이다.

설치 위치는 `C:/Users/Microsoft/.codex/skills/`이며 다음 7개다.

- `ai-memory-retrieval`
- `ai-memory-durable-pages`
- `ai-memory-handoff`
- `ai-memory-learning-maintenance`
- `ai-memory-messaging`
- `ai-memory-routing-install`
- `status`

Codex의 skill-installer로 공식 파일을 설치했다. 런타임 바이너리·MCP 서버·자동 기록 후크/
서비스는 별도 구성 대상이며 이번에 설치·활성화하지 않았다. 따라서 현재 작업에서 메모리
서버를 사용하거나 원고·계정 정보를 메모리에 전송한 것으로 보고하지 않는다. 새 스킬의
인식을 위해 Codex를 재시작한다. 후속 서버 구성은 공식 설치 문서를 기준으로 로컬 저장 위치,
범위와 비밀 제외 정책을 확인한 뒤 진행한다.
