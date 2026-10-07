# 钱包活动图与 BOT Chain 测试网观察

本轮仅扩展后端、共享协议、集成测试及文档。前端可消费新增接口；没有修改网页图组件或替钱包提交交易，也没有创建 PR。

## 事件与来源

沿用 `AgentGraphEvent` 的 `graphVersion=1.0.0`，新增可选字段，旧样本继续有效。钱包输出保证包含 `traceId`、`graphRunId`、`walletReviewId`、`sequence`、`parentEventId`、`eventType`、`stage`、`status`、ISO `timestamp`、`argumentsDigest`、`resultDigest`、`source`、`chainId`。适用时附带区块和 `evidenceRef`；`at` 与 `timestamp` 相同。

| eventType | 阶段与含义 |
| --- | --- |
| wallet.review.created | TRANSACTION_INTENT / LOCKED：锁定调用者提交的交易与意图，不证明浏览器已完成钱包认证 |
| wallet.balance.observed | BALANCE_OBSERVATION、NONCE_OBSERVATION / OBSERVED：已获取并解析 RPC 数量 |
| wallet.policy.checked | HARD_RULE / PASSED 或 BLOCK：确定性边界；不调用 PI 越过硬限制 |
| wallet.preflight.completed | RPC_PREFLIGHT / PASSED 或 UNCERTAIN：RPC 预执行观察，非 A 包验收 |
| wallet.guard.reviewed | PI_REVIEW / ALLOW、BLOCK、UNCERTAIN；ALLOW 后另记 PERMIT / WAITING_SIGNATURE |
| wallet.permit.consumed | PERMIT / CONSUMED：持久化消费许可，与记录同一事务，不表示已签名／广播 |
| wallet.broadcast.reported | BROADCAST / PENDING：钱包只报哈希；RPC 校验一致后 BROADCAST；错误为 BLOCK 或 UNKNOWN |
| wallet.receipt.observed | RECEIPT / RECEIPT_CONFIRMED、RECEIPT_FAILED、UNKNOWN 或 BLOCK |
| wallet.post_state.checked | POST_STATE / POST_STATE_RECHECKED 或 UNKNOWN：实测前后余额与 nonce 差值 |
| wallet.evidence.saved | EVIDENCE / SAVED：私有内容寻址观察包已保存，不是数据采用或上链 |
| wallet.evidence.replayed | EVIDENCE_REPLAY / OBSERVED、BLOCK、UNVERIFIABLE：本地证据包重算的结果，不恢复或授予许可 |
| wallet.review.stopped | CANCELLED、INTERRUPTED、UNCERTAIN：取消、重启或许可复查失败 |

`source` 仅为 USER / WALLET / RPC / DETERMINISTIC / PI。`observationKind` 使用 RPC_OBSERVATION / RECEIPT_CONFIRMED / POST_STATE_RECHECKED，`observationSource` 单独区分 LIVE / TEST_TRANSPORT；模型来源继续使用 `modelSource`。receipt status=0 表示已观察到执行失败，不能显示成功。

公共图不含账户地址、交易哈希原文、金额、完整 calldata、原始 RPC 错误、模型 reason 原文、提示或聊天。PI 返回的自由原因文本不持久化，图中使用固定的 PI_ALLOW / PI_BLOCK / PI_UNCERTAIN。地址和参数进入摘要，而不是显示为公开身份；摘要不是匿名性证明。区块号和哈希是公开关联元数据。

创建审查时可选 `traceId`、`parentAgentId`、`graphRunId` 均为 UUID。未提供 trace/graph ID 时后端生成。父 Agent 必须存在；同时指定父 Agent 和 graphRunId 时，后者必须等于父 Agent 已绑定的 runId。该关联只用于跟踪，不授予交易权限。重复 `clientRequestId` 的完整输入必须相同，否则 409；重发不产生新的审查、图或外部调用。旧记录不猜测补图。

## 数据与原子边界

