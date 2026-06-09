# StoryForge 待开发功能设计方案 v1

> **创建日期**: 2026-05-27
> **目的**: 为所有未完成的中/低优先级功能出具可落地的技术方案，供后续开发参考。

---

## 一、功能总览与优先级排序

| 序号 | 功能 | Phase | 优先级 | 预估工时 | 依赖 |
|------|------|-------|--------|---------|------|
| 1 | 角色关系自动提取 | 30.2 | 中 | 1天 | 无 |
| 2 | 角色驱动剧情模式 | 26.3 | 中 | 2天 | 26.1-26.2 ✅ |
| 3 | 灵感反推入口 | 26.4 | 中 | 1.5天 | 无 |
| 4 | 分析结果去重合并 | 28.1 | 中 | 2天 | 无 |
| 5 | 分析结果结构化展示 | 28.2 | 中 | 1.5天 | 28.1 |
| 6 | 全书总结环节 | 28.3 | 中 | 1天 | 28.1 |
| 7 | 导入分卷支持 | 28.4 | 中 | 1天 | 无 |
| 8 | 导入去重增强 | 30.5 | 中 | 1.5天 | 28.1 部分 |
| 9 | 重要地点模块 | 25.3 | 中 | 2天 | 25.2 ✅ |
| 10 | 多世界方案设计 | 25.4 | 低 | 设计文档 | 25.3 |
| 11 | creativeMode 联动题材包 | 31.3 | 低 | 0.5天 | 31.1-31.2 ✅ |
| 12 | AI Agent 化 | 27 | 远期 | 大重构 | 全部 |

**建议实施顺序**：30.2 → 26.3 → 26.4 → 28.1 → 28.2 → 28.3 → 28.4 → 30.5 → 25.3 → 31.3

---

## 二、各功能详细设计

---

### 2.1 角色关系自动提取（Phase 30.2）

**目标**：从大纲/细纲/正文中 AI 提取角色间的关系，自动写入 `characterRelations` 表。

#### 数据流

```
大纲摘要 + 细纲场景 + 章节正文（取最近 5 章）
         ↓ 拼接为上下文（最多 3000 字）
    AI（prompt: relation.extract）
         ↓ 输出 JSON 数组
    [{ char1: "张三", char2: "李四", type: "师徒", description: "..." }]
         ↓ 去重（同对+同类型跳过）
    写入 characterRelations 表
```

#### 新增文件

| 文件 | 说明 |
|------|------|
| `src/lib/ai/adapters/relation-extract-adapter.ts` | 构建提取 prompt |

#### 新增 Prompt Seed

```
moduleKey: 'relation.extract'
system: 你是角色关系分析师，从小说内容中提取人物关系...
user: 以下是小说内容，请提取角色关系...
输出: JSON 数组 [{char1, char2, type, description}]
type 枚举: kinship/lover/friend/rival/enemy/mentor/ally/subordinate/other
```

#### 改动文件

| 文件 | 改动 |
|------|------|
| `src/lib/types/prompt.ts` | `PromptModuleKey` 增加 `relation.extract` |
| `src/lib/ai/prompt-seeds.ts` | 新增 seed |
| `src/components/relations/CharacterRelationPanel.tsx` | 新增「AI 自动提取」按钮 |
| `src/stores/character-relation.ts` | 新增 `bulkAddIfNotExists(relations[])` |

#### 去重逻辑

```typescript
// 伪代码
for (const r of aiResults) {
  const charA = characters.find(c => c.name === r.char1)
  const charB = characters.find(c => c.name === r.char2)
  if (!charA || !charB) continue  // 找不到角色，跳过
  const exists = relations.some(
    rel => rel.fromCharacterId === charA.id && rel.toCharacterId === charB.id
          && rel.relationType === r.type
  )
  if (!exists) await addRelation({ fromCharacterId: charA.id!, toCharacterId: charB.id!, ... })
}
```

#### UI 位置

