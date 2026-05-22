# PHASE 18 — 大文档分块导入流水线

> **完成日期**：2026-05-11  
> **触发**：用户上传 1.6M 字符（4.75MB）的《知北游》触发 "AI 输出无法解析为 JSON" 错误（maxTokens 截断）。  
> **目标**：让 StoryForge 能稳定吃下百万～**千万字**的小说 / 设定集，全程可视化，断点续跑，自动重试，跨块去重。

---

## 1. 设计哲学

用户原话：

> "我希望事前请示、事中透明、事后汇报。串行吧，慢点就慢点，保证不断就行。"

所以本 Phase 的核心不是「跑得快」，而是「跑得稳 + 跑得明白」：

| 阶段 | 必须给用户什么 |
|------|---------------|
| 事前 | 总块数、预估时长、预估 token 消耗、预估费用、行为说明（串行/即时入库/自动重试/跨块合并） |
| 事中 | 顶部常驻状态条 + 块级网格 + 滚动日志 + 暂停/恢复/取消按钮 |
| 事后 | 成功/失败块数、累计入库统计、失败块明细 + 错误信息、可单独"重试失败块" |

---

## 2. 数据流总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                          用户上传文件                                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌─────────────────────────────────┐
              │   doc-parser.extractTextFromFile │
              │   (txt/md/csv/pdf/docx)         │
              └─────────────────────────────────┘
                              │
                              ▼
              ┌─────────────────────────────────┐
              │   chunker.chunkDocument()       │
              │   ① 章节边界                    │
              │   ② 段落空行                    │
              │   ③ 硬切 + overlap              │
              └─────────────────────────────────┘
                              │
                              ▼
              ┌─────────────────────────────────┐
              │   ImportConfirmModal            │  ← 事前请示
              │   (chunkSize 可调)              │
              └─────────────────────────────────┘
                              │ 确认
                              ▼
       ┌─────────────────────────────────────────────────────┐
       │   useImportSessionStore.create()                    │
       │   ↓ DB: importSessions 行（只有元数据，没有原文）   │
       │   pipeline.registerChunkTexts()                     │
       │   ↓ 内存 Map: IN_MEM_CHUNK_TEXT[sessionId]          │
       └─────────────────────────────────────────────────────┘
                              │
                              ▼
       ┌─────────────────────────────────────────────────────┐
       │   pipeline.runSession()  ── 严格串行 ──►            │
       │                                                     │
       │   for each chunk:                                   │
       │     ├ renderPrompt("import.parse-chunk", {          │
       │     │     chunkIndex, totalChunks,                  │
       │     │     knownContext: session.rollingContext,     │
       │     │     rawDocument: chunkText                    │
       │     │   })                                          │
       │     ├ chat(messages, config)   ← 非流式 + AbortCtrl │
       │     ├ extractJSON() + normalizeUnified()            │
       │     ├ applyChunkResult():                           │
       │     │     worldview → merge into worldviews 表      │
       │     │     characters → add into characters 表       │
       │     │     outline → recursive add into outlineNodes │
       │     ├ mergeUnified() 累加到 session.merged          │
       │     ├ buildRollingContext() → session.rollingContext│
       │     └ patchChunk(status=done, extractedCounts)      │
       │                                                     │
       │   每 MERGE_EVERY_N=10 块 + 终末：                   │
       │     runCharacterMerge()                             │
       │       ├ 拉项目所有角色（最近 200）                  │
       │       ├ renderPrompt("import.merge-characters")    │
       │       ├ 解析 mergeGroups[]                          │
       │       └ applyMergeGroup() 合并 + 删除别名行         │
       │                                                     │
       │   收尾：buildFinalReport() → session.finalReport    │
       └─────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌─────────────────────────────────┐
              │   ImportReportModal             │  ← 事后汇报
              │   - 成功/失败统计                │
              │   - finalReport 详文            │
              │   - 失败块明细 + 重试按钮       │
              └─────────────────────────────────┘
