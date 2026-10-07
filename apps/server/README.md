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

宿主工具接口（不直接供 PI 调用）：GET `/api/tools` 导出八个工具的参数 schema；POST `/api/tools/call` 严格分发到现有 Engine，不复制核验代码。完整参数及架构见 [工具与出海验收](../../docs/16-Agent工具与出海验收.md)。工具结果不是模型裁决；runId、HTTP 200、复验 COMPLETED 都不能代替验收 PASS。

可选 `rpcObservationOrigin` 来自操作者配置，附于 RPC 观测并进入分组，默认不输出。它不改变证据包和数据结论。Windows 可运行根目录 `npm run verify:local` 自动验证实际五进程与工具消费路径。

PI 可选模块：`agent-service.ts` 提供直接 PI 执行、任务绑定、执行会话和事件（旧草案 API 仅保留兼容）；`pi-runtime.ts` 绑定实际 PI 1.0.4／兼容模型接口；`agent-store.ts` 增量持久化。固定流程和 PI 共用 `engine.ts` 的单次调用／核验／预算／采用。未配置时 PI 明示不可用，固定流程不受影响。命令、接口、测试与真实模型联调状态见 [PI 说明](../../docs/15-PI接入与复验.md)。
