# B 包配置与信任边界

`npm run dev:init` 生成 `.local/b-demo/` 下三个 demo JSON、两个实例 JSON 和 0600 权限的本地私钥；不会覆盖已有文件。配置由 `--config` 指定，路径相对 JSON 文件解析。运行前检查本地密钥授权和固定区块检查点；两实例的文件与数据库独立，但默认由同一操作者接受同一检查点，不代表独立共识背书。

服务配置字段：`serviceId`、`version`、`endpoint`、`transport`、`source`、`capabilities`、`quoteWei`、`timeoutMs`。`null` 报价不等于免费；`null` 能力范围表示未知，空数组表示不支持。配置是唯一端点白名单；POST 不能引入新的 URL。仅允许无认证参数的 HTTPS 或 loopback HTTP，拒绝重定向。RPC 端点只做实时能力观测，不能冒充签名交付服务。

上下文字段沿用 `VerificationContext`，运行时补入 `mode/evaluatedAt/timeSource/consumedRequestIds`。`contexts[].historicalEvaluationTime` 可由操作者显式固定旧包的评估时间；默认首次导入使用本机时钟，之后可使用本机已记录的复验时间。过期旧包需要操作者自行接受历史时间策略，API 不接受包自带的授权或时间。更新 key bindings、撤销或检查点后重启；旧证据在选用前重新核验，不缓存为永久可信。

`host` 固定为 `127.0.0.1`，默认端口 3001/3002；demo 为 14301–14303。调整端口时同时调整后端服务 endpoints。每个实例 `dataDir` 必须不同；其中有 SQLite、writer.sqlite 独占锁 和 evidence/。`historyMaxAgeMs` 默认一天，最大 30 天；最近明确不支持的相同账户／区块／版本能力记录五分钟后过期。

`publicationAdapter=not_configured` 是默认值。`test_failure` 仅供进程内集成测试注入，明确返回测试失败，不能产生链上成功。没有公网上链写接口。

完整 schema 见 `apps/server/src/config.ts` 与 `services/demo/src/index.ts`；JSON 实例由 `scripts/dev/setup.mjs` 生成，所以无私钥静态模板不会误导为可直接运行的密钥配置。Node SQLite 在固定 Node 22 版本中仍有 experimental 提示。

可选 `rpcObservationOrigin` 指定 `{observerId,region,networkProfile,provenance:'OPERATOR_CONFIGURED'}`，region／networkProfile 可为 null。只标记本机 RPC 观测来源；不从 Agent 请求接受，不认证地理位置，不进入签名证据。未配置时省略；标签不能包含 URL、空格或其他秘密。部署者应填写真实已知信息，未知就留 null；示例与分组含义见 [出海场景](../docs/16-Agent工具与出海验收.md)。

可选 `agent` 配置由 `npm run pi:configure` 生成，包括 baseURL、modelId、apiKeyEnv、调用上限与复验目标。只写环境变量名，真实密钥由服务器进程环境提供。默认初始化仍不自动配置模型。配置字段及真实联调命令见 [PI 说明](../docs/15-PI接入与复验.md)。

PI 默认 requestTimeoutMs=90000、firstEventTimeoutMs=60000、streamIdleTimeoutMs=15000；GLM 配置脚本默认 maxInputChars=64000。三项请求限制叠加，并受任务总预算取消控制。显式旧值保留，更新方式见 [超时适配](../docs/18-模型超时适配与复验.md)。

## 钱包签名前审查（实验入口）

`npm run dev:init` 会在两个本地实例配置中加入可选 `wallet` 段。运行前由操作者在后端进程环境设置 `VERDICT_WALLET_RPC_URL`；该值只接受无认证参数的 HTTPS RPC，或 loopback HTTP，不写入 JSON、浏览器或证据。还必须配置独立 `guard` 审查模型，才能显示可用。

钱包页只支持本页发起的普通原生币转账：浏览器通过 EIP-6963／注入 provider 读取账户和链，服务器检查明确意图、账户／链／收款人／金额／费用、nonce、余额、代码、`eth_call`、`eth_estimateGas`，然后由 PI 读取这些实际检查结果并提交 ALLOW/BLOCK/UNCERTAIN。服务器不持有私钥，也不广播交易；浏览器在一次性、短时许可消费后调用钱包的 `eth_sendTransaction`。账户、链、交易参数或预执行状态变化会使许可失效。

合约调用、ERC-20 授权、permit、批量操作和第三方 DApp 交易暂不放行；预执行通过不保证未来链上状态或合约安全。测试网／主网 RPC、钱包连接和任何交易广播需由操作者自行授权。


BOT Chain 测试网可用独立本地配置覆盖主网示例：`npm run wallet:configure-network -- .local/botchain-testnet/local-one.json bot-testnet`。它写入 chainId `0x3c8`、`https://rpc.bohr.life` 对应的环境变量名和低额上限；测试网 tBOT 从官方 Faucet 领取，私钥继续留在浏览器钱包。
