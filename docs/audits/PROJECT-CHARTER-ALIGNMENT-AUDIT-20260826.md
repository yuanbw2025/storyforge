# StoryForge 项目架构治理对齐审计

> 审计版本：2.0.0<br>
> 复审日期：2026-08-27<br>
> 对照权威：[StoryForge 项目总纲](../PROJECT-MASTER-CHARTER.md) 1.1.0<br>
> 审计对象：统一主干 `59eea419` 的产品边界、所有权、阶段流转、版本与共享协议<br>
> 状态：取代本文件 1.0.0 的审计口径；只作为架构治理与纠偏依据，不作为任何具体产品已经设计完成或已经可交付的证明

## 1. 为什么重做审计

1.0.0 审计发现的代码证据仍然有效，但把三种不同层次混在了一份“项目问题”清单里：

1. 项目级架构冲突，例如独立作品被自动世界化、WorldRelease 混入上层内容、世界入口绕过产品阶段直接运行；
2. 具体产品尚未完成，例如短篇独立体验、剧本/漫画闭环、跑团或聊天纵切面；
3. 产品质量认证，例如真实百万字长篇验证、某类游戏的体验规模与结局设计。

这种混合会让后两类工作被误认为 StoryForge 必须先统一实现的“总架构”，进而诱发万能表、万能 Agent 和万能 Product Contract。复审后的原则是：

> 总架构只规定各产品怎样进入共同框架、数据怎样流转以及哪些边界不能跨越；具体产品怎样做，等该产品开工时专项分析。

因此，本审计保留架构冲突，转交产品实现与质量事项，不再用总体审计替代产品设计。

## 2. 审计边界

### 2.1 本次审计负责

- 独立产品、世界引擎、上层产品和共享底座的身份边界；
- 世界引擎衍生产品的“三阶段主链”；
- `Project / World / Work / Product draft / Production / ProductRelease / Runtime` 所有权；
- 跨阶段交接物、显式授权、不可变引用、版本谱系与禁止回写；
- 中立世界资源协议与产品专用需求适配器；
- 长篇分步骤与节点模式必须同源；
- 实验能力、平台能力和正式产品入口的阶段门控；
- 三注册表、schema、迁移、导入导出、删除与架构回归如何承载上述规则。

### 2.2 本次审计不负责

- 跑团的车卡、规则、KP、分队或信息隔离具体如何实现；
- 角色聊天、AI 小镇或某类文字游戏的 Agent 组织与玩法设计；
- 产品应使用小时、章节、回合还是其他规模单位；
- 某产品是否必须有结局以及怎样形成结局；
- 剧本、漫画、短篇和长篇的产品级完整功能方案；
- 文学质量、游戏好玩程度或真实百万字创作是否已经通过认证。

这些事项继续存在，但必须进入对应产品契约、路线图和专项验收，不能被列为通用架构缺陷。

## 3. 目标架构

### 3.1 产品全景边界

```mermaid
flowchart TB
    B["共享工程底座\n数据库 / 三注册表 / Harness / Context / 模型 / 媒资设施 / 版本与质量门"]
    L["独立分步骤长篇"]
    N["同源节点模式"]
    S["独立短篇"]
    A["独立小说转剧本"]
    C["独立小说转漫画"]
    W["世界引擎\n版本化叙事语义"]
    U["上层产品族\n跑团 / 角色聊天 / AI小镇 / 文字游戏"]
    B --> L
    B --> N
    B --> S
    B --> A
    B --> C
    B --> W
    B --> U
    L <-->|"同一能力与 Canon"| N
    W -->|"只读不可变世界来源"| U
```

独立长篇等产品不经过世界引擎也必须完整可用。上层产品可以引用世界，但世界不成为它们的 production、媒资或 runtime 容器。

### 3.2 世界衍生产品的三阶段主链

```mermaid
flowchart LR
    S1["阶段一 · 世界引擎\n编辑并封存语义版本"]
    S2["阶段二 · 用户交互与发指令\n引用版本、填写产品专用设置、与主 Agent 定向"]
    S3["阶段三 · 产品执行与交付\n生产、媒资、发布、运行、私域演化"]
    S1 -->|"WorldReference"| S2
    S2 -->|"明确开始 + ConfirmedProductBrief + ProductSourcePlan"| S3
    S3 -. "禁止自动反馈" .-> S1
```

