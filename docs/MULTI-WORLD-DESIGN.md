# 多重世界系统设计方案

> Phase 25.4 — 支持诸天流、无限流、平行世界等多世界观题材

---

## 一、场景分析

### 1.1 目标用户画像

| 题材 | 代表作 | 世界观特点 | 核心需求 |
|------|--------|-----------|---------|
| 诸天流 | 《诸天万界》系列 | 主角依次穿越多个已知/原创世界，每个世界有独立力量体系、社会结构、历史背景 | 世界间独立但有穿越顺序，主角能力跨世界继承与限制 |
| 无限流 | 《无限恐怖》系列 | 多个副本世界（影视/游戏/原创），每次进入一个副本，有独立规则 | 副本规则独立、主空间作为 hub、积分/奖惩系统 |
| 平行世界 | 多元宇宙题材 | 同一世界的不同分支，共享基础设定但关键事件分叉 | 世界间共享基底设定、差异点标注 |
| 穿书/快穿 | 快穿文 | 主角穿入多个"书中世界"，每个世界有独立剧情线 | 世界模板化、任务系统、主角人设继承 |
| 修仙多界 | 凡人修仙系列 | 人界→灵界→仙界→真仙界，层层递进 | 垂直层级、升级条件、界间通道 |

### 1.2 当前系统的局限

```
当前架构:
Project
  └── WorldNode[] (单棵世界树, 1 个根节点 = "主世界")
       ├── 子位面 A
       └── 子位面 B
  └── Worldview (单份世界观, 绑定 projectId)
  └── PowerSystem (单个力量体系)
  └── OutlineNode[] / Chapter[] (无世界关联)
```

**问题**：
1. `Worldview` 表按 `projectId` 唯一——无法为每个世界存独立世界观
2. `PowerSystem` 同理——诸天流中每个世界的力量体系完全不同
3. `OutlineNode` / `Chapter` 无 `worldId` 字段——无法标记"这一卷发生在哪个世界"
4. `Character` 无世界归属——穿越角色在不同世界的状态无法区分
5. `Geography` 按 `projectId` 唯一——只能存一套地理数据

---

## 二、方案选型

### 方案对比

| 维度 | A: 多根世界树 | B: 世界组 WorldGroup | C: 世界标签 |
|------|-------------|---------------------|-------------|
| 数据隔离 | 弱（同一棵树的不同子树） | 强（每组独立子表关联） | 无（靠字符串过滤） |
| 新增表 | 0 | 1（worldGroups） | 0 |
| 现有表改动 | 小 | 中 | 小 |
| 独立世界观 | 需在 WorldNode 上挂 worldviewId | 天然支持（每组绑定 worldview） | 不支持 |
| 向后兼容 | 好（现有单根树不变） | 好（旧项目自动创建默认组） | 好 |
| 扩展性 | 一般 | 强 | 弱 |
| 适合题材 | 修仙多界（层级递进） | 诸天流/无限流/快穿 | 简单平行世界 |

### 最终选择：方案 B（世界组）+ 方案 A 局部融合

**理由**：
- 诸天流/无限流是最复杂也最热门的场景，需要强数据隔离
- 世界组能天然承载独立的世界观、力量体系、地理、历史
- 同时保留 WorldNode 世界树能力——世界组内部仍可用树形结构（如修仙多界中仙界→天界→圣域的层级）
- 老项目零迁移：默认组 = 当前整个项目

---

## 三、数据模型设计

### 3.1 新增表：`worldGroups`

```typescript
/** 世界组 — 一组独立的世界观设定 */
export interface WorldGroup {
  id?: number
  projectId: number
  /** 世界组名称（如"斗破世界"、"遮天世界"、"主空间"） */
  name: string
  /** 世界组描述 */
  description: string
  /** 世界组类型 */
  type: WorldGroupType
  /** 图标 emoji */
  icon?: string
  /** 封面色（hex，用于 UI 区分） */
  color?: string
  /** 排序（穿越顺序 / 副本编号） */
  order: number

  // ── 穿越/进入条件 ──
  /** 进入条件描述（如"完成遮天世界主线后触发"） */
  entryCondition?: string
  /** 离开条件描述 */
  exitCondition?: string
  /** 在此世界的预计章节数（帮助作者规划篇幅） */
  plannedChapterCount?: number

  // ── 能力继承规则 ──
  /** 主角进入此世界时的能力限制规则（如"修为压制到筑基期"） */
  powerRestriction?: string
  /** 从此世界可带走的能力/物品 */
  takeawayRules?: string

  createdAt: number
  updatedAt: number
}

/** 世界组类型 */
export type WorldGroupType =
  | 'primary'      // 主世界（每个项目有且仅有一个）
  | 'traversal'    // 穿越目标世界（诸天流）
  | 'instance'     // 副本世界（无限流）
  | 'parallel'     // 平行世界（分支宇宙）
  | 'ascension'    // 上界/高维世界（修仙晋升）
  | 'custom'       // 自定义
```

