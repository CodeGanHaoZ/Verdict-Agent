# 最小证据摘要合约

负责人：C。状态：职责目录已建立，尚无业务实现或可运行命令。

## 职责

记录发布者、证据摘要和 schema 版本，输出可检索事件；不宣称合约执行了内容核验。

## 第一批工作

先建立本地编译与测试，约定重复提交和授权边界，再给 anchor-client 提供 ABI。

## 依赖与边界

独立 Solidity 工程；不能覆盖其他发布者的记录。主网写入依具体授权执行。

## 完成检查

本地提交／事件对应、不同发布者隔离、重复策略、失败分支；公开网络确认单独记录。

实际代码、依赖和命令落地后更新本文件，注明已运行的检查与限制。协作依据：[根规则](../../AGENTS.md)、[工程结构](https://github.com/hankesong/Verdict-Agent/blob/materials/docs/09-%E5%B7%A5%E7%A8%8B%E7%BB%93%E6%9E%84.md)、[接口约定](https://github.com/hankesong/Verdict-Agent/blob/materials/docs/08-%E6%8E%A5%E5%8F%A3%E7%BA%A6%E5%AE%9A.md)。
