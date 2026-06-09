# StoryForge 功能演进计划

> 制定日期：2026-05-21

---

## 总览：8 个 Phase，34 个功能点

| Phase | 主题 | 核心解决的问题 | 预估工作量 |
|-------|------|---------------|-----------|
| Phase A | 记忆闭环系统 | AI 写长篇记忆崩溃 | ⭐⭐⭐⭐ |
| Phase B | 全局故事线 + 情节脉络 | 缺少全书级剧情锚点 | ⭐⭐⭐ |
| Phase C | 伏笔系统升级 | 伏笔不自动参与写作 | ⭐⭐⭐ |
| Phase D | 大纲流程强化 | 批量生成 + 完善大纲 | ⭐⭐⭐ |
| Phase E | 题材模板 + 风格系统 | 题材覆盖太少 | ⭐⭐⭐ |
| Phase F | 质量控制三件套 | 缺少审校/查漏/评分 | ⭐⭐⭐ |
| Phase G | 角色 + 设定管理增强 | 角色状态静态，设定管理弱 | ⭐⭐⭐ |
| Phase H | 导出 + 体验优化 | 导出格式少，版本对比弱 | ⭐⭐ |

---

## Phase A：记忆闭环系统

**目标**：解决 AI 写到后面"忘了前面写了什么"的核心问题。

### A1. 写后自动状态提取

**现状**：已有 `state-extract-adapter.ts` + `StatePanel` + `StateCard` store，但需要用户手动点"提取状态"按钮。

**要做的事**：
1. 在 `ChapterEditor.tsx` 的"生成正文"完成回调中，自动触发一次状态提取 AI 调用
2. 提取完成后弹出 `StateDiffModal`（已有），展示本章的状态变更列表
3. 用户点"确认入库" → 调用 `useStateCardStore.applyDiffs()` 批量更新状态卡
4. 用户也可逐条修改/删除后再入库
5. 加一个"跳过本次"按钮，不强制

**涉及文件**：
- `src/components/editor/ChapterEditor.tsx` — 生成完成后加自动提取逻辑
- `src/components/state/StateDiffModal.tsx` — 已有，可能需要增加"跳过"按钮
- `src/stores/state-card.ts` — `applyDiffs` 已有，确认够用

**关键设计**：
- 提取时传入：当前状态表全文（`buildStateContext()`）+ 本章正文 + 章节标题
- 提取结果是 `StateDiffItem[]`：entityName / category / field / oldValue / newValue
- 新实体（新角色、新地点）的 oldValue 为 null，需要自动创建新状态卡

---

### A2. 三层记忆构建器

**现状**：`context-builder.ts` 有基础的世界观/角色上下文构建，但没有分层记忆概念。

**要做的事**：
1. 新建 `src/lib/ai/memory-builder.ts`
2. 实现三层记忆构建：

```
Working Memory（工作记忆）：
  - 当前章节大纲/细纲
  - 最近 3 章的摘要（从 chapters 表取 summary 或正文截尾 500 字）
  - 当前章节的情感节拍卡（如有）

Episodic Memory（情景记忆）：
  - 最近 5 章的状态变更记录（从 stateCards 的 lastChapterId 近似）
  - 最近发生的关键事件（从状态卡 category='event' 取）
  - 人物关系最近变动

Semantic Memory（语义记忆）：
  - 世界观摘要（已有 buildWorldContext）
  - 力量体系（已有）
  - 全局故事线（Phase B 新增）
  - 角色档案（已有 buildCharacterContext）
  - 开放伏笔列表（Phase C 接入）
```

3. 按任务类型分配 token 预算：
   - `write`：Working 权重高（让 AI 紧贴当前剧情）
   - `plan`：Semantic 权重高（让 AI 把握全局）
   - `review`：Episodic 权重高（让 AI 关注一致性）

4. 每层有字符上限，超出则按优先级截断

**涉及文件**：
- 新建 `src/lib/ai/memory-builder.ts`
- 修改 `src/lib/ai/adapters/chapter-adapter.ts` — 用 memoryBuilder 替代现有简单拼接
- 修改 `src/lib/ai/adapters/outline-adapter.ts` — 同上

