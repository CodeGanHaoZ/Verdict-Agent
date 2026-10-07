import { z } from "zod";
import {
  AgentDraftSchema,
  AgentSnapshotSchema,
  AgentEventSchema,
  AgentConditionsSchema,
  RunSnapshotSchema,
  type AgentDraft,
  type AgentSnapshot,
  type AgentEvent,
  type RunSnapshot,
} from "@verdict/protocol";
import { primary, request, MetaSchema, type Meta } from "./api";
import { escape as e, time, badge } from "./view";
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const key = "verdict-pi:" + primary;
export function mountAgentUI(
  onRun: (run: RunSnapshot) => void,
  onStart: (message?: string) => void,
  onDone: () => Promise<void>,
  canSwitch: () => boolean,
) {
  let draft: AgentDraft | null = null,
    agent: AgentSnapshot | null = null,
    meta: Meta | null = null,
    events: AgentEvent[] = [],
    working = false,
    configured = false;
  let pending: { clientRequestId: string; prompt: string } | null = null;
  let restoring: {
    draftId?: string;
    agentId?: string;
    pending?: { clientRequestId: string; prompt: string } | null;
  } = {};
  try {
    restoring = JSON.parse(sessionStorage.getItem(key) ?? "{}");
    pending = restoring.pending ?? null;
  } catch {}
  const save = () => {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          draftId: draft?.draftId,
          agentId: agent?.agentId,
          pending,
        }),
      );
    } catch {}
  };
  const panel = document.createElement("section");
  panel.className = "panel pi-panel";
  panel.hidden = true;
  panel.id = "pi-panel";
  panel.innerHTML = `<div class="panel-heading"><h2>PI Agent</h2><span class="step">DRAFT → CONFIRM → EXECUTE</span></div><div class="pi-body"><div id="pi-configuration" class="subtle">正在检查模型配置…</div><form id="pi-prompt-form"><label>你希望核验什么？<textarea id="pi-prompt" rows="3" maxlength="6000" placeholder="例如：核验某个账户在已配置检查点的余额和 nonce；失败就尝试其他服务。" required></textarea></label><button id="pi-generate" class="primary-button" disabled>生成任务草案 →</button></form><div id="pi-error" role="alert" hidden></div><div id="pi-draft"></div><div id="pi-progress" aria-live="polite"></div></div>`;
  const layout = $("#view-task .task-layout");
  const formPanel = $<HTMLElement>(".task-panel");
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
    err instanceof z.ZodError
      ? "条件不符合共享协议，请检查账户、区块、字段和预算。"
      : err instanceof Error
        ? err.message
        : "请求失败";
  const setWorking = (value: boolean) => {
    working = value;
    $<HTMLButtonElement>("#pi-generate").disabled = value || !configured;
    $<HTMLButtonElement>("#mode-fixed").disabled = value;
    $<HTMLButtonElement>("#mode-pi").disabled = value;
  };
  const setMode = (pi: boolean) => {
    onStart(
      pi
        ? "PI 任务尚未执行；请先生成并确认草案。"
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
  function renderDraft() {
    if (!draft) return;
    const p = draft.proposal;
    $("#pi-draft").innerHTML =
      `<div class="pi-draft-heading"><h3>任务草案 · 版本 ${draft.version}</h3><span class="badge neutral">${e(draft.status)}</span></div>${draft.error ? `<p class="reason">${e(draft.error)}</p>` : ""}${!p ? '<p class="subtle">PI 正在读取可用条件并生成草案；此阶段不会调用交付服务。</p>' : `<p class="subtle">${e(p.explanation)}</p>${p.missing.length ? `<div class="pi-missing"><strong>需要补充或明确的条件</strong><ul>${p.missing.map((v) => `<li>${e(v)}</li>`).join("")}</ul></div>` : ""}<form id="pi-conditions-form"><fieldset ${["CONFIRMED", "ERROR", "EXPIRED"].includes(draft.status) ? "disabled" : ""}><label>可信配置<select id="pi-context">${meta?.contexts.map((c) => `<option value="${e(c.contextId)}" ${c.contextId === p.contextId ? "selected" : ""}>${e(c.contextId)} · ${e(c.policy.id)}</option>`).join("")}</select></label><label>账户地址<input id="pi-account" value="${e(p.account ?? "")}" pattern="0x[0-9a-f]{40}" required></label><label>目标区块哈希<input id="pi-block" value="${e(p.blockHash ?? "")}" pattern="0x[0-9a-f]{64}" required></label><button type="button" id="pi-pinned" class="text-button">明确选用此配置的固定检查点</button><p class="hint">此操作由你选择固定检查点，不代表“最新区块”。签名要求来自后端配置。</p><div class="field-label">验收字段</div><div class="field-options">${["balance", "nonce", "codeHash", "storageRoot"].map((f) => `<label><input type="checkbox" name="pi-field" value="${f}" ${p.fields.includes(f as any) ? "checked" : ""}>${f}</label>`).join("")}</div><div class="field-label">允许尝试的候选</div>${meta?.capabilities.map((c) => `<label class="candidate-option"><input type="checkbox" name="pi-candidate" value="${e(c.serviceId)}" ${p.candidateIds.includes(c.serviceId) ? "checked" : ""}>${e(c.serviceId)}</label>`).join("")}<label class="toggle"><input type="checkbox" id="pi-history" ${p.useHistoricalEvidence ? "checked" : ""}><span>启用适用历史证据<small>每次新交付仍需重新核验</small></span></label><div class="budget-grid"><label>最多服务尝试<input id="pi-attempts" type="number" min="1" max="100" value="${p.budget.maxAttempts}" required></label><label>总预算（毫秒）<input id="pi-timeout" type="number" min="1" max="600000" value="${p.budget.timeoutMs}" required></label><label class="wide">最高服务成本（wei）<input id="pi-cost" value="${e(p.budget.maxCostWei)}" pattern="(0|[1-9][0-9]*)" required></label></div><div class="button-row"><button id="pi-save" type="submit" class="secondary-button">保存条件修改</button><button id="pi-confirm" type="button" class="primary-button" ${draft.status !== "READY" ? "disabled" : ""}>确认此版本并执行 →</button></div><p id="pi-unsaved" class="hint" hidden>条件已修改，请先保存新版本，再确认执行。</p></fieldset></form>`}`;
    const form = $<HTMLFormElement>("#pi-conditions-form");
    if (!form) return;
    form.addEventListener("input", () => {
      $("#pi-confirm").setAttribute("disabled", "");
      $("#pi-unsaved").hidden = false;
    });
    $("#pi-pinned")?.addEventListener("click", () => {
      const c = meta?.contexts.find(
        (c) => c.contextId === $<HTMLSelectElement>("#pi-context").value,
      );
      $<HTMLInputElement>("#pi-block").value = c?.trustedBlock?.blockHash ?? "";
      form.dispatchEvent(new Event("input"));
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (working) return;
      try {
        setWorking(true);
        const conditions = AgentConditionsSchema.parse({
          contextId: $<HTMLSelectElement>("#pi-context").value,
          account: $<HTMLInputElement>("#pi-account").value.trim(),
          blockHash: $<HTMLInputElement>("#pi-block").value.trim(),
          fields: [
            ...document.querySelectorAll<HTMLInputElement>(
              '[name="pi-field"]:checked',
            ),
          ].map((i) => i.value),
          candidateIds: [
            ...document.querySelectorAll<HTMLInputElement>(
              '[name="pi-candidate"]:checked',
            ),
          ].map((i) => i.value),
          useHistoricalEvidence: $<HTMLInputElement>("#pi-history").checked,
          budget: {
            maxAttempts: Number($<HTMLInputElement>("#pi-attempts").value),
            timeoutMs: Number($<HTMLInputElement>("#pi-timeout").value),
            maxCostWei: $<HTMLInputElement>("#pi-cost").value,
          },
        });
        draft = AgentDraftSchema.parse(
          await request(primary, `/api/agent/drafts/${draft!.draftId}/revise`, {
            version: draft!.version,
            conditions,
          }),
        );
        save();
        renderDraft();
        error();
      } catch (err) {
        error(message(err));
      } finally {
        setWorking(false);
      }
    });
    $("#pi-confirm")?.addEventListener("click", async () => {
      if (working) return;
      setWorking(true);
      $("#pi-confirm").setAttribute("disabled", "");
      error();
      try {
        const response = z
          .object({ agentId: z.string(), runId: z.string() })
          .parse(
            await request(
              primary,
              `/api/agent/drafts/${draft!.draftId}/confirm`,
              { version: draft!.version },
            ),
          );
        draft = AgentDraftSchema.parse(
          await request(primary, `/api/agent/drafts/${draft!.draftId}`),
        );
        renderDraft();
        onStart();
        await pollAgent(response.agentId);
      } catch (err) {
        error(
          "执行确认或查询未完成；再次确认相同版本只会返回同一个任务。" +
            message(err),
        );
        $("#pi-confirm")?.removeAttribute("disabled");
      } finally {
        setWorking(false);
      }
    });
  }
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
        onRun(
          RunSnapshotSchema.parse(
            await request(primary, `/api/runs/${agent.runId}`),
          ),
        );
        renderAgent();
        if (!["QUEUED", "RUNNING"].includes(agent.status) && agent.finishedAt)
          break;
        await new Promise((r) => setTimeout(r, 500));
      }
      await onDone();
    } finally {
      setWorking(false);
    }
  }
  async function pollDraft(id: string) {
    setWorking(true);
    try {
      for (;;) {
        draft = AgentDraftSchema.parse(
          await request(primary, `/api/agent/drafts/${id}`),
        );
        save();
        renderDraft();
        if (draft.status !== "GENERATING") break;
        await new Promise((r) => setTimeout(r, 500));
      }
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
      pending ??= {
        clientRequestId: crypto.randomUUID(),
        prompt: $<HTMLTextAreaElement>("#pi-prompt").value,
      };
      save();
      const { draftId } = z
        .object({ draftId: z.string() })
        .parse(await request(primary, "/api/agent/drafts", pending));
      pending = null;
      agent = null;
      events = [];
      $("#pi-progress").innerHTML = "";
      await pollDraft(draftId);
    } catch (err) {
      error("生成草案未完成，重试保留原请求 ID。" + message(err));
    } finally {
      setWorking(false);
    }
  });
  let restored = false;
  async function restore() {
    if (restored || !meta) return;
    restored = true;
    try {
      if (restoring.draftId) {
        setMode(true);
        await pollDraft(restoring.draftId);
      }
      if (restoring.agentId) {
        setMode(true);
        await pollAgent(restoring.agentId);
      }
      if (pending) {
        setMode(true);
        $<HTMLTextAreaElement>("#pi-prompt").value = pending.prompt;
        error("有一笔未确认的草案请求，点击生成草案将重试相同请求。");
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
        ? `PI 1.0.4 · ${info.modelId} · ${info.modelSource}。先审阅条件，再执行。`
        : "模型未配置。请由操作者配置兼容接口、模型 ID 和密钥环境变量；固定流程仍可使用。";
      meta = MetaSchema.parse(await request(primary, "/api/meta"));
      setWorking(false);
      let mode = "fixed";
      try {
        mode =
          sessionStorage.getItem("verdict-execution-mode:" + primary) ??
          "fixed";
      } catch {}
      if (mode === "pi") {
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
