# B 后端

已实现真实服务调用、A 包验收、有界替换、SQLite 原子采用、内容寻址证据、导入与第二实例复验、RPC 观测和独立发布状态。默认仅绑定 loopback。公开入口为 `start_server`、`Engine`、`load_server_config`；不会复制内核证明或验签逻辑。

```bash
npm run dev:init
npm run server -- --config .local/b-demo/local-one.json
# 另一个终端；仍需独立启动 demo 服务，或直接使用根目录 npm run dev:start
npm run server -- --config .local/b-demo/local-two.json
```

`src/config.ts` 加载可信策略；`store.ts` 负责 WAL SQLite、内容寻址及原子消费；`engine.ts` 编排真实核验、排序和发布队列；`index.ts` 提供 HTTP API；`main.ts` 提供进程入口。每个数据库只允许一个进程写入。请求在出网前登记，预算报价先保留；同 requestId 的相同请求返回相同 runId，变更内容或选择选项返回 409。进程异常中断后不自动重发未完成请求，而是 STOPPED/INTERRUPTED。

`publishForTest(evidenceId, retryOf?)` 是受信代码调用的队列故障测试边界：原子登记 attemptId、pending、failed；显式 retryOf 必须匹配上一失败尝试，重复重试不重复消费。无适配器时保持 not_requested。未接 C adapter、没有链上确认。

测试：`npm run test:b`；全流程与 API 见 [B 实现与复验](../../docs/13-B包实现与复验.md)。当前面向本地联调，未实现公众多租户认证、分页归档或跨机器分布式队列。
