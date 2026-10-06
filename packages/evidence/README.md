# @verdict/evidence

A 包证据构造与独立重验已实现。公开入口：`build_evidence(request, delivery, context, provenance)`、`replay_evidence(bundle, manifest, context)`、`fact_key(bundle, context)`。

构造器实际运行核验，不接受调用者自报的 verdict；正文与外围 manifest 分开，摘要为 JCS 字节的 Keccak-256。UI_MOCK 不得生成公共证据。重验先检查完整性，再调用 core，比较报告与基准；上下文不同会明确标记。

事实分组先检查交付可归属，忽略 requestId、随机签名和重复报告元数据；不能把分组键当作独立客户数量。消费者导入时仍需检查完整报告的重验结果，不能仅计算分组键就接受原报告。

在根目录运行 `npm test`；通过 `npm run demo:a` 导出真实样本证据到被忽略的 `.local/a-demo`。完整格式和退出语义见 [A 包说明](../../docs/11-A包实现与复验.md)。本包不读取文件、数据库或网络，IO 留给应用。
