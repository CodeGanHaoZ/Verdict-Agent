import { test, expect } from "@playwright/test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { digest } from "@verdict/core";

test("real signed faults → fallback PASS → original evidence download → independent replay and ranking", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("browser-one 已连接")).toBeVisible();
  await page.getByRole("button", { name: "开始验收" }).click();
  await expect(page.getByText("数据已通过本次验收")).toBeVisible();
  const attempts = page.locator(".attempt");
  await expect(attempts).toHaveCount(3);
  await expect(
    attempts.filter({
      has: page.getByRole("heading", { name: "demo-wrong-block", exact: true }),
    }),
  ).toContainText("FAIL");
  await expect(
    attempts.filter({
      has: page.getByRole("heading", { name: "demo-wrong-value", exact: true }),
    }),
  ).toContainText("FAIL");
  await expect(
    attempts.filter({
      has: page.getByRole("heading", { name: "demo-valid", exact: true }),
    }),
  ).toContainText("PASS");
  const wrong = attempts.filter({
    has: page.getByRole("heading", { name: "demo-wrong-block", exact: true }),
  });
  await wrong.locator("summary").first().click();
  await expect(wrong.getByText("交付区块", { exact: true })).toBeVisible();
  await wrong.getByRole("button", { name: "查看证据" }).click();
  await expect(
    page.getByRole("heading", { name: "让第二实例重新检查" }),
  ).toBeVisible();
  await expect(page.locator("#evidence-detail")).toContainText("未请求发布");
  const id = await page.locator(".hash").textContent();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载原始证据" }).click();
  const downloaded = await downloading;
  const bytes = readFileSync((await downloaded.path())!, "utf8");
  expect(digest(JSON.parse(bytes))).toBe(id);
  expect(bytes).toBe(
    await (
      await request.get(`http://127.0.0.1:3101/api/evidence/${id}/bundle`)
    ).text(),
  );
  await page.getByRole("button", { name: "第二实例独立复验" }).click();
  await expect(
    page.getByRole("heading", { name: "第二实例复验结果" }),
  ).toBeVisible();
  await expect(page.locator(".replay-result")).toContainText("FAIL");
  await expect(page.locator(".replay-result")).toContainText("VERIFIED");
  await expect(
    page.getByRole("heading", { name: "同一请求，开关历史证据" }),
  ).toBeVisible();
  const lists = page.locator(".comparison-grid ol");
  expect(await lists.nth(0).locator("li").allTextContents()).not.toEqual(
    await lists.nth(1).locator("li").allTextContents(),
  );
  expect(errors).toEqual([]);
});

test("all failures stop without a fact card, success can then run and survives page refresh", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("browser-one 已连接")).toBeVisible();
  await page.locator("#scenario").selectOption("all-fail");
  await page.getByRole("button", { name: "开始验收" }).click();
  await expect(page.getByText("已停止数据依赖")).toBeVisible();
  await expect(page.locator(".accepted")).toHaveCount(0);
  await expect(page.locator("#task-fields")).toBeEnabled();
  await page.locator("#scenario").selectOption("success");
  await page.getByRole("button", { name: "开始验收" }).click();
  await expect(page.getByText("数据已通过本次验收")).toBeVisible();
  const id = await page.locator(".run-heading code").getAttribute("title");
  await page.reload();
  await expect(page.getByText("数据已通过本次验收")).toBeVisible();
  expect(await page.locator(".run-heading code").getAttribute("title")).toBe(
    id,
  );
});

test("lost create response retries same request ID and does not duplicate a task", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("browser-one 已连接")).toBeVisible();
  await page.locator("#scenario").selectOption("success");
  let originalId: string | undefined;
  let runId: string | undefined;
  await page.route(
    "**/api/runs",
    async (route) => {
      originalId = route.request().postDataJSON().task.requestId;
      const response = await route.fetch();
      runId = (await response.json()).runId;
      await route.abort();
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "开始验收" }).click();
  await expect(
    page.getByRole("button", { name: "重试同一请求" }),
  ).toBeVisible();
  const repeated = page.waitForRequest(
    (req) => req.url().endsWith("/api/runs") && req.method() === "POST",
  );
  await page.getByRole("button", { name: "重试同一请求" }).click();
  expect((await repeated).postDataJSON().task.requestId).toBe(originalId);
  await expect(page.getByText("数据已通过本次验收")).toBeVisible();
  expect(await page.locator(".run-heading code").getAttribute("title")).toBe(
    runId,
  );
});