关系网面板工具栏右侧，新增按钮「AI 提取关系」（Sparkles 图标），点击后：
1. 显示进度提示「正在分析...」
2. 完成后显示「提取到 N 条新关系，已跳过 M 条重复」
3. 关系列表自动刷新

---

### 2.2 角色驱动剧情模式（Phase 26.3）

**目标**：用户设定角色的「初始状态」和「目标状态/结局」，AI 根据两端状态生成中间剧情大纲。

#### 数据模型

Character 表新增两个可选字段：

```typescript
// src/lib/types/character.ts 新增字段
interface Character {
  // ... 现有字段
  initialState?: string    // 初始状态描述（如"落魄书生，一无所有"）
  goalState?: string       // 目标状态/结局（如"天下第一剑客"）
}
```

> DB schema 无需升级（Dexie 允许动态添加字段，无 NOT NULL 约束）。

#### 新增 Prompt Seed

```
moduleKey: 'outline.character-driven'
system: 你是故事架构师，擅长根据角色的成长弧线（从初始状态到目标状态）设计情节...
user:
  核心角色及其弧线：
  {{characterArcs}}
  世界观：{{worldContext}}
  故事核心：{{storyCore}}
  请设计让每个角色从初始状态走向目标状态的故事大纲（JSON 格式）...
输出: 与 outline.volume 相同格式的 JSON 数组
```

#### UI 设计

在 OutlinePanel 操作栏新增模式切换：
- 「故事驱动」（现有）| 「角色驱动」（新增）
- 选「角色驱动」后，检查是否有角色设置了 initialState + goalState
- 如果没有，提示「请先在角色面板设置初始状态和目标状态」
- 如果有，一键生成

CharacterPanel 中每个角色卡片新增两个字段：
- 「初始状态」文本框
- 「目标状态/结局」文本框

#### 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/lib/types/character.ts` | 新增 `initialState?`, `goalState?` |
| `src/lib/ai/prompt-seeds.ts` | 新增 `outline.character-driven` seed |
| `src/lib/ai/adapters/outline-adapter.ts` | 新增 `buildCharacterDrivenOutlinePrompt()` |
| `src/components/character/CharacterPanel.tsx` | 角色编辑区增加两个字段 |
| `src/components/outline/OutlinePanel.tsx` | 操作栏增加模式切换 + 新按钮 |

---

### 2.3 灵感反推入口（Phase 26.4）

**目标**：用户写几句碎片灵感，AI 反向生成世界观草稿、故事核心、初始角色卡。

#### 新增 Prompt Seed

```
moduleKey: 'project.reverse-generate'
system: 你是创意孵化专家。用户给你一段碎片化的灵感/想法，你需要反推出完整的小说基础框架...
user:
  小说类型：{{genres}}
  用户灵感碎片：
  {{inspiration}}
  
  请反推生成以下结构化内容（JSON）：
  {
    "worldview": { "summary": "200字世界观", "geography": "...", "rules": "..." },
    "storyCore": { "theme": "...", "centralConflict": "...", "plotPattern": "..." },
    "characters": [{ "name": "...", "role": "...", "shortDescription": "...", "initialState": "...", "goalState": "..." }]
  }
```

#### UI 设计

**入口位置**：项目概况面板（ProjectInfoPanel）顶部，新增一个折叠区：

```
📝 灵感反推
┌──────────────────────────────────┐
│ 写下你的灵感/想法...             │
│ （一句话、一个场景、一个角色都行）│
│                                   │
│                                   │
└──────────────────────────────────┘
[✨ AI 反推] 

→ AI 输出后显示预览卡片：
  ┌─ 世界观草稿 ────────┐  ┌─ 故事核心 ──────┐
  │ ...                   │  │ ...              │
  │ [导入到世界观]        │  │ [导入到故事设计] │
  └──────────────────────┘  └─────────────────┘
  ┌─ 推荐角色 ──────────────────────────────┐
  │ 角色1（主角）... │ 角色2（反派）... │    │
  │ [全部导入到角色面板]                     │
  └─────────────────────────────────────────┘
```

