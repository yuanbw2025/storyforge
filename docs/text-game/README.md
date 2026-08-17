# StoryForge 文字游戏规划库

> 文档状态：当前产品方向入口
>
> 最后裁决：2026-08-13
>
> 当前状态：`STORYGAME-1`、`CHATGAME-2`、`TEXTADV-1`、`AVG-1`、`TEXTSIM-1`、`TEXTWORLD-1` 均已完成；
> 世界引擎到 STORYGAME / TEXTADV / AVG 的确定性生成桥与主 Agent AI 演化创作链已于 2026-08-15 打通

这个目录集中保存 StoryForge 的文字游戏类型、产品方向和后续专项设计。开发文字游戏前应先阅读本页，
再按当前任务进入对应文档，避免把不同类型的目标、系统和表现方式混成一个无法施工的大功能。

## 当前共识

StoryForge 不只规划一种“文字游戏”。不同产品可以复用世界引擎、角色、叙事蓝图、运行实例、事件回放
和 Harness，但玩家体验、内容组织方式和施工优先级不同，必须分别立项。

文字开放世界是文字游戏产品序列的最终组合产品，已经在前五种产品完成后交付。它复用分支互动叙事、
角色互动、文字冒险和复杂叙事模拟的成熟能力，以区域动态任务发牌、离散世界 tick、关注级别和有限传播
形成长局；没有把前序产品复制进开放世界私有实现。

AVG / Galgame 与《饿殍：明末千里行》式视觉叙事保留为独立表现线。它们重点解决精编剧情、立绘、背景、
CG 和演出节奏，不参与当前文字开放世界框架施工。

## 文档导航

| 文档 | 用途 | 权威状态 |
|---|---|---|
| [`TEXT-GAME-TYPES.md`](./TEXT-GAME-TYPES.md) | 已确定的文字游戏类型、体验特点、设计方向和相互关系 | 当前类型规划 |
| [`SHARED-TEXT-GAME-ARCHITECTURE.md`](./SHARED-TEXT-GAME-ARCHITECTURE.md) | 哪些能力立即复用、哪些按模块隔离、何时提炼共享能力 | 共享架构与复用裁决 |
| [`DELIVERY-ORDER-AND-READINESS.md`](./DELIVERY-ORDER-AND-READINESS.md) | 开发先后顺序、现有策划成熟度和开工门槛 | 当前施工排序 |
| [`ROADSHOW-PLAYER-EXPERIENCE-GAP.md`](./ROADSHOW-PLAYER-EXPERIENCE-GAP.md) | 分支叙事/文字冒险商业体验差距、路演标准和首轮 UI 迭代边界 | 2026-08-16 已实施 |
| [`STORYGAME-1-BRANCHING-NARRATIVE-DESIGN.md`](./STORYGAME-1-BRANCHING-NARRATIVE-DESIGN.md) | 分支剧情、选择、发布、播放器和作者工作台 | `IMPLEMENTED` |
| [`CHATGAME-2-CHARACTER-INTERACTION-DESIGN.md`](./CHATGAME-2-CHARACTER-INTERACTION-DESIGN.md) | 长期记忆、关系、知识边界和多人场景 | `IMPLEMENTED` |
| [`TEXTADV-1-TEXT-ADVENTURE-DESIGN.md`](./TEXTADV-1-TEXT-ADVENTURE-DESIGN.md) | 地点、物品、能力、判定、行动和任务 | `IMPLEMENTED` |
| [`AVG-1-VISUAL-NARRATIVE-DESIGN.md`](./AVG-1-VISUAL-NARRATIVE-DESIGN.md) | 图片、音频、2D 动效、演出时间线和媒资生命周期 | `IMPLEMENTED` |
| [`TEXTSIM-1-COMPLEX-NARRATIVE-SIMULATION-DESIGN.md`](./TEXTSIM-1-COMPLEX-NARRATIVE-SIMULATION-DESIGN.md) | 资源、组织、政策、危机和长期因果 | `IMPLEMENTED` |
| [`TEXT-OPEN-WORLD-DIRECTION.md`](./TEXT-OPEN-WORLD-DIRECTION.md) | 文字开放世界的完整范围、组合关系和阶段路线 | `IMPLEMENTED` |
| [`REGIONAL-QUEST-DIRECTOR.md`](./REGIONAL-QUEST-DIRECTOR.md) | 区域化任务发牌、动态任务配置和 AI 分工 | TEXTWORLD 已实现专项基线 |
| [`archive/UNIVERSAL-TEXT-GAME-DESIGN-20260813.md`](./archive/UNIVERSAL-TEXT-GAME-DESIGN-20260813.md) | 曾把复杂模拟与 AVG/媒资放在同一体系的旧综合方案 | 已归档，不可据此直接开工 |

