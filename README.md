# STEP D Agent Workspace

독립 개발용 영상 운영 워크스페이스입니다. 기존 STEP D 프론트는 수정하지 않습니다.

## 실행

Node.js 20.9 이상이 필요합니다. 설치한 버전은 `package-lock.json`에 고정되어 있습니다.

```powershell
npm install
npm run dev
```

http://localhost:3000 에서 엽니다. 기본 모드는 `mock`이며 API 키 없이 전체 P0 흐름이 동작합니다. 설정이 필요하면 `.env.example`을 `.env.local`로 복사합니다.

현재 개발 환경은 서버 전용 Gemini 3.1 Flash-Lite provider를 `live` 모드로 설정했습니다. STEP D 데이터는 계속 데모 fixture를 사용합니다. 키는 Git에서 제외되는 `.env.local`의 `GOOGLE_GENERATIVE_AI_API_KEY`에만 설정하며 브라우저 환경 변수로 전달하지 않습니다.

```powershell
# API 프로젝트의 키·사용 권한·크레딧 확인 (실제 소량 API 호출)
npm run check:provider
```

Google이 HTTP 402를 반환하면 AI Studio 프로젝트의 결제·선불 크레딧을 확인해야 합니다. 모델 API 실패를 UI에 표시하며 자동으로 mock 답변을 대신 생성하지 않습니다. 키 없이 UI를 검증하려면 서버 설정의 `AGENT_MODE=mock`을 사용합니다.

live 모드의 7개 의도(작품 이해, 회차 흐름, 장면 검색, 기획안, 추천 근거, 초안, 성과 미연결)를 실제 Gemini 호출로 확인했습니다. 각 응답은 도구로 조회한 원문에서만 카드를 구성합니다.

## 구현한 흐름

1. 프로그램 / 1–5회 범위 / 스포일러 제외를 선택합니다.
2. `정체 들킬 뻔한 장면 찾아줘`를 입력하거나 시작 예시를 클릭합니다.
3. 도구 실행 상태와 프레임, 원본 시간, 대사, 인물, 해석, 권리 상태가 있는 장면 카드를 확인합니다.
4. `후보에 담기` → 작업 보드의 `쇼츠 기획안 만들기`를 누릅니다.
5. 3개 후보에서 시작 3초 / 전개 / 엔딩 5초, 총 20–40초 구성과 추천 출처를 확인합니다.
6. `추천 근거 보기` 또는 `왜 2번을 추천했어?`로 근거를 읽습니다.
7. `이 초안 만들기` 또는 `2번 초안 만들어줘`로 draft를 생성합니다.
8. `편집기에서 열기`에서 제목, 자막, 썸네일 문구를 수정하고 저장합니다.

모바일에서는 탐색 드로어와 하단 작업 보드를 사용합니다. 장면과 후보는 대화 안에 누적되고, 고정한 후보는 다른 답변을 받아도 작업 보드에 남습니다. 최근 작업은 브라우저 localStorage에 최대 6개 보관됩니다.

## 데이터의 의미

- 착한 여자 부세미, 나미브, 솔로정보회사에 각 5개 장면 fixture를 제공합니다.
- 작품명 외의 소개, 인물 설정, 회차, 시간, 대사, 점수는 만든 예시입니다. 실제 방송 내용으로 검증된 정보가 아닙니다.
- 프레임은 `public/frames/demo-frame.svg`의 로컬 placeholder입니다. 재생 버튼은 미리보기를 열고 원본 영상 미연결 상태를 명시합니다.
- 기본 필터는 스포일러 안전 장면만 반환합니다. 약함 / 강함은 스포일러 포함 선택 시 검색됩니다.
- 요약과 편집 기획은 해석 / 초안입니다. 원본 추천 순위와 요청에 맞춘 재정렬을 각각 표시합니다.
- mock의 재정렬은 fixture 규칙 시뮬레이션입니다. 실제 AI 모델을 호출하지 않습니다.
- 권리는 모두 `확인 필요`입니다. 성과 수치와 댓글을 만들어 넣지 않습니다.
- 성과 브리핑, 반응 요약, 성과 기반 재추천은 준비 상태이며 `성과 데이터가 아직 연결되지 않았습니다`를 표시합니다.

## 구조

```text
app/                          App Router, API, 초안 편집 페이지
components/chat/              브리핑과 도구 상태
components/scene/             장면 카드와 프레임
components/clip-plan/         기획안, 타임라인, 편집기
components/workspace/         3열 화면, 드로어, 작업 보드
fixtures/                     세 작품의 명시적 데모 fixture
fixtures/stepd-mcp/           실제 STEP D MCP 응답 캡처 (계약 테스트 입력)
lib/stepd/                    gateway 계약, mock/MCP adapter, 텍스트 파서, draft 저장
lib/agent/                    시스템 지시, 도구 스키마, provider, workflow
types/                        Zod 입력/출력 계약과 메시지 타입
tests/                        도메인 검증과 브라우저 흐름
```

