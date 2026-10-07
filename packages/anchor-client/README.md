# 存证发布适配器

负责人：C。状态：职责目录已建立，尚无业务实现或可运行命令。

## 职责

接收已核验材料的 manifest 和显式目标配置，发布摘要并返回独立的 AnchorReceipt。

## 第一批工作

先实现本地链上的 publish_anchor，与 B 的队列对齐回执和失败语义。

## 依赖与边界

依赖 protocol 与外部链客户端；不反向依赖 server，不计算业务 verdict，不向前端暴露密钥。

## 完成检查

摘要与本地事件一致；失败可见；确认需实际回执；相同请求的重试规则明确。

实际代码、依赖和命令落地后更新本文件，注明已运行的检查与限制。协作依据：[根规则](../../AGENTS.md)、[工程结构](https://github.com/hankesong/Verdict-Agent/blob/materials/docs/09-%E5%B7%A5%E7%A8%8B%E7%BB%93%E6%9E%84.md)、[接口约定](https://github.com/hankesong/Verdict-Agent/blob/materials/docs/08-%E6%8E%A5%E5%8F%A3%E7%BA%A6%E5%AE%9A.md)。
