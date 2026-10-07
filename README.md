# Verdict Agent

**Agent 服务验收层：先约定交付要求，逐项验收；不合格就换服务，留下可下载、重跑和引用的证据。**

首个场景为以太坊指定区块的账户状态。目前 **A 验收内核与 B 后端闭环可运行**：选择服务、签名交付、真实核验、错误替换／停止、证据下载、第二实例重验并改善选择。**简易网页已接入真实 API；真实链上存证仍未实现**，发布默认显示 `not_requested`。

A 与测试数据已通过 [PR #1](https://github.com/hankesong/Verdict-Agent/pull/1)、[PR #2](https://github.com/hankesong/Verdict-Agent/pull/2) 合入 main；B 本轮代码和实际命令见 [B 实现与复验](docs/13-B包实现与复验.md)。仓库分支／合并状态以 Git 为准。

新增 [Agent 工具、出海场景、架构与覆盖检查](docs/16-Agent工具与出海验收.md)：八个函数工具及消费端 `guard` 复用实际内核；出海服务商可以用同一验收层控制陌生数据服务风险。地区／网络仅是可用性观测来源，不影响密码学验收。历史材料帮助选择，每次新交付仍须验收。

## 运行与复验

使用 `.nvmrc` 指定的 **Node 22.23.3 / npm 10.9.9**，在仓库根目录运行：

Windows 或首次验收可直接执行下列命令，自动启动并结束本次五个进程、使用临时端口、保留独立证据（已在 Windows 实测）：

```bash
npm ci --ignore-scripts
npm run typecheck
npm run test:all
npm run verify:local
```

Linux 持续演示与可选公共 RPC 观测：

```bash
npm ci --ignore-scripts
npm run typecheck
npm run test:all
npm run dev:init
npm run dev:start
# 另一个终端运行 npm run web，打开 http://127.0.0.1:5173
npm run example:b -- http://127.0.0.1:3001 fallback
npm run example:b -- http://127.0.0.1:3001 all-fail
npm run verify:b
npm run observe:b
npm run dev:stop
```

三个签名服务运行于 14301–14303，两个后端运行于 [localhost:3001](http://127.0.0.1:3001/api/meta)／[localhost:3002](http://127.0.0.1:3002/api/meta)。`verify:b` 实际运行签名错块／错值拒收、替换成功、全失败停止、原包导出／导入、第二进程重算、固定输入下历史证据开关的排序对照及新交付再验收。

配置、0600 权限的演示密钥、独立 DB、证据及日志保存在被忽略的 `.local/`；初始化保留已有配置，停止保留运行记录，不占用或结束他人的进程。第一次运行需审阅生成配置中的检查点和密钥授权。完整配置、前台启动、API 请求示例和第二实例单独命令见 [B 说明](docs/13-B包实现与复验.md)、[配置](config/README.md)、[启动脚本](scripts/dev/README.md)。统一进程管理在 Linux 验证；其他平台可运行各自的前台入口。

签名服务使用真实冻结证明，故障在签名前注入，明确标为 FAULT_INJECTION；正常服务标 FROZEN。签名属于本地适配器，不属于 RPC 厂商。`observe:b` 单独采集真实 LIVE RPC 观测并记录支持、未知、限制、延迟，不把网络响应成功当验收 PASS。

保留 A 的独立入口：

```bash
npm test
npm run demo:a
npm run verify -- .local/a-demo/bundle.json --context .local/a-demo/trusted-context.json --json
```

测试可离线执行；依赖安装、可选 `capture:proof` 与 `observe:b` 需要网络。信任配置由调用方接受，证据不能自行授权。未独立验证以太坊共识／最终性，第二进程也不等于独立组织背书。

## 简易前端与 Agent 框架

运行 `npm run web` 打开 [验收工作台](http://127.0.0.1:5173)：提交任务、查看错误替换与逐项检查、浏览服务观测、下载证据、发起第二实例复验和比较历史证据排序。网页使用 TypeScript + Vite，详见 [前端说明](apps/web/README.md)。

底层使用 **PI agent-core / pi-ai 1.0.4** 的真实工具循环。按用户最新要求，输入任务后直接执行，PI 选服务、处理失败并调用复验；网页没有草案确认步骤。共享执行器强制 A 核验、预算和原子采用。**GLM 5.3 真实接口已跑通错误替换至 PASS 与全失败停止**；模型费用未知。配置、实际结果与限制见 [PI 接入与复验](docs/15-PI接入与复验.md)，[10 条场景数据集](fixtures/agent/README.md) 可按固定哈希复跑。

## 已完成

| 模块 | 实际能力 |
| --- | --- |
| A 协议与内核 | schema 1.0.0 / eth-account-v1；区块头、账户存在／不存在证明、字段、EIP-712 签名和授权、请求条件与逐项检查 |
| A 证据与 CLI | JCS＋Keccak 内容摘要、证据构造、独立重算、报告比较、事实分组；[10 个真实账户／区块组合](docs/12-测试数据来源与覆盖.md) |
| B 签名服务 | 三个实际 HTTP 服务；每份交付调用 A 内核；可归属错误拒收，只有本次 PASS 可采用 |
| B 流程与 API | Candidate／RunSnapshot 等共享 schema；能力过滤、多维指标和解释排序；次数／时间／成本预算、替换／停止；并发请求幂等与原子采用 |
| B 存储与复验 | SQLite 索引、原始证据下载、重新核验后导入；篡改／UI_MOCK 拒绝；独立配置与存储的第二后端；适用性及事实去重 |
| B 真实观测 | 两家公共 RPC 的近期与历史探测；LIVE、FROZEN、FAULT_INJECTION 分组；不支持、429、超时、HTTP 错误分开 |
| B 发布边界 | 与 verdict 分离的状态与原子队列；默认未接入，测试失败／幂等重试已验证，无伪造链上成功 |
| B Agent 工具 | 严格工具参数、候选／验收／下载／导入／复验；`guard` 只交付本次 accepted 值，失败停止业务依赖 |
| 简易前端 | 三个实际 API 视图、逐项审计、停止路径、原文件下载、独立复验与真实排序对照；7 条浏览器测试通过（含 PI 流程，模型为测试传输） |
| PI 编排 | 直接接收任务、绑定条件后的六个业务工具、独立模型状态／用量／事件、取消／中断；15 项 PI 集成测试通过，真实模型联调状态见上文 |
| 验证与接力 | A 48 项＋B 26 项＋PI 15 项测试、类型检查、实际五进程演示；函数工具示例、跨平台脚本和双平台 CI（远端结果见 Actions） |

本轮真实观测为 12 个样本：10 OK、1 HTTP 403、1 范围／参数不支持。具体区块、来源、时间与限制见 [运行记录](docs/13-B包实现与复验.md)。这些结果只代表那次采样，不是提供商 SLA 或已验数据承诺。

## 尚未完成与接力

| 状态 | 工作 | 入口／责任 |
| --- | --- | --- |
| 已有简易版，待完善 | 三个真实 API 视图已可运行；历史任务检索、文件上传导入与更完整交互仍可接力 | `apps/web/`，C；[前端说明](docs/14-简易前端.md) |
| 未实现 | C 的存证 adapter、最小合约与本地链测试；无部署地址、真实交易回执或链上确认 | `packages/anchor-client/`、`contracts/evidence-anchor/`，C |
| 部分完成 | B/C 浏览器端到端测试已运行；完整赛事演示、视频、公开运行链接与提交材料仍待补 | `tests/e2e/`、`docs/demo/`，C 统筹 |
| 后续工程 | 公众多租户认证、分布式任务队列、分页／归档、生产部署、更广的动态签名服务适配 | B 后续；当前仅本地单写者、少量服务联调 |
| 待补覆盖 | 精确分叉边界、特殊账户与更多 Trie 向量 | A；[数据待补清单](docs/12-测试数据来源与覆盖.md) |

更多模型适配、完整 SDK/MCP、ERC-8004 身份反馈、支付、复杂信誉／抗女巫聚合、其他任务类型及主网部署仍属后续范围。正式上链交易、网络和费用需具体授权。DAO、反事实调查等候选不混入当前验收审计实现。

简易前端已从 `GET /api/meta` 获取配置入口，`GET /api/services` 获取目录，`POST /api/runs` 提交任务并轮询快照，下载证据后创建复验任务；默认 CORS 允许 localhost/127.0.0.1:5173。后续接入可沿用这些 API。API 与原子性约定见 [接口](docs/08-接口约定.md)。沿用唯一 npm workspace 和锁文件，不重写 A 内核、不另起初始化工程。

## 文档与贡献

[协作约定](AGENTS.md) · [工程结构](docs/09-工程结构.md) · [PRD](docs/02-PRD.md) · [接口](docs/08-接口约定.md) · [A 实现](docs/11-A包实现与复验.md) · [B 实现](docs/13-B包实现与复验.md) · [工作包](docs/07-三人分工.md) · [决策](docs/decisions/README.md)

仓库公开，欢迎查看、Fork、Issue 和 PR；按 [CONTRIBUTING](CONTRIBUTING.md) 与模块规则协作，保留他人的工作。私钥和未审阅运行材料不进版本库。自有代码采用 [MIT](LICENSE)，依赖见 [THIRD_PARTY](THIRD_PARTY.md)。
