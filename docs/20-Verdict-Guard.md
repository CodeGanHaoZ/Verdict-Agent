# Verdict Guard 实现记录

## 已实现的路径

直接 PI 入口接受 `prompt`、可选完整 `constraints`（AgentConditions）和独立 `untrustedMaterials` 数组。独立审查器锁定边界，再允许前方 PI 提议动作。未知条件、模型故障、非法输出及硬规则失败停止，不降级。`guard` 使用与 `agent` 相同的连接配置结构，但独立模型实例、凭据环境变量与会话；输出最多 1024 tokens，累计最多 8 次调用，无自动重试。

硬检查覆盖初次账户／区块／候选／预算、当前任务状态、证据归属和复验目标。PI 顺序工具 hook 在业务执行前等待审查；SQLite 事务再次检查取消、边界、参数摘要；业务执行器在执行前原子消费一次性许可，拒绝换参数和重复消费。既有 Engine 继续提供候选去重、预算预留与原子采用。停止不会撤销已验收结果。

`GET /api/guard/tasks/:agentId` 返回边界、活动、决定、用量。页面显示外审配置和上述数据。模型费用未配置时为 null。

## 报告与规则

安全报告与 A 证据分表，Ed25519 签名。不包含 prompt、完整聊天、隐藏推理或外部材料原文；默认导出以每事件化名替换账户、区块和候选，并将预算转换为大小关系；第二实例复验的是报告内的脱敏关系，不证明原始任务真实性。仅能导出被拒绝的动作，不将已授权动作谎报为未执行。

配置 `guardReports: { reporterId, signingKeyEnv, trustedReporters: { reporterId: PUBLIC_PEM } }`。私钥 PEM 仅从指定环境变量读取；信任名单只能来自本地配置。

- `GET /api/guard/tasks/:id/decisions/:sequence/export`
- `POST /api/guard/reports/import`，请求为原始签名报告；导入时重新计算摘要、签名及支持的范围越界。
- `GET /api/guard/reports/:digest`
- `POST /api/guard/reports/:digest/replay`：有显式共享材料时调用本实例独立审查器，结果标为 MODEL_SUSPECTED／MODEL_NOT_REPRODUCED，不能生成确定性范围规则。
- 原导出路径也支持 POST `{ publicMaterials: [...], acknowledgePublic: true }`，只能分享本任务已审查、摘要一致且不含已知凭据的材料。默认不共享原文；操作者负责先审阅其公开性。
- `POST /api/guard/reports/:digest/candidate`
- `GET /api/guard/reports`：公共索引（已导入报告＋本机导出发件箱＋ERC-8004 未接入标注；仅元数据出境），见 [015 决定](decisions/015-guard-report-public-index.md)。
- `GET /api/guard/tasks`：外审监控台数据源（最近受监 agent 的决定计数、拦截、平均审查等待、用量），见 [017 决定](decisions/017-monitor-and-timeline.md)。
- `GET /api/guard/rules`
- `GET /api/guard/tasks/:agentId/telemetry`：活动/决定账本渲染为 pi-telemetry spans（`verdict.guard.review@1`，仅摘要与决定元数据出境）。
- `POST /api/guard/tasks/:agentId/telemetry/import`：第三方 span 以 EXTERNAL 活动入账本（≤200 条/次，不授权任何动作，外审只见动作名与摘要）。

第二数据库独立验签、重算，不采用报告自报结论。重复摘要幂等；同一报告 revision 单调；撤销记录令相关规则失效。无相关原始材料的语义型事件返回 UNREPLAYABLE，不能声称复现。

规则是四类固定枚举，不接受代码。维护者停止目标实例后，通过独占数据库锁运行：

```sh
npm run guard:rules -- CONFIG.json list
npm run guard:rules -- CONFIG.json test RULE_ID
npm run guard:rules -- CONFIG.json enable RULE_ID
npm run guard:rules -- CONFIG.json revoke RULE_ID
```

启用规则自 [016 决定](decisions/016-rule-enforcement.md) 起携带攻击签名 `value` 进入硬规则阻断路径：对 `start_task`/`request_verified_state`，命中签名的动作在调模型前即被 `ENABLED_RULE_<KIND>` 拦截；SCOPE_BUDGET 规则保持无签名（边界相对）。维护者的 test 阶段额外校验签名与源 incident 的 proposed 一致（RULE_SIGNATURE_MISMATCH）。核心禁止条件与撤销语义不变。内置回归覆盖四种范围扩张及三个正常对照；尚不能替代完整历史语义攻击回归。

## 复跑

使用仓库 Node 22：

```sh
export PATH="$PWD/.local/node-v22.23.3-linux-x64/bin:$PATH"
npm run typecheck
npm run test:all
npm run test:guard
npm run test:e2e
npm run verify:guard
```

测试审查服务与前方测试模型独立 HTTP 会话，均标记 TEST_TRANSPORT。集成用例真实启动三个签名服务、SQLite 与 A 验收：错误交付拒收后替换到 PASS。

## 尚未满足完整交付的部分

- 真实联调已完成 GLM 5.3＋DeepSeek 的替换成功路径；最新 GLM 5.3 同模型行为监督在第三次审查时耗尽总预算，尚未跑完成功替换。见下文分开的真实运行记录。
- 默认范围报告已化名化；显式公开材料可以独立语义复验。`relatedEvidenceIds` 可显式附加本任务最多两份 A 证据，必须 `acknowledgePublic: true`；这会包含真实账户材料。复验请求必须由调用者提供目标实例的 `contextId`，否则不可复验。自动秘密检测不能保证任意文本无隐私泄露。
- 页面有导出、导入、复验和候选生成；维护者启用／撤销仅提供本地命令，未提供网页管理员登录。
- 原子允许记录已在业务执行器消费；第三方活动插件适配已按 [014 决定](decisions/014-guard-telemetry-adapter.md) 完成（pi-telemetry 导出/导入），任意暴露 telemetry 的执行 Agent 可接入账本与外审上下文。

