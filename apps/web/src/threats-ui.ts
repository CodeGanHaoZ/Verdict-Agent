import { primary, request } from "./api";
import { badge, empty, escape as e, short, time } from "./view";

type ReportRow = {
  digest: string;
  incidentKey: string;
  revision: number;
  reporterId: string;
  action: string;
  status: string;
  replayStatus?: string;
  reason?: string;
  attribution?: string;
  weight?: number;
  at: string;
  origin?: string;
  redaction?: string | null;
  modelSource?: string;
};

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

// FR-G04: 公共索引页。报告默认化名化导出；导入实例独立复验后才可生成规则候选。
// ERC-8004 链上广播未接入，页面如实标注。
export function mountThreatsUI() {
  const list = $<HTMLElement>("#threats-list");
  const detail = $<HTMLElement>("#threat-detail");
  const result = () => $<HTMLElement>("#threat-detail-result");

  const row = (r: ReportRow, kind: string) =>
    `<div class="threat-row">
      <div class="threat-id"><b class="mono">${e(short(r.digest))}</b><span class="tag">${e(kind)}</span>${r.origin ? `<span class="tag">${e(r.origin)}</span>` : ""}</div>
      <div class="threat-meta">${e(r.action)} · rev ${r.revision} · ${e(short(r.reporterId))} · ${e(time(r.at))}${r.redaction ? ` · ${e(r.redaction)}` : ""}</div>
      <div class="threat-status">${badge(r.replayStatus ?? r.status)}${r.reason ? `<small>${e(r.reason)}</small>` : ""}</div>
      <div><button class="text-button" data-threat-detail="${e(r.digest)}">详情</button></div>
    </div>`;

  async function load() {
    list.innerHTML =
      '<div class="working"><span class="spinner"></span> 正在读取公共索引…</div>';
    try {
      const data = await request(primary, "/api/guard/reports") as {
        reports: ReportRow[];
        exported: ReportRow[];
        erc8004: { status: string; note: string };
      };
      list.innerHTML =
        (data.reports.length
          ? `<h3>已知报告（导入时已验签并独立复验）</h3>${data.reports.map((r) => row(r, r.origin ?? "IMPORTED")).join("")}`
          : `<p class="hint">暂无已导入报告。把另一实例导出的签名报告粘贴到下方导入。</p>`) +
        (data.exported.length
          ? `<h3>本机导出发件箱（可供广播）</h3>${data.exported.map((r) => row(r, "EXPORTED")).join("")}`
          : `<p class="hint">本机暂无导出的签名报告；在受 Guard 保护的运行里对被拒决定执行导出。</p>`) +
        `<p class="footnote">${e(data.erc8004.note)}</p>`;
      for (const button of list.querySelectorAll<HTMLButtonElement>(
        "[data-threat-detail]",
      ))
        button.onclick = () => void detailOf(button.dataset.threatDetail!);
    } catch (err) {
      list.innerHTML = `<p class="hint">无法读取公共索引：${e(
        err instanceof Error ? err.message : "未知错误",
      )}</p>`;
    }
  }

  async function detailOf(digest: string) {
    detail.innerHTML =
      '<div class="working"><span class="spinner"></span> 正在读取报告…</div>';
    try {
      const data = await request(
        primary,
        `/api/guard/reports/${digest}`,
      ) as { packet: { incident: unknown }; replay: unknown };
      detail.innerHTML = `<h3>报告 ${e(short(digest))}</h3>
        <details open><summary>化名化 incident（不含 prompt、原文材料或隐私）</summary><pre>${e(JSON.stringify(data.packet.incident, null, 2))}</pre></details>
        <details open><summary>本实例独立复验结果</summary><pre>${e(JSON.stringify(data.replay, null, 2))}</pre></details>
        <div class="button-row">
          <button class="secondary-button" id="threat-replay">再次独立复验</button>
          <button class="secondary-button" id="threat-candidate">生成规则候选</button>
        </div>
        <p class="hint">规则候选需复验为 REPRODUCED 才能生成；启用与撤销由维护者在本地执行 guard:rules，模型和网页不能启用规则。</p>
        <pre id="threat-detail-result"></pre>`;
      result().textContent = "";
      $<HTMLButtonElement>("#threat-replay").onclick = async () => {
        try {
          result().textContent = JSON.stringify(
            await request(primary, `/api/guard/reports/${digest}/replay`, {}),
            null,
            2,
          );
        } catch (err) {
          result().textContent = err instanceof Error ? err.message : String(err);
        }
      };
      $<HTMLButtonElement>("#threat-candidate").onclick = async () => {
        try {
          result().textContent = JSON.stringify(
            await request(primary, `/api/guard/reports/${digest}/candidate`, {}),
            null,
            2,
          );
        } catch (err) {
          result().textContent = err instanceof Error ? err.message : String(err);
        }
      };
    } catch (err) {
      detail.innerHTML = `<p class="hint">无法读取报告：${e(
        err instanceof Error ? err.message : "未知错误",
      )}</p>`;
    }
  }

  $<HTMLButtonElement>("#refresh-threats").onclick = () => void load();
  $<HTMLButtonElement>("#threat-import-submit").onclick = async () => {
    const output = $<HTMLElement>("#threat-import-result");
    try {
      const packet = JSON.parse(
        $<HTMLTextAreaElement>("#threat-import").value,
      ) as unknown;
      const result = await request(
        primary,
        "/api/guard/reports/import",
        packet,
      ) as { id: string; duplicate?: boolean; status?: string };
      output.textContent = JSON.stringify(result, null, 2);
      await load();
      void detailOf(result.id);
    } catch (err) {
      output.textContent =
        err instanceof Error ? err.message : "导入失败：无效的签名报告";
    }
  };
  void load();
}