SQLite `wallet_graph_tasks`、`wallet_graph_events` 独立保存序号、稳定阶段 actionId 和显式父事件，不依赖 observer outbox；可选观测 sink 只接收相同的白名单投影。钱包序号属于本钱包审查，不混入父 Agent 的序号空间。

创建审查与图入口、许可消费与对应事件分别原子提交。交易哈希在 `wallet_tx_claims` 中全局唯一，每审查只绑定一个哈希。并发相同回报共享一次查询；重复 POST 返回已有状态。BLOCK、UNCERTAIN、未消费许可、未配置 BOT 测试网均拒绝回报。服务端没有任何签名或广播 RPC。

回报仅接受 txHash，其他字段（例如 status、blockNumber、from、成功说明）直接 400。服务端从本地配置的 RPC 查询链、交易、receipt、区块，检查：

- RPC 链必须是 `0x3c8`；RPC 返回交易 chainId 若有必须一致。
- hash、from、to、value、nonce、gas、EIP-1559 费用字段与已消费 preparedTransaction 一致；input 必须为空，拒绝额外授权列表和 accessList。
- receipt 的 transactionHash/from/to、区块号和哈希与交易一致；status 只接受 0/1；gasUsed 不得超过预审 gas。
- receipt 所在区块晚于预执行快照，前后区块查询哈希一致；原快照也重新核对，不能接纳另一笔旧交易。

缺交易、缺 receipt、RPC 超时、无效返回为 UNKNOWN，不保存成功证据。receipt 成功而后状态读取失败时保留真实 receipt 观察，同时 postStateStatus=UNKNOWN，无 postState/evidenceRef；不能把未完成的对照显示为全部完成。

完成后观察包以 digest 为文件名写入 `<dataDir>/wallet-evidence/`（目录 0700、文件 0600），索引为 `wallet_evidence`。它不进入 A 包 `evidence` 表或发布队列。进程重启不续跑审查、许可或 receipt 查询；未完成审查变 INTERRUPTED，挂起的回报变 UNKNOWN。已消费许可不会被复活。

## API

现有 `POST /api/wallet/reviews`、GET 审查、consume、cancel 均保持兼容。

```http
POST /api/wallet/reviews/:reviewId/broadcast
Content-Type: application/json

{"txHash":"0x...64位小写十六进制..."}
```

200 返回本地 `WalletReview`，分别包含 `receiptReport`、可选 `postState` 和 `evidenceRef`。200 不代表 receipt 成功；确定性不匹配返回 409，同时图保留拒绝原因。

```http
GET /api/wallet/reviews/:reviewId/graph?after=0&limit=200
```

`WalletGraphPage` 扩展原分页结构：graphVersion / agentId / available / events / nextCursor / hasMore / task，并附带 walletReviewId / traceId / parentAgentId / graphRunId / status / receiptStatus。现有 `AgentGraphPageSchema` 可以解析。`after` 是非负安全整数，limit 为 1–200。事件依序补拉，重复响应按 walletReviewId＋sequence 去重。`task.adoptedEvidenceId` 始终为 null；完整观察链完成才是 COMPLETED。旧钱包任务返回 available=false。

```http
POST /api/wallet/reviews/:reviewId/receipt/recheck
Content-Type: application/json

{}
```

对 UNKNOWN 或未完成后状态的回报显式重试只读查询，继续使用原哈希；普通重复 broadcast 不隐式重查。确定性拒绝或已有完整证据返回已保存结果。已有证据的后续链状态／重组检查应使用独立 replay。

```http
GET /api/wallet/evidence/:evidenceRef
POST /api/wallet/evidence/replay
Content-Type: application/json

{"packet":{"evidenceRef":"0x...","body":{...原始本地观察包...}}}
```