---

### A3. 章节摘要自动生成

**现状**：`chapters` 表没有 summary 字段，无法给后续章节提供"前情提要"。

**要做的事**：
1. `chapters` 表增加 `summary: string` 字段（DB migration）
2. 正文生成完成后（或用户确认状态入库时），自动调 AI 生成本章摘要（100-200 字）
3. 摘要存入 chapters 表
4. 新建 `src/lib/ai/adapters/summary-adapter.ts`：输入章节正文 → 输出精炼摘要
5. UI 上在章节列表显示摘要预览（hover 或展开）

**涉及文件**：
- `src/lib/db/schema.ts` — chapters 表加 summary 字段
- 新建 `src/lib/ai/adapters/summary-adapter.ts`
- `src/stores/chapter.ts` — 加 updateSummary 方法
- `src/components/editor/ChapterEditor.tsx` — 生成完成后自动调摘要
- `src/components/editor/ChaptersListPanel.tsx` — 显示摘要

---

### A4. 已发生事件时间线

**现状**：状态卡有 category='event'，但没有专门的时间线视图。

**要做的事**：
1. 新建 `src/components/state/EventTimeline.tsx` — 按章节顺序展示所有重大事件
2. 事件来源：状态卡中 category='event' 的条目，按 lastChapterId 排序
3. 每个事件显示：事件名 / 发生章节 / 涉及角色 / 影响
4. 支持手动补充遗漏事件（按钮"补充记忆"）
5. 写作时可选择"注入事件时间线"到 prompt（记忆召回）

**涉及文件**：
- 新建 `src/components/state/EventTimeline.tsx`
- `src/stores/state-card.ts` — 加 `getEventsByChapter()` 方法
- `src/components/layout/sidebar-tree.ts` — 侧栏加入"事件线"入口

---

## Phase B：全局故事线 + 情节脉络

**目标**：给全书一条从开篇到结局的主线剧情锚点，作为 AI 写作的第一重记忆防线。

### B1. 故事线数据模型

**要做的事**：
1. 新建类型 `StoryArc`：

```typescript
interface StoryArc {
  id?: number
  projectId: number
  name: string           // "主线" / "感情线" / "复仇线"
  type: 'main' | 'sub'   // 主线 / 支线
  stages: StoryStage[]   // JSON 存储
  createdAt: number
  updatedAt: number
}

interface StoryStage {
  title: string          // "起：初入江湖"
  description: string    // 这个阶段发生什么
  startVolume?: number   // 对应卷
  endVolume?: number
  keyEvents: string[]    // 关键事件
  turningPoint?: string  // 转折点
}
```

2. DB migration：新增 `storyArcs` 表
3. 新建 `src/stores/story-arc.ts`

**涉及文件**：
- 新建 `src/lib/types/story-arc.ts`
- `src/lib/db/schema.ts` — 加 storyArcs 表
- 新建 `src/stores/story-arc.ts`

---

### B2. 故事线 UI 面板

**要做的事**：
1. 新建 `src/components/outline/StoryArcPanel.tsx`
2. 上半部分：故事线编辑器（阶段列表，可拖拽排序）
3. 下半部分：时间线可视化（横向进度条，标注各阶段和转折点）
4. 支持多条故事线（主线 + 多条支线），用 Tab 切换
5. "AI 生成故事线"按钮：根据已有世界观 + 故事核心 + 大纲 → AI 规划全局故事线
6. 侧栏"大纲"组下面加入"故事线"入口

**涉及文件**：
- 新建 `src/components/outline/StoryArcPanel.tsx`
- 新建 `src/lib/ai/adapters/story-arc-adapter.ts`
- `src/components/layout/sidebar-tree.ts` — 加入口

---

### B3. 故事线注入写作上下文

**要做的事**：
1. `memory-builder.ts`（Phase A2）的 Semantic Memory 层加入故事线
2. 写正文时：取当前章节所在的故事阶段 + 前后阶段摘要 → 注入 system prompt
3. 这样即使写到第 500 章，AI 也知道"当前处于故事的哪个阶段、接下来要往哪走"

