# @verdict/protocol

A 包共享协议已实现。版本：schemaVersion `1.0.0`、ruleVersion `eth-account-v1`。

公开入口导出请求、响应、可信上下文、检查行、验收结果、证据正文、manifest、复验结果的 Zod schema 和 TypeScript 类型，以及三态、归属、生命周期和原因码枚举。B/C 应复用这些定义，不复制类型。

`canonical_json` 固定 RFC 8785 序列化，`parse_json_strict` 拒绝重复键、注释、非法 Unicode、不安全数值及过大输入。协议包没有网络、数据库、私钥或密码学执行。

在根目录运行 `npm run typecheck` 和 `npm test`。输入格式、示例命令与兼容边界见 [A 包说明](../../docs/11-A包实现与复验.md)。Candidate 与 RunSnapshot 的业务字段仍待 B 协作落实；其状态枚举已提供。
