# 共享包规则

先读根 AGENTS.md 和本包 README。protocol 是叶子包，core 依赖 protocol，evidence 依赖 core/protocol；observations 和 anchor-client 通过 protocol 暴露接口，禁止反向导入 apps 或形成循环。

公开入口稳定后供其他模块消费；不要跨包深导内部实现。类型、schema、枚举与签名结构只保留一处定义。浏览器可消费的 protocol 不得引入 Node 专用依赖或任何秘密。

core/evidence 保持确定性输入输出；网络、文件读取、数据库与发布由对应应用／适配器承担。观测和锚定适配器的 IO 必须有预算、显式配置和结构化失败。