`StepDGateway`가 데이터 접근 경계입니다. `MockStepDGateway`를 `McpStepDGateway`로 설정 교체할 수 있습니다. MCP는 AI SDK 공식 client/adapter를 사용합니다.

## STEP D MCP 계약

실제 STEP D MCP 서버의 읽기 전용 도구를 호출하고, 응답을 **만드는 코드**(`STEPD-repo/packages/mcp`)를 읽어 계약을 확정했습니다. 도구 **이름**은 이 저장소와 1:1이지만 **입력·응답은 전혀 다릅니다**. `McpStepDGateway`가 그 차이를 번역합니다.

### 붙이는 방법

서버는 자세가 둘입니다(`packages/mcp/README.md`). `STEPD_REQUIRE_SESSION`이 가릅니다.

| 자세 | 주소                           | 자격증명                 |
| ---- | ------------------------------ | ------------------------ |
| 로컬 | `http://127.0.0.1:7801/mcp`    | **필요 없음**(인증 꺼짐) |
| 원격 | Cloud Run `https://<주소>/mcp` | 계정별 OAuth 2.1 Bearer  |

```powershell
# STEPD-repo에서 MCP 서버를 띄우고
pnpm --filter @stepd/mcp start:http
# 이 앱의 .env.local에
STEPD_GATEWAY=mcp
STEPD_MCP_URL=http://127.0.0.1:7801/mcp
# STEPD_AUTH_TOKEN 은 원격 자세에서만 필요합니다
```

로컬 자세는 토큰이 없으므로 `STEPD_AUTH_TOKEN`을 요구하지 않습니다. 있으면 `Authorization: Bearer`로 보냅니다(원격 OAuth). MCP 서버가 STEP D 백엔드를 부를 때 쓰는 `x-stepd-session`은 서버 내부 사정이고 이 앱이 다루지 않습니다.

| 항목         | 이 저장소 계약                  | 실제 STEP D                                  |
| ------------ | ------------------------------- | -------------------------------------------- |
| 프로그램 id  | `busemi`/`namib`/`solo` enum    | `p_aaaa0003` 불투명 ID · 작품 20개           |
| 회차         | 1–5 번호 범위                   | 회차 ID(`e_…`) + media ID(`m_…`) · 35회차    |
| 회차 조회    | `programId` + `episodeMax` 범위 | `episode` 1건 + `range` 타임코드             |
| 검색 입력    | `includeSpoilers` · `similarTo` | `spoilers` · **비슷한 장면 미지원**          |
| 응답 형식    | JSON                            | **서술형 텍스트** · `structuredContent` 없음 |
| 장면 id      | 저장된 id                       | 없음 → `m_…@start-end`로 합성                |
| 훅 점수      | 0–100                           | 0–1                                          |
| 원본 순위    | `originalRank` 필수             | **개념 없음** → `null`                       |
| `list_clips` | `{sceneId, originalRank}`       | 완성 편집본(제목·길이·배포이력·편집 URL)     |
| 초안 생성    | `create_clip_draft`             | **없는 도구**                                |
| 대기열       | 미연결 상태 반환                | 배포본은 403 `superadmin only`               |
| 크레딧       | `balance: null` 고정            | 실제 잔액 숫자                               |
| 인물         | `confidence` 점수               | 점수 없음 · 별칭 묶음 + `명단 밖` 표시       |
| 스포일러     | 장면별 safe/mild/strong         | `권리:` 줄의 `⚠️ 스포일러` 표시 하나         |

번역에서 값을 만들어 내지 않습니다. STEP D가 주지 않는 것은 `null`/빈 값이 됩니다.

- `originalRank`가 `null`이면 주장할 원본 추천이 없다는 뜻이고, 모든 후보는 재정렬로 표시됩니다. `list_clips`의 최신순을 STEP D의 추천 순위로 바꿔 쓰지 않습니다.
- 인물 식별 점수가 없으므로 `confidence`는 `null`이며 UI는 `인물 확인 필요`로 표시합니다. 익명 화자(`발화자3`)는 이름 자리에 쓰지 않고 `이름 미확인 N명`으로 셉니다.
- 줄거리가 있으면 그대로 싣고, 비어 있으면 비었다고 적습니다. 소개를 생성하지 않습니다.
- `analyzedEpisodes`는 분석 단계가 `(done)`인 회차만 셉니다. `analyze(progress)` 회차는 아직 조회할 수 없습니다.
- 회차 흐름은 서버에 누적 조회 도구가 없어 `episodeMax` 이하의 **분석 완료된 최신 회차 1건**만 읽고, `analyzedRange`에 그 회차를 적습니다. 1–N회를 모두 봤다고 하지 않습니다.
- 변경 도구(`edit_captions`, `rerender_clip`, `set_shorts_title`, `set_channel_metadata`)는 gateway에 연결하지 않았고 호출하지도 않았습니다.

