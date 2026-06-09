# 多世界系统设计方案 V2

> Phase 25.4 — 全面修订版
> 基于 V1 方案 + 2026-06-01 讨论补充

---

## 一、核心原则

1. **开关制**：默认关闭，90% 单世界用户零感知。打开后 UI 增加世界维度
2. **数据隔离**：每个世界独立拥有世界观/力量体系/地理/历史/角色
3. **AI 全链路贯通**：所有 AI 调用点都能感知"当前世界"并注入正确上下文
4. **导入导出完整**：JSON 导出包含世界组数据，导入能正确还原
5. **向后兼容**：旧项目不受影响，旧导出文件可正常导入

---

## 二、开关机制

### 2.1 Project 类型新增字段

```typescript
interface Project {
  // ... 现有字段
  /** 是否启用多世界模式（默认 false） */
  enableMultiWorld?: boolean
}
```

### 2.2 开关位置

**项目概况面板**（`ProjectInfoPanel.tsx`）底部新增卡片：

```
┌─────────────────────────────────────────┐
│  🌐 多世界模式                     [开关] │
│  适用于诸天流/无限流/快穿/修仙多界等题材    │
│  开启后可为每个世界创建独立的世界观、      │
│  力量体系、地理和角色设定               │
└─────────────────────────────────────────┘
```

UI 风格复用现有项目设置区的卡片样式（`bg-bg-surface border border-border rounded-lg p-4`）。

### 2.3 开关效果

| 状态 | 侧栏变化 | 面板变化 |
|------|---------|---------|
| **关闭**（默认） | 无任何变化 | 所有面板和现在一模一样 |
| **打开** | 设定库顶部新增「🌐 世界总览」入口 | 世界观/力量/地理/历史面板顶部出现世界切换器；大纲卷节点出现世界标签；角色面板出现世界过滤器 |

### 2.4 开关关闭时的数据处理

关闭多世界不删数据。已创建的世界组保留在 DB 中，只是 UI 不显示。重新打开后数据还在。

---

## 三、数据模型

### 3.1 新增表：`worldGroups`（DB v22）

```typescript
export interface WorldGroup {
  id?: number
  projectId: number
  name: string                    // "斗破世界"、"遮天世界"
  description: string             // 简要描述
  type: WorldGroupType            // primary/traversal/instance/parallel/ascension/custom
  icon?: string                   // emoji
  color?: string                  // hex 色值
  order: number                   // 穿越顺序/排列顺序

  // 穿越/进入规则
  entryCondition?: string         // 进入条件
  exitCondition?: string          // 离开条件
  plannedChapterCount?: number    // 预计章节数

  // 能力继承规则
  powerRestriction?: string       // 进入此世界时的能力限制
  takeawayRules?: string          // 可从此世界带走的能力/物品

  createdAt: number
  updatedAt: number
}

export type WorldGroupType =
  | 'primary'      // 主世界（每项目有且仅有一个）
  | 'traversal'    // 穿越目标（诸天流）
  | 'instance'     // 副本（无限流）
  | 'parallel'     // 平行世界
  | 'ascension'    // 上界/高维（修仙多界）
  | 'custom'       // 自定义
```

### 3.2 新增表：`worldGroupLinks`（DB v22）

```typescript
export interface WorldGroupLink {
  id?: number
  projectId: number
  fromGroupId: number
  toGroupId: number
  linkType: 'portal' | 'ascension' | 'summon' | 'branch' | 'return' | 'custom'
  name?: string                   // 传送门/通道名称
  description?: string
  bidirectional: boolean
  createdAt: number
}
```

### 3.3 现有表新增可选字段

以下字段全部可选（`?`），旧数据 `undefined` = 属于默认主世界组。

| 表 | 新增字段 | 说明 |
|----|---------|------|
| `Worldview` | `worldGroupId?: number` | 所属世界组 |
| `PowerSystem` | `worldGroupId?: number` | 所属世界组 |
| `Geography` | `worldGroupId?: number` | 所属世界组 |
| `History` | `worldGroupId?: number` | 所属世界组 |
| `WorldNode` | `worldGroupId?: number` | 所属世界组 |
| `OutlineNode` | `worldGroupId?: number` | 此卷/章发生在哪个世界 |
| `Character` | `homeWorldGroupId?: number` | 角色原属世界 |
| `Character` | `isCrossWorld?: boolean` | 跨世界角色（主角/系统精灵等） |

### 3.4 DB Schema

