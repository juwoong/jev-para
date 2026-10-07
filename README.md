# Jev PARA v0.4.0

Inbox에 넣어 둔 노트를, 각 분류 폴더의 `INDEX.md`에 적은 기준과 Jev 판단으로 PARA 위치에 정리하는 Obsidian 데스크톱 플러그인입니다. 여기서 sync는 외부 동기화가 아니라 로컬 Inbox 정리 실행을 뜻합니다.

## 설치

[v0.4.0 릴리스](https://github.com/juwoong/jev-para/releases/tag/v0.4.0)에서 `main.js`, `manifest.json`, `styles.css`를 내려받아 vault의 `.obsidian/plugins/jev-para/`에 넣고 활성화합니다. 화면은 영어이며 기존 한국어 INDEX 형식은 그대로 지원합니다.

### 소스에서 빌드

1. 저장소 루트에서 `npm install` 후 `npm run build`를 실행합니다.
2. `npm run install:testing`으로 대상 vault의 `.obsidian/plugins/jev-para/`에 `main.js`, `manifest.json`, `styles.css`를 복사합니다. 다른 vault를 쓰려면 `JEV_PARA_VAULT=/path/to/vault`를 지정합니다.
3. Obsidian의 설정 → 커뮤니티 플러그인에서 `Jev PARA`를 활성화합니다.

## API 키 입력

설정 → Jev PARA의 `API key source`에서 두 가지 중 하나를 고릅니다. 기본값은 **설정에서 직접 입력**입니다.

**설정에서 직접 입력** — `API token` 칸에 키를 붙여넣고 `Save`을 누릅니다. 저장한 값은 화면에 다시 표시하지 않습니다. Obsidian에 암호화 저장소(`app.secretStorage`)가 있으면 거기에 보관하고, 없는 버전에서는 플러그인 `data.json`에 저장하며 설정 화면에 그 사실을 표시합니다. `Delete`로 지울 수 있습니다.

**`.env` 파일에서 읽기** — vault 기준 상대 경로의 `.env`에서 `JEV_API_KEY` 하나만 읽습니다. 기본 경로는 `_dev/jev-para/.env`입니다. 설정에서 직접 적은 절대 경로도 쓸 수 있고, 상대 경로는 vault 밖으로 나갈 수 없습니다.

```dotenv
JEV_API_KEY=발급받은키
```

키를 `Save`하면 곧바로 연결 테스트가 한 번 실행되고, 성공·실패 결과가 알림과 `Token status` 줄에 남습니다. 언제든 `Test connection` 버튼으로 다시 확인할 수 있고, 정리 뷰 상단에도 같은 버튼이 있습니다. 연결 테스트는 고정된 짧은 합성 입력을 1회 호출하며 노트 내용은 보내지 않습니다. 두 방식 모두 `Reload token`를 제공합니다.

`.env`를 쓰는 경우 그 파일은 로컬 파일이므로 vault 동기화나 백업 도구에서 직접 제외하는 것이 좋습니다. `.gitignore`는 Git만 막고 동기화까지 막지는 않습니다.

## 분류 기준 작성

`1. Projects`, `2. Areas`, `3. Resources`, `4. Archives` 바로 아래에 폴더를 만들면 `INDEX.md`가 자동 생성됩니다. 기존 한국어 제목도 계속 지원하며, 영어·한국어 섹션이 함께 있으면 내용이 있는 영어 섹션을 우선합니다. 각 파일의 `## Description`에 이 폴더에 모을 내용을 적어야 분류 후보가 됩니다. `## Include`과 `## Exclude`은 선택 사항이지만 적으면 판단이 정확해집니다. 설명이 없는 폴더는 분류 대상에서 빠집니다.

```markdown
---
para: projects
---

# 서비스 출시

## Description
새 서비스의 베타 출시를 준비하는 프로젝트.

## Include
- 출시 일정과 체크리스트
- 베타 사용자 피드백

## Exclude
- 평소 사업 운영 기록 → Areas/사업 운영
```

분류 폴더는 PARA 루트 바로 아래 한 단계만 사용합니다. 이름이 `_` 또는 `.`로 시작하는 폴더는 자동 생성과 분류에서 제외합니다. `Archives`는 INDEX만 만들고 자동 분류하지 않습니다.

## 수동 정리

분석 결과는 Ready to move → Needs review → Errors → Skipped 순서로 표시하며, 같은 상태에서는 confidence 내림차순으로 정렬합니다. `Move all ready`로 이동 가능한 노트를 한 번에 옮깁니다. 동점은 기존 순서를 유지하고, confidence가 없는 항목은 맨 아래에 표시합니다.

처음에는 수동 미리보기 모드입니다. 리본의 반짝임 아이콘이나 명령 팔레트의 `Open Jev PARA organizer`로 뷰를 열고 `Analyze`을 누르면, 각 노트의 목적지와 confidence, 선택 확률, 상위 후보가 표시됩니다. 실제 이동은 행을 선택한 뒤 `Move selected`을 눌러야 일어납니다. 목적지는 행의 선택 상자에서 직접 바꿀 수 있습니다.

## 자동 정리

설정에서 모드를 `Automatic sorting`로 바꾸면, 마지막 수정 후 대기 시간(기본 30초)이 지난 Inbox 노트를 분석하고 임계값을 모두 넘긴 경우에만 실제로 이동합니다. 기본 임계값은 confidence 0.80 이상, 선택 확률 0.80 이상, 1·2위 격차 0.20 이상입니다. 하나라도 미달하거나 동점이면 이동하지 않고 검토 대상으로 남깁니다. `Keep in Inbox`가 선택된 노트는 항상 Inbox에 남습니다.

인증 오류가 나면 자동 정리가 멈추고 키 확인을 안내합니다. 뷰의 `Pause automatic sorting`로 직접 멈출 수도 있습니다.

## 되돌리기

`Undo last run`는 마지막 이동 실행을 원래 위치로 되돌립니다. 이동 후 노트를 수정했거나 원래 위치에 다른 파일이 생겼으면 해당 항목은 건너뛰고 이유를 알려줍니다. 되돌린 노트는 같은 내용으로 다시 자동 이동하지 않도록 보류되며, 내용이 바뀌거나 다시 분석하면 해제됩니다.

## 첫 버전 제한

- Markdown 노트만 옮깁니다. PDF, 이미지와 기타 첨부파일은 이동하지 않고 개수만 표시합니다.
- Inbox 바로 아래의 노트만 대상입니다. Inbox 안의 하위 폴더는 처리하지 않습니다.
- 이미 정리된 노트를 자동으로 다시 분류하지 않습니다. Inbox로 되돌리면 다시 대상이 됩니다.
- 프로젝트 완료 여부를 추측하지 않습니다. 보관은 사용자가 `4. Archives`로 직접 옮깁니다.
- 노트 내용을 요약하거나 다시 쓰지 않고, 폴더를 새로 만들지 않습니다.
- 이동은 Obsidian의 파일 이동 기능을 사용하므로 링크 갱신은 Obsidian 설정을 따릅니다. 보존을 보장할 수 없는 경우 해당 노트는 검토로 남깁니다.

## 개발과 테스트

```bash
npm run typecheck   # 타입 검사
npm test            # 시나리오 기반 테스트
npm run dev         # 번들 (소스맵 포함)
npm run build       # 배포용 번들
npm run install:testing
```

동작 계약은 `IMPLEMENTATION_PROMPT.md`, 검증 시나리오는 `TEST_SCENARIOS.md`에 있습니다. 네트워크가 필요한 검증은 `TEST_SCENARIOS.md`의 `LIVE` 항목으로 분리되어 있고 기본 테스트에는 포함되지 않습니다.

## 개인정보

분석을 실행하면 대상 노트의 제목과 본문, 그리고 폴더 분류 기준이 설정된 Jev API 주소로 전송됩니다. 키와 노트 본문은 로그에 남기지 않습니다.
