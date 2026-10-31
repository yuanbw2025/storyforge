# StoryForge 当前施工路线

> 版本：2.5.4 · 生效：2026-10-30 · 权威层级：L2
> 顺序来自项目总纲 §11。任务只有进入本文件并满足前置，才是当前 backlog；旧阶段号不自动续用。

## 状态

- `NEXT`：当前最近施工单元。
- `IN_PROGRESS`：已经开工，仍有明确未完成项或外部验收门。
- `QUEUED`：前置完成后进入。
- `BLOCKED`：缺少产品决策或外部条件。
- `LATER`：总纲明确后置。

## 阶段 A · 权威与大架构治理（已完成）

`A-GOV-01` 与 `A-GOV-02` 已进入 [`COMPLETED.md`](./COMPLETED.md)。独立作品/世界身份、纯语义 release、`S1 世界封存 → S2 产品定向 → S3 产品执行`闸门、不可变谱系、产品专用需求 + 中立读取协议、节点同源和能力/成熟度门已经成为共同基线。正常开发仍必须使用短期功能分支；“主干唯一化”表示整合检查点不存在未审计的长期分叉，不表示以后禁止创建分支。

共享底座增量 `BASE-CODEX-01`：本机 Codex 订阅提供商，施工契约见 [CODEX-PROVIDER.md](./CODEX-PROVIDER.md)。复用现有登录、配置和 Harness；交付 PR 完成检查后再判断主干与部署状态。

## 阶段 B · 保持分步骤长篇基线并完成节点同源

### B-LF · 分步骤长篇已完成基线

Phase 5 已完成世界观/故事/角色/主支线/大纲/细纲/正文、候选/stale/采纳、章后与未来演化、渐进式上下文、真实 API 纵切面和 10万/30万/100万字符工程规模门。对应条目已进入 [`COMPLETED.md`](./COMPLETED.md)，不再作为 backlog 重复施工。

真实作者长期文学一致性继续作为质量研究；新增字段、模型或技术变化按维护任务进入，不把已完成主链倒退为“部分实现”。独立作品与世界身份、一键派生属于 A-GOV-02/ARCH-01，不代表长篇产品未完成。

### B-LF-Q · 系统文写作质量增量

专项施工入口为 [系统文长篇写作质量优化施工方案](LONGFORM-SYSTEM-FICTION-QUALITY-PLAN.md)。先研究并验证三个原创系统文设定的开篇与连续十章，再依次完善元素配置、已有场景细纲、上下文交接、正文生成、全章评审和定向修订。分步骤与节点共用原长篇数据和正式动作；工程进度、真人文学评测和平台结果分别记录。

| ID | 状态 | 工作 | 完成判据 |
|---|---|---|---|
| B-LF-Q02 | DONE | 技法研究与可执行写作任务 | 七类技法卡、至少 28 个原创正反例、边界案例、阶段映射与小样本记录 |
| B-LF-Q03 | IN_PROGRESS | 元素配置与写作合同 | 原生元素与候选界面已实施；正式正文交接随 Q05 验证，兼容已有作品 |
| B-LF-Q04 | IN_PROGRESS | 场景任务与同章连续操作 | 可选字段、保存、候选与三向跳转已实施；M2 交接与完整工程门继续核对 |
| B-LF-Q05～Q10 | QUEUED | 正文交接、审修与质量验证 | 按专项依赖实施；全选择问卷工具已准备，真人结果待取得 |

