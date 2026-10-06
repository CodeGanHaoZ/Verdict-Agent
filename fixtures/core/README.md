# A 包公开核验样本

实际样本位于 [ethereum-mainnet-26134149](ethereum-mainnet-26134149/README.md)，包含真实 WETH 存在证明与地址不存在证明。来源、区块、文件摘要、采集方式和信任边界均已记录。

- `helpers.ts`：测试和导出器的样本适配，生成临时本地签名，不保存私钥。
- `export-demo.ts`：实际完整核验通过后导出 bundle、manifest 和待运行者自行接受的 context。
- `capture.py`：只读取得固定区块的公开 RPC 材料到 `.local/capture`，不会自动验证或提交。

根目录 `npm test` 离线执行核验和负例；`npm run demo:a` 导出到 `.local/a-demo`；`npm run capture:proof -- --block 0x18ec685` 尝试重新采集（需要 Python 3 和网络，受提供商历史窗口限制）。

真实数据、实际故障注入与 UI_MOCK 分开。演示签名仅归属于本地适配器，不是 RPC 厂商签名；现有样本不代表生产服务实时可靠性。使用和运行边界见 [A 包说明](../../docs/11-A包实现与复验.md)。
