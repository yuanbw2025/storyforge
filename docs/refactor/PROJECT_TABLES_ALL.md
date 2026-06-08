# PROJECT_TABLES_ALL · 全部 45 张表硬清单(DB v26)

> 这份文件是 **MASTER-BLUEPRINT.md §4.0.1 中 `PROJECT_TABLES_ALL` 常量的事实来源**。
> 实施者(5.5)在写 Phase 0/1 时,如果需要"全部表清单",直接引用本文件。
> 核对来源: `src/lib/db/schema.ts` DB v26 + `src/lib/types/*` 字段定义 + `src/lib/export/json-export.ts` 当前导出实现(2026-06-08 重新扫描)。

---

## 一、全部 45 张表(按字母序)

```typescript
// src/lib/db/schema.ts 中声明的全部 Table:
const ALL_DEXIE_TABLES_V26 = [
  'aiUsageLog',
  'chapters',
  'characterRelations',
  'characters',
  'codexCategories',
  'codexEntries',
  'creativeRules',
  'detailedOutlines',
  'emotionBeatCards',
  'factions',
  'foreshadows',
  'geographies',
  'historicalKeywords',
  'historicalTimelineEvents',
  'histories',
  'importFiles',
  'importJobs',
  'importLogs',
  'importSessions',
  'importantLocations',
  'itemLedger',
  'itemSystems',
  'masterChapterBeats',
  'masterChunkAnalysis',
  'masterInsights',
  'masterStyleMetrics',
  'masterWorks',
  'notes',
  'outlineNodes',
  'powerSystems',
  'projects',
  'promptTemplates',
  'promptWorkflows',
  'referenceChunkAnalysis',
  'references',
  'snapshots',
  'stateCards',
  'storyArcs',
  'storyCores',
  'storyTimelineEvents',
  'worldGroupLinks',
  'worldGroups',
  'worldNodes',
  'worldRulesProfiles',
  'worldviews',
]
// 共 45 张
```

---

## 二、按 owner 分类(Phase 1 PROJECT_TABLES 注册用)

### 2.1 项目根表(1 张,自身就是项目)

```
projects
```

### 2.2 直接项目归属表(35 张,带 `projectId` 字段/索引)
正常用 `where('projectId').equals(pid)` 查询。

```
aiUsageLog, chapters, characterRelations, characters, codexCategories,
codexEntries, creativeRules, detailedOutlines, emotionBeatCards, factions,
foreshadows, geographies, historicalKeywords, historicalTimelineEvents,
histories, importJobs, importSessions, importantLocations, itemLedger,
itemSystems, masterWorks, notes, outlineNodes, powerSystems, references,
snapshots, stateCards, storyArcs, storyCores, storyTimelineEvents,
worldGroupLinks, worldGroups, worldNodes, worldRulesProfiles, worldviews
```

特殊说明:
- `masterWorks.projectId` 类型为 `number | null | undefined`; `null` 表示全局学习库,非 null 时归属项目。
- `aiUsageLog.projectId` 类型为 `number | null | undefined`; `null` 表示未绑定项目的 AI 消耗记录。

### 2.3 间接归属表(6 张,通过其它表间接挂项目)
**这些表删项目时容易漏!**

| 表 | 间接关联 |
|---|---|
| `importFiles` | 通过 `sessionId` 间接挂 importSessions.projectId;参考/导入原文跟 importSessions 走;大师作品还可能通过 `MasterWork.importSessionId` 或 `100000 + workId` 虚拟 sessionId 复用此表 |
| `importLogs` | 通过 `sessionId` 间接挂 importSessions.projectId |
| `referenceChunkAnalysis` | 通过 `referenceId` 间接挂 references.projectId |
| `masterChunkAnalysis` | 通过 `workId` 间接挂 masterWorks.projectId |
| `masterChapterBeats` | 同上 |
| `masterStyleMetrics` | 同上 |

### 2.4 全局表(3 张,不绑项目)
不参与 `deleteProject` 级联。

```
promptTemplates       // scope: 'system' | 'user',全局共享
promptWorkflows       // 同上
masterInsights        // 按 genre 全局共享,可被多个项目复用;当前 JSON 备份会全量导出/按 genre 去重导入
```

