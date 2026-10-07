# Verdict Agent

**Agent 服务验收与证据审计：核对承诺与交付，让判断有据可查。**

首个场景是以太坊指定区块的账户状态。目标流程是选择服务、核验交付、失败替换、共享证据，并让其他实例复验后改善选择。

**接力状态：A 包及第一批扩展测试数据已合入 `main`；B/C 业务功能待实现。** 当前能运行验收库、证据导出和独立复验 CLI，尚无完整后端、网页、自动选服务或链上应用。[PR #1](https://github.com/hankesong/Verdict-Agent/pull/1) 和 [PR #2](https://github.com/hankesong/Verdict-Agent/pull/2) 均已合并。

## 接下来由谁做什么

岗位尚未绑定具体成员，可按下面的工作包认领。先读 [AGENTS.md](AGENTS.md) 和目标目录内的规则，复跑 A 包，再开始自己的模块。

| 接力方向 | 第一批工作 | 交付检查点 |
| --- | --- | --- |
| **B：后端与流程，当前优先** | 在现有 workspace 上新增 server 和三个受控签名服务；调用已有 A 包，串起请求、核验、替换与停止；与 C 对齐 API | 实际错块／错值交付被拒收，换用合格服务后成功；全候选未通过时停止。见 [B 工作包](docs/work-packages/B-服务接入与后端.md) |
| **C：界面与存证，可并行** | 按共享 schema 做服务选择、单次审计、证据复验三个视图；先明确标注 UI_MOCK，随后接 B 的真实 API；再做最小本地存证 | 能展开承诺、交付、证据与未知项；页面结论来自内核，存证状态独立。见 [C 工作包](docs/work-packages/C-审计界面与存证.md) |
| **A：维护与补测** | 支持 B/C 接入现有公开函数；继续补精确分叉边界、特殊账户与 Trie 向量 | 新用例保留来源和预期结果，共享接口变化有版本及兼容说明。见 [数据待补清单](docs/12-测试数据来源与覆盖.md) |

**B/C 无需重做 A 包或重新初始化整个项目。** Node、npm、TypeScript 和锁文件已经固定；根 `package.json` 目前只纳入四个 A 包 workspace。B/C 新建包时补上 manifest 和 workspace 条目，由 B 协调根配置与 `package-lock.json`，避免各自维护另一套锁文件。

## 尚未完成的部分

以下是实际欠缺的实现，不是已经存在但尚未展示的功能。对应目录中的 README／AGENTS.md 仅说明职责。

| 状态 | 待实现内容 | 主要位置／负责人 |
| --- | --- | --- |
| 未实现 | 三个可调用的签名演示服务；当前只有测试／导出脚本中的临时签名适配器 | `services/demo/`，B |
| 未实现 | 服务目录、真实观测模块、多维指标与简单排序；现有一次性 RPC 采集和冻结样本不算该模块完成 | `packages/observations/`、`apps/server/`，B |
| 未实现 | HTTP API、任务状态机、预算内替换／停止、请求消费状态的原子持久化 | `apps/server/`，B |
| 未实现 | SQLite 索引、证据下载服务、公开记录导入、发布队列和实例配置加载 | `apps/server/`、`config/`，B |
| 未实现 | 独立端口／数据库的第二个服务实例，以及“复验历史证据后改变候选顺序”的演示；已有的是 CLI 新进程复验 | B 主责、C 展示 |
| 未实现 | 三个网页视图、真实 API 接线、状态事实卡与可交互审计报告 | `apps/web/`，C |
| 未实现 | 最小存证合约、发布适配器及本地链测试；尚无部署地址、交易记录或链上确认 | `contracts/evidence-anchor/`、`packages/anchor-client/`，C |
| 未实现 | 最小宿主调用示例、统一启动脚本、跨 B/C 集成测试、浏览器端到端测试和 CI 工作流 | `examples/consumer/`、`scripts/dev/`、`tests/integration/`、`tests/e2e/`，B/C |
| 待交付 | 完整产品演示、视频／公开运行链接、部署及赛事提交材料 | `docs/demo/`，C 统筹 |

PI／模型接入、完整 SDK/MCP 分发、ERC-8004 身份与反馈、支付托管、复杂信誉／抗女巫聚合仍是后续范围。BOT 主网网络、费用与交易授权另行落实。DAO、反事实调查等候选不混入这轮验收审计接力。

## 已完成、可以直接复用

| 成果 | 当前能力与入口 |
| --- | --- |
| **共享协议** | `@verdict/protocol`：请求、交付、可信上下文、检查结果、证据、manifest、复验结果的严格 schema／类型与枚举；`schemaVersion=1.0.0`、`ruleVersion=eth-account-v1` |
| **确定性内核** | `@verdict/core`：主网区块头、账户存在／不存在证明、请求／字段、EIP-712 签名及有效授权检查；返回数据、归属及逐项依据 |
| **证据与复验** | `@verdict/evidence`：JCS＋Keccak 摘要、证据构造、报告重算、上下文差异和篡改检测、事实分组函数 |
| **独立 CLI** | `z-verify`：从文件重新执行检查，不依赖第一实例的数据库或结果缓存 |
| **真实测试数据** | [初始样本](fixtures/core/ethereum-mainnet-26134149/README.md)＋[扩展数据集](fixtures/core/mainnet-corpus/README.md)：10 个账户／区块组合，覆盖 6 个区块；包含来源、完整证明、摘要与预期值 |
| **已执行检查** | 类型检查通过；最近一次本地测试 **48 项通过、0 失败、0 跳过**。覆盖错块、错值、签名、缺材料、未知规则、篡改及新进程复验，不代表 B/C 端到端完成 |

B 可直接调用 `verify_delivery(request, delivery, context)`、`request_digest`、`delivery_typed_data`、`build_evidence`、`replay_evidence` 和 `fact_key`；C 消费共享结果类型与 `checks`。签名、参数、返回值及边界见 [A 包接入说明](docs/11-A包实现与复验.md)。

`Candidate`、`RunSnapshot` 等 B 的业务对象仍需结合 [接口约定](docs/08-接口约定.md) 落地；文档里的 HTTP 路由目前只是设计，不能当成已有服务调用。

## 先复跑现有成果

克隆仓库后使用 `.nvmrc` 指定的 **Node 22.23.3 / npm 10.9.9**，在根目录执行：

```bash
git clone https://github.com/hankesong/Verdict-Agent.git
cd Verdict-Agent
npm ci --ignore-scripts
npm run typecheck
npm test
npm run demo:a
npm run verify -- .local/a-demo/bundle.json --context .local/a-demo/trusted-context.json --json
```

最后应看到 `artifactIntegrity: VERIFIED`、`comparison: MATCH` 和重算 `verdict: PASS`。导出的 bundle、manifest 和示例 context 位于被忽略的 `.local/a-demo/`；每次临时签名不同，证据摘要可以变化。

依赖安装需要网络；测试和复验使用已保存材料，可以离线运行。可选的 `npm run capture:proof` 需要 Python 3 和可用 RPC，只负责采集原始材料。当前没有 `npm run dev`、网页启动命令或 server 地址；新增真实命令后再更新 README。

示例签名属于本地适配器，不属于 RPC 厂商。运行者须自行接受区块检查点、密钥和时间策略；不能因为 context 与证据一起收到就信任它。当前没有独立验证以太坊共识／最终性，独立进程也不等于独立组织背书。

## 接力的第一条完整路径

1. **B 接服务**：复用共享签名结构，实现 `demo-wrong-block`、`demo-wrong-value`、`demo-valid`；不要复制一套验收算法。
2. **B 串流程**：请求 → 调用 → A 包验收 → 有界替换／停止 → 证据保存；结果通过 API 交给 C。
3. **C 接结果**：把真实 `checks` 展示成“承诺—交付—证据—结论—处置”，同时显示无签名、缺材料和全部失败。
4. **B/C 做共享复验**：第二实例重算材料，判断适用性，并对照启用／停用历史证据时的候选顺序；每次新交付仍要验收。
5. **C 补存证与演示**：本地存证失败不改变已有核验结果，明确已实现范围，再整理完整交付材料。

认领时在 PR 中说明负责模块、共享接口变化和可复跑命令。完成标准以实际运行结果为准；UI_MOCK、目录、示意图和文字中的路由都不能作为功能完成证据。

## 文档导航

| 入口 | 用途 |
| --- | --- |
| [协作约定](AGENTS.md) · [工程结构](docs/09-工程结构.md) | 文件归属、依赖方向、提交和数据边界 |
| [三人分工](docs/07-三人分工.md) · [开发清单](docs/10-开发启动清单.md) | 认领、交接与联调门槛 |
| [A 包运行与接入](docs/11-A包实现与复验.md) · [接口约定](docs/08-接口约定.md) | 实际可调用函数、schema 与尚待落实的业务 API |
| [测试数据与覆盖](docs/12-测试数据来源与覆盖.md) | 已验证数据、公开上游来源和未覆盖边界 |
| [产品概要](docs/01-产品概要.md) · [PRD](docs/02-PRD.md) · [技术设计](docs/05-技术设计.md) | 产品范围、验收要求与技术理由 |
| [架构图](docs/03-架构设计图.svg) · [交互图](docs/04-交互设计图.svg) | 设计示意，非完整产品运行截图 |
| [融合说明](docs/06-融合说明与来源.md) · [决策索引](docs/decisions/README.md) | 来源、取舍与历史决定 |

## 参与贡献

仓库公开，欢迎查看、Fork、提交 Issue 和 PR。按 [CONTRIBUTING.md](CONTRIBUTING.md) 和模块规则协作；保留其他人的工作，明确选择提交文件。私钥、API 凭据和未审阅运行材料留在本地，正式上链交易与费用需具体授权。

自有代码采用 [MIT License](LICENSE)，依赖保留各自许可证，见 [THIRD_PARTY](THIRD_PARTY.md)。
