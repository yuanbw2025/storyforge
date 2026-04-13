# StoryForge / 故事熔炉 — 技术架构

> **版本**: v1.0 | **最后更新**: 2026-04-13 | **状态**: 规划中

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                        StoryForge                           │
│                   纯前端 SPA (React 18)                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐  ┌─────────────┐  ┌──────────────────────┐   │
│  │  Pages   │  │  Components │  │   State (Zustand)    │   │
│  │─────────│  │─────────────│  │──────────────────────│   │
│  │ Home    │  │ WorldView   │  │ projectStore         │   │
│  │ Workspace│  │ Character   │  │ worldviewStore       │   │
│  │ Settings │  │ Outline     │  │ characterStore       │   │
│  │         │  │ Editor      │  │ outlineStore         │   │
│  │         │  │ Foreshadow  │  │ chapterStore         │   │
│  │         │  │ Settings    │  │ foreshadowStore      │   │
│  │         │  │ Export      │  │ factionStore         │   │
│  └─────────┘  └─────────────┘  │ aiConfigStore        │   │
│                                 └──────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    Lib Layer                          │  │
│  │──────────────────────────────────────────────────────│  │
│  │                                                      │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  │  │
│  │  │  AI 层   │  │  数据库层     │  │  导出层      │  │  │
│  │  │──────────│  │──────────────│  │──────────────│  │  │
│  │  │ client   │  │ schema       │  │ markdown     │  │  │
│  │  │ prompts/ │  │ migrations   │  │ txt          │  │  │
│  │  │ context  │  │ queries      │  │ json-backup  │  │  │
│  │  │ stream   │  │              │  │              │  │  │
│  │  └──────────┘  └──────────────┘  └──────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  浏览器层                                                    │
│  ┌────────────┐  ┌──────────┐  ┌──────────────────────┐   │
│  │ IndexedDB  │  │ localStorage│ │ fetch (AI API)     │   │
│  │ (Dexie.js) │  │ (API Keys) │  │ SSE 流式响应       │   │
│  └────────────┘  └──────┬───┘  └──────────────────────┘   │
│                         │                                   │
│  ┌──────────────────────┴────────────────────────────────┐ │
│  │              持久化扩展层（可选）                        │ │
│  │  ┌────────────────┐  ┌──────────┐  ┌──────────────┐  │ │
│  │  │ File System    │  │ GitHub   │  │ 版本快照      │  │ │
│  │  │ Access API     │  │ Gist API │  │ (IndexedDB)  │  │ │
│  │  │ (本地文件夹)   │  │ (云备份) │  │ (自动备份)   │  │ │
│  │  └────────────────┘  └──────────┘  └──────────────┘  │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 核心原则

1. **纯前端，零后端** — 所有逻辑在浏览器端执行
2. **数据本地** — IndexedDB 存项目数据，localStorage 存配置
3. **AI 直连** — 浏览器直接调用 AI API（fetch + SSE）
4. **模型无关** — 统一的 OpenAI 兼容接口，支持任何模型
5. **离线可用** — 无 API Key 时，所有手动功能正常工作
6. **多层持久化** — IndexedDB 实时保存 + 定时快照 + 可选本地文件/云端备份

---

## 2. 技术栈详细说明

### 2.1 核心框架

| 技术 | 版本 | 用途 | 选型理由 |
|------|------|------|---------|
| **React** | 18.x | UI 框架 | 与 yuntype/infiniteskill 统一，组件生态成熟 |
| **TypeScript** | 5.x | 类型安全 | 大型项目必需，数据模型复杂 |
| **Vite** | 5.x | 构建工具 | 快速 HMR，已有经验 |
| **React Router** | 6.x | 路由 | Home 页 ↔ Workspace 页 |

### 2.2 状态管理

| 技术 | 用途 | 选型理由 |
|------|------|---------|
| **Zustand** | 全局状态管理 | 轻量（< 1KB），API 简洁，类 Pinia 体验，支持中间件 |

**为什么不用 Redux？** — 模板代码太多，项目不需要时间旅行调试。
**为什么不用 Jotai/Recoil？** — 原子化状态对这个项目太碎，需要的是按模块聚合的 store。

#### Store 模块设计

