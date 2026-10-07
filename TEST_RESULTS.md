# Jev PARA 테스트 결과

이 문서는 [TEST_SCENARIOS.md](TEST_SCENARIOS.md)의 시나리오가 실제로 어떤 테스트로 검증됐는지 기록합니다. 자동 테스트는 mock·가짜 vault·가짜 시계로 실행했고, 실제 Obsidian과 실제 Jev API는 별도로 구분했습니다. 통과하지 않았거나 실행하지 않은 항목은 통과로 기록하지 않았습니다.

## 검증 명령과 결과

| 검증 | 명령 | 결과 |
|---|---|---|
| 타입 검사 | `npm run typecheck` | 통과, 오류 0 |
| 전체 테스트 | `npm test` | 12개 파일, 260개 테스트 통과 |
| 실 API 검증 | `npm run test:live` | 3개 테스트 통과, 인증·합성 분류·키 저장 왕복 확인 |
| 배포 빌드 | `npm run build` | 통과, `main.js` 약 79KB, CJS 출력 |
| vault 설치 | `npm run install:testing` | `main.js`, `manifest.json`, `styles.css` 배포 |
| 설치 안전성 | 임시 vault에 배포 후 해시 비교 | 다른 플러그인 `data.json`과 기존 노트 바이트 보존 |
| 비밀값 검사 | 배포된 `main.js` 문자열 검사 | `apikey_` 0건, 키 값 미포함 |

전체 테스트는 마지막 통합 상태에서 다시 실행했고, 통합 중 `VaultPort.listFiles` 추가, 오케스트레이터 큐 정리, 키 입력 방식과 연결 테스트 추가 후에도 260개가 모두 통과했습니다.

## 자동 검증된 시나리오

| 시나리오 | 테스트 파일 | 검증 내용 |
|---|---|---|
| SET-02, SET-03 | `tests/para/indexFile.test.ts` | PARA 루트 생성과 파일 충돌 보존 |
| SET-04, SET-05, SET-06 | `tests/para/candidates.test.ts`, `tests/para/scope.test.ts` | Inbox 범위, 예약 파일, 제외 경로 |
| IDX-01 ~ IDX-10 | `tests/para/indexFile.test.ts` | 직접 하위만 생성, 기존 INDEX 보존, 멱등성, 템플릿 이스케이프 |
| CAT-01 ~ CAT-06 | `tests/para/candidates.test.ts` | 설명 활성 조건, Archives 제외, 결정적 ID, 불일치 경고 |
| KEY-01 ~ KEY-07 | `tests/jev/env.test.ts`, `tests/jev/client.test.ts` | dotenv 파싱, 경로 탈출 거부, 키 비노출, 합성 연결 테스트 |
| KEY-08 ~ KEY-12 | `tests/orchestrator.test.ts` | 설정 직접 입력 키 사용, 키 부재 시 호출 0회, 삭제, 빈 값 거부, 연결 테스트 결과 기록 |
| API-01 ~ API-09 | `tests/jev/client.test.ts`, `tests/jev/validate.test.ts` | 엔드포인트·헤더·본문 형태, 후보/크기 한도, 응답 계약 검증 |
| DEC-01 ~ DEC-08 | `tests/policy/decision.test.ts` | 임계값 경계, 동률, Inbox 유지, 잘못된 설정 |
| CAC-01 ~ CAC-04 | `tests/policy/cache.test.ts` | 키 의존성, 격리 복제, 인스턴스 지속, 임계값 독립 |
| MOV-01 ~ MOV-09 | `tests/fs/mover.test.ts` | 재검증 순서, 충돌, 원본 보존, 부분 성공 |
| REC-01 ~ REC-05 | `tests/fs/recovery.test.ts` | pending 복구 3분기, 손상 저널, prune |
| UND-01 ~ UND-05 | `tests/fs/recovery.test.ts` | 해시·원위치 검사, 부분 되돌림, 재이동 방지 |
| QUE-01, QUE-02 | `tests/orchestrator.test.ts` | 안정 시간 대기와 재시작 |
| QUE-06, QUE-07 | `tests/orchestrator.test.ts` | 오래된 응답 폐기, dispose 후 적용 차단 |
| ERR-01 | `tests/orchestrator.test.ts`, `tests/jev/client.test.ts` | 인증 실패 시 자동 정지 |
| ERR-02 ~ ERR-06 | `tests/jev/client.test.ts` | 재시도 횟수, Retry-After, 입력 오류 |
| MOV-01, MOV-02, UND-01 (통합) | `tests/orchestrator.test.ts` | 오케스트레이터를 통한 실제 이동·충돌·되돌리기 |
| CAC-01 (통합) | `tests/orchestrator.test.ts` | 반복 분석 시 추가 호출 없음 |

## 실 API 검증 (선택 실행)

기본 `npm test`에서는 제외되며 `npm run test:live`로만 실행합니다. 실제 키를 사용하지만 노트 대신 합성 입력만 보내고, 키 값은 출력하지 않습니다.

