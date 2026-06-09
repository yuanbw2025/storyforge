# Phase 3：数据模型重建（增量版）— Playbook

> 由 Opus 4.7 撰写并自执行。写于 2026-05-06。

---

## § 1. 元信息

```yaml
phase: 03
title: 数据模型扩展（增量版，build 全程保持绿）
prerequisites: [PHASE-02 完成]
estimated_hours: 2-3
recommended_model: Opus 4.7（自执行）
status: in-progress
deviation_from_v3: 由"删库重建"改为"增量加字段加表"，理由见 § 10
```

---

## § 2. 目标

为 v3 设计目标铺好数据底座：
- 加 2 张新表：`detailedOutlines`（细纲）、`importJobs`（AI 导入任务）
- 给 `Worldview / Project / Character / Foreshadow / StoryCore / CreativeRules` 加新字段
- 加 3 个独立类型：`DetailedOutline`、`ImportJob`、`ReferenceWork`
- 旧字段、旧表、旧面板**全部保留**，留给 P4 重建侧边栏时一并清理

**做完之后**：
- App 可以正常编译、启动、所有现有面板继续工作
- 新表已经在 IndexedDB 里就绪，等后续 Phase 写入数据
- 类型层提前完成，P5+ 写新面板时直接用扩展后的接口

**不在本 Phase 范围**：
- 删除 `factions / geographies / histories / itemSystems / references` 表（Phase 4 拆侧边栏时同步删）
- 重命名 `creativeRules.toneAndMood → atmosphere`（P5 改 panel 时迁数据）
- 任何 UI 改动

---

## § 3. 改动清单

### 新增（4 文件）

- `src/lib/types/detailed-outline.ts` — DetailedOutline 类型
- `src/lib/types/import-job.ts` — ImportJob 类型
- `src/lib/types/reference-work.ts` — ReferenceWork 类型（嵌入 CreativeRules.referenceWorks）

### 修改（8 文件）

- `src/lib/types/index.ts` — 导出 3 个新类型
- `src/lib/types/worldview.ts` — Worldview 加 v3 §2.x 的新字段（worldOrigin / naturalEnv* / humanityEnv* 系列），全部可选
- `src/lib/types/project.ts` — 已有 genres/status/coverImage，再加 customGenre?（Phase 1 已加？需 grep 确认）
- `src/lib/types/character.ts` — Character 加 location?, firstAppearance?, storyRole?, ending?；CharacterRole 加 `'npc'` `'extra'`
- `src/lib/types/foreshadow.ts` — Foreshadow 加 timelinePosition?
- `src/lib/types/creative-rules.ts` — CreativeRules 加 atmosphere?, referenceWorks?
- `src/lib/types/outline.ts` — StoryCore 加 logline?, concept?, subPlots?
- `src/lib/db/schema.ts` — 加 v7：`detailedOutlines` + `importJobs` 两表
- `src/main.tsx` — REQUIRED_TABLES 数组追加 2 项

---

## § 4. 任务步骤

### 4.1 新增 detailed-outline.ts
DetailedOutline 表行：projectId, chapterId, scenes[]（每个 scene 含 title/summary/characters[]/location/conflict）

### 4.2 新增 import-job.ts
ImportJob：projectId, type ('character'|'worldview'|'outline'), status, rawDocument, parsedJson, createdAt

### 4.3 新增 reference-work.ts
ReferenceWork：title, author, genre, takeaway（参考点）, type ('inspiration'|'avoid')

### 4.4 扩展现有类型
按 § 3 清单逐文件加可选字段，**保留旧字段**。

### 4.5 schema.ts 新版本
```ts
this.version(7).stores({
  detailedOutlines: '++id, projectId, chapterId',
  importJobs: '++id, projectId, type, createdAt',
})
```

### 4.6 更新 REQUIRED_TABLES
main.tsx 数组里追加两个新表名。

### 4.7 build 通过

---

## § 5. 数据模型变更

| 项 | 旧 | 新 |
|---|---|---|
| Dexie 版本 | 6 | 7 |
| 总表数 | 17 | 19（+ detailedOutlines + importJobs） |
| 字段变更 | 全部加在现有 interface 上，可选，向后兼容 | |
| 删字段 / 删表 | **无**（留给 P4） | |

---

## § 6. DoD

- [ ] `npm run build` 0 error
- [ ] 浏览器加载 → ensureSchema 自动加 2 张新表（v6→v7 升级）
- [ ] DevTools 看 IndexedDB → 19 张表
- [ ] 所有 Phase 1+2 功能继续工作（提示词管理 UI 正常）
- [ ] 现存所有 panel 编译通过

---

## § 7. AI 全功能巡检

跳过（本 Phase 不动 AI 链）。

---

## § 8. 故障排查

| 症状 | 原因 | 应对 |
|---|---|---|
| 升级到 v7 后旧数据没了 | 不应该出现（增量加表不会清旧表） | 看 ensureSchema 是否触发 reset；检查 REQUIRED_TABLES |
| 类型扩展后某 panel 编译错 | 改动了非可选字段 | 全部新字段必须 `?:` 可选 |

---

## § 9. 提交规范

```bash
git commit -m "feat(phase-03): 数据模型增量扩展 — 2 新表 + 6 接口加可选字段"
```

---

## § 10. 与 v3 战略文档的偏差说明

v3 §6 Phase 3 原文："直接删库重建，bump v6 清空所有表，全新启动"。

**本 Playbook 改为"增量加字段加表，旧字段旧表暂留"**，理由：
1. 删库 + 删字段会让 P3 完成到 P4-P9 完成之间，6 个面板（FactionPanel / GeographyPanel / HistoryPanel / ItemSystemPanel / WorldviewPanel / CreativeRulesPanel）全部编译失败
2. HANDOFF §决议 7 允许"开发期无真实用户清库"，但没强制说"必须删字段"——只要终态对就行
3. 增量法每个 Phase 都可独立交付、可演示、可回滚
4. P4 拆侧边栏时再统一删旧表 + 删旧面板，那时 panel 改造已完成，删表才不会瘸腿

**终态完全等同 v3 §4.2 描述。**