```typescript
// stores/project.ts — 项目管理
interface ProjectStore {
  projects: Project[];
  currentProjectId: string | null;
  createProject: (data: CreateProjectInput) => Promise<string>;
  deleteProject: (id: string) => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  updateProject: (id: string, data: Partial<Project>) => Promise<void>;
}

// stores/ai-config.ts — AI 配置
interface AIConfigStore {
  config: AIConfig;
  setConfig: (config: Partial<AIConfig>) => void;
  testConnection: () => Promise<boolean>;
}

// stores/worldview.ts — 世界观
// stores/character.ts — 角色
// stores/faction.ts — 势力
// stores/outline.ts — 大纲
// stores/chapter.ts — 章节
// stores/foreshadow.ts — 伏笔
// ... 每个模块一个 store，通过 projectId 关联
```

### 2.3 数据持久化

| 技术 | 用途 | 选型理由 |
|------|------|---------|
| **Dexie.js** | IndexedDB 封装 | API 友好，支持事务、索引、版本迁移，TypeScript 原生支持 |
| **localStorage** | API Key 存储 | 简单配置数据，不需要结构化查询 |

**为什么不用 localStorage 存所有数据？** — 一个小说项目可能有几十万字 + 几百个角色/设定，localStorage 5MB 限制不够，IndexedDB 理论无上限。

#### 数据库 Schema 概览

```typescript
import Dexie, { Table } from 'dexie';

class StoryForgeDB extends Dexie {
  projects!: Table<Project>;
  worldviews!: Table<Worldview>;
  storyCore!: Table<StoryCore>;
  characters!: Table<Character>;
  factions!: Table<Faction>;
  powerSystems!: Table<PowerSystem>;
  outlineNodes!: Table<OutlineNode>;
  chapters!: Table<Chapter>;
  foreshadows!: Table<Foreshadow>;
  
  constructor() {
    super('storyforge');
    this.version(1).stores({
      projects: '++id, name, createdAt, updatedAt',
      worldviews: '++id, projectId',
      storyCore: '++id, projectId',
      characters: '++id, projectId, name, role',
      factions: '++id, projectId, name',
      powerSystems: '++id, projectId',
      outlineNodes: '++id, projectId, parentId, order, type',
      chapters: '++id, projectId, outlineNodeId, order, status',
      foreshadows: '++id, projectId, status, type',
    });
  }
}

export const db = new StoryForgeDB();
```

### 2.4 AI 调用层

| 技术 | 用途 |
|------|------|
| **fetch API** | HTTP 请求 |
| **ReadableStream** | SSE 流式解析 |
| **AbortController** | 中断 AI 生成 |

#### AI Client 设计

```typescript
// lib/ai/client.ts

export interface AIConfig {
  provider: 'deepseek' | 'openai' | 'qwen' | 'doubao' | 'ollama' | 'custom';
  apiKey: string;         // Ollama 不需要
  model: string;          // 如 'deepseek-chat', 'gpt-4o', 'qwen-max'
  baseUrl: string;        // API 端点
  temperature?: number;   // 默认 0.7
  maxTokens?: number;     // 默认 4096
}

// 预设的 provider 配置
const PROVIDER_PRESETS: Record<string, Partial<AIConfig>> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
  },
  doubao: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-pro-32k',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    apiKey: 'ollama',  // Ollama 不验证 key，但 header 需要有值
  },
};

// 统一的流式聊天接口
export async function* streamChat(
  messages: ChatMessage[],
  config: AIConfig,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 4096,
    }),
    signal,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new AIError(response.status, error);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {}
      }
    }
  }
}
```

### 2.5 样式方案

| 技术 | 用途 | 选型理由 |
|------|------|---------|
| **Tailwind CSS** | 工具 UI 样式 | 暗色主题快速搭建，原子化类名高效 |
| **shadcn/ui** (可选) | UI 组件库 | 基于 Radix UI + Tailwind，可按需引入 |

#### 暗色主题色板

