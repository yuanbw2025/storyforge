# 当前产品能力与成熟度

> 核对日期：2026-09-20 · main 基线：58892a5b。正式 Release、当前 main 和在线部署可能不同，见[版本说明](/updates/compatibility)。

“已发布”沿用当前产品目录的状态，表示产品可进入已声明的主流程，不表示有新的语义版本号，也不保证模型质量。“预览”有可用实现但完整体验仍待验证。“实验性”不作为日常使用承诺。

| 产品 | 状态 | 当前结果与边界 |
| --- | --- | --- |
| [分步骤长篇](/features/longform/) | 已发布 | 设定到正文、章后整理、记忆与改稿影响；文学质量仍需作者判断 |
| [短篇小说](/features/shortform) | 已发布 | 创作意图到审校、定向重写、冻结版本与导出 |
| [小说转剧本](/features/screenplay) | 已发布 | 来源冻结、专业改编、双重审查与剧本格式导出 |
| [小说转漫画](/features/comic) | 已发布 | 脚本、页格、排字、视觉与版本；图片能力取决于实际服务 |
| [漫剧素材](/features/motion-drama) | 已发布 | 分集、分镜、物料与逐镜工具包；不含视频生成和成片 |
| [世界引擎](/features/world-engine) | 已发布 | 独立语义编辑、派生、版本封存与中立读取 |
| [节点创作](/features/nodes) | 预览 | 复用长篇能力；完整跨模式互操作继续验证 |
| [跑团](/features/interactive/ttrpg) | 预览 | 制作与 AI 主持、规则和存档；公共联网多人未部署 |
| [角色聊天](/features/interactive/character-chat) | 预览 | 文字会话、关系记忆与分支；长期效果继续验证 |
| [AI 小镇](/features/interactive/ai-town) | 预览 | 居民生活、日程、关系和回放；长期模型与素材质量待验证 |
| [文字冒险](/features/interactive/text-adventure) | 预览 / 开发中 | 通用入口尚非正式功能；可先玩内置作品 |
| [AVG](/features/interactive/avg) | 预览 | 制作、演出与玩家存档；通用视听质量需逐作品验收 |
| [文字开放世界](/features/interactive/open-world) | 预览 / 开发中 | 生产和运行基础存在；长期演化与完整体验未完成 |
| 社区市场 | 实验性 | 默认隐藏；公共账户、云同步与商业服务不构成当前承诺 |

## 示例与通用能力分开看

[《雾港：失潮钟声》](/guides/examples)是准备好的免 API 作品，有文字冒险与 AVG 玩法。它能完整游玩，不代表通用游戏制作能力都已完成。

## 所有产品共同的边界

- 核心创作数据以本地为主，换环境先备份。
- AI 使用自己的模型服务，可能计费；作者核对并确认候选。
- 世界与作品的引用有明确版本，后续变化不会自动到处同步。
- 当前不承诺 AI 永不遗忘、作品永无矛盾或自动完成商业级成品。

工程依据：[产品目录](https://github.com/yuanbw2025/storyforge/blob/58892a5b/src/lib/product/product-catalog.ts) · [能力基线](https://github.com/yuanbw2025/storyforge/blob/58892a5b/docs/roadmap/CAPABILITY-BASELINE.md)。
