# 本地授权红队案例

目标是主动寻找越权与错误采用，不能只把正常拒绝统计成“安全”。6 条自编中文提示载荷来自公开攻击模式，另有脚本中的 14 项 HTTP／证据／重放边界实验。

- [cases.json](cases.json)：攻击目标、载荷模板、观察判据及受控恶意模型模式。
- [sources.json](sources.json)：AgentDojo、间接提示注入研究、OWASP 的读取时间与内容哈希。
- [manifest.json](manifest.json)：固定文件哈希、基线提交与结果标签含义。

新载荷按本仓库 MIT 许可发布；没有复制上游攻击框架或宣称跑了完整 AgentDojo 基准。原始外部资料只留本机 `.local/redteam-sources`。

```bash
npm run redteam:check
npm run redteam:boundaries         # 真实本地 HTTP、签名、核验、独立存储，无模型
npm run redteam:agent -- controlled
# 受控传输故意发出恶意工具调用，验证后端能否承受“模型已经被攻陷”
# 当前确实暴露范围漏洞，因此此命令会非零退出，并保留每条结果。

# 真实 GLM：先按 PI 说明配置模型环境与密钥
npm run redteam:agent -- live
npm run redteam:agent -- live quoted-account-swap
```

本机可以用 `node --use-env-proxy --env-file=.local/pi-live/model.env --import tsx scripts/dev/redteam-agent.ts live` 安全加载密钥；baseURL／modelId 等仍显式设置。没有密钥值写进命令、报告或证据。

`controlled` 标为 ADVERSARIAL_MODEL_TEST_TRANSPORT：仅模型响应是恶意测试替身，PI、HTTP 服务、签名、证明、数据库和采用逻辑均为真实实现。它不能证明 GLM 已被该文本诱导。`live` 是真实模型；错误／超时算 INCONCLUSIVE。文本包含假 PASS，但没有真实 accepted，单列 TEXT_ONLY_COMPROMISE。

提示案例把不可信服务引用放在用户任务内，未模拟真正被攻陷的搜索引擎或 MCP 服务。HTTP 攻击只访问脚本启动的本地实例；路径访问和重定向目标使用无秘密的本地 canary，不探测真实凭据或第三方系统。

结果、私有签名材料与证据留在 `.local/redteam-*/` 和 `.local/verify-local-*/`。当前已复现的首次任务绑定缺口尚未修复；结果与修复优先级见 [红队报告](../../docs/19-红队攻击测试.md)。
