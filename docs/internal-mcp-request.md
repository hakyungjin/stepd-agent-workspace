# STEP D 내부용 MCP 요청서

STEP D 웹 챗봇 전용 **내부용 MCP**를 만들어 주세요. 지금 MCP는 **외부용**으로 그대로 둡니다(Claude 등 외부 클라이언트용, 동작 변경 없음).

## 배경

- STEP D 웹에 우리 챗봇을 붙입니다. 대화로 회차를 탐색하고, 스킬 4개(AI 생성물 만들기 · 배포 관리 · 프로그램 설명 · 성과 조회+리포트)를 실행합니다.
- 챗봇 화면은 채팅 + 작업창(회차 뷰어 · 시퀀스 보드 · 영상물 목록 · 성과)입니다. 툴 결과를 **카드·표·타임라인으로 직접 그려야** 해서, 서술형 텍스트만으로는 부족합니다.
- 챗봇은 **사용자가 STEP D 웹에서 지금 들어와 있는 워크스페이스 하나에만** 접근해야 합니다. STEPAI 운영자도 마찬가지입니다.
- 외부용 MCP의 승인 카드(`approval`)는 모델이 인자로 직접 넣을 수 있는 구조입니다. 챗봇에서는 **사람이 버튼을 눌렀을 때만** 실행되게 해야 합니다.

## 원칙

1. **외부용과 로직을 공유한다.** 내부용은 같은 코어 위의 다른 툴 묶음(프로필)입니다. 같은 기능이 두 벌로 갈라지지 않게 해 주세요. 두 프로필이 같은 결과를 내는지 확인하는 테스트(parity test)를 둡니다.
2. **공개하지 않는다.** 챗봇 백엔드에서만 부를 수 있게 합니다(내부망 또는 Cloud Run IAM + 서비스 자격증명). 공개 OAuth 클라이언트로는 붙을 수 없어야 합니다.
3. **용어를 통일한다.** 회차(episode) / 영상물(원본 media) / AI 생성물(AI가 만든 편집본) / 편집본(사람이 만들거나 올린 것). `clip`은 `kind` 값으로만 씁니다. 모든 편집본 응답에 `creationOrigin`(`ai_generated` | `human_uploaded` | `unknown`)을 넣어 주세요.

---

## P0 — 이게 없으면 챗봇을 붙일 수 없음

### 1. 워크스페이스 고정

- 모든 툴에서 **`workspace` 인자를 없앱니다.** 워크스페이스는 요청 컨텍스트에서만 정합니다.
  - 챗봇 백엔드가 보내는 것: 서비스 자격증명 + 사용자 위임 토큰(또는 STEP D 세션) + 현재 워크스페이스 id(헤더, 예: `x-stepd-workspace`)
  - 서버가 하는 것: 그 사용자가 그 워크스페이스 멤버인지 검증합니다. 아니면 403. 운영자도 **요청당 워크스페이스 하나**만 허용합니다.
- `list_workspaces`는 내부용에서 뺍니다.
- 모든 응답과 에러에 실제로 적용된 `workspaceId`를 돌려줍니다(로그·검증용).
- 응답에 들어가는 영상·프레임 주소는 **짧게 만료되는 서명 주소**로 줍니다. 다른 워크스페이스 사용자가 열면 막혀야 합니다.

**확인 기준:** 운영자 토큰 + 워크스페이스 A 헤더로 B의 회차·편집본 id를 넣으면 404/403이 납니다. 인자로 `workspace`를 넣어도 스키마 검증에서 거절됩니다.

### 2. 쓰기는 전부 두 단계(prepare → commit), 승인 id만으로 실행

지금 승인 카드가 있는 툴(`apply_video_plan`, `move_scheduled_deploy`, `cancel_scheduled_deploy`)뿐 아니라, **승인 없이 바로 쓰는 툴도 전부** 같은 방식으로 바꿔 주세요:
`set_program_info`, `set_cast_member`, `propose_program_fact`, `edit_captions`, `set_shorts_title`, `set_channel_metadata`, `rerender_clip`. (`translate_clip_captions`는 저장하지 않으니 제외해도 됩니다.)

- `prepare_<action>(args)` → 실행하지 않고 다음을 돌려줍니다.
  - `approvalId`
  - `expiresAt`
  - 사람이 읽을 요약(제목 · 항목들)
  - **바뀌기 전 값과 바뀔 값(diff)** — 특히 `set_cast_member`, `set_program_info`
  - 예상 비용(크레딧 범위, 아래 4번)
  - 경고(규칙 위반, 재인코딩 필요 등)