阶段二不是世界引擎的一部分，也不是可以省略的过渡页面。用户在那里配置的是某一个具体产品；阶段三何时迭代、怎样结束，则由该产品内部设计决定。

### 3.3 架构交接契约

| 逻辑契约 | 必须表达 | 所有者 | 不允许 |
|---|---|---|---|
| `WorldReference` | world code、不可变 release ID/hash、能力身份 | 世界引擎 | 用可变 Project/草稿版本代替 |
| `ProductSourcePlan` | 锁定世界版本、需求适配器/版本、需求、权限、缺失策略与咨询 Context Manifest refs | 产品草稿/production | 未开始就假装预知全部实际来源；每个产品手写世界底表清单 |
| `ConfirmedProductBrief` | 产品类型、用户意图、产品专用配置、限制、revision、确认 | 产品实例 | 用一个全产品万能 `ExperienceContract`；未确认先生产 |
| `ProductSourceManifest` | production 各 run 实际读取/采用/缺失/冲突/遗漏的世界资源聚合快照 | product build/release | 超出 SourcePlan；追写旧 release；发布时未冻结 hash |
| `ProductReleaseLineage` | release/hash、父 release、source plan/manifest、brief/build/quality、兼容结论 | 产品实例 | 覆盖旧 release；运行随世界草稿漂移 |

这些是逻辑语义，不强制所有产品共用相同物理表。架构验收的是每个产品都能映射和追溯，而不是它们的数据内容完全相同。

### 3.4 世界资源统一协议

统一世界出口的正确含义是 **协议统一、需求与结果按产品变化**：

```text
产品目标与专用配置
→ 产品自己的 WorldRequirementAdapter
→ describe/search/read 指定 WorldRelease
→ matched / missing / conflict / omitted / insufficient
→ 用户开始时冻结 ProductSourcePlan
→ production 每个 run 渐进读取并保存 Context Manifest
→ ProductRelease 聚合并冻结 ProductSourceManifest
```

网关统一版本、寻址、resource ID、来源、权限、充分性、渐进披露和遗漏语义。它不返回一份覆盖所有产品的固定 payload。用户开始时只能冻结世界版本、需求与读取规则；Agent 在该不可变版本内继续发现和读取资源，每个 run 保存不可变 Context Manifest，发布时才形成聚合 source manifest。runtime 后续读取归 session/run，不改写旧 release。新产品接入时增加产品需求适配器和必要资源登记，不修改一个不断扩张的中心清单。

### 3.5 不可破坏的架构不变量

1. 独立作品不会仅因存在内部 `World/Work` scope 就自动成为可分享世界。
2. `WorldRelease` 只包含世界叙事语义、目录、能力画像和证据，不包含产品媒资、production、build、session 或运行状态。
3. 正式上层运行必须经过产品阶段二和阶段三，世界页面不能直接创建 runtime。
4. 正式生产绑定不可变 WorldRelease 和 SourcePlan；正式运行绑定不可变 ProductRelease。运行若仍需查询世界，只能沿 ProductRelease 继承的 SourcePlan 读取同一不可变 release，并把证据写入 session/run manifest，不能修改 release manifest。
5. 上层产品拥有自己的设置、补充内容、媒资、运行和演化；任何自动回写世界均禁止。
6. 世界资源协议不暴露底表，也不要求不同产品读取相同 payload。
7. ProductRelease 的升级和演化创建新版本，有父版本与兼容证据；旧版本和旧存档可继续定位。
   产品目标、配置、世界版本、资源需求或读取权限变化时，同时创建新 Brief/SourcePlan，不能改写旧 plan。
8. 节点模式和分步骤长篇共享 Canon、Skill/Harness、Context、Adoption 与生命周期。
9. 未完成或发展顺序后置的能力默认实验性门控，不以页面存在宣称正式产品。

## 4. 已有能力与保留裁决

