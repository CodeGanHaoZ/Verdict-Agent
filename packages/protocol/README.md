# @verdict/protocol

A 包共享协议已实现。版本：schemaVersion `1.0.0`、ruleVersion `eth-account-v1`。

公开入口导出请求、响应、可信上下文、检查行、验收结果、证据正文、manifest、复验结果的 Zod schema 和 TypeScript 类型，以及三态、归属、生命周期和原因码枚举。B/C 应复用这些定义，不复制类型。

`canonical_json` 固定 RFC 8785 序列化，`parse_json_strict` 拒绝重复键、注释、非法 Unicode、不安全数值及过大输入。协议包没有网络、数据库、私钥或密码学执行。

在根目录运行 `npm run typecheck` 和 `npm test`。输入格式、示例命令与兼容边界见 [A 包说明](../../docs/11-A包实现与复验.md)。B 已以增量方式导出 Candidate、RunSnapshot、ReplaySnapshot、Observation、Publication 及创建任务／导入 schema，API_VERSION 为 1.0.0；A 的既有 schema、枚举与验收语义未改变。具体业务字段及 HTTP 请求见 [B 实现](../../docs/13-B包实现与复验.md)。

新增 `AgentToolArguments`、`AgentToolCallSchema` 和 `AgentToolCall`，统一八个函数工具参数；服务端从同一 schema 生成 JSON Schema。`ObservationOriginSchema` 是观测／指标的可选增量，默认不输出；启用时 B/C 须同步共享包，旧严格解析器不接受新增字段。该变更不修改 A 的证据、请求、签名域或规则版本，见 [兼容说明](../../docs/16-Agent工具与出海验收.md)。
