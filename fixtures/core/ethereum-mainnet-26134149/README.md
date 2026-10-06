# Ethereum mainnet 26134149：真实账户证明

本目录的 [snapshot.json](snapshot.json) 是实际只读 RPC 采集、经本地密码学校验后保留的公开样本，不是生成的测试链或 UI_MOCK。

| 项目 | 值 |
| --- | --- |
| 数据链 | Ethereum mainnet，chainId 1 |
| 区块 | [26134149](https://etherscan.io/block/26134149) |
| 区块哈希 | `0xe0743902f44425ff740070d696e93edeba3f6cfb2424a3fd18fb342a61a3df8f` |
| 状态根 | `0x902b0af9c6f9d333238aba91b5b622ab5e59b1c298cb6bd3031741aef88a6506` |
| 首次采集时间 | 2026-10-06T15:12:51.747592+00:00 |
| 证明来源 | `https://eth.drpc.org` |
| 同区块头对照来源 | `https://ethereum-rpc.publicnode.com` |
| 文件 SHA-256 | `faf1fd54c7cf31de91fe11c4e58a655c17c12041c5ea0f6d013cbde0b22d545f` |

WETH 地址 `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2` 的证明有 9 个节点。重新计算区块头哈希并从账户证明解码得到的余额为 `2148726676449398451377656` wei、nonce 为 `1`，并核对了 codeHash 和 storageRoot。

地址 `0x6f6e2d636861696e2d73616d706c652d61303031` 的 8 节点证明验证为**账户不存在**。该 RPC 对不存在账户返回 balance/nonce 为零、codeHash/storageHash 为零哈希。本协议沿用这一明确的不存在表示；它与已存在的空账户所使用的空代码／空存储树哈希不同。没有有效不存在证明时，不能仅凭这些零值判通过。

## 采集与复验方法

采集时先固定区块高度及哈希，再按该高度请求 `eth_getProof(address, [], blockNumber)`，读取结束时重新检查同高度哈希未变化，另取同哈希区块头核对 stateRoot。记录的是空 storageKeys 的**账户证明**，不包含任意存储槽验证。

两家端点返回相同头不证明它们基础设施独立，也不构成共识／最终性证明。运行时将该哈希作为调用者显式接受的检查点，采集最终性标记为 unfinalized；不冒称 finalized。固定历史样本不代表当前服务的实时能力。

离线核验使用 EthereumJS 重算区块头并执行 MPT 验证；本仓库测试同时检查存在与不存在路径。重新采集到本地暂存区可运行：

```bash
npm run capture:proof -- --block 0x18ec685
```

该命令需要 Python 3 和网络，只读获取原始材料；不是密码学核验命令，也不会自动提交样本或将其当作信任基准。未来提供商可能限制历史证明窗口；即使重新获取失败，已保存的完整材料仍可离线复验。

本目录不保存私钥。`npm run demo:a` 使用临时生成的本地密钥签署这些真实数据，导出到被忽略的 `.local/a-demo`；签名只归属于 `local-fixture-adapter`，不属于 RPC 厂商。导出器不持久化私钥。实际签名与评估时间取导出当时，链数据时间仍是本样本的历史区块。
