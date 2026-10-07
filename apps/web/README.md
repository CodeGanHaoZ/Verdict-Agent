# 简易审计前端

使用 TypeScript + Vite 的三个视图，直接消费 B 的 HTTP API 和 `@verdict/protocol` schema。没有前端验签、固定 verdict、模拟通过开关或私钥；PI 模型仅在服务端运行。

## 本地运行

使用 Node 22.23.3，在仓库根目录：

```bash
npm ci --ignore-scripts
npm run dev:init
npm run dev:start
npm run web
```

打开 http://127.0.0.1:5173 。前端终端 Ctrl-C 停止；`npm run dev:stop` 停止 B 的五个演示进程，保留证据。`npm run build` 同时构建后端和网页；`npm run web:preview` 在相同端口预览 `apps/web/dist`。

默认后端为 3001，第二实例为 3002。自定义时使用 `VITE_PRIMARY_API`、`VITE_SECONDARY_API` 环境变量，在启动或构建时提供；它们属于公开地址，不能放认证信息。改网页端口时同步后端 `corsOrigins`。所有本地服务器默认 loopback，开发服务器拒绝读取工作区 `.local`、私钥、数据库和 `.git`。

## 已实现

- 任务验收：从后端读取 context／检查点／账户，可选字段、候选、历史开关及预算；展示实际调用、替换、停止、采用值与逐项 checks。
- 服务目录：声明能力、来源标签、范围／窗口／样本数、实际观测和排序理由；可触发真实公共 RPC 探测。
- 证据复验：索引、原包／manifest 下载、文件完整性和独立发布状态；在第二实例导入并重验，展示重算结论、上下文比较以及历史开关的真实排序对照。
- 网络恢复：提交响应丢失时重试同一个 requestId；已知任务轮询中断后锁定新提交并允许重新连接恢复；sessionStorage 仅记录当前任务 ID／尚未确认的请求。
- 适配窄屏；所有服务／证据动态文本转义后显示。二次复验 COMPLETED 不显示为数据 PASS。

## 验证与边界

```bash
npx playwright install chromium
npm run test:e2e
```

七条浏览器测试启动隔离的真实 A/B 服务和 SQLite，覆盖错误替换、全部失败、原文件下载、第二实例复验／排序、页面刷新、丢失响应幂等重试、手机布局、后端不可用与私有文件访问隔离。测试用后端 3101/3102，前端 5174，不复用开发实例。CI 同样执行。

当前是简易本地界面。可信检查点／授权来自后端配置；已增加 PI 自然语言草案与显式条件确认，不提供通用聊天；没有钱包、链上发布写入、文件上传导入器或完整任务历史搜索。存证 adapter／合约尚未实现；默认如实显示 not_requested。原包已超过首次导入有效期时，需要操作者配置受信历史评估时间，页面不会替包自行授权。

PI 入口需要服务端显式配置；未配置时保留原固定流程。使用 `npm run pi:configure` 生成本地模型配置，API 密钥只在服务端环境中提供。PI 过程、模型错误／用量及 RunSnapshot 分开显示。详细操作见 [PI 说明](../../docs/15-PI接入与复验.md)。