```typescript
// schema.ts — v22
this.version(22).stores({
  worldGroups: '++id, projectId, type, order',
  worldGroupLinks: '++id, projectId, fromGroupId, toGroupId',
})
```

Dexie 的新增可选字段不需要修改 stores 定义（它只用于索引声明）。

### 3.5 迁移策略

零迁移。首次打开项目时：
1. 检测 `worldGroups` 表中是否有该项目的记录
2. 若无 + `enableMultiWorld === true`，自动创建一个 `type: 'primary'` 的默认主世界组
3. 所有 `worldGroupId === undefined` 的数据视为属于默认组

---

## 四、Store 设计

### 4.1 新增 `stores/world-group.ts`

```typescript
interface WorldGroupStore {
  groups: WorldGroup[]
  links: WorldGroupLink[]
  activeGroupId: number | null   // 当前选中的世界组
  loading: boolean

  // CRUD
  loadAll: (projectId: number) => Promise<void>
  createGroup: (data: ...) => Promise<number>
  updateGroup: (id: number, patch: Partial<WorldGroup>) => Promise<void>
  deleteGroup: (id: number) => Promise<void>   // 级联删除该组下所有数据
  reorderGroups: (ids: number[]) => Promise<void>

  // 世界间关系
  createLink: (data: ...) => Promise<number>
  deleteLink: (id: number) => Promise<void>

  // 辅助
  ensurePrimaryGroup: (projectId: number) => Promise<number>
  setActiveGroup: (id: number | null) => void
}
```

### 4.2 现有 Store 改动

| Store | 改动 |
|-------|------|
| `worldview.ts` | `loadAll` / `saveWorldview` 增加可选 `worldGroupId` 参数，按组过滤/保存 |
| `character.ts` | `loadAll` 支持可选 `worldGroupId` 过滤；新增 `getCrossWorldCharacters()` |
| `outline.ts` | 创建卷时支持 `worldGroupId` 字段 |
| `project.ts` | `deleteProject` 级联删除 `worldGroups` + `worldGroupLinks` |

### 4.3 WorkspacePage 加载流程

```typescript
// WorkspacePage.tsx — 现有并行加载块末尾追加
if (project.enableMultiWorld) {
  await useWorldGroupStore.getState().loadAll(pid)
}
```

---

## 五、UI 设计

所有新 UI 遵循项目现有风格：
- 面板标题：`text-xl font-bold text-text-primary`，emoji + 标题
- 描述文字：`text-xs text-text-muted`
- 卡片：`bg-bg-surface border border-border rounded-lg p-4`
- 按钮：`bg-accent text-white rounded-lg` / `bg-accent/10 text-accent`
- 左侧边栏导航宽度/颜色：复用现有 Sidebar 组件

### 5.1 侧栏变化

`enableMultiWorld === true` 时，在设定库 section 的「世界观」分支**前面**插入：

```
设定库
  🌐 世界总览        ← 新增（点击进入世界管理面板）
  📖 世界观
    ⚖️ 真实与幻想
    ✨ 世界起源       ← 顶部增加世界切换器
    🏔 自然环境       ← 顶部增加世界切换器
    👥 人文环境       ← 顶部增加世界切换器
    🕐 历史年表       ← 顶部增加世界切换器
    🗺 世界地图       ← 顶部增加世界切换器
  ...
```

### 5.2 世界总览面板（WorldGroupOverview.tsx）