### 생성 코드를 읽고 고친 것

샘플만 보고 쓴 1차 파서에는 실제 버그가 있었습니다. 응답을 만드는 함수를 읽고 잡았습니다.

- **스포일러 표시는 `권리:` 줄 안에 있습니다**(`understand.ts` `rightsOf` → `⚠️ 스포일러 · 출연자 권리 확인필요`). 제목 줄의 `⚠️`만 보던 파서는 스포일러 장면을 전부 `safe`로 통과시켰습니다.
- `clock()`은 1시간을 넘기면 `h:mm:ss`입니다. 고정 `\d+:\d+` 패턴은 긴 회차를 오독했습니다.
- `castLabel`은 한 인물 안에 `·`를 넣습니다(`인물이(= 가명이 · 배우 배우이)`). `·`로 그냥 쪼개면 한 사람이 조각납니다.
- 방영일·장면유형·훅·권리·대사 줄이 **각각** 선택입니다. 하나라도 필수로 가정하면 그 장면이 조용히 버려집니다.
- 장면유형은 자유 텍스트(한국어)라 `\w` 캡처로는 잡히지 않습니다.
- `훅`은 **질의 일치도가 아니라** 그 장면이 볼 만한가입니다(`일치도`와 다른 축). 둘을 갈라 적습니다.
- 빈 질의에 `"최근 장면"` 같은 **검색어를 지어내지 않습니다.** 대신 회차 장면 목록을 읽습니다 — STEP D 자신의 근거 우선순위에서 검색은 4위(보조)이고 회차 조회가 2–3위입니다.

파서는 `lib/stepd/mcp-text.ts`에 있고 `tests/mcp-contract.test.ts`가 고정합니다. 입력은 `fixtures/stepd-mcp/`이며 출처(실제 캡처 / 생성 코드 분기)를 그 README에 구분해 적었습니다.

### 검증한 범위

로컬 MCP 서버를 띄워 앱에서 **실제로 붙는 것까지 확인했습니다** — Streamable HTTP 핸드셰이크, `tools/list`, 도구 이름 해석(`search_scenes`·`get_program_overview`), 그리고 STEP D 백엔드가 꺼져 있을 때 서버의 한국어 사유가 `isError` 경로로 그대로 올라오는 것까지입니다.

아직 검증하지 못한 것:

- **성공 응답을 네트워크로 받아 파싱한 적은 없습니다.** STEP D 백엔드(Postgres + `apps/server`)가 떠 있어야 하고, 새 로컬 DB는 비어 있습니다. 파싱 근거는 생성 코드와 배포 서버에서 받은 실제 응답입니다.
- 회차 선택 UI는 아직 1–5회 고정입니다. 실제 작품은 35회차까지 있어, 이 선택기를 작품의 `analyzedEpisodes`에서 만들도록 바꾸기 전에는 범위 밖 장면이 필터로 제외됩니다.
- `create_clip_draft`가 없어 `STEPD_GATEWAY=mcp`에서는 초안 생성이 실패합니다. 초안 저장 경로를 서버에 먼저 만들어야 합니다.
- **배포된 서버가 로컬 소스보다 구버전입니다**(인코딩 문구·대기열 라우트). 파서는 양쪽을 견디지만, 배포가 올라가면 캡처를 다시 떠야 합니다.

일반 AI 요청은 Vercel AI SDK `ToolLoopAgent`가 단계 수, 재시도, timeout, abort와 tool loop를 담당합니다. 브라우저의 메시지와 스트림 상태는 `useChat` / `DefaultChatTransport`, 서버 응답은 `createUIMessageStream`을 사용합니다. 자체 SSE 파서, 재시도 루프나 tool 반복 루프는 없습니다. mock 분기는 fixture 요청을 분류하는 결정적 시뮬레이터입니다.

live 모드에서는 SDK structured output으로 장면 ID 선택과 편집 제안을 받습니다. 원본 대사·시간·인물·권리·스포일러는 조회한 서버 데이터에서만 카드에 채웁니다. 조회하지 않은 장면 ID와 범위 밖의 장면을 거부하며, 기획안 source ranges도 서버에서 원본 안으로 구성합니다. 모델의 원본 추천 주장은 저장된 clip 순위와 일치할 때만 인정합니다. 원본 추천 순위는 저장된 사실이므로 기획안 요청마다 서버가 `list_clips`를 직접 읽습니다. 모델의 도구 호출에 의존하면 순위 근거가 비어 모든 후보가 재정렬로 표시됩니다.

