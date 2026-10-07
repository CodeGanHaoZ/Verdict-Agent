# 017 外审监控台与审计时间线（FR-G07）

2026-10-07。对应 [21-模型外审产品PRD](../21-模型外审产品PRD.md) 的 FR-G07。状态：已实现并通过回归，**PRD P0 五项全部闭环**。

## 决定

1. **`GET /api/guard/tasks`**：监控台数据源，聚合最近 50 个 agent（`AgentStore.agents()`）与各自 Guard 状态：status/modelStatus/modelId/modelSource/error、guard.status、boundarySource（CALLER|REVIEWER）、activities/decisions/blocked 计数、lastReasonCode、平均审查等待 reviewWaitMs、双方 usage。旧草案流程的 agent 如实显示「未受审」，不伪造结论。
2. **网页新增「外审监控台」视图**（`apps/web/src/monitor-ui.ts`，导航 04；威胁账本顺延为 05）：
   - 列表：受监任务 + 外审状态灯（Guard status）+ 决定/拦截计数 + 平均审查等待 + 传输来源；
   - 审计时间线（点选展开）：逐条活动按「硬规则拦截 / 外审模型拦截 / 放行 / 审查不可用」分色标注（确定性原因码 vs 模型原因码，`HARD_REASON` 前缀区分），并显示一次性许可语义；下方附「交付尝试与 A 验收」（真实 RunSnapshot）与完整事件流折叠（events API）；
   - 策略行如实显示当前固定 fail-closed（审查不可用即停止），fail-open 开关标注「待评审」，不伪装成可切换。
3. 至此三视图齐备：① 外审监控台（本视图）② 审计时间线（本视图详情）③ 威胁账本（FR-G04）。
4. 测试基建：`pi-harness` 默认墙钟预算 8s→30s（agent.maxDurationMs 与草案预算 timeoutMs）——本机双核沙箱并行跑全量时偶发超时抖动，放宽后连续两轮全量 48+70 全绿；仅测试预算，不改变任何断言语义。

## 复验结果（2026-10-07，本机 TEST_TRANSPORT）

- 新增监控台数据源测试：攻击任务被拦后出现在列表中，decisions/blocked/lastReasonCode（SCOPE_account）/reviewWaitMs/boundarySource=CALLER 全部断言。
- `npm run test:all` 连续两轮：A 48 + 集成 70 全部通过；typecheck 与 web tsc 通过。