证据下载是**本地私有**接口，包含账户与数量，不能将其贴入公共图。第二实例接收显式传入的包，重新验结构、摘要，并从自己的 RPC 读取交易、receipt、历史前后余额与 nonce；重算 delta 后比较，返回 MATCH / MISMATCH / UNKNOWN。未知本地网络配置直接拒绝。`reviewAndPermit=NOT_REPLAYED` 明确不证明第一实例 PI 审查或消费日志真实性；无来源签名，不证明报告者身份。修改包但不修改摘要被完整性检查发现，重新计算摘要的伪造值也须与独立 RPC 相符。

## 独立 BOT 测试网实例

使用 Node 22.23.3。在新的 `.local` 目录初始化，避免修改运行中的 Ethereum 实例：

```sh
npm run dev:init -- .local/bot-graph
npm run wallet:configure-network -- .local/bot-graph/local-one.json bot-testnet
npm run wallet:configure-network -- .local/bot-graph/local-two.json bot-testnet
# 在这两个本地配置中分别指定空闲端口、独立 dataDir、实例名和 guard。
# 例如 3301、3302；不要沿用正在占用的 3001、3002。
# RPC 通过本地环境注入，值不进入仓库或图事件。
export VERDICT_WALLET_RPC_URL='https://YOUR_BOT_TESTNET_RPC'
node --env-file=.local/reviewer.env apps/server/dist/main.js --config .local/bot-graph/local-one.json
# 另一个终端同样显式加载 RPC/模型环境，启动 local-two.json。
```

BOT Chain 测试网：chainId=968、chainIdHex=0x3c8、nativeSymbol=tBOT。Ethereum 主网配置不变；仅测试网配置启用新增 receipt 流程。`wallet.observationSource` 默认 LIVE；隔离 RPC 测试替身必须标记 TEST_TRANSPORT。

## 验证与局限

新增 `tests/integration/graph-wallet.test.ts`：真实 HTTP 后端、SQLite、PI 工具循环，使用明确标为 TEST_TRANSPORT 的本地 RPC 和模型服务器。测试不会请求私钥或广播任何交易。冻结 A 样本仍由原测试使用，不混入 BOT 证据。

```sh
npm run typecheck
npm run test:b
npm run test:e2e
npm run test:graph
npm run test:guard
npm test
```

这些测试验证代码的路径与约束，不能声称真实 BOT 网络 receipt 或真实钱包签名联调已经完成。余额 delta 是两个区块状态之间的观察，可能包含同期其他交易、费用、收入或自转账，不等于单笔交易因果证明；例子的 recipient delta 故意不等于单次转账 value。receipt 确认仅指配置 RPC 返回的区块包含关系，没有独立共识／状态证明、多确认最终性、合约安全或主网部署含义。

首版仍只支持原生币、空 calldata 和 EIP-1559 交易。RPC 不返回所需交易费用或历史字段时不可复验。图 API 本地只读，私有证据下载沿用 loopback/Host/Origin 边界，不提供多租户授权。现有网页尚未自动回报钱包 txHash 或渲染钱包专有 stage，这是本轮按要求留给前端的接线点。

### 本轮实际测试结果（2026-10-07）

Node 22.23.3 下：typecheck 通过；test:b 99 项、test:e2e 10 项、test:graph 31 项（旧图 12＋钱包 19）、test:guard 19 项、npm test 48 项全部通过。图与 Guard 专项已包含于后端 99 项中，不能叠加作为独立样本总数。

钱包 19 项覆盖正常顺序和分页、硬规则停止、PI BLOCK/UNCERTAIN、并发与幂等、trace/父任务锁定、六种交易字段替换、receipt 哈希／状态／区块不匹配、缺交易／receipt／超时、失败 receipt、后状态读取失败、余额及 nonce 实际 delta、公共输出脱敏、重启／取消、旧任务无图、双实例复验、未改摘要和重新计算摘要的篡改、历史 RPC 不可用。原浏览器测试仍为 10 项，本轮未增加网页组件验收。

本轮未向 BOT 测试网发送交易，也未把隔离 RPC 样本标为 LIVE。测试证据目录由 fixture 在系统临时目录生成，未写入 Git；独立实例之间不共享数据库、证据目录或结果缓存。
