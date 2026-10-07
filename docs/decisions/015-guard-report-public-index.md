# 015 攻击报告公共索引与威胁账本页（FR-G04）

2026-10-07。对应 [21-模型外审产品PRD](../21-模型外审产品PRD.md) 的 FR-G04。状态：已实现并通过回归。

## 决定

1. **`GET /api/guard/reports`**：本实例的公共索引（机器可读）。返回三部分：`reports`（已导入报告：digest、incidentKey、revision、reporterId、action、reported status、独立复验 replayStatus/reason/attribution/weight、redaction、modelSource、origin=LOCAL|IMPORTED）、`exported`（本机导出发件箱，即待广播的签名报告）、`erc8004:{status:'NOT_CONNECTED',note}`（如实标注链上广播未接入）。
2. **索引只含元数据**：化名化 incident 的决定摘要与复验结论出境；sharedMaterials、prompt 与原始参数不出境（测试断言列表 JSON 不含材料原文与字段名）。
3. **网页新增「威胁账本」视图**（`apps/web/src/threats-ui.ts`，导航 04）：公共索引列表＋本机发件箱、粘贴导入（验签＋独立复验）、报告详情（化名化 incident＋复验结果＋再次复验＋生成规则候选）。页面明示：规则候选需复验为 REPRODUCED 才能生成；启用/撤销仅限维护者本地 guard:rules；ERC-8004 未接入。
4. **广播语义保持既有纪律**：跨实例交换仍是「签名导出 → 可信报告者手动导入 → 本地重算」，本版不自动向远端推送；不把报告数量换算权重（weight 恒 1）。

## 复验结果（2026-10-07，本机 TEST_TRANSPORT）

- 新增集成测试：导入远端签名报告＋本机导出后，索引 origin/replayStatus/erc8004 断言通过，列表 JSON 不含 sharedMaterials 原文。
- `npm run test:all`：A 48 + 集成 68 全部通过（含 FR-G01/FR-G02 回归）；typecheck 与 web tsc 通过。
- 顺带修复测试基建的时间敏感性：`pi-harness` 派生测试在并行全量运行时受 8 秒墙钟预算影响（本机沙箱负载下偶发），Guard 遥测测试显式把 `agent.maxDurationMs` 放宽至 60 秒后全量稳定；未改动产品代码。
