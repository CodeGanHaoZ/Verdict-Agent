# z-verify：独立复验 CLI

A 包 CLI 已实现。安装固定 Node/npm 后，在仓库根执行：

```bash
npm ci --ignore-scripts
npm run build
npm run demo:a
npm run verify -- .local/a-demo/bundle.json --context .local/a-demo/trusted-context.json --json
```

也可在构建后执行 `./node_modules/.bin/z-verify <bundle.json> --context <trusted-context.json>`。默认读取 bundle 同目录的 manifest.json，支持 `--manifest`、`--json`、`--help`。

上下文必须由运行者自行接受，不能因为它与证据一起收到就信任。CLI 不联网，不读第一实例 DB，重新执行摘要、签名、证明和任务条件检查。测试会复制导出文件、删除原目录后用新 Node 进程重验。

退出码：0 为一致且 PASS；2 为一致且 FAIL；3 为未知或上下文不同；4 为完整性／报告不符；1 为用法、文件或格式错误。详见 [A 包说明](../../docs/11-A包实现与复验.md)。