**涉及文件**：
- `src/lib/ai/memory-builder.ts` — Semantic 层加故事线
- `src/lib/ai/adapters/chapter-adapter.ts` — 确认注入

---

## Phase C：伏笔系统升级

**目标**：让伏笔从"被动记录"变成"主动参与写作"。

### C1. 伏笔逾期检测

**现状**：伏笔有 plantChapterId / resolveChapterId，但没有逾期概念。

**要做的事**：
1. `Foreshadow` 类型增加字段：
   - `expectedResolveChapterId: number | null` — 预期回收章节
   - `importance: number` — 重要度 (1-10)
   - `urgency: 'low' | 'medium' | 'high' | 'critical'` — 自动计算
2. `useForeshadowStore` 新增方法：
   - `getOverdue(currentChapterId)` — 返回已超过预期回收章节但仍未回收的伏笔
   - `getUpcoming(currentChapterId, range=5)` — 返回即将需要回收的伏笔
   - `computeUrgency(foreshadow, currentChapterId)` — 计算紧急度
3. `ForeshadowKanban.tsx` 加逾期标红 + 紧急度徽章

**涉及文件**：
- `src/lib/types/foreshadow.ts` — 加字段
- `src/lib/db/schema.ts` — migration
- `src/stores/foreshadow.ts` — 加方法
- `src/components/foreshadow/ForeshadowKanban.tsx` — 加逾期UI

---

### C2. 伏笔自动注入写作 Prompt

**现状**：写正文时完全不知道有哪些伏笔需要处理。

**要做的事**：
1. `memory-builder.ts` 的 Working Memory 层加入：
   - 当前章节关联的伏笔（plantChapterId 或 echoChapterIds 包含当前章节）
   - 全局逾期伏笔（urgency >= high）
   - 即将需要回收的伏笔
2. 注入格式：
```
【当前章节伏笔任务】
- [埋设] "血玉令牌"（契诃夫之枪）：在本章通过自然场景让主角注意到这个令牌
- [回收] "老者的预言"（预言暗示，逾期！）：应在本章揭示预言的含义
- [呼应] "消失的村庄"（环境伏笔）：侧面提及相关线索
```

**涉及文件**：
- `src/lib/ai/memory-builder.ts` — 加伏笔注入
- `src/stores/foreshadow.ts` — 加 `buildForeshadowContext(chapterId)` 方法

---

### C3. AI 自动生成伏笔建议

**要做的事**：
1. 新建 `src/lib/ai/adapters/foreshadow-suggest-adapter.ts`
2. 输入：故事线 + 已有伏笔列表 + 当前大纲 → AI 建议新的伏笔点
3. UI：伏笔面板加"AI 建议伏笔"按钮，生成后用户选择接受/拒绝
4. 完善大纲时（Phase D）也自动调用此功能

**涉及文件**：
- 新建 `src/lib/ai/adapters/foreshadow-suggest-adapter.ts`
- `src/components/foreshadow/ForeshadowPanel.tsx` — 加按钮

---

## Phase D：大纲流程强化

**目标**：支持批量生成 + "完善大纲"中间步骤。

### D1. 批量生成大纲

**现状**：只能逐章生成大纲。

**要做的事**：
1. `OutlinePanel.tsx` 加"批量生成"按钮
2. 选择范围：全书 / 指定卷 / 指定章节区间
3. 实现循环生成逻辑：
   - 每生成一章，把该章摘要加入上下文传给下一章
   - 保持故事线连贯
   - 显示进度条（第 X/N 章）
   - 支持中途取消
4. 生成速度提示：预估时间 = 章节数 × 单章平均耗时

**涉及文件**：
- `src/components/outline/OutlinePanel.tsx` — 加批量生成 UI
- 新建 `src/lib/ai/batch-outline-runner.ts` — 批量生成逻辑（循环 + 上下文传递 + 进度回调）
- `src/lib/ai/adapters/outline-adapter.ts` — 确保支持传入前序章节摘要

---

### D2. 完善大纲（大纲 → 细纲升级）

**现状**：已有 `DetailedOutlinePanel`，但内容较简单。

