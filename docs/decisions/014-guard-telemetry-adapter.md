# 014 Guard 活动流接入 pi-telemetry（FR-G02）

2026-10-07。对应 [21-模型外审产品PRD](../21-模型外审产品PRD.md) 的 FR-G02，补齐 [20-Verdict-Guard](../20-Verdict-Guard.md) 记录的「尚未适配任何第三方活动插件」。状态：已实现并通过回归。

## 决定

1. **采用 `@earendil-works/pi-telemetry@1.0.4`**（与主工程固定的 pi 1.0.4 同版本）作为活动交换契约：span 型显式上下文 + `defineTelemetrySchema` 可序列化 domain schema + `InMemoryTelemetryContext` 参考适配器。
2. **Guard 定义自己的 domain schema**（`verdict.guard.review@1`，见 `apps/server/src/guard-telemetry.ts`）：每条活动/决定渲染为一个 span，start 属性为 agent_id／sequence／action／activity_source，end 属性为 verdict／reason_code／latency_ms／**arguments_digest**／arguments_status；BLOCKED 判定为 error 状态（`GUARD_BLOCKED`）。**原始参数、prompt 与材料原文永不进入 telemetry**，只出境摘要与决定元数据（与签名报告的化名化纪律一致）。
3. **导出**：`GET /api/guard/tasks/:agentId/telemetry` 返回 `{schema, spans}`，spans 由 `InMemoryTelemetryContext` 真实回放产生（非手拼 JSON），任何 pi-telemetry 消费端（含「暴露 agent 活动的插件」）可直接接入。
4. **导入**：`POST /api/guard/tasks/:agentId/telemetry/import` 接受 `{spans:[{name,attributes,events,status}]}`（zod 严格校验，≤200 条/次，属性为扁平 string/number/boolean），以 `EXTERNAL`／`EXECUTED` 记入活动账本，action 前缀 `telemetry.`。**导入不授权任何动作**；外审模型的 behaviorHistory 投影只见动作名与摘要，属性原文留在本地账本（防第三方 span 成为注入面）。
5. 账本容量上限 500 条（`ACTIVITY_LIMIT` 422），防止导入无界增长。

## 复验结果（2026-10-07，本机 TEST_TRANSPORT）

- 新增 `tests/integration/guard-telemetry.test.ts` 3 项：导出含 BLOCKED 决定的 span（含 error 状态与摘要属性、无原始参数）、第三方导入回写账本并再次导出、导入 payload 校验（400/404）与「原文留本地／投影只摘要」。
- `npm run test:all`：A 48 + 集成 67 全部通过；typecheck 通过。

## 影响与边界

- 第三方执行 Agent 的活动现在可以进外审账本与外审上下文（EXTERNAL 记录），但「把任意第三方 Agent 纳入 Guard 授权保护」仍是 P1：本版只做账本与上下文接入，不为外部 Agent 发放许可。
- pi-telemetry 1.0.4 不做运行时 schema 校验（类型仅编译期），入站校验由本地 zod 承担；两个 schema 版本演进需同步 protocol 文档。
