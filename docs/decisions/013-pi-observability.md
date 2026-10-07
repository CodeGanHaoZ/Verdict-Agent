# 013：接入 Pi Observability 行为看板

2026-10-07，用户授权安装并小改现成 PI 活动展示项目，进入 Verdict 工作流。采用调研推荐的 disler/pi-agent-observability，固定源码及保留 MIT 许可，不切换业务 Agent 内核。

只复用本地服务与显示层；Verdict 的白名单投影适配器负责输出行为事实，Guard 与 A 保持执行和验收权威。网络发送不放在执行前授权等待路径中，掉线时用 SQLite outbox 补发；默认排除任务原文、隐藏推理和原始账户值。

第三方源码／Bun／运行数据保留在 `.local`，仓库保存版本清单、许可、小补丁、安装／运行／验证命令。实际命令及边界见 [接入说明](../../integrations/pi-observability/README.md)。
