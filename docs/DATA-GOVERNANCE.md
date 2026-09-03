# StoryForge 数据与三注册表治理标准

> 版本：1.4.0 · 生效：2026-09-03 · 权威层级：L1
> 本标准规定 AI 读写、表生命周期、数据所有权、世界版本与跨产品流动。实现细节以注册表和 schema 为事实源。

## 1. 三个单一事实源

| 问题 | 唯一入口 | 不允许的旁路 |
|---|---|---|
| AI 能读什么 | `CONTEXT_SOURCES` + `assembleContext()` / Context Gateway | 组件手拼数据库结果、Prompt 内隐藏字段清单 |
| AI 候选能写什么 | `FIELD_REGISTRY` + `AdoptionSchema` + `adopt()` | 模型输出直接 `db.table.add/update`、面板私有 field mapping |
| 表如何经历生命周期 | `PROJECT_TABLES` | schema、删除、导入导出、迁移各写一份表清单 |

注册表不是文档索引，而是可执行架构。新增来源、字段、集合或表时必须先登记元数据、作用域、owner、引用和测试，再开放产品入口。

## 2. AI 读取契约

每个 `CONTEXT_SOURCES` 条目至少应表达：稳定 key、owner、允许作用域、revision/版本来源、预算类别、加载器和可见性。正式 Skill 声明读取的 source keys；运行时生成 Context Manifest，记录实际选择、哈希、预算与遗漏。

上下文选择按以下层次进行：

1. 任务、产品、世界/作品/实例作用域和硬约束；
2. 可导航目录与能力画像；
3. 与任务相关的摘要、事实、关系、事件和候选；
4. 按需读取详细条目和原文证据；
5. 最终 token 预算保护。

裁剪必须留下 `omitted`/`insufficient` 证据。`missing` 表示冻结世界中不存在满足要求的资源；`omitted` 表示资源存在但没有选入某个 release/plan/run；`partial-selection` 表示该语义域仅选入部分资源。调用方不得混淆三者，不得把未读取内容当作不存在，也不得让固定前缀或“前 N 条”成为主要检索算法。

## 3. 候选与正式写入

模型输出首先是候选，不是 Canon。正式采纳必须：

- 校验 field/schema、类型、集合身份、外键、owner 与作用域；
- 保存输入 revision、候选 hash 和目标 revision；
- 在目标或关键来源变化后拒绝 stale 候选；
- 在事务中完成写入与运行证据；
- 回读 post-state，生成 terminal receipt；
- 让拒绝、人工编辑和刷新恢复保持可解释。

“AI 生成后用户手改原字段”必须改变受治理 revision。无需额外“更新”按钮才能让系统读到最新事实；若 UI 使用显式提交按钮，它必须是清晰的保存语义，而不是修补隐藏缓存。

## 4. 数据所有权

每条持久化记录必须能回答：

- `projectId`：本地物理工作区；
- `worldId` / `worldGroupId`：世界或多世界作用域；
- `workId`：独立作品；
- 产品实例/production/build/release/session ID：上层或改编产品所有权；
- draft、candidate、sealed release 或 runtime 状态；
- 来源、revision、content hash、创建/修改时间与引用。

共享基础设施表只能保存跨产品设施数据，不能成为缺失 owner 的杂物箱。

`Project` 只拥有本地工作区壳与当前编辑指针；`World` 是世界编号、版本与社区来源的唯一权威；`Work` 是独立长篇/短篇作品的 owner。不得在 Project 上镜像世界身份，也不得用内部 World 语义 scope 冒充可分享世界。

## 5. 产品数据边界

### 5.1 分步骤长篇与节点

长篇数据属于长篇作品。节点图可引用同一领域数据，节点定义与运行记录另有 owner；节点不得复制长篇 Canon、记忆或采纳表。节点可以把标准步骤拆得更细并自由组合，但正式采纳仍回到同一长篇 owner。

### 5.2 独立短篇、剧本与漫画

三者分别拥有项目/作品、计划、产物和版本。转换必须保存来源 manifest、源版本与证据。短篇可显式派生世界；剧本和漫画当前不作为世界派生来源。漫画媒资归漫画产品，不归源小说或世界引擎。

