# A 包公开核验样本

初始样本位于 [ethereum-mainnet-26134149](ethereum-mainnet-26134149/README.md)，包含真实 WETH 存在证明与地址不存在证明。新增 [mainnet-corpus](mainnet-corpus/README.md) 补充跨时期 WETH、无代码账户和零 ETH 余额合约，累计 10 个真实账户／区块组合，覆盖 6 个不同区块。来源、摘要与预期值均已记录。

- `helpers.ts`：测试和导出器的样本适配，生成临时本地签名，不保存私钥；`sample(accountIndex, data)` 可显式传入另一份审阅后的快照。
- `export-demo.ts`：实际完整核验通过后导出 bundle、manifest 和待运行者自行接受的 context。
- `capture.py`：只读取得固定区块的公开 RPC 材料到 `.local/capture`，不会自动验证或提交。

根目录 `npm test` 离线执行核验和负例；`npm run demo:a` 导出到 `.local/a-demo`；`npm run capture:proof -- --block 0x18ec685` 尝试重新采集（需要 Python 3 和网络，受提供商历史窗口限制）。

真实数据、实际故障注入与 UI_MOCK 分开。演示签名仅归属于本地适配器，不是 RPC 厂商签名；现有样本不代表生产服务实时可靠性。使用和运行边界见 [A 包说明](https://github.com/hankesong/Verdict-Agent/blob/materials/docs/11-A%E5%8C%85%E5%AE%9E%E7%8E%B0%E4%B8%8E%E5%A4%8D%E9%AA%8C.md)。

采集器支持 `--baseline-source` 和重复的 `--account`，用于选择可访问的历史头部来源及最多 16 个地址。公开资源调查和待补边界见 [数据覆盖说明](https://github.com/hankesong/Verdict-Agent/blob/materials/docs/12-%E6%B5%8B%E8%AF%95%E6%95%B0%E6%8D%AE%E6%9D%A5%E6%BA%90%E4%B8%8E%E8%A6%86%E7%9B%96.md)。