**导入逻辑**：
- 世界观：写入 `worldviews` 表对应字段（merge 模式，不覆盖已有内容）
- 故事核心：写入 `storyCores` 表
- 角色：逐个 `characters.add()`

#### 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/lib/ai/prompt-seeds.ts` | 新增 `project.reverse-generate` seed |
| `src/lib/ai/adapters/reverse-generate-adapter.ts` | 新增 adapter（构建 prompt + 解析输出） |
| `src/components/project/ProjectInfoPanel.tsx` | 新增灵感反推折叠区 + AI 调用 + 预览卡片 |
| `src/lib/types/prompt.ts` | `PromptModuleKey` 增加 |

---

### 2.4 分析结果去重合并（Phase 28.1）

**目标**：解决导入分块分析后角色重复、技法碎片化、世界观杂糅的问题。

#### 设计方案：后处理管道

分块分析完成后，自动运行一轮**本地后处理**（不需要额外 AI 调用）：

```
chunk 级分析结果 → 后处理管道 → 去重合并后的结构化结果
```

#### 1) 角色去重合并

```typescript
// src/lib/reference-analysis/post-process.ts

interface MergedCharacter {
  canonicalName: string
  role: string
  appearances: { chunkIndex: number; content: string }[]  // 每次出现的来源
  mergedDescription: string  // 拼接去重后的描述
  mergedPersonality: string
  mergedBackground: string
  // ...
}

function mergeCharacters(chunks: ChunkAnalysis[]): MergedCharacter[] {
  // 1. 收集所有角色，按名字分组
  const byName = new Map<string, RawCharacter[]>()
  // 2. 相似名字合并（已有 import.merge-characters AI seed 可复用）
  // 3. 每组取信息最完整的作为主体，补充其他 chunk 的增量信息
  // 4. 记录每条信息的来源 chunkIndex
}
```

#### 2) 世界观分区

```typescript
interface MergedWorldview {
  geography: { content: string; sources: number[] }[]
  factions: { content: string; sources: number[] }[]
  rules: { content: string; sources: number[] }[]
  culture: { content: string; sources: number[] }[]
  // ...每个子分区独立
}

function mergeWorldview(chunks: ChunkAnalysis[]): MergedWorldview {
  // 按 worldview 子字段分组
  // 去除高度相似的句子（本地 Jaccard 相似度 > 0.7 视为重复）
  // 保留每条内容的来源 chunk 索引
}
```

#### 3) 写作技法出处标注

```typescript
interface TaggedTechnique {
  dimension: string  // 如 'narrativeStyle', 'proseStyle'
  content: string
  sourceChunks: number[]  // 来自哪些 chunk
  chapterRange: string    // "第 1-5 章" （从 chunk 的章节信息推算）
}
```

#### 存储方案

后处理结果存到现有 `references` 表的新字段：

```typescript
// references 表新增
interface Reference {
  // ... 现有字段
  mergedAnalysis?: {
    characters: MergedCharacter[]
    worldview: MergedWorldview
    techniques: TaggedTechnique[]
    outline: GroupedOutline[]  // 按卷分组
  }
}
```

#### 新增文件

| 文件 | 说明 |
|------|------|
| `src/lib/reference-analysis/post-process.ts` | 后处理管道主函数 |
| `src/lib/reference-analysis/text-similarity.ts` | 本地文本相似度计算（Jaccard + 编辑距离） |

#### 改动文件

| 文件 | 改动 |
|------|------|
| `src/lib/reference-analysis/pipeline.ts` | 分析完成后自动调用后处理 |
| `src/components/references/ReferenceDetailPanel.tsx` | 展示合并后的结果（见 28.2） |

---

### 2.5 分析结果结构化展示（Phase 28.2）

**目标**：为分析结果页添加侧边目录导航、按维度/角色/卷分组展示。

#### UI 重构方案

当前 `ReferenceDetailPanel` 是平铺展示。改为双栏布局：

