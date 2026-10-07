import type {
  CheckResult,
  VerificationResult,
  Candidate,
} from "@verdict/protocol";
export const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const short = (value: string) =>
  value.length > 25 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
export const time = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });
const labels: Record<string, string> = {
  PASS: "通过",
  FAIL: "不通过",
  UNVERIFIABLE: "无法核实",
  VERIFIED: "已验证",
  UNSIGNED: "未签名",
  INVALID: "无效",
  UNRESOLVED: "未确定",
  QUEUED: "排队中",
  RUNNING: "执行中",
  SUCCEEDED: "已采用",
  STOPPED: "已停止",
  ERROR: "异常",
  COMPLETED: "已完成",
  UNKNOWN: "未知",
  NOT_APPLICABLE: "不适用",
  NOT_COVERED: "未覆盖",
  MISMATCH: "不一致",
  UNAVAILABLE: "不可获取",
  NOT_CHECKED: "尚未检查",
  CONTEXT_DIFFERENT: "上下文不同",
  MATCH: "一致",
  NOT_COMPARABLE: "无法比较",
  FROZEN: "冻结样本",
  FAULT_INJECTION: "故障注入",
  LIVE: "实时观测",
  UI_MOCK: "界面样本",
  not_requested: "未请求发布",
  pending: "发布处理中",
  confirmed: "已确认发布",
  failed: "发布失败",
  SUPPORTED: "支持",
  UNSUPPORTED: "不支持",
  RATE_LIMITED: "限流",
  TIMEOUT: "超时",
  OK: "已响应",
};
export const label = (value: string) => labels[value] ?? value;
export function badge(value: string) {
  const tone = [
    "PASS",
    "SUCCEEDED",
    "VERIFIED",
    "MATCH",
    "SUPPORTED",
    "OK",
  ].includes(value)
    ? "green"
    : ["FAIL", "ERROR", "MISMATCH", "INVALID", "failed"].includes(value)
      ? "red"
      : [
            "UNVERIFIABLE",
            "UNKNOWN",
            "UNRESOLVED",
            "TIMEOUT",
            "RATE_LIMITED",
            "FAULT_INJECTION",
            "STOPPED",
          ].includes(value)
        ? "amber"
        : "neutral";
  return `<span class="badge ${tone}">${escape(label(value))}<span class="code">${escape(value)}</span></span>`;
}
const checkNames: Record<string, string> = {
  policy: "验收策略",
  "request-binding": "请求绑定",
  "request-validity": "请求有效期",
  "delivery-validity": "交付有效期",
  "request-replay": "请求消费",
  signature: "服务签名",
  "delivery-chain": "交付网络",
  "response-chain": "响应网络",
  "delivery-block": "交付区块",
  "response-block": "响应区块",
  account: "账户地址",
  baseline: "可信基准",
  header: "区块头",
  "account-proof": "账户证明",
  "field-balance": "余额",
  "field-nonce": "交易计数",
  "field-codeHash": "代码摘要",
  "field-storageRoot": "存储根",
};
export function checks(rows: CheckResult[]) {
  return `<div class="checks">${rows.map((c) => `<details class="check"><summary><span>${escape(checkNames[c.checkId] ?? c.checkId)}</span>${badge(c.status)}</summary><div class="check-body"><dl><dt>约定 / 要求</dt><dd>${escape(c.requirement)}</dd><dt>实际交付 / 检查值</dt><dd>${escape(c.actual)}</dd>${c.reasonCode ? `<dt>原因</dt><dd>${escape(c.reasonCode)}</dd>` : ""}<dt>证据位置</dt><dd>${c.evidenceRefs.map(escape).join("<br>") || "无材料引用"}</dd></dl></div></details>`).join("")}</div>`;
}
export function resultSummary(result: VerificationResult) {
  return `<div class="result-dimensions"><div><span>本次验收</span>${badge(result.verdict)}</div><div><span>数据结论</span>${badge(result.dataVerdict)}</div><div><span>签名归属</span>${badge(result.attributionStatus)}</div></div>`;
}
export function candidateCard(c: Candidate, index: number, detailed: boolean) {
  return `<article class="service-card"><div class="service-title"><span class="rank">${String(index + 1).padStart(2, "0")}</span><div><h3>${escape(c.serviceId)}</h3><span class="subtle">版本 ${escape(c.version)} · ${c.transport === "signed-http" ? "签名交付服务" : "RPC 能力观测"}</span></div>${badge(c.source)}</div><div class="service-facts"><span>证明 ${escape(label(c.declaredCapabilities.proof))}<small>声明能力</small></span><span>${c.quoteWei === null ? "报价未知" : escape(c.quoteWei) + " wei"}<small>配置报价</small></span><span>${c.observedCapabilities.length ? "已有观测" : "尚未观测"}<small>${c.eligible ? "可尝试 · 仍需当前验收" : "不参与当前交付"}</small></span></div>${
    detailed
      ? `<details><summary>能力、指标与选择理由 <span>↗</span></summary><div class="service-detail"><p class="subtle">字段：${c.declaredCapabilities.fields.map(escape).join(" / ")}<br>方法：${c.declaredCapabilities.methods.map(escape).join(" / ")}</p><ul class="reasons">${c.rankingReasons.map((r) => `<li>${escape(r)}</li>`).join("")}</ul>${c.metrics.map((m) => `<div class="metric-line"><strong>${escape(label(m.source))} · ${escape(m.method)}</strong><span>${m.sampleCount} 次观测 / ${m.responses} 次响应 · 中位延迟 ${m.medianLatencyMs === null ? "未知" : m.medianLatencyMs.toFixed(0) + " ms"}</span><span>PASS ${m.verdictCounts.PASS} · FAIL ${m.verdictCounts.FAIL} · UNVERIFIABLE ${m.verdictCounts.UNVERIFIABLE}</span><span>限流 ${m.rateLimited} · 超时 ${m.timeouts} · 不支持 ${m.unsupported} · 错误 ${m.errors}</span><small>范围 ${escape(m.requestedBlock ?? "未指定区块")}<br>${escape(time(m.windowStart))} — ${escape(time(m.windowEnd))}</small></div>`).join("") || '<p class="subtle">暂无实测指标；声明能力不代表实测通过。</p>'}${c.observedCapabilities
          .slice(0, 8)
          .map(
            (o) =>
              `<div class="observation"><span>${escape(o.method)} · ${escape(short(o.requestedBlock ?? "—"))}</span>${badge(o.status)}<small>${o.latencyMs.toFixed(0)} ms · HTTP ${o.httpStatus ?? "无响应"} · RPC ${o.rpcCode ?? "—"} · ${escape(time(o.recordedAt))}</small></div>`,
          )
          .join("")}</div></details>`
      : ""
  }</article>`;
}
export const empty = (title: string, description: string) =>
  `<div class="empty"><div class="empty-symbol">⌁</div><h3>${escape(title)}</h3><p>${escape(description)}</p></div>`;
