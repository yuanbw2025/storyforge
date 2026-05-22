# StoryForge / 故事熔炉 — 数据模型定义

> **版本**: v1.0 | **最后更新**: 2026-04-13 | **状态**: 规划中

---

## 1. 存储方案

| 数据类型 | 存储位置 | 说明 |
|---------|---------|------|
| 项目数据 | IndexedDB (Dexie.js) | 世界观、角色、大纲、章节等 |
| AI 配置 | localStorage | API Key、提供商设置 |
| UI 状态 | Zustand (内存) | 当前面板、侧边栏折叠等 |

---

## 2. IndexedDB 数据库定义

```typescript
// src/lib/db/schema.ts
import Dexie, { type Table } from 'dexie';

class StoryForgeDB extends Dexie {
  projects!: Table<Project>;
  worldviews!: Table<Worldview>;
  storyCores!: Table<StoryCore>;
  characters!: Table<Character>;
  factions!: Table<Faction>;
  powerSystems!: Table<PowerSystem>;
  geographies!: Table<Geography>;
  histories!: Table<HistoryEvent>;
  items!: Table<StoryItem>;
  rules!: Table<WritingRule>;
  outlineNodes!: Table<OutlineNode>;
  chapters!: Table<Chapter>;
  foreshadows!: Table<Foreshadow>;

  constructor() {
    super('storyforge');
    this.version(1).stores({
      projects:     '++id, name, updatedAt',
      worldviews:   '++id, projectId',
      storyCores:   '++id, projectId',
      characters:   '++id, projectId, role, factionId',
      factions:     '++id, projectId',
      powerSystems: '++id, projectId',
      geographies:  '++id, projectId, parentId',
      histories:    '++id, projectId, year',
      items:        '++id, projectId',
      rules:        '++id, projectId',
      outlineNodes: '++id, projectId, parentId, order',
      chapters:     '++id, projectId, outlineNodeId, order',
      foreshadows:  '++id, projectId, status',
    });
  }
}

export const db = new StoryForgeDB();
```

---

## 3. 核心类型定义

### 3.1 Project（项目）

```typescript
interface Project {
  id?: number;
  name: string;                    // 书名
  genre: Genre;                    // 类型
  targetAudience: 'male' | 'female' | 'general';
  coreIdea: string;                // 核心创意
  synopsis?: string;               // 故事简介
  targetWordCount?: number;        // 目标字数
  targetChapterCount?: number;     // 目标章节数
  tags: string[];                  // 标签
  createdAt: number;               // 时间戳
  updatedAt: number;
}

type Genre = '玄幻' | '仙侠' | '都市' | '科幻' | '历史' | '军事' 
  | '游戏' | '体育' | '悬疑' | '轻小说' | '现实' | '武侠' 
  | '奇幻' | '末世' | '系统' | '穿越' | '重生' | '其他';
```

### 3.2 Worldview（世界观）

```typescript
interface Worldview {
  id?: number;
  projectId: number;
  worldName: string;               // 世界名称
  era: string;                     // 时代
  worldType: string;               // 世界类型
  overview: string;                // 世界概述
  coreRules: string;               // 核心规则
  society: string;                 // 社会结构
  politics: string;                // 政治体系
  economy: string;                 // 经济体系
  culture: string;                 // 文化
  techLevel: string;               // 技术/魔法水平
  updatedAt: number;
}
```

### 3.3 Character（角色）

```typescript
interface Character {
  id?: number;
  projectId: number;
  name: string;                    // 姓名
  nickname?: string;               // 外号/称号
  gender: string;                  // 性别
  age?: string;                    // 年龄
  role: CharacterRole;             // 角色定位
  appearance: string;              // 外貌描述
  personality: string;             // 性格描述
  personalityTags: string[];       // 性格标签
  background: string;              // 背景故事
  motivation: string;              // 动机
  goal: string;                    // 目标
  abilities: string;               // 能力
  powerLevel?: string;             // 实力等级
  weakness: string;                // 弱点
  secret?: string;                 // 秘密
  characterArc: string;            // 角色弧线
  factionId?: number;              // 所属势力
  relationships: CharacterRelation[];
  order: number;                   // 排序
  updatedAt: number;
}

type CharacterRole = 'protagonist' | 'heroine' | 'supporting' 
  | 'villain' | 'mentor' | 'ally' | 'other';

interface CharacterRelation {
  targetCharacterId: number;
  relationType: string;            // 如"师徒"、"宿敌"、"恋人"
  description: string;
}
```

### 3.4 OutlineNode（大纲节点）

```typescript
interface OutlineNode {
  id?: number;
  projectId: number;
  parentId: number | null;         // null = 卷级节点
  title: string;                   // 标题
  summary: string;                 // 摘要
  order: number;                   // 排序
  relatedCharacterIds: number[];   // 关联角色
  relatedForeshadowIds: number[]; // 关联伏笔
  updatedAt: number;
}
```

### 3.5 Chapter（章节）

```typescript
interface Chapter {
  id?: number;
  projectId: number;
  outlineNodeId?: number;          // 关联大纲节点
  title: string;
  content: string;                 // 正文
  wordCount: number;
  status: ChapterStatus;
  order: number;
  updatedAt: number;
}

type ChapterStatus = 'draft' | 'outlined' | 'writing' | 'completed';
```

### 3.6 Foreshadow（伏笔）