### 3.2 现有表改动

#### Worldview — 增加世界组关联

```typescript
interface Worldview {
  // ... 现有字段不变
  /** 所属世界组 ID（null = 绑定项目默认组，兼容旧数据） */
  worldGroupId?: number | null
}
```

#### PowerSystem — 增加世界组关联

```typescript
interface PowerSystem {
  // ... 现有字段不变
  /** 所属世界组 ID */
  worldGroupId?: number | null
}
```

#### Geography — 增加世界组关联

```typescript
interface Geography {
  // ... 现有字段不变
  /** 所属世界组 ID */
  worldGroupId?: number | null
}
```

#### OutlineNode — 增加世界组标记

```typescript
interface OutlineNode {
  // ... 现有字段不变
  /** 此卷/篇章发生在哪个世界组（null = 默认/主世界） */
  worldGroupId?: number | null
}
```

#### Character — 增加原属世界

```typescript
interface Character {
  // ... 现有字段不变
  /** 角色原属世界组 ID（null = 主角/跨世界角色） */
  homeWorldGroupId?: number | null
  /** 是否是跨世界角色（主角、系统精灵等） */
  isCrossWorld?: boolean
}
```

#### WorldNode — 增加世界组归属

```typescript
interface WorldNode {
  // ... 现有字段不变
  /** 所属世界组 ID（null = 默认组） */
  worldGroupId?: number | null
}
```

### 3.3 新增表：`worldGroupLinks`（世界间关系）

```typescript
/** 世界组之间的关联关系 */
export interface WorldGroupLink {
  id?: number
  projectId: number
  /** 源世界组 ID */
  fromGroupId: number
  /** 目标世界组 ID */
  toGroupId: number
  /** 关系类型 */
  linkType: WorldGroupLinkType
  /** 通道/传送门名称 */
  name?: string
  /** 关系描述 */
  description?: string
  /** 是否双向 */
  bidirectional: boolean
  createdAt: number
}

export type WorldGroupLinkType =
  | 'portal'       // 传送门/通道
  | 'ascension'    // 飞升/晋升通道
  | 'summon'       // 召唤/拉入
  | 'branch'       // 分支点（平行世界分叉）
  | 'return'       // 回归通道
  | 'custom'       // 自定义
```

### 3.4 数据关系全景

```
Project
  ├── WorldGroup[] ─────── 每个世界组独立拥有：
  │     ├── [primary] 主世界          ├── Worldview (worldGroupId)
  │     ├── [traversal] 斗破世界      ├── PowerSystem[] (worldGroupId)
  │     ├── [traversal] 遮天世界      ├── Geography (worldGroupId)
  │     └── [instance] 副本#1         ├── WorldNode[] (worldGroupId) — 组内世界树
  │                                   ├── Character[] (homeWorldGroupId) — 本世界角色
  │                                   └── History (可选，worldGroupId)
  │
  ├── WorldGroupLink[] ── 世界间传送门、飞升通道等
  │
  ├── OutlineNode[] ───── worldGroupId 标记此卷属于哪个世界
  │     ├── 第一卷（主世界）
  │     ├── 第二卷（斗破世界）
  │     └── 第三卷（遮天世界）
  │
  ├── Character[] ─────── isCrossWorld=true 的角色跨世界存在
  │     ├── 主角（isCrossWorld=true, homeWorldGroupId=null）
  │     ├── 系统精灵（isCrossWorld=true）
  │     ├── 萧炎（homeWorldGroupId=斗破）
  │     └── 叶凡（homeWorldGroupId=遮天）
  │
  └── StoryCore ────────── 项目级，不按世界分（整体故事主线）
```