| 能力 | 当前裁决 | 架构意义 |
|---|---|---|
| 三注册表 | 保留并继续作为代码单一事实源 | 能承载世界资源、产品 Brief/候选和表生命周期治理 |
| durable Harness | 保留，不重造 runner | 已有 contract、checkpoint、stale、repair、receipt 基础 |
| Context Gateway | 保留并扩展 immutable WorldRelease provider | 已具备目录、检索、详情/原文和遗漏证据模型 |
| Canon/事实/关系/时间与长程记忆 | 保留 | 独立长篇与世界语义资源均可复用，但 owner 必须分开 |
| 节点 DAG、运行与采纳 | 保留 | 需要消除官方节点通用生成 fallback，而不是重建节点系统 |
| World code/release/hash | 保留并升级语义边界 | 已有版本基础，可兼容迁移为纯世界 release |
| product production/build/runtime 设施 | 保留为产品侧基础 | 不迁回世界；是否足够由各产品专项验收 |
| 改编、媒资和上层产品表 | 保留且按 owner 整理 | “代码已存在”不等于具体产品完成，也不构成架构删除理由 |

StoryForge 不需要推倒重构。需要的是把已经存在的底座收口到稳定边界，并为旧数据建立增量迁移。

## 5. 架构偏差总览

### 5.1 严重度

- **P0**：继续开发会扩大错误 owner、release 或阶段边界；新功能前必须处理。
- **P1**：不立即污染数据，但会持续产生平行协议、入口绕行或架构漂移。

### 5.2 清单

| ID | 严重度 | 当前偏差 | 目标不变量 |
|---|---|---|---|
| ARCH-01 | P0 | 每个 Project 被自动赋予并投影为世界身份 | 独立作品与可分享世界显式分离 |
| ARCH-02 | P0 | WorldRelease 打包策略允许产品内容、AVG 媒资和运行模块进入世界 | WorldRelease 纯语义、产品数据完全外置 |
| ARCH-03 | P0 | 世界页面可以绕过产品交互/生产阶段直接创建诊断 runtime | 所有正式运行经过三阶段交接 |
| ARCH-04 | P1 | 顶层入口仍可能用可变 `Project.worldVersion` 表达绑定；跨产品 release 谱系没有共同治理闸门 | WorldReference 与 ProductReleaseLineage 可验证 |
| ARCH-05 | P1 | 跑团、角色互动、游戏生产和文字游戏各自解析 WorldRelease/table selection | 中立网关 + 产品需求适配器 + source plan/run/release manifests |
| ARCH-06 | P1 | 部分官方节点仍回退通用 `chat()`，没有逐能力复用分步骤正式路径 | 节点与分步骤同源 |
| ARCH-07 | P1 | 世界能力画像混入 runtime/assets 语义，未完成产品/平台入口仍可能作为正式功能暴露 | 能力域与发展阶段均有机器门控 |

## 6. 偏差证据与架构修复包

### ARCH-01 · 产品身份与世界身份混合

**证据**

- `src/pages/ProductHubPage.tsx` 的 `projectToWorld()` 把 Project 投影为产品世界。
- `src/lib/product/world-identity.ts` 的 `ensureProjectWorldIdentity()` 为 Project 补 world code/version。
- `src/lib/world-engine/create-workspace.ts` 同时创建 Project、World、Work；内部 scope 结构随后被 UI 当作可分享世界身份。

**架构修复包 `GOV-IDENTITY`**

1. 定义内部 workspace scope、独立作品、世界草稿、可分享世界四类身份，禁止用“存在 World 行”推断产品身份。
2. 创建命令按产品 owner 分开；只有显式创建/发布世界才生成公共 world code。
3. 世界列表只读取显式世界身份，不再对全部 Project 做投影。
4. 旧 Project 先生成只读分类报告；歧义项由用户确认，默认保留为独立作品。
5. 通过 `PROJECT_TABLES` 派生导出、导入、删除、复制和 ID 重映射，并验证两个 owner 互不误删。

**关闭条件**：创建任一独立作品不新增共享世界；显式发布才得到 world code/release；旧数据无损且来源关系可追溯。

### ARCH-02 · WorldRelease 边界污染

**证据**

- `src/lib/registry/project-tables.ts` 的多张产品/AVG/运行相关表使用 `communityShare: 'world'`。
- `src/lib/world-engine/releases.ts` 的 `buildWorldReleaseManifest()` 以该标记筛选发布集合。
- 同文件的 portable release 构建包含 AVG blob 特例，说明产品媒资已经进入世界包语义。