### 2.5 带 `worldGroupId` / `homeWorldGroupId` 字段的表(11 张,worldScoped / homeWorldScoped)
**Phase 1 PROJECT_TABLES 必须按实际字段标记 `worldScoped` / `homeWorldScoped`,这些表参与:**
- 多世界隔离(查询时按当前世界过滤)
- `migrateToMultiWorld` 盖章
- `deleteGroup` 级联清理

```
worldviews
powerSystems
geographies
histories
worldNodes
historicalTimelineEvents
historicalKeywords
outlineNodes          ← P0-8 漏盖章表
codexCategories       ← 仅自定义分类有 worldGroupId;内置分类保持 null=全局共用结构
codexEntries
characters            ← 实际字段是 homeWorldGroupId(不是 worldGroupId),应标记 homeWorldScoped
```

特殊说明:
- `worldRulesProfiles` **当前** schema 是 `++id, &projectId`(项目级单例),**Phase 40 后**改为 `++id, projectId, worldGroupId`(每世界一套)

### 2.6 直接项目归属但**不**带 worldGroupId/homeWorldGroupId(24 张)
这些表不按当前世界组直接隔离;其中部分通过外键间接继承世界归属。

```
aiUsageLog           // 项目级消耗统计;可 null
chapters             // 通过 outlineNodeId 间接继承大纲节点世界归属
characterRelations   // 角色关系;世界归属需从角色侧解析
creativeRules        // 创作规则项目级
detailedOutlines     // 细纲挂 outlineNode,继承其 worldGroupId
emotionBeatCards     // 情感节拍卡,通过 chapterId 间接挂章节
factions             // 旧实体,将被 codex.faction 替代
foreshadows          // 伏笔可跨世界
importJobs           // 导入任务临时态
importSessions       // 导入会话临时态
importantLocations   // 重要地点:当前无 worldGroupId,会全局注入到写作上下文
itemLedger           // 物品流水,chapterId 可空
itemSystems          // 旧实体,将被 codex.artifact 替代
masterWorks          // 大师作品学习;projectId 可空
notes                // 自由笔记
references           // 项目参考书
snapshots            // 本地版本历史
stateCards           // 角色/地点/物品/势力状态卡
storyArcs            // 故事线可跨世界
storyCores           // 故事核心项目级,跨世界共享主线
storyTimelineEvents  // 故事时间线,chapterId 可空
worldGroupLinks      // 世界组关系本身
worldGroups          // 世界组本身
worldRulesProfiles   // 当前项目级单例;Phase 40 后改每世界一套
```

---

## 三、各表的 `exportable` 状态(Phase 1 PROJECT_TABLES 用)

### 3.1 可导出(JSON 备份纳入)— 37 张

```
projects, worldviews, storyCores, powerSystems, characters, factions,
outlineNodes, chapters, foreshadows, geographies, histories, itemSystems,
creativeRules, characterRelations, references, referenceChunkAnalysis,
detailedOutlines, masterWorks, masterChunkAnalysis, masterChapterBeats,
masterStyleMetrics, masterInsights, stateCards, emotionBeatCards,
storyArcs, notes, worldNodes, historicalTimelineEvents, historicalKeywords,
importantLocations, worldRulesProfiles, worldGroups, worldGroupLinks,
itemLedger, storyTimelineEvents, codexCategories, codexEntries
```

说明:
- 该清单来自 `ProjectExportData` 与 `exportProjectJSON()` 当前实现。
- `masterInsights` 虽然是全局表,当前实现会全量导出,导入时按 `genre` 去重。
- `masterWorks` 只导出 `projectId === 当前项目` 的记录;全局学习库记录不随项目 JSON 备份导出。

### 3.2 不导出(本地态/全局态/统计)— 8 张

```
snapshots              // 本地版本历史,避免循环嵌套
promptTemplates        // 全局,不绑项目
promptWorkflows        // 全局
importJobs             // 临时态
importSessions         // 临时态
importLogs             // 临时态
importFiles            // 临时态(blob)
aiUsageLog             // 消耗统计,体积大不导出
```

---

## 四、各表的外键引用关系(Phase 1 refs 字段)

### 4.1 简单外键(Phase 1 SimpleRef)