```
┌──────────┬───────────────────────────────────┐
│ 📑 目录   │  内容区                            │
│          │                                    │
│ ▶ 全书总结 │  （点击左侧目录项切换内容）        │
│ ▼ 角色分析 │                                    │
│   · 张三   │  ┌─ 张三（主角）─────────────────┐ │
│   · 李四   │  │ 简介：...                      │ │
│   · 王五   │  │ 性格：... [第1-3章]            │ │
│ ▶ 世界观  │  │ 弧光：... [第5-12章]           │ │
│   · 地理   │  └─────────────────────────────── │ │
│   · 势力   │                                    │
│   · 规则   │                                    │
│ ▶ 大纲    │                                    │
│   · 第一卷 │                                    │
│   · 第二卷 │                                    │
│ ▶ 写作技法 │                                    │
│ ▶ 文笔风格 │                                    │
└──────────┴───────────────────────────────────┘
```

#### 实现要点

1. **侧边目录**：从 `mergedAnalysis` 动态生成，每个维度一个折叠组
2. **角色卡片**：每个角色一张卡片，信息来源标注 `[第X-Y章]`
3. **大纲分卷**：识别卷标题自动分组，每卷可折叠
4. **锚点跳转**：点击目录项 `scrollIntoView({ behavior: 'smooth' })`

#### 改动文件

| 文件 | 改动 |
|------|------|
| `src/components/references/ReferenceDetailPanel.tsx` | 重构为双栏 + 目录导航 |
| `src/components/references/MergedCharacterCard.tsx` | 新增：合并后角色卡片 |
| `src/components/references/MergedWorldviewSection.tsx` | 新增：分区世界观展示 |
| `src/components/references/TechniqueTimeline.tsx` | 新增：写作技法带出处展示 |

---

### 2.6 全书总结环节（Phase 28.3）

**目标**：所有 chunk 分析完成后，AI 自动生成每个维度 200-500 字的精炼全书总结。

#### Prompt 设计

```
moduleKey: 'reference.summarize'
system: 你是文学评论家，将碎片化的分析结果合并为精炼的全书总结...
user:
  以下是分块分析结果（已去重合并）：
  
  【角色分析汇总】
  {{mergedCharacters}}
  
  【世界观分析汇总】  
  {{mergedWorldview}}
  
  【写作技法汇总】
  {{mergedTechniques}}
  
  请为每个维度生成 200-500 字的全书总结。
  输出 JSON：
  {
    "characterSummary": "...",
    "worldviewSummary": "...",
    "techniqueSummary": "...",
    "plotSummary": "...",
    "styleSummary": "..."
  }
```

#### 调用时机

- 自动：后处理管道完成后自动触发（可在设置中关闭）
- 手动：分析详情页顶部「生成全书总结」按钮

#### 存储

```typescript
reference.overallSummary?: {
  characterSummary: string
  worldviewSummary: string
  techniqueSummary: string
  plotSummary: string
  styleSummary: string
  generatedAt: number
}
```

---

### 2.7 导入分卷支持（Phase 28.4）

**目标**：导入长篇时自动识别卷结构，支持手动调整。

#### 自动识别策略

```typescript
// 在 import pipeline 的 chunk 合并阶段，扫描大纲节点
function autoDetectVolumes(outlineNodes: ParsedOutlineNode[]): VolumeGroup[] {
  // 策略1: 已有 type='volume' 的节点直接用
  // 策略2: 匹配 "第X卷" / "卷X" / "Volume X" 标题
  // 策略3: 按章节数自动分卷（每 15-25 章一卷）
  // 策略4: 按内容转折点分卷（检测情节跳跃）—— 可选的 AI 辅助
}
```

#### UI

导入完成后的预览页，大纲区域顶部新增「分卷视图」：
- 显示自动识别的卷划分
- 支持拖拽章节到不同卷
- 支持手动插入/删除卷分割线

---

### 2.8 导入去重增强（Phase 30.5）

**目标**：导入分析时减少重复数据。

#### 本地文本相似度

复用 28.1 的 `text-similarity.ts`：