```
┌─────────────────────────────────────────────┐
│  🌐 世界总览                                 │
│  管理多个世界的设定，定义世界间的关系           │
├─────────────────────────────────────────────┤
│                                             │
│  ┌── 世界列表 ──────────────────────────┐   │
│  │  🏠 主世界（修真大陆）      [编辑] [▶]  │   │
│  │  🔥 斗破世界               [编辑] [▶]  │   │
│  │  ⭐ 遮天世界               [编辑] [▶]  │   │
│  │                                      │   │
│  │  [+ 添加世界]  [✨ AI 建议世界]       │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌── 世界关系图 ────────────────────────┐   │
│  │                                      │   │
│  │   🏠 ──传送门──→ 🔥 ──飞升──→ ⭐     │   │
│  │                                      │   │
│  │  [+ 添加关系]                         │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌── 穿越总览 ──────────────────────────┐   │
│  │  世界    │ 预计章节 │ 穿越条件         │   │
│  │  斗破    │ 80      │ 实力达斗皇       │   │
│  │  遮天    │ 120     │ 完成斗破主线     │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### 5.3 世界组详情面板（WorldGroupDetail.tsx）

点击世界列表中的 [编辑] 进入：

```
┌─────────────────────────────────────────────┐
│  ← 返回世界总览                              │
│  🔥 斗破世界                [穿越目标世界]    │
├─────────────────────────────────────────────┤
│  ┌── 基础信息 ──────────────────────────┐   │
│  │  名称：[斗破世界        ]              │   │
│  │  类型：[穿越目标 ▾]                   │   │
│  │  描述：[斗气大陆，以斗气为...         ] │   │
│  │  图标：[🔥]  颜色：[#FF6B35]          │   │
│  │  预计章节数：[80]                     │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌── 穿越规则 ──────────────────────────┐   │
│  │  进入条件：[主线触发，实力达斗皇      ] │   │
│  │  能力限制：[修为压制至斗者           ] │   │
│  │  可带走：  [异火（最多一种）、炼药术  ] │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  [进入该世界的设定编辑 →]                     │
│  （跳转到世界观面板，自动切换到此世界组）       │
└─────────────────────────────────────────────┘
```

### 5.4 世界切换器（WorldGroupSwitcher 组件）

在世界观/力量/地理/历史面板顶部（标题栏右侧）显示：

```
🌌 世界起源与核心设定              [🏠 主世界 ▾]
                                   ├─ 🏠 主世界
                                   ├─ 🔥 斗破世界
                                   └─ ⭐ 遮天世界
```

- 下拉选择后，面板数据切换为对应世界组的数据
- 切换时调用 `worldGroupStore.setActiveGroup(id)` + 重新加载对应 store 数据
- 选中世界的 icon + name 显示在按钮上，带颜色标记

### 5.5 大纲面板世界标签

卷节点右侧显示世界标签（下拉选择）：

```
📖 第一卷：起源          [🏠 主世界 ▾]
  ├─ 第1章：觉醒
  └─ 第2章：穿越
📖 第二卷：斗破之旅       [🔥 斗破世界 ▾]
  ├─ 第3章：降临
  └─ 第4章：逆袭
```

设置后自动写入 `outlineNode.worldGroupId`。

### 5.6 角色面板世界过滤器

角色列表顶部增加过滤条：

```
[全部] [🏠 主世界] [🔥 斗破] [⭐ 遮天] [🌐 跨世界]
```

角色卡片右上角显示归属世界标签。

---

## 六、AI 上下文全链路

### 6.1 两个核心上下文构建函数

新增文件 `src/lib/ai/world-group-context.ts`：

```typescript
/**
 * 构建当前世界的完整上下文（用于在某个世界内生成内容）
 * 约 1500-3000 tokens
 */
export async function buildCurrentWorldContext(
  projectId: number,
  worldGroupId: number,
): Promise<string>

/**
 * 构建所有世界的精简摘要（用于跨世界场景和世界管理）
 * 每世界限 100 字摘要，10 个世界 ≈ 1000 tokens
 */
export async function buildAllWorldsOverview(
  projectId: number,
): Promise<string>
```

### 6.2 每个 AI 调用点的改造清单

以下 26 个组件/文件有 AI 调用，逐一说明改造方式：

| # | 文件 | 当前上下文 | 多世界改造 |
|---|------|-----------|-----------|
| 1 | `WorldviewOriginPanel.tsx` | 三面板互读 | 改为读**当前世界**的三面板 + 注入其他世界摘要 |
| 2 | `WorldviewNaturalPanel.tsx` | 同上 | 同上 |
| 3 | `WorldviewHumanityPanel.tsx` | 同上 | 同上 |
| 4 | `WorldviewPanel.tsx` | 世界观 | 读当前世界世界观 |
| 5 | `WorldviewFieldEditor.tsx` | 世界观 | 读当前世界世界观 |
| 6 | `StoryCorePanel.tsx` | 世界观 | 注入所有世界摘要（故事核心是项目级的） |
| 7 | `CharacterPanel.tsx` | 世界观+故事核心+力量 | 读当前世界设定 + 跨世界角色列表 |
| 8 | `OutlinePanel.tsx` | 世界观+角色+规则 | **按卷**读对应世界设定 |
| 9 | `DetailedOutlinePanel.tsx` | 世界观+角色 | 读本章所属世界设定 |
| 10 | `ScenePanel.tsx` | 世界观+故事核心 | 读本章所属世界设定 |
| 11 | `ChapterEditor.tsx` | 全量上下文 | 读本章所属世界设定 + 跨世界角色 |
| 12 | `CharacterDrivenPlotPanel.tsx` | 世界观+角色+规则 | 读当前世界 or 所有世界摘要 |
| 13 | `StoryArcPanel.tsx` | 世界观+故事核心+力量 | 注入所有世界摘要 |
| 14 | `ForeshadowPanel.tsx` | 世界观+角色 | 读当前世界 + 跨世界伏笔 |
| 15 | `InspirationPanel.tsx` | 项目级 | 多世界版：输出 worlds[] 字段 |
| 16 | `GeographyPanel.tsx` | 无 | 读当前世界自然环境 |
| 17 | `WorldMapPanel.tsx` | 世界观 | 读当前世界设定 |
| 18 | `HistoryPanel.tsx` | 世界观 | 读当前世界设定 |
| 19 | `CharacterRelationPanel.tsx` | 大纲+正文 | 按世界过滤角色 |
| 20 | `CreativeRulesPanel.tsx` | 世界观+故事核心 | 读当前世界 or 所有世界 |
| 21 | `FloatingToolbar.tsx` | 章节上下文 | 继承章节的世界 |
| 22 | `ReviewPanel.tsx` | 章节上下文 | 继承章节的世界 |
| 23 | `EmotionBeatCard.tsx` | 章节上下文 | 继承章节的世界 |
| 24 | `AIFieldCard.tsx` | 通用 | 透传 worldGroupId |
| 25 | `WorkflowRunner.tsx` | 世界观+故事核心 | 读当前世界 |
| 26 | `PromptExamplesEditor.tsx` | 示例数据 | 不需要改 |

改造原则：
- **单世界模式**（enableMultiWorld=false）：走原有逻辑，零改动
- **多世界模式**：通过 `worldGroupStore.activeGroupId` 判断当前世界，注入对应上下文

### 6.3 上下文注入示意

```typescript
// 改造后的通用模式（以世界观面板为例）
const { activeGroupId } = useWorldGroupStore()
const isMultiWorld = project.enableMultiWorld && activeGroupId

// 构建上下文
let worldCtx: string
if (isMultiWorld) {
  // 多世界：当前世界详细 + 其他世界摘要
  worldCtx = await buildCurrentWorldContext(project.id!, activeGroupId)
  const overview = await buildAllWorldsOverview(project.id!)
  worldCtx += `\n\n${overview}`
} else {
  // 单世界：走原有逻辑
  worldCtx = buildWorldContext(worldview, storyCore, powerSystem)
}
```

### 6.4 context-builder.ts 改造

`buildWorldContext` 函数签名不变（向后兼容），新增 `buildCurrentWorldContext` 和 `buildAllWorldsOverview`。

`buildCharacterContext` 新增可选参数 `worldGroupId`：传了则只返回该世界角色 + 跨世界角色。

---

## 七、AI 生成场景

### 7.1 已有面板内的世界感知（自动）

用户在世界观/大纲/章节面板点 AI 生成时，系统自动注入当前世界上下文。用户不需要做任何额外操作。

### 7.2 世界建议（新增 prompt seed：`world-group.suggest`）

世界总览面板点「AI 建议世界」：

- 输入：已有世界摘要 + 故事主线 + 用户补充说明
- 输出：JSON 数组 `[{name, type, description, entryCondition, powerRestriction, plannedChapterCount}]`
- 用户预览后勾选采纳，批量创建世界组

### 7.3 世界扩写（新增 prompt seed：`world-group.expand`）

在世界总览选中某个世界点「AI 扩写」：

- 输入：该世界的草稿描述 + 其他世界摘要（避免雷同） + 故事主线
- 输出：该世界的完整世界观（worldOrigin/powerHierarchy/continentLayout 等 v3 字段）
- 采纳后写入该世界组的 Worldview 记录

### 7.4 灵感反推增强（修改 `inspiration.reverse`）

多世界模式下的灵感反推：

- 输出结构新增 `worlds` 字段：
  ```json
  {
    "storyCore": { ... },
    "worlds": [
      {
        "name": "斗破世界",
        "type": "traversal",
        "worldOrigin": "...",
        "powerHierarchy": "...",
        "entryCondition": "...",
        "powerRestriction": "..."
      }
    ],
    "characters": [
      { ..., "homeWorld": "斗破世界", "isCrossWorld": false }
    ]
  }
  ```
- 采纳时自动创建世界组 + 各世界的 Worldview + 角色归属

---

## 八、导入导出

### 8.1 JSON 导出（json-export.ts）

`ProjectExportData` 新增（v3）：

```typescript
interface ProjectExportData {
  version: 3  // 从 2 升到 3
  // ... 现有字段

  // v3 新增
  worldGroups?: (Omit<WorldGroup, 'id' | 'projectId'> & { _exportId: number })[]
  worldGroupLinks?: (Omit<WorldGroupLink, 'id' | 'projectId' | 'fromGroupId' | 'toGroupId'> & {
    _fromGroupExportId: number
    _toGroupExportId: number
  })[]
}
```

现有表的导出记录中自动包含新的可选字段（`worldGroupId` / `homeWorldGroupId` / `isCrossWorld`），因为它们已经在对象上了。

### 8.2 JSON 导入（json-export.ts）

导入时：
1. 先导入 `worldGroups`（如有），建立 `exportId → newId` 映射
2. 导入 `worldGroupLinks`，重建 `fromGroupId` / `toGroupId`
3. 导入 Worldview / PowerSystem / Geography / Character / OutlineNode 时，如果有 `worldGroupId`，用映射表转换为新 ID
4. 如果导入的文件是 v2（无世界组数据），正常导入，所有数据属于默认组

### 8.3 Gist 导出

`gist-export.ts` 不需要改（它调用 `exportProjectJSON`，自动包含新数据）。

### 8.4 EPUB / HTML / TXT 导出

这些导出的是正文内容，不涉及世界观数据，无需改动。但可以考虑在 EPUB 目录中标注各卷所属世界（后续优化，不在本期）。

---

## 九、数据保存逻辑

### 9.1 世界组 CRUD

- 创建：`createGroup` 写入 DB + 刷新 store
- 编辑：`updateGroup` 写入 DB + 刷新 store（实时保存，同现有面板模式）
- 删除：级联删除该组下的 Worldview / PowerSystem / Geography / History / WorldNode，角色的 `homeWorldGroupId` 清为 null。primary 组不可删
- 排序：拖拽排序，调用 `reorderGroups`

### 9.2 世界切换时的数据加载

切换世界（`setActiveGroup`）时：
1. worldview store 重新加载该组的 Worldview（按 `worldGroupId` 过滤）
2. 同理加载 PowerSystem / Geography / History
3. 角色不整体切换，而是在角色面板按过滤器展示

### 9.3 项目删除级联

`project.ts deleteProject` 需追加：
```typescript
await db.worldGroups.where('projectId').equals(id).delete()
await db.worldGroupLinks.where('projectId').equals(id).delete()
```

---

## 十、边界情况与风险

| 场景 | 处理方式 |
|------|---------|
| 旧项目打开（无 worldGroups 数据） | 不自动创建任何东西，`enableMultiWorld` 默认 false |
| 开启多世界但不创建任何世界 | 自动创建 primary 组，所有现有数据归入此组 |
| 删除非 primary 世界组 | 确认弹窗 → 级联删除该组下所有数据，关联的大纲卷 worldGroupId 清 null |
| 导入 v2 文件到已开启多世界的项目 | 导入数据归入默认 primary 组 |
| 导入 v3 文件到未开启多世界的项目 | 正常导入世界组数据，但 UI 不显示（开关关着），数据不丢 |
| 世界组过多（>20） | 限制上限 20 个 + 列表支持搜索/折叠 |
| AI 上下文超长 | `buildAllWorldsOverview` 每世界限 100 字，10 世界 ≈ 1000 tokens；`buildCurrentWorldContext` 限 3000 字 |
| 角色既属于某个世界又出现在其他世界 | 用 `isCrossWorld=true` 标记，在所有世界中都可见 |
| 关闭多世界后再打开 | 数据保留，UI 恢复显示 |

---

## 十一、文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/lib/types/world-group.ts` | WorldGroup / WorldGroupLink 类型 |
| `src/stores/world-group.ts` | WorldGroupStore |
| `src/lib/ai/world-group-context.ts` | buildCurrentWorldContext / buildAllWorldsOverview |
| `src/components/world-group/WorldGroupOverview.tsx` | 世界总览面板 |
| `src/components/world-group/WorldGroupDetail.tsx` | 世界组详情面板 |
| `src/components/world-group/WorldGroupSwitcher.tsx` | 面板顶部世界切换器（复用组件） |
| `src/components/world-group/WorldRelationGraph.tsx` | 世界关系图（SVG） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/lib/types/project.ts` | Project 增加 `enableMultiWorld` |
| `src/lib/types/worldview.ts` | Worldview / PowerSystem 增加 `worldGroupId` |
| `src/lib/types/character.ts` | Character 增加 `homeWorldGroupId` / `isCrossWorld` |
| `src/lib/types/outline.ts` | OutlineNode 增加 `worldGroupId` |
| `src/lib/types/index.ts` | 导出新类型 |
| `src/lib/db/schema.ts` | v22：新增 worldGroups + worldGroupLinks 表 |
| `src/stores/worldview.ts` | loadAll / saveWorldview 支持 worldGroupId |
| `src/stores/character.ts` | 过滤 + getCrossWorldCharacters |
| `src/stores/outline.ts` | 创建卷支持 worldGroupId |
| `src/stores/project.ts` | deleteProject 级联删除 |
| `src/lib/export/json-export.ts` | v3 导出/导入世界组数据 |
| `src/lib/ai/context-builder.ts` | buildWorldContext 适配多世界 |
| `src/lib/ai/prompt-seeds.ts` | 新增 2 个 seed + 灵感反推增强 |
| `src/components/layout/sidebar-tree.ts` | 新增 world-overview 入口 + SidebarModule |
| `src/pages/WorkspacePage.tsx` | 注册新面板 + 加载世界组数据 |
| `src/components/project/ProjectInfoPanel.tsx` | 多世界开关 UI |
| `src/components/worldview/WorldviewOriginPanel.tsx` | 世界切换器 + 上下文改造 |
| `src/components/worldview/WorldviewNaturalPanel.tsx` | 同上 |
| `src/components/worldview/WorldviewHumanityPanel.tsx` | 同上 |
| `src/components/outline/OutlinePanel.tsx` | 卷节点世界标签 |
| `src/components/character/CharacterPanel.tsx` | 世界过滤器 |
| `src/components/editor/ChapterEditor.tsx` | 上下文注入当前世界 |
| `src/components/project/InspirationPanel.tsx` | 多世界灵感反推 |

---

## 十二、实现分期

### Phase A — 地基层（类型 + DB + Store + 导出）
1. 类型定义：`world-group.ts`
2. DB schema v22
3. `world-group.ts` store
4. `project.ts` 级联删除
5. `json-export.ts` v3 导出/导入
6. Project 类型 + `ProjectInfoPanel` 开关 UI
7. 验证：`tsc --noEmit` + `build`

### Phase B — 世界管理 UI
1. `WorldGroupOverview.tsx` 世界列表 + 增删改排序
2. `WorldGroupDetail.tsx` 世界详情编辑
3. `WorldGroupSwitcher.tsx` 面板顶部切换器
4. `sidebar-tree.ts` + `WorkspacePage.tsx` 注册
5. 验证：可手动创建/编辑/删除世界组，切换器工作

### Phase C — 数据隔离
1. `worldview.ts` store 按 worldGroupId 加载/保存
2. 世界观三面板 + 力量 + 地理 + 历史面板接入切换器
3. 角色面板世界过滤器
4. 大纲面板卷节点世界标签
5. 验证：切换世界后面板数据正确切换

### Phase D — AI 全链路
1. `world-group-context.ts` 两个构建函数
2. 26 个 AI 调用点逐一改造
3. prompt-seeds 新增 `world-group.suggest` / `world-group.expand`
4. 灵感反推多世界增强
5. 验证：AI 生成时正确感知当前世界

### Phase E — 世界关系图 + 高级功能
1. `WorldRelationGraph.tsx` SVG 可视化
2. WorldGroupLink CRUD
3. 角色跨世界状态
4. 穿越总览表格
5. 验证：完整多世界创作体验

---

## 十三、验证方式

1. `npx tsc --noEmit` 零错误
2. `npm run build` 成功
3. 功能验证：
   - 新建项目 → 开启多世界 → 创建 3 个世界组 → 每个世界独立填写世界观 → AI 生成时互相参考但不雷同
   - 大纲标记不同卷属于不同世界 → 章节编辑时 AI 自动注入对应世界设定
   - AI 建议世界 → 批量创建 → AI 扩写某个世界
   - 灵感反推 → 一次性生成多世界框架 → 采纳
   - 导出 → 导入到新项目 → 世界组数据完整还原
   - 旧项目打开 → 无影响，开关关闭