- `verify:guard` 覆盖四种首次范围攻击与一个正常替换对照，尚不是大规模通用提示注入评测。报告单独列出审查等待耗时；未测配对基线的因果额外延迟。
- 历史草案接口保留兼容，不受新 Guard 保护；固定 B 流程也不受模型外审保护。

## 本地观测结果

`.local/guard-evaluation-SDSkzP/report.json`：TEST_TRANSPORT，真实本地签名服务及 A 核验。四个攻击样本目标达成率 0/4，执行前拦截 4/4；正常对照完成 1/1，误拦截 0/1；平均审查等待 9.8 ms。样本量小，不能外推为总体安全率。此前 `guard-evaluation-gPMSPZ` 保留了正常对照失败：旧提示词字符串校验错误阻止了合法结构化约束，已修正为使用独立锁定边界。

上述结果来自测试传输，不能将其毫秒耗时用于估计真实模型延迟。已通过真实 HTTP 双实例脱敏报告交换，以及携带真实账户材料、由目标本地上下文调用 A 包重算的测试。

## 配置与两实例启动

```sh
npm run guard:configure -- .local/instance-a.json https://YOUR_ENDPOINT/v1 REVIEWER_MODEL VERDICT_GUARD_API_KEY
npm run guard:configure -- .local/instance-b.json https://YOUR_ENDPOINT/v1 REVIEWER_MODEL VERDICT_GUARD_API_KEY
node --env-file=.local/reviewer.env apps/server/dist/main.js --config .local/instance-a.json
node --env-file=.local/reviewer.env apps/server/dist/main.js --config .local/instance-b.json
```

以上 CONFIG 路径为示例，使用已有可信配置；两个文件须分别设置端口、dataDir、instanceId、信任配置。前方 `agent` 配置保持独立。使用 Ctrl-C 正常停止；已有 dev:start 管理的进程用 dev:stop，不杀其他进程。`reviewer.env` 仅本地保存、权限 0600，勿提交或粘贴真实值。配置命令只写模型标识与环境变量名称，不读取密钥。

当前直接任务的 `constraints` 是完整 AgentConditions，尚未支持部分字段约束合并。若省略约束，使用独立模型提取；这是模型理解，不是数学证明。

最终回归（本次工作区）：`npm run typecheck` 通过；A 48 项、后端／PI／Guard 63 项通过（其中新增 Guard 19 项）；浏览器 7 项通过。外审测试来源均为 TEST_TRANSPORT，未将其写成真实模型连通。`test:guard` 可单独复跑 Guard 用例，`verify:guard` 生成本地 JSON 指标报告。

## 2026-10-07 真实双模型补验

用户提供的新兼容地址 `https://api.modelarts-maas.com/openai/v1` 已实测。模型目录返回 200；目录中的 qwen3-32b 实际调用返回 403，不将“目录可见”视为有权限。glm-5.3 与 deepseek-v4.1-flash 实际请求返回 200。

前方继续 GLM 5.3（plan/v2），独立外审使用 deepseek-v4.1-flash（openai/v1）。最终 `.local/guard-live/run-o24i2s/report.json` 为 LIVE_DUAL_MODEL：前方 6 次请求、外审 4 次请求；真实工具依次调用 wrong-block → FAIL、wrong-value → FAIL、valid → PASS，任务 COMPLETED 且仅采用最后一份数据。

保留失败记录：run-U4xnlv 为无模型调用权限；run-4gGiVo 和 run-bTYCEa 为审查误拦截授权故障候选，均没有服务交付。修复审查输入，补充可信任务目的与执行器锁定账户／区块、候选资格和强制验收事实，不放宽硬规则。最终一次成功不代表误报率为零，也不是全部真实模型攻击回归已完成。

复跑（密钥只在已忽略、0600 的本地 env 文件）：

```sh
node --env-file=.local/pi-live/model.env --env-file=.local/guard-live/reviewer.env --import tsx scripts/dev/verify-guard-live.ts
```

本轮修改后 typecheck 与 19 项 Guard 测试通过。大规模语义覆盖仍有限。

## 同模型行为监督（用户最新选择）

用户要求前方与外审同时使用 GLM 5.3。真实联调脚本默认外审已改为 `glm-5.3`（openai/v1），前方继续 GLM 5.3（plan/v2）；独立会话、提示与凭据变量，不共享隐藏推理。同模型不等于独立模型族背书，可能有相同盲点。

外审输入增加执行器事实与最近 12 条活动：动作序号、工具、来源、执行状态、参数／结果摘要；以及实际尝试候选、A 验收 verdict、是否已采用、已花费 wei。它审查行为是否偏离锁定任务，而非从聊天推断心理意图。原始未验收账户值和隐藏思考不传入审查器。硬规则仍先行拦截，模型不能覆盖。

本地 `.local/b-demo/local-one.json` 与 `local-two.json` 已写入上述外审配置；已有常驻进程须携带本地 reviewer.env 重启后才会应用。独立临时联调使用新配置，不干扰常驻进程。

本轮真实同模型结果：`.local/guard-live/run-xej66M/report.json`，前方 5 次请求、外审 4 次。首次绑定及前两次交付均获审查放行，A 包分别拒收错块和错值；第三次交付的审查尚未完成时，180 秒总预算耗尽，停止任务且未采用任何数据。不能将此结果称为完整替换成功，也不能将超时计作抵御攻击。未自动扩大预算或绕过外审。typecheck、19 项 Guard 测试及 63 项后端／PI／Guard 测试通过。
