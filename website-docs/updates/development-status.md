# 待合并开发记录与分支核对

## 2026-10-30 · 当前分支与待交付范围

从成功基线 `3b524e11` 核对至远程 main `8707bb8a`，编辑前枚举 **12 个本地分支、11 个注册工作区（含 detached）**，9 个 head 尚非 main 祖先，全部已有提交均被 origin 引用包含。分支数量不代表独立功能数；旧目录与引用不再登记时不重建、不推断内容丢失。下方旧日期正文保留当时状态，以本节为当前核对。

### 已合并

长篇保存、候选采纳和启动恢复 #215、正文百科引用保护 #231、仓库外 API 发现规则 #232、v4.0.5 发行准备 #228 已合入 main。#232 是开发治理契约，不新增用户模型服务。#228 合并不代表已经公开新安装包；当前正式版仍 v4.0.4。#215 的 160 项矩阵仍为 72 执行中、88 待执行、0 整项验收通过，不由本批修复推断全部原生崩溃或文学质量通过。

### 待合并与未提交观察

| 分支 / head | 内容与状态 | 去重与边界 |
| --- | --- | --- |
| `fix/issue-179-run-backup-lifecycle-20261029` · `925323b0` | 开放 [PR #233](https://github.com/yuanbw2025/storyforge/pull/233)：历史运行合同仍引用的章纲/正文，在局部删除前明确拒绝以保留备份引用 | 未合并；只预防新悬空引用，不代表原有坏备份已无损恢复。 |
| `feat/community-works-library-20261029` · `78dba682` | 草稿 [PR #234](https://github.com/yuanbw2025/storyforge/pull/234)：小说章节、已有书籍解析结果的作者逐项选择、公开预览与封存分享 | 未合并；入口默认隐藏，公开构建配置未设，独立图库、认证、私有上传、权限及审核等真实服务验收未完成，不宣称已开放社区。 |
| `feat/quality-audit-plan-20261029` · `3a5b3722` | 草稿 [PR #235](https://github.com/yuanbw2025/storyforge/pull/235)：固定基线审查、144 项分阶段整改及小说先派生世界的来源规则草案 | 方案与审查记录，不计 144 项功能或修复完成。 |
| `fix/quality-round1-integration-20261030` · `d9522134` | 草稿 [PR #236](https://github.com/yuanbw2025/storyforge/pull/236)：owner 删除原生主键、剧本冻结作者意图恢复、桌面运行时更新 | 未合并，依赖 #235；006/014/017 单项分支已是此整合 head 祖先，不重复算四套开发。全平台、真实覆盖升级与完整交付仍待验收。 |
| `fix/quality-035-adoption-reference-validation-20261030`；工作区 `quality-data-round1` | 3 项未提交：细纲写作、采纳引用校验和回归文件 | head 与 #235 相同；只登记观察范围，不声称实现完成。 |
| `fix/quality-005-world-source-admission-20261030` · `38cbcd5f`；工作区 `quality-intent-round1` | 45 项未提交：文字开放世界来源准入、小说派生世界草稿、生产/运行路径和测试材料 | 已提交 head 是 #236 祖先；工作文件尚未整合，不能按 45 项完成修复或直接小说来源已开放发布。 |

其余本地发行/维护分支已是 main 祖先，detached 旧版/审查工作区是冻结核验输入。本任务保留所有工作文件与浏览器数据，不代提交、推送、合并或清理产品开发。完整路径、提交与差异留在私有维护证据。




## 2026-10-28 · 合并链与现存分支核对

从成功维护基线 `7b974fbf` 核对至远程 main `46a90c0b`。本轮枚举 **127 个本地分支和 65 个现存注册工作区**（含本维护分支与 detached），30 个分支 head 尚非 main 祖先。只检查现存内容与前轮证据，不重建已清理的开发目录；分支减少不作为功能丢失的证据。

### 已合并与使用步骤

- 文字冒险 [#208](https://github.com/yuanbw2025/storyforge/pull/208)（`69e2a928`）、逐章提示/主题 [#209](https://github.com/yuanbw2025/storyforge/pull/209)（`ddd673eb`）、模型配置 [#217](https://github.com/yuanbw2025/storyforge/pull/217)（`f9deb5e3`）已合并，补齐[导航](/features/interactive/text-adventure)、[本章要求](/features/longform/writing)与[型号/用量](/getting-started/model-config)步骤。模型配置不再静默替换手填型号，缺少用量仍显示未知。
- 跑团 [#196](https://github.com/yuanbw2025/storyforge/pull/196)（`301d38ef`）、角色聊天 [#172](https://github.com/yuanbw2025/storyforge/pull/172)（`42e4fdf1`）和 AVG [#219](https://github.com/yuanbw2025/storyforge/pull/219)（`d4f92c80`）已合入，不再列为整条未交付分支。补齐各自的实验入口、媒资采用、原型/团局和恢复说明，仍保持产品目录的预览状态。跑团长局与听感、聊天稳定多轮与人物跨图一致性、AVG 专业剧情与商业艺术质量都没有据工程成功提升验收结论。
- 故事线阶段读取与明确修复 [#226](https://github.com/yuanbw2025/storyforge/pull/226) 已合入 `bcdf9463`，操作见[正文指南](/features/longform/writing#故事线提示阶段数据格式异常)。坏值写入来源、原生退出及其它长篇故障不据此结案。
- [#210](https://github.com/yuanbw2025/storyforge/pull/210)、[#220](https://github.com/yuanbw2025/storyforge/pull/220)是阶段交接与交付记录，流量归档是统计资料，均不重复计产品功能。当前 schema v13、备份 v17；正式 v4.0.4 与后续候选范围见[兼容说明](/updates/compatibility)。

### 仍待交付或核对

| 分支 / head | 内容 | 状态与去重 |
| --- | --- | --- |
| `fix/longform-state-card-recovery-20261026` · `1d758d2f` | 分步骤长篇异常读取、编辑、候选保存/采纳与启动恢复 | [草稿 PR #215](https://github.com/yuanbw2025/storyforge/pull/215)已推送、未合并，工作区干净；原始失败和当前 head 分开记录，160 项矩阵仍为 72 执行中、88 待执行、0 整项验收通过，不当作全部故障已经解决。 |
| `fix/longform-step-stability-plan-20261026` · `6860b23d` | ST00～ST07 逐功能修复与验收计划 | [草稿 PR #212](https://github.com/yuanbw2025/storyforge/pull/212)未合并，是方案文档，不计已实现功能，也不替 #215 的最终验证。 |
| `fix/client-release-4.0.5-20261028` · `1b31536e` | 版本绑定的新旧客户端造数、备份转换与签名升级验证输入 | 开放 [PR #228](https://github.com/yuanbw2025/storyforge/pull/228)已推送、未合并，候选输入未公开为正式发行。仅对应该 PR 冻结来源，后续 main 前进不自动证明已包含；不使用旧候选平台成功替代最终树检查。 |
| `fix/state-card-context-20261026` · `6ff319e2` | 异常状态卡读取保护的早期本地变体 | 2 个提交未被 origin 包含，其中 1 个为仅合并/指标更新；实际维护主题与 #215 重叠，但未证明逐文件等价，保留源码与差异，不另算已交付功能，不代推送。 |

三个带状态条目的工作区中，两个含工作文件变化，一个仅测试缓存。`wechat-articles-screenshots` 有 2 项宣传界面样式修改；旧 `storyforge-builtin-games-release` 保留未完成历史整合，72 项状态中 47 项与当前 main 同 blob，其余 25 项保留差异，不列作 72 项新功能。归档角色录制目录的 78 项仅测试缓存。旧备份、内置作品、同 head、仅 merge 与等价补丁沿证据去重；本轮没有接管、清理、提交或合并其它产品分支，也没有运行产品测试。

## 2026-10-27 · 分步骤稳定性首批修复

[PR #215](https://github.com/yuanbw2025/storyforge/pull/215)基于[施工计划 #212](https://github.com/yuanbw2025/storyforge/pull/212)，目前均未合并。本批实现损坏状态字段定位、逐字段修复、原始导出与并发保护，正文候选独立保存和切页保存屏障，并修复320px工具栏遮挡候选保存。非法值及稀疏数组在正式写回前拒绝。

最终产品源码`82436e01`的完整CI通过：928文件、5649测试通过、3项跳过；全套隔离浏览器347通过、5跳过。74项定向回归与390/320px六条触屏链通过。Agnes两条真实主链通过（含最终源码一次）；另有HTTP200无候选和未确认传输各一次，原失败与未知用量保留，不自动结案。

Windows/Android修复包、覆盖升级、原生Crash/OOM和正式发行仍待验证。工程通过不代表158项全范围验收完成。操作说明见[连续性与修复](/features/longform/continuity)。

## 2026-10-26 · 待合并开发续核

从成功维护基线 `648b6746` 核对至远程 main `63af1fba`，主干仅新增流量归档，产品指南继续沿用上轮已交付说明。本轮重新枚举 **196 个本地分支和 114 个工作区**（含维护分支及 detached），其中 136 个分支 head 尚非 main 祖先。以下记录核对时的新进展，旧日期段落保留历史快照。

| 分支 / 核对 head | 新进展 | 当前状态与去重 |
| --- | --- | --- |
| `fix/adventure-ui-integration-20261026` · `42caa40b` | 文字冒险复用产品外壳，保留工作区与存档导航，防止过期加载覆盖当前页面 | 已从早先 7 项未提交观察推进至[草稿 PR #208](https://github.com/yuanbw2025/storyforge/pull/208)，工作区干净；不再列作同一批未提交文件。原偶发整窗崩溃仍未稳定复现，新 head 检查待终态，不把旧测试失败或取消当通过。 |
| `fix/chapter-prompt-theme-20261026` · `0b1cbd51` | 逐章生成/续写前的多行要求确认，取消保留临时输入且不调用模型；辅助文字的主题对比度改进 | 开放 [PR #209](https://github.com/yuanbw2025/storyforge/pull/209)已推送、未合并，工作区干净；仍沿原候选与作者采纳链，未新增模型入口。当前检查按最终 head 记录，不由本任务重跑或排查产品测试。 |
| `fix/chat-narrative-flow-20261023` · `86318826` | 内容、系统配置、媒资三线装配；真实制作图片与运行中按剧情生成画面，含失败恢复和存档归属 | [草稿 PR #172](https://github.com/yuanbw2025/storyforge/pull/172)已更新并推送；原本地 `6ce48b22` 现为其祖先，不再报为未推送功能。工作区干净。技术主路径已有真实模型/图片记录；429、领域拒绝与跨图一致性限制保留，不宣称连续对话稳定或人工验收完成。 |
| `feat/ttrpg-entity-ai-20261016` · `ff7fcb4e` | 整合开放世界 #134 与知识库 #206，保留各产品独立的来源、恢复与运行合同 | 开放 [PR #196](https://github.com/yuanbw2025/storyforge/pull/196)未合并，head 已推送、工作区干净；世界实现与主干一致，历史失败与新回执分开保存。30+ 回合、独立真人与听感仍待验证。 |
| `feat/avg-media-integration-20261021` · `2d756dd5` | 有界只读音频输入校准及最终集成验收目标；正在整合主干 | 本地 head 有 1 个未被 origin 包含的目标文档提交。`avg-extension-contracts-20261015` 的 `MERGE_HEAD=63af1fba`；262 个状态条目中，243 个工作文件与 main 同 blob，其余 19 个涉及共享生产、恢复、注册表、包版本和回归的整合差异，不能算作 262 项新增功能。[草稿 PR #160](https://github.com/yuanbw2025/storyforge/pull/160)仍为 `534b3812`，不代表后续集成链已交付。 |
| `fix/open-world-pr134-handoff-20261026` · `ab408ba4` | PR134 阶段总结、已完成中央路线与后置验收的接续入口 | 开放 [PR #210](https://github.com/yuanbw2025/storyforge/pull/210)仅更新内部交接文档，尚未合并；不计新的玩家功能，也不代替后置校准与真人双结局验收。 |

22 个带状态条目的工作区分为 **8 个含工作文件变化、13 个退役静态资产核验副本、1 个纯测试缓存目录**。13 份删除逐项匹配退役清单与 HEAD blob；归档角色录制目录只有测试缓存，单独归类，不列为新增产品开发。AVG 两份音频工作区仍分别有 31、33 项，旧媒资恢复工作区有 100 项；原角色聊天工作区仍有 3 项计划/验收材料。相同 head、祖先、旧备份与已确认等价补丁继续去重，未替其他分支提交、推送、合并或清理。


## 2026-10-26 本轮完整核对

从上次成功维护基线 `c5a1cab7` 核对至远程 main `51688aee`。本轮完整枚举 **194 个本地分支（含维护分支）和 114 个关联工作区**，包含 detached；133 个分支 head 尚非 main 祖先。数量不是功能数，完整分支、路径、提交、差异与去重证据保存在维护记录。下方旧日期正文保留当时快照，当前状态以本节为准。

### 已进入主干

- [PR #195](https://github.com/yuanbw2025/storyforge/pull/195) 已合入 `87eec76a`：模块加载失败后的重试先保存编辑，再重新加载；保存失败保留页面。见[故障排查](/guides/troubleshooting#模块加载失败时怎样重试)。
- [PR #197](https://github.com/yuanbw2025/storyforge/pull/197) 已合入 `7cfdf8d9`：叙事世界工程成果及来源、查询、封存与修改影响链已整合，增强入口仍仅本地开发显式预览。原叙事世界分支不再整体列作待合并功能；语义准确度、正式规模性能、读者完整性与作者改稿/用时验收仍未完成。见[世界引擎](/features/world-engine#叙事世界的本地实验预览)。
- [PR #201](https://github.com/yuanbw2025/storyforge/pull/201) 已合入 `dc0f1e3a`：角色候选无效编辑显示错误并阻止采纳，原生历史故障按实际发生去重；不据此关闭原生崩溃、异常中断或内存问题。
- 大型合同修复已由 #185/#190 进入正式 v4.0.4，双语实际发行说明 #189/#191 也已合并。当前正式版本仍是 **v4.0.4**；上述后续主干增量与数据库 v12 的边界见[版本兼容说明](/updates/compatibility)。其余流量归档不计产品功能。

- 提交前主干前进至 `51688aee`：[PR #134](https://github.com/yuanbw2025/storyforge/pull/134) 已正常合并，开放世界三线制作、逐图确认、子 Build 返修与本地体验记录不再列作待合并功能。[指南](/features/interactive/open-world)已同步；Build18 仍为未发布预览，同一存档中央路线完成不代替双结局、独立模型和真人验收。

### 新增或推进的待交付开发

“未推送”以本轮获取的全部 origin 引用为准；未提交条目只说明观察范围，不表示已经完成。此轮不替产品分支提交、推送或合并。

| 分支 / head / 工作区 | 观察到的内容 | 状态与去重 |
| --- | --- | --- |
| `feat/avg-media-integration-20261021` · `cd0865b6`；`avg-extension-contracts-20261015/storyforge` | 两张来源图的区域编辑、本地有界表情处理、合成采纳与立绘播放 | 集成 head 已推送，但[草稿 PR #160](https://github.com/yuanbw2025/storyforge/pull/160)仍是 `534b3812`，不能代表这批增量已审完或合入。工作区另有 6 项文档、AVG 样式与配音回归修改。旧图声/前景系列分支为相关依赖或核验链，逐项保留差异，不按分支数计产品。 |
| `feat/avg-audio-consumption-20261022`、`feat/avg-audio-derived-production-20261022` · `17c9081f`；`avg-base00a-20261014`、`avg-base00b-20261014` | 配音制作/审阅、音频处理与消费、局部恢复控件及回归材料 | 同 head 的两个工作区仍分别有 31、33 项未提交内容，不是已完成的新功能；旧 `avg-media-recovery-20261016` 另有 100 项，`avg-media-harness-20261016` 有 2 项样式/回归修改。部分旧本地分支仍有未推送提交，已按补丁、依赖与实际文件去重，不自动补交。 |
| `fix/chat-narrative-flow-20261023` · `2bece4d0`；原角色聊天分支 `26fd6e29` | 开场行动归属、证据引用、角色表达与首轮恢复的单角色技术预览 | [草稿 PR #172](https://github.com/yuanbw2025/storyforge/pull/172)已推进到 `2bece4d0`，尚未合并。旧角色聊天与兼容分支属于同一后续链；真实模型仍保留预算中止、上游失败及领域拒绝，不宣称多轮质量验收。本地叙事流程 head 已推进到未推送的 `6ce48b22`，涉及图片绑定与文字任务路由；工作区另有 5 项制作服务/UI/媒资回归修改，原角色聊天工作区有 3 项计划/验收材料，均未提交。 |
| `feat/ttrpg-entity-ai-20261016` · `b372c41d` | 开放跑团作者设计、生产、发布开团、私域运行，以及本地旁白试听、调速和声线 | 已推送至开放 [PR #196](https://github.com/yuanbw2025/storyforge/pull/196)，未合并，工作区干净；不再沿用旧快照“12 个提交未推送、18 项未提交”的状态。后续数据库/备份桥仍属于该 PR；30+ 回合、独立真人与听感待验证，Qwen 本地合成限已配置运行库的 Apple 芯片 Mac。 |
| `feat/project-governance-api-20261023` · `5f0ff1a5` | 开发治理与本地 API 读取合同文档 | 2 个主干外提交已推送，未合入 main；属于工程规则，不列为用户产品功能，也不公开本机 API 配置。 |

`fix/adventure-ui-integration-20261026` 位于主干祖先 `dc0f1e3a`，`adventure-branch-transcript/storyforge` 另有 7 项未提交的文字冒险播放器、产品框架、导航、加载与回归文件；只登记观察范围，不宣称完成。

### 保留与去重

除本轮文档工作区外，24 个带状态条目的工作区中，**11 个含工作文件变化**；另外 13 个为旧跑团核验副本，删除项逐一匹配 `.codex-retired-assets.json` 与 HEAD blob，未把退役静态资产当成遗漏代码。未接管或清理任何副本。

历史备份、旧 UI、内置作品、仅 merge 提交、同 head 与补丁等价内容继续去重；主干已接纳的叙事世界工程和大型合同修复不再重复要求补交。保留分支并不等于发现新功能。本轮只运行直接相关的文档内容、双语、链接与构建检查；未运行产品测试。

## 2026-10-23 · 大型合同修复正式交付

本节仅专项更新发行状态，不重新核对下方其他开发分支。[PR #185](https://github.com/yuanbw2025/storyforge/pull/185) 已合入 `e4f2496d`，[发行准备 PR #190](https://github.com/yuanbw2025/storyforge/pull/190) 已合入 `8e82486a`；独立[发行流程](https://github.com/yuanbw2025/storyforge/actions/runs/39873499281)全部成功，正式 **v4.0.4** 已公开，固定源码 `d90961a2`。本次大型运行合同修复不再处于待发行状态，且不包含于 v4.0.3。准确发布时间、升级与数据边界集中见[版本兼容说明](/updates/compatibility)。下方 2026-10-22 的完整分支核对保留当时快照，不据发行自动判断其他工单或产品完成。


## 2026-10-22 本轮完整核对

从上次成功维护基线 `50062745` 核对至远程 main `463b6473`。本轮枚举 **186 个本地分支（含本轮维护分支）和 115 个关联工作区**，包含 detached；其中 136 个开发分支 head 尚非 main 祖先。提交数、文件条目数均不是功能数；本节为核对时的状态快照，完整路径、哈希、祖先、补丁及工作文件证据保存在维护记录。

### 已进入主干

- [PR #171](https://github.com/yuanbw2025/storyforge/pull/171) 的精细章纲前序候选快照及文风缺失统计修复已合入 `47d2c665`。本轮补齐[章纲恢复步骤](/features/longform/writing#精细章纲中断后怎样继续)和[文风统计说明](/features/longform/style-learning#sample-statistics-not-recorded)，不再把它们列为待合并功能。
- [PR #184](https://github.com/yuanbw2025/storyforge/pull/184) 已合入 `463b6473`，统一官网/后台问题的脱敏工单、修复、发行和回写流程，并准备 v4.0.3。当前正式发行仍为 v4.0.2；v4.0.3 的[发行工作流](https://github.com/yuanbw2025/storyforge/actions/runs/39765160155)尚在进行，版本事实见[兼容说明](/updates/compatibility)。
- 其余主干变化为交付验收、验证日期与流量归档，未据此新增产品操作或提高产品成熟度。长篇 #141/#165/#166 已合并的范围继续沿用现有指南。

### 新增或推进的开发

“未推送”按本轮获取的全部 origin 引用判断；未提交内容只登记观察到的范围，不代表已完成或验收。

| 分支 / head / 工作区 | 观察到的内容 | 状态与去重 |
| --- | --- | --- |
| `feat/avg-media-integration-20261021` · `88bfaea4`；`feat/avg-audio-consumption-20261022`、`feat/avg-audio-derived-production-20261022` · `17c9081f` | 前景和 PCM 音频处理基础、逐句增益草稿、已采纳处理语音的消费、立绘布局及保留恢复 | `88bfaea4` 有 15 个未被 origin 包含的提交，其中 13 个非 merge；多个音频/前景/图片分支是同一依赖链或核验副本。已推送的[草稿 PR #160](https://github.com/yuanbw2025/storyforge/pull/160)仍为 `534b3812`，不能用它代表后续本地提交已交付。 |
| `avg-base00a-20261014/storyforge`、`avg-base00b-20261014/storyforge` · `17c9081f`；`avg-extension-contracts-20261015/storyforge` · `88bfaea4` | 语音制作/审阅、音频处理与消费、局部修复控件、方案和回归材料 | 分别有 31、33、24 个未提交条目，包含未跟踪文件或已暂存修改；同基线副本仍有不同工作文件，保留各副本，不合并或覆盖。`avg-media-harness-20261016` 另有 2 项样式/回归修改，旧 `avg-media-recovery-20261016` 的 100 项观察范围继续保留。 |
| `feat/character-chat-optimization-20261006`、`fix/chat-regression-compat-20261022` · `26fd6e29` | 角色聊天行动依据、跨轮未答询问、开场审阅与可恢复制作链 | 已推送至[草稿 PR #172](https://github.com/yuanbw2025/storyforge/pull/172)，270 个主干外提交不能换算成功能数。两个分支同 head；作者工作区另有 2 项计划/验收材料，兼容核验工作区有 5 项历史读取/测试修改，未提交部分不据此宣称完成。 |
| `feat/ttrpg-entity-ai-20261016` · `34fc430a`；同名工作区 | 显式方法与 Oracle 预算版本、线索分享、待确认阶段策略、冻结版本中的下一阶段和兼容版本会话保持 | 216 个主干外提交中，12 个提交未被 origin 包含；工作区另有 18 项待提交的开放制作/兼容开场及方案修改。沿用现有 owner 与候选边界，尚未合并，未替作者提交或推送。 |
| `feat/text-open-world-productization-20261013` · `d330c653`；`open-world-productization/storyforge` | 三线生产、图片确认、网页分发与本地反馈；正在同步最新主干 | [PR #134](https://github.com/yuanbw2025/storyforge/pull/134)仍未合并；本地仅 1 个未被 origin 包含的 merge，无新增未推送非 merge 提交。工作区实际 `MERGE_HEAD=463b6473`，22 个状态条目中 16 个与最新 main 完全同 blob，其余含版本、指标和双方更新记录；不把主干同步文件重复计为开放世界新功能。 |
| `fix/agent-contract-event-size-20261021` · `9653011a` | 合法大合同与 accepted/revised 事件快照统一有限 UTF-8 字节预算 | 已于 2026-10-22 正常合并 [PR #185](https://github.com/yuanbw2025/storyforge/pull/185)，合并提交 `e4f2496d`；最终完整 CLI 4602 项、浏览器 311 通过/4 按环境跳过，常规 CI 成功。关联 [Issue #178](https://github.com/yuanbw2025/storyforge/issues/178)，待后续正式 v4.0.4 交付，不含于 v4.0.3。 |
| `narrative-world-design`、`nw2e-retrieval-repair`、`nw-mainline-refresh-20261016` | 原有叙事投影、来源、检索及治理整合，附大量验收材料 | 原开发链仍未合并。`nw-mainline-refresh` 的实际 merge parent 为 `16b006fd`；大量未跟踪验收产物和同步文件不代表新增功能。与旧设计/备份的等价补丁、同 head 和祖先关系继续去重，不接管或清理工作区。 |

### 保留与去重

28 个带状态条目的工作区中，14 个含工作文件变化，13 个是旧 TTRPG 核验副本中登记退役的静态资产，1 个只有测试缓存。13 份副本的每项删除都重新匹配 `.codex-retired-assets.json` 与 Git blob，不当作待提交代码，也不自动恢复。已合并长篇、历史 UI、内置作品、备份、仅 merge 与等价补丁继续保留先前的去重结论。

本轮仅维护知识库，不运行产品测试或修改其他开发内容；下方旧日期正文保留为历史快照，当前状态以上述记录为准。



## 2026-10-20 本轮完整核对

从成功维护基线 `9e480ac7` 核对至远程 main `38104e61`。本轮完整枚举 **175 个本地分支（含维护分支）和 112 个关联工作区**，包含 detached；127 个分支 head 尚非 main 祖先。分支数量、提交数量和工作文件条目均不是功能完成数，完整路径、提交、补丁与差异证据保存在本轮维护记录。

### 已进入主干

- [PR #165](https://github.com/yuanbw2025/storyforge/pull/165) 的长篇入口整合、替换和保存保护已合入 `a45cb1db`；[PR #141](https://github.com/yuanbw2025/storyforge/pull/141) 的系统文规划、全章评审与范围修订已合入 `1b96e80a`。这些原待交付能力已有[长篇指南](/features/longform/)、[规划](/features/longform/planning)、[正文与审修](/features/longform/writing)和[节点说明](/features/nodes)，不再重复列作遗漏功能。
- [PR #166](https://github.com/yuanbw2025/storyforge/pull/166) 已合入 `b344cc0b`。本轮补齐续写准备失败的错误提示、拒绝细纲失败时保留候选的[处理步骤](/features/longform/writing)，以及[更新日志](/updates/changelog)。
- [PR #169](https://github.com/yuanbw2025/storyforge/pull/169) 的长篇交付说明已合入 `66763953` 并完成知识库部署。文档中的独立评测状态继续保留，不把工程通过当作文学收益。
- 最新正式发行仍为 [v4.0.2](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.2)，固定源码 `04de86d7`；版本事实集中见[兼容说明](/updates/compatibility)。流量 CSV 归档不计产品能力。

### 活动分支与工作区

以下为核对时的快照。“未推送”按全部已获取的 origin 引用判断；未提交内容只登记观察范围，不宣称完成，也不替作者提交、推送或合并。

| 分支 / head / 工作区 | 内容 | 状态与去重 |
| --- | --- | --- |
| `feat/avg-combined-stage-20261020`、`feat/avg-publisher-stage-release-20261020`、`feat/avg-v5-native-workbench-20261019`、`feat/avg-v5-review-validation-20261018` · `534b3812` | 图声制作工作台、视觉方案和本地衍生、固定声线与本地音乐、作者配置、原型版本、声音后继版本及冻结恢复 | 已推送至[草稿 PR #160](https://github.com/yuanbw2025/storyforge/pull/160)，未合并。V5 配置、媒资、历史、声音等系列分支是依赖链；同 head 不重复算多套能力。 |
| `feat/avg-combined-native-20261020`、`fix/avg-pending-voice-recovery-implementation-20261020`、`fix/avg-pending-voice-recovery-revision-20261020` · `f44bf5f8`；`feat/avg-foreground-processing-contract-20261020` · `d08d2610` | 环境音来源/许可核验、生成语音写入范围、一次性音频恢复、中断声道独立恢复；前景处理工作包方案 | `f44bf5f8` 链有 6 个未被 origin 引用包含的提交；`d08d2610` 继承该链并增加 1 个方案文档提交，前景处理不据此声明已实现。不同集成或核验分支 `55ea0efa`、`f451b4d9`、`a8e8d961`、`628f6f1f` 保留各自差异与证据，公共范围去重。 |
| `avg-base00a-20261014/storyforge`、`avg-extension-contracts-20261015/storyforge`、`avg-media-harness-20261016/storyforge` · `f44bf5f8`；`avg-media-recovery-20261016/storyforge` · `4b40877b` | 音频恢复控件、组装和资料、核验用例/CI/展示样式；旧媒资处理与恢复开发 | 分别有 2、9、14、100 个未提交条目。前三处共享同一提交基线，但工作文件不同，不覆盖或合并副本；第四处沿用原有未提交观察范围。未提交条目不当作已验收功能。 |
| `feat/character-chat-optimization-20261006` · `2a2aae10`；`character-chat-plan/storyforge` | 角色聊天播放器媒资、作品包流程、会话导航恢复；工作区另涉及行动选择/预算、控制权交接、开场延续与修复、来源观察 | 239 个主干外提交均未被 origin 引用包含，其中 231 个非 merge；无对应开放 PR。另有 252 个未提交条目，包含实现、方案、用例和核验材料；相较上轮继续推进，完成范围仍待作者收口。临时核验 head 按祖先关系并入同一链。 |
| `feat/ttrpg-entity-ai-20261016` · `0c99f468`；`ttrpg-entity-ai-20261016/storyforge` | 开放制作、原请求与配音恢复、本机双声线、拒绝作者输入后恢复而不确认、按已登记用途限制输出 | 已推送，[草稿 PR #128](https://github.com/yuanbw2025/storyforge/pull/128) 未合并；其记忆、局势、回顾和声音系列分支按依赖链去重。工作区另有 35 个未提交条目，涉及行动输入、公共局势、调用证据和原请求恢复，只登记观察范围。 |
| `feat/text-open-world-productization-20261013` · `aa8f6d2b`；`open-world-productization/storyforge` | 三线生产、图片确认、人审、本地反馈及生产/预算恢复 | 已推送，[PR #134](https://github.com/yuanbw2025/storyforge/pull/134) 未合并。工作区正合入主干 `fe87ece4`，144 个状态条目包含同步与产品改动；按真实 merge 父提交保留比较证据，不将所有条目当作新增功能。 |
| `feat/narrative-domain-projection-20261014`、`feat/narrative-reader-provenance-20261015` · `16b006fd`；`feat/narrative-world-integration-20261016` · `8197579a` | 叙事投影、IR、语义索引、精确读取、来源和采纳/生命周期集成 | 仍有 5 个主干外仅本地提交（含 1 个 merge）。`narrative-world-design`、`nw2e-retrieval-repair`、`nw-mainline-refresh-20261016` 三处保留未提交开发与大量核验材料；原有未交付结论未变，不将产物增多当作新增功能。设计副本的同 head 与等价补丁继续去重。 |

### 已去重与保持原状的内容

长篇主体及 Q01～Q10 相关开发已随 #141 进入 main。`e95f188d`、`f44ef5c6`、`3521a8d4` 与 main 中补丁等价；旧核验分支余下的是测试同步、核验或历史文档，不登记为另一套未交付长篇功能。AVG 既有别名 `22bafcf4`、`a522a380`、`969d1928`、`691154d0` 有已推送等价补丁；`023310fb` 与后续 `e2a0ae36` 的生产/测试文件相同，沿用此前去重证据。

26 个有状态工作区中，**12 个有工作文件改动，13 个是旧跑团核验目录的静态资产回收，1 个仅有测试缓存**。13 处删除再次逐项匹配 `.codex-retired-assets.json` 与 Git blob，不当作待补交代码，也不自动恢复。旧内置游戏和宣传截图 CSS 范围沿用原结论；旧内置作品已由 #111 进入 main。历史雾港、世界媒资、旧开放世界、青铜 UI、备份及已明确废弃的 9 月 12 日 UI 不重新提出合并。

本轮只维护公开知识库，未运行产品测试，也未改动或清理作者分支、工作区及浏览器数据。下方旧日期记录保留为历史快照，当前状态以上文为准。

## 2026-10-20 长篇质量专项已进入主干

[PR #141](https://github.com/yuanbw2025/storyforge/pull/141) 已于 10 月 20 日合并为 `1b96e80a`。原系统文元素、场景任务、全文评审与范围修订不再是待合并开发；使用步骤已转入[规划](/features/longform/planning)和[正文与审修](/features/longform/writing)，版本边界见[更新日志](/updates/changelog)。节点模式整体继续为预览。

`fb682a28` 的完整 CLI（824 文件 / 4594 项）、完整浏览器（309 通过 / 4 项环境条件跳过）及最新主干合并树的常规 CI 均通过。三题材两组各十章共 60 稿 / 30 对另加双模型新设定 12 稿 / 6 对已完成流程、请求与生命周期核验，差稿与失败保留。用户将独立读者盲评、独立作者修稿计时移为后续自愿研究；本轮不再需要招募，缺失结果未记为通过，独立质量和省时收益仍未验证。生成侧实验标签暴露与采样评审要求遗漏等限制保留，不作严格盲测或平台质量认证。

以下较早日期段落保留当时的分支快照；其中 #141 尚未合并的描述以本节为准。本次只更新该长篇专项，不重判其它开发分支。

## 2026-10-19 长篇质量反馈迭代（开发分支）

[PR #141](https://github.com/yuanbw2025/storyforge/pull/141) 继续处理实际作者修稿暴露的人物反应、对白衔接与结尾问题；正文、全章评审、范围修订和复核共用策略与作者确认链。评审区分内部事实矛盾、明确任务遗漏和表达偏好，避免润色时删掉原有关键条件。四份项目内作者微场景修稿已回收，尚不足以证明正式独立文学收益或修稿成本下降。

在正文的“质量审校”中，可分别填写“本轮评审补充要求”和“本轮修稿要求”；先选实际问题、可改段落和保护原句，再运行一次修订与一次复核。保存的报告和修订对照能回查实际作者要求，刷新后恢复。模型建议仍须作者判断，失败、未知结果和旧候选保持原有恢复与过期边界。

旧源码 `1b854005` 的完整工程检查已通过（4495 测试，生产代理 3 项，浏览器 293 通过 / 2 跳过）；同步主干后的新提交按实际 head 重新验证，以 PR 记录为准。该分支尚未合并、部署或进入现有下载包；下方旧日期段落保留当时快照。

## 2026-10-19：角色聊天候选流程 {#character-chat-candidate}

本节仅核对 `feat/character-chat-optimization-20261006`：已提交基线为 `a4f16fd9`，其后观察到尚未提交的角色聊天增量。它们尚未合入 main、进入固定下载包或公开部署；下方10月16日“工作区干净”的记录只代表当时状态。

候选界面增加图片与设备语音、外部角色卡转换、完整体验包安装/导出、兼容版本的存档副本，以及三类默认隐藏的原创起稿。存档升级保留原档，剧情或人物知识改变时不能强行承接。原创起稿仍须作者完成来源检查、制作与发布，不是已交付体验包。候选操作说明见[角色聊天](/features/interactive/character-chat#开发分支中的新流程-尚未发布)。

上一整合候选的完整浏览器回归为402项通过、4项环境条件跳过；完整CI出现5项超时，原限制下的定向复查已通过，但不能代替完整CI。最新已获取主干 `d3df49a3` 新增共享采纳与长篇改动，整合后版本须重新完成工程验证；真实模型剧情效果与独立试玩尚未收口。工程长负载通过不能代替故事质量或商业验收。本节不重判其他产品分支。

候选增量现还包括随发行冻结的作品署名与使用说明，并修正了先装新版导致完整备份失败的安装编号问题；完整验证仍在进行。

## 2026-10-18 本轮核对

从上次成功维护基线 `404ee3bf` 核对至最新远程 main `9cc1f4cf`。完整枚举 **136 个本地分支（含维护分支）和 112 个关联工作区**，包含 detached；102 个分支 head 尚非 main 祖先。这些是 Git 身份数量，不是遗漏功能数。完整分支、路径、提交、补丁和工作文件差异保存在本轮维护证据中。

### 已交付与使用说明

- [PR #153](https://github.com/yuanbw2025/storyforge/pull/153) 已合入 main `8197579a`；[v4.0.2](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.2) 于 10 月 16 日发布，固定源码 `04de86d7`。Windows/Mac 安装器、Android APK 与四平台便携 ZIP 均有正式附件。[安装指南](/getting-started/install)列出平台选择、首次协议、更新及备份步骤。
- “通用设置 → 问题与建议”里的“报告问题”“功能建议”进入维护者私有收件箱，可选择附带预览过的诊断摘要。备用网页表单创建公开 GitHub Issue。本轮修正仍写“开发中”的反馈说明并补齐[操作步骤](/guides/troubleshooting#下载版的问题与故障反馈)及[隐私说明](/guides/privacy)。
- 上轮文案调整 [PR #162](https://github.com/yuanbw2025/storyforge/pull/162) 已合入并完成部署。两天内其余主干提交为流量归档，不计产品功能更新。

### 活动开发与待交付内容

| 分支 / 核对 head | 观察到的内容 | 状态与去重结论 |
| --- | --- | --- |
| `feat/avg-v5-formal-foundation-20261018`、`feat/avg-versioned-planning-validation-20261018`、`feat/avg-visual-recovery-20261017` · 同为 `b5a2f629` | 专业媒资用途和人物/道具家族、视觉方案与请求编译、原图保存/导入/恢复、显式复用与新版本、历史只读核验、费用与失败证据、配音制作衔接 | 已推送至[草稿 PR #160](https://github.com/yuanbw2025/storyforge/pull/160)，未合并。视觉/历史/原图/本地处理系列分支为依赖链，三个相同 head 只计一次。`avg-extension-contracts-20261015/storyforge` 有 34 个未提交条目，涉及版本化视觉方案、来源与组装；只记录观察范围。 |
| `feat/avg-media-recovery-20261016` · `4b40877b`；`avg-media-recovery-20261016/storyforge` | 媒资工作台、受治理图片处理、组装、采纳及恢复 | head 已推送，尚未进入 main；工作区另有 100 个未提交条目，包含代码与用例，不能据此声称新功能已完成。与上一行共享 AVG 基础，重叠不重复计算。 |
| `feat/character-chat-optimization-20261006` · `a4f16fd9`；`character-chat-plan/storyforge` | 角色定向、行动与历史、关系与私域记忆、咨询和来源；工作区另涉及会话范围、受众、开场审阅、私有角色与运行恢复 | 233 个主干外提交均未被 origin 引用包含，其中 226 个为非 merge 提交；无对应开放 PR。相较上轮继续推进，另有 162 个未提交条目。临时核验 head 是这条链的祖先，不当作多套功能。 |
| `feat/ttrpg-entity-ai-20261016` · `9e053308` | 模板内实体与逐人确认、局势采用、原始配音任务、审阅和试听；最新提交在作者明确审阅后结束原始配音生成 | [草稿 PR #128](https://github.com/yuanbw2025/storyforge/pull/128) 已推送至 `9e053308`，尚未合并；提交文档前已重新获取远程并确认包含最新配音审阅提交。记忆、回顾、局势和语音分支属于同一后续链，方案 [#124](https://github.com/yuanbw2025/storyforge/pull/124) 与共享读取底座 [#150](https://github.com/yuanbw2025/storyforge/pull/150) 仍未合并。 |
| `feat/narrative-domain-projection-20261014`、`feat/narrative-reader-provenance-20261015` · `16b006fd`；`feat/narrative-world-integration-20261016` · `8197579a` | NW-0B/1A/1B 已提交底座；工作区继续包含语义索引、投影、精确读取、来源、候选采纳、生命周期及集成改动 | 前两个 head 的 5 个主干外提交仍仅本地（含 1 个 merge）；设计分支同 head/等价补丁已去重。三个相关工作区有未提交内容：`narrative-world-design`、`nw2e-retrieval-repair`、`nw-mainline-refresh-20261016`。集成 head 在 main 不代表其未提交开发已合入；核验材料和产物不按文件数计成功能。 |
| `feat/text-open-world-productization-20261013` · `aa8f6d2b`；`open-world-productization/storyforge` | 三线生产、图片确认、人审与本地反馈；工作区继续涉及规则、目录生产、任务预算及恢复 | 已推送，[PR #134](https://github.com/yuanbw2025/storyforge/pull/134) 未合并；另有 39 个未提交条目，其中 2 个工作文件与最新 main 相同，37 个不同。既有内容、主干同步和当前改动分开记录，不替作者提交。 |
| `feat/longform-quality-m2-20261014` · `1b854005`；既有 AVG 系统链 `36b3e55f` | 长篇系统文要求、质量审校和范围修订；AVG 规则、播放器、作者工作台、组装及资源窗口 | 长篇 [#135](https://github.com/yuanbw2025/storyforge/pull/135)、[#141](https://github.com/yuanbw2025/storyforge/pull/141) 与 AVG [#133](https://github.com/yuanbw2025/storyforge/pull/133)、[#137](https://github.com/yuanbw2025/storyforge/pull/137)、[#140](https://github.com/yuanbw2025/storyforge/pull/140)、[#143](https://github.com/yuanbw2025/storyforge/pull/143) 及后续系统链仍未合并，head 范围与上轮相同；不重复作为新增遗漏提醒。#156/#157 同 head。 |

### 等价提交、旧核验目录与未提交内容

以下本地提交已有推送的相同补丁：AVG `22bafcf4` → `336b3f6c`、`a522a380` → `537bb309`、`969d1928` → `c2d955db`、`691154d0` → `ad51277b`；长篇 `3521a8d4` → `ff257777`、`f44ef5c6` → `3ccb0acc`、`e95f188d` → `bcc2c908`。`023310fb` 与 `e2a0ae36` 的生产代码和测试文件完全相同，差异只在生成的架构指标。它们不算待补交的新产品功能。

23 个有状态工作区分为：**9 个包含工作文件改动的工作区**、13 个已按 `.codex-retired-assets.json` 回收静态资产的旧跑团核验目录，以及 1 个纯 `.vite-e2e-cache/` 目录。13 处删除逐项匹配清单与 Git blob，不当作产品文件遗漏，也不自动恢复。9 处中的旧内置游戏、宣传截图 CSS 范围与前轮相同；旧内置作品已由 #111 进入 main，不重复算新增开发。

历史雾港、世界媒资、旧开放世界、青铜 UI 与备份分支继续沿用已核对结论；仅 merge 的提供商备份不计功能，已明确废弃的 9 月 12 日 UI 不重新提出合并。本轮未提交、推送、合并或清理其他开发，未运行产品测试。下方旧日期内容保留为历史快照。

## 2026-10-16：客户端交付更新

[PR #153](https://github.com/yuanbw2025/storyforge/pull/153) 的 4.0.2 客户端提供 Windows、Mac 和 Android 安装包、应用内更新与问题建议入口，iOS 暂缓。首次启动直接显示可离线阅读的统一《用户协议》，个人信息与隐私保护内容包含在正文内；阅读并同意后进入软件。设置中可再次查阅协议，手动问题与建议仍需检查后确认发送。

安装方式与系统限制见[安装说明](/getting-started/install)，正式附件以 [v4.0.2 发行页](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.2)实际公开的文件为准。下方核对记录保留为当时的分支快照，其中客户端待交付状态以本节及发行页为准。

## 2026-10-16 本轮核对

增量范围：上次成功维护基线 `1c6bb315` → 远程 main `451ac153`。本轮完整枚举 **103 个本地分支（含维护分支）和 121 个关联工作区**，包含 detached；74 个分支 head 尚非 main 祖先，20 个工作区有未提交状态。这些是核对时的 Git 快照，不是功能数或完成数。全部路径、提交、文件差异与补丁等价证据保存在本轮维护记录，作者工作区只读。

### 主干、固定包与知识库

- [PR #139](https://github.com/yuanbw2025/storyforge/pull/139) 的不透明知识库导航、[PR #144](https://github.com/yuanbw2025/storyforge/pull/144) 的主动故障反馈已合入并完成知识库部署，本轮保留已有双语说明，不重复制造功能更新。
- 当前最新正式下载为 [v4.0.1](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.1)，固定源码 `e8ce0a0d`，已提供四平台便携 ZIP。它包含故障摘要预览和作者主动反馈，**不包含首次启动、日活和留存统计**。
- [PR #158](https://github.com/yuanbw2025/storyforge/pull/158) 的大纲候选采纳修复于北京时间 10 月 16 日合入 `ce49309b`，晚于固定 v4.0.1；本轮补齐[操作说明](/features/longform/writing)及[更新日志](/updates/changelog)。流量 CSV 归档不计产品功能。

### 尚未进入 main 的开发

“仅本地”指提交不被已获取的任何 origin 分支包含；领先旧 upstream 不等于未推送。下表描述分支中观察到的实现或文档范围，不表示本轮验收产品、已合并或已发布。存在祖先/同 head 的分支合为开发链；旧历史结论继续保留在下方。

| 分支 / 核对 head | 观察到的范围 | 状态与去重 |
| --- | --- | --- |
| `feat/character-chat-optimization-20261006` · `35b5c545`；`character-chat-plan/storyforge` | 角色定向、行动与历史分支、咨询候选、私域记忆审阅、来源选择、恢复、历史读取和缓存预算 | 222 个主干外提交均未被 origin 引用包含，含合并/文档，不是 222 项功能；无对应开放 PR。工作区当前干净；10 个临时 detached 核验 head 是这条链的祖先，不重复登记为独立实现。 |
| `feat/longform-quality-m2-20261014` · `1b854005` | 系统文作者要求、可选场景任务、全文质量审校、问题范围修订与复核、正文草稿恢复、节点同源流程、试读/修稿 HTML | 已推送，[草稿 PR #141](https://github.com/yuanbw2025/storyforge/pull/141) 未合并；Q01 [#135](https://github.com/yuanbw2025/storyforge/pull/135)、Q02–Q10、问卷、模型目录校准及质量集成分支属于同源链，不能累加当作独立产品。文学效果与真人验收不能由本轮文档核对证明。 |
| `fix/longform-quality-final-docs-20261015` · `3521a8d4`；`fix/longform-chapter-clear-receipt-20261015` · `e95f188d` | 长篇试用文档、质量里程碑与测试等待调整 | 分别有 2 个和 1 个未被 origin 引用包含的提交记录；双语试用文档已有后续推送版本 `ff257777`，清章等待有后续 `bcc2c908`。按实际文档/测试范围核对，不误报为三项缺失产品功能；不替作者提交或推送旧副本。 |
| `feat/avg-base00a-20261014` · `18218f73`、`feat/avg-base00b-20261014` · `13ce6792`，到 `feat/avg-extension-contracts-20261015` · `36b3e55f` | AVG 版本化承载与旧包兼容、作者规则采纳、确定性编译、播放器/背包/阅读历史、音频屏障、作者工作台、组装、场景资源窗口、原型发布与舞台效果 | 已推送；[#133](https://github.com/yuanbw2025/storyforge/pull/133)、[#137](https://github.com/yuanbw2025/storyforge/pull/137)、[#140](https://github.com/yuanbw2025/storyforge/pull/140)、[#143](https://github.com/yuanbw2025/storyforge/pull/143)、[#145](https://github.com/yuanbw2025/storyforge/pull/145)、[#146](https://github.com/yuanbw2025/storyforge/pull/146)、[#148](https://github.com/yuanbw2025/storyforge/pull/148)～[#149](https://github.com/yuanbw2025/storyforge/pull/149)、[#151](https://github.com/yuanbw2025/storyforge/pull/151)～[#152](https://github.com/yuanbw2025/storyforge/pull/152)、[#154](https://github.com/yuanbw2025/storyforge/pull/154)～[#157](https://github.com/yuanbw2025/storyforge/pull/157) 均未合并。多为依赖式分支，同 head 的 #156/#157 不算两套功能。 |
| `feat/avg-media-production-20261016` · `eab861ce`、`feat/avg-media-harness-20261016` · `4d51e5eb`、`feat/avg-media-recovery-20261016` · `ada77ead` | owner 范围内参考图交接、可选生图工作台、显式选择与草稿配置、恢复构建、人像家族和继承舞台图 | 已推送，[草稿 PR #160](https://github.com/yuanbw2025/storyforge/pull/160) head 为恢复链 `ada77ead`，尚未合并；三分支共享既有 AVG 基础，不当作主干已具备的完整媒资生产。 |
| `feat/ttrpg-open-main-integration-20261015`、`feat/ttrpg-public-situation-adoption-20261016`、`feat/ttrpg-public-situation-runtime-20261016` · 同为 `8dc5d3cf` | open 规则结算与恢复、私域记忆/检索、阶段回顾候选与显式确认、会话局势目录、局势生成与审阅、确认事实交回世界作者审查 | 已推送，[草稿 PR #128](https://github.com/yuanbw2025/storyforge/pull/128) 未合并；读取/记忆/回顾/局势系列分支是依赖链，三个同 head 合为一次实现。方案 [#124](https://github.com/yuanbw2025/storyforge/pull/124) 与链中共享文档；共享读取底座 [#150](https://github.com/yuanbw2025/storyforge/pull/150) 也未合并。`public-situation-delegation` 工作区另有 11 个未提交条目，涉及授权、候选、采用与局势核验，只登记观察范围。 |
| `feat/narrative-domain-projection-20261014`、`feat/narrative-reader-provenance-20261015` · 同为 `16b006fd`；`feat/narrative-world-integration-20261016` · `ce49309b` | 已提交 NW-0B 基线、NW-1A 身份/时间与 IR、NW-1B 叙事投影；工作区另涉及语义索引、精确读取、来源、采纳、生命周期与集成 | 前两个 head 的 5 个主干外提交均仅本地（含 1 个 merge）；集成分支 head 已在 main，但工作区有未提交开发，不能因此判断开发已合入。15 个相关工作区（含 detached）有大量重叠代码、核验材料与产物；不把核验副本和文件数算作新功能。设计双分支同 head，设计补丁等价于链内提交，去重。 |
| `feat/client-feedback-metrics-20261015` · `04de86d7`；`feat/windows-android-clients-20261015` · `059cd745` | Windows/Mac/Android 客户端、应用内更新、首次协议、私有反馈、用户可控的活跃与错误统计、原生保存/升级衔接 | 均已推送，[PR #153](https://github.com/yuanbw2025/storyforge/pull/153) 及[草稿 PR #142](https://github.com/yuanbw2025/storyforge/pull/142) 未合并。后续分支的 4.0.2 版本声明不代表正式发行；当前下载仍为 v4.0.1，不能据此声称已统计安装、日活或留存。 |
| `feat/text-open-world-productization-20261013` · `7ebb2fe5` | 三线生产、图片逐项确认、装配/发布人审与本地反馈；当前工作区还观察到恢复、生产核验相关差异 | 已推送，[PR #134](https://github.com/yuanbw2025/storyforge/pull/134) 未合并。64 个状态条目中，49 个工作区文件与最新 main 内容一致，为同步内容；其余 15 个仍不同，不能把全部 64 个都说成新功能或全部已完成。 |
| `fix/test-temp-lifecycle-20261015` · `707b30fd` | 测试临时目录清理与活动运行保护 | 已推送，[草稿 PR #147](https://github.com/yuanbw2025/storyforge/pull/147) 未合并；工程工具变化，不是用户新产品。 |

### 未提交与历史副本的处理

20 个有状态工作区中，15 个属于上面的叙事底座及核验副本，另有开放世界、跑团局势、旧内置游戏、宣传截图 CSS 各 1 处，以及 1 处纯 `.vite-e2e-cache/` 缓存。核验目录中的运行证据和反复生成的材料不按文件数报告为产品开发；不同副本仍有差异，保留证据待作者收口，不自动覆盖或清理。

旧内置作品已由 #111 迁入 main，旧雾港、世界媒资、历史开放世界、青铜 UI 与备份分支继续沿用下方已核对结论。`feat/codex-provider-merge-20261010` 仅剩独有 merge，无新增普通补丁。9 月 12 日旧 UI 已明确废弃；不重新提出合并。历史分支存在不代表应采用旧架构。

本轮只更新公开知识库，未提交、推送、合并或清理任何上述产品开发；不运行产品测试、整仓 CI 或浏览器回归。下方旧日期正文完整保留为历史快照，不覆盖本节状态。

## 2026-10-15 长篇质量专项（开发分支） {#longform-quality-trial}

本节只核对系统文长篇 Q02～Q10，不更新下方其它产品的历史快照。[草稿 PR #141](https://github.com/yuanbw2025/storyforge/pull/141) 的产品源码为 `c2836ba8`，尚未合并或部署；现有 v4.0.0 下载包与官网体验不包含本节新增操作。以下供该开发分支试用，节点模式继续标为预览。

### 从元素到正文

1. 在“作品概况”选择题材，在“故事设计 → 创作规则 → 系统文元素”填写主角处境与目标、系统机制、奖励与成长、限制与代价、对抗力量与人物关系。勾选“启用这些系统文作者要求”，点击“保存元素”，核对“元素已保存”。各项可留白；停用保留内容，奖励计划不会自动成为已获得物品，也不会替换你选中的提示词模板。
2. 在“大纲与章纲”选中本章，进入“场景细纲”。展开“场景任务（可选，可留白）”，按需填写进入状态、本场目标、关键选择、行动后果、退出状态、场景功能与读者期待。日常、缓冲与收尾也可以使用，不要求每场都有敌人或惩罚。
3. 使用本章细纲与正文之间的跳转，等待当前修改保存，再进入同一章节。保存失败先保留并重试当前输入。生成或手写正文后，核对内容与候选，再决定是否采纳；字数目标不是精确长度保证。

### 全章评审与范围修订

1. 在正文工具栏打开“质量审校”，选择“审校”“表达与重复”或“追读力”，点击“开始检测”。报告针对当前已保存正文，显示完整送审与引文依据；无法完整送审时会阻止检测。完整送审不保证模型发现全部问题。
2. 勾选本轮要处理的问题。默认只修改问题所在段落；可展开“选择其它可改段落”，并在“保护原句”中每行填一句需要原样保留的文字。
3. 点击“生成修订并复核”。本轮最多一次修订和一次复核，额外最多两次模型请求。等待复核结果后比较原稿与修订稿，再选择“确认采纳修订”或“放弃修订”。未通过复核只保留预演，不写回正文。
4. 重新打开可回读保存的报告和决定，不会因此自动重发。正文或相关资料变化后，旧报告和候选可能过期；先处理变化，再明确开始新一轮。模型建议、未发现问题和“模型认为已有改善”都不能代替作者判断。

### 在节点模式使用同一流程

连接“全文评审与修订”与“定向修订与复核”节点，在修订节点选择问题和范围；可接入 Prompt、温度、输出上限及 AI 配置。运行后等待正式候选和完整复核结果，再在运行结果中确认采纳或拒绝，返回分步骤核对同一正文及格式。

确认上游后继续下游会重读当前资料，并复用仍有效的已确认内容。改变资料、目标或连线后，旧候选仍可能失效；刷新恢复不会自动再次生成。

### 正式试读文件怎样交回

组织者按参与者和题材分配正式 HTML，同一编号不要分给多人。用浏览器打开，点选参与情况和阅读答案，点击“保存已填写 HTML”，将文件名带 `result` 的新 HTML 交回。答案已在文件内，换设备或离线打开可继续，无需导入额外数据；最初的空白文件不会自动覆盖。群内预览无法操作时请改用浏览器或电脑。

可以先读首组并交回，再分次完成；首组约 19～37 分钟，完整十组因题材不同约 197～453 分钟，均为篇幅估计。实际作者使用另发的修稿 HTML，亲自修改四份稿并保存修稿与计时，估计约 66～137 分钟。作者任务需要改正文，读者问卷无需输入文字评语。网页自动回收尚未部署。

### 已有证据与待完成项

正式对照已冻结为三题材 60 章 / 30 对，另有不同模型的三组成对稿。已有 1900 项主对照精确核对及六个工作区的备份、导入与删除证据；[Linux 四条审修路径](https://github.com/yuanbw2025/storyforge/actions/runs/38682424600)通过；产品源码 `c2836ba8` 的[主 CI](https://github.com/yuanbw2025/storyforge/actions/runs/38682961173)与[完整 CLI](https://github.com/yuanbw2025/storyforge/actions/runs/38682961091/job/116251468491)通过，主 CI 的完整浏览器检查为 288 项通过、1 项重试后通过、2 项跳过。另一独立整套浏览器运行仍有 1 项失败和 2 项重试后通过：原始轨迹显示自动清空未实际删除文字、战斗操作尚在结算。三文件测试同步补丁保留结果断言与总时限，本地五条相关路径通过；补丁后的 Linux 与最终版本整套验收仍待收口。独立读者答卷和实际作者修稿结果尚为零，不能据此宣称文学质量提升、达到平台签约要求或完成 Q10。

## 2026-10-14 本轮核对

增量范围：上次成功基线 `ce1cfd6c` → 最新远程 main `cfc5ed3f`。完整枚举 **51 个本地分支（含本轮维护分支）及 68 个关联工作区**，含 detached；23 个本地分支 head 尚非 main 祖先。数字是 Git 身份关系，不是 23 项遗漏功能。作者工作区只读，下面记录的是核对时快照，后续提交和 PR 状态可能继续变化。

### 已交付变化

- [PR #119](https://github.com/yuanbw2025/storyforge/pull/119) 已合入 `e40fadce`：文字冒险保图定稿修订、生产证据和备份恢复、任务结算、分支正文隔离及独立网页游戏导出已进入 main。详见[操作指南](/features/interactive/text-adventure)和[更新日志](/updates/changelog)。原快照中的“PR #119 待合并”已失效。
- v4.0.0 已在 2026-10-13 正式发布，固定源码 `78416965`；[安装指南](/getting-started/install)、[模型配置](/getting-started/model-config)和[兼容说明](/updates/compatibility)区分便携下载、后续 main 与官网体验。#119 晚于固定发布包，不宣称已有下载自动包含这些改动。
- 官网体验、顶部导航、README 和公开统计隐私说明已有主干文档，本轮补查后保留；流量 CSV 归档不计作产品功能。官网图形替换属于独立平台仓库的展示调整，不代表编辑器新增能力。

### 新增或仍活动的未交付开发

“仅本地”按当前获取的全部 origin 引用判断，不按落后 upstream 的领先数判断。以下均未进入 main，不能按此表当作已上线操作指南。工作区名相对本机 `.codex/worktrees/`；完整路径、提交与补丁证据保存在本轮维护记录。

| 分支 / 核对 head | 观察到的范围 | 状态与去重 |
| --- | --- | --- |
| `feat/character-chat-optimization-20261006` · `b2aefa94`；`character-chat-plan/storyforge` | 角色定向与情境、行动候选、历史修订/分支、逐轮节奏、上下文证据、会谈采纳、草稿持久化、失败和备份恢复 | 99 个主干外提交均未被 origin 引用包含，含文档与合并历史；尚无对应开放 PR。另有 7 个未提交条目。10 个临时 detached 核验工作区的 head 均为此分支祖先，只计同一开发链，不计十项独立功能。 |
| `feat/longform-system-quality-plan-20261013` · `e3499e6e` | 正文采纳与记忆冻结时序修复、系统文 Q01 基线及问题清单 | 已推送，[草稿 PR #135](https://github.com/yuanbw2025/storyforge/pull/135) 未合并；包含在下列 Q02–Q10 开发链中，不重复算一项缺失功能。 |
| `feat/longform-quality-m2-20261014` 与 `feat/longform-system-quality-q02-q10-20261014` · 同为 `744d84b9`；`longform-quality-m2/storyforge`、`longform-node-experience/storyforge` | 系统文技法/元素、场景任务到正文、上下文一致性、作者要求与文风、可保存的单页问卷 | 两分支同 head，合计作为一条链；18 个主干外提交中 12 个仅本地，不能当作 12 个功能。前者另有 17 个未提交条目，涉及正文请求证据、长度观察与中断处理，仅登记观察范围。 |
| `feat/avg-production-research-20261013-latest` · `8df94be1`；`feat/avg-base00a-20261014` · `18218f73` | AVG 三线制作设计、工作包；BASE-00A 版本化承载和旧包兼容边界 | 分别已推送至[草稿 PR #133](https://github.com/yuanbw2025/storyforge/pull/133)、[PR #137](https://github.com/yuanbw2025/storyforge/pull/137)，均未合并；设计已包含在 BASE-00A，设计文件不证明完整 AVG 已实现。 |
| `feat/avg-base00b-20261014` · `1d64da10`；`avg-base00b-20261014/storyforge` | 私有工件/运行契约、设置、准入与采纳规则等后续改动 | 唯一仅本地提交为合入 BASE-00A 的 merge，无新增普通提交；21 个未提交条目才是观察到的新开发，不能声称已完成或已推送。 |
| `feat/narrative-domain-projection-20261014` · `f52f5d4d`；`narrative-world-design/storyforge` | 叙事领域设计、NW-0B 评估基线、NW-1A 身份/时间与 IR 编解码；工作区另涉及投影、采纳、生命周期与后续语义索引 | 4 个主干外提交均仅本地，其中 1 个 merge；116 个未提交状态条目，不能按条目数认定完成。NW-0B、NW-1A 为此链祖先；两个设计分支同 head `ab9e5ed0`，其设计补丁与链内 `4861441b` 等价。`nw1b-verification/storyforge` 是同 head 的 detached 核验副本，另有 86 个未提交条目，重叠范围去重、剩余差异待核对。 |
| `feat/text-open-world-productization-20261013` · `2e9146a4`；`open-world-productization/storyforge` | W1–W3 制作职责和进度、图片逐项审查、装配证据、发布人审与本地反馈导出 | 已推送，[PR #134](https://github.com/yuanbw2025/storyforge/pull/134) 未合并；不是主干已上线能力。 |
| `feat/ttrpg-handoff-20261013` · `2bda43a7`；`ttrpg-handoff-20261013/storyforge` | open 规则结算授权、因果恢复、冻结角色上下文和持久调用证据 | 已推送，[草稿 PR #128](https://github.com/yuanbw2025/storyforge/pull/128) 未合并；与方案 [PR #124](https://github.com/yuanbw2025/storyforge/pull/124) 共享 `a207227c` 文档提交，不能算两套独立实现。 |

8 个工作区有未提交状态：上述 5 处活动工作区（含 detached 核验副本），以及既有内置游戏旧工作区、宣传截图 CSS 工作区和一处仅含 `.vite-e2e-cache/` 的历史录制工作区。后三处范围与上次相同，缓存不计功能，旧内置作品已由 PR #111 迁入 main；不重复提醒为新开发。历史雾港、世界媒资、旧开放世界、UI 与备份分支的 head 未变，继续沿用下方去重结论；不自动采用、合并或清理。

本轮只维护知识库并做文档必要检查；产品分支的验收、模型效果与完整游戏质量不在本轮验证范围。下方所有旧日期内容保留为历史快照，不覆盖本节当前结论。

## 2026-10-13 · 文字开放世界产品化（待合并）

分支 `feat/text-open-world-productization-20261013` 从 `45c541e9` 建立；审计提交 `351bb52f`；实现提交 `614fe1ca`、`3216158f`、`ae1b3f3a`、`2505ef9d`、`404f5cf0`。本轮在原生产工作台增加三线职责与阻塞总览、带来源 Hash 的新版组装报告、逐图人工确认和本地体验反馈导出。操作见[文字开放世界](/features/interactive/open-world)。无新增业务表或迁移，历史 v1 报告和旧发布保留，最终发布质量证据使用 v2 记录校准/视觉回执引用。

此处记录开发分支，不表示已合入 main、官网部署或新正式版本。G7-11 独立模型、G7-13 真人双结局、G7-14 真实问题修复版与旧档复测仍待外部证据；G7-15 的最终状态仍依赖 G7-14。WPS 云知识库不在本轮同步范围。

## 2026-10-12 专项交付 · 官网体验与导航

官网真实界面的源码交付见 [PR #122](https://github.com/yuanbw2025/storyforge/pull/122)：独立展示构建复用项目界面、工作台与示例，隔离浏览器存储并关闭模型配置和 AI 调用。普通下载版继续保留完整创作能力；没有新增业务表、迁移或改变作品归属。官网入口、青绿山水主题和公开工坊平台的主干交付见 [平台 PR #2](https://github.com/yuanbw2025/storyforge-platform/pull/2)。

[官网项目体验](https://storyforge-lab.com/storyforge/)已独立部署；顶部常驻导航已通过 [PR #126](https://github.com/yuanbw2025/storyforge/pull/126) 合入主干并自动部署。主干源码、固定线上体验包与正式版本仍分别核对；当前公开工坊提供目录与下载，在线投稿尚未开放。下方是本次整合前的分支核对快照，其中官网分支的未合并描述不能代替上述 PR 的当前状态。

## 2026-10-12 整合前核对快照

基线：远程 main `ce10e774`。完整枚举 31 个本地分支（含本轮维护分支）、48 个工作区，包含 detached。QQ 机器人指南已通过 [PR #123](https://github.com/yuanbw2025/storyforge/pull/123) 合入，且[知识库部署成功](https://github.com/yuanbw2025/storyforge/actions/runs/38239411813)；指南和更新日志已同步，本轮不重复补写。

- `feat/text-adventure-delivery-20261010`：20 个主干外提交，0 个仅本地，[草稿 PR #119](https://github.com/yuanbw2025/storyforge/pull/119) 仍未合并。此前记录的保图修订与任务恢复之外，新增备份导出账本索引、冻结场景与转录文本绑定、分支行动反馈、结局提示、分支播放与生成正文隔离、拒绝后恢复凭据保护。最新 PR head `38c5e1c8` 的[远端检查已通过](https://github.com/yuanbw2025/storyforge/actions/runs/38108748168)，不等于合入或上线。
- `fix/adventure-branch-transcript` 与 `fix/flagship-backup-export-index` 指向同一 head `5642c839`，均为上面文字冒险分支的祖先；备份索引与分支转录修复只记一次，不作为两个遗漏产品重复合并。
- `feat/website-experience-20261012`：4 个主干外提交，0 个仅本地，已推送至[草稿 PR #122](https://github.com/yuanbw2025/storyforge/pull/122)，尚未合并。实现独立展示构建中的真实界面体验及 AI 调用限制、展示入口隔离、知识库顶部导航；本轮未发现该 PR 的检查记录，不把分支中的入口描述写成已上线指南。
- `/Users/qinyingying/.codex/worktrees/character-chat-plan/storyforge`：观察到 5 个未提交条目，包含角色聊天开发方案、文档路由、权威清单与检查器调整。
- `/Users/qinyingying/.codex/worktrees/ttrpg-plan-20261012/storyforge`：观察到 8 个未提交条目，包含跑团开发方案、产品契约、能力基线、路由与检查器调整。上述两处仅登记观察范围，不表示方案已定稿或产品已实现。
- 旧首页 CSS 两处未提交、内置游戏旧工作区 72 项差异、归档测试缓存和其余历史分支仍按下方去重结论处理。没有提交、推送、合并或清理作者的开发工作。


## 2026-10-10 历史核对

本轮基线为远程 main `6da4c2dc`，完整枚举 25 个本地分支（含本轮维护分支）与 44 个工作区。下方 10 月 8 日快照保留作历史证据。

- PR #113（插件与创意工坊）、#115（节点维护与自由编排）、#118（未命名设定记录冲突修复）、#120（Codex 本机提供商）均已合入 main。工坊、节点和模型配置指南已由[官网部署](https://github.com/yuanbw2025/storyforge/actions/runs/38046659880)发布；合并不代表新正式版本或应用部署状态。
- `feat/text-adventure-delivery-20261010`：12 个主干外提交，0 个仅本地；已推送至[草稿 PR #119](https://github.com/yuanbw2025/storyforge/pull/119)，尚未合并。开发范围包括备份导入后的封存生产凭据恢复、实际任务结算、受控定稿修订、保留授权原图、缺少视觉凭据时的失败收口和存档作品版本显示。远端检查仍在运行，本轮只读取状态，不把开发实现当作已上线功能。
- `feat/codex-provider-merge-20261010` 的 1 个仅本地提交是同步流量归档的 merge；没有独有普通补丁，不是遗漏功能。正式提供商分支已合入 #120。
- 其余主干外历史分支的 head 与上次相同；旧备份、已迁移内置作品、旧开放世界架构仍按下方去重结论处理。两处开发工作区未提交范围未变，另有一处测试缓存；不重复提交、推送或合并这些内容。

## 历史快照（2026-10-08）

> 核对快照：2026-10-08 15:07（北京时间）· 远程 main `7629a7fa`。本页记录开发证据，不是已发布功能清单。

本轮完整核对 19 个本地分支（含本次知识库维护分支）和 41 个已登记工作区，包含 detached 与已移入归档目录的工作区。排除维护分支后，18 个分支中有 8 个 head 仍在主干之外。“仅本地提交”指未被已获取的任何 origin 分支包含的提交，不能直接当作遗漏功能数量。

## 2026-10-10 专项补充 · Codex 本机提供商

实现依据：[d492fe3e](https://github.com/yuanbw2025/storyforge/commit/d492fe3e)；交付与当前检查：[PR #120](https://github.com/yuanbw2025/storyforge/pull/120)。

分支 `feat/codex-provider-20261010` 增加基于 Codex app-server 的可选本机文本传输。检测并复用现有 ChatGPT 登录，无需 API Key，候选审查与采纳继续由现有 StoryForge 流程管理。操作见[模型配置](/getting-started/model-config)。合并、CI 和官网文档部署需分别核对；本条不刷新下方旧分支清单。

## 2026-10-10 · 节点自由编排预览

[PR #115](https://github.com/yuanbw2025/storyforge/pull/115) 在原节点维护基础上补双向拖线、搜索兼容节点、画布新建、断线重连和提示词选择。节点维护与自由编排通过本 PR 交付；请按 PR 的最新完整检查和合并状态判断交付，在线部署需单独核对。操作与限制见[节点创作](/features/nodes)。

## 10 月 8 日 · 长篇节点维护历史开发记录

10 月 8 日核对时，`feat/longform-node-experience-20261008` 正在独立工作树验证节点作者要求、候选修改和拒绝的保存、局部执行、固定角色采纳、中断恢复与窄屏视图。当时该分支尚未合入主干；当前交付状态以 PR #115 为准，不能据历史快照声明线上已更新。跨模式、非法连接与备份删除路径由隔离浏览器验收；所有官方长篇模板的完整生产验收仍待完成。详见[节点创作](/features/nodes)。

## 2026年10月9日专项补充 插件与创意工坊

插件 1.0 体验版通过 PR #113 交付，基础实现为 [53c276f3](https://github.com/yuanbw2025/storyforge/commit/53c276f3)，交付与评审见 [PR #113](https://github.com/yuanbw2025/storyforge/pull/113)。新增[工坊能力说明](/workshop/)、安装与开发教程、AI 指令与 Skill 资料包、发布维护和恢复流程；应用内提供帮助及下载入口。请按 PR 的最新检查与合并状态判断交付，官网部署需单独核对。下方保留 2026-10-08 的历史分支快照，其中的未合并状态和旧 CI 结果不代表当前状态。

## 已进入主干

- [PR #107](https://github.com/yuanbw2025/storyforge/pull/107)：游戏生产分工与生命周期文档，以及长篇候选保存后的审阅保护。
- [PR #108](https://github.com/yuanbw2025/storyforge/pull/108)：首次加载制作进度时保留已输入的任务修订稿。
- [PR #109](https://github.com/yuanbw2025/storyforge/pull/109)：首页布局、文字显示及世界起源中的统一力量体系入口。原“本地未推送”记录已失效。
- [PR #110](https://github.com/yuanbw2025/storyforge/pull/110)：《末班来信》预制漫画动态样片；对应知识库说明已通过[官网部署](https://github.com/yuanbw2025/storyforge/actions/runs/37356743763)。样片不代表漫画生产自动获得同等动画能力。
- [PR #111](https://github.com/yuanbw2025/storyforge/pull/111)：三款内置叙事游戏已合入主干，包含慢帧移动与暂停场景修复；原“待合并、CI 失败”和活动工作区的临时未提交记录已由后续提交取代。Word 导入的间接依赖安全修复也已合入，最新主干[完整 CI](https://github.com/yuanbw2025/storyforge/actions/runs/37477830226) 已通过。

操作说明见[更新日志](/updates/changelog)、[长篇设定](/features/longform/planning)、[候选与恢复](/guides/ai-workflow)。合入 main、应用部署与知识库部署分别核对，不把合并时间当成正式版本发布日期。

## 历史快照中的主干外分支（非当前状态）

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
