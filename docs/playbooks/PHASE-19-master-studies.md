# PHASE 19 — 作品学习系统（Master Studies）

> 把 Phase 18 的分块导入流水线翻转使用：不是把别人小说抄进"我的项目"当世界观，
> 而是拆解白金作家作品 → 提炼创作方法论 → 沉淀为可复用的"学习库" →
> 创作时反哺 AI 调用的 prompt 上下文。
> **学习库与创作数据物理隔离**（独立新表），不污染现有 19 张表。

---

## § 1. 元信息

```yaml
phase: 19
title: 作品学习系统（Master Studies）
prerequisites: [PHASE-18 完成, Phase 18 方案 A 完成]
estimated_hours: 16-20
recommended_model: Sonnet 4.6 / Sonnet 4.7
status: in-progress  （2026-05-12 启动）
```

---

## § 2. 本 Phase 的目标（What）

### 做完之后系统会有什么

用户可以：
1. 上传白金作家作品（TXT/PDF/EPUB/DOCX），走"**作品学习**"独立入口
2. 系统按分析档次（快速 / 标准 / 深度）自动解析：
   - **Layer 1 五维分析** — 每块 AI 提炼：世界观范式 / 角色设计手法 / 情节节奏规律 / 伏笔与悬念 / 文笔与语言
   - **Layer 2 结构量化** — 章节节奏时间线（开场/冲突/反转/爽点/钩子坐标）+ 文体特征（句长分布、对话占比、高频词）
   - **Layer 3 跨作品归纳** — 多本同流派作品的共性手法洞察卡片
3. 查看作品级分析报告（Tabs：分析报告 / 节奏时间线 / 风格画像）
4. 在自己项目创作时，点「📚 引用手法」抽屉，把某位大师的洞察塞进当前 AI prompt
5. **下载完整分析档案**（整本作品的五维 + 节奏 + 风格 + 跨作品洞察，打包 ZIP：`<作品名>.analysis.json` + 可读 Markdown 报告）

### 不在本 Phase 范围
- 作品文本版权内容的二次分发（只保留本地，禁止云端同步）
- 社区共享洞察（需后端，延期）
- 自动抓取网文站作品（用户必须自行上传）

### 法律声明（强制）
功能入口首屏显示 **Modal 法律声明**（用户必须点「我已阅读并同意」才能进入）：
> 本功能仅供个人学习、研究使用。上传的作品仅保存在您本地浏览器 IndexedDB，不会上传服务器或与他人共享。分析结果的二次传播可能涉及著作权风险，请自行评估合规性。继续使用即视为您已知悉并承担相应责任。

---

## § 3. 改动清单

### 整体分 4 个里程碑

| 里程碑 | commit message | 工时 |
|---|---|---|
| **P19-a 地基层** | `feat(storyforge): Phase 19a - 作品学习地基层` | 3-4h |
| **P19-b 单作品分析（Layer 1）** | `feat(storyforge): Phase 19b - 单作品五维分析` | 5-6h |
| **P19-c 结构量化（Layer 2）** | `feat(storyforge): Phase 19c - 章节节奏与风格量化` | 4-5h |
| **P19-d 跨作品归纳 + 反哺（Layer 3）** | `feat(storyforge): Phase 19d - 跨作品归纳+创作反哺` | 4-5h |

### 新增文件（全部阶段汇总）

```
src/lib/types/master-study.ts                      ← P19-a
src/components/master-studies/
  MasterStudiesPanel.tsx                           ← P19-a（列表 + 法律声明 Modal）
  MasterWorkDetail.tsx                             ← P19-b（作品详情 Tabs）
  MasterAnalysisReport.tsx                         ← P19-b（五维报告）
  MasterBeatsTimeline.tsx                          ← P19-c（章节节奏时间线 SVG）
  MasterStyleChart.tsx                             ← P19-c（风格画像雷达图）
  MasterInsightsPanel.tsx                          ← P19-d（跨作品洞察卡片）
  MasterInsightPicker.tsx                          ← P19-d（创作面板引用抽屉）
  MasterLegalConsentModal.tsx                      ← P19-a（法律声明弹窗）
  MasterAddWorkModal.tsx                           ← P19-b（添加作品弹窗）
src/stores/master-study.ts                         ← P19-a（CRUD store）
src/lib/master-study/
  pipeline.ts                                      ← P19-b（复用 Phase 18 pipeline 骨架）
  style-metrics.ts                                 ← P19-c（JS 统计句长/对话率/高频词）
  export-archive.ts                                ← P19-b（打包分析档案 ZIP）
```

### 修改

