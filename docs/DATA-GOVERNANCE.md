# StoryForge 数据与三注册表治理标准

> 版本：1.8.1 · 生效：2026-10-13 · 权威层级：L1
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

生产任务的修复反馈按准确的 Build/任务读取。作者的修复意见和完整修订 JSON 只属于其明确指向的 blocker；旧格式的明确 taskKey 仍可定位同一任务。其他任务只读取自己的既有失败证据，不继承兄弟任务的作者修订或私密角色资料。完整原记录继续留在原 owner，不因过滤模型输入而删除或改写；读取反馈不创建推理、候选或采用。


跑团当前失败任务的完整原本机回答可以通过独立保留证明核对原用量：`book-original-response` 在原 Work/Production/Build 的命令事务中复验原 Plan、epoch、Run/attempt、保留终验和完整原文字节，只更新精确原尝试与结构化记账历史。实际 token、观测时长、未报告费用和明确保守上限分别留证；原预留在历史记录中保留，真实超限仍记账并阻止旧授权继续。该动作不生成、不采用、不推进执行阶段。相关 JSON 中 `portable:false` 的原本机证明保持原 opaque 历史，导入重映射不得重获传输或记账权限；备份仍保留原文与既有费用，接受后正式内容继续由原采用/产品来源契约承担。


已独立核对费用的跑团原完整回答，可由当前作者通过既有 `author-edit` 命令明确引用保留终验。系统冻结原模型文本与本次作者修订的不同 hash、准确原 Run/attempt/Plan/epoch、原成功记账命令和来源证据；事务前复验，执行时再核对。正式产物沿原候选/产品采用保存来源 hash，不把原模型响应写成新响应，也不让这项零模型修订再次结算原请求。修订退回后的来源传承仅来自造成当前失败 epoch/任务的成功作者命令，逐次记录前一证明 hash。证明保持不可搬运的本机执行边界；备份保留原文/费用/正式材料和历史，导入不能重新获得本机请求或待执行修订权限。世界来源继续由原登记 Gateway、Context Manifest 和发布 SourceManifest 校验，不由文本来源证明取代。

## 3. 候选与正式写入

模型输出首先是候选，不是 Canon。正式采纳必须：

- 校验 field/schema、类型、集合身份、外键、owner 与作用域；
- 保存输入 revision、候选 hash 和目标 revision；
- 在目标或关键来源变化后拒绝 stale 候选；
- 在事务中完成写入与运行证据；
- 回读 post-state，生成 terminal receipt；
- 让拒绝、人工编辑和刷新恢复保持可解释。

角色补全与状态候选的编辑仍先通过各自严格序列化校验。非法修改须在当前面板提示并保留已有候选，不以未处理的异步异常代替反馈；有未保存错误时阻止误采纳，作者修正后仍沿原候选队列保存与显式采纳，不重发模型请求或放宽字段约束。

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

`Project` 只拥有 LocalWorkspace 的稳定身份、用途、活动 World/Work 指针和工作区级开关；`World` 是世界编号、版本与社区来源的唯一权威；`Work` 是独立作品标题、简介、流派、状态、目标/当前字数、封面、文风、方法论与活动叙事计划的唯一 owner。不得在 Project 上镜像 World 或 Work 语义，也不得用内部 World 语义 scope 冒充可分享世界。

创建 DTO 可以为用户体验一次收集多类字段，但事务必须按 owner 分别写入 Project/World/Work。更新作品、切换作品、导入、导出、世界封存和上下文读取均不得重新复制 Work 字段到 Project，也不得以 Project 作为 Work 缺失时的 fallback。当前导入边界按精确字段闭集拒绝旧镜像和未知字段。

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

产品入口只能先通过中立世界/版本目录发现可引用来源，由系统根据用户选定的准确版本生成并校验 `WorldReference`，再经本产品需求适配器调用世界网关；不得读取或向 UI 暴露物理 `WorldRelease` 记录、manifest 或世界底表。

发布前与发布媒资绑定 product production/build/ProductRelease；运行中按玩家私域新生成的媒资绑定 ProductRuntimeSession。一个媒资记录只能有一种有效 owner，不能同时归 release 与 session。

从衍生内容创建新世界版本是另一个显式创作产品动作，必须由世界作者选择内容、审查冲突、生成候选并采纳；不是运行时同步。

