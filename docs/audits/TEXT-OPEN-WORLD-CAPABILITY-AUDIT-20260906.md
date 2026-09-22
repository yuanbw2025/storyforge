# 文字开放世界开工能力审计 · 2026-09-06

> 权威层级：L4 实施证据
> 对应任务：`E-OPENWORLD-01` / `TOW-G0-04`～`TOW-G0-06`
> 审计分支：`feat/text-open-world-product-architecture-mainline`（基于 `origin/main` 重新迁移）
> 结论：可以在保留现有事件运行底座的前提下进入完整产品施工；现有内容不是目标产品完成态。

## 1. 审计结论

当前代码已经证明以下纵向能力真实存在：通用产品生产记录、Build 与不可变 `ProductRelease`、正式 Runtime Session、命令幂等、Event 重放、Checkpoint 分支、地区旅行、地区发牌、后台演化、AI 只读表现候选和基础玩家 UI。

它仍然更接近“区域模拟 + 通用文字冒险”的组合，无法直接满足整体产品规格。完整产品缺少角色成长、技能、生命、确定性战斗、装备、奖励、制作、商店、地点级地图、快速旅行、世界分钟/天气、三档关系、完整任务生命周期、知识历程、混合输入和专业AI内容生产编译链。

因此施工策略是：

1. 保留并扩展已经通过回放和生命周期测试的共享底座；
2. 把现有 V1 开放世界模块作为兼容输入，不继续扩大其产品职责；
3. 以新的文字开放世界运行包和统一Action/Condition/Effect契约承接完整玩法；
4. 新纵切面可运行后逐步迁移并下线旧机械编译、JSON维护入口和单页玩家UI；
5. 不建立第二套Session、Event、Build、Release、Harness或三注册表。

## 2. 当前关联闭包

| 环节 | 当前入口/事实源 | 审计判断 |
|---|---|---|
| 产品入口 | `src/pages/ProductHubPage.tsx` | 已区分author/production/play，可保留路由壳 |
| 创作者端 | `src/components/product/ProductProductionStudio.tsx` | 复用统一 Production/Brief/Build/ProductRelease 生命周期；需补文字开放世界专属生产 DAG 和受治理编辑入口 |
| 制作入口 | `src/lib/product-production/` | 新主干统一生产平台已建立；文字开放世界仍需替换通用模块的机械编译路径 |
| 玩家端 | `src/components/text-game/TextOpenWorldPlayer.tsx` | 已能玩旧循环，但单页无法承载完整游戏信息架构 |
| 玩家状态协调 | `src/stores/text-open-world-player.ts` | 复用 ProductRuntimeSession 选择、命令提交、刷新和分支；扩展投影消费 |
| 地区定义与状态 | `src/lib/types/open-world.ts` | Region/Edge/Deck/Card/Schedule/Issue可迁移；不承担完整玩法包 |
| 地区规则 | `src/lib/open-world/runtime.ts` | 解析、验证、发牌、旅行、演化和候选引用校验可复用 |
| 正式命令/Event | `src/lib/product/runtime-core.ts`、`src/lib/open-world/runtime-commands.ts` | 已有 baseSequence/baseStateHash、commandId 幂等、原子 Event 批次和 Checkpoint |
| 旧通用玩法 | `src/lib/types/adventure.ts` | Action/Requirement/Effect和任务基础可借鉴；类型和状态不足以直接扩建全部系统 |
| 发布 | `src/lib/product-production/runtime-package.ts`、`src/lib/product/releases.ts` | 保留统一 ProductRuntimePackage/ProductRelease；在其内扩展文字开放世界专属载荷，不恢复 ProductRelease |
| 世界来源 | `src/lib/context-gateway/world-release-provider.ts`、`src/lib/world-engine/world-reference.ts` | 新主干已具备冻结版本的 describe/search/read/original-evidence 中立出口 |
| AI上下文 | `CONTEXT_SOURCES.openWorldRuntime` | 已有玩家可见运行上下文；生产期需增加专属注册源 |
| AI写入 | `FIELD_REGISTRY` / `AdoptionSchema` | `openWorldModules`已有采用边界；新Artifact字段需随生产DAG逐项登记 |
| 数据生命周期 | `PROJECT_TABLES` 中统一 product production/release/runtime 表族 | 导出、重映射和删除生命周期已存在；产品专属运行模块优先进入 ProductRelease 聚合载荷，不先拆大量物理表 |
| 运行AI | `src/lib/open-world/harness.ts` | Quest/Scene表现候选只读Event并显式采用，可扩展而不允许写状态 |
| 生产编译 | `src/lib/product-production/product-module-compilers.ts` | 机械把通用叙事节点映射成地区和任务，必须由来源→故事→任务→玩法目录生产链替代 |

## 3. 复用、改造与退场矩阵