test("mobile layout, unavailable backend and dev-server private-file boundary", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("browser-one 已连接")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "服务目录" }).click();
  await expect(
    page.getByRole("heading", { name: "demo-valid", exact: true }),
  ).toBeVisible();
  await page.route("**/api/meta", (route) => route.abort());
  await page.getByRole("button", { name: "重新连接后端" }).click();
  await expect(page.getByRole("alert")).toContainText("无法连接");
  await page.getByRole("button", { name: "任务验收" }).click();
  await expect(page.getByRole("button", { name: "开始验收" })).toBeDisabled();
  // Use an existing, harmless private fixture; do not depend on a user's dev:init.
  const local = resolve(".local");
  mkdirSync(local, { recursive: true });
  const directory = mkdtempSync(join(local, "web-private-"));
  try {
    const path = join(directory, "sentinel.json");
    writeFileSync(path, JSON.stringify({ privateFixture: true }));
    const blocked = await request.get("/@fs/" + path.replaceAll("\\", "/"));
    expect(blocked.status()).toBe(403);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("new submission clears previous accepted values and interrupted polling resumes without a new run", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("browser-one 已连接")).toBeVisible();
  await page.locator("#scenario").selectOption("success");
  await page.getByRole("button", { name: "开始验收" }).click();
  await expect(page.getByText("数据已通过本次验收")).toBeVisible();
  await expect(page.locator("#task-fields")).toBeEnabled();
  await page.route("**/api/runs/*", (route) => route.abort(), { times: 1 });
  await page.locator("#scenario").selectOption("all-fail");
  await page.getByRole("button", { name: "开始验收" }).click();
  await expect(page.getByRole("alert")).toContainText("查询中断");
  await expect(page.locator(".accepted")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始验收" })).toBeDisabled();
  await page.getByRole("button", { name: "重新连接后端" }).click();
  await expect(page.getByText("已停止数据依赖")).toBeVisible();
  await expect(page.locator("#task-fields")).toBeEnabled();
});

test("PI direct submission runs real tools without a draft and restores on refresh", async ({
  page,
  request,
}) => {
  const meta = await (
    await request.get("http://127.0.0.1:3101/api/meta")
  ).json();
  await page.goto("/");
  await expect(page.getByText("browser-one 已连接")).toBeVisible();
  await page.getByRole("button", { name: "PI Agent · 自然语言" }).click();
  await page
    .locator("#pi-prompt")
    .fill(
      `核验 ${meta.capabilities[0].accounts[0]} 在固定检查点 ${meta.contexts[0].trustedBlock.blockHash} 的账户状态。`,
    );
  await page.getByRole("button", { name: "运行 Agent" }).click();
  await expect(page.getByText("数据已通过本次验收")).toBeVisible();
  await expect(page.locator("#pi-progress")).toContainText("COMPLETED");
  await expect(page.locator("#pi-progress")).toContainText("TEST_TRANSPORT");
  await expect(page.locator(".attempt")).toHaveCount(3);
  await expect(page.locator("#pi-progress")).toContainText("start_task");
  await expect(page.locator("#pi-progress")).toContainText(
    "request_verified_state",
  );
  await expect(page.locator("#pi-progress")).toContainText("模型费用 未知");
  await expect(page.locator("#pi-bound")).toContainText(
    meta.capabilities[0].accounts[0],
  );
  await expect(page.locator("#pi-draft")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("数据已通过本次验收")).toBeVisible();
});

test("PI incomplete task stops without data; a new complete task runs directly", async ({
  page,
  request,
}) => {
  const meta = await (
    await request.get("http://127.0.0.1:3101/api/meta")
  ).json();
  await page.goto("/");
  await page.getByRole("button", { name: "PI Agent · 自然语言" }).click();
  await page.locator("#pi-prompt").fill("帮我检查最新账户状态");
  await page.getByRole("button", { name: "运行 Agent" }).click();
  await expect(page.locator("#pi-progress")).toContainText("STOPPED");
  await expect(page.locator("#pi-progress")).toContainText(
    "请提供明确账户和固定区块",
  );
  await expect(page.locator(".accepted")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "运行 Agent" })).toBeEnabled();
  await page
    .locator("#pi-prompt")
    .fill(
      `核验 ${meta.capabilities[0].accounts[0]} 在固定检查点 ${meta.contexts[0].trustedBlock.blockHash}`,
    );
  await page.getByRole("button", { name: "运行 Agent" }).click();
  await expect(page.getByText("数据已通过本次验收")).toBeVisible();
});
