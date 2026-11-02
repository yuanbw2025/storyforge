# 版本、升级与数据兼容

## 当前文档描述哪个版本

本轮增量核对至 **2026-10-30，main 基线 8707bb8a**；从上次成功维护基线 `3b524e11` 核对用户可见变化。产品状态以各自指南标记为准。

当前正式版本为 [**v4.0.4**](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.4)，于 **2026-10-23 03:17 UTC** 发布，固定源码 `d90961a2`。本次交付 [PR #185](https://github.com/yuanbw2025/storyforge/pull/185) 的大型运行合同保存与恢复修复，[发行准备 PR #190](https://github.com/yuanbw2025/storyforge/pull/190) 已合并。合同和事件快照共用 32 MiB UTF-8 有限记录预算，完整保留快照；超预算仍明确拒绝，不改变模型预算、候选采纳、权限或过期检查，也没有数据库迁移。独立发行通过完整生产/浏览器检查、全部客户端和四平台便携启动，以及从正式 v4.0.3 的覆盖升级；Android 保留旧包重启基线、新包恢复和最终重启四阶段验证。升级前仍请导出完整备份，见下方步骤。

上一正式版本为 [**v4.0.3**](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.3)，于 **2026-10-22 14:16 UTC** 发布，固定源码 `eb1fb49d`。[PR #184](https://github.com/yuanbw2025/storyforge/pull/184) 已合并；发行包含精细章纲原文快照、文风统计缺失、场景细纲输入与错误恢复修复，并通过客户端启动、覆盖升级和完整浏览器检查。[最新发行页](https://github.com/yuanbw2025/storyforge/releases/latest)提供 Windows EXE、两种 Mac DMG、Android APK、四平台便携 ZIP、更新元数据与 `SHA256SUMS.txt`。4.0.2 增加 Windows、Mac 和 Android 安装包、应用内更新及统一用户协议，见[安装说明](/getting-started/install)。v4.0.1 构建包含主动故障反馈，以及 [PR #119](https://github.com/yuanbw2025/storyforge/pull/119) 的文字冒险恢复、保图修订和独立网页导出；操作与捕获限制见[故障排查](/guides/troubleshooting#下载版的问题与故障反馈)。

v4.0.2 于 2026-10-16 正式发布，固定源码 `04de86d7`。发行页提供 Windows EXE、Mac Apple Silicon/Intel DMG、Android APK，以及 Windows/Mac/Linux 四平台便携 ZIP 和 `SHA256SUMS.txt`。应用内问题与建议提交到维护者私有收件箱；网页备用表单创建公开 Issue，详见[故障排查](/guides/troubleshooting#下载版的问题与故障反馈)。

历史 [v4.0.0 正式发布](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.0)于 2026-10-13，固定在 `78416965`，不包含上述后续改动。排查问题时一起提供版本、构建 commit、访问地址和日期。

在线站点可能有部署时差；[固定 Releases](https://github.com/yuanbw2025/storyforge/releases)不会自动包含后续 main 功能。

[PR #158](https://github.com/yuanbw2025/storyforge/pull/158) 的大纲候选采纳修复晚于 v4.0.1 固定源码 `e8ce0a0d`，已包含在 4.0.2 客户端源码中。正式可下载状态以发行页为准；其他待合并开发见[开发记录](/updates/development-status)。

当前 main 包含 [PR #165](https://github.com/yuanbw2025/storyforge/pull/165) 的长篇入口整合、[PR #166](https://github.com/yuanbw2025/storyforge/pull/166) 的续写/细纲错误处理，以及 [PR #141](https://github.com/yuanbw2025/storyforge/pull/141) 的系统文规划与全章评审。上述增量分别合入 `a45cb1db`、`b344cc0b`、`1b96e80a`；对应操作见[长篇指南](/features/longform/)。固定 v4.0.2 的源码仍为上方列出的 `04de86d7`。

## v4.0.4 之后的主干变化

[PR #195](https://github.com/yuanbw2025/storyforge/pull/195) 的模块加载重试、[PR #197](https://github.com/yuanbw2025/storyforge/pull/197) 的叙事世界工程成果，[PR #134](https://github.com/yuanbw2025/storyforge/pull/134) 的开放世界三线制作与返修，以及 [PR #201](https://github.com/yuanbw2025/storyforge/pull/201) 的角色候选编辑与原生故障去重已合入 main，尚未进入新的正式安装包。当前正式版本仍为上方的 v4.0.4；后续发行日期未定。

主干在世界叙事索引 v12 基础上，经 [PR #196](https://github.com/yuanbw2025/storyforge/pull/196) 进入数据库 **v13、完整备份格式 v17**，保留两种历史 v12 库的并集桥与 v14/v15/v16 备份的严格兼容入口。世界与作品原记录仍是内容来源；可重建缓存不进入完整备份。已升级数据库不要直接交给仅支持旧 schema 的程序；回退先保留兼容 v13 的环境，并用升级前备份在隔离副本核对。见[备份与恢复](/guides/backup-restore)。

本轮新增的文字冒险导航 [#208](https://github.com/yuanbw2025/storyforge/pull/208)、逐章提示与主题 [#209](https://github.com/yuanbw2025/storyforge/pull/209)、模型配置 [#217](https://github.com/yuanbw2025/storyforge/pull/217)、跑团 [#196](https://github.com/yuanbw2025/storyforge/pull/196)、角色聊天 [#172](https://github.com/yuanbw2025/storyforge/pull/172)、故事线阶段恢复 [#226](https://github.com/yuanbw2025/storyforge/pull/226) 和 AVG [#219](https://github.com/yuanbw2025/storyforge/pull/219) 均已合入主干。正式下载仍为 v4.0.4；v4.0.5 的[发行准备 PR #228](https://github.com/yuanbw2025/storyforge/pull/228)已于 2026-10-29 合入 `ae765da8`，但截至本轮读取尚未公开 v4.0.5；发布日期和可下载附件待实际发行核对。长篇保存/采纳与加载恢复 #215、正文百科引用保护 #231 亦已合入主干，见对应指南。

## 升级前

1. 在原环境导出完整 JSON，并另存重要正文。
2. 保留原始文件；使用硬盘工作区时完成一次明确的差异检查与同步。
3. 阅读更新日志中的数据兼容说明。
4. 更新后核对作品、章节、素材与保存结果。

本地源码没有个人改动时，可以按 Git 提示更新源码，再运行 `npm ci` 与 `npm run dev`。有本地改动时先保留并处理冲突，不要用强制覆盖命令升级。

## 旧备份不是一律可导入

当前备份校验只接受支持的当前格式。数据库版本迁移与外部备份导入是两条不同路径；支持某些数据库迁移不意味着任意旧 JSON 都能导入。

旧文件被拒绝时：

- 保留原始备份和仍可打开它的原环境。
- 记录版本与错误文本。
- 若原环境能读取，另行导出正文，防止只剩一个格式。
- 提交[反馈](/feedback/bug)，等待有证据的兼容方案。

不要手改备份版本号、删除校验字段或清空原浏览器数据库来绕过错误。

## 回退

回退源码或打开旧 Release 不保证旧程序能读取新数据。更新前保留的原版备份和独立环境是恢复依据。

继续阅读：[备份与恢复](/guides/backup-restore) · [更新日志](/updates/changelog)。

分支中已有实现、进入远程主干、官网部署成功是三个状态。[待合并开发记录](/updates/development-status)单独说明尚未交付的内容；知识库维护日期不是产品发布日期。

2026-10-21 合入的 [PR #171](https://github.com/yuanbw2025/storyforge/pull/171) 修复精细章纲快照缺失与文风统计缺失时的页面读取；操作见[正文与章纲](/features/longform/writing)和[文风学习](/features/longform/style-learning)。[PR #185](https://github.com/yuanbw2025/storyforge/pull/185) 的合同快照预算修复已于 2026-10-22 合入 main，现已包含于正式 **v4.0.4**；该修复不在 v4.0.3 中。