- `commit(approvalId, idempotencyKey)` → **서버가 저장해 둔 원래 인자로만** 실행합니다. commit은 인자를 따로 받지 않습니다.
- 승인 id는 **사용자 · 워크스페이스 · 대화 id에 묶이고, 한 번만 쓸 수 있습니다.**
- `revoke(approvalId)` → 사용자가 대화 중간에 끼어들거나 취소하면 챗봇이 부릅니다. 이후 commit은 거절됩니다.
- 같은 `idempotencyKey`로 commit을 다시 부르면 두 번 실행하지 않고 첫 결과를 돌려줍니다.
- 쓰기 기록(감사 로그)에 `source=chatbot`, 대화 id, 승인 id, 사용자를 남깁니다.

**확인 기준:** prepare 없이 commit이 안 됩니다. 만료·revoke·다른 사용자·다른 워크스페이스의 승인 id는 거절됩니다. 같은 키로 두 번 commit해도 한 번만 실행됩니다.

### 3. 구조화된 응답

- 모든 툴에 `outputSchema`를 선언하고 `structuredContent`(JSON)를 돌려 주세요. `content` 텍스트도 모델용으로 지금처럼 함께 줍니다.
- 장면·편집본·예약 같은 항목마다 **안정적인 id**를 줍니다. 장면은 세그먼트 id(`#s3` 형식). 지금처럼 시각을 합쳐 만든 id를 쓰지 않게 해 주세요.
- 장면에서 사실(시각 · 화자 · 대사 원문)과 해석(요약 · 장면유형)을 **필드로 갈라서** 줍니다.
- 툴마다 MCP annotations를 달아 주세요: `readOnlyHint`, `destructiveHint`, `idempotentHint`. 비용이 드는 툴은 그렇다는 표시도 함께.

### 4. 비용 · 크레딧

- 비용이 드는 툴(인코딩 · 분석 · 이미지 조회 등)은 결과에 `cost: { credits, breakdown }`을 줍니다. prepare는 `estimate: { min, max }`를 줍니다.
- 챗봇의 **모델 토큰 비용**도 같은 크레딧 원장에서 차감하려 합니다. 내부용 전용으로 아래 셋을 주세요.
  - `credit_reserve(maxCredits, reason, idempotencyKey)` → `reservationId` (잔액이 모자라면 거절)
  - `credit_settle(reservationId, actualCredits, usage)` → 실제 사용량만큼 차감하되 상한(`maxCredits`)을 넘지 않음
  - `credit_release(reservationId, reasonCode)` → 차감 취소(우리 쪽 오류 · 툴 실패)
- MCP 실행 비용과 모델 토큰 비용을 원장에서 **따로 볼 수 있게** 항목을 나눠 주세요.
- 워크스페이스 단위 사용 상한(일일 메시지 · 토큰 · 이미지 장수)을 조회하는 `get_usage_limits()`. 넘으면 `rate_limited` 에러를 줍니다.

### 5. 에러 형식

- `{ code, message, retryable, fault }`
  - `code`: `not_found` · `forbidden` · `validation` · `conflict` · `expired` · `rate_limited` · `insufficient_credits` · `upstream_failure` · `internal`
  - `fault`: `user` · `system` — 차감 취소 여부를 이걸로 판단합니다.
- `message`는 지금처럼 사용자에게 그대로 보여 줄 수 있는 한국어로.

---

## P1 — 스킬별로 필요한 것

### 6. 오래 걸리는 작업은 job으로 (AI 생성물 · 재인코딩)

- `apply`·`rerender` 같은 commit은 바로 `jobId`를 돌려 줍니다.
- `get_job(jobId)` → 상태(`queued` · `running` · `succeeded` · `failed` · `canceled`), 진행률, 결과(편집본 id), 실패 사유
- `cancel_job(jobId)` → 취소할 수 있는 단계에서만. 취소가 되는지(`cancelable`)를 `get_job`에 표시합니다.
- 읽기 툴은 MCP `notifications/cancelled`를 받으면 멈추게 해 주세요. 쓰기 툴은 commit 이후 취소하지 않아도 됩니다(어디까지 실행됐는지만 명확하게).
- 가능하면 progress notification을 보내 주세요(챗봇의 "아직 작업 중" 표시에 씁니다).

### 7. 회차 · 프레임

- `get_episode_outline`의 `structuredContent`: 사건 흐름 + 세그먼트 목록(id · start · end · 화자 · 대사 원문 · 요약 · 장면유형 · 대표 프레임 주소 · 겹치는 편집본 id)
- `get_frames(media, times[])` → **원본 기준** 임의 시각의 프레임(최대 장수 제한 포함). 지금 `get_clip_frames`는 편집본 단위라서, 회차 뷰어와 컷 비교(CutCompare)에는 이게 필요합니다.

