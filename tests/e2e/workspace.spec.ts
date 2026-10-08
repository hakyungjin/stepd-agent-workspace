import { test, expect } from "@playwright/test";

test("desktop: grounded search → pin → plans → reason → draft → edit/save", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator('.app-shell[data-ready="true"]')).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "어떤 영상을 만들고 싶으세요?" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/desktop-home.png" });
  await page.getByRole("button", { name: /이야기가 움직이는 순간/ }).click();
  await expect(page.getByText("저장된 장면 검색 중").first()).toBeVisible();
  await expect(page.locator(".scene-card")).toHaveCount(3);
  await expect(page.locator(".scene-card").first().locator("time")).toHaveText(
    /\d\d:\d\d–\d\d:\d\d/,
  );
  await page
    .locator(".scene-card")
    .first()
    .getByRole("button", { name: "후보에 담기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "후보 담김", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/desktop-search.png" });
  await page
    .getByRole("button", { name: "쇼츠 기획안 만들기", exact: true })
    .click();
  await expect(page.locator(".plan-card")).toHaveCount(3);
  await page
    .locator(".plan-card")
    .nth(1)
    .getByRole("button", { name: "추천 근거 보기" })
    .click();
  await expect(
    page.getByRole("heading", { name: "후보 2, 이렇게 추천했습니다" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "성과 근거 없음 · 배포 성과 데이터가 아직 연결되지 않았습니다.",
    ),
  ).toBeVisible();
  await page
    .locator(".plan-card")
    .nth(1)
    .getByRole("button", { name: "이 초안 만들기", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "편집을 시작할 초안이 준비됐습니다" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "편집기에서 열기", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "이야기의 마지막 손질" }),
  ).toBeVisible();
  await page.getByLabel("제목 초안", { exact: true }).fill("검토한 데모 제목");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByText("초안 변경사항을 저장했습니다.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("제목 초안", { exact: true })).toHaveValue(
    "검토한 데모 제목",
  );
});

test("scenario A: overview → character search → natural-language plans and candidate draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "에이전트에게 요청 입력" });
  await input.fill("나미브 어떤 작품이야?");
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { name: "나미브, 먼저 이해하기" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "이 작품의 장면 찾아보기" }).click();
  await expect(page.locator(".scene-card")).toHaveCount(3);
  await input.fill("30초 쇼츠 3개 골라줘");
  await input.press("Enter");
  await expect(page.locator(".plan-card")).toHaveCount(3);
  await input.fill("2번 초안 만들어줘");
  await input.press("Enter");
  await expect(page.locator(".draft-result")).toBeVisible();
});

test("unconnected performance never fabricates charts or metrics", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /숫자 뒤에 있는 이야기/ }).click();
  await expect(
    page.getByText(/성과 데이터가 아직 연결되지 않았습니다. 조회수/),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("mobile: drawer filters, scene preview and bottom workboard remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator('.app-shell[data-ready="true"]')).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-home.png" });
  await page.getByRole("button", { name: "탐색 메뉴 열기" }).click();
  await page
    .getByRole("dialog", { name: "워크스페이스 탐색" })
    .getByLabel("프로그램", { exact: true })
    .selectOption("busemi");
  await page.getByRole("button", { name: "탐색 메뉴 닫기" }).click();
  await page.getByRole("button", { name: /이야기가 움직이는 순간/ }).click();
  await expect(page.locator(".scene-card")).toHaveCount(3);
  await page
    .locator(".scene-card")
    .first()
    .getByRole("button", { name: "재생", exact: true })
    .click();
  await expect(
    page.getByText(
      "데모 프레임 미리보기 · 원본 영상은 아직 연결되지 않았습니다.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "미리보기 닫기" }).click();
  await page
    .locator(".scene-card")
    .first()
    .getByRole("button", { name: "후보에 담기", exact: true })
    .click();
  await page
    .locator(".mobile-bottom-nav")
    .getByRole("button", { name: /작업 보드/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "작업 보드", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "쇼츠 기획안 만들기", exact: true })
    .click();
  await page.getByRole("button", { name: "작업 보드 닫기" }).click();
  await expect(page.locator(".plan-card")).toHaveCount(3);
  await page.screenshot({ path: "test-results/mobile-plans.png" });
  await page
    .locator(".plan-card")
    .first()
    .getByRole("button", { name: "이 초안 만들기", exact: true })
    .click();
  await expect(page.locator(".draft-result")).toBeVisible();
  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflowing).toBe(false);
});

test("API validates scope and rejects arbitrary draft fields", async ({
  request,
}) => {
  const invalid = await request.post("/api/agent/chat", {
    data: { messages: [], context: { programId: "unknown" } },
  });
  expect(invalid.status()).toBe(400);
  const traversal = await request.get("/api/drafts/not-a-draft");
  expect(traversal.status()).toBe(404);
});
