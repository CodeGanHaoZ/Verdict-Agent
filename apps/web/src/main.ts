import { z } from "zod";
import {
  CreateRunSchema,
  RunSnapshotSchema,
  EvidenceBundleSchema,
  type RunSnapshot,
  type CreateRun,
  type Candidate,
  type EvidenceBundle,
} from "@verdict/protocol";
import {
  ApiError,
  primary,
  secondary,
  request,
  replay,
  download,
  MetaSchema,
  CandidatesSchema,
  IndexSchema,
  DetailSchema,
  type Meta,
  type EvidenceIndex,
  type EvidenceDetail,
} from "./api";
import {
  escape as e,
  short,
  time,
  label,
  badge,
  checks,
  resultSummary,
  candidateCard,
  empty,
} from "./view";
import "./style.css";
import { mountAgentUI } from "./agent-ui";
import { mountThreatsUI } from "./threats-ui";
import { mountMonitorUI } from "./monitor-ui";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
let graphMounted=false;
let walletMounted=false;
let meta: Meta | null = null,
  candidates: Candidate[] = [],
  evidenceIndex: EvidenceIndex = [];
let run: RunSnapshot | null = null,
  busy = false,
  pending: CreateRun | null = null,
  lastRunId: string | null = null;
let selection: Candidate[] | null = null,
  selectedEvidence: {
    detail: EvidenceDetail;
    bundle: EvidenceBundle | null;
  } | null = null;
let evidenceGeneration = 0,
  polling = false,
  replayBusy = false,
  unresolvedRun = false,
  formRevision = 0;
const storageKey = "verdict-run:" + primary;
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
  lastRunId = typeof saved.runId === "string" ? saved.runId : null;
  pending = saved.pending ? CreateRunSchema.parse(saved.pending) : null;
} catch {
  /* Invalid local UI state cannot become an API request. */
}
function persist() {
  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ runId: lastRunId, pending }),
    );
  } catch {
    /* A blocked browser store does not prevent live use. */
  }
}
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${name === "task" ? '<path d="M7 3h10v18H7zM10 8h4m-4 4h4m-4 4h3"/>' : name === "services" ? '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h1m-1 10h1"/>' : '<path d="m12 3 8 4v6c0 5-8 8-8 8s-8-3-8-8V7zM8 12l3 3 5-6"/>'}</svg>`;
$("#app").innerHTML =
  `<aside class="sidebar"><a class="brand" href="#task"><img src="/verdict.svg" alt="" width="38" height="38"><span>Verdict<small>服务验收与证据审计</small></span></a><div class="nav-label">WORKSPACE</div><nav aria-label="主要导航"><button data-view="task" class="nav-item active">${icon("task")}任务验收<span>01</span></button><button data-view="services" class="nav-item">${icon("services")}服务目录<span>02</span></button><button data-view="evidence" class="nav-item">${icon("evidence")}证据复验<span>03</span></button><button data-view="activity" class="nav-item">${icon("task")}Agent 活动<span>04</span></button><button data-view="wallet" class="nav-item">${icon("evidence")}钱包审查<span>05</span></button><button data-view="monitor" class="nav-item">${icon("monitor")}外审监控台<span>06</span></button><button data-view="threats" class="nav-item">${icon("threats")}威胁账本<span>07</span></button></nav><div class="sidebar-note"><div class="tiny-label">VERIFY BEFORE USE</div><p>每次交付，都要有据可查。</p><span>先检查签名与证明，<br>再决定是否采用数据。</span></div><div class="sidebar-footer"><span class="dot"></span>本地验证环境<small>Ethereum · 账户状态</small></div></aside>
