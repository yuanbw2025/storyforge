# 更新日志

本页按用户可感知的变化整理。**main 的功能更新不等于已经发布新版本**：当前 package 版本仍为 3.9.1，正式 Release 保持其发布时内容。在线部署可能有时差，见[版本与兼容说明](/updates/compatibility)。

## 开发分支 · Codex 本机订阅提供商

新增本机登录复用、模型选择、免 Key 任务预设、取消、断线记录和订阅用量区分。操作见[模型配置](/getting-started/model-config)，交付状态见[开发记录](/updates/development-status)。本条不代表新正式版本，也不表示线上静态站点可调用本机订阅。

## 开发预览 插件与创意工坊

[PR #113](https://github.com/yuanbw2025/storyforge/pull/113) 提供插件体验版、安装与开发教程、AI 开发资料包和发布流程。先看[工坊指南](/workshop/)与[开发状态](/updates/development-status)；是否合并及部署以 [PR #113](https://github.com/yuanbw2025/storyforge/pull/113) 为准，入口仍需显式开启开发预览，不代表发布新的正式版本。

## 2026-10-08 · 知识库新增开发简报

新增[插件与创意工坊 1.0 体验版简报](/updates/plugin-workshop-v1)，整理试用方法、项目改动、数据保护、验收结果和限制。在 2026-10-08 核对时 PR #113 尚未合并，本条保留当时的知识库更新记录；当前状态见上方工坊指南与 PR。

## Unreleased / 当前主干

### 2026-10-06 · Word 导入依赖安全维护

- 移除 Word 导入依赖链中的已知漏洞组件，保留现有 `.docx` 文本提取能力。
- 中文、段落、表格文本提取，以及损坏文件明确报错的浏览器回归已通过。

依据：[依赖修复](https://github.com/yuanbw2025/storyforge/commit/f06caf0f)，随 [PR #111](https://github.com/yuanbw2025/storyforge/pull/111) 合入主干。操作说明见[导入与参考资料](/guides/import)。

### 2026-10-06 · 三款可直接游玩的 3D 叙事游戏

- 在“文字开放世界 → 内置叙事游戏”提供《潮痕：最后一盏灯》《远日点：第七码头》和《潮痕：两声之间》，无需 API 配置或额外下载模型。
- 两部长篇保留十章剧情、三万汉字以上主线、五百句以上独立对白和四结局；《两声之间》是约四至五分钟的调查与救援短篇。
- 支持 3D/文字探索、交互与分支、手机操作、刷新恢复和检查点分支；修复低帧率下连续寻路的停顿。
- 内容和程序化场景随源码提供，明确开始后准备独立版本与存档；仅浏览介绍不会安装内容。存档保存在当前浏览器，完整项目备份可恢复。
- 使用冻结脚本，无自由输入 AI 对话或角色配音；不提升通用游戏生产能力的成熟度。旧 Release 压缩包保持原有内容。

入口：[文字开放世界](/features/interactive/open-world) · [内置作品](/guides/examples)。
依据：[游戏本体与入口适配](https://github.com/yuanbw2025/storyforge/commit/41f32066)。

### 2026-10-06 · 首页布局与力量体系统一入口

- 修复首页布局与侧栏文字的显示。
- 长篇和世界引擎的力量体系统一到“世界起源 → 力量体系”，在同一页编辑概述、规则明细与等级词条；旧链接继续定位到新入口。
- 保留已有数据身份与引用，概述与规则明细不自动互相覆盖；多世界编辑按当前世界隔离。

入口：[长篇设定](/features/longform/planning) · [世界引擎](/features/world-engine)。
依据：[PR #109](https://github.com/yuanbw2025/storyforge/pull/109)，主干合并提交 `7b0ac619`。日期为合入主干日期，线上以应用部署为准。

### 2026-10-06 · 漫画动态样片《末班来信》

- “漫画 → 作品库”和“首页 → 示例作品 → 漫画”新增 50 秒有声动态样片，在独立标签页播放；原有四套完整页漫继续提供阅读与下载。
- 支持全屏、暂停、进度拖动、重播、音量及静帧对照，无需模型 API，不创建或修改作者作品。
- 这是独立制作的预制样片，展示有限动作、镜头与声画效果，不代表当前漫画生产流程可以自动生成同等动画。影片按需加载，不进入应用预缓存。

入口：[小说转漫画](/features/comic) · [内置作品与示例](/guides/examples)。
依据：[动态漫画展示接入](https://github.com/yuanbw2025/storyforge/commit/f18c2922)。在线展示以部署完成为准。

### 2026-10-05 · 候选保存与制作恢复输入保护

- 长篇“一键拆场景”和“完善细纲”在输出结束后明确等待候选校验、保存；可恢复候选就绪前，不提前开放编辑、采纳、忽略或重试。
- 互动产品制作首次加载进度时，保留作者已经输入的任务修订稿；切换制作或运行控制版本变化时仍重置相关输入，不承诺未提交草稿刷新后保留。
- 游戏生命周期与生产分工的总纲更新属于开发边界规定，不代表各游戏产品新增了已完成的功能。

入口：[长篇场景细纲](/features/longform/writing) · [AI 候选与失败恢复](/guides/ai-workflow)。
依据：[候选保存保护](https://github.com/yuanbw2025/storyforge/commit/37451b15) · [恢复输入保护](https://github.com/yuanbw2025/storyforge/commit/36b74105)；分别随 [PR #107](https://github.com/yuanbw2025/storyforge/pull/107) 与 [PR #108](https://github.com/yuanbw2025/storyforge/pull/108) 进入主干。

### 2026-10-04 · 文字冒险作品展示、局部修订与大备份

- 作品库贯通封面、详情、开始/继续与存档；未发布试玩有明确标记，同名历史版本归入详情，过期 Build 启动会被阻止。
- 阅读界面提供沉浸与可访问性设置，窄屏工具栏保持可用；选择展示真实缺失条件，人物按冻结出场表出现。
- 支持故事、人物、场景、对白和路线的局部修订，并改善暂停恢复、图片替换、权利声明和视觉审查依赖处理；旧 Build 与存档保留。
- 改进大型项目 JSON 读写及开放世界旅行效果校验性能。
- 《潮钟群岛》的代码交付与具体作品发布分开：本地未发布试玩及其图片、存档不会随 Git 或新安装自动获得。

入口：[文字冒险](/features/interactive/text-adventure) · [大型备份](/guides/backup-restore)。
依据：[PR #100 主干整合](https://github.com/yuanbw2025/storyforge/commit/dd253f85)。

### 2026-10-04 · 长篇上下文修复与炉娘命名

- 修复资料已存在却被误判为缺少必读资源而阻断大纲、细纲或正文生成的问题。
- 事实检查区分可并存事件与单一状态冲突，保留真实冲突的阻断。
- 创作助手统一更名为“炉娘”，包含面板、设置和形象说明；不改变原有作品与语音配置。

入口：[长篇创作](/features/longform/) · [大纲与正文](/features/longform/writing)。
依据：[上下文修复](https://github.com/yuanbw2025/storyforge/commit/0c602f2d) · [助手命名](https://github.com/yuanbw2025/storyforge/commit/db86b01a)。

### 2026-10-03 · 线上模型代理设置

- 线上版不再提供仅适用于开发服务器的“切换到本地代理”按钮，避免保存线上不存在的代理地址。
- 语义检索预设在本地开发时使用本地代理，线上使用服务商直连地址；直连仍受服务商跨域规则约束。
- 已保存的代理地址保持不变，自建代理仍可手动配置，也可显式恢复直连。

入口：[模型与 API 配置](/getting-started/model-config)。
依据：[代理设置修复](https://github.com/yuanbw2025/storyforge/commit/98f7e8a6)。

### 2026-09-29 · 熔炉写作工坊与节点模板

- 新增 28 条原创可选模板，涵盖起步、场景、正文、局部修改、风格诊断、章后交接和发布文案。
- 提示词库支持按工坊作用域和关键词查找；默认不激活，保留作者原有选择。
- 工作流可指定本节点模板、绑定材料并保留作者提示；交接模板用短原文证据区分已发生事实与推测。

入口：[Prompt 用法](/guides/using-prompts) · [工坊目录](/prompts/a/a-index) · [节点创作](/features/nodes)。
依据：[工坊模板](https://github.com/yuanbw2025/storyforge/commit/8d3c1985) · [交接证据](https://github.com/yuanbw2025/storyforge/commit/ac8c0be9)。日期为进入主干日期。

### 2026-09-25～27 · 长篇选写、保存与导入恢复

- 可从最小确认想法或指定卷章、片段、人物字段开始，执行计划保留作者明确的范围与否定要求。
- 候选可编辑、讨论或拒绝；已采纳正文后的可选整理可单独恢复，作品库字数读取已保存手稿。
- 增加可取消的语音输入和朗读；识别文本先供作者编辑，不自动发送或采纳，默认不自动朗读。
- 修复作品资料保存、流式显示、切章状态和候选修订；大纲拖动到边缘时可滚动列表。
- 修复把世界背景误当作世界写入请求的问题，以及含糊章节序号的处理。
- 文档导入可重试失败块并继续未处理部分；不完整 JSON、授权或结果未知时停止，明确可重试的 503 才有限自动重试。

入口：[长篇](/features/longform/) · [正文保存](/features/longform/writing) · [文档导入](/guides/import)。
依据：[选写与候选](https://github.com/yuanbw2025/storyforge/commit/e082dcb0) · [语音](https://github.com/yuanbw2025/storyforge/commit/eeda8bd7) · [保存与切章](https://github.com/yuanbw2025/storyforge/commit/2b6c8499) · [采纳后恢复](https://github.com/yuanbw2025/storyforge/commit/92a6f80b) · [反馈修复](https://github.com/yuanbw2025/storyforge/commit/3ea1c8e3) · [显式恢复](https://github.com/yuanbw2025/storyforge/commit/ab07dee3) · [字数](https://github.com/yuanbw2025/storyforge/commit/ba275db2)。

### 2026-09-22～26 · 文字开放世界制作与盐脊展示作品

- 专属制作流程贯通冻结世界或小说来源、目标确认、授权生产、产物编辑、局部修复、素材、质量与版本发布。
- 玩家界面提供地图、任务、角色、背包、战斗、制作交易、世界记录、教程和存档；运行时 AI 受正式玩法与状态约束。
- 旧存档继续绑定原发布，升级需要兼容检查；制作预览与正式游戏库分开。
- 加入免模型配置的《盐脊：断流之夜》展示作品，可直接开始独立游玩与存档。
- 产品仍为预览；工程检查和展示作品不替代通用生产的真实模型校准与真人验收。

入口：[文字开放世界](/features/interactive/open-world) · [内置作品](/guides/examples)。
依据：[主干整合](https://github.com/yuanbw2025/storyforge/commit/8402d50b) · [专属入口](https://github.com/yuanbw2025/storyforge/commit/541c9d04) · [盐脊展示作品](https://github.com/yuanbw2025/storyforge/commit/a4bc3f62)。

### 2026-09-22 · 文字冒险专业生产、素材与产品包

- 主干接入产品定向、自动制作、质量与素材、发布导出及冒险运行入口。
- 专业生产覆盖故事、人物、任务、场景和对白，并检查决策后果与结局闭环。
- 图片具有版本和绑定依据，视觉要求及图片需要作者确认，并支持独立视觉审查和定向修复。
- 产品包支持校验、导入和独立运行；预算恢复、任务回退及检查点恢复保留已有有效产物。
- 仍为预览，不能把自动检查通过视为真人验收或具体旗舰作品已经发布。

入口：[文字冒险](/features/interactive/text-adventure)。
依据：[主干整合](https://github.com/yuanbw2025/storyforge/commit/58c5723c) · [专业生产](https://github.com/yuanbw2025/storyforge/commit/237f1912) · [产品包](https://github.com/yuanbw2025/storyforge/commit/ecc178b8) · [主干路径](https://github.com/yuanbw2025/storyforge/commit/fdc5b87c)。

### 2026-09-21 · 英文知识库与返回官网入口

- 补齐英文知识库、语言内链接与数据恢复说明；中文继续作为权威源。
- 导航增加“回到官网”，知识库与产品官网保持明确入口。

依据：[双语知识库](https://github.com/yuanbw2025/storyforge/commit/6262e6ed) · [返回官网](https://github.com/yuanbw2025/storyforge/commit/0fcff237)。

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

2026-10-04：按远程 main `dd253f85` 补齐 9 月下旬以来的主干变化，核对全部 86 个本地分支及关联工作区，并同步中文和英文说明。未合并内容单列于[待合并开发记录](/updates/development-status)，不作为已上线能力；文档部署状态以对应工作流成功记录为准。