```
src/lib/types/index.ts                             ← P19-a 导出 master-study
src/lib/db/schema.ts                               ← P19-a Dexie v11 新增 5 张表
src/components/layout/sidebar-tree.ts              ← P19-a 加一级菜单「📚 作品学习」
src/pages/WorkspacePage.tsx                        ← P19-a 挂载 MasterStudiesPanel
src/lib/ai/prompt-seeds.ts                         ← P19-b/c/d 新增 4 条 seed
src/lib/types/prompt.ts                            ← P19-b/c/d 扩展 PromptModuleKey
src/components/editor/ChapterEditor.tsx            ← P19-d 加「引用手法」按钮
PROGRESS.md / docs/HANDOFF.md                      ← 每个里程碑同步更新
```

---

## § 4. 任务步骤（P19-a 地基层 · 本次里程碑）

### 4.1 新建 `src/lib/types/master-study.ts`

完整内容见 § 5。

### 4.2 更新 `src/lib/types/index.ts`

在末尾加：
```ts
export * from './master-study'
```

### 4.3 更新 `src/lib/db/schema.ts`

加 import + 5 个 Table 声明 + v11 `stores()`。详见 § 5。

### 4.4 新建 `src/stores/master-study.ts`

Zustand + Dexie 薄封装，提供：
- `listWorks(projectId?)` — 列出所有作品（projectId 可选，null = 全局学习库）
- `createWork(input)` → id
- `patchWork(id, partial)`
- `deleteWork(id)`（级联清 chunkAnalysis / chapterBeats / styleMetrics + Blob）
- `loadWork(id)`
- `listInsights(genre?)`
- `saveInsight(input)` / `deleteInsight(id)`

### 4.5 新建 `src/components/master-studies/MasterStudiesPanel.tsx`

首屏：
- 如果 `localStorage['sf-master-consent'] !== 'agreed'`，弹 `MasterLegalConsentModal`
- 同意后显示：
  - 顶部「📚 作品学习库」标题 + 说明（3 行）
  - 右上「+ 添加作品」按钮（P19-a 里点了弹 "Coming in P19-b" 提示，避免半拉子）
  - 作品列表（P19-a 为空态占位："还没有学习过的作品，点右上添加"）
  - 侧栏 Tabs：「作品列表 / 手法洞察 / 学习设置」（后两个 P19-a 里显示占位）

### 4.6 新建 `src/components/master-studies/MasterLegalConsentModal.tsx`

标准 modal：标题「📜 使用须知」+ 声明全文 + 「不同意返回」「我已阅读并同意」两按钮。

### 4.7 sidebar-tree.ts 加入口

`SidebarModule` union 加 `'master-studies'`；在「设定库」和「创作区」之间插一级：

```ts
{
  sectionId: 'learn',
  label: '作品学习',
  icon: GraduationCap,
  rootLeaf: leaf('master-studies', '作品学习', GraduationCap),
}
```

### 4.8 WorkspacePage.tsx 路由

import + switch case `'master-studies'` → `<MasterStudiesPanel project={project} />`

### 4.9 验证

```bash
cd storyforge
npx tsc --noEmit    # 必须 0 error
npm run build       # 必须 0 error，output 含 "built in"
npm run dev         # 打开浏览器，点新侧边栏「作品学习」→ 弹法律声明 → 同意 → 进入空页面
```

---

## § 5. 数据模型变更（P19-a）

### 新增 5 张表 — Dexie v11