**要做的事**：
1. 扩展 `DetailedOutline` 类型，增加字段：
   - `openingHook: string` — 开头衔接（从上一章结尾自然过渡）
   - `endingCliffhanger: string` — 结尾悬念
   - `sceneLocation: string` — 本章主要场景地点
   - `appearingCharacterIds: number[]` — 出场角色 ID 列表
   - `appearingItemIds: number[]` — 出现物品 ID 列表
   - `foreshadowIds: number[]` — 关联伏笔 ID 列表
   - `emotionArc: string` — 情绪走向（升/降/平/波动）
2. "完善大纲" AI 适配器升级：
   - 输入：章节大纲 + 前后章摘要 + 世界观 + 角色列表 + 伏笔列表 + 物品列表 + 地图
   - 输出：上述全部字段
3. 支持批量完善（复用 D1 的循环逻辑）
4. UI：DetailedOutlinePanel 展示更丰富的信息，可点击跳转到对应角色/伏笔/物品

**涉及文件**：
- `src/lib/types/` — 扩展 DetailedOutline 类型
- `src/lib/db/schema.ts` — migration
- `src/stores/detailed-outline.ts` — 适配新字段
- `src/lib/ai/adapters/detail-scene-adapter.ts` — 升级 prompt
- `src/components/outline/DetailedOutlinePanel.tsx` — 展示新字段

---

### D3. 大纲预览面板

**要做的事**：
1. 新建 `src/components/outline/OutlinePreview.tsx`
2. 一个章节的完整信息聚合视图：
   - 章节标题 + 摘要
   - 故事线（本章在全局故事线中的位置）
   - 开头衔接 + 结尾悬念
   - 出场角色列表（带状态卡预览）
   - 相关伏笔（埋设/呼应/回收）
   - 场景地图
   - 情绪走向
   - 出现物品
3. 在编辑器页面可展开此面板，写作时参考

**涉及文件**：
- 新建 `src/components/outline/OutlinePreview.tsx`
- `src/components/editor/ChapterEditor.tsx` — 加入口

---

## Phase E：题材模板 + 风格系统

**目标**：题材覆盖从 4 个扩充到 20+，加入风格模仿能力。

### E1. 题材模板库扩充

**现状**：`prompt-seeds-genre-packs.ts` 只有 4 个题材包（仙侠/言情/现实/悬疑）。

**要做的事**：
1. 扩充到至少 20 个题材包，每个包含 5 套 prompt（chapter.content / outline.volume / character.generate / story.generate / worldview.dimension）
2. 新增题材清单：
   - 玄幻、武侠、都市、历史、科幻、末世
   - 穿越、重生、系统流、无限流、游戏
   - 修仙（已有）、言情（已有）、悬疑（已有）、现实（已有）
   - 赛博朋克、克苏鲁、种田、争霸、西幻、奇幻
3. 每个题材包额外加：
   - `antiPatterns: string[]` — 反模式清单（AI 应避免的套路）
   - `pacingStrategy: string` — 节奏策略
   - `typicalStructure: { title: string, description: string }[]` — 典型结构

**涉及文件**：
- `src/lib/ai/prompt-seeds-genre-packs.ts` — 大规模扩充
- 新建 `src/lib/ai/genre-metadata.ts` — 存放每个题材的元数据（反模式、节奏、结构）
- `src/components/project/` — 创建项目时的题材选择 UI 优化

---

### E2. 风格模板系统

**要做的事**：
1. 新建 `src/lib/ai/writing-styles.ts`，定义风格预设：

```typescript
interface WritingStyle {
  id: string
  name: string           // "金庸武侠" / "张爱玲细腻" / "硬核科幻"
  author?: string        // 风格来源
  description: string
  promptInjection: string // 直接注入 system prompt 的风格指令
  vocabulary: string[]   // 偏好词汇示例
  avoidPatterns: string[] // 避免的表达
  dialogueStyle: string  // 对话风格描述
  narrativeDistance: string // 叙事距离
}
```

2. 内置 10-15 个风格预设（金庸/古龙/张爱玲/鲁迅/网文爽文/文学/轻小说/硬科幻/黑色幽默/古典诗意/现代极简/暗黑哥特等）
3. 项目设置里选择风格 → 写正文时自动注入 promptInjection
4. 支持用户自定义风格