```css
:root {
  /* 背景层级 */
  --bg-base: #0a0a0f;        /* 最深背景 */
  --bg-surface: #12121a;     /* 面板背景 */
  --bg-elevated: #1a1a2e;    /* 悬浮/弹窗 */
  --bg-hover: #252540;       /* hover 状态 */
  
  /* 文字层级 */
  --text-primary: #e8e8ed;   /* 主文字 */
  --text-secondary: #8888a0; /* 次要文字 */
  --text-muted: #555570;     /* 弱化文字 */
  
  /* 强调色 */
  --accent: #6366f1;         /* 主色 indigo */
  --accent-hover: #818cf8;
  --accent-muted: #4338ca;
  
  /* 功能色 */
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;
  --info: #3b82f6;
  
  /* 边框 */
  --border: #2a2a40;
  --border-hover: #3a3a55;
}
```

---

## 3. 目录结构

```
storyforge/
├── docs/                          # 项目文档
│   ├── 01-PRODUCT-OVERVIEW.md
│   ├── 04-TECH-ARCHITECTURE.md    # 本文档
│   ├── 05-WORLD-BUILDING-ENGINE.md
│   └── ...
│
├── src/
│   ├── main.tsx                   # 入口
│   ├── App.tsx                    # 根组件 + 路由
│   ├── index.css                  # 全局样式 + Tailwind
│   │
│   ├── pages/                     # 页面级组件
│   │   ├── HomePage.tsx           # 项目列表页
│   │   └── WorkspacePage.tsx      # 创作工作台（核心页面）
│   │
│   ├── components/                # UI 组件
│   │   ├── layout/                # 布局组件
│   │   │   ├── Sidebar.tsx        # 左侧导航
│   │   │   ├── MainPanel.tsx      # 中间编辑区
│   │   │   └── PropertyPanel.tsx  # 右侧属性面板
│   │   │
│   │   ├── project/               # 项目管理
│   │   │   ├── ProjectCard.tsx
│   │   │   ├── CreateProjectDialog.tsx
│   │   │   └── ProjectSettings.tsx
│   │   │
│   │   ├── worldview/             # 世界观
│   │   │   ├── WorldviewPanel.tsx
│   │   │   ├── StoryCorePanel.tsx
│   │   │   ├── GeographyPanel.tsx
│   │   │   ├── HistoryPanel.tsx
│   │   │   ├── SocietyPanel.tsx
│   │   │   └── RulesPanel.tsx
│   │   │
│   │   ├── character/             # 角色
│   │   │   ├── CharacterList.tsx
│   │   │   ├── CharacterCard.tsx
│   │   │   ├── CharacterEditor.tsx
│   │   │   └── RelationshipGraph.tsx
│   │   │
│   │   ├── faction/               # 势力
│   │   │   ├── FactionList.tsx
│   │   │   └── FactionEditor.tsx
│   │   │
│   │   ├── power-system/          # 力量体系
│   │   │   ├── PowerSystemPanel.tsx
│   │   │   └── CultivationPanel.tsx
│   │   │
│   │   ├── outline/               # 大纲
│   │   │   ├── OutlineTree.tsx
│   │   │   ├── OutlineNode.tsx
│   │   │   └── OutlineGenerator.tsx
│   │   │
│   │   ├── editor/                # 写作编辑器
│   │   │   ├── ChapterList.tsx
│   │   │   ├── ChapterEditor.tsx
│   │   │   ├── AIToolbar.tsx      # 续写/扩写/润色/去AI味
│   │   │   └── ContextViewer.tsx  # 查看发给AI的上下文
│   │   │
│   │   ├── foreshadow/            # 伏笔
│   │   │   ├── ForeshadowList.tsx
│   │   │   ├── ForeshadowEditor.tsx
│   │   │   └── ForeshadowTracker.tsx
│   │   │
│   │   ├── settings/              # 设置
│   │   │   ├── AIConfigPanel.tsx
│   │   │   └── DataManagement.tsx # 导入/导出/清除
│   │   │
│   │   └── shared/                # 共享组件
│   │       ├── AIStreamOutput.tsx # 流式AI输出显示
│   │       ├── MarkdownEditor.tsx # Markdown 编辑器
│   │       ├── ConfirmDialog.tsx
│   │       └── LoadingSpinner.tsx
│   │
│   ├── stores/                    # Zustand 状态管理
│   │   ├── project.ts
│   │   ├── ai-config.ts
│   │   ├── worldview.ts
│   │   ├── character.ts
│   │   ├── faction.ts
│   │   ├── power-system.ts
│   │   ├── outline.ts
│   │   ├── chapter.ts
│   │   └── foreshadow.ts
│   │
│   ├── lib/                       # 核心库
│   │   ├── ai/                    # AI 调用层
│   │   │   ├── client.ts          # 统一 AI 客户端（流式）
│   │   │   ├── context-builder.ts # 上下文自动组装
│   │   │   └── prompts/           # System Prompts
│   │   │       ├── worldview.ts   # 世界设计师
│   │   │       ├── character.ts   # 角色设计师
│   │   │       ├── faction.ts     # 势力设计师
│   │   │       ├── outline.ts     # 大纲师
│   │   │       ├── chapter.ts     # "老贼"写手
│   │   │       ├── polish.ts      # 润色/去AI味
│   │   │       └── foreshadow.ts  # 伏笔顾问
│   │   │
│   │   ├── db/                    # 数据库层
│   │   │   ├── schema.ts          # Dexie Schema 定义
│   │   │   ├── migrations.ts      # 版本迁移
│   │   │   └── queries.ts         # 常用查询封装
│   │   │
│   │   ├── export/                # 导出
│   │   │   ├── markdown.ts        # 导出 Markdown
│   │   │   ├── txt.ts             # 导出纯文本
│   │   │   └── json-backup.ts     # JSON 完整备份/恢复
│   │   │
│   │   └── types/                 # TypeScript 类型定义
│   │       ├── project.ts
│   │       ├── worldview.ts
│   │       ├── character.ts
│   │       ├── faction.ts
│   │       ├── power-system.ts
│   │       ├── outline.ts
│   │       ├── chapter.ts
│   │       ├── foreshadow.ts
│   │       └── ai.ts
│   │
│   └── hooks/                     # 自定义 Hooks
│       ├── useAIStream.ts         # AI 流式输出 hook
│       ├── useProject.ts          # 当前项目数据
│       └── useAutoSave.ts         # 自动保存
│
├── public/
│   └── manifest.json              # PWA manifest
│
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── PROGRESS.md                    # 开发进度
└── README.md
```

