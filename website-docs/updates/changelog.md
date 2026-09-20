# 更新日志

本页按用户可感知的变化整理。**main 的功能更新不等于已经发布新版本**：当前 package 版本仍为 3.9.1，正式 Release 保持其发布时内容。在线部署可能有时差，见[版本与兼容说明](/updates/compatibility)。

## Unreleased / 当前主干

### 2026-09-18～19 · 官方知识库与反馈入口

- 建立独立 VitePress 文档站，提供中文目录、本地搜索、Prompt 资料与历史归档。
- 首页改为直接显示侧栏的知识库页面。
- 增加 Bug、功能建议、文档纠错表单，支持附件并显示提交编号。
- 反馈入口保留 GitHub Issue Forms 作为可选渠道。

入口：[知识库首页](/) · [反馈中心](/feedback/)。
依据：[文档站骨架](https://github.com/yuanbw2025/storyforge/commit/a2fe8fee) · [知识库与反馈表单](https://github.com/yuanbw2025/storyforge/commit/58892a5b)。

### 2026-09-14～16 · 新版首页与各产品工作台

- 首页接入真实作品、世界、任务、版本和本地搜索，各产品在自己的作品库管理内容。
- 长篇、短篇、剧本、世界、漫画、漫剧、角色聊天、跑团、小镇与 AVG 的新版界面接入实际流程。
- 恢复内置示例和独立体验副本，统一品牌图标，增加 14 套共享主题并改善工作区可用空间。
- 修复正文编辑器初始化可能触发空正文保存的问题，以及剧本规划编辑被后台刷新影响的问题。
- 文字冒险和文字开放世界继续明确标注为开发中；界面接入不提升其成熟度承诺。

入口：[选择产品](/getting-started/choose-product) · [长篇操作](/features/longform/)。
依据：[正式首页](https://github.com/yuanbw2025/storyforge/commit/62b53d35) · [当前 UI 基础](https://github.com/yuanbw2025/storyforge/commit/2a5f6715) · [主题](https://github.com/yuanbw2025/storyforge/commit/11a07816) · [正文保存修复](https://github.com/yuanbw2025/storyforge/commit/758f0a5f)。

### 2026-09-09～10 · 漫剧前期生产与内置作品

- 漫剧从一句话或小说进入系列设定、分集、物料、单集剧本、分镜和参考帧流程。
- 增加画面与运动提示词、逐镜 Seedance 执行包，以及其他目标工具的适配包；交付止于外部视频生成之前。
- 恢复《雾港：失潮钟声》内置文字冒险与 AVG 体验，不需要模型 API。该作品的可玩性不等于通用游戏产品全部完成。

入口：[漫剧素材](/features/motion-drama) · [内置作品](/guides/examples)。
依据：[漫剧生产](https://github.com/yuanbw2025/storyforge/commit/35d8ab99) · [执行包](https://github.com/yuanbw2025/storyforge/commit/79ae680a) · [内置雾港](https://github.com/yuanbw2025/storyforge/commit/787f8f06)。

### 2026-09-06～08 · 独立创作与互动预览

- 短篇补齐创作意图、章节规划、逐章正文、证据审校、定向重写与版本导出。
- 剧本补齐来源分析、专业改编、场景正文、双重审查与 Fountain / FDX / 打印交付。
- 漫画补齐页格、阅读链、视觉素材、独立排字、审查与分镜版/视觉版交付。
- 增加短篇、剧本、漫画示例作品与作品库入口。
- 跑团增加《雾港：最后一盏灯》社区预览、AI KP 和可恢复游玩；公共联网多人未部署。
- AI 小镇加入居民日程、关系、事件、回放与独立运行演化，当前仍为预览。

入口：[短篇](/features/shortform) · [剧本](/features/screenplay) · [漫画](/features/comic) · [互动产品](/features/interactive/)。
依据：[短篇生产](https://github.com/yuanbw2025/storyforge/commit/9a7e7a71) · [剧本生产](https://github.com/yuanbw2025/storyforge/commit/3167f422) · [漫画生产](https://github.com/yuanbw2025/storyforge/commit/39a01171) · [小镇](https://github.com/yuanbw2025/storyforge/commit/ee93e27e) · [跑团预览](https://github.com/yuanbw2025/storyforge/commit/cdf070b2)。

### 2026-08-31～09-04 · 作品、世界与产品版本边界

- 工作区、作品和世界的身份与数据归属分离，长篇与短篇保持独立创作。
- 作者可以显式派生世界，封存版本供具体产品按需求读取。
- 世界衍生产品统一经历世界封存、产品定向、产品执行；产品素材和运行进度不自动回写世界。
- 当前架构与备份格式有明确校验，升级前保留原环境和完整备份，不要假定任意历史 JSON 均可导入。

入口：[核心概念](/concepts/) · [升级兼容](/updates/compatibility)。
依据：[世界身份分离](https://github.com/yuanbw2025/storyforge/commit/e32d0a56) · [世界版本切换](https://github.com/yuanbw2025/storyforge/commit/c5e2f56d) · [当前架构切换](https://github.com/yuanbw2025/storyforge/commit/a0e0951a)。

### 2026-08-26 · 项目权威与文档体系重建

明确独立创作、世界引擎和上层产品边界，整理现行工程文档与历史归档。旧全景材料继续保留，但不定义当前产品状态。

### 2026-08-17 · 本地记忆工作区与统一 AI 执行

- 增加可读硬盘映像、差异检查、冲突处理、恢复胶囊和作者确认的双向同步。
- AI 结果先成为候选，记录来源、版本、用量和运行证据；作者确认后进入正式内容。
- 文件同步与恢复在本地执行，不消耗模型 Token；AI 生成和语义审校另行计费。

入口：[记忆工作区](/features/memory-workspace) · [AI 工作流程](/guides/ai-workflow)。

## 正式发布版本

### v3.9.1 · 2026-08-04

传统分步骤模式的固定发布版本，保留本地创作、JSON 导入导出和源码 npm 启动方式。它不包含后续 main 的全部独立产品与新版界面。

### 更早版本

历史版本的能力描述保留其当时语境，不能据此判断当前功能入口。查看 [GitHub Releases](https://github.com/yuanbw2025/storyforge/releases)、[仓库 Changelog](https://github.com/yuanbw2025/storyforge/blob/main/CHANGELOG.md)和[历史功能更新全文](/updates/historical-feature-updates)。

## 文档维护记录

2026-09-20：按 main 基线 58892a5b 重建产品指南、上手流程、数据与费用说明，并补齐以上主干阶段记录。这是知识库维护日期，不是新产品版本的发布日期。