---

## 四、DB Schema 变更

```typescript
// schema.ts — 新增 version (当前 v11 → v12)
this.version(12).stores({
  // 新增表
  worldGroups: '++id, projectId, type, order',
  worldGroupLinks: '++id, projectId, fromGroupId, toGroupId',
  // 现有表索引不变（新字段都是可选的，Dexie 不需要额外索引）
})
```

**注意**：所有新字段（`worldGroupId`, `homeWorldGroupId`, `isCrossWorld`）都是可选的，旧数据自动兼容——`undefined` 等同于"属于默认主世界组"。

### 迁移策略

无需数据迁移。新项目首次打开时：
1. 检测 `worldGroups` 表中是否有该项目的记录
2. 若无，自动创建一个 `type: 'primary'` 的默认主世界组
3. 现有所有 `worldGroupId === undefined` 的数据都视为属于这个默认组

---

## 五、Store 设计

### 5.1 新增 `world-group.ts`

```typescript
interface WorldGroupStore {
  groups: WorldGroup[]
  activeGroupId: number | null
  links: WorldGroupLink[]
  loading: boolean

  loadGroups: (projectId: number) => Promise<void>
  setActiveGroup: (id: number | null) => void
  createGroup: (data: Omit<WorldGroup, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateGroup: (id: number, patch: Partial<WorldGroup>) => Promise<void>
  deleteGroup: (id: number) => Promise<void>
  reorderGroups: (projectId: number, orderedIds: number[]) => Promise<void>

  // 世界间关系
  loadLinks: (projectId: number) => Promise<void>
  createLink: (data: Omit<WorldGroupLink, 'id' | 'createdAt'>) => Promise<number>
  deleteLink: (id: number) => Promise<void>

  // 确保默认主世界组存在
  ensurePrimaryGroup: (projectId: number) => Promise<number>

  // 辅助查询
  getGroupCharacters: (groupId: number) => Promise<Character[]>
  getGroupWorldview: (groupId: number) => Promise<Worldview | undefined>
}
```

### 5.2 现有 Store 改动

#### `worldview.ts`
- `loadWorldview(projectId, worldGroupId?)` — 按世界组加载
- `saveWorldview(data, worldGroupId?)` — 按世界组保存

#### `outline.ts`
- 加载时附带 `worldGroupId` 信息
- 创建卷时可指定 `worldGroupId`

#### `character.ts`
- `loadCharacters` 支持可选 `worldGroupId` 过滤
- 新增 `getCrossWorldCharacters(projectId)` — 获取所有跨世界角色

#### `project.ts`
- `deleteProject` 级联删除 `worldGroups` + `worldGroupLinks`

---

## 六、UI 设计

### 6.1 世界组导航栏

在项目左侧导航中新增「世界总览」入口，替代或增强现有的地理面板：

```
┌─────────────────────────────────────────────┐
│  📖 项目名: 诸天万界之旅                       │
├────────┬────────────────────────────────────┤
│        │  🌐 世界总览                         │
│ [侧栏]  │                                    │
│        │  ┌──────────────────────────────┐  │
│ 世界观  │  │  🏠 主世界    →  🔥 斗破世界    │  │
│ 角色    │  │       ↓                       │  │
│ 大纲    │  │  ⭐ 遮天世界  →  🗡️ 完美世界  │  │
│ ...    │  └──────────────────────────────┘  │
│        │           ↑ 世界关系图                │
│ ★世界   │                                    │
│ 总览    │  ┌─ 世界列表 ──────────────────┐  │
│        │  │ 1. 🏠 主世界 (primary)  [编辑] │  │
│        │  │ 2. 🔥 斗破世界            [编辑] │  │
│        │  │ 3. ⭐ 遮天世界            [编辑] │  │
│        │  │ 4. 🗡️ 完美世界           [编辑] │  │
│        │  │        [+ 添加世界]             │  │
│        │  └──────────────────────────────┘  │
└────────┴────────────────────────────────────┘
```

### 6.2 世界组详情面板

点击某个世界组后，展示该世界的完整设定：