| 能力 | 决策 | 施工边界 |
|---|---|---|
| ProductRuntimeSession/Event/Checkpoint | 复用 | 保持唯一运行权威，扩展文字开放世界投影和事件 |
| ProductProduction/Build/Artifact/Receipt | 复用 | 新增产品专属 Artifact 和 DAG，不另建生产表族 |
| ProductRuntimePackage/ProductRelease | 复用并扩展 | 新包必须保存来源 Hash、模块版本和兼容信息；不得恢复旧 ProductRelease |
| Context Gateway/Agent Run Harness | 复用 | 所有生产和运行AI登记Skill、读写范围、预算和终态 |
| OpenWorld Region/Deck/Schedule/Issue | 改造迁移 | 成为新包world/director模块的一部分 |
| Adventure Action/Effect/Quest | 改造迁移 | 抽取协议经验，不能继续作为完整产品的玩家状态模型 |
| NarrativeSimulation区域数值 | 限定复用 | 只服务地区状态，不保存第二份玩家资源、时间或关系 |
| TTRPG规则实现 | 协议级借鉴 | 只复用随机证据、效果预演、物品事务和战斗回执经验 |
| 旧 `publishTextOpenWorldGame` / ProductRelease 路径 | 禁止恢复 | 新发布只引用已有 WorldRelease 或产品 SourcePin，并产出 ProductRelease |
| 通用节点机械编译 | 退场 | G3专属P0-P10生产DAG可用后删除旧路径 |
| JSON Workbench | 退场 | G5受治理内容表和局部修复入口完成后删除 |
| 单页Player | 退场 | G4完整场景壳和一级页面可用后删除旧入口 |

## 4. 世界来源出口复核

迁移到最新主干后确认，世界引擎契约要求的渐进式出口已经由中立 Context Gateway 完整实现，无需移植旧分支的重复 `source-gateway.ts`：

- `describeWorldReleaseV1`：返回 `WorldReference`、版本、Hash、能力画像和可导航资源目录；
- `searchWorldReleaseV1`：在冻结 scope 内检索资源描述符，支持分页和明确省略；
- `readWorldResourceV1`：按稳定 resource key 与 detail level 读取结构化详情和引用；
- `readWorldOriginalEvidenceV1`：沿 source ref 回读冻结原文证据；
- provider 校验本地 release ID、冻结 Hash、项目/世界 scope、资源预算和不可变 manifest。

后续产品Agent只能通过注册上下文源或该网关读取冻结来源，不能重新维护世界表清单。

## 5. 基线验证证据

开工前定向运行原有开放世界与生产包测试：

```text
7 test files passed
23 tests passed
```

覆盖旧内核、生命周期、Harness、UI、DB迁移、产品Adapter和RuntimePackage。

新主干既有世界来源出口验证：

```text
`R-WORLD-D-phase-d-closure` 与 `R-ARCH05-world-protocol` 已覆盖
```

覆盖目录/检索/读取/原文证据、版本与资源 Hash、千级分页、跨 World 拒绝、冻结 scope 和草稿变化不污染旧 Release。迁移完成后需在新分支重新运行并记录精确结果。

## 6. 当前缺口优先级

| 优先级 | 缺口 | 对应工作包 |
|---|---|---|
| P0 | 完整运行包、模块Schema、统一Action/Condition/Effect/Event | G1-01～G1-13 |
| P0 | 玩家成长、物品、任务、地图、时间、战斗、制作和经济 | G2-01～G2-28 |
| P0 | 来源到故事、任务和玩法目录的专业内容生产编译器 | G3-01～G3-18 |
| P1 | 完整玩家端和创作者工作台 | G4、G5 |
| P1 | 自然语言映射、NPC对白和表现降级 | G6 |
| P1 | “盐脊”内容、真人游玩、发布修复和旧入口退场 | G7 |

## 7. 开工判断

方案的产品边界和顶层依赖没有需要推翻的问题。可以开始开发，但必须坚持以下顺序：先补运行包与确定性规则，再做完整玩法，再接AI生产和UI。若先扩建旧Player或旧机械编译器，会制造需要再次删除的产品实现。

## 8. 2026-09-21退场复核

开工审计中列出的三项旧路径已经按“新链先可用、旧链后退场”的顺序完成工程收口：

- `product-module-compilers.ts`只保留角色互动与文字冒险需要的通用编译，文字开放世界旧四模块机械编译已删除；
- 通用产品Adapter和通用生产执行器对`text-open-world`显式失败关闭，正式服务与产品入口只路由专属Creator P0～P10/V1～V3；
- 已删除的`text-game/agent-contract.ts`和旧`TextOpenWorldLegacyPlayer.tsx`文件名由G7退场检查器防复活；历史旧包只允许正式ProductRelease进入改名后的兼容播放器，Build Preview不能使用旧运行形态。

旧Release reader、旧运行内核和存档事件协议仍保留，因为它们承担玩家历史兼容，不属于新内容生产入口。冻结的旧运行包只存在于测试资产，用来证明旧Release/Session/Checkpoint仍可读取和重放；它不能被生产代码调用。该结论由`text-open-world-g7-retirement`的12项矩阵和专项回归持续验证。

交付复核进一步确认：旧运行Skill测试已改为只绑定不可变历史Release，新的开放世界入口只接受专属Creator纯vNext会话；17项隔离Chromium覆盖战斗、完整双结局旅程、制作经济、Creator、玩家壳、运行时AI、存档、场景、教程和世界记录并全部通过。构建没有放宽既有预算，而是按产品owner拆分TTRPG确定性规则域与只服务旧Release的兼容reducer；`runtime-core`由840.5KiB/223.1KiB gzip降至566.5KiB/151.9KiB gzip，无循环chunk并通过600/180KiB门。

最终全仓CI随后通过699个测试文件、3554项测试和84.49%语句覆盖率，并再次通过生产构建与bundle预算检查。至此G7-15不存在尚未执行的代码、专项测试、隔离浏览器或全仓自动化门；它继续保持`BLOCKED`只因为任务依赖G7-14的真实修复发布和旧档复测。剩余G7-11/G7-13/G7-14要求的真实模型、真人游玩和真实修复更新证据，均是产品外部实证而不是旧链工程残留。