## 产品与底座关系

```text
WORLD-2 世界引擎
  └─ SIM-1 共享运行时
      ├─ TTRPG-1 跑团（独立产品）
      ├─ CHATGAME-1 单角色聊天（已交付兼容入口）
      └─ 文字游戏产品族
          ├─ STORYGAME-1 分支互动叙事（1A/1B/1C 已完成）
          ├─ CHATGAME-2 角色互动与关系叙事（2A/2B/2C 已完成）
          ├─ TEXTADV-1 文字冒险 / 轻 RPG（1A/1B/1C 已完成）
          ├─ AVG-1 AVG / Galgame 视觉叙事（1A/1B/1C 已完成）
          ├─ TEXTSIM-1 复杂叙事模拟（1A/1B/1C 已完成）
          └─ TEXTWORLD-1 文字开放世界（1A/1B/1C/1D/1E 已完成）
```

这里的“共用底座”不代表这些产品拥有同一套界面或必须同时开发。任何产品都不得复制世界、存档、
事件流或 Agent Harness；上层差异通过各自的产品定义和受控模块实现。

## 当前施工裁决

1. 六种产品的独立开发方案、共享架构和首个完整实现均已完成；后续按产品边界持续回归和迭代，不再重开平行底座。
2. 开发顺序为分支互动叙事 → 角色互动 → 文字冒险；AVG 走独立表现线，随后建设复杂模拟，
   文字开放世界放在最后。
3. 从第一种产品起共享稳定底座；玩法在第二个真实使用者出现时只提炼共同合同。
4. AI 不直接修改存档；世界状态、规则结果和叙事表达保持分层。
5. 每个后续功能都必须说明属于哪种文字游戏；跨类型的底层能力才进入共享层。
6. 本目录只负责产品设计裁决；真实完成状态仍由路线图和能力基线登记。

## 世界引擎到游戏的正式入口

世界工作台现在可以从一个已发布的不可变 `WorldReleaseManifestV2` 依次生成分支互动叙事、文字冒险和
AVG。生成器只读取 `manifestJson.records`、`selectedNarrativeModules`、`contentHash` 与便携 export 引用；
来源选择和映射版本随 `GameDefinition` 记录，并再次冻结到 `GameRelease`。它不会读取实时表作为内容权威，
也不会把本地数字 ID 写进来源合同。

主要创作入口不是逐字投影：`outline.world-game` 通过登记的 `worldGameAuthoring → assembleContext()` 读取
作者选择的冻结创作包，由主 Agent/Harness 生成新的危机、行动、转折、分支和结局候选。候选经过严格 JSON、
角色 exportId、断链、无效目标、不可达、死路、缺失结局和循环风险检查，作者确认后才由登记的世界游戏采纳
扩展写入同一 Narrative/GameDefinition/产品模块，再走既有发布与 SIM 试玩。原确定性投影保留为无 AI、无额度
或路演网络异常时的明确备用入口，不再代表完整的创作体验。

- 分支叙事将冻结 `NarrativeModule/Node/Beat/Choice` 投影为 Work-owned 游戏叙事；旧蓝图只有
  `successorKeys` 时确定性补全 Beat/Choice，再运行完整内容图校验。
- 文字冒险把正式重要地点、世界角色与关系、非道具世界词条和 `codexEntries` 的 `artifact` 词条映射为
  有限地图、互动、知识、物品、任务和判定；角色使用冻结便携身份，不依赖实时 Character 行；`itemLedger`
  始终只是运行账本，不作为道具主档。
- AVG 复用同一个分支叙事投影，只叠加 WorldRelease 中冻结的场景、立绘、CG 和声明式 Cue；无媒资时明确
  降级为仍可发布、可通关的纯文字 AVG。
- 世界工作台提供角色、地点、artifact、世界词条和 AVG 媒资的便携选择，并内置“雾港”正式演示世界。路演美术包
  包含 5 张横屏场景、3 名角色的 9 张透明立绘/表情和 3 张结局 CG；演出投影会按人物、场景和节点语义确定性选择
  表情。演示内容仍先写入三注册表治理下的世界资产，再走正常的 WorldRevision → WorldRelease → GameRelease →
  SIM 试玩链，不是样例直达旁路。