```
┌──────────────────────────────────────────────┐
│  🔥 斗破世界                    [穿越目标世界]   │
├──────────────────────────────────────────────┤
│  📋 基础信息                                   │
│  名称: 斗破世界                                │
│  描述: 斗气大陆，以斗气为核心的修炼世界...        │
│  预计章节: 80 章                               │
│                                              │
│  🚪 穿越规则                                   │
│  进入条件: 主线触发，主角实力达到斗皇              │
│  能力限制: 修为压制至斗者，仅保留精神力            │
│  可带走: 异火（最多一种）、炼药术                 │
│                                              │
│  ┌─ Tab: 世界观 │ 力量体系 │ 地理 │ 角色 ─┐     │
│  │                                        │     │
│  │  （该世界独立的世界观编辑面板）            │     │
│  │  — 复用现有 Worldview 面板组件           │     │
│  │  — 数据从 worldGroupId 过滤             │     │
│  │                                        │     │
│  └────────────────────────────────────────┘     │
└──────────────────────────────────────────────┘
```

### 6.3 大纲面板增强

在卷/篇章节点上增加世界组选择器：

```
┌─ 大纲 ──────────────────────────────────────┐
│  📖 第一卷: 起源          🏠 主世界           │
│    ├─ 第1章: 觉醒                            │
│    └─ 第2章: 穿越                            │
│  📖 第二卷: 斗破之旅      🔥 斗破世界          │
│    ├─ 第3章: 降临斗气大陆                     │
│    └─ 第4章: 废柴逆袭                        │
│  📖 第三卷: 遮天之路      ⭐ 遮天世界          │
│    ├─ 第5章: 北域                            │
│    └─ 第6章: 圣体觉醒                        │
└──────────────────────────────────────────────┘
```

每卷右侧的世界标签是一个下拉选择器，选择后自动设置该卷的 `worldGroupId`。

### 6.4 世界关系图（新组件）

使用简单的 SVG/Canvas 绘制世界间关系：

- 每个世界组 = 一个圆形节点（带 icon + name）
- 连线 = WorldGroupLink（箭头方向、连线颜色按 linkType 区分）
- 可拖拽布局
- 双击节点跳转到该世界详情

```typescript
// 组件文件
src/components/world-group/WorldRelationGraph.tsx

// 技术选型：
// - 直接用 SVG + 力导向布局（不引入新依赖）
// - 复用现有 RelationGraph 的布局算法
// - 节点数一般 < 20 个，无需 WebGL 性能优化
```

---

## 七、AI Prompt 适配

### 7.1 上下文构建器扩展

```typescript
// context-builder.ts 新增
export async function buildWorldGroupContext(
  projectId: number,
  worldGroupId: number,
): Promise<string> {
  const group = await db.worldGroups.get(worldGroupId)
  if (!group) return ''

  const worldview = await db.worldviews
    .where('projectId').equals(projectId)
    .filter(w => w.worldGroupId === worldGroupId)
    .first()

  const powerSystems = await db.powerSystems
    .where('projectId').equals(projectId)
    .filter(p => p.worldGroupId === worldGroupId)
    .toArray()

  const chars = await db.characters
    .where('projectId').equals(projectId)
    .filter(c => c.homeWorldGroupId === worldGroupId || c.isCrossWorld)
    .toArray()

  // 拼装上下文字符串
  let ctx = `【当前世界：${group.name}】\n`
  ctx += `类型：${group.type}\n`
  if (group.description) ctx += `概述：${group.description}\n`
  if (group.powerRestriction) ctx += `能力限制：${group.powerRestriction}\n`
  if (worldview?.summary) ctx += `\n【世界观】\n${worldview.summary}\n`
  // ...
  return ctx.slice(0, 3000) // Token 预算控制
}
```

### 7.2 大纲生成 Prompt 增强

当用户为某一卷指定了 `worldGroupId` 时，在 `outline.chapter` prompt 中注入该世界的上下文：

```handlebars
{{#if worldGroupContext}}
【当前世界设定】
{{worldGroupContext}}

请确保生成的章节大纲符合该世界的力量体系和社会规则。
{{#if powerRestriction}}
注意：主角在此世界的能力受到以下限制 —— {{powerRestriction}}
{{/if}}
{{/if}}
```

### 7.3 新增 Prompt Seed：`world-group.suggest`

