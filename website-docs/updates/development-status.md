# 待合并开发记录与分支核对

> 核对快照：2026-10-08 15:07（北京时间）· 远程 main `7629a7fa`。本页记录开发证据，不是已发布功能清单。

本轮完整核对 19 个本地分支（含本次知识库维护分支）和 41 个已登记工作区，包含 detached 与已移入归档目录的工作区。排除维护分支后，18 个分支中有 8 个 head 仍在主干之外。“仅本地提交”指未被已获取的任何 origin 分支包含的提交，不能直接当作遗漏功能数量。

## 10 月 8 日 · 长篇节点维护开发

`feat/longform-node-experience-20261008` 正在独立工作树验证节点作者要求、候选修改和拒绝的保存、局部执行、固定角色采纳、中断恢复与窄屏视图。该分支尚未合入主干，不能据此声明线上已更新。跨模式、非法连接与备份删除路径由隔离浏览器验收；所有官方长篇模板的完整生产验收仍待完成。详见[节点创作](/features/nodes)。

## 2026年10月9日专项补充 插件与创意工坊

插件 1.0 体验版通过 PR #113 交付，基础实现为 [53c276f3](https://github.com/yuanbw2025/storyforge/commit/53c276f3)，交付与评审见 [PR #113](https://github.com/yuanbw2025/storyforge/pull/113)。新增[工坊能力说明](/workshop/)、安装与开发教程、AI 指令与 Skill 资料包、发布维护和恢复流程；应用内提供帮助及下载入口。请按 PR 的最新检查与合并状态判断交付，官网部署需单独核对。下方保留 2026-10-08 的历史分支快照，其中的未合并状态和旧 CI 结果不代表当前状态。

## 已进入主干

- [PR #107](https://github.com/yuanbw2025/storyforge/pull/107)：游戏生产分工与生命周期文档，以及长篇候选保存后的审阅保护。
- [PR #108](https://github.com/yuanbw2025/storyforge/pull/108)：首次加载制作进度时保留已输入的任务修订稿。
- [PR #109](https://github.com/yuanbw2025/storyforge/pull/109)：首页布局、文字显示及世界起源中的统一力量体系入口。原“本地未推送”记录已失效。
- [PR #110](https://github.com/yuanbw2025/storyforge/pull/110)：《末班来信》预制漫画动态样片；对应知识库说明已通过[官网部署](https://github.com/yuanbw2025/storyforge/actions/runs/37356743763)。样片不代表漫画生产自动获得同等动画能力。
- [PR #111](https://github.com/yuanbw2025/storyforge/pull/111)：三款内置叙事游戏已合入主干，包含慢帧移动与暂停场景修复；原“待合并、CI 失败”和活动工作区的临时未提交记录已由后续提交取代。Word 导入的间接依赖安全修复也已合入，最新主干[完整 CI](https://github.com/yuanbw2025/storyforge/actions/runs/37477830226) 已通过。

操作说明见[更新日志](/updates/changelog)、[长篇设定](/features/longform/planning)、[候选与恢复](/guides/ai-workflow)。合入 main、应用部署与知识库部署分别核对，不把合并时间当成正式版本发布日期。

## 尚未进入主干的分支

- `feat/plugin-workshop-v1-20261008`：主干外 1 个提交，0 个仅本地，工作区干净。

  `53c276f3` 已推送到[草稿 PR #113](https://github.com/yuanbw2025/storyforge/pull/113)，尚未合并。16:14（北京时间）补查确认[远端 CI 失败](https://github.com/yuanbw2025/storyforge/actions/runs/37734889246)：229 项浏览器用例通过、1 项失败、2 项跳过；文字开放世界完整旅程等待战斗结果失败，原因待定位。插件与本地创意工坊体验版含 12 个参考包；本地测试通过不等于上线。完整范围、试用步骤、数据保护与验收边界见[体验版简报](/updates/plugin-workshop-v1)。

- `feat/builtin-3d-adventure`：主干外 9 个提交，其中 9 个仅在本地。

  三款内置作品的旧本地开发，相关作品已通过 PR #111 迁移到主干。旧提交身份与实现有差异，不直接重复合并，也不把三个作品重新列为未交付。

- `feat/mist-harbor-builtin`：主干外 1 个提交，其中 1 个仅在本地。

  `6ddbdb8c`：雾港 AVG 音效、配乐与录制文案；归档工作区中的未推送提交，是否仍需采用待核对。

- `fix/avg-production-world-media-reuse`：主干外 1 个提交，其中 1 个仅在本地。

  `618d388e`：冻结世界媒资复用，也被旧开放世界架构分支包含；只保留一项待核对内容。

- `codex/backup-text-open-world-before-main-sync-20260906-3f38495f`：主干外 45 个提交，其中 45 个仅在本地。

  旧备份，43 个普通补丁与主干等价；剩余差异包含历史文档及生成元数据，不能按 SHA 数字重复合并。

- `feat/public-product-presentation`：主干外 53 个提交，其中 53 个仅在本地。

  旧开放世界生产分支，45 个普通补丁与主干等价；其余来源、规则、主角、故事架构及文档差异仍需结合后续实现判断。

- `feat/text-open-world-product-architecture`：主干外 38 个提交，其中 38 个仅在本地。

  旧开放世界架构，部分已被后续实现覆盖；不是 38 项缺失功能，不恢复旧产品边界。

- `refactor/storyforge-bronze-ui`：主干外 3 个提交，其中 0 个仅在本地。

  已推送的历史 UI 分支，[PR #84](https://github.com/yuanbw2025/storyforge/pull/84) 尚未合并；不据此替换当前界面指南。

## 未提交内容与归档去重

- `feat/builtin-games-release`：观察到 72 个状态条目，涉及内置作品、入口、素材、依赖和文档，与已合入的 PR #111 迁移范围关联；保留为旧工作区差异，不能按文件数当作遗漏功能，暂存与未暂存文件不是已验收发布快照。
- `codex/wechat-articles-screenshots-20260922`：两份首页/工作区 CSS 未提交，仍需区分截图调整与正式产品修改。
- `feat/character-chat-recording`：78 个未跟踪条目均在 `.vite-e2e-cache/`，仅为测试缓存。
- `feat/character-chat-optimization-20261006`：核对时没有独立功能提交或未提交文件，分支名称不能证明优化已完成。

此前按维护者要求清理了 74 个旧分支引用，并将 33 个旧工作区移入归档目录；目录仍存在不等于分支仍在开发。归档中的 detached `c5e04d3c` 仅保留独有 merge 历史，相对合并基线没有文件差异。9 月 12 日 UI 重建的 detached `e08ffd7e` 已由维护者明确废弃，不再列为待补交功能。旧文字冒险修订中的等价补丁已去重，不重新提出合并。

本轮维护不提交、推送、合并或清理上述开发工作，也不修改作者浏览器数据。历史记录完整保留在 [2026-10-04 核对快照](/updates/development-status-20261004)，该快照不参与本地搜索，不代表当前待办。

## 每轮基线同步

每次维护先获取最新远程引用，再把维护分支同步至最新主干并核对新增变化；仅获取远程引用不等于工作分支已更新。提交和合并前再次复核主干，主干变化时补查并重跑受影响验证。作者活动工作区只读检查，维护在独立工作树执行。

继续阅读：[更新日志](/updates/changelog) · [版本与兼容](/updates/compatibility)。
