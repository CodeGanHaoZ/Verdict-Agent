# RPC 与交付观测

公开函数：`fetch_json`（有超时、2 MiB 流式上限、无重定向）、`probe_rpc`、`observation`、`summarize`。真实公共 RPC 默认包括 dRPC 和 PublicNode，执行 chainId、近期／24000000 区块头、近期／历史／固定哈希账户证明探测。

```bash
npm run observe:b  # 需已启动后端；输出与 SQLite 记录均来自实际网络请求
```

保留方法、请求范围、账户、时间、HTTP/RPC 错误码、响应摘要及实测延迟。能力 SUPPORTED 只表示该条件下有相应格式响应，`correctness=NOT_CHECKED`；采用数据还要 A 包核验。403 为 ERROR/UNKNOWN，429 为 RATE_LIMITED/UNKNOWN，超时为 TIMEOUT/UNKNOWN；已识别方法／历史范围限制才标 UNSUPPORTED。

指标按 LIVE/FROZEN/FAULT_INJECTION、方法及区块分组，窗口为最近 24 小时。超时无响应延迟，不计零延迟。验收计数来自本机实际任务尝试，导入记录不增加调用成功数。原始响应不全部入库，仅留安全摘要；不把单方超时观察当作可归属反证。并非穷举服务历史范围，少量样本不能外推 SLA。

测试通过受控 HTTP 端点验证分类（不写公共观测索引）；真实网络结果独立保存在 `.local/b-demo/live-observations.json`，见 [本轮记录](https://github.com/hankesong/Verdict-Agent/blob/materials/docs/13-B%E5%8C%85%E5%AE%9E%E7%8E%B0%E4%B8%8E%E5%A4%8D%E9%AA%8C.md)。