### 5.5 三阶段所有权与交接

世界衍生产品的数据按 `S1 世界封存`、`S2 产品定向`、`S3 产品执行` 隔离。阶段是所有权边界，不要求拆成三个页面、三张表或一套通用状态枚举：

| 阶段 | 可读取 | 新数据 owner | 必须形成的交接证据 | 禁止 |
|---|---|---|---|---|
| `S1 世界封存` | 世界草稿及其来源 | 世界 draft/release | 可引用 `WorldRelease`：code、不可变 release ID/hash、能力画像 | 产品设置、媒资、session 或私域演化进入世界 |
| `S2 产品定向` | 可引用 WorldRelease 和按需世界资源 | product draft/intent | 精确 `WorldReference`、产品专用 Brief、`ProductSourcePlan`、用户开始授权及其 revision | 未授权即正式生产；修改或补写来源世界 |
| `S3 产品执行` | 已冻结 Brief/source plan、旧 ProductRelease（增量时） | production/build/ProductRelease/session | 每 run Context Manifest、发布时 `ProductSourceManifest` 快照、构建/运行时 AI/验收成熟度证据、不可变 ProductRelease、父版本/兼容谱系 | 超出 plan 或改读可变世界草稿；追写旧 release manifest；自动回写世界 |

S2 的配置必须归具体产品，不能落入一个全产品通用设置表。产品可以用时长、章节、回合、分支、参与者或其他专用字段，也可以没有其中任何一项；数据治理只要求 schema 有 owner、版本、来源、用户确认和迁移规则。

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

跑团完整作品备份的本地编号重绑不得重写原 Context Manifest、scope fingerprint 或原 Brief hash。导出 owner 可在移除本地编号前，从实际已验证的世界读取冻结 `portableWorldContextBindingsJson`：只含 exact manifest hash、原 scope fingerprint、世界 release UID/hash 与确定性证明 hash，没有本地主键。它沿 `agentRuns` 的既有注册表生命周期搬运；只在真实导入失效事件之后、原候选/运行证明已显式本地复验、当前 SourcePlan 指向同一 UID/hash 且每项读取的版本/字段/内容及权限仍一致时，允许聚合原读取证据。本地定位使用已重映射的 Brief 行指针与 WorldReference，原 Brief 内的旧编号仅保留为历史输入。此证明不代表新读取，不授权换世界、改权限或绕过必读约束；缺失证明的旧备份保持可保存和只读，不补造来源或自动获得发布权。此路径当前限于跑团，其他产品仍沿各自契约。

### 5.7 ProductRelease 谱系

- `ProductRelease` 必须不可变，并记录 product instance、父 ProductRelease（如有）、来源 Brief revision、source plan/manifest hash、build/quality evidence、运行时 AI 契约引用、验收成熟度和兼容策略。
- 用户改变产品设置、选择新世界 release，或一次增量演化改变资源需求/权限时，应创建新的 Brief/SourcePlan 和 production/候选版本，不覆盖旧 plan/release。
- 已存在 runtime 默认继续绑定启动时的 ProductRelease；升级必须显式执行兼容检查和迁移，失败时旧存档仍可继续使用旧 release。
- 仅世界来源改变不代表产品必须自动升级；同一世界 release 也可被多个相互隔离的产品实例引用。
- 正式 runtime 只能绑定该产品自己的不可变 ProductRelease。WorldRelease、产品 draft、通用 preview 或诊断实例均不能代替 ProductRelease；所有正式产品 kind 由同一运行边界登记并拒绝旁路。
- ProductRelease、可搬运产品包、工作区安装记录和社区/市场条目分别拥有身份与生命周期；导出、导入或发布动作只能引用 release，不得反向把安装/社区状态写进不可变 release。

## 6. `PROJECT_TABLES` 生命周期

当前 schema/required table 数量由代码和 `npm run check:required-tables` 决定，不在手写文档中复制清单。每个表登记应覆盖：

- owner 与作用域字段；
- 是否导出、导入、分享或仅本机；
- 项目、世界、作品、产品实例删除行为；
- refs、nullable、重映射与导入顺序；
- 当前 schema 版本、严格拒绝边界与未来演进决策；
- blob/OPFS 等外部对象的引用和回收；
- 冻结版本、session 与运行账本的保留策略。