### 5.3 世界引擎

世界引擎只拥有可版本化语义内容、目录、能力画像、来源和封存快照。对外引用必须使用稳定世界编号与不可变版本。草稿修改不得静默改变已引用的 release。

世界引擎不得拥有上层产品的媒体资产、build、session、玩家状态、聊天记忆或私域演化。

世界能力画像必须诚实记录每个语义域的 `selected/partial-selection/omitted`、选入/遗漏资源数、confirmed/candidate/conflict/omitted 记录数、最新 revision，以及原文证据和可检索索引是否可用。能力画像描述冻结 release 实际含有什么，不能用“底库曾经有过”冒充“本 release 可读”。

世界草稿/版本可以从长篇或短篇已确认内容显式派生。派生自动形成来源 manifest/快照，保留 source work、revision、范围和 hash；不移动源作品、不要求用户复制粘贴，也不建立双向自动同步。

### 5.4 上层产品

上层产品记录引用的世界编号、版本、完整度与来源 hash；之后所有补充内容、规则、媒资、build、release、运行和演化属于该产品实例。运行事件只在实例私域中推进。

产品入口只能先通过中立 `WorldReference` 目录发现可引用来源，再经本产品需求适配器调用世界网关；不得读取或向 UI 暴露物理 `WorldRelease` 记录、manifest 或世界底表。

发布前与发布媒资绑定 product production/build/ProductRelease；运行中按玩家私域新生成的媒资绑定 ProductRuntimeSession。一个媒资记录只能有一种有效 owner，不能同时归 release 与 session。

从衍生内容创建新世界版本是另一个显式创作产品动作，必须由世界作者选择内容、审查冲突、生成候选并采纳；不是运行时同步。

### 5.5 三阶段所有权与交接

世界衍生产品的数据按三阶段隔离。阶段是所有权边界，不要求拆成三个页面：

| 阶段 | 可读取 | 新数据 owner | 必须形成的交接证据 | 禁止 |
|---|---|---|---|---|
| 世界引擎 | 世界草稿及其来源 | 世界 draft/release | `WorldReference`：code、不可变 release ID/hash、能力画像 | 产品设置、媒资、session 或私域演化进入世界 |
| 用户交互与发指令 | `WorldReference` 和按需世界资源 | product draft/intent | 产品专用 Brief、`ProductSourcePlan`、用户开始授权及其 revision | 未授权即正式生产；修改或补写来源世界 |
| 产品执行与交付 | 已冻结 Brief/source plan、旧 ProductRelease（增量时） | production/build/ProductRelease/session | 每 run Context Manifest、发布时 `ProductSourceManifest` 快照、构建证据、不可变 ProductRelease、父版本/兼容谱系 | 超出 plan 或改读可变世界草稿；追写旧 release manifest；自动回写世界 |

阶段二的配置必须归具体产品，不能落入一个全产品通用设置表。产品可以用时长、章节、回合、分支、参与者或其他专用字段，也可以没有其中任何一项；数据治理只要求 schema 有 owner、版本、来源、用户确认和迁移规则。

五种交接物是逻辑契约，不要求五张万能表。系统负责产生/校验 WorldReference；主 Agent 可起草 Brief/SourcePlan，用户确认 Brief、系统冻结 plan；ProductSourceManifest 只能由真实 run manifests 聚合；ProductReleaseLineage 只能由发布系统按真实父版本、build、quality 和兼容证据生成。

### 5.6 中立世界资源协议

世界出口统一以下协议语义：

```text
describe(release ref) → capability/resource catalog
search(release ref, product requirement) → matched/missing/conflict/omitted descriptors
read(release ref, resource id, detail level) → versioned resource + provenance/evidence
readOriginalEvidence(release ref, resource id) → immutable original text + hash/provenance
```