```typescript
// Jaccard 相似度（以句子为单位）
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(splitSentences(a))
  const setB = new Set(splitSentences(b))
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  const union = new Set([...setA, ...setB])
  return intersection.size / union.size
}

// 对世界观字段去重
function deduplicateWorldview(existing: string, incoming: string): string {
  const existingSentences = splitSentences(existing)
  const incomingSentences = splitSentences(incoming)
  const newSentences = incomingSentences.filter(s => 
    !existingSentences.some(e => jaccardSimilarity(s, e) > 0.7)
  )
  return [...existingSentences, ...newSentences].join('')
}
```

#### 角色合并 UI

在项目参考面板中，角色列表支持：
1. 多选模式（checkbox）
2. 「合并选中角色」按钮
3. 合并面板：选择主名称 + 自动合并各字段（取最长/最详细的）+ 手动编辑确认

---

### 2.9 重要地点模块（Phase 25.3）

**目标**：创作区新增「重要地点」管理模块，支持多标签分类和树状层级。

#### 数据模型

```typescript
// src/lib/types/location.ts（新增）
interface Location {
  id?: number
  projectId: number
  name: string
  parentId?: number                // 父地点 ID（树状层级）
  naturalTags: string[]            // 自然地形标签（多选）
  humanTags: string[]              // 人文场所标签（多选）
  description: string              // 描述
  significance: string             // 对故事的意义
  relatedCharacterIds: number[]    // 关联角色
  relatedChapterIds: number[]      // 出现的章节
  mapCoordinates?: { x: number; y: number }  // 未来地图标注
  sortOrder: number
  createdAt: number
  updatedAt: number
}
```

#### DB Schema

```
locations: '++id, projectId, parentId, sortOrder'
```

#### 标签预设

```typescript
const NATURAL_TAGS = [
  '大陆', '半岛', '岛屿', '群岛', '高原', '平原', '盆地', '丘陵',
  '峡谷', '山脉', '山峰', '火山', '戈壁', '沙漠', '冰原', '草原',
  '森林', '雨林', '沼泽', '绿洲', '洞穴', '海洋', '海峡', '海湾',
  '湖泊', '河流', '瀑布', '温泉', '冰川', '浮空岛', '虚空', '异界裂隙',
]

const HUMAN_TAGS = [
  '村庄', '城镇', '城市', '都城', '部落', '营地', '关隘', '要塞',
  '军营', '战场', '神殿', '寺庙', '学院', '集市', '酒楼', '拍卖行',
  '黑市', '矿场', '港口', '驿站', '废墟', '遗迹', '古墓', '迷宫',
  '禁地', '秘境', '宗门', '洞府', '灵脉',
]
```

#### UI 设计

三种视图（Tab 切换）：

1. **树状图视图**：左侧树 + 右侧编辑区（类似世界地图的世界树）
2. **列表视图**：平铺卡片，按标签筛选
3. **地图视图**（远期）：关联世界地图标注

#### Sidebar 注册

在 `sidebar-tree.ts` 的创作区增加：
```typescript
leaf('locations', '重要地点', MapPin),
```

#### 新增文件

| 文件 | 说明 |
|------|------|
| `src/lib/types/location.ts` | 地点数据类型 |
| `src/stores/location.ts` | Zustand store |
| `src/components/location/LocationPanel.tsx` | 主面板（三种视图） |
| `src/components/location/LocationTreeView.tsx` | 树状图视图 |
| `src/components/location/LocationListView.tsx` | 列表视图 |
| `src/components/location/LocationEditor.tsx` | 单个地点编辑器 |
| `src/components/location/TagSelector.tsx` | 多标签选择器组件 |

---

### 2.10 creativeMode 联动题材包（Phase 31.3）

**目标**：切换创作模式时，自动提示是否联动切换题材包。

#### 实现方案

在 `ProjectInfoPanel` 或世界观面板中，creativeMode 切换按钮的 `onChange` 回调里：