所有导出/导入/删除/世界切换清单从注册表派生。临时例外必须有静态检查允许的理由、退出条件和反例。

已完成 Harness 调用的本地完成凭据在导入时失效，但完成历史保留。重复导入若仍能核验同一完成事件前缀、匹配的旧凭据及唯一的导入失效尾事件，不得因历史候选不可移植而把该完成历史误记为取消；不续签凭据、不重新采用或调用模型。未完成且不可移植的检查点仍须取消，损坏或伪造证据仍拒绝；已有取消/失败记录不据此自动改写。

当前或历史 RunContract 仍引用的章纲/正文不得被局部删除操作移除。`PROJECT_TABLES.agentRuns.portableData.retainedScopeTargets` 声明引用，章纲子树、批量清空和正文删除在同一事务内核对全部代际；拒绝时原文、运行账本与界面缓存保持，仍可完整备份。此预防保护不重写历史合同、不丢运行、不放宽导出映射，也不自动修复已经悬空的旧数据；整体 Work/项目删除仍走其完整 owner 生命周期。

## 7. schema 支持窗口与演进门

当前 schema v13 同时保留跑团记忆与世界叙事索引缓存两个增量，required/PROJECT_TABLES 为 130 表。v1～v11 的既有升级与聊天 v8/v9 兼容桥保持；两个分支各自使用过 v12，因此保留 v12 并集桥再进入 v13，只补齐缺失表，不改写已有记录。备份当前 v17：严格校验后的 v14/v15 及两种 v16 经显式无损转换；缺失叙事注释保持缺失，不生成作者确认。任何 schema 或 owner 改动至少验证：

1. 新建数据库；
2. 受支持 v1～v12→v13 原位迁移保留作者记录与引用，分别覆盖跑团 v12 和世界 v12；未来版本被明确拒绝且不改写；
3. 缺字段、空值、旧字段和异常引用被明确拒绝；
4. 项目/世界/作品/产品实例删除；
5. 完整导出 → 新库导入 → 内容/引用/hash 往返；
6. ID 冲突与引用重映射；
7. 事务提前提交、并发修改和失败回滚；
8. blob/OPFS 对象无泄漏、无误删。

硬切换以前的旧数据库世代仍不在支持集合中。未来迁移必须逐次明确支持窗口、单向迁移和退出条件，并为该次演进补齐上述证据；不得借此恢复已删除的旧字段 alias 或通用兼容层。测试不得触碰作者数据库，也不得依赖当前浏览器缓存掩盖版本问题。

Narrative IR 的 owner、事实/信念/意图/假设隔离、字段证据、时间体系与冻结索引演进以 [世界引擎专项](./products/WORLD-ENGINE.md) §12～14 为目标合同；当前仍为 v3 WorldRelease，不因文档修订改变 schema。新增来源/字段/表必须分别回到三注册表，不新增另一 Canon 权威。

## 8. 安全查询与写入

- 所有查询必须带足够 owner/作用域条件；只按主键读取后仍需校验 owner。
- 世界切换、多世界切换和作品切换必须使缓存、Context Gateway 和候选失效。
- immutable release 按 content hash 读取；不得读取“最新草稿”替代锁定版本。世界衍生产品还必须核对 `WorldReference`、`ProductSourcePlan`、`ProductSourceManifest` 与 ProductRelease 谱系一致。
- 事务内不能等待可能导致 Dexie 提前提交的外部异步工作；先准备数据，再开启最小事务。
- schema v13 合并跑团记忆与可重建世界索引缓存，v11 插件快照保持。备份当前 v17；v14/v15 校验完整旧表后补齐后引入空表；v16 的跑团记忆表允许缺失或保留，例外仅由该表的 `optionalInBackupVersions` 注册元数据声明，当前 v17 必须完整。旧记录不补作者确认；缺失核心表、篡改或未知版本拒绝。导入插件数据强制停用，不执行安装包。
- 导入不信任外部 JSON；先解析、校验、规划映射，再原子提交。首页与工作区的 JSON 文件入口复用 `readProjectJSONFile()` 分段读取；项目总大小不得退回单字符串读取或仅在首页设置额外上限。单记录限制与备份信任校验继续生效。

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


### TTRPG P7 的来源与单次只读会话（2026-10-15）

