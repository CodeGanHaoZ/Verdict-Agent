# 最小消费方

启动 B 服务后运行：

```bash
npm run example:b -- http://127.0.0.1:3001 success
npm run example:b -- http://127.0.0.1:3001 fallback
npm run example:b -- http://127.0.0.1:3001 all-fail
```

`consume(base, input)` 提交严格 CreateRun、轮询 RunSnapshot，返回服务器实际结论。调用方仅在 `status=SUCCEEDED && accepted !== null` 时继续依赖该数据；STOPPED/ERROR 要中止依赖。示例使用固定主网账户证明、当前请求有效期和独立 requestId，关闭历史证据以稳定展示替换路径。没有模型、PI、支付或伪造 PASS。

C 可复用 `@verdict/protocol` 的 CreateRunSchema / RunSnapshotSchema，并直接通过相同 HTTP API 消费服务、逐项 checks 和下载链接，见 [接口](https://github.com/hankesong/Verdict-Agent/blob/materials/docs/08-%E6%8E%A5%E5%8F%A3%E7%BA%A6%E5%AE%9A.md)。
