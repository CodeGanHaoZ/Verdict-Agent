# Agent 活动图与回放 DEMO

## 当前功能

主前端 `http://127.0.0.1:5173/#activity` 新增 Agent 活动页。一次具体动作展开为提议、审查、实际执行、A 核验、处理结果节点；查询和停止动作不补造账户验收。节点固定在动作行及阶段列，增量事件不重新排列已有节点。跨行连接只表达已知执行顺序，不由模型生成因果关系。

浅色视图支持播放／暂停、前后单步、重放、缩放、适应画布、节点详情、键盘选择和减少动态效果。新连接只播放一次粒子运动；任务终止后停动画。模型审查 ALLOW、A verdict PASS、持久化采用结果分别表达。等待的阶段使用实际记录时间计时；缺失开始或结束记录不编造耗时。失败、取消、模型解释错误和已采用结果可以同时保留。

手机画布按可读字号跟随当前阶段，可缩放到全图；宽度变化和切换场景会重新定位，详情显示在图下方。拒收节点显示 A 返回的首个原因码及证据引用。第二实例复验只有返回结果后才产生核验节点，网络等待不等同 A 已经开始核验，也不冒充远端核验耗时。

三个默认场景读取 [录制资料](../fixtures/graph/README.md)，约每条 350–1000ms 回放以压缩等待；详情仍显示原始阶段时间和实际耗时。来源标记为 TEST_TRANSPORT，签名服务及 A 验收真实执行。回放不调用模型、服务或证据发布接口。

## 接口与持久化

新增共享 `AgentGraphEvent`、`AgentGraphPage` 与 `AgentGraphRecording`，`graphVersion=1.0.0`。图记录存入独立 SQLite 表 `graph_tasks`、`graph_actions`、`graph_events`，不依赖观测 outbox。首次启动自动创建表，旧 Agent、Run 和 A 包证据均不重写。

动作 ID 由 Agent ID 与 PI tool call ID 的摘要生成，沿执行前钩子、Guard 决定、执行器和 A 验收投影关联。Guard 决定可附带 actionId 与 reviewError，原 reasonCode 语义保持不变。图中不会包含原始模型工具 ID。

`GET /api/agent/runs/:id/graph?after=0` 返回最多 200 条事件、nextCursor、hasMore、任务状态和持久采用的证据引用。游标必须是非负安全整数。查询只读，不创建任务。新增 `#activity?agent=AGENT_ID` 深链接；任务页“查看动作图”入口直接跳转。旧任务返回 available=false，页面显示没有完整图记录并保留原时间线。

前端每 500ms 轮询，按序号去重并顺序归并；断线保留画面、显示状态后重试。序号缺口等待补齐，冲突保留警告，缺少阶段依据时不连接出虚假的批准路径。重复候选请求显示“复用已有结果”，关联原 attemptId，不生成另一条实际交付。

## 实现与范围

React 19.3.0、React DOM 19.3.0 和 React Flow 12.12.0 固定于现有 npm workspace/lock。仅活动页懒加载 React 组件，其他页面仍使用原 Vite/TypeScript 实现；采用固定坐标，不引入 Dagre、流程编辑器或虚构的并行调用。交互借鉴 Agent Trace，未复制其源码／示例数据／隐藏推理显示。

图事件是本地应用事实投影，不是新的签名证据或授权来源。Engine 的生命周期回调不改变原验证、预算和原子采用语义。A 包数据格式不变。旧固定流程的可视化和无关联历史任务回填、OS 级监控、多 Agent 编排、图上修改执行流程不在本次范围。

## 复跑命令

```sh
export PATH="$PWD/.local/node-v22.23.3-linux-x64/bin:$PATH"
npm run typecheck
npm run test:graph
npm run test:all
npm run test:e2e
npm run graph:record   # 仅需要重新生成录制资料时运行，会更新 fixtures/graph
npm run web
```

实时图需要用最新 build 启动后端，配置方式沿用 PI/Guard。无需运行第三方观测看板。原 Pi Observability 入口和数据队列继续可用。

## 实际验证记录

本轮通过 typecheck、48 项 A 测试、77 项后端／PI／Guard／观测／图测试（其中图专项 12 项），浏览器测试包含原有 7 项和新增 3 项图场景。新增验证覆盖关联一致性、样本哈希、乱序／重复／缺口、实际服务超时、审查超时、取消、重启、重复候选复用、以及采用后的解释错误。

本地真实模型任务 `18ea4811-6f35-41e9-9b7c-b1190d6595c3`：GLM 5.3 执行＋GLM 5.3 独立外审，约 42.154 秒，3 个动作、23 条图事件，单次有效服务交付通过真实 A 验收并原子采用。报告在 `.local/graph-ui/live-graph.json`；它与默认三个 TEST_TRANSPORT 回放分别标记。此结果不代表三次替换的真实模型时延已经解决。

图的事件时间是本地记录时间，明确测量的交付／核验／审查耗时单独存放。详情中的“首次阶段记录”不把未知阶段开始时间猜成精确时间。图日志异常或缺失不能推断安全，也不能作为签名证据代替 A 的原始材料。

## 钱包后端扩展

新增兼容字段和 `/api/wallet/reviews/:id/graph` 分页接口，将锁定意图、余额／nonce、范围检查、RPC 预执行、PI、许可消费、广播核对、receipt、状态对照与私有证据保存分阶段记录。钱包图序号独立，A 的 PASS/采用语义不变；前端组件本轮未修改。完整 API、独立测试网实例及复验边界见 [钱包活动图](24-钱包活动图与BOT测试网观察.md)。
