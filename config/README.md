# B 包配置与信任边界

`npm run dev:init` 生成 `.local/b-demo/` 下三个 demo JSON、两个实例 JSON 和 0600 权限的本地私钥；不会覆盖已有文件。配置由 `--config` 指定，路径相对 JSON 文件解析。运行前检查本地密钥授权和固定区块检查点；两实例的文件与数据库独立，但默认由同一操作者接受同一检查点，不代表独立共识背书。

服务配置字段：`serviceId`、`version`、`endpoint`、`transport`、`source`、`capabilities`、`quoteWei`、`timeoutMs`。`null` 报价不等于免费；`null` 能力范围表示未知，空数组表示不支持。配置是唯一端点白名单；POST 不能引入新的 URL。仅允许无认证参数的 HTTPS 或 loopback HTTP，拒绝重定向。RPC 端点只做实时能力观测，不能冒充签名交付服务。

上下文字段沿用 `VerificationContext`，运行时补入 `mode/evaluatedAt/timeSource/consumedRequestIds`。`contexts[].historicalEvaluationTime` 可由操作者显式固定旧包的评估时间；默认首次导入使用本机时钟，之后可使用本机已记录的复验时间。过期旧包需要操作者自行接受历史时间策略，API 不接受包自带的授权或时间。更新 key bindings、撤销或检查点后重启；旧证据在选用前重新核验，不缓存为永久可信。

`host` 固定为 `127.0.0.1`，默认端口 3001/3002；demo 为 14301–14303。调整端口时同时调整后端服务 endpoints。每个实例 `dataDir` 必须不同；其中有 SQLite、writer.sqlite 独占锁 和 evidence/。`historyMaxAgeMs` 默认一天，最大 30 天；最近明确不支持的相同账户／区块／版本能力记录五分钟后过期。

`publicationAdapter=not_configured` 是默认值。`test_failure` 仅供进程内集成测试注入，明确返回测试失败，不能产生链上成功。没有公网上链写接口。

完整 schema 见 `apps/server/src/config.ts` 与 `services/demo/src/index.ts`；JSON 实例由 `scripts/dev/setup.mjs` 生成，所以无私钥静态模板不会误导为可直接运行的密钥配置。Node SQLite 在固定 Node 22 版本中仍有 experimental 提示。
