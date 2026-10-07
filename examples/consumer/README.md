# 最小消费方

启动 B 服务后运行：

```bash
npm run example:b -- http://127.0.0.1:3001 success
npm run example:b -- http://127.0.0.1:3001 fallback
npm run example:b -- http://127.0.0.1:3001 all-fail
```

`consume(base, input)` 提交严格 CreateRun、轮询 RunSnapshot，返回服务器实际结论。调用方仅在 `status=SUCCEEDED && accepted !== null` 时继续依赖该数据；STOPPED/ERROR 要中止依赖。示例使用固定主网账户证明、当前请求有效期和独立 requestId，关闭历史证据以稳定展示替换路径。没有模型、PI、支付或伪造 PASS。

C 可复用 `@verdict/protocol` 的 CreateRunSchema / RunSnapshotSchema，并直接通过相同 HTTP API 消费服务、逐项 checks 和下载链接，见 [接口](../../docs/08-接口约定.md)。

新增 `call_tool(base,{name,arguments})` 与 `guard(base,input)`。后者通过工具 API 提交／查询，同 requestId 幂等恢复，只返回 SUCCEEDED 的 accepted；STOPPED/ERROR 抛出携带实际 run 的 `AcceptanceStopped`，不能继续使用未验数据。宿主自行固定任务要求、可信 contextId、预算与可调工具范围。

已有两个后端时运行 `npm run example:tools -- http://127.0.0.1:3001 http://127.0.0.1:3002`，实际验证所有工具、签名失败后替换、全失败停止、证据下载与第二实例重验。Windows 可用 `npm run verify:local` 一次启动／验证／结束五个隔离进程。没有 LLM SDK 或完整 MCP server；详见 [接入说明](../../docs/16-Agent工具与出海验收.md)。
