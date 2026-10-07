# 本地双实例联调

使用 `.nvmrc` 对应 Node 22.23.3，从仓库根目录运行：

```bash
npm ci --ignore-scripts
npm run dev:init
npm run dev:start
npm run verify:b
npm run observe:b
npm run dev:stop
```

`setup.mjs`：生成本地密钥、三个签名服务和两套独立配置；已有文件保留。`control.mjs`：启动五个实际进程并检查 launchId/健康，日志与 PID 记录留 `.local/b-demo`，Linux `/proc` 验证所有权后才停止进程；占用端口不会杀死其他人的服务。停止最多等 10 秒，然后只结束属于本脚本的残留进程。记录和密钥保留。

`verify.mjs`：通过 API 验证签名前注入错误、替换成功、全部失败停止、导出导入、独立第二进程复验、仅切换适用历史证据的排序对照、再次当前验收。`observe.mjs`：实际探测两家公共 RPC，失败也按真实状态记录，输出摘要而非秘密。

默认后端 3001/3002、服务 14301–14303。进程内置 loopback NO_PROXY；自定义代理启动时也要排除 localhost/127.0.0.1。第二实例单独启动：

```bash
npm run server -- --config .local/b-demo/local-two.json
```

Ctrl-C 停止前台进程。不要同时用前台命令和统一脚本占同一实例／端口。CLI 初始化不会自动下载 RPC 数据或进行链上交易。进程控制脚本仅验证 Linux；其他平台可用五个前台入口分别启动。

跨平台一次验收：`npm run verify:local`（已在 Windows 实测）。`verify-local.mjs` 在新 `.local/verify-local-*` 目录生成配置／密钥，以端口 0 启动实际五个进程并校验 launchId；先跑 B 验收，再跑 Agent 全工具路径。只持有、结束自己的子进程句柄，不依赖 PID 文件和 `/proc`；在 finally 中清理，保留证据。该命令不会运行公共 RPC 探测或链上发布，也不使用现有 `.local/b-demo` 私人配置。

setup.mjs 的可选首参数可指定 `.local` 内的隔离输出目录，默认路径不变，已有文件保留。verify.mjs 的第三个参数可指定运行摘要文件，默认仍是 `.local/b-demo/verification.json`。不要同时让多个进程写同一数据库。

`local-stack.mjs` 复用独立五进程生命周期。`verify:pi:local` 读取显式模型环境，使用同一进程栈运行 [PI 数据集](../../fixtures/agent/README.md)；真实 API 仅由该显式命令访问。`verify:pi` 对已运行的后端评测，均不再生成或确认草案。

360 异常入口：`npm run test:360`（6 条证据审计＋20 条确定性异常），`npm run verify:360 -- live`（显式真实 PI），`npm run report:360 -- <report.json>` 生成独立分母的指标。没有模型的确定性执行清楚标为 DETERMINISTIC_EXECUTOR。