Q01 研究交付已取得三个可恢复作品、30 章 Agnes 正文及 23 项原文问题，见 [最终基线与量表](../audits/SYSTEM-FICTION-Q01-BASELINE.md)；配套采纳修复已通过采样树完整 CI 与同步主干后的完整 E2E；[PR #135](https://github.com/yuanbw2025/storyforge/pull/135) 的远端检查、合并与主干交付状态另记。这属于已完成长篇基线上的持续质量增量，不重新打开 B-LF-01～B-LF-06；文学改造、真人盲评和平台结果由后续单元验证。

### B-LF-STAB · 分步骤长篇稳定性维护

当前维护入口为 [分步骤长篇全流程稳定性修复计划](LONGFORM-STEP-STABILITY-PLAN.md) 和 [逐功能执行矩阵](longform-step-stability-matrix.json)。按实际入口逐项验证生成、候选编辑/拒绝、采纳、手改、保存、刷新/重启、下游和失败恢复；优先处理会崩溃、丢稿或阻断主链的问题。这是既有长篇基线的修复维护，不重新打开 B-LF-01～06，也不把文学问卷当稳定性修复的前置。

| ID | 状态 | 工作 | 完成判据 |
|---|---|---|---|
| B-LF-STAB | IN_PROGRESS | ST00～ST07：控件清点、止崩与护稿、世界/角色、卷章正文、审修辅助、数据往返、客户端发行复测 | 每项适用功能/字段/故障有本轮回执；无未解决P0/P1；正式模型、精确客户端包、保存/恢复和发行状态分别验证；详细状态以专项矩阵为准 |

### B-NODE · 节点同源

| ID | 状态 | 工作 | 完成判据 |
|---|---|---|---|
| B-NODE-02 | QUEUED | 跨模式互操作、版本与故障恢复 | 分步骤↔节点读写同一作品；非法连接预检；导入导出/删除/stale/E2E 完整 |

`B-NODE-01` 的官方 action/Skill 同源约束已完成并进入 [`COMPLETED.md`](./COMPLETED.md)。`B-NODE-02` 是节点产品后续体验与生命周期工作，不阻塞其它独立产品开工。

## 阶段 C · 独立创作产品

短篇、小说转剧本、小说转漫画和漫剧前期生产已经分别完成当前工程闭环并进入 [`COMPLETED.md`](./COMPLETED.md)。四个产品保持独立 owner、生产表、工作台和 Release，只复用已验证的共享底座。

共同边界、研究索引和集成顺序以 [`INDEPENDENT-CREATION-DEVELOPMENT-PLAN.md`](./INDEPENDENT-CREATION-DEVELOPMENT-PLAN.md) 为入口；实际施工必须分别使用 [`SHORT-NOVEL-DEVELOPMENT-PLAN.md`](./SHORT-NOVEL-DEVELOPMENT-PLAN.md)、[`NOVEL-TO-SCREENPLAY-DEVELOPMENT-PLAN.md`](./NOVEL-TO-SCREENPLAY-DEVELOPMENT-PLAN.md) 或 [`NOVEL-TO-COMIC-DEVELOPMENT-PLAN.md`](./NOVEL-TO-COMIC-DEVELOPMENT-PLAN.md)。三方案隔离结论见 [`INDEPENDENT-CREATION-PLAN-AUDIT.md`](./INDEPENDENT-CREATION-PLAN-AUDIT.md)。不得从现有单次 Prompt 骨架直接扩成一键全自动生成。

漫剧的现行产品契约、专业流程与维护边界见 [`MOTION-DRAMA-PREPRODUCTION-DEVELOPMENT-PLAN.md`](./MOTION-DRAMA-PREPRODUCTION-DEVELOPMENT-PLAN.md)；后续 provider 适配和内容质量优化作为增量维护进入，不重新打开已完成主链。

## 阶段 D · 世界引擎（已完成架构基线）

`D-WORLD-01`～`D-WORLD-04` 已进入 [`COMPLETED.md`](./COMPLETED.md)：世界草稿/编号/诚实能力画像与不可变封存、中立版本化资源协议、显式作品派生、多世界关系以及纯语义边界均已有代码和自动证据。以后新增语义域或产品 adapter 属于增量接入，不重新打开世界引擎基础架构。

### D-NW · 叙事世界基座增量

专项唯一入口：[WORLD-ENGINE.md](../products/WORLD-ENGINE.md) 2.2.0；§18 为可执行工作包，§19 为验收矩阵，§20 为分支接入规则，§22 为 NW-0B 实测，§23 为 NW-1A 身份/时间/codec 实现及同语料复测。0A/0B/1A 已形成，见完成索引；§24～30 记录 1B～2E 的实现与阶段证据，仍待完整交付门。1C 的完整故事真实模型已运行，作者抽检尚未取得判断；2B 的实验查询和 2C 的两产品接缝已有定向与浏览器证据，2D 的语义精度、2E 的规模性能和独立质量门尚未通过。以下不是重做 D-WORLD-01～04，也不暂停边界内的产品私域开发。

| ID | 状态 | 工作 | 前置与退出门 |
|---|---|---|---|
| NW-1B | IN_PROGRESS | 领域语义、证据与依赖投影 | 1A；三注册表、Canon/信念/意图区分 |
| NW-1C | IN_PROGRESS | 候选采纳与节点/分步骤同源 | 1B；durable恢复、下游真实生效 |
| NW-2A | IN_PROGRESS | v4世界封存与便携叙事索引 | 1B；正式UI还需1C；hash/证据闭包/导入导出 |
| NW-2B | IN_PROGRESS | 查询过滤、视角/秘密与真能力画像 | 2A；实验查询与隔离浏览器已有证据，仍待交付门与2C产品接缝 |
| NW-2C | IN_PROGRESS | 精确SourcePlan与产品编译器接缝 | 2B；两产品 v3/v4 计划、正式装配、运行来源与恢复已有定向/隔离 UI 证据，完整交付闸门未齐备 |
| NW-2D | IN_PROGRESS | 修改影响与增量等价 | 1C/2A；只读影响、精确分片复用、全量等价和恢复 UI 已有定向证据；完整交付与独立语义门待完成 |
| NW-2E | IN_PROGRESS | 10万/30万/100万字符规模与退化 | 三规模诊断已启动；完整编译有优化，首开/内存/包预算仍待达标；工程/模型/真人证据分层 |

validate/simulate/explain 的动态实现为 Phase 2 后续研究；不在本轮启动，不是产品已有runtime的前置。具体schema/注册表/provider/codec必须先在foundation串行集成，产品分支只接已验收版本。

## 阶段 E · 上层垂直产品

本阶段条目是产品组合中的专项开发占位，不是架构审计要求统一实现的功能清单。每项开工前必须在 S1/S2/S3 框架内另行分析产品设置、Agent、数据、媒资、运行、演化和体验验收；只有经一个产品真实证明可共享的设施才进入公共底座。

| ID | 状态 | 工作 | 完成判据 |
|---|---|---|---|
| E-TTRPG-01 | IN_PROGRESS | 跑团标准纵切面 | WorldRelease→会谈/Brief→内容/规则/媒资→build/release→AI KP 运行/恢复 |
| E-TTRPG-OPEN-01 | QUEUED | 跑团 open 标准格式，现行 [施工方案](./TTRPG-DEVELOPMENT-PLAN.md) 2.1.0 | 先核对 P1 文档合入，再从 P2a 版本/旧包兼容开工；正常作者生产→自由行动/队友→世界自驱→四门→分支/故障恢复联合验收，不以 fixture 代替 |
| E-TTRPG-OPEN-02 | QUEUED | 跑团长局与记忆/恢复证据 | 前置 OPEN-01 首期有效；30+ worldTurn 真实模型与真人证据、质量/费用基线和补丁审阅，schema 以实际开工时的增量版本为准 |
| E-CHAT-01 | QUEUED | [角色聊天内容生产与回合生成重做计划](./CHARACTER-CHAT-DEVELOPMENT-PLAN.md) | v2.3 依据猫箱研究调整为完整文本故事目标：类型素材、人物关系、写作 Prompt 与必要配角前置，局部 Q-L 和完整故事 Q-S 分开；CC-11 A 在首期、十人及视听后置，CC-00—CC-12 待实施；底座依赖、旧失败与竞品缺证保留 |
| E-TOWN-01 | NEXT | 后日谈 AI 小镇纵切面完善 | 已接通冻结来源生产、发布、时间/地点/日程/关系/轻经营/离线演化和玩家界面；继续完成真实长期内容、媒资与商业验收 |
| E-TEXTADV-01 | QUEUED | 文字冒险 | 选择/判定/资源/任务/结局和可玩发布 |
| E-AVG-01 | IN_PROGRESS | AVG 正式设计与后续三线完善 | AVG-00 已形成正式方案；新代码包尚未实施，当前 partial；按专项包取得专业内容、规则/物件/存档、真实媒资/voice/绑定及作者/玩家证据 |
| E-OPENWORLD-01 | IN_PROGRESS | 文字开放世界 | 专属 Creator、内容生产、vNext Runtime、区域演化和正式产品入口已形成工程闭环；继续取得真实第二模型质量/成本回执、真人双结局试玩以及问题→修复版→旧档复测证据 |

每项必须能映射 `WorldReference → 产品专用 Brief/SourcePlan → production run ContextManifests → SourceManifest/ProductRelease → runtime` 的共同交接语义，但不要求共用相同配置表、规模单位、Agent 图或运行 schema。

AVG 以 [整体产品契约](../products/AVG.md)为唯一施工入口，[实施计划](AVG-IMPLEMENTATION-PLAN.md)与[工作包卡](AVG-WORK-PACKAGE-CARDS.md)登记 E-AVG-01 子队列。该子队列下一代码单元为 **AVG-BASE-00A**，同期先冻结 **AVG-CAL-00** 的质量/能力/投入边界，最小专业路径就绪后先测收益；本次只交付设计，不启动代码/作品生产，也不变更其他产品的优先级。

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
