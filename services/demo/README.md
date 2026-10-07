# 三个真实签名服务

`demo-wrong-block` 使用另一个真实历史区块的头、证明与值；`demo-wrong-value` 在签名前把余额加一；`demo-valid` 返回匹配请求的真实冻结证明。签名通过既有 EIP-712 数据结构执行，错误在签名前注入。前两者标 FAULT_INJECTION，正常冻结样本标 FROZEN，均非 RPC 厂商签名。

```bash
npm run dev:init
npm run demo:service -- --config .local/b-demo/demo-valid.json
```

默认全部服务由 `npm run dev:start` 启动于 14301–14303。支持 `GET /health`、`GET /capabilities`、`POST /deliver`（TaskSpec）。真实证明来自已合入的 26134149 与 24000000 区块样本，当前演示只声明主样本账户／区块范围。

每个服务用独立 SQLite 持久化 requestId＋请求摘要＋签名响应；相同请求复用一次交付，冲突返回 409，崩溃中不确定的旧调用不重新签发。私钥本地生成并留在被忽略的 `.local/`，不写入公开证据。

集成测试显式 `testFaults=true` 才能启用 missing-proof、rate-limit、timeout、unsupported、bad-signature。它们为受控测试服务，不能算真实 RPC 故障。`npm run test:b` 实际通过 HTTP 调用这些模式并执行 A 内核。

异常盲测通过显式 `testFaults=true` 启用错账户／请求／链、过期、缺头／字段、损坏／截断证明、无签名、签后篡改、重复 JSON 键、超大响应和首次错误后修复。`health.received` 统计实际收到的合法交付请求，`generated` 统计已生成签名材料。盲测 ID 采用中性别名，常规三个演示名不变；[配方与来源](../../docs/17-360异常评测.md) 不会发给模型。