```ts
// src/lib/types/master-study.ts

export type MasterAnalysisDepth = 'quick' | 'standard' | 'deep'
export type MasterWorkStatus =
  | 'pending' | 'analyzing' | 'done' | 'failed'

/** 作品元数据（每本小说一行） */
export interface MasterWork {
  id?: number
  /** 可选：绑定到某个项目（null = 全局学习库） */
  projectId?: number | null
  title: string
  author?: string
  genre?: string
  totalChars: number
  analysisDepth: MasterAnalysisDepth
  status: MasterWorkStatus
  /** 关联的 ImportSession id（复用 Phase 18 pipeline） */
  importSessionId?: number
  /** 关联的 ImportFileBlob（原文本） */
  fileHash?: string
  /** 完成度百分比 */
  progress: number
  createdAt: number
  updatedAt: number
}

/** 单块的五维分析（Layer 1 产出） */
export interface MasterChunkAnalysis {
  id?: number
  workId: number
  chunkIndex: number
  /** 本块原文 label（如"第 X 章"） */
  label?: string
  worldviewPattern?: string   // 世界观范式
  characterDesign?: string    // 角色设计手法
  plotRhythm?: string         // 情节节奏规律
  foreshadowing?: string      // 伏笔与悬念
  proseStyle?: string         // 文笔与语言
  rawExcerpt?: string         // 本块引用片段（~200 字）
  createdAt: number
}

/** 章节节奏点（Layer 2 产出，一章可有多条） */
export type BeatType = 'opening' | 'conflict' | 'reversal' | 'climax' | 'hook' | 'foreshadow' | 'relief'
export interface MasterChapterBeat {
  id?: number
  workId: number
  chapterIndex: number        // 0-based
  chapterLabel?: string
  /** 本节奏点在章节中的相对位置（0-100%） */
  position: number
  type: BeatType
  excerpt: string             // 引用原文片段（<100 字）
  note?: string               // AI 点评
}

/** 文体特征（Layer 2 产出，每本一行） */
export interface MasterStyleMetrics {
  id?: number
  workId: number
  /** 平均句长 + 直方图桶（5/10/15/20/30+） */
  avgSentenceLength: number
  sentenceLengthHistogram: Record<string, number>
  /** 对话占比（0-1） */
  dialogRatio: number
  /** 高频词 top 50（去停用词） */
  topWords: { word: string; count: number }[]
  /** 段落密度（每千字段数） */
  paragraphDensity: number
  /** 自述性描写 vs 动作描写占比（AI 估计） */
  descriptionRatio?: number
  computedAt: number
}

/** 跨作品归纳洞察（Layer 3 产出） */
export interface MasterInsight {
  id?: number
  title: string               // 例："猫腻式插叙节奏法则"
  genre?: string              // 适用流派
  description: string         // 长说明（Markdown）
  bulletPoints: string[]      // 3-5 条可操作要点
  sourceWorkIds: number[]     // 参考了哪些作品
  createdAt: number
  updatedAt: number
}
```

```ts
// src/lib/db/schema.ts  新增
masterWorks!: Table<MasterWork, number>
masterChunkAnalysis!: Table<MasterChunkAnalysis, number>
masterChapterBeats!: Table<MasterChapterBeat, number>
masterStyleMetrics!: Table<MasterStyleMetrics, number>
masterInsights!: Table<MasterInsight, number>

// v11
this.version(11).stores({
  masterWorks: '++id, projectId, genre, status, updatedAt',
  masterChunkAnalysis: '++id, workId, chunkIndex',
  masterChapterBeats: '++id, workId, chapterIndex, type',
  masterStyleMetrics: '++id, workId',
  masterInsights: '++id, genre, updatedAt',
})
```

---

## § 6. 验收标准（P19-a DoD）

- [ ] `npx tsc --noEmit` 输出 0 error
- [ ] `npm run build` 输出 "built in" 且无 error
- [ ] 浏览器 console 启动时无红色错误
- [ ] 侧边栏出现「📚 作品学习」一级菜单
- [ ] 点击菜单首次弹出法律声明 Modal
- [ ] 同意后进入作品列表页（空态）
- [ ] 刷新后 consent 状态记忆，不再弹 modal
- [ ] Dexie v11 `masterWorks` / `masterChunkAnalysis` / `masterChapterBeats` / `masterStyleMetrics` / `masterInsights` 5 张表已创建
- [ ] 原有 Phase 18 导入流水线仍正常工作（回归）

---

## § 7. 全功能巡检（每里程碑末）

1. [ ] 主项目正常打开（`/workspace/:id`）
2. [ ] 世界观 AI 生成（链 1）正常
3. [ ] 角色 AI 设计（链 2）正常
4. [ ] 大纲 AI 生成（链 3）正常
5. [ ] 正文 AI 写作（链 5）正常
6. [ ] Phase 18 导入流水线端到端可跑（回归）
7. [ ] Phase 19 新增菜单点击可进入，页面不崩
8. [ ] 刷新浏览器后主题、consent、项目数据都保留

---

## § 8. 故障排查

| 症状 | 原因 | 应对 |
|------|------|------|
| Dexie 升 v11 后 "Schema diff" 报错 | 之前手动改过 IndexedDB | 打开 DevTools → Application → IndexedDB → 删除 storyforge 重来 |
| consent modal 每次都弹 | localStorage 写失败 | 检查浏览器是否禁用存储 |
| 侧边栏图标为空白 | lucide icon 名错 | GraduationCap 存在于 lucide-react v0.400+ |

---

## § 9. 提交规范

每里程碑完成后：
```bash
cd my-website
git add storyforge
git commit -m "feat(storyforge): Phase 19<letter> - <summary>"
git push origin main
```
