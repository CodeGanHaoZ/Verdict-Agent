import { primary, request } from "./api";
import { badge, empty, escape as e, label, short, time } from "./view";

type GuardTask = {
  agentId: string;
  runId: string | null;
  status: string;
  modelStatus: string;
  modelId: string;
  modelSource: string;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  usage: { requests: number };
  guard: {
    status: string;
    boundarySource: string | null;
    activities: number;
    decisions: number;
    blocked: number;
    lastReasonCode: string | null;
    reviewWaitMs: number | null;
    reviewerUsage: { requests: number };
  } | null;
};
type GuardStateDetail = {
  status: string;
  boundary: { conditions: unknown; source: string } | null;
  activities: {
    sequence: number;
    action: string;
    source: string;
    status: string;
  }[];
  decisions: {
    sequence: number;
    action: string;
    verdict: string;
    reasonCode: string;
    consumed: boolean;
    latencyMs: number;
  }[];
  usage: { requests: number };
};
type Attempt = {
  serviceId: string;
  status?: string;
  verification?: { verdict?: string } | null;
  evidenceId?: string | null;
};

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

// 硬规则与模型拦截分开标注：确定性原因码 vs 外审模型给出的原因码。
const HARD_REASON = /^(SCOPE_|ENABLED_RULE_|INVALID_SCOPE|TASK_|EVIDENCE_|TARGET_|STALE_)/;
function decisionClass(d: {
  verdict: string;
  reasonCode: string;
}): { text: string; cls: string } {
  if (d.verdict === "BLOCK")
    return HARD_REASON.test(d.reasonCode)
      ? { text: "硬规则拦截", cls: "hard" }
      : { text: "外审模型拦截", cls: "model" };
  if (d.verdict === "UNCERTAIN") return { text: "审查不可用", cls: "warn" };
  return { text: "放行", cls: "ok" };
}

// FR-G07 ①②：外审监控台 + 审计时间线。数据全部来自 /api/guard/tasks、
// /api/guard/tasks/:id 与 /api/runs/:id 的真实内核输出；策略当前固定 fail-closed。
export function mountMonitorUI() {
  const list = $<HTMLElement>("#monitor-list");
  const detail = $<HTMLElement>("#monitor-detail");

  async function load() {
    list.innerHTML =
      '<div class="working"><span class="spinner"></span> 正在读取受监任务…</div>';
    try {
      const data = await request(primary, "/api/guard/tasks") as {
        tasks: GuardTask[];
      };
      if (!data.tasks.length) {
        list.innerHTML = empty(
          "暂无受监任务",
          "提交一个 PI 任务后，这里会显示外审状态与审查耗时。",
        );
        return;
      }
      list.innerHTML = data.tasks
        .map(
          (t) => `<div class="threat-row">
        <div class="threat-id"><b class="mono">${e(short(t.agentId))}</b>${badge(t.status)}${
          t.guard ? badge(t.guard.status) : '<span class="tag">未受审</span>'
        }</div>
        <div class="threat-meta">${e(time(t.createdAt))} · 决定 ${t.guard?.decisions ?? 0} 次 · 拦截 ${t.guard?.blocked ?? 0}${
          t.guard?.reviewWaitMs != null ? ` · 平均审查等待 ${t.guard.reviewWaitMs}ms` : ""
        } · ${e(t.modelSource)}</div>
        <div class="threat-status">${t.error ? `<small>${e(t.error)}</small>` : `<small>${e(t.modelId)}</small>`}</div>
        <div><button class="text-button" data-monitor-detail="${e(t.agentId)}">时间线</button></div>
      </div>`,
        )
        .join("");
      for (const button of list.querySelectorAll<HTMLButtonElement>(
        "[data-monitor-detail]",
      ))
        button.onclick = () => void detailOf(button.dataset.monitorDetail!);
    } catch (err) {
      list.innerHTML = `<p class="hint">无法读取监控台：${e(
        err instanceof Error ? err.message : "未知错误",
      )}</p>`;
    }
  }

  async function detailOf(agentId: string) {
    detail.innerHTML =
      '<div class="working"><span class="spinner"></span> 正在读取外审记录…</div>';
    try {
      const state = await request(
        primary,
        `/api/guard/tasks/${agentId}`,
      ) as GuardStateDetail;
      const rows = state.activities.map((activity) => {
        const decision = state.decisions.find(
          (d) => d.sequence === activity.sequence,
        );
        const mark = decision
          ? decisionClass(decision)
          : { text: "外部活动", cls: "warn" };
        return `<div class="tl-row ${mark.cls}">
          <span class="tl-seq">${activity.sequence}</span>
          <span class="tl-main"><b>${e(activity.action)}</b>
            <small>${e(activity.source)} · ${e(activity.status)}${
              decision ? ` · ${decision.latencyMs}ms` : ""
            }</small></span>
          <span class="tl-mark">${e(mark.text)}${
            decision ? `<small>${e(decision.reasonCode)}</small>` : ""
          }</span>
        </div>`;
      });
      detail.innerHTML = `<h3>审计时间线 ${e(short(agentId))}</h3>
        <p class="hint">边界来源：${e(
          state.boundary?.source ?? "未知",
        )} · 审查不可用即停止（fail-closed）；fail-open 开关待评审 · 外审模型请求 ${state.usage.requests} 次</p>
        <div class="tl">${rows.length ? rows.join("") : "<p class='hint'>无活动记录</p>"}</div>
        <p class="hint">一次性许可在业务执行前原子消费；执行后不可重复使用或换参重放。</p>`;
      // 交付尝试与 A 验收（真实 RunSnapshot）+ 完整事件流折叠展示。
      const tasks = await request(primary, "/api/guard/tasks") as {
        tasks: GuardTask[];
      };
      const task = tasks.tasks.find((t) => t.agentId === agentId);
      if (task?.runId) {
        const run = await request(primary, `/api/runs/${task.runId}`) as {
          attempts: Attempt[];
        };
        detail.insertAdjacentHTML(
          "beforeend",
          `<h3>交付尝试与 A 验收</h3>${
            run.attempts.length
              ? `<div class="tl">${run.attempts
                  .map(
                    (t) =>
                      `<div class="tl-row"><span class="tl-seq">·</span><span class="tl-main"><b>${e(
                        t.serviceId,
                      )}</b><small>${e(
                        t.evidenceId ? short(t.evidenceId) : "无证据",
                      )}</small></span><span class="tl-mark">${
                        t.verification?.verdict
                          ? badge(t.verification.verdict)
                          : ""
                      }</span></div>`,
                  )
                  .join("")}</div>`
              : '<p class="hint">本任务未产生服务调用。</p>'
          }`,
        );
        try {
          const events = await request(
            primary,
            `/api/agent/runs/${agentId}/events?after=0`,
          ) as { events: unknown[] };
          detail.insertAdjacentHTML(
            "beforeend",
            `<details><summary>完整事件流（events API，${events.events.length} 条）</summary><pre>${e(
              JSON.stringify(events.events, null, 2).slice(0, 8000),
            )}</pre></details>`,
          );
        } catch {
          /* 事件流读取失败不影响时间线展示 */
        }
      }
    } catch (err) {
      detail.innerHTML = `<p class="hint">无法读取外审记录：${e(
        err instanceof Error ? err.message : "未知错误",
      )}</p>`;
    }
  }

  $("#refresh-monitor").onclick = () => void load();
  window.addEventListener("hashchange", () => {
    if (location.hash === "#monitor") void load();
  });
  void load();
}