具体产品拥有自己的 `WorldRequirementAdapter`（或等价契约），把产品任务转换为稳定必读、建议/选读、条件读取和禁止读取；世界网关不拥有产品配置，也不返回一份面向所有产品的固定 payload。适配器可以使用类型化代码/配置和产品 Skill，但版本、权限、必读、禁止与条件边界必须机器可校验，不能只写在提示词里。用户开始生产时冻结 WorldReference、适配器版本、需求、权限、缺失策略和咨询 Context Manifest refs 为 `ProductSourcePlan`。生产中的每个 durable run 可继续在该 plan 允许的不可变 release 中渐进式读取，并保存不可变 Context Manifest；ProductRelease 聚合这些证据为 `ProductSourceManifest` 快照并冻结 hash。后续 runtime 的读取归 session/run manifest，不得修改 release 快照。新增产品通过登记适配器和资源需求接入，不得复制世界底层表查询。

Provider 的缓存必须同时绑定 release UID、content hash 与投影版本，并设置明确容量上限；世界切换或 hash 不符时不得复用。多世界目录通过冻结的稳定关系导航，不得退回读取可变底表。规模门应覆盖千级目录检索和单项详情/原文读取，避免逐行 IndexedDB cursor/事务链形成二次方退化。

### 5.7 ProductRelease 谱系

- `ProductRelease` 必须不可变，并记录 product instance、父 ProductRelease（如有）、来源 Brief revision、source plan/manifest hash、build/quality evidence 和兼容策略。
- 用户改变产品设置、选择新世界 release，或一次增量演化改变资源需求/权限时，应创建新的 Brief/SourcePlan 和 production/候选版本，不覆盖旧 plan/release。
- 已存在 runtime 默认继续绑定启动时的 ProductRelease；升级必须显式执行兼容检查和迁移，失败时旧存档仍可继续使用旧 release。
- 仅世界来源改变不代表产品必须自动升级；同一世界 release 也可被多个相互隔离的产品实例引用。
- 正式 runtime 只能绑定该产品自己的不可变 ProductRelease。WorldRelease、产品 draft、通用 preview 或诊断实例均不能代替 ProductRelease；所有正式产品 kind 由同一运行边界登记并拒绝旁路。

## 6. `PROJECT_TABLES` 生命周期

当前 schema/required table 数量由代码和 `npm run check:required-tables` 决定，不在手写文档中复制清单。每个表登记应覆盖：

- owner 与作用域字段；
- 是否导出、导入、分享或仅本机；
- 项目、世界、作品、产品实例删除行为；
- refs、nullable、重映射与导入顺序；
- schema 迁移与 legacy 兼容；
- blob/OPFS 等外部对象的引用和回收；
- 冻结版本、session 与运行账本的保留策略。

所有导出/导入/删除/世界切换清单从注册表派生。临时例外必须有静态检查允许的理由、退出条件和反例。

## 7. schema 与迁移门

任何 schema 或 owner 改动至少验证：

1. 新建数据库；
2. 从仍受支持的旧版本升级；
3. 旧记录缺字段、空值和异常引用；
4. 项目/世界/作品/产品实例删除；
5. 完整导出 → 新库导入 → 内容/引用/hash 往返；
6. ID 冲突与引用重映射；
7. 事务提前提交、并发修改和失败回滚；
8. blob/OPFS 对象无泄漏、无误删。

测试不得清空作者数据库，不得依赖当前浏览器缓存掩盖迁移问题。

## 8. 安全查询与写入

- 所有查询必须带足够 owner/作用域条件；只按主键读取后仍需校验 owner。
- 世界切换、多世界切换和作品切换必须使缓存、Context Gateway 和候选失效。
- immutable release 按 content hash 读取；不得读取“最新草稿”替代锁定版本。世界衍生产品还必须核对 `WorldReference`、`ProductSourcePlan`、`ProductSourceManifest` 与 ProductRelease 谱系一致。
- 事务内不能等待可能导致 Dexie 提前提交的外部异步工作；先准备数据，再开启最小事务。
- 导入不信任外部 JSON；先解析、校验、规划映射，再原子提交。

## 9. 验收

数据改动完成时，除了定向测试，还必须通过：

```bash
npm run check:required-tables
npm run check:architecture
npx tsc --noEmit
npm run test
npm run build
```

交付运行完整 `npm run ci`；涉及真实迁移、备份恢复或跨产品版本引用时，增加隔离数据库往返和 E2E。
