# 016 规则增强真生效（FR-G05）

2026-10-07。对应 [21-模型外审产品PRD](../21-模型外审产品PRD.md) 的 FR-G05。状态：已实现并通过回归。

## 决定

1. **候选规则携带攻击签名 `value`**（protocol `RuleCandidateSchema` 新增可空 `value` 字段，旧库记录兼容）：`candidate()` 从 REPRODUCED incident 的 `proposed` 中提取被注入的具体值——SCOPE_ACCOUNT→提议账户、SCOPE_BLOCK→提议区块、SCOPE_CANDIDATES→越界候选 id；SCOPE_BUDGET 保持无签名（预算滥用相对各实例边界，硬规则本就拦截）。
2. **启用规则进入硬规则阻断路径**：`Guard.authorize` 在调用方 hardCheck 之后追加 `ruleHit`（初次与事务复查两处），命中即 `BLOCK`（reasonCode=`ENABLED_RULE_<KIND>`）且**不调模型**；`request_verified_state` 与 `start_task` 均受检。停用/撤销后同一动作恢复放行。
3. **`maintain` 的 test 阶段增加签名一致性校验**：value 规则必须能匹配其源 incident 自己的 proposed 参数（`RULE_SIGNATURE_MISMATCH` 409），否则不可进入 TESTED/ENABLED。既有边界回归（attacks/blocked/controls/falseBlocks）不变。
4. **安全边界不变**：规则仍限四类固定枚举、不接受代码；启用/撤销仍仅限维护者本地 `guard:rules`（独占数据库锁），模型与网页不可启用；撤销令规则失效、历史报告保留。

## 复验结果（2026-10-07，本机 TEST_TRANSPORT）

- 新增端到端测试（AC-G09）：导入他实例 SCOPE_CANDIDATES 事件（签名=demo-valid）→ REPRODUCED → 候选/测试/启用 → 本实例自身边界**允许** demo-valid 的任务在 `request_verified_state('demo-valid')` 处被 `ENABLED_RULE_SCOPE_CANDIDATES` 硬拦（该调用未经模型审查、无采用）→ 撤销规则（revision 2 REVOKED）→ 同一约束的任务完整跑通 demo-valid 并 PASS 采用。
- `npm run test:all`：A 48 + 集成 69 全部通过；typecheck 通过。
- 测试基建：`test:b` 改为 `--test-concurrency=1` 串行运行——并行套件在本机双核沙箱下使时序敏感用例（真实多进程服务器 + 墙钟预算）出现非确定性抖动；串行后确定性全绿，速度代价可接受。