---

## 4. 数据流架构

### 4.1 Zustand Store ↔ IndexedDB 同步

```
用户操作 → Zustand Store → 写入 IndexedDB（异步）
                ↑
页面加载 → 从 IndexedDB 读取 → 初始化 Zustand Store
```

```typescript
// 以角色管理为例
import { create } from 'zustand';
import { db } from '../lib/db/schema';

interface CharacterStore {
  characters: Character[];
  loading: boolean;
  
  // 加载当前项目的所有角色
  loadCharacters: (projectId: string) => Promise<void>;
  
  // 创建角色（同时写 Store + DB）
  addCharacter: (char: Omit<Character, 'id'>) => Promise<string>;
  
  // 更新角色
  updateCharacter: (id: string, data: Partial<Character>) => Promise<void>;
  
  // 删除角色
  deleteCharacter: (id: string) => Promise<void>;
}

export const useCharacterStore = create<CharacterStore>((set, get) => ({
  characters: [],
  loading: false,
  
  loadCharacters: async (projectId) => {
    set({ loading: true });
    const characters = await db.characters
      .where('projectId')
      .equals(projectId)
      .toArray();
    set({ characters, loading: false });
  },
  
  addCharacter: async (char) => {
    const id = await db.characters.add(char as Character);
    set({ characters: [...get().characters, { ...char, id } as Character] });
    return String(id);
  },
  
  updateCharacter: async (id, data) => {
    await db.characters.update(id, data);
    set({
      characters: get().characters.map(c =>
        c.id === id ? { ...c, ...data } : c
      ),
    });
  },
  
  deleteCharacter: async (id) => {
    await db.characters.delete(id);
    set({ characters: get().characters.filter(c => c.id !== id) });
  },
}));
```

### 4.2 AI 上下文自动组装

这是 StoryForge 的核心技术——根据当前操作，自动从各模块提取相关数据，组装成 AI 的上下文。