用于 AI 辅助用户设计世界组：

```
系统提示词：你是一位网文世界观架构师。用户正在规划一部多世界题材的小说，
请根据用户提供的故事概念，建议合理的世界组划分。

输入：故事概念、已有世界列表、题材类型
输出：JSON 数组，每个元素包含 name/type/description/order/entryCondition/powerRestriction
```

---

## 八、交互流程

### 8.1 新项目创建流程

```
1. 用户创建项目，选择流派标签（可多选）
2. 如果流派包含"诸天流"/"无限流"/"多世界"/"快穿"等关键词
   → 弹出提示："是否启用多世界模式？"
   → 是：进入世界规划向导
   → 否：使用默认单世界模式
3. 世界规划向导（可选）:
   a. 输入整体故事概念
   b. AI 建议世界组划分
   c. 用户调整/确认
   d. 自动创建世界组 + 为每个世界组初始化空的 Worldview
```

### 8.2 世界间穿越写作流程

```
1. 用户在大纲面板为新卷选择目标世界（下拉选择 worldGroupId）
2. 系统自动加载该世界的 Worldview/PowerSystem/Character 作为 AI 上下文
3. AI 生成大纲时，自动遵循该世界的设定和能力限制
4. 写作时，状态表自动切换为该世界组的角色集
5. 章节生成的 Prompt 自动注入该世界的上下文
```

### 8.3 角色跨世界管理

```
角色列表面板新增过滤器：
- [全部] [主世界] [斗破世界] [遮天世界] [跨世界]

跨世界角色（isCrossWorld=true）在每个世界组详情页都可见，
但可以针对不同世界添加"世界备注"来记录状态差异。
```

---

## 九、文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `src/lib/types/world-group.ts` | WorldGroup / WorldGroupLink / WorldGroupType / WorldGroupLinkType 类型 |
| 新增 | `src/stores/world-group.ts` | WorldGroupStore — CRUD、关系管理、默认组保证 |
| 新增 | `src/components/world-group/WorldGroupOverview.tsx` | 世界总览面板（列表 + 关系图） |
| 新增 | `src/components/world-group/WorldGroupDetail.tsx` | 单个世界组详情（Tab 切换世界观/力量/地理/角色） |
| 新增 | `src/components/world-group/WorldRelationGraph.tsx` | 世界间关系可视化（SVG 力导向图） |
| 新增 | `src/components/world-group/WorldGroupCreateWizard.tsx` | 创建向导（AI 辅助世界规划） |
| 修改 | `src/lib/db/schema.ts` | v12: 新增 worldGroups + worldGroupLinks 表 |
| 修改 | `src/lib/types/worldview.ts` | Worldview + PowerSystem 增加 worldGroupId |
| 修改 | `src/lib/types/geography.ts` | Geography + WorldNode 增加 worldGroupId |
| 修改 | `src/lib/types/outline.ts` | OutlineNode 增加 worldGroupId |
| 修改 | `src/lib/types/character.ts` | Character 增加 homeWorldGroupId + isCrossWorld |
| 修改 | `src/stores/worldview.ts` | 查询时支持 worldGroupId 过滤 |
| 修改 | `src/stores/character.ts` | 新增 getCrossWorldCharacters + 过滤逻辑 |
| 修改 | `src/stores/outline.ts` | 创建卷时支持 worldGroupId |
| 修改 | `src/stores/project.ts` | 级联删除 worldGroups + worldGroupLinks |
| 修改 | `src/lib/ai/context-builder.ts` | 新增 buildWorldGroupContext() |
| 修改 | `src/lib/ai/prompt-seeds.ts` | 新增 world-group.suggest seed + 现有 prompt 增加世界上下文变量 |
| 修改 | `src/lib/ai/adapters/outline-adapter.ts` | buildChapterOutlinePrompt 支持 worldGroupContext |
| 修改 | `src/lib/export/json-export.ts` | 导出/导入 worldGroups + worldGroupLinks |
| 修改 | `src/components/outline/OutlinePanel.tsx` | 卷节点增加世界组选择器 |
| 修改 | `src/components/character/CharacterPanel.tsx` | 增加世界组过滤器 |

---

## 十、实现分期

