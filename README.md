# Verdict Agent — 设计与资料

此分支专门维护设计资料；可运行实现位于 [code 分支](https://github.com/hankesong/Verdict-Agent/tree/code)。`main` 保留原有状态，不在本次拆分中修改。

## 文档入口

- [产品概要](docs/01-产品概要.md) · [PRD](docs/02-PRD.md)
- [架构图](docs/03-架构设计图.svg) · [交互图](docs/04-交互设计图.svg) · [技术设计](docs/05-技术设计.md)
- [接口约定](docs/08-接口约定.md) · [工程结构](docs/09-工程结构.md)
- [A 实现与复验](docs/11-A包实现与复验.md) · [B 实现与复验](docs/13-B包实现与复验.md) · [简易前端](docs/14-简易前端.md)
- [决策记录](docs/decisions/README.md) · [三人分工](docs/07-三人分工.md)

## 分支维护

基线为已提交的前端版本 `55179450b61d68d276b5bcb0145bd10b4eb9a584`。此次只拆分已提交内容，正在开发的 PI 改动和本地运行材料没有纳入。

`docs/` 保持原路径，正文仅调整跨分支链接。引用实现、测试、配置或样本的链接指向 `code`；设计说明不代表当前实现状态，最新运行情况以代码分支为准。

设计／历史决策的变更提交到 `materials`，实现、测试、运行配置和模块使用说明提交到 `code`。不要把两个分支整支互相合并；需要联动时分别提交并引用关联提交。旧提交历史保留，分支拆分不抹除历史源码。

自有材料沿用 [MIT License](LICENSE)，第三方来源见 [代码分支说明](https://github.com/hankesong/Verdict-Agent/blob/code/THIRD_PARTY.md)。