```
┌─────────────────────────────────────────────────┐
│            Context Builder（上下文组装器）         │
│─────────────────────────────────────────────────│
│                                                  │
│  输入：当前操作类型 + 当前项目数据                   │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ 世界观   │  │ 角色设定  │  │ 大纲     │      │
│  │ 摘要     │  │ 相关角色  │  │ 当前章节  │      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
│       │             │             │              │
│       └─────────────┼─────────────┘              │
│                     ↓                            │
│           ┌─────────────────┐                    │
│           │  System Prompt  │                    │
│           │  (角色人设)      │                    │
│           └────────┬────────┘                    │
│                    ↓                             │
│           ┌─────────────────┐                    │
│           │  组装后的        │                    │
│           │  messages[]     │                    │
│           └─────────────────┘                    │
│                                                  │
│  输出：完整的 ChatMessage[] → 发给 AI API         │
└─────────────────────────────────────────────────┘
```

```typescript
// lib/ai/context-builder.ts

export interface ContextBuildOptions {
  type: 'generate-outline' | 'generate-chapter' | 'continue-writing'
      | 'expand' | 'polish' | 'de-ai' | 'generate-character'
      | 'generate-faction' | 'generate-worldview';
  projectId: string;
  chapterId?: string;      // 当前章节
  outlineNodeId?: string;  // 当前大纲节点
  userPrompt: string;      // 用户额外指令
}

export async function buildContext(options: ContextBuildOptions): Promise<ChatMessage[]> {
  const { type, projectId } = options;
  
  // 1. 获取项目基本信息
  const project = await db.projects.get(projectId);
  
  // 2. 获取世界观摘要
  const worldview = await db.worldviews.where('projectId').equals(projectId).first();
  
  // 3. 获取角色列表（只取名字+简介，控制 token 量）
  const characters = await db.characters
    .where('projectId').equals(projectId)
    .toArray();
  const characterSummary = characters.map(c => 
    `${c.name}（${c.role}）：${c.shortDescription}`
  ).join('\n');
  
  // 4. 根据操作类型选择 System Prompt
  const systemPrompt = getSystemPrompt(type);
  
  // 5. 组装上下文消息
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildUserContext(project, worldview, characterSummary, options) },
  ];
  
  return messages;
}
```

### 4.3 流式 AI 输出

```typescript
// hooks/useAIStream.ts

export function useAIStream() {
  const [output, setOutput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const config = useAIConfigStore(s => s.config);

  const generate = useCallback(async (messages: ChatMessage[]) => {
    setOutput('');
    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      for await (const chunk of streamChat(messages, config, abortRef.current.signal)) {
        setOutput(prev => prev + chunk);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户手动中断，不报错
      } else {
        throw err;
      }
    } finally {
      setIsStreaming(false);
    }
  }, [config]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { output, isStreaming, generate, stop };
}
```

---

## 5. 页面架构

### 5.1 Home 页（项目列表）

```
┌──────────────────────────────────────────────┐
│  StoryForge                    [设置] [GitHub]│
├──────────────────────────────────────────────┤
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ ＋       │ │ 项目A    │ │ 项目B    │    │
│  │ 新建项目  │ │ 玄幻     │ │ 都市     │    │
│  │          │ │ 12章     │ │ 5章      │    │
│  │          │ │ 3.2万字  │ │ 1.5万字  │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  [导入项目]  [导入JSON备份]           │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

### 5.2 Workspace 页（核心创作工作台）

```
┌──────────────────────────────────────────────────────────────────┐
│  ← 返回  │  《项目名》                 [AI设置] [导出] [保存]    │
├──────┬───────────────────────────────────────────────┬───────────┤
│      │                                               │           │
│ 导航  │              主编辑区                          │  属性面板  │
│      │                                               │           │
│ 📋基本│  根据左侧选择的模块显示对应内容：               │  显示当前 │
│ 🌍世界│  - 基本信息表单                                │  选中项的 │
│ 💫故事│  - 世界观编辑器                                │  详细属性 │
│ 👤角色│  - 角色列表/编辑器                             │           │
│ ⚔势力│  - 大纲树                                     │  如：     │
│ 💪力量│  - 章节编辑器                                  │  角色属性 │
│ 📖大纲│  - 伏笔管理                                   │  节点详情 │
│ ✍写作│                                               │  伏笔状态 │
│ 🔮伏笔│  ┌──────────────────────────────────┐        │           │
│      │  │  AI 输出区（流式显示）              │        │           │
│      │  │  ████████████░░░░░ 生成中... [停止] │        │           │
│      │  └──────────────────────────────────┘        │           │
│      │                                               │           │
├──────┴───────────────────────────────────────────────┴───────────┤
│  状态栏：字数统计 | 章节进度 | AI 模型 | 连接状态                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 6. AI 模型适配

