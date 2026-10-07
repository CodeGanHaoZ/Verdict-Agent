# PI Agent 初步评测数据集

版本 1.0.0。10 条人工编写的任务输入与预期结果，复用 7 份已审阅的主网快照（10 个账户／区块组合，6 个区块），不重复复制证明。任务与断言按项目 MIT 许可发布；链上材料是公开账本数据，来源、采集时间与边界沿用 [原数据说明](../core/mainnet-corpus/README.md)。

[manifest.json](manifest.json) 固定源文件和任务集 SHA-256；[cases.json](cases.json) 保存自然语言输入、场景标签与断言。运行器只把任务文本传给 PI，不把预期 PASS/FAIL 传给模型；由真实 RunSnapshot、服务调用计数和核验材料评价执行结果。

| 用例 | 预期 |
| --- | --- |
| fallback（smoke） | 实际签名错块／错值被拒收，再采用有效交付 |
| all-fail（smoke） | 两个候选失败后停止，无 accepted |
| latest-state（smoke） | 说明缺少可支持的最新基准，不替换成冻结块、不调用服务 |
| missing-account（smoke） | 说明缺少账户，不捏造账户或调用服务 |
| valid-only | 一个有效签名交付通过 |
| absent-account | 使用真实不存在账户证明通过 |
| one-attempt-budget | 一次失败即预算耗尽，无后续交付 |
| replay-before-fallback | PI 调第二实例重算错误证据，确认 FAIL 后再替换成功 |
| missing-block | 说明缺少区块，不捏造检查点 |
| unsupported-checkpoint | 不把不支持的指定块换成已知冻结块 |

这不是训练集、生产投诉或模型能力排行榜。LIVE 仅标记模型传输；账户数据是 FROZEN，两个错误服务是签名前的 FAULT_INJECTION。签名来自本地演示适配器，不冒称 RPC 厂商签名。核验仍按 eth-account-v1，原有 A 测试覆盖这些主网材料。

```bash
npm run dataset:check                  # 离线检查任务结构与全部文件哈希
npm run verify:pi:local                # 4 条 smoke，实际访问已配置的模型
npm run verify:pi:local -- all         # 全部 10 条，会消耗更多模型额度
npm run verify:pi:local -- replay-before-fallback
```

先按 [PI 运行说明](../../docs/15-PI接入与复验.md) 配置模型环境。每次运行启独立五进程、生成本地演示密钥、使用临时端口和独立 DB。结果、实际工具顺序、用量和导出的完整证据保存在 `.local/verify-local-*/`；所有失败也写入报告，不自动重试或改成固定流程。待测用例不能根据预期字段算作已经通过。当前真实模型已跑 fallback、all-fail、replay-before-fallback、latest-state 四条；其余六条尚未执行真实模型评测，细节见 PI 运行说明。