```

---

## 3. 核心模块

### 3.1 类型 — `src/lib/types/import-session.ts`
- `ImportSession` — 会话主体
- `ChunkState` — 单块状态
- `ImportLog` — 滚动日志归档
- 状态机：`ImportSessionStatus` ∈ {pending, running, paused, failed, done, cancelled}
- 状态机：`ChunkStatus` ∈ {pending, running, done, failed}

`UnifiedParseResult` 拆到 `import-session-data.ts` 单独存放，解掉 adapter ↔ session 的循环依赖。

### 3.2 切块器 — `src/lib/import/chunker.ts`

三级降级策略：

| 优先级 | 策略 | 适用 |
|--------|------|------|
| 1 | 中文章节标题 `第X章/回/节/卷/部/篇` 正则 | 长篇小说 |
| 2 | 段落空行 `\n{2,}` | 设定集 / 大纲 |
| 3 | 硬切 + 500 字尾部重叠 | 极端无结构文档 |

策略 1 会保证**单章不被劈两半**，连续多个短章节会合并到一块直到凑够 `targetChars`。

`quickHash()` 返回 16 进制短串 + 长度，用于 session 续跑时判断文件一致性。

### 3.3 流水线 — `src/lib/import/pipeline.ts`

公开 API：

```ts
runSession({ sessionId, projectId }): Promise<void>
pausePipeline(): void
cancelPipeline(): void
isPipelineRunning(): boolean
retryFailedChunks({ sessionId, projectId }): Promise<void>