### 6.1 支持的提供商

| 提供商 | Base URL | 默认模型 | CORS 支持 | 备注 |
|--------|----------|---------|----------|------|
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` | ✅ | 性价比最高，推荐 |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o` | ✅ | 质量好但贵 |
| **通义千问** | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-max` | ✅ | 中文能力强 |
| **豆包** | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-pro-32k` | ⚠️ 需测试 | 字节跳动 |
| **Ollama** | `http://localhost:11434/v1` | `qwen2.5:7b` | ✅ (本地) | 完全离线，需本地安装 |
| **自定义** | 用户填写 | 用户填写 | 取决于服务 | 兼容 OpenAI API 格式即可 |

### 6.2 CORS 处理

浏览器直接调用第三方 API 可能遇到 CORS 问题。处理策略：

1. **优先选择支持 CORS 的提供商**（DeepSeek、OpenAI 已确认支持）
2. **Ollama 本地模型**无 CORS 问题
3. **降级方案**：提示用户使用浏览器插件允许 CORS / 使用自定义代理端点

### 6.3 Token 管理

由于长篇小说的上下文可能非常大，需要智能管理 token：

```typescript
// 上下文窗口管理策略
interface TokenBudget {
  systemPrompt: number;    // ~500 tokens — AI 角色人设
  worldviewSummary: number; // ~800 tokens — 世界观精华摘要
  characterContext: number; // ~500 tokens — 相关角色简介
  outlineContext: number;  // ~300 tokens — 当前章节大纲
  previousChapter: number; // ~1000 tokens — 上一章末尾（连贯性）
  userPrompt: number;      // ~200 tokens — 用户指令
  // 剩余空间留给 AI 输出
}

// 当总 token 超出模型上限时，按优先级裁剪
// 优先保留：systemPrompt > outlineContext > characterContext > worldviewSummary > previousChapter
```

---

## 7. 构建与部署

### 7.1 Vite 配置

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/storyforge/',  // 主仓库子目录部署
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5175,  // 避免与 yuntype(5173) / infiniteskill(5174) 冲突
  },
});
```

### 7.2 部署

与 yuntype 相同的双部署模式：

1. **主仓库部署**：`my-website.vercel.app/storyforge/`
2. **独立仓库部署**：`storyforge.vercel.app`（后续创建）

### 7.3 PWA 支持（Phase 6）

```json
// public/manifest.json
{
  "name": "StoryForge - 故事熔炉",
  "short_name": "StoryForge",
  "description": "AI 小说创作工坊",
  "start_url": "/storyforge/",
  "display": "standalone",
  "background_color": "#0a0a0f",
  "theme_color": "#6366f1"
}
```

---

## 8. 安全考虑

### API Key 安全

- API Key 存储在 `localStorage`，**仅保留在用户浏览器本地**
- 不会通过任何渠道上传到服务器
- 页面 UI 中 Key 默认以 `***` 显示，需要手动点击查看
- 支持随时清除所有存储数据

### 数据安全

- 所有小说数据存在 IndexedDB，不离开浏览器
- 提醒用户定期导出 JSON 备份（浏览器清除缓存会丢失数据）
- 考虑添加 "自动备份到下载文件夹" 功能（Phase 6）

---

## 9. 性能考虑

| 场景 | 策略 |
|------|------|
| 大量角色/章节 | IndexedDB 索引查询，分页加载 |
| 长篇小说（100万字+）| 章节按需加载，不一次性读入内存 |
| AI 流式输出 | 增量渲染，避免每个 chunk 都触发全量重渲染 |
| 大纲树渲染 | 虚拟化列表（react-window），只渲染可见节点 |
| 首屏加载 | 代码分割（React.lazy），非当前页面延迟加载 |