### 8. 시퀀스 · beat (AI 생성물 만들기 · 검수)

- `get_clip_sequence(clip)` → kind, 조각 목록(원본 start · end · 세그먼트 id · 순서), 조각마다 beat 라벨, 컷 경계마다 앞 조각 끝 대사 · 뒤 조각 첫 대사
- beat 저장:
  - `draft_video_plan` · `prepare_apply_video_plan`의 `parts`에 `beat` 필드를 받아 편집본에 저장
  - `prepare_set_clip_beats(clip, beats[])` (글자 메타라서 재인코딩 불필요)
- `get_beat_taxonomy(genre)` → 장르별 beat 목록(드라마: 서사 · 반전 … / 예능: 리액션 · 웃음 포인트 …)
- 기존 AI 생성물 수정: 원본은 그대로 두고, `draft_video_plan(baseClip=…)` → **새 편집본(새 버전)으로** 만드는 방식을 제안합니다. 계보(`derivedFrom`)를 남겨 주세요. 가능 여부를 알려 주세요.

### 9. 영상물 목록

- `list_clips`에 필터 추가: `creationOrigin`, `kind`, `program`, `episode`
- 응답에 인코딩 상태 · 재인코딩 필요 여부 · 게시 제목 · 게시 주소(채널별)

### 10. 성과 지표 (신규, 이게 없으면 스킬 4를 못 함)

- `get_clip_metrics(filter, period, groupBy, metrics?)`
  - `filter`: clip ids | program | episode | kind | creationOrigin | channel
  - `period`: from · to (KST), granularity(일 · 주 · 월)
  - `groupBy`: `clip` · `program` · `period` · `channel`
  - 지표: 조회수, 평균 시청 시간 · 시청 지속률, 좋아요 · 댓글 · 공유, 구독 유입(채널이 주는 범위 안에서). 없는 지표는 0이 아니라 `null`
  - 행마다 **편집본 id ↔ 플랫폼 영상 id** 연결과 편집본 속성(kind · 길이 · 첫 3초 훅 · beat 구성)을 함께 → "잘 된 영상의 공통점" 분석에 씁니다
  - 데이터 기준 시각(`asOf`)과 채널별 수집 지연을 함께
- 리포트 문서 · 대시보드 생성은 챗봇 쪽에서 합니다. MCP는 지표만 주면 됩니다.

### 11. 프로그램 설명

- `set_cast_member`: 극중 이름을 통째로 바꾸는 대신 `addNames` · `removeNames`를 받게 해 주세요(prepare diff 포함).
- `get_program_overview`에 "빠진 설정" 목록(줄거리 없음 · 화자 매핑 안 됨 · 분석 미완료 회차 등)을 구조화해서 주면, 챗봇이 채우기 제안을 띄웁니다.

### 12. 배포 관리

- `list_scheduled_deploys` · `get_clip_detail`도 `structuredContent`로 주세요.
- 지금 배포된 서버에서 대기열이 `403 superadmin only`로 막혀 있습니다. 내부용에서는 워크스페이스 멤버가 자기 회사 예약을 볼 수 있어야 합니다.

---

## 답이 필요한 질문

1. 게시(publish)를 내부용에서도 계속 사람만 화면에서 하게 둘까요? (제안: 1차는 지금처럼 화면에서만)
2. 툴 실행 중 취소: 어떤 툴이 실제로 중단되는지 목록을 주세요.
3. 성과 지표: 채널별로 지금 수집하고 있는 지표와 주기가 어떻게 되나요? 일정은요?
4. 크레딧 단가: 모델 토큰 비용을 크레딧으로 환산할 단가표를 누가 관리하나요?
5. 내부용 배포 방식: 별도 서비스인지, 같은 서버의 다른 경로(`/mcp/internal`)인지.

## 우선순위 요약

| 순위 | 항목 | 막히는 챗봇 단계 |
|---|---|---|
| P0 | 1 워크스페이스 고정 · 2 prepare/commit · 3 구조화 응답 · 4 크레딧 · 5 에러 형식 | 전부 |
| P1 | 6 job · 7 회차/프레임 · 8 시퀀스/beat · 9 목록 필터 | AI 생성물 만들기 |
| P1 | 10 성과 지표 | 성과 조회 + 리포트 |
| P1 | 11 · 12 | 프로그램 설명 · 배포 관리(지금 툴로 임시 대응 가능) |