**架构修复包 `GOV-WORLD-RELEASE`**

1. 把“世界语义可封存”“产品可分发”“绝不打包”拆成不同注册元数据，不能继续复用一个含混标志。
2. 新一代 WorldRelease 仅从世界语义资源注册表派生，包含能力画像、资源目录、稳定 ID、来源与 hash。
3. 对旧 release 兼容读取并执行影子分类：世界语义进入新 release 候选；产品数据/媒资进入相应产品迁移候选，任何一侧都不得静默丢弃。
4. 建立包内容白名单、owner 反例、体积预算、hash 和导入往返门。

**关闭条件**：任何新 WorldRelease 不含 product production/build/media/session/runtime；旧包可读取、分类、迁移和恢复。

### ARCH-03 · 三阶段可以被绕过

**证据**

- `src/components/world-engine/WorldNarrativeReleasePanel.tsx` 可从 WorldRelease 直接创建 `chatgame/NPC` 诊断实例。
- `src/components/world-engine/WorldEngineWorkspace.tsx` 同时承载世界 release 与上层 runtime/状态展示。

**架构修复包 `GOV-STAGE-GATE`**

1. 世界页面只保留编辑、诊断、封存、比较和“转到某产品”的 handoff；handoff 只传 WorldReference。
2. 结构诊断必须是只读/内存/测试命名空间，不能产生正式 product/session 行。
3. 所有正式 product production 入口验证 ConfirmedProductBrief、ProductSourcePlan 和用户开始授权 revision。
4. 所有 runtime 启动验证不可变 ProductRelease；世界 release 不能直接充当运行包。
5. 用架构扫描和 E2E 阻止新的跨阶段快捷入口。

**关闭条件**：世界封存和诊断零写入产品表；未经产品设置与用户开始不能生产；没有 ProductRelease 不能启动正式 runtime。

### ARCH-04 · 不可变来源与产品谱系未形成共同闸门

**证据**

- `src/pages/ProductHubPage.tsx` 的顶层 `BindingBanner` 来自 `Project.worldCode/worldVersion`，可能让可变草稿版本冒充锁定来源。
- 深层跑团、角色互动和游戏生产已经大量使用 `worldReleaseId/contentHash`，证明无需推倒重建；缺口在顶层 handoff 和跨产品共同不变量。
- 不同产品各自表达 parent build/release 或升级候选，尚无项目级检查保证每个正式 ProductRelease 都保存完整 lineage。

**架构修复包 `GOV-LINEAGE`**

1. 统一逻辑 `WorldReference` 校验：release ID/hash 必须同时匹配；UI 不能用草稿 version 替代。
2. 统一逻辑 `ProductReleaseLineage` 最低字段和检查器；物理 schema 可产品专用。
3. 变更 Brief、来源世界、资源需求/权限或旧 ProductRelease 时创建新 Brief/SourcePlan/production/release，不原地覆盖。
4. runtime 升级必须显式兼容检查；未升级实例继续读取旧 ProductRelease。

**关闭条件**：从入口到 runtime 可追溯 WorldReference → source plan → Brief → run Context Manifests → release SourceManifest → build → ProductRelease → parent/compatibility，且世界草稿变化不改变已有链。

### ARCH-05 · 世界读取是多套产品专用解析器

**证据**

- `src/lib/ttrpg/world-source.ts`、`src/lib/character-interaction/world-source.ts`、`src/lib/game-production/context.ts`、`src/lib/text-game/world-generation.ts` 分别解析 `WorldReleaseManifestV2`、selected tables 和产品摘要。
- 部分读取器还读取 AVG 媒资，进一步固化 ARCH-02。
- 当前 Context Gateway 已有 provider、resource descriptor、目录/检索/详情和遗漏语义，可复用为不可变世界 provider。

**架构修复包 `GOV-WORLD-PROTOCOL`**

