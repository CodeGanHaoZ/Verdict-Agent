# @verdict/core

A 包确定性核验内核已实现，首个规则 `eth-account-v1` 支持以太坊 mainnet 1。

公开入口：`verify_delivery(request, delivery, context)`、`request_digest(request)`、`delivery_typed_data(delivery)` 和 `hash_header(header)`。输入经过严格 schema；核验函数只处理显式输入和调用方接受的基准／密钥配置，不联网或读库。

实际检查区块头哈希、主网分叉头字段、账户存在／不存在证明、请求与字段、EIP-712 签名及其有效授权和请求重放上下文。返回逐项证据、三态、归属与是否构成限定交付反证。

真实样本为 [mainnet 26134149](../../fixtures/core/ethereum-mainnet-26134149/README.md)。不存在账户使用零哈希占位，存在空账户按实际 RLP 解码值比较，不互相混淆。未验证共识最终性或任意存储槽。

在根目录运行 `npm run typecheck` 和 `npm test`。政策、历史/live 语义与调用示例见 [A 包说明](https://github.com/hankesong/Verdict-Agent/blob/materials/docs/11-A%E5%8C%85%E5%AE%9E%E7%8E%B0%E4%B8%8E%E5%A4%8D%E9%AA%8C.md)。