// 内存原文注册（关键）
registerChunkTexts(sessionId, chunks: { index, text }[])
hasChunkTexts(sessionId): boolean
clearChunkTexts(sessionId): void
```

关键常量：
- `MERGE_EVERY_N = 10` — 每 10 块跑一次跨块角色合并
- `MAX_ATTEMPTS = 3` — 单块最多重试 3 次
- `RETRY_DELAY_MS = 1500` — 重试间隔

### 3.4 状态与持久化 stores

- `useImportSessionStore` — Dexie 薄封装，CRUD + `findUnfinished(projectId)`
- `useImportStatusStore` — 全局 pipeline 状态（zustand），订阅者：StatusBar / ProgressPanel / ActivityLog / Modals。日志只保留最近 200 条在内存里。

### 3.5 UI 组件
| 组件 | 角色 |
|------|------|
| `ImportStatusBar` | 顶部常驻，phase + 进度条 |
| `ImportProgressPanel` | N 块网格（hover 显示明细） + 当前正在跑的块 |
| `ImportActivityLog` | 200 条滚动日志 |
| `ImportConfirmModal` | 事前请示：chunkSize 滑块、时长/token/费用预估、行为说明 |
| `ImportReportModal` | 事后汇报：成功/失败计数、失败明细、可"仅重试失败块" |
| `ImportDocPanel`（重写） | 整套流程编排 + 未完成会话扫描 + 续跑入口 |

---

## 4. 关键决策与权衡

### 4.1 串行 vs 并发
**选择串行**。理由：
- 用户明确要求 "慢点就慢点，保证不断"
- 并发会触发各家 AI 平台的 rate limit
- 上下文滚动（前块 → 后块）天然就是串行依赖
- 失败重试与跨块合并的时序更可控

### 4.2 即时入库 vs 批量入库
**选择即时入库**。每块成功立刻写 worldview / characters / outlineNodes。
- 用户切到「角色」「世界观」标签页能实时看到新增
- 浏览器崩溃 / 用户取消，已解析数据不丢
- 代价：写 IndexedDB 次数变多（实测 1000 块 × 几十条角色 ≈ 几万次写入，Dexie 在 IDB 事务里 < 1s 不算瓶颈）

### 4.3 原文存内存 vs 存 DB
**选择存内存**。`ImportSession.chunks` 只存 start/end/label/状态等元数据。
- DB 体积稳定（不会因为千万字文档撑爆）
- 跑完后自动 `clearChunkTexts` 释放
- 代价：**浏览器关闭后续跑需重新上传同一文件**。UI 通过 `findUnfinished` 扫到未完成 session 后会提示用户上传，并用 `quickHash` 比对一致性

### 4.4 跨块角色合并 — AI 驱动 vs 规则匹配
**选择 AI 驱动**。运行 `import.merge-characters` seed 给 AI 看角色名单+描述，让它自己判断哪些是别名 / 同人 / 化名。
- 中文小说里"小明 = 小张 = 张明"这种规则匹配是搞不定的，但 AI 一看上下文就知道
- 触发时机：每 10 块一次 + 终末一次。中间合并避免角色列表无限膨胀；终末合并兜底
- 合并行为：保留 canonical 那条，其他条目的字段 append 进来，别名写进 relationships 附记，然后删除别名行

### 4.5 失败处理三层兜底
1. 单块失败 → 自动重 3 次（1.5s 间隔），都失败标记 failed 继续下一块
2. 全部跑完 → ReportModal 展示失败块明细
3. 用户点"重试失败块" → 重置 attempts/status，调 `retryFailedChunks` 重跑

---

## 5. Prompt Seeds

新增两个 seed（`src/lib/ai/prompt-seeds.ts`）：

### `import.parse-chunk`
输入变量：`chunkIndex`、`totalChunks`、`knownContext`、`rawDocument`

输出格式（强制 JSON）：
```json
{
  "worldview": { "worldOrigin": "...", "powerHierarchy": "...", ... },
  "characters": [ { "name": "...", "role": "protagonist", ... } ],
  "outline":    [ { "title": "第一卷", "type": "volume", "children": [ ... ] } ]
}
```

`knownContext` 是上一块累积下来的"已识别角色 + 世界观关键词"摘要，~1500 字，让 AI 保持人名一致、避免重复创造同一角色。

### `import.merge-characters`
输入变量：`characterList`（用 `name｜role｜shortDesc` 行分隔）

输出格式：
```json
{
  "mergeGroups": [
    { "canonical": "李白", "aliases": ["李太白", "诗仙"], "reason": "同一角色不同称呼" }
  ],
  "keepSeparate": []
}
```

---

## 6. 数据库 schema 变化

`src/lib/db/schema.ts` bump 到 v9：

```ts
importSessions: '++id, projectId, status, updatedAt, fileHash'
importLogs:     '++id, sessionId, chunkIndex, createdAt'
```

旧用户首次升级时 Dexie 会自动跑迁移，不会丢老数据。

---

## 7. 已知限制与未来改进

| 限制 | 影响 | 缓解 / 未来方向 |
|------|------|----------------|
| 浏览器关闭丢内存原文 | 必须重新上传同文件才能续跑 | 短期：UI 明确提示 + hash 比对；长期：把原文也存 IDB（按需切片读取） |
| 串行处理慢 | 1000 块约 10 小时 | 短期：用户已批准；长期：可加"按章节级并发 2~3"开关 |
| AI 输出截断 | 单块 JSON 不全 | 已有 `repairTruncatedJSON` 兜底 + 自动重试 |
| 跨块合并 prompt 容量 | 角色 > 200 名会被截断 | 当前截到最近 200；未来可按 role + projectId 分批合并 |

---

## 8. 验收清单

- [x] 1.6M 字符的《知北游》能稳定跑完（不再报 JSON 解析失败）
- [x] 跑到一半切到「角色」标签能看到已入库的角色
- [x] 单块失败自动重 3 次
- [x] 暂停/恢复/取消按钮工作
- [x] 关闭浏览器再回来，能看到"发现未完成任务"提示
- [x] 跑完弹 ReportModal，失败块可单独重试
- [x] 跨块角色合并真的能把"小明=张明"合并成一条
- [x] `npm run build` 通过（仅 PWA size warning，已放宽到 5 MiB）
- [x] `npx tsc --noEmit` 通过

---

## 9. 关联代码索引

```
src/
├── lib/
│   ├── types/
│   │   ├── import-session.ts         # ImportSession / ChunkState / ImportLog
│   │   └── import-session-data.ts    # UnifiedParseResult
│   ├── import/
│   │   ├── chunker.ts                # 切块器
│   │   └── pipeline.ts               # 核心流水线
│   ├── ai/
│   │   ├── adapters/import-adapter.ts # extractJSON + 修复
│   │   └── prompt-seeds.ts            # import.parse-chunk / import.merge-characters
│   └── db/schema.ts                   # v9 + 2 张新表
├── stores/
│   ├── import-session.ts             # Dexie CRUD store
│   └── import-status.ts              # 全局 pipeline 状态
└── components/system/
    ├── ImportDocPanel.tsx            # 主入口（重写）
    └── import/
        ├── ImportStatusBar.tsx
        ├── ImportProgressPanel.tsx
        ├── ImportActivityLog.tsx
        ├── ImportConfirmModal.tsx
        └── ImportReportModal.tsx
```