**涉及文件**：
- 新建 `src/lib/ai/writing-styles.ts`
- `src/stores/project.ts` — 项目加 writingStyleId 字段
- `src/lib/ai/adapters/chapter-adapter.ts` — 注入风格指令
- `src/components/settings/` — 风格选择 UI

---

### E3. 创作方法论引导

**要做的事**：
1. 新建 `src/lib/ai/methodology.ts`，定义方法论步骤：
   - 雪花法：一句话 → 一段话 → 角色概要 → 段落扩展 → 场景列表 → 初稿
   - 英雄之旅：12 阶段（日常 → 号召 → 拒绝 → 导师 → 跨越 → 考验 → 深入 → 考验 → 回报 → 归途 → 复活 → 回归）
   - 三幕式：建置(25%) → 对抗(50%) → 解决(25%)
2. 创建项目时可选"创作方法论"（或不选）
3. 选择后，生成大纲时按方法论的阶段指导 AI 规划结构
4. UI：项目设置里加方法论选择器，选中后在大纲面板顶部显示当前所处阶段

**涉及文件**：
- 新建 `src/lib/ai/methodology.ts`
- `src/stores/project.ts` — 加 methodologyId 字段
- `src/lib/ai/adapters/outline-adapter.ts` — 按方法论生成
- `src/components/outline/OutlinePanel.tsx` — 显示方法论阶段

---

## Phase F：质量控制三件套

**目标**：写完不是终点，要审校、查漏、评分。

### F1. 章节审校

**要做的事**：
1. 新建 `src/lib/ai/adapters/review-adapter.ts`
2. AI 审校维度：
   - 逻辑一致性：角色位置、时间线、因果关系
   - 人物行为一致性：性格是否突变、对话是否符合角色
   - 世界观一致性：有没有违反已设定的规则
   - 伏笔衔接：本章涉及的伏笔是否处理得当
   - 情节节奏：是否有拖沓或跳跃
3. 输入：本章正文 + 状态表 + 角色档案 + 世界观 + 前章摘要 + 关联伏笔
4. 输出格式：

```typescript
interface ReviewResult {
  overallScore: number    // 0-100
  issues: ReviewIssue[]
  suggestions: string[]
}

interface ReviewIssue {
  dimension: 'logic' | 'character' | 'worldview' | 'foreshadow' | 'pacing'
  severity: 'info' | 'warning' | 'critical'
  description: string
  quote?: string          // 引用原文片段
  suggestion: string
}
```

5. UI：编辑器右侧加"审校"按钮，结果以侧面板展示，问题高亮标注

**涉及文件**：
- 新建 `src/lib/ai/adapters/review-adapter.ts`
- 新建 `src/components/editor/ReviewPanel.tsx`
- `src/components/editor/ChapterEditor.tsx` — 加审校入口

---

### F2. Anti-AI 去痕迹增强

**现状**：已有 `chapter.de-ai` prompt 模板，但是单维度的。

**要做的事**：
1. 升级 `de-ai` prompt 为五维检查：
   - 词汇：cliché 检测（"不禁"、"缓缓"、"竟然"等高频 AI 词）
   - 句法：句式多样性（是否全是"主谓宾"结构）
   - 叙事：展示 vs 告知比例（"他很愤怒" vs 展示愤怒的行为）
   - 情感：标签化检测（"心中一震"等模板化情感）
   - 对话：说话标签多样性（是否全用"说道"、"答道"）
2. 新建 `src/lib/ai/adapters/anti-ai-adapter.ts`
3. 输出：五维评分 + 标记的典型 AI 痕迹段落 + 改进建议
4. 结合"高频词提取"功能：统计正文中出现频率 > 阈值的词汇，一并交给 AI 优化

**涉及文件**：
- 新建 `src/lib/ai/adapters/anti-ai-adapter.ts`
- 新建 `src/components/editor/AntiAIPanel.tsx`
- `src/components/editor/ChapterEditor.tsx` — 加入口

---

### F3. 追读力评估