| 시나리오 | 결과 | 관찰 내용 |
|---|---|---|
| LIVE-01 | 통과 | `.env` 키로 `loadApiKey` → `JevClient.testConnection` 경로가 인증에 성공하고 응답 계약을 통과했습니다. |
| LIVE-02 | 통과 | 합성 노트 3건 모두 의도한 폴더로 분류됐습니다. 베타 인터뷰 정리 → `1. Projects/서비스 출시`, 운동 기록 → `2. Areas/건강`, 에이전트 설계 원칙 → `3. Resources/AI 에이전트`. 세 건 모두 confidence 1.00, 선택 확률 1.00이었습니다. |
| LIVE-03 | 통과 | 배포된 `data.json`을 읽고, 실제 키를 `.env`로 로딩한 뒤 설정 저장 방식의 두 경로(`app.secretStorage` 있음/없음)에 저장·조회 왕복이 모두 성립하는지 확인했습니다. |

LIVE-02는 모델 출력에 의존하는 평가라 매 실행의 확률이 달라질 수 있습니다. 통과 여부는 계약 검증이며, 폴더 선택은 관찰 기록으로 남깁니다.

## 자동 검증되지 않은 부분

다음 항목은 코드에 반영했지만 자동 테스트로 확정하지 못했습니다. 통과로 간주하지 않습니다.

| 시나리오 | 상태 | 사유 |
|---|---|---|
| SET-01 | 부분 | 플러그인 수명 주기 동작은 실제 Obsidian에서 확인해야 합니다. 기본 수동 모드와 무이동 원칙은 코드에 반영되어 있습니다. |
| API-08 | 미실행 | 128KiB 직렬화 한도 코드는 있으나, 그 크기를 만드는 전용 테스트를 작성하지 않았습니다. |
| ERR-05 (타임아웃) | 미실행 | `timeoutMs`는 실제 HTTP 어댑터가 강제합니다. mock에는 벽시계 타임아웃 시뮬레이션이 없습니다. |
| ERR-07 (backoff 중 중단) | 미실행 | 대기 중 취소는 세션 토큰으로 적용을 막는 상위 계층 관심사입니다. |
| MOV-09, MOV-10 | 부분 | 실제 동시성 경합과 첨부 링크 갱신은 Obsidian 런타임에서만 확인 가능합니다. |
| UI-01 ~ UI-07 | 미실행 | 뷰·설정 화면은 실제 Obsidian에서 확인해야 합니다. |
| FLOW-01 ~ FLOW-03 | 미실행 | 전체 사용자 흐름의 호스트 검증이 필요합니다. |
| HOST-01 ~ HOST-05 | 미실행 | Obsidian 앱 실행이 이 환경에서 불가능했습니다. 링크 보존과 한국어 폴더명 처리는 실제 앱에서 확인해야 합니다. |
## 배포 위치

| vault | 플러그인 경로 | 상태 |
|---|---|---|
| `/Users/juwoong/vaults/testing` | `.obsidian/plugins/jev-para/` | 설치·활성 목록 등록. 키는 기본값인 설정 직접 입력, `.env 경로`는 vault 상대 `_dev/jev-para/.env`로 준비 |
| `/Users/juwoong/vaults/testing/plugin-test` | `.obsidian/plugins/jev-para/` | 설치·활성 목록 등록. Obsidian이 현재 열고 있는 vault. 키 입력 방식은 설정 직접 입력이며, `.env 경로`에 절대 경로를 준비해 한 번 전환하면 바로 쓸 수 있음 |

두 vault의 `main.js` 해시는 동일하며 빌드 산출물과 일치합니다. `plugin-test`는 상대 경로로 `.env`에 닿을 수 없어 절대 경로를 준비했으므로, KEY-04의 상대 경로 탈출 차단은 그대로 유지됩니다.

## 키 저장 위치

입력한 키는 Obsidian이 `app.secretStorage`를 제공하면 그 암호화 저장소에 보관하고, 제공하지 않으면 플러그인 `data.json`에 저장합니다. 설정 화면이 현재 어느 쪽인지 표시합니다. 이 환경에 설치된 Obsidian은 1.8.7이라 `data.json` 경로가 사용될 가능성이 높고, 그 경우 키가 평문으로 저장된다는 점을 UI에 명시합니다. 어느 경로든 키 값은 화면·로그·테스트 출력에 남기지 않습니다.

## 알려진 제한

- `_dev/jev-para`가 testing vault 안에 있어 Obsidian이 소스와 `node_modules`를 함께 인덱싱합니다. vault가 느려지면 Obsidian의 제외 필터에 `_dev`를 추가하는 편이 좋습니다.
- 실제 모델의 의미 분류 품질은 mock으로 검증할 수 없습니다. `TEST_SCENARIOS.md`의 선택적 실 API 평가가 남아 있습니다.
- LIVE-02는 합성 노트 3건에 대한 단일 실행 관찰이며, 실제 사용자의 다양한 노트에 대한 정확도를 보증하지 않습니다.
- 플러그인은 testing vault에 배포했고 `community-plugins.json`에 등록했습니다. 실제 로딩 확인은 Obsidian을 열어야 합니다.
