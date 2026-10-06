# demo：B 的规则

演示服务命名使用 demo-wrong-block、demo-wrong-value、demo-valid，不和三位开发成员 A/B/C 混淆。错块和错值在签名前注入，另设签后篡改用例验证归属失败。

签名结构从 protocol 引用，演示密钥本地生成且不提交。服务签署自己的交付，不代表底层 RPC 提供商签名。来源标记与实际执行保持一致；不能使用假的 proof 或固定 PASS 冒充真实验收。