| 表 | 字段 | 指向 | onDelete |
|---|---|---|---|
| `characterRelations` | `fromCharacterId` | `characters.id` | cascade |
| `characterRelations` | `toCharacterId` | `characters.id` | cascade |
| `chapters` | `outlineNodeId` | `outlineNodes.id` | cascade |
| `detailedOutlines` | `outlineNodeId` | `outlineNodes.id` | cascade |
| `emotionBeatCards` | `chapterId` | `chapters.id` | cascade |
| `referenceChunkAnalysis` | `referenceId` | `references.id` | cascade |
| `masterChunkAnalysis` | `workId` | `masterWorks.id` | cascade |
| `masterChapterBeats` | `workId` | `masterWorks.id` | cascade |
| `masterStyleMetrics` | `workId` | `masterWorks.id` | cascade |
| `codexEntries` | `categoryId` | `codexCategories.id` | cascade |
| `outlineNodes` | `parentId` | `outlineNodes.id`(自引用) | cascade |
| `codexCategories` | `parentId` | `codexCategories.id`(自引用) | cascade |
| `importantLocations` | `parentId` | `importantLocations.id`(自引用) | cascade |
| `worldNodes` | `parentId` | `worldNodes.id`(自引用) | cascade |
| `worldGroupLinks` | `fromGroupId` | `worldGroups.id` | cascade |
| `worldGroupLinks` | `toGroupId` | `worldGroups.id` | cascade |

### 4.2 间接归属(Phase 1 IndirectRef)

| 表 | 字段 | 通过 |
|---|---|---|
| `importFiles` | `sessionId` | importSessions.projectId(普通导入/参考导入);或 MasterWork.importSessionId;或 `100000+workId` 虚拟(master blob) |
| `importLogs` | `sessionId` | 同上(普通导入) |
| `referenceChunkAnalysis` | `referenceId` | references.projectId |
| `masterChunkAnalysis` | `workId` | masterWorks.projectId |
| `masterChapterBeats` | `workId` | masterWorks.projectId |
| `masterStyleMetrics` | `workId` | masterWorks.projectId |

### 4.3 JSON 字段引用(Phase 1 JsonRef / ArrayRef)

| 表 | 字段 | 引用 |
|---|---|---|
| `detailedOutlines` | `appearingCharacterIds`(JSON array) | characters.id |
| `detailedOutlines` | `foreshadowIds`(JSON array) | foreshadows.id |
| `detailedOutlines` | `scenes[].characterIds`(JSON nested array) | characters.id |
| `creativeRules` | `citedReferenceIds`(JSON array) | references.id |
| `creativeRules` | `citedInsightIds`(JSON array) | masterInsights.id |
| `codexEntries` | `refs`(JSON map,词条间关联) | codexEntries.id |
| `worldNodes` | `portalsJSON`(JSON,传送门) | worldNodes.id |

**这些 JSON 引用是历史最容易漏处理的部分**(本轮 P1-7、P1-14 都是这类)。Phase 1 PROJECT_TABLES 必须显式登记这些 refs。

---

## 五、本文件的维护

- 每次 schema 升级(DB 版本 bump)→ 重新跑扫描 → 更新本文件
- 任何新增 Dexie Table → 立即同步本文件 + PROJECT_TABLES 注册表 + 类型定义
- 本文件不应手工编辑表名列表(必须从 schema 派生)
- 实施者(5.5)如果发现本文件与实际代码不一致 → 立刻打回 + 开 issue

---

## 六、自动校验脚本(Phase 1 后启用)

启动期自动校验(`lib/registry/validate.ts`):

```typescript
import { db } from '../db/schema'
import { PROJECT_TABLES } from './project-tables'

export function validateRegistry() {
  const dexieTableNames = db.tables.map(t => t.name)
  const registryTableNames = PROJECT_TABLES.map(s => s.name)

  // 双向覆盖检查
  const missing = dexieTableNames.filter(n => !registryTableNames.includes(n))
  const extra = registryTableNames.filter(n => !dexieTableNames.includes(n))

  if (missing.length > 0) {
    throw new Error(`[Registry] 缺失表登记: ${missing.join(', ')}`)
  }
  if (extra.length > 0) {
    throw new Error(`[Registry] 注册表多了不存在的表: ${extra.join(', ')}`)
  }
}
```

启动期一旦不一致 → throw → 应用启动失败 → 强制开发者修正。

---

## 〆 总

> 这份清单是事实,不是设计。
> 5.5 在 Phase 0/1 期间需要"全部表清单"时,引用本文件;不要自己数。
> Phase 1 完成后,所有手写表清单移到 PROJECT_TABLES 注册表,这份文件作为校验事实源。