### Phase A（地基层）— 预计 2-3 天
1. 类型定义 + DB schema v12
2. world-group store
3. project.ts 级联删除
4. json-export 导出/导入适配
5. **验证**：`tsc --noEmit` + `build` 通过

### Phase B（UI 基础）— 预计 2-3 天
1. WorldGroupOverview 面板（列表 + 增删改）
2. WorldGroupDetail 面板（Tab 页复用现有组件）
3. 左侧导航增加"世界总览"入口
4. 大纲面板的世界组选择器
5. **验证**：可手动创建世界组、为卷指定世界

### Phase C（AI 集成）— 预计 1-2 天
1. context-builder 扩展 buildWorldGroupContext
2. prompt-seeds 增加世界上下文变量
3. outline-adapter 传递 worldGroupContext
4. WorldGroupCreateWizard（AI 辅助世界规划）
5. **验证**：AI 生成大纲时自动感知当前世界设定

### Phase D（关系图 + 高级功能）— 预计 2 天
1. WorldRelationGraph 可视化
2. WorldGroupLink CRUD
3. 角色面板世界过滤器
4. 角色跨世界状态显示
5. **验证**：完整的多世界写作体验

---

## 十一、向后兼容保证

| 场景 | 处理方式 |
|------|---------|
| 旧项目（无 worldGroups 数据） | 首次打开时自动创建 primary 组，所有数据视为属于默认组 |
| 旧数据 worldGroupId = undefined | 等同于默认组，无需迁移 |
| 导入 v1 格式的 JSON | 自动创建默认组后导入，所有数据归入默认组 |
| 用户不使用多世界功能 | 体验完全不变，世界总览面板只显示一个"主世界" |
| 删除非 primary 世界组 | 级联删除该组下的独立 Worldview/PowerSystem/Geography，该组角色的 homeWorldGroupId 设为 null |

---

## 十二、题材专项模板

### 12.1 诸天流模板

```
项目创建 → 选择"诸天流"模板 → 自动生成：
├── 主世界 (primary): 主角出发的起始世界
├── 系统空间 (custom): 诸天万界系统所在的虚拟空间
│   └── 力量体系: 诸天积分系统
└── [待填充] 穿越目标世界 × N
```

AI 建议 Prompt：
```
用户想写一部诸天流小说，主角拥有诸天穿越系统。
请根据以下信息建议 3-5 个穿越目标世界：
- 故事概念：{concept}
- 主角能力：{ability}
- 目标读者：{audience}
输出每个世界的：名称、简介、力量体系特点、建议章节数、穿越顺序理由
```

### 12.2 无限流模板

```
项目创建 → 选择"无限流"模板 → 自动生成：
├── 主空间 (primary): 无限空间/主神空间
│   └── 力量体系: 基因锁 / 奖励兑换系统
├── 副本 #1 (instance): 第一个恐怖副本
└── [待填充] 更多副本
```

### 12.3 修仙多界模板

```
项目创建 → 选择"修仙多界"模板 → 自动生成：
├── 人界 (primary): 修真大陆
│   └── 力量体系: 炼气/筑基/金丹/元婴/化神/渡劫/大乘
├── 灵界 (ascension): 飞升后的高阶世界
│   └── 力量体系: 合体/炼虚/大乘/渡劫/真仙
└── 仙界 (ascension): 最高位面
    └── 力量体系: 真仙/金仙/太乙金仙/大罗金仙
```

---

## 十三、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 世界组过多导致 UI 拥挤 | 列表过长，难以导航 | 限制单项目最多 20 个世界组 + 支持折叠/搜索 |
| 跨世界角色状态管理复杂 | 用户困惑"萧炎在哪个世界" | 角色卡片显示世界标签 + 全局搜索角色 |
| 世界观数据重复（多个世界有相似设定） | 存储浪费 + 维护负担 | 提供"从已有世界复制"功能 + 差异化编辑 |
| AI 上下文过长（多个世界的设定同时注入） | Token 爆表 | 严格只注入当前卷所在世界的上下文，跨世界信息仅取摘要 |
| prompt-seeds 模板变复杂 | 维护困难 | 用 Handlebars 条件分支，非多世界项目走原逻辑 |
| DB schema v12 升级 | Dexie 需要打开数据库时声明新版本 | 新增表 + 可选字段，零迁移风险 |