```typescript
const handleCreativeModeChange = async (mode: CreativeMode) => {
  await updateProject(project.id!, { creativeMode: mode })
  
  if (mode === 'historical') {
    // 检查当前是否已激活历史题材包
    const activeGenrePacks = promptStore.getActiveGenrePacks()
    const hasHistorical = activeGenrePacks.some(p => p.moduleKey.includes('历史'))
    if (!hasHistorical) {
      const confirm = window.confirm('是否同时切换到「历史」题材包？\n（可在提示词库中随时切换回来）')
      if (confirm) {
        await promptStore.activateGenrePack('historical')
      }
    }
  } else if (mode === 'fantasy') {
    // 类似逻辑
  }
}
```

#### 改动文件

| 文件 | 改动 |
|------|------|
| `src/components/project/ProjectInfoPanel.tsx` | creativeMode 切换联动 |
| `src/stores/prompt.ts` | 新增 `activateGenrePack(genre)` / `getActiveGenrePacks()` |

---

### 2.11 多世界方案设计（Phase 25.4）— 仅设计文档

**目标**：设计支持「诸天流」「无限流」等多世界观题材的数据结构。

#### 核心问题

当前 `worldNodes` 是单棵世界树（一个 rootWorld），不支持：
- 诸天流：主角穿越多个独立世界，每个世界有独立世界观
- 无限流：多个副本世界，每个副本有独立规则
- 平行世界：同一世界的不同分支

#### 设计方向（三选一）

**方案 A：多根世界树**
- `worldNodes` 支持多个 `parentId=null` 的根节点
- 每个根节点代表一个独立世界
- 每个世界可关联独立的 worldview/storyCore/powerSystem

**方案 B：世界组**
- 新增 `worldGroups` 表：`{ id, projectId, name, order, worldviewId }`
- 每个 worldGroup 下挂一棵 worldNodes 子树
- 章节/大纲可指定所属 worldGroup

**方案 C：世界标签**
- 在现有 worldNodes 上增加 `worldTag: string`（如 "地球"、"仙界"、"副本#1"）
- 同一棵树上用 tag 区分不同世界
- 最轻量，但层级关系不够清晰

**建议**：方案 B（世界组），数据结构清晰、与现有系统兼容性好、扩展性强。

---

## 三、通用技术约定

### 文件命名规范
- Store：`src/stores/{module}.ts`
- 类型：`src/lib/types/{module}.ts`
- AI Adapter：`src/lib/ai/adapters/{module}-adapter.ts`
- 组件：`src/components/{module}/{ComponentName}.tsx`

### AI 调用约定
- 所有新 prompt 必须注册到 `prompt-seeds.ts`，用户可在提示词库中自定义
- 输出格式统一用 JSON（用 ```json 代码块包裹），解析时 JSON 优先 + 正则降级
- 长文本输入做 Token 预算控制（不超过模型上下文窗口的 40%）

### DB 变更
- 新增表不需要 schema version 升级（Dexie 自动处理）
- 新增字段到现有表也不需要升级（可选字段，旧数据 undefined 即可）
- 删除字段或重命名字段才需要 version 升级

### 测试验证
- 每个功能完成后：`npx tsc --noEmit` 零错误 + `npm run build` 成功
- 导出/导入 round-trip 不丢失数据
- 项目删除不留孤儿数据

---

## 四、风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 后处理管道性能（28.1）| 百万字小说有几百个 chunk，合并可能慢 | 用 Web Worker 离线计算，进度条展示 |
| AI 关系提取准确率（30.2）| 角色名对不上 characters 表 | 模糊匹配（Levenshtein 距离 ≤ 2）+ 手动确认 |
| 世界组方案（25.4）| 重构量大，影响现有世界地图 | 先出设计文档，确认方案后再动手 |
| 灵感反推的质量（26.4）| AI 生成的世界观/角色可能过于泛泛 | 提供多个示例模板 + 允许用户多次迭代 |
| 导入分卷的准确性（28.4）| 自动分卷可能不符合用户预期 | 始终提供手动调整 UI |
