# 待合并开发记录与分支核对

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
