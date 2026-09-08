# StoryForge 当前施工路线

> 版本：1.4.0 · 更新：2026-09-06 · 权威层级：L2
> 顺序来自项目总纲 §11。任务只有进入本文件并满足前置，才是当前 backlog；旧阶段号不自动续用。

## 状态

- `NEXT`：当前最近施工单元。
- `QUEUED`：前置完成后进入。
- `BLOCKED`：缺少产品决策或外部条件。
- `LATER`：总纲明确后置。

## 阶段 A · 权威与大架构治理（已完成）

`A-GOV-01` 与 `A-GOV-02` 已进入 [`COMPLETED.md`](./COMPLETED.md)。独立作品/世界身份、纯语义 release、三阶段闸门、不可变谱系、产品专用需求 + 中立读取协议、节点同源和能力/成熟度门已经成为共同基线。正常开发仍必须使用短期功能分支；“主干唯一化”表示整合检查点不存在未审计的长期分叉，不表示以后禁止创建分支。

## 阶段 B · 保持分步骤长篇基线并完成节点同源

### B-LF · 分步骤长篇已完成基线

Phase 5 已完成世界观/故事/角色/主支线/大纲/细纲/正文、候选/stale/采纳、章后与未来演化、渐进式上下文、真实 API 纵切面和 10万/30万/100万字符工程规模门。对应条目已进入 [`COMPLETED.md`](./COMPLETED.md)，不再作为 backlog 重复施工。

真实作者长期文学一致性继续作为质量研究；新增字段、模型或技术变化按维护任务进入，不把已完成主链倒退为“部分实现”。独立作品与世界身份、一键派生属于 A-GOV-02/ARCH-01，不代表长篇产品未完成。

### B-NODE · 节点同源

| ID | 状态 | 工作 | 完成判据 |
|---|---|---|---|
| B-NODE-02 | QUEUED | 跨模式互操作、版本与故障恢复 | 分步骤↔节点读写同一作品；非法连接预检；导入导出/删除/stale/E2E 完整 |

`B-NODE-01` 的官方 action/Skill 同源约束已完成并进入 [`COMPLETED.md`](./COMPLETED.md)。`B-NODE-02` 是节点产品后续体验与生命周期工作，不阻塞其它独立产品开工。

## 阶段 C · 独立创作产品

短篇、小说转剧本和小说转漫画已经完成当前工程闭环并进入 [`COMPLETED.md`](./COMPLETED.md)。新增的漫剧前期生产必须继续保持独立产品闭环；它可以复用稳定底座，但不能复用页漫/剧本正式表或建立万能 Agent。

共同边界、研究索引和集成顺序以 [`INDEPENDENT-CREATION-DEVELOPMENT-PLAN.md`](./INDEPENDENT-CREATION-DEVELOPMENT-PLAN.md) 为入口；实际施工必须分别使用 [`SHORT-NOVEL-DEVELOPMENT-PLAN.md`](./SHORT-NOVEL-DEVELOPMENT-PLAN.md)、[`NOVEL-TO-SCREENPLAY-DEVELOPMENT-PLAN.md`](./NOVEL-TO-SCREENPLAY-DEVELOPMENT-PLAN.md) 或 [`NOVEL-TO-COMIC-DEVELOPMENT-PLAN.md`](./NOVEL-TO-COMIC-DEVELOPMENT-PLAN.md)。三方案隔离结论见 [`INDEPENDENT-CREATION-PLAN-AUDIT.md`](./INDEPENDENT-CREATION-PLAN-AUDIT.md)。不得从现有单次 Prompt 骨架直接扩成一键全自动生成。

| ID | 状态 | 工作 | 前置与完成重点 |
|---|---|---|---|
| C-MOTION-DRAMA-01 | IN_PROGRESS | 漫剧前期生产完整产品 | 一句话/小说→系列/分集→漫剧剧本→版本化物料→分镜/参考帧→Image/Video Prompt IR→工具适配包/release；终点在视频生成前 |

## 阶段 D · 世界引擎（已完成架构基线）

`D-WORLD-01`～`D-WORLD-04` 已进入 [`COMPLETED.md`](./COMPLETED.md)：世界草稿/编号/诚实能力画像与不可变封存、中立版本化资源协议、显式作品派生、多世界关系以及纯语义边界均已有代码和自动证据。以后新增语义域或产品 adapter 属于增量接入，不重新打开世界引擎基础架构。

## 阶段 E · 上层垂直产品

本阶段条目是产品组合中的专项开发占位，不是架构审计要求统一实现的功能清单。每项开工前必须在三阶段框架内另行分析产品设置、Agent、数据、媒资、运行、演化和体验验收；只有经一个产品真实证明可共享的设施才进入公共底座。

| ID | 状态 | 工作 | 完成判据 |
|---|---|---|---|
| E-TTRPG-01 | IN_PROGRESS | 跑团标准纵切面 | WorldRelease→会谈/Brief→内容/规则/媒资→build/release→AI KP 运行/恢复 |
| E-CHAT-01 | QUEUED | 单/多角色聊天完整产品 | 可见性、导演、长期记忆、关系、生产与不可变 release |
| E-TOWN-01 | NEXT | 后日谈 AI 小镇纵切面完善 | 已接通冻结来源生产、发布、时间/地点/日程/关系/轻经营/离线演化和玩家界面；继续完成真实长期内容、媒资与商业验收 |
| E-TEXTADV-01 | QUEUED | 文字冒险 | 选择/判定/资源/任务/结局和可玩发布 |
| E-AVG-01 | QUEUED | AVG | 脚本/演出/立绘/背景/声音/UI 绑定与分支存档 |
| E-OPENWORLD-01 | QUEUED | 文字开放世界 | 区域、动态任务、角色自治、按需模拟和持续有限循环 |

每项必须能映射 `WorldReference → 产品专用 Brief/SourcePlan → production run ContextManifests → SourceManifest/ProductRelease → runtime` 的共同交接语义，但不要求共用相同配置表、规模单位、Agent 图或运行 schema。

短篇/改编与各上层产品可以并行，但共享改动必须遵守以下集成顺序：

1. 从同一个已通过治理验证的基线创建产品分支；
2. 产品分支只拥有自己的表、adapter、Agent、生产、媒资、release 和 runtime；
3. 若确需修改 schema、三注册表、WorldRelease provider、五项逻辑契约或产品目录，先拆成独立共享基础提交；
4. 共享基础先串行合入并验证，各产品分支随后 rebase/merge；
5. 产品分支逐个串行进入主干，每次重跑架构门和受影响产品回归。

## 阶段 F · 网站、社区、平台与商业化

| ID | 状态 | 工作 | 进入条件 |
|---|---|---|---|
| F-PLATFORM-01 | LATER | 账户、云同步、托管、社区、市场与协作 | 至少核心长篇与一个上层产品达到真实可用，数据/隐私/版本边界稳定 |
| F-COMMERCIAL-01 | LATER | 计费、授权、运营与商业化 | 产品价值、成本、合规、服务可靠性和支持流程均有证据 |

现有市场、在线房间、托管和商业代码在此阶段前只能 capability-gated/experimental，不得成为主路径依赖。

## 开工规则

1. 每个产品分支只选择一个稳定 ID，写产品开工卡；不同产品可并行，同一共享核心不得多头并改。
2. 先核对 [`CAPABILITY-BASELINE.md`](./CAPABILITY-BASELINE.md)，复用已有实现。
3. 未完成前置不得以“代码已经有页面”为由跳阶段。
4. 完成后更新能力基线和 [`COMPLETED.md`](./COMPLETED.md)，并从当前队列移除具体施工流水。