**要做的事**：
1. 新建 `src/lib/ai/adapters/readability-adapter.ts`
2. AI 评估维度：
   - Hook（悬念钩子）：章末是否留有悬念
   - Coolpoint（爽点）：本章有无高潮/爽点/打脸时刻
   - Micropayoff（微兑现）：前文铺垫在本章有无小回报
   - Pacing（节奏）：叙述-对话-动作的比例是否合理
3. 输出：0-100 追读力评分 + 各维度分数 + 改进建议
4. UI：在章节列表上用颜色标注每章的追读力评分（绿/黄/红）
5. 全书追读力趋势图（折线图，横轴=章节，纵轴=评分）

**涉及文件**：
- 新建 `src/lib/ai/adapters/readability-adapter.ts`
- 新建 `src/components/editor/ReadabilityScore.tsx`
- `src/components/editor/ChaptersListPanel.tsx` — 显示评分

---

## Phase G：角色 + 设定管理增强

### G1. 角色动态状态面板

**现状**：状态卡有 character 类别，但角色面板上看不到"当前状态"。

**要做的事**：
1. `CharacterPanel.tsx` 每个角色卡片下面加"当前状态"折叠区：
   - 当前位置
   - 实力等级
   - 身体/心理状态
   - 持有关键物品
   - 近期事件
2. 数据来源：从 `stateCards` 中筛选 `entityName === character.name && category === 'character'`
3. 支持手动修改状态
4. 状态变更自动记录到状态卡的 history（新增字段）

**涉及文件**：
- `src/components/character/CharacterPanel.tsx` — 加状态折叠区
- `src/stores/state-card.ts` — 加 `getCharacterState(name)` 方法

---

### G2. 角色出场章节管理

**要做的事**：
1. `Character` 类型加字段：
   - `firstAppearChapter: number | null` — 首次出场章节
   - `activeChapterRange: string` — 活跃章节范围描述（如 "1-30, 45-60"）
   - `exitChapter: number | null` — 退场/死亡章节
2. 完善大纲时（Phase D2），AI 自动分配角色到章节
3. 写正文时，memory-builder 只注入当前章节范围内的活跃角色

**涉及文件**：
- `src/lib/types/character.ts` — 加字段
- `src/lib/db/schema.ts` — migration
- `src/lib/ai/memory-builder.ts` — 按出场范围过滤角色

---

### G3. 货币体系管理

**要做的事**：
1. 新建类型 `CurrencySystem`：

```typescript
interface CurrencySystem {
  id?: number
  projectId: number
  worldNodeId?: number    // 关联哪个世界（多世界架构）
  name: string            // "灵石体系" / "金银铜币"
  description: string
  units: CurrencyUnit[]   // JSON 存储
  exchangeRates: string   // 兑换关系描述
  createdAt: number
  updatedAt: number
}

interface CurrencyUnit {
  name: string     // "上品灵石"
  value: number    // 相对价值
  description: string
}
```

2. DB migration + store + UI 面板
3. 写作上下文注入（避免 AI 搞错货币）

**涉及文件**：
- 新建 `src/lib/types/currency.ts`
- `src/lib/db/schema.ts` — 加 currencySystems 表
- 新建 `src/stores/currency.ts`
- 新建 `src/components/worldview/CurrencyPanel.tsx`
- `src/lib/ai/memory-builder.ts` — Semantic 层加货币体系

---

### G4. 功法/技能系统

**要做的事**：
1. 扩展现有 `ItemSystem`，或新建 `SkillSystem`：

```typescript
interface Skill {
  id?: number
  projectId: number
  name: string           // "九阳神功"
  type: 'martial' | 'magic' | 'ability' | 'passive' // 功法/法术/能力/被动
  rank: string           // 品级
  description: string
  effects: string        // 效果描述
  requirements: string   // 修炼要求
  ownerCharacterIds: string // JSON array — 持有角色
  createdAt: number
  updatedAt: number
}
```

2. DB + store + UI（在力量体系面板下面加子面板）
3. 角色面板显示其持有的功法/技能列表
4. 写作上下文注入（让 AI 知道角色会什么招式）

**涉及文件**：
- 新建 `src/lib/types/skill.ts`
- `src/lib/db/schema.ts` — 加 skills 表
- 新建 `src/stores/skill.ts`
- 新建 `src/components/worldview/SkillPanel.tsx`
- `src/components/character/CharacterPanel.tsx` — 显示技能列表