```typescript
interface Foreshadow {
  id?: number;
  projectId: number;
  name: string;
  mode: ForeshadowMode;
  description: string;
  importance: 'major' | 'minor';
  status: ForeshadowStatus;
  relatedCharacterIds: number[];
  events: ForeshadowEvent[];       // 状态变更记录
  createdAt: number;
  updatedAt: number;
}

type ForeshadowMode = 'chekhov-gun' | 'grass-snake' | 'prophecy' 
  | 'red-herring' | 'symmetry' | 'character-hint' | 'item-clue' 
  | 'environment-hint' | 'dialogue-subtext' | 'timeline-hint';

type ForeshadowStatus = 'planned' | 'planted' | 'echoed' | 'resolved' | 'abandoned';

interface ForeshadowEvent {
  type: 'plant' | 'echo' | 'resolve' | 'abandon';
  chapterId?: number;
  description: string;
  timestamp: number;
}
```

### 3.7 其他类型

```typescript
// Faction（势力）
interface Faction {
  id?: number;
  projectId: number;
  name: string;
  type: string;              // 势力类型
  description: string;
  ideology: string;          // 理念
  leader?: string;
  structure: string;         // 组织结构
  territory?: string;
  allies: number[];          // 盟友势力ID
  enemies: number[];         // 敌对势力ID
  updatedAt: number;
}

// PowerSystem（力量体系）
interface PowerSystem {
  id?: number;
  projectId: number;
  overview: string;
  levels: PowerLevel[];
  categories: string[];      // 能力分类
  advancement: string;       // 进阶条件
  limitations: string;       // 限制
  updatedAt: number;
}

interface PowerLevel {
  name: string;
  rank: number;
  description: string;
}

// StoryCore（故事核心）
interface StoryCore {
  id?: number;
  projectId: number;
  theme: string;
  subThemes: string[];
  coreConflict: string;
  conflictLayers: ConflictLayer[];
  plotPattern: PlotPattern;
  mainPlot: string;
  subPlots: SubPlot[];
  pacing: string;
  endingDirection: string;
  updatedAt: number;
}

type PlotPattern = 'hero-journey' | 'revenge' | 'underdog' | 'quest' 
  | 'rags-to-riches' | 'mystery' | 'rebirth' | 'tragedy' 
  | 'comedy' | 'voyage-return' | 'custom';

// WritingRule（规则约束）
interface WritingRule {
  id?: number;
  projectId: number;
  writingStyle: string;
  narrativePOV: string;
  tone: string;
  prohibitions: string[];
  consistencyRules: string[];
  references: string[];
  specialRequirements: string;
  updatedAt: number;
}
```

---

## 4. AI 配置（localStorage）

```typescript
interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature: number;       // 默认 0.7
  maxTokens: number;         // 默认 4096
}

type AIProvider = 'deepseek' | 'openai' | 'qwen' | 'doubao' | 'ollama' | 'custom';
```

---

## 5. 版本历史（IndexedDB）

```typescript
// 版本快照表 — 新增到 StoryForgeDB
class StoryForgeDB extends Dexie {
  // ... 已有表 ...
  snapshots!: Table<ProjectSnapshot>;
  
  constructor() {
    super('storyforge');
    this.version(2).stores({
      // ... 已有 stores ...
      snapshots: '++id, projectId, createdAt',
    });
  }
}

interface ProjectSnapshot {
  id?: number;
  projectId: number;
  label: string;                   // "自动备份" | "手动保存" | 用户自定义
  data: string;                    // JSON.stringify(StoryForgeBackup) 
  wordCount: number;               // 快照时字数
  createdAt: number;               // 时间戳
}
```

### 5.1 自动备份策略

```typescript
// 每 5 分钟检查一次，有变更则创建快照
const AUTO_BACKUP_INTERVAL = 5 * 60 * 1000;  // 5 分钟
const MAX_AUTO_SNAPSHOTS = 3;                  // 保留最近 3 个自动快照
const MAX_MANUAL_SNAPSHOTS = 10;               // 保留最近 10 个手动快照

// 清理策略：自动快照超过 3 个时删除最旧的
// 手动快照超过 10 个时提示用户清理
```

### 5.2 File System Access API 保存

```typescript
interface LocalSaveConfig {
  enabled: boolean;
  directoryHandle?: FileSystemDirectoryHandle;  // 用户选择的文件夹
  autoSave: boolean;                             // 是否自动保存
  format: 'json' | 'markdown';                  // 保存格式
  lastSavedAt?: number;
}

// 使用流程：
// 1. 用户点击 [绑定本地文件夹]
// 2. 浏览器弹出文件夹选择器
// 3. 用户授权后，自动保存 JSON 到该文件夹
// 4. 文件名格式：{书名}-backup-{timestamp}.json
// 注意：仅 Chrome/Edge 支持，需要 HTTPS 或 localhost
```

### 5.3 GitHub Gist 导出

```typescript
interface GistSaveConfig {
  enabled: boolean;
  accessToken?: string;             // GitHub Personal Access Token
  gistId?: string;                  // 已创建的 Gist ID（更新用）
  lastSyncAt?: number;
}

// 使用流程：
// 1. 用户在设置中输入 GitHub PAT
// 2. 点击 [保存到 Gist] → 创建/更新私密 Gist
// 3. Gist 包含完整 JSON 备份
// 4. 可从 Gist 恢复项目
```

---

## 6. 导出格式

```typescript
interface StoryForgeBackup {
  version: '1.0';
  exportedAt: number;
  project: Project;
  worldview: Worldview;
  storyCore: StoryCore;
  characters: Character[];
  factions: Faction[];
  powerSystem: PowerSystem;
  geographies: Geography[];
  histories: HistoryEvent[];
  items: StoryItem[];
  rules: WritingRule;
  outlineNodes: OutlineNode[];
  chapters: Chapter[];
  foreshadows: Foreshadow[];
}
```