<div class="workspace"><header class="topbar"><span class="breadcrumb">工作台 <span>/</span> <b id="page-name">任务验收</b></span><div class="connection"><span id="connection-status">正在连接…</span><button id="reconnect" class="icon-button" aria-label="重新连接后端">↻</button></div></header><main><div id="notice" role="alert" hidden></div><section class="page-heading"><div><div class="eyebrow">VERIFIABLE BY DESIGN</div><h1 id="heading">先验收，再采用。</h1><p id="intro">从服务交付到可复验的证据，把每一次判断展开来看。</p></div><span class="environment">◈ Ethereum Mainnet</span></section>
<div class="stats"><div><span>签名交付候选</span><strong id="service-count">—</strong><small>每份交付独立验收</small></div><div><span>当前任务</span><strong id="run-status">未开始</strong><small id="run-caption">提交后查看调用与替换过程</small></div><div><span>本机证据索引</span><strong id="evidence-count">—</strong><small>原始材料可下载、可复验</small></div></div>
<section id="view-task" class="view"><div class="task-layout"><section class="panel task-panel"><div class="panel-heading"><h2>验收条件</h2><span class="step">01 / REQUEST</span></div><form id="task-form"><fieldset id="task-fields" disabled><label>可信配置<select id="context" name="context" required></select></label><label>账户地址<input id="account" name="account" spellcheck="false" required pattern="0x[0-9a-f]{40}" placeholder="0x…"></label><label>目标区块哈希<input id="block" name="block" class="mono" spellcheck="false" required pattern="0x[0-9a-f]{64}" placeholder="0x…"></label><p class="hint">使用后端配置的检查点。输入其他区块不会自动改变信任基准。</p><label>调用方案<select id="scenario"><option value="fallback">自动替换 · 三个演示服务</option><option value="success">仅正常服务</option><option value="all-fail">全部失败 · 两个故障服务</option><option value="custom">自选候选</option></select></label><div id="candidate-options" hidden></div><div class="field-label">验收字段</div><div class="field-options">${["balance", "nonce", "codeHash", "storageRoot"].map((f) => `<label><input type="checkbox" name="field" value="${f}" checked>${f}</label>`).join("")}</div><label class="toggle"><input id="history" type="checkbox"><span>使用适用的历史反证<small>影响顺序，每次新交付仍需核验</small></span></label><details class="budget"><summary>次数、时间与成本预算</summary><div class="budget-grid"><label>最多尝试<input id="max-attempts" type="number" min="1" max="100" value="3" required></label><label>超时（毫秒）<input id="timeout" type="number" min="1" max="600000" value="15000" required></label><label class="wide">最高成本（wei）<input id="cost" inputmode="numeric" pattern="(0|[1-9][0-9]*)" value="0" required></label></div></details><button class="primary-button" id="submit" type="submit">开始验收 <span>→</span></button><button class="text-button" id="preview-selection" type="button">查看候选顺序</button></fieldset></form><button id="retry-submit" class="primary-button" hidden>重试同一请求</button><p class="footnote">演示交付使用真实冻结证明；错块与错值在签名前注入，签名不属于 RPC 厂商。</p><div id="selection-preview"></div></section><section class="panel audit-panel"><div class="panel-heading"><h2>交付与验收</h2><span class="step">02 / AUDIT</span></div><div id="audit" aria-live="polite">${empty("等待第一笔任务", "设置账户与区块后开始验收。调用、拒收、替换与采用，都将在这里留下记录。")}<div class="flow"><span>获取交付</span><i>→</i><span>核验依据</span><i>→</i><span>采用或停止</span></div></div></section></div></section>
<section id="view-services" class="view" hidden><div class="section-toolbar"><p>声明能力与实测结果分开展示。RPC 仅作观测，不冒充签名服务。</p><button id="observe" class="secondary-button">采集实时 RPC 观测 ↗</button></div><div id="services-list" class="services-grid"></div></section>
<section id="view-evidence" class="view" hidden><div class="evidence-layout"><section class="panel evidence-list-panel"><div class="panel-heading"><h2>证据记录</h2><button id="refresh-evidence" class="text-button">刷新</button></div><div id="evidence-list"></div></section><section class="panel evidence-detail-panel"><div class="panel-heading"><h2>独立复验</h2><span class="step">03 / REPLAY</span></div><div id="evidence-detail">${empty("选择一份证据", "下载原始材料，或让第二实例重新计算签名、账户证明与请求条件。")}</div></section></div></section>
<section id="view-wallet" class="view" hidden><div id="wallet-root"></div></section>
<section id="view-activity" class="view" hidden><div id="agent-graph-root"></div></section><section id="view-monitor" class="view" hidden><div class="evidence-layout"><section class="panel evidence-list-panel"><div class="panel-heading"><h2>受监任务</h2><button id="refresh-monitor" class="text-button">刷新</button></div><p class="hint">外审状态灯来自真实 Guard 决定；策略当前固定「审查不可用即停止」，fail-open 开关待评审。</p><div id="monitor-list"></div></section><section class="panel evidence-detail-panel"><div class="panel-heading"><h2>审计时间线 · 决定与许可</h2><span class="step">04 / MONITOR</span></div><div id="monitor-detail">${empty("选择一个任务", "查看锁定边界、逐条活动的外审决定、一次性许可消费与交付验收结果。")}</div></section></div></section>
<section id="view-threats" class="view" hidden><div class="evidence-layout"><section class="panel evidence-list-panel"><div class="panel-heading"><h2>公共索引 · 签名安全报告</h2><button id="refresh-threats" class="text-button">刷新</button></div><p class="hint">报告默认化名化导出，不含 prompt、原文材料或隐私；导入时重新验签并独立复验。</p><div id="threats-list"></div><div class="import-box"><textarea id="threat-import" aria-label="签名安全报告" placeholder="粘贴另一实例导出的签名安全报告 JSON"></textarea><button id="threat-import-submit" class="secondary-button">导入并独立复验</button><pre id="threat-import-result"></pre></div></section><section class="panel evidence-detail-panel"><div class="panel-heading"><h2>报告详情 · 复验与规则候选</h2><span class="step">04 / LEDGER</span></div><div id="threat-detail">${empty("选择一份报告", "导入或点击左侧报告查看化名化内容、独立复验结果与规则候选。")}</div></section></div></section>
<footer class="main-footer"><span>Verdict Agent <b>·</b> 证据先于结论</span><span>PI Agent · 显式配置 <b>·</b> 链上存证未接入</span></footer></main></div>`;

function notice(message = "") {
  $("#notice").hidden = !message;
  $("#notice").textContent = message;
}
function errorMessage(error: unknown) {
  return error instanceof z.ZodError
    ? "输入或 API 数据不符合共享协议，请检查账户、区块、字段和预算。"
    : error instanceof Error
      ? error.message
      : "操作失败，请重试。";
}
function showView(name: string) {
  let route=name;name=name.split("?")[0];
  if (!["task", "services", "evidence", "activity", "wallet", "monitor", "threats"].includes(name)) {name="task";route="task";}
  for (const item of document.querySelectorAll<HTMLElement>("[data-view]")) {
    const active = item.dataset.view === name;
    item.classList.toggle("active", active);
    item.setAttribute("aria-current", active ? "page" : "false");
  }
  for (const view of document.querySelectorAll<HTMLElement>(".view"))
    view.hidden = view.id !== `view-${name}`;
  const names: Record<string, [string, string]> = {
    monitor: ["外审监控台", "每一次放行与拦截，都有耗时和原因。"],
    threats: ["威胁账本", "报告可复验，规则可追溯。"],
    wallet:["钱包审查","签名前，先看清交易。"],
    activity:["Agent 活动","行动有迹，判断有据。"],
    task: ["任务验收", "先验收，再采用。"],
    services: ["服务目录", "每个选择，都有依据。"],
    evidence: ["证据复验", "结论可以分享，证据需要重验。"],
  };
  $("#page-name").textContent = names[name][0];
  $("#heading").textContent = names[name][1];
  $("#intro").textContent =
    name === "monitor" ? "外审在动作执行前检查行为边界；硬规则拦截与模型拦截分别显示。" :
    name === "threats" ? "导入实例独立复验后才可生成规则候选；ERC-8004 链上广播未接入。" :
    name === "wallet" ? "连接浏览器钱包，自动检查本页交易的实际参数与执行条件。" :
    name === "task"
      ? "从服务交付到可复验的证据，把每一次判断展开来看。"
      : name === "services"
        ? "查看服务能力、采样范围和实际观测，不用一个总分掩盖差异。"
        : "由独立实例和可信配置重新计算；复验完成不等于数据通过。";
  if(location.hash.slice(1)!==route)location.hash=route;
  document.querySelector('.page-heading')?.toggleAttribute('hidden',name==='activity');
  document.querySelector('.stats')?.toggleAttribute('hidden',name==='activity'||name==='wallet');
  document.querySelector('.environment')?.toggleAttribute('hidden',name==='wallet');
  if(name==='wallet'&&!walletMounted){walletMounted=true;void import('./wallet/ui').then(m=>m.mountWalletUI($('#wallet-root'))).catch(()=>{walletMounted=false;$('#wallet-root').textContent='钱包界面加载失败，请刷新。';});}
  if(name==='activity'&&!graphMounted){graphMounted=true;void import('./graph/Activity').then(m=>m.mountActivityGraph($('#agent-graph-root'))).catch(()=>{graphMounted=false;$('#agent-graph-root').textContent='活动图加载失败，请刷新重试。';});}
  if(name==='evidence'){
    const evidenceId=new URLSearchParams(route.split('?')[1]??'').get('evidenceId');
    if(evidenceId&&/^0x[0-9a-f]{64}$/.test(evidenceId))void openEvidence(evidenceId);
  }
}
function setBusy(value: boolean) {
  busy = value;
  $("#task-fields").toggleAttribute(
    "disabled",
    !meta || busy || !!pending || unresolvedRun,
  );
  $("#submit").innerHTML = value ? "正在验收…" : "开始验收 <span>→</span>";
  $("#retry-submit").hidden = !pending || busy;
}
function updateContext() {
  const context = meta?.contexts.find(
    (c) => c.contextId === $<HTMLSelectElement>("#context").value,
  );
  $<HTMLInputElement>("#block").value = context?.trustedBlock?.blockHash ?? "";
  $<HTMLInputElement>("#account").value =
    meta?.capabilities.flatMap((c) => c.accounts ?? [])[0] ?? "";
}
function getInput(): CreateRun {
  const form = $<HTMLFormElement>("#task-form");
  if (!form.reportValidity()) throw new Error("请填写有效的验收条件。");
  const context = meta!.contexts.find(
    (c) => c.contextId === $<HTMLSelectElement>("#context").value,
  )!;
  const scenario = $<HTMLSelectElement>("#scenario").value;
  const ids =
    scenario === "custom"
      ? [
          ...document.querySelectorAll<HTMLInputElement>(
            '[name="candidate"]:checked',
          ),
        ].map((c) => c.value)
      : scenario === "success"
        ? ["demo-valid"]
        : scenario === "all-fail"
          ? ["demo-wrong-block", "demo-wrong-value"]
          : ["demo-wrong-block", "demo-wrong-value", "demo-valid"];
  const now = Math.floor(Date.now() / 1000);
  return CreateRunSchema.parse({
    contextId: context.contextId,
    candidateIds: ids,
    useHistoricalEvidence: $<HTMLInputElement>("#history").checked,
    task: {
      schemaVersion: "1.0.0",
      requestId: crypto.randomUUID(),
      dataChainId: context.trustedBlock?.dataChainId ?? "1",
      account: $<HTMLInputElement>("#account").value.trim(),
      blockHash: $<HTMLInputElement>("#block").value.trim(),
      fields: [
        ...document.querySelectorAll<HTMLInputElement>(
          '[name="field"]:checked',
        ),
      ].map((f) => f.value),
      evidencePolicyId: context.policy.id,
      validity: { notBefore: String(now - 5), expiresAt: String(now + 900) },
      budget: {
        maxAttempts: Number($<HTMLInputElement>("#max-attempts").value),
        timeoutMs: Number($<HTMLInputElement>("#timeout").value),
        maxCostWei: $<HTMLInputElement>("#cost").value.trim(),
      },
    },
  });
}
function renderAudit() {
  if (!run) return;
  $("#run-status").textContent = label(run.status);
  $("#run-caption").textContent =
    `${run.attempts.length} 次调用 · 预留 ${run.spentWei} wei`;
  const terminal = ["SUCCEEDED", "STOPPED", "ERROR"].includes(run.status);
  $("#audit").innerHTML =
    `<div class="run-heading">${badge(run.status)}<code title="${e(run.runId)}">${e(short(run.runId))}</code></div>${
      run.accepted
        ? `<div class="accepted"><div class="tiny-label">VERIFIED RESULT</div><h3>数据已通过本次验收</h3><p>采用 ${e(run.accepted.serviceId)} 的交付</p><dl>${Object.entries(
            run.accepted.values,
          )
            .map(
              ([k, v]) =>
                `<dt>${e(k)}${k === "balance" ? " (wei)" : ""}</dt><dd>${e(v)}</dd>`,
            )
            .join(
              "",
            )}</dl><button class="text-button" data-evidence="${e(run.accepted.evidenceId)}">查看采用依据 ↗</button></div>`
        : terminal
          ? `<div class="stopped"><h3>已停止数据依赖</h3><p>没有被采用的数据；后续操作应停止依赖本次查询。</p><code>${e(run.stopReason)}</code></div>`
          : '<div class="working"><span class="spinner"></span> 正在获取交付并核验，结果尚未定案。</div>'
    }<div class="timeline">${run.attempts.map((a, i) => `<article class="attempt"><span class="timeline-marker">${i + 1}</span><div class="attempt-content"><div class="attempt-heading"><h3>${e(a.serviceId)}</h3>${a.status === "RUNNING" ? badge("RUNNING") : a.verification ? badge(a.verification.verdict) : badge(a.observationStatus)}</div><div class="attempt-meta">${badge(a.source)}<span>${a.status === "RUNNING" ? "等待交付与验收" : a.latencyMs.toFixed(0) + " ms · " + (run?.accepted?.evidenceId === a.evidenceId ? "已采用" : "未采用")}</span></div>${a.runtimeReason ? `<p class="reason">${e(a.runtimeReason)}</p>` : ""}${a.verification ? `<p class="subtle">数据 ${e(label(a.verification.dataVerdict))} · 签名归属 ${e(label(a.verification.attributionStatus))}</p><details class="audit-checks"><summary>展开 ${a.verification.checks.length} 项核验依据 <span>↓</span></summary>${checks(a.verification.checks)}</details>` : a.status !== "RUNNING" ? '<p class="subtle">未获得可核验的交付，不推断数据正确性。</p>' : ""}${a.evidenceId ? `<button class="text-button" data-evidence="${e(a.evidenceId)}">查看证据 ↗</button>` : ""}</div></article>`).join("")}</div>`;
}
async function pollRun(id: string) {
  if (polling) return;
  polling = true;
  unresolvedRun = true;
  setBusy(true);
  try {
    for (;;) {
      run = RunSnapshotSchema.parse(
        await request(primary, `/api/runs/${encodeURIComponent(id)}`),
      );
      renderAudit();
      if (["SUCCEEDED", "STOPPED", "ERROR"].includes(run.status)) {
        unresolvedRun = false;
        break;
      }
      await new Promise((r) => setTimeout(r, 350));
    }
    await refreshData();
  } catch (error) {
    notice(
      unresolvedRun
        ? `查询中断，任务可能仍在后端运行。点击右上角重新连接可恢复同一任务。${errorMessage(error)}`
        : `任务已经结束，但目录刷新失败。${errorMessage(error)}`,
    );
  } finally {
    polling = false;
    setBusy(false);
  }
}
async function submit() {
  try {
    if (!pending) pending = getInput();
    run = null;
    lastRunId = null;
    $("#run-status").textContent = "提交中";
    $("#run-caption").textContent = "等待后端确认任务";
    $("#audit").innerHTML =
      '<div class="working"><span class="spinner"></span> 正在提交新任务，尚无可采用的数据。</div>';
    notice();
    persist();
    setBusy(true);
    const response = z
      .object({ runId: z.string(), duplicate: z.boolean() })
      .parse(await request(primary, "/api/runs", pending));
    lastRunId = response.runId;
    pending = null;
    persist();
    await pollRun(lastRunId);
  } catch (error) {
    if (
      error instanceof ApiError &&
      [400, 404, 409, 415, 422].includes(error.status)
    ) {
      pending = null;
      persist();
    }
    notice(
      pending
        ? `提交未确认。为避免重复调用，请使用“重试同一请求”确认原任务。${errorMessage(error)}`
        : errorMessage(error),
    );
  } finally {
    setBusy(false);
  }
}
function renderEvidenceList() {
  $("#evidence-count").textContent = String(evidenceIndex.length);
  $("#evidence-list").innerHTML = evidenceIndex.length
    ? evidenceIndex
        .slice(0, 100)
        .map(
          (item) =>
            `<button class="evidence-item ${selectedEvidence?.detail.evidenceId === item.evidenceId ? "selected" : ""}" data-evidence="${e(item.evidenceId)}"><span class="file-icon">◫</span><span><code>${e(short(item.evidenceId))}</code><small>${e(time(item.createdAt))}</small></span><span>↗</span></button>`,
        )
        .join("")
    : empty("尚无证据", "完成一次调用后，证据将在此处可用。");
}
async function refreshData() {
  const [services, index] = await Promise.all([
    request(primary, "/api/services"),
    request(primary, "/api/evidence"),
  ]);
  candidates = CandidatesSchema.parse(services).candidates;
  evidenceIndex = IndexSchema.parse(index).evidence;
  $("#service-count").textContent = String(
    candidates.filter((c) => c.transport === "signed-http").length,
  );
  $("#services-list").innerHTML = candidates
    .map((c, i) => candidateCard(c, i, true))
    .join("");
  renderEvidenceList();
}
async function connect() {
  notice();
  $("#connection-status").textContent = "正在连接…";
  try {
    meta = MetaSchema.parse(await request(primary, "/api/meta"));
    const contextBefore = $<HTMLSelectElement>("#context").value;
    $("#context").innerHTML = meta.contexts
      .map(
        (c) => `<option value="${e(c.contextId)}">${e(c.contextId)}</option>`,
      )
      .join("");
    if (meta.contexts.some((c) => c.contextId === contextBefore))
      $<HTMLSelectElement>("#context").value = contextBefore;
    if (!$<HTMLInputElement>("#account").value) updateContext();
    await refreshData();
    $("#candidate-options").innerHTML = candidates
      .filter((c) => c.transport === "signed-http")
      .map(
        (c) =>
          `<label class="candidate-option"><input type="checkbox" name="candidate" value="${e(c.serviceId)}" checked>${e(c.serviceId)}</label>`,
      )
      .join("");
    $("#connection-status").innerHTML =
      `<span class="dot"></span>${e(meta.instanceId)} 已连接`;
    setBusy(busy);
    let piSelected = false;
    try {
      piSelected =
        sessionStorage.getItem("verdict-execution-mode:" + primary) === "pi";
    } catch {}
    if (lastRunId && !pending && !piSelected) await pollRun(lastRunId);
  } catch (error) {
    meta = null;
    setBusy(false);
    $("#connection-status").textContent = "后端未连接";
    notice(
      `无法连接 ${primary}。请先在仓库运行 npm run dev:init 和 npm run dev:start，再点击重新连接。${errorMessage(error)}`,
    );
  }
}
function renderEvidence() {
  if (!selectedEvidence) return;
  const { detail, bundle } = selectedEvidence;
  $("#evidence-detail").innerHTML =
    `<div class="evidence-top"><span class="tiny-label">CONTENT-ADDRESSED EVIDENCE</span><code class="hash">${e(detail.evidenceId)}</code></div><div class="evidence-meta"><div><span>文件完整性</span>${badge(detail.artifactIntegrity)}</div><div><span>发布状态</span>${badge(detail.publication.status)}</div></div><p class="subtle">${detail.publication.adapter === "not_configured" ? "链上存证适配器未接入。文件完整性与数据正确性是独立结论。" : e(detail.publication.error ?? detail.publication.adapter)}</p>${bundle ? `<div class="bundle-summary"><div class="service-title"><h3>${e(bundle.delivery.serviceId)}</h3>${badge(bundle.provenance.mode)}</div><p class="subtle">${e(bundle.provenance.description)}</p>${resultSummary(bundle.result)}<dl class="scope"><dt>账户</dt><dd>${e(bundle.request.account)}</dd><dt>目标区块</dt><dd>${e(bundle.request.blockHash)}</dd><dt>规则 / 策略</dt><dd>${e(bundle.ruleVersion)} / ${e(bundle.request.evidencePolicyId)}</dd></dl></div>` : '<div class="stopped">原始文件不可用或已被修改，无法读取证据正文。</div>'}<div class="button-row"><button class="secondary-button" data-download="bundle" ${bundle ? "" : "disabled"}>下载原始证据 ↓</button><button class="secondary-button" data-download="manifest">下载 Manifest ↓</button></div><div class="replay-box"><h3>让第二实例重新检查</h3><p>签名、证明与请求条件由第二实例重算，信任基准来自它自己的配置。</p><code>${e(secondary)}</code><div class="button-row"><button id="replay-remote" class="primary-button" ${bundle ? "" : "disabled"}>第二实例独立复验 <span>→</span></button><button id="replay-local" class="text-button" ${bundle ? "" : "disabled"}>本机重新核验</button></div><div id="replay-output" aria-live="polite"></div></div>${bundle ? `<details class="audit-checks"><summary>原始报告 · ${bundle.result.checks.length} 项核验依据 <span>↓</span></summary>${checks(bundle.result.checks)}</details>` : ""}`;
  renderEvidenceList();
}
async function openEvidence(id: string) {
  if (replayBusy) {
    notice("复验正在执行，请等待本次结果再切换证据。");
    return;
  }
  const generation = ++evidenceGeneration;
  showView("evidence");
  notice();
  selectedEvidence = null;
  $("#evidence-detail").innerHTML =
    '<div class="working"><span class="spinner"></span> 正在读取原始证据…</div>';
  try {
    const detail = DetailSchema.parse(
      await request(primary, `/api/evidence/${encodeURIComponent(id)}`),
    );
    const bundle =
      detail.artifactIntegrity === "VERIFIED"
        ? EvidenceBundleSchema.parse(
            await request(
              primary,
              `/api/evidence/${encodeURIComponent(id)}/bundle`,
            ),
          )
        : null;
    if (generation !== evidenceGeneration) return;
    selectedEvidence = { detail, bundle };
    renderEvidence();
  } catch (error) {
    if (generation === evidenceGeneration) {
      $("#evidence-detail").innerHTML = empty(
        "无法读取证据",
        errorMessage(error),
      );
      notice(errorMessage(error));
    }
  }
}
async function runReplay(remote: boolean) {
  if (!selectedEvidence?.bundle || replayBusy) return;
  replayBusy = true;
  const { detail, bundle } = selectedEvidence;
  $("#replay-remote").toggleAttribute("disabled", true);
  $("#replay-local").toggleAttribute("disabled", true);
  $("#replay-output").innerHTML =
    '<div class="working"><span class="spinner"></span> 正在独立重算，请稍候…</div>';
  notice();
  try {
    const target = remote ? secondary : primary;
    if (remote) {
      const other = MetaSchema.parse(await request(target, "/api/meta"));
      if (other.instanceId === meta?.instanceId)
        throw new Error("第二实例配置指向当前实例，不能标为独立复验。");
      if (!other.contexts.some((c) => c.contextId === detail.contextId))
        throw new Error("第二实例没有接受对应可信配置，请由操作者配置后重试。");
      await request(target, "/api/evidence/import", {
        bundle,
        manifest: detail.manifest,
        contextId: detail.contextId,
      });
    }
    const replayed = await replay(target, detail.evidenceId, detail.contextId);
    $("#replay-output").innerHTML =
      `<div class="replay-result"><h4>${remote ? "第二实例" : "本机"}复验结果</h4><p>流程 ${badge(replayed.status)} · 报告一致性 ${e(replayed.reportConsistent === true ? "一致" : replayed.reportConsistent === false ? "不一致" : "未确定")}</p>${replayed.result ? `<div class="evidence-meta"><div><span>文件完整性</span>${badge(replayed.result.artifactIntegrity)}</div><div><span>上下文比较</span>${badge(replayed.result.comparison)}</div></div>${replayed.result.recomputedResult ? resultSummary(replayed.result.recomputedResult) : ""}<p class="reason">${replayed.result.reasonCodes.map(e).join(" · ")}</p>` : ""}${replayed.error ? `<p class="reason">${e(replayed.error)}</p>` : ""}<p class="subtle">复验完成只表示流程结束；数据和签名结论以重算结果为准。</p></div>`;
    if (remote && replayed.reportConsistent) {
      const now = Math.floor(Date.now() / 1000);
      const input = {
        contextId: detail.contextId,
        task: {
          ...bundle.request,
          requestId: crypto.randomUUID(),
          validity: {
            notBefore: String(now - 5),
            expiresAt: String(now + 900),
          },
        },
      };
      const off = CandidatesSchema.parse(
        await request(target, "/api/selection", {
          ...input,
          useHistoricalEvidence: false,
        }),
      ).candidates;
      const on = CandidatesSchema.parse(
        await request(target, "/api/selection", {
          ...input,
          useHistoricalEvidence: true,
        }),
      ).candidates;
      const order = (rows: Candidate[]) =>
        rows
          .filter((c) => c.eligible)
          .map(
            (c) =>
              `<li>${e(c.serviceId)}${c.applicableEvidenceIds.length ? "<small>有已复验的适用反证，降低优先级</small>" : ""}</li>`,
          )
          .join("");
      $("#replay-output").insertAdjacentHTML(
        "beforeend",
        `<div class="comparison"><h4>同一请求，开关历史证据</h4><p class="subtle">固定请求与当前观测，仅切换历史证据开关；无适用反证时顺序可以相同。</p><div class="comparison-grid"><div><span>关闭历史证据</span><ol>${order(off)}</ol></div><div><span>启用历史证据</span><ol>${order(on)}</ol></div></div><p class="subtle">历史证据只影响顺序，后续新交付仍须通过当前验收。</p></div>`,
      );
    }
  } catch (error) {
    $("#replay-output").innerHTML =
      `<div class="stopped"><h4>复验未完成</h4><p>${e(errorMessage(error))}</p><p>未采用导入包自报的结论。</p></div>`;
  } finally {
    replayBusy = false;
    $("#replay-remote")?.removeAttribute("disabled");
    $("#replay-local")?.removeAttribute("disabled");
  }
}

document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("button");
  if (!target) return;
  if (target.dataset.view) showView(target.dataset.view);
  if (target.dataset.evidence) void openEvidence(target.dataset.evidence);
  if (target.dataset.download && selectedEvidence)
    void download(
      primary,
      selectedEvidence.detail.evidenceId,
      target.dataset.download as "bundle" | "manifest",
    ).catch((error) => notice(errorMessage(error)));
  if (target.id === "replay-remote") void runReplay(true);
  if (target.id === "replay-local") void runReplay(false);
});
$("#task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!busy) void submit();
});
$("#retry-submit").addEventListener("click", () => {
  if (!busy) void submit();
});
$("#context").addEventListener("change", updateContext);
$("#scenario").addEventListener("change", () => {
  $("#candidate-options").hidden =
    $<HTMLSelectElement>("#scenario").value !== "custom";
});
$("#reconnect").addEventListener("click", () => {
  if (!busy) void connect();
});
$("#refresh-evidence").addEventListener("click", () => {
  void refreshData().catch((error) => notice(errorMessage(error)));
});
$("#preview-selection").addEventListener("click", async () => {
  try {
    const input = getInput();
    const revision = ++formRevision;
    const response = await request(primary, "/api/selection", input);
    if (revision !== formRevision) return;
    selection = CandidatesSchema.parse(response).candidates;
    $("#selection-preview").innerHTML =
      `<div class="preview"><h3>本次候选顺序</h3><ol>${selection.map((c) => `<li>${e(c.serviceId)}<small>${c.eligible ? (c.applicableEvidenceIds.length ? "存在适用反证 · 仍可复检" : "可尝试 · 必须验收") : "不满足能力或成本条件"}</small></li>`).join("")}</ol></div>`;
    notice();
  } catch (error) {
    notice(errorMessage(error));
  }
});
$("#observe").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("#observe");
  button.disabled = true;
  button.textContent = "正在采集，最多约 96 秒…";
  notice();
  try {
    await request(primary, "/api/observations", {}, 110000);
    await refreshData();
  } catch (error) {
    notice(errorMessage(error));
  } finally {
    button.disabled = false;
    button.textContent = "采集实时 RPC 观测 ↗";
  }
});
$("#task-form").addEventListener("change", () => {
  formRevision++;
  $("#selection-preview").innerHTML = "";
});
window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
showView(location.hash.slice(1) || "task");
void connect();

mountAgentUI(
  (snapshot) => {
    run = snapshot;
    renderAudit();
  },
  (message?: string) => {
    run = null;
    $("#run-status").textContent = message ? "未开始" : "PI 执行中";
    $("#run-caption").textContent = "尚无本次采用结果";
    $("#audit").innerHTML = message
      ? `<div class="working">${e(message)}</div>`
      : '<div class="working"><span class="spinner"></span> PI 正在选择候选，尚无被采用数据。</div>';
  },
  refreshData,
  () => !busy && !polling && !unresolvedRun,
);

mountThreatsUI();
mountMonitorUI();
