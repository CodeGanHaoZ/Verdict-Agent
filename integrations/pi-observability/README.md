# Pi Observability 适配

复用 [disler/pi-agent-observability](https://github.com/disler/pi-agent-observability) 的本地 Bun/SQLite 服务及 Single、Swimlane、Race 看板，固定提交 `cbb8cc30b9bb2ff1b93a20d4415f72877b019868`，许可证 MIT，版权保留于 `LICENSE.upstream`。`upstream.patch` 是本项目唯一上游修改；源码安装到忽略目录 `.local/observability/upstream`，不复制进主工程或改用 coding-agent。

## 安装与日常运行

使用仓库的 Node 22；系统 Git 和 npm 需可用。安装器通过 npm 安装固定 Bun 1.3.10 二进制（不运行安装脚本）；仅 observer 使用 Bun，后端仍用 Node/npm workspace。已有 Bun 可通过 `VERDICT_BUN_BIN` 显式指定。

```sh
export PATH="$PWD/.local/node-v22.23.3-linux-x64/bin:$PATH"
npm run obs:install
npm run obs:start
npm run obs:configure -- .local/b-demo/local-one.json .local/b-demo/local-two.json
npm run build
npm run dev:stop
node --env-file=.local/pi-live/model.env \
  --env-file=.local/guard-live/reviewer.env \
  --env-file=.local/observability/observer.env scripts/dev/control.mjs start
```

其中前两个 env 文件沿用已有本地模型配置；新环境应自行配置对应模型，不复制实际密钥。observer.env 由控制脚本生成，权限 0600；只包含专用的观测写入 token。现有任务结束后再重启后端，SQLite 和证明材料保留。网页任务执行区增加“打开 PI 行为时间线”入口；也可直接访问 <http://127.0.0.1:43190/>。

`npm run obs:stop` 只结束匹配本工具 launchId 的观测进程，不清数据库、不杀占用端口的其他程序。后台启动／停止脚本目前限 Linux；其他平台可在前台显式设置 OBS_PORT、OBS_AUTH_TOKEN、OBS_LOCAL_READONLY=1、OBS_DB_PATH 后执行 Bun 上游 `apps/observability/server.ts`。安装器支持的二进制平台以 npm 对应包可用性为准，未在其他平台实际验证。

## 工作流

每个新 Agent 任务对应一个 observer session，角色字段区分前方模型和外审。时间线包含：

1. 任务状态、锁定边界摘要、执行模型请求／耗时／用量；
2. PI 提议调用（尚未执行）、Guard 待审动作；
3. 外审请求／耗时／用量与 ALLOW/BLOCK/UNCERTAIN；
4. 执行器消费一次性许可、实际动作执行结果摘要；
5. A 包 verdict、数据结论、归属、证据 ID、是否采用、失败替换或停止。

主体仍在 `apps/server`。观测适配器不提供工具，不修改验收结果，也不充当执行许可。固定流程和旧任务没有自动回填；本次接入范围是新的 PI／Guard 工作流，不是操作系统级全量审计。

## 数据与可用性边界

- 只发送代码构造的字段投影，排除任务原文、system prompt、模型解释、隐藏推理、原始工具结果、账户值、账户地址、私钥、API token 和本机路径。候选标识、模型名、原因码、状态、摘要及证据引用可以显示；不称为零信息泄露。
- `TOOL_START` 在 PI 内发生于执行前钩子之前，界面明确标为“工具提议（尚未执行）”。真正执行须看到后续许可消费及实际完成事件，不能由日志先后替代授权。
- 未配置价格时显示费用未知，禁用 metadata-only 会话的猜测上下文容量条。角色用量取各自最新累计值，避免重复累加。
- 后端 SQLite outbox 每 500ms 最多发送 50 条，使用固定事件 ID/会话序号；失败保留、重启补发、重复接收幂等。最多积压 10,000 条，达到上限丢弃新观测并在 API 显示 dropped/OUTBOX_FULL。观测不是唯一审计记录，完整业务和证据仍在原数据库。观测数据库暂无自动清理策略。
- observer 仅绑定 127.0.0.1；Host、Origin 与跨站来源检查防止浏览器跨站读取。浏览器无需 token，只提供本机只读数据；写入仍需服务端 token。未提供多用户登录，不应公网暴露端口。本机其他进程可读取脱敏观测。
- 不加载上游自动安装 skill、coding-agent 扩展或采集整个会话的默认逻辑；只启动已核对的观测服务。缺事件、观测掉线或 UNKNOWN 不能被当成攻击未发生或模型已成功的依据。

## 改动与检查

小改保留原 UI 和事件协议：增加 Verdict 事件摘要、准确未知费用显示、只读本地访问及 ingest 身份区分，禁止输出 token，修复 session 父记录先于 event 写入，并对流式请求体实施实际大小限制；事件摘要统一转义，避免模型提出的标识被当成 HTML 执行。

```sh
npm run typecheck
npm run test:b
npm run test:e2e
npm run verify:obs
```

`verify:obs` 要求看板先运行。它实际启动三个签名服务和后端，在独立 TEST_TRANSPORT 模型下运行正常替换与范围攻击，通过真实 A 核验，再验证实际上游 HTTP/SQLite/SSE 页面、重复写入、跨站读取拒绝和 Single/Swimlane/Race 三个浏览器视图。截图和报告保存在 `.local/observability/verification`，不把模型替身称作真实模型。

实际模型联调可选：先加载上述三个 env，再设置 `VERDICT_OBS_ENDPOINT=http://127.0.0.1:43190` 运行 `scripts/dev/verify-guard-live.ts`；模型来源继续明确标记 LIVE，任务上限不因观测而改变。

## 本次实际验证

- `typecheck`、65 项后端／PI／Guard／观测测试、7 项原网页浏览器测试通过。
- 上游实际看板的 Single／Swimlane／Race 三视图、动态 SSE 更新、重复 ingest、跨站拒绝经 Chromium 检查；原始截图与结果在本地 verification 目录。
- 真实常驻工作流：GLM 5.3 执行＋独立 GLM 5.3 外审，任务 `eef439aa-4e8c-4265-acc2-0086a1a55b5b`，单次 demo-valid 调用，约 42.58 秒，真实 A 结果 PASS、任务 COMPLETED，outbox 已排空。其 LIVE 时间线与 TEST_TRANSPORT 样本分开标记。这不改写之前“三次替换在外审处耗尽预算”的结果。
- 这次未改变模型选择、任务上限或 A 签名／验收规则；未开启任何链上发布。