`ttrpgOpenActorContext`、`ttrpgOpenPartyContext`、`ttrpgOpenGmContext` 是现行注册的 runtime 实例来源；角色/接收范围在元数据暴露前校验，作者策略引用依赖不能冒充事实 provenance 或知识授予。可选 Provider `openReadSession` 只复用同次执行中 owner 建立的完整读取视图，登记来源/版本/种类不得变化，执行器须在使用结果前调用 `assertCurrent`；常规独立读取不借用该视图。E14 保存于既有 Run 工件与证据事件，世界和游戏机械 owner 不变。编号重映射后的 prepared 请求恢复仍待独立协议修复，不自动续发。


### 跑团运行证明的备份交接（2026-10-15）

`agentRuns.portableRuntimeOriginJson` 是完整备份 owner 冻结的历史原文/事件证明，沿原 Run 表生命周期保留；原数字是历史身份，不是可解析的当前外键。当前 owner、原输入 Manifest/工件与严格事件前缀共同验证来源，当前 Project/Instance 定位和 Workspace UID 变化不重写原证据。证明不授予发送、采纳或用量改写权限；仅明确未发送的请求可在当前玩家确认后沿原取消状态机终结，原 slot 记录保留，新调用另需授权。裁剪证明可归档搬运，恢复仍要求原文。世界封存保留已有上层证明，生成新证明仅属于完整工作区备份，避免世界语义事务进入上层运行读取。细节和未完成边界见跑团现行方案 §35.49。


### Context Gateway 的 owner 读取会话与逐字证据事务

Provider 可按冻结 scope 返回本次装配专用的只读视图及 assertCurrent。视图必须保持登记的 provider 身份、版本与资源种类；Gateway 在本次实际读取结束后执行 owner 的版本核验，变化则不返回可用上下文包。会话只在一次装配内使用，不作为跨调用或跨 owner 的全局缓存。要求内核资源 allow-list 的来源不能由宽泛读取入口绕过；明确的空列表不授予读取权限。角色 POV 必须同时绑定实例，字符串本身不授予角色权限。

AgentRun 的可选历史来源 JSON 仅携带不可变证据，不是当前数据库 locator、发送许可或写入许可；拥有者在使用前校验，搬运不能生成权限。逐字工件在 caller-owned IndexedDB 事务内核对原文摘要时，仅对纯摘要计算保活，不把包含数据库读取的整个流程包进等待。原文损坏仍须明确拒绝，不能以保持事务为由跳过完整性校验。


### P8 记忆存储治理基础（2026-10-15）

`ttrpgNarrativeMemories` 是实例拥有的唯一计划记忆表，登记导出、导入、实例/上级作用域删除和两个实例引用的重映射。记忆的 `worldGroupId` 与当前实例一致允许 null；不为已移除的世界分组虚构编号。`sourceSessionId` 是可空本地定位，源实例删除可清除此指针，不能把它当作稳定来源证明。

当前单元只提供表、迁移和便携结构边界。导入须核验闭集字段、观察者/可信度、所属实例/World/Work、原始实例范围、版本唯一性和非未来区间。结构有效不等于真实事件或正式采用已验证；在后续事件/候选采纳与祖先证据、分支切点和删除后来源恢复合同接通前，不开放正式记忆写入或模型召回，不新增 FIELD_REGISTRY/CONTEXT_SOURCES 旁路。


### P8 人工记忆确认的事件与投影（2026-10-15）

E15 原事件和稳定回执是确认依据，唯一记忆表是可核对的查询投影；openRun 的回执只作为回放与祖先审计证明，不形成第二个可独立修改的记忆 owner。具名人工命令及分支写入口登记在 ADOPTION_EXTENSIONS，AI 候选仍须走单独登记的 Field/CreativeArtifact/adopt，当前无模型记忆入口。

源事件区间在事务外计算 hash、事务内比对原记录，事件/记忆行/head 同时提交。分支保留已经确认的切点记录；本地 sourceSessionId 可空，稳定 sessionKey、原事件区间和封存祖先继续裁决来源。备份在写入前回放真实事件、核验源证明和表投影，结构通过不再作为已确认记忆的充分条件。所有摘要的规则资格为 false，观察与事实裁定保持原台账 owner。


## 已确认产物的逐字证据保留