1. 为不可变 WorldRelease 实现中立 `describe/search/read` provider，复用 Context Gateway，不新建第四套上下文系统。
2. 定义产品需求适配器接口；跑团、聊天和游戏保留自己的需求语义，但删除对世界底表与 manifest 内部结构的直接依赖。
3. 网关返回 matched/missing/conflict/omitted/insufficient 和 provenance；用户开始时产品冻结 ProductSourcePlan，production 每个 run 保存 Context Manifest，ProductRelease 聚合并冻结 ProductSourceManifest；runtime 新证据归 session/run。
4. 先让至少两个需求明显不同的现有产品适配同一协议，以证明协议没有偷偷固化某一产品 payload；这不要求两个产品本身完成。
5. 新旧 reader 双读对照、hash/资源等价后停止旧写入/读取，并由扫描器禁止新增直接解析。

**关闭条件**：产品新增需求只修改自己的 adapter/契约；网关无需新增万能字段；两个产品可从同一 release 得到不同且可追溯的 plan/run/release manifests；后续渐进读取不越过锁定版本和权限，也不改写旧 release。

### ARCH-06 · 节点与分步骤尚未完全同源

**证据**

- `src/lib/node-authoring/creation-chain.ts`、`executor.ts` 已有真实 DAG、stale 和受治理采纳基础。
- `src/lib/node-authoring/domain-execution.ts` 只覆盖部分领域动作；其余官方 `generate-field/generate-collection` 可回退通用 `chat()`。

**架构修复包 `GOV-NODE-SAME-SOURCE`**

1. 建立机器可校验的“分步骤 action ↔ Skill/Run Contract ↔ Context ↔ Adoption ↔ node type”映射。
2. 所有官方节点必须调用对应正式领域 action；通用节点只允许作为显式实验草稿且不能直接写 Canon。
3. 架构检查器禁止官方模板落入通用 AI fallback。
4. 同一数据在两种入口的 revision、stale、刷新、采纳、导入导出和下游读取一致。

**关闭条件**：官方分步骤模板全部可由节点表达，删除通用 fallback 后仍可运行；不存在第二套 Prompt/DB/记忆体系。

### ARCH-07 · 能力域和发展阶段缺少统一门控

**证据**

- `src/lib/world-engine/domain.ts` 的世界投影包含 `runtime`，并用 `assets` 表达部分语义实体，容易与真实媒体资产混淆。
- `src/pages/ProductHubPage.tsx` 暴露多个成熟度不同的产品和社区/市场入口；代码存在与正式可用状态没有统一机器边界。

**架构修复包 `GOV-CAPABILITY-GATE`**

1. 世界能力画像只表达语义域、覆盖、证据和冲突；移除 runtime，把语义 entity 与 media asset 分开命名。
2. 产品目录登记 `experimental/internal/preview/released` 等发布状态及进入条件；生产默认不展示未通过正式验收的入口。
3. 平台、托管、社区和商业能力继续保留代码与安全维护，但阶段 F 前不得成为核心路径依赖。
4. 文档、导航、路由与 capability gate 由同一登记派生或检查，避免只改文案。

**关闭条件**：世界能力画像不包含上层 runtime/media；未完成入口默认不可见或明确实验性；页面存在不再等于产品已发布。

## 7. 从架构审计转交出去的事项

下表不是删除问题，而是把它们交给正确 owner：

| 1.0.0 原事项 | 新归属 | 继续保留的架构部分 |
|---|---|---|
| ALIGN-07 真实百万字验证 | `B-LF-06` 长篇产品质量与认证 | 长篇/节点 owner、三注册表与同源 Harness 仍受架构治理 |
| ALIGN-08 短篇完整独立产品 | `C-SHORT-01` 专项产品设计与交付 | 独立作品不能自动世界化，归 ARCH-01 |
| ALIGN-09 剧本/漫画端到端闭环 | `C-SCREENPLAY-01`、`C-COMIC-01` | 独立 owner、来源 manifest、媒资归属受总架构治理 |
| ALIGN-11 上层产品纵切面完成 | 阶段 E 各产品专项路线 | 三阶段、接入槽位、不可变引用与不回写受本审计治理 |
| ALIGN-14 规模、结束与持续体验 | 各产品的阶段二设置和阶段三运行设计 | 用户明确开始、Brief 版本、ProductRelease 谱系由总架构治理 |
| “种族与民族”全场景矩阵 | `B-LF-02` 长篇/Harness 产品验收 | 它仍可验证三注册表与分步骤/节点同源，但不是全项目架构修复包 |

