# 共享协议

负责人：A。状态：职责目录已建立，尚无业务实现或可运行命令。

## 职责

定义 TaskSpec、VerificationContext、DeliveryEnvelope、VerificationResult、CheckResult、EvidenceBundle、运行状态与原因码；提供统一签名数据结构。

## 第一批工作

B/C 通过同一公开入口消费运行时 schema 与类型。先实现最小请求和结果，再逐步增加经过协作确认的对象。

## 依赖与边界

不依赖其他本地业务包；不联网、读库、验签或持有私钥。

## 完成检查

schema 正负例、枚举兼容性、签名结构与请求绑定的编码一致性。

实际代码、依赖和命令落地后更新本文件，注明已运行的检查与限制。协作依据：[根规则](../../AGENTS.md)、[工程结构](../../docs/09-工程结构.md)、[接口约定](../../docs/08-接口约定.md)。