---

### G5. 势力绑定地图

**现状**：有势力管理 + 世界地图，但两者没有关联。

**要做的事**：
1. `Faction` 类型加字段：`boundMapNodeId: number | null` — 绑定的地图/区域
2. 势力面板加"绑定地图"下拉选择（从 worldNodes 取）
3. 世界地图上可视化势力分布（不同势力不同颜色）

**涉及文件**：
- `src/lib/types/` — Faction 加字段
- `src/components/faction/FactionPanel.tsx` — 加绑定 UI
- `src/components/geography/WorldMapVoronoi.tsx` — 可视化势力

---

## Phase H：导出 + 体验优化

### H1. 导出格式扩充

**现状**：支持 TXT / Markdown。

**要做的事**：
1. 新增 EPUB 导出（用 `epub-gen` 或手动构建 EPUB zip）
2. 新增 HTML 导出（带样式的单页 HTML）
3. 导出前可选"Anti-AI 体检"（Phase F2），附带体检报告
4. 导出设置：选择包含哪些内容（正文 / 大纲 / 角色设定 / 世界观）

**涉及文件**：
- `src/components/export/ExportPanel.tsx` — 加格式选择
- 新建 `src/lib/export/epub-builder.ts`
- 新建 `src/lib/export/html-builder.ts`

---

### H2. 版本对比面板

**现状**：有快照/历史模块，但缺少直观对比。

**要做的事**：
1. 新建 `src/components/editor/DiffViewer.tsx`
2. 左右分栏对比：旧版本 vs 新版本
3. 行级 diff 高亮（增/删/改用不同颜色）
4. "退回到此版本"按钮
5. 在批量完善大纲后自动保存快照，支持一键对比和退回

**涉及文件**：
- 新建 `src/components/editor/DiffViewer.tsx`
- `src/components/history/` — 接入 diff 视图

---

### H3. 便签/笔记系统

**要做的事**：
1. 新建类型 `Note`：

```typescript
interface Note {
  id?: number
  projectId: number
  chapterId?: number     // 可关联章节
  content: string
  color: string          // 便签颜色
  pinned: boolean
  createdAt: number
  updatedAt: number
}
```

2. DB + store + UI
3. 编辑器侧边可展开便签列表
4. 写作时可快速贴便签（快捷键）

**涉及文件**：
- 新建 `src/lib/types/note.ts`
- `src/lib/db/schema.ts` — 加 notes 表
- 新建 `src/stores/note.ts`
- 新建 `src/components/editor/NotePanel.tsx`

---

### H4. 选中文本智能操作

**要做的事**：
1. 编辑器中选中文本后弹出浮动工具栏：
   - "润色" — AI 润色选中段落
   - "扩写" — AI 扩展选中段落
   - "缩写" — AI 精简选中段落
   - "改写" — 用户输入指令，AI 按指令修改
   - "查漏" — AI 检查选中段落的问题
2. 修改结果以 diff 形式展示，用户选择接受/拒绝

**现状**：已有 polish / expand prompt，但 UI 入口不够便捷。

**涉及文件**：
- `src/components/editor/RichEditor.tsx` — 加选中浮动工具栏
- `src/components/editor/ChapterEditor.tsx` — 调用 AI 适配器

---

## 推荐实施顺序

```
Phase A (记忆闭环) ──→ Phase B (故事线) ──→ Phase C (伏笔升级)
    │                                            │
    └── 核心写作质量保障 ────────────────────────┘
                    │
Phase D (大纲强化) ──→ Phase F (质量控制)
    │
Phase E (题材+风格) ──→ Phase G (设定增强) ──→ Phase H (导出+体验)
```

**优先级排序理由**：
- A 最先做：解决"AI 记忆崩"这个核心痛点，这是用户用不用这个工具的决定因素
- B 紧跟 A：全局故事线是记忆系统的基础锚点
- C 依赖 A/B：伏笔注入需要记忆系统的架构
- D 可以和 A/B/C 并行：大纲流程独立
- E/F/G/H 按需排列