转交后，这些工作不得再被实现成跨产品万能表或万能 Agent。每个产品开工时以总架构的扩展槽位为外框，另写自己的需求、数据、Agent、运行和质量方案。

## 8. 施工依赖与顺序

```mermaid
flowchart TD
    D["文档治理：三阶段与所有权生效"] --> I["GOV-IDENTITY"]
    I --> R["GOV-WORLD-RELEASE"]
    R --> G["GOV-WORLD-PROTOCOL"]
    G --> S["GOV-STAGE-GATE"]
    S --> L["GOV-LINEAGE"]
    I --> N["GOV-NODE-SAME-SOURCE"]
    D --> C["GOV-CAPABILITY-GATE"]
    L --> P["具体上层产品按各自方案开工"]
    G --> P
```

推荐施工批次：

1. **身份与迁移基础**：先区分独立作品、世界和产品 owner，所有后续迁移才有可靠目标。
2. **纯世界 release**：先建立兼容的新语义包，再让网关读取；不能先删除旧 reader。
3. **中立世界协议**：用两个不同需求适配器验证协议，形成 source plan、per-run Context Manifests 和发布 source manifest。
4. **阶段与谱系闸门**：收口顶层 handoff、显式开始、ProductRelease/runtime 绑定。
5. **同源与入口门控**：节点旁路、世界能力命名、实验产品可见性并行收口。
6. **产品专项开发**：框架稳定后，各具体产品独立设计和验收；总架构不替它们决定功能。

## 9. 迁移与兼容原则

- 不删除旧表解决 owner 问题；先登记新身份与关系，再双读、影子构建、用户确认、单写和最终收口。
- 不把所有旧 Project 自动公开为世界；歧义项默认保留为独立作品。
- 不丢弃旧 WorldRelease 中的产品数据或媒资；按来源建立产品迁移候选。
- 不让新旧路径长期双写 Canon；双读阶段必须有对照证据和退出条件。
- 迁移记录保留 schema、old→new ID、owner、source/release/media hash、冲突、跳过、失败和 dry-run 报告。
- 在隔离数据库验证新建、旧库升级、导出导入、删除、复制、引用重映射、失败回滚和恢复；不得使用作者当前浏览器项目做迁移试验。

## 10. 架构完成门

七项偏差只有同时满足以下证据才可关闭：

1. 总纲、开发宪法、数据治理、产品契约和路线图口径一致；
2. 三注册表完整表达新增 source、AI 候选写入和表生命周期；
3. 静态检查阻止世界包污染、世界直达 runtime、产品直读世界底表、官方节点 fallback 和未门控入口；
4. schema/迁移/导入导出/删除/复制/重映射正反例通过；
5. WorldReference、source plan、Brief、per-run Context Manifests、发布 source manifest、ProductRelease lineage 和 runtime binding 可从持久记录重放；
6. 至少两个不同产品需求适配器证明“同协议、不同 payload”，并证明生产期渐进读取仍受锁定 plan 约束，而无需完成这两个产品的全部功能；
7. 多用户/多产品引用同一世界时 owner 隔离，运行不回写，世界升级不静默改变旧产品；
8. 定向测试、`check:architecture`、`check:required-tables`、TypeScript、完整 CI、适用的隔离 E2E 和 `git diff --check` 通过。

这里的“完成”只表示 StoryForge 的大框架稳定：后续功能能够在正确阶段、正确 owner、正确版本和正确协议内开发。它不表示某个具体产品已经好用，也不替代产品自己的真实体验验收。

## 11. 最终裁决

StoryForge 当前没有必要再做一次大重构。已有 Harness、Context Gateway、三注册表、版本和产品设施可以继续使用。真正需要一次做稳的是以下骨架：

> 独立产品保持独立；世界只封存语义；世界衍生产品严格经过“世界来源 → 用户定向与发指令 → 产品执行与交付”；统一的是协议和治理，不是每个产品的数据内容与功能实现。

这套治理完成后，跑团、角色聊天、AI 小镇和各类文字游戏可以按各自需求分头开发，但必须把自己接入相同的身份、交接、来源、版本、媒资 owner、运行隔离和演化谱系。这样才能做到“齐头并进而不互相污染”，同时避免为了追求表面统一再次制造一个庞大而僵硬的单体系统。
