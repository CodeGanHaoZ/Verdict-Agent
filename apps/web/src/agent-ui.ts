import { z } from "zod";
import {
  AgentSnapshotSchema,
  AgentEventSchema,
  RunSnapshotSchema,
  type AgentSnapshot,
  type AgentEvent,
  type RunSnapshot,
} from "@verdict/protocol";
import { primary, request } from "./api";
import { escape as e, time } from "./view";
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const key = "verdict-pi-direct:" + primary;
export function mountAgentUI(
  onRun: (run: RunSnapshot) => void,
  onStart: (message?: string) => void,
  onDone: () => Promise<void>,
  canSwitch: () => boolean,
) {
  let agent: AgentSnapshot | null = null,
    events: AgentEvent[] = [],
    working = false,
    configured = false;
  let pending: { clientRequestId: string; prompt: string } | null = null;
  let saved: {
    agentId?: string;
    pending?: typeof pending;
    interruptedId?: string | null;
  } = {};
  let interruptedId: string | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(key) ?? "{}");
    pending = saved.pending ?? null;
    interruptedId = saved.interruptedId ?? null;
  } catch {}
  const save = () => {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          agentId: agent?.agentId ?? saved.agentId,
          pending,
          interruptedId,
        }),
      );
    } catch {}
  };
  const panel = document.createElement("section");
  panel.className = "panel pi-panel";
  panel.hidden = true;
  panel.id = "pi-panel";
  panel.innerHTML = `<div class="panel-heading"><h2>PI Agent</h2><span class="step">任务 → 工具 → 验收</span></div><div class="pi-body"><div id="pi-configuration" class="subtle">正在连接模型…</div><form id="pi-prompt-form"><label>交给 Agent 的任务<textarea id="pi-prompt" rows="4" maxlength="6000" placeholder="核验某个账户在指定区块的状态；服务交付不合格就换一个，全部失败则停止。" required></textarea></label><button id="pi-generate" class="primary-button" disabled>运行 Agent →</button></form><div id="pi-error" role="alert" hidden></div><p id="pi-bound" class="hint"></p><div id="pi-progress" aria-live="polite"></div></div>`;
  const layout = $("#view-task .task-layout"),
    formPanel = $(".task-panel");
  formPanel.before(panel);
  const mode = document.createElement("div");
  mode.className = "execution-modes";
  mode.innerHTML =
    '<button id="mode-fixed" class="active" type="button">固定流程</button><button id="mode-pi" type="button">PI Agent · 自然语言</button>';
  layout.before(mode);
  const error = (message = "") => {
    $("#pi-error").hidden = !message;
    $("#pi-error").textContent = message;
  };
  const message = (err: unknown) =>
    err instanceof Error ? err.message : "请求失败";
  const setWorking = (value: boolean) => {
    working = value;
    $<HTMLButtonElement>("#pi-generate").disabled = value || !configured;
    $<HTMLButtonElement>("#mode-fixed").disabled = value;
    $<HTMLButtonElement>("#mode-pi").disabled = value;
  };
  const setMode = (pi: boolean) => {
    onStart(
      pi
        ? "输入任务后，PI 将直接调用工具执行。"
        : "请选择固定流程条件并提交新任务。",
    );
    try {
      sessionStorage.setItem(
        "verdict-execution-mode:" + primary,
        pi ? "pi" : "fixed",
      );
    } catch {}
    panel.hidden = !pi;
    formPanel.hidden = pi;
    $("#mode-pi").classList.toggle("active", pi);
    $("#mode-fixed").classList.toggle("active", !pi);
  };
  $("#mode-fixed").addEventListener("click", () => {
    if (canSwitch()) setMode(false);
  });
  $("#mode-pi").addEventListener("click", () => {
    if (canSwitch()) {
      setMode(true);
      void restore();
    }
  });
  function renderAgent() {
    if (!agent) return;
    const a = agent;
    $("#pi-progress").innerHTML =
      `<div class="pi-draft-heading"><h3>PI 执行过程</h3><span class="badge neutral">${e(a.status)}</span></div><p class="subtle">模型 ${e(a.modelId)} · ${e(a.modelSource)} · 模型状态 ${e(a.modelStatus)}</p><p class="subtle">模型请求 ${a.usage.requests} 次 · 工具 ${a.toolCalls} 次 · 输入 ${a.usage.inputTokens} / 输出 ${a.usage.outputTokens} tokens · 模型费用 ${a.usage.costUsd === null ? "未知" : a.usage.costUsd.toFixed(6) + " USD"}</p>${a.error ? `<p class="reason">Agent：${e(a.error)}。验收结果保持独立，请查看右侧任务状态。</p>` : ""}${a.explanation ? `<div class="pi-explanation"><span class="tiny-label">模型辅助说明 · 不作为验收结论</span><p>${e(a.explanation)}</p></div>` : ""}<div class="button-row">${["QUEUED", "RUNNING"].includes(a.status) ? '<button class="secondary-button" id="pi-stop">停止 Agent</button>' : ""}<button class="text-button" id="pi-refresh">重新查询此 Agent</button></div><ol class="pi-events">${events
        .slice(-100)
        .map(
          (ev) =>
            `<li><span>${e(time(ev.at))} · ${e(ev.type)} ${e(ev.toolName ?? "")}</span>${ev.type === "TOOL_END" ? `<details><summary>查看工具结果</summary><pre>${e(JSON.stringify(ev.data, null, 2))}</pre></details>` : ev.type === "ERROR" ? `<code>${e(JSON.stringify(ev.data))}</code>` : ""}</li>`,
        )
        .join("")}</ol>`;
    $("#pi-stop")?.addEventListener("click", async () => {
      try {
        await request(primary, `/api/agent/runs/${a.agentId}/stop`, {});
      } catch (err) {
        error(message(err));
      }
    });
    $("#pi-refresh")?.addEventListener("click", () => {
      if (!working)
        void pollAgent(a.agentId).catch((err) => error(message(err)));
    });
  }
  async function pollAgent(id: string) {
    setWorking(true);
    interruptedId = id;
    save();
    try {
      for (;;) {
        agent = AgentSnapshotSchema.parse(
          await request(primary, `/api/agent/runs/${id}`),
        );
        save();
        const batch = z
          .object({ events: z.array(AgentEventSchema) })
          .parse(
            await request(
              primary,
              `/api/agent/runs/${id}/events?after=${events.at(-1)?.sequence ?? 0}`,
            ),
          );
        events.push(...batch.events);
        if (agent.runId) {
          const run = RunSnapshotSchema.parse(
            await request(primary, `/api/runs/${agent.runId}`),
          );
          onRun(run);
          $("#pi-bound").textContent =
            `执行条件：${run.task.account} · 区块 ${run.task.blockHash} · ${run.task.fields.join(" / ")} · 最多 ${run.task.budget.maxAttempts} 次 · ${run.task.budget.maxCostWei} wei`;
        }
        renderAgent();
        if (!["QUEUED", "RUNNING"].includes(agent.status) && agent.finishedAt)
          break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!agent?.runId) onStart("PI 已结束；没有调用数据服务，请查看说明。");
      interruptedId = null;
      save();
      await onDone();
    } finally {
      setWorking(false);
    }
  }
  $("#pi-prompt-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (working) return;
    error();
    setWorking(true);
    try {
      if (interruptedId) {
        await pollAgent(interruptedId);
        return;
      }
      pending ??= {
        clientRequestId: crypto.randomUUID(),
        prompt: $<HTMLTextAreaElement>("#pi-prompt").value,
      };
      save();
      onStart("PI 正在处理任务…");
      $("#pi-bound").textContent = "";
      const response = z
        .object({ agentId: z.string() })
        .parse(await request(primary, "/api/agent/runs", pending));
      saved.agentId = response.agentId;
      pending = null;
      agent = null;
      events = [];
      $("#pi-progress").innerHTML = "";
      save();
      await pollAgent(response.agentId);
    } catch (err) {
      error("请求或查询中断；重试会继续同一个 Agent。" + message(err));
    } finally {
      setWorking(false);
    }
  });
  let restored = false;
  async function restore() {
    if (restored || working || !configured) return;
    restored = true;
    try {
      if (saved.agentId) {
        setMode(true);
        await pollAgent(saved.agentId);
      }
      if (pending) {
        setMode(true);
        $<HTMLTextAreaElement>("#pi-prompt").value = pending.prompt;
        error("上次提交响应未收到，再次运行会使用相同请求 ID。");
      }
    } catch (err) {
      error(message(err));
    }
  }
  void (async () => {
    try {
      const info = z
        .object({
          configured: z.boolean(),
          modelId: z.string().nullable(),
          modelSource: z.string().nullable(),
        })
        .parse(await request(primary, "/api/agent/meta"));
      configured = info.configured;
      $("#pi-configuration").textContent = configured
        ? `PI 1.0.4 · ${info.modelId} · ${info.modelSource}。直接接收任务并执行，缺少必要条件时会说明。`
        : "模型未配置。请配置兼容接口与密钥环境变量；固定流程仍可使用。";
      setWorking(false);
      let pi = false;
      try {
        pi =
          sessionStorage.getItem("verdict-execution-mode:" + primary) === "pi";
      } catch {}
      if (pi) {
        setMode(true);
        await restore();
      }
    } catch (err) {
      error(message(err));
      $("#pi-configuration").textContent =
        "PI 接口不可用；请启动更新后的后端。";
    }
  })();
}