已确认产物依赖的逐字 Run 工件不能只依靠源 Run 的存活保留。拥有者可在 `PROJECT_TABLES.exactArtifactRoots` 声明本表 JSON 字段内的只读证据引用路径；路径仅含具名字段及数组通配符，终点为闭集 `{artifactKind, contentHash}` 数组。拥有者先按本领域原始证据验证，再原子持久化引用；此登记只防误清理，不赋予读取、发送或采用权限，不新增工件副本或表。

共享清理器只从注册表派生拥有者表和事务闭包，按当前 project 读取全部声明路径；缺失/空路径不补造引用，损坏的已声明引用须中止清理。当前已确认拥有者仍引用的工件既不进入 mark-and-sweep，也不能被通用显式保留期裁剪；应先通过拥有者的生命周期明确删除/释放依赖。删除源 Run 不删除仍被拥有者引用的证据。导出/导入与拥有者删除继续由 PROJECT_TABLES 派生；产品在相应提交登记实际路径并验证父删除、清理、完整备份后的可读性。所有旧无声明表与 Run 自身的原保留规则保持。

`productMediaAssets.exactArtifactRefsJson` 是可选的逐字证据引用数组，沿上述注册表作为媒资自己的保留根。旧记录与无证据导入不补字段、不改默认值，不新增表或索引。运行媒资导入者可明确提供最多 64 个闭集引用，先冻结参数并检查本项目准确原文，再在媒资绑定事务内重验可用性；相同文件/版本不能换一套证据或给旧人工素材补造来源。同页同原导入串行，跨页原生锁忙时明确拒绝、没有后台重试；绑定事务重读现有版本，无原生锁的物理写竞争也不能被当作已成功，原操作完成后须明确继续。此字段只保留证据，不代表已听、已采用、可播放或可分发；具体产品仍须独立确认原候选、权限、许可、实际文件和运行回执。分支复制沿原媒资行带走引用，备份不重写内容 hash；源 Run 或父实例删除后，只要仍有媒资拥有者，原证据继续受保留根保护。

跑团生成音轨的采用回执另以 `audioReceipts[].generated.artifactRefs` 声明准确原文证据。`productRuntimeSessions` 的初始/当前状态及祖先切点、`productRuntimeEvents` 的 `ttrpg.audio.cue.applied` 回执、`productRuntimeCheckpoints.stateJson` 的当前/祖先快照均通过同一注册表保留这些引用，不要求源 Run 或媒资行继续存活。检查点的通用状态只读取其中的 `ttrpg` 路径，其他产品合法 JSON 无该路径时不产生引用；已声明 JSON 或引用损坏时清理失败关闭。旧人工音轨和无 `generated` 的状态不补字段、不改 hash；此基础登记本身不证明新音轨已确认、已采用或可播放，生成来源与 E16 仍须由产品的版本合同独立验证。


### 跑团已发布 RootV2 的备份身份（2026-10-20）

完整工作区备份可在移除原本地主键前，由原 Work-owned 生产 root 冻结 `agentRuns.portablePublishedRootOriginJson`。它保存原 RootV2 的完整 preimage、原终态 hash、productionKey 和 Build 版本；原数字仅为历史证据，沿既有 Run 生命周期原样保存，不作为当前 locator，也不授予发送、采用、费用改写或新发布权限。世界封存不生成该上层证明。

首次冻结必须由实际已发布 Build、原完成 root/join 与同一不可变 ProductRelease 闭合；已重绑但缺少证明的旧备份保持可保存、只读，不从残留编号补造原身份。结构导入只校验闭集、容量、原 hash 和 Work/Build/root owner，不代表正式复验通过。

显式本地复验须有严格重放的原完成前缀和真实 project-import-scope-rebound 事件。所有 Artifact envelope 与原终态指针保持一致；整个预算账包括历史 attempt、未知费用处置、用量、费用及非引用字段逐值相等，仅允许 PROJECT_TABLES 已登记的预算 Run 引用双射重绑，并独立核对当前作用域、Build、任务、epoch、attempt、root/child 关系。当前 root 的复验沿原 Harness 追加专用 verifier 与既有记忆结算；原已发布 Build、Production、Release 的字段和原 hash 全部保留。连续备份继续携带相同原证明；复制 JSON、缺失前缀、别名冲突、跨域或原文/元数据/权利变化均不能取得该关联。