Gemini는 JSON response schema와 강제 함수 호출(ANY 모드)을 동시에 허용하지 않습니다(`Forced function calling (ANY mode) with a response mime type: 'application/json' is unsupported`). 근거 보장의 핵심은 structured output 계약이므로 첫 단계는 `toolChoice` 강제 대신 `activeTools`를 해당 의도의 조회 도구 하나로 좁힙니다. provider별 지원 여부는 `getModelProvider()`의 `forcedToolChoiceWithStructuredOutput`에 선언합니다.

후보 선택은 LangGraph `interrupt` + `Command({ resume })` + checkpointer를 사용합니다. 데모 checkpointer는 `MemorySaver`이므로 프로세스 재시작 후 후보 선택 세션은 만료됩니다. 저장된 draft는 `.local-data/drafts`에 남습니다. 장기 작업·운영 환경에서는 DB checkpointer와 사용자별 인증 저장소로 교체해야 합니다.

## 서버 설정과 후속 연결

| 설정                                 | 기본값 / 용도                                     |
| ------------------------------------ | ------------------------------------------------- |
| `AGENT_MODE`                         | `mock`; `live`에서 서버 AI provider 사용          |
| `STEPD_GATEWAY`                      | `mock`; `mcp`에서 STEP D MCP adapter 사용         |
| `AI_PROVIDER`                        | `google`; `openai` adapter도 유지                 |
| `AI_MODEL`                           | `gemini-3.1-flash-lite`; 별칭 대신 지정 모델 사용 |
| `AI_REASONING_LEVEL`                 | `low`; 서버 provider에서 검증                     |
| `GOOGLE_GENERATIVE_AI_API_KEY`       | 서버 전용 Gemini 인증                             |
| `OPENAI_API_KEY`                     | OpenAI provider 선택 시 서버 전용 인증            |
| `STEPD_MCP_URL` / `STEPD_AUTH_TOKEN` | 서버 전용 STEP D 인증                             |
| `AGENT_DEPLOYMENT`                   | `development`; 운영 배포는 `production`으로 설정  |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | 운영 배포에서 필수인 관측 collector               |

Gemini provider와 서버 호출 경로를 구현하고 실제 생성까지 확인했습니다. STEP D MCP는 아직 연결하지 않았습니다. `@vercel/otel` instrumentation과 AI SDK telemetry를 유지하며, 운영 배포는 collector 설정 없이 모델을 호출할 수 없습니다. 개발 환경은 `.local-data/agent-traces.jsonl`에 도구 상태, 실패 HTTP 상태, 지연, 토큰 사용량과 최종 카드 종류·장면 ID를 기록합니다. 키·요청 헤더·원문 대사는 기록하지 않습니다. 가격 정책 미연결 시 비용은 `null`입니다.

성과 연결은 `배포 영상 ID → clip ID → source ranges → 인물/훅/길이 → 채널 metrics` 계약을 갖습니다. 댓글 분류 및 운영 상태·캘린더 초안은 같은 브리핑 패턴으로 확장할 수 있습니다.

공개 배포, 삭제, 외부 채널 변경, 렌더링, 결제 도구와 버튼은 없습니다. production 인증과 배포 권한/approval token은 별도 STEP D 서버에서 강제해야 합니다.

## 검증

```powershell
npm run typecheck
npm test
npm run build
npx playwright install chromium
# 고정 문구를 검증하므로 mock 모드 서버에서 실행합니다
npx playwright test tests/e2e/workspace.spec.ts
```

`workspace.spec.ts`는 mock 분기의 고정 문구를 확인하므로 `AGENT_MODE=mock` 서버가 필요합니다. live provider 검증은 실제 API를 호출하므로 명시적으로만 실행합니다.

```powershell
# live 모드 서버에서 실제 Gemini 호출로 검증
$env:RUN_LIVE_PROVIDER_CHECK = "1"
npx playwright test tests/e2e/provider.spec.ts
```

다른 포트에서 검증할 때는 `PLAYWRIGHT_BASE_URL`을 지정합니다. `next build`는 실행 중인 `next dev`의 `.next` 자산을 덮어쓰므로, 검증용 서버는 `next start`로 별도 포트에 띄우는 편이 안전합니다.

서버 검증은 필터, 의도 캐시, 편집 구간 길이/경계, 잘못된 구간 거부, checkpoint 재개, draft 재열기, 경로 검증, 의도-action 계약, 데모 표기, 원본 순위 근거와 STEP D MCP 응답 파싱 계약을 다룹니다. 브라우저 검증은 데스크톱 전체 제작 흐름, 작품 이해 시나리오, 성과 미연결 상태, 모바일 드로어/작업 보드, API 입력 오류를 다룹니다.

참고: [Gemini 3.1 Flash-Lite 모델](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), [AI SDK Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google), [AI SDK agents](https://ai-sdk.dev/docs/agents/building-agents), [MCP adapter](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools), [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts).
