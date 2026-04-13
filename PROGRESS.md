# StoryForge / 故事熔炉 — 开发进度文档

> **最后更新**: 2026-04-13 21:15 | **当前阶段**: Phase 1 ✅ 完成，Phase 2 待开始

---

## 📌 快速上手（给下次接手的 AI / 开发者）

### 项目是什么？
**StoryForge（故事熔炉）** 是一款纯前端、开源的 AI 小说创作工坊。核心流程：
> 构建世界观 → AI 生成大纲 → AI 写章节正文 → 导出完整小说

### 技术栈
- **React 19** + **TypeScript** + **Vite 6**
- **Tailwind CSS 3** — 5 套主题（CSS 变量驱动）
- **Zustand** — 状态管理
- **Dexie.js** — IndexedDB 本地数据库（9 张表）
- **lucide-react** — 图标
- **react-router-dom 7** — 路由

### 启动开发
```bash
cd my-website/storyforge
# 如果用 nvm：
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run dev    # http://localhost:5175/storyforge/
```

### 项目在主仓库中的位置
```
my-website/
├── yuntype/           # 云中书 — AI 排版工具
├── infiniteskill/     # InfiniteSkill — 技能编译器
├── storyforge/        # 故事熔炉 — AI 小说创作工坊 ← 当前项目
└── ...
```

### 设计文档
所有设计文档在 `storyforge/docs/` 下：
| 文档 | 内容 |
|------|------|
| `01-PRODUCT-OVERVIEW.md` | 产品定义、用户画像、竞品分析 |
| `02-FEATURE-SPEC.md` | 功能规格 |
| `03-UI-DESIGN.md` | UI 设计规范 |
| `04-TECH-ARCHITECTURE.md` | 技术架构（**最重要，必读**） |
| `05-WORLD-BUILDING-ENGINE.md` | 世界构建引擎 10 维度详细设计 |
| `06-AI-PROMPTS-SYSTEM.md` | AI 提示词系统设计 |
| `07-DEVELOPMENT-PLAN.md` | 开发计划（Phase 1-7 完整任务清单） |
| `08-DATA-SCHEMA.md` | 数据模型详细设计 |

---

## ✅ Phase 1 — 脚手架 + 基础框架（已完成）

**完成日期**: 2026-04-13

### 已完成内容

#### 1.1 项目配置文件
| 文件 | 说明 |
|------|------|
| `package.json` | React 19 + Vite 6 + Zustand 5 + Dexie 4 + lucide-react |
| `vite.config.ts` | base: `/storyforge/`，端口 5175 |
| `tsconfig.json` | strict mode，ES2020 target |
| `tailwind.config.ts` | 自定义颜色映射到 CSS 变量（bg-base, text-primary, accent 等） |
| `postcss.config.js` | tailwindcss + autoprefixer |
| `index.html` | 🔥 favicon，中文 lang |
| `.gitignore` | node_modules, dist |

#### 1.2 CSS 主题系统 — `src/index.css`
5 套完整主题，通过 `data-theme` 属性切换：

| 主题 | data-theme | 风格 |
|------|-----------|------|
| 🌑 深夜书房 | `midnight`（默认） | 纯黑底 + 靛蓝强调 |
| 🌃 暗夜蓝 | `ocean` | 深蓝灰底 + 青蓝强调 |
| 🌫️ 墨灰 | `graphite` | 中性灰底 + 暖橙强调 |
| ☁️ 烟白 | `mist` | 浅灰底 + 靛蓝强调 |
| 📜 暖纸 | `parchment` | 米色纸张底 + 棕色强调 |

每个主题定义了 16 个 CSS 变量：
- 背景：`--bg-base`, `--bg-surface`, `--bg-elevated`, `--bg-hover`
- 文字：`--text-primary`, `--text-secondary`, `--text-muted`
- 强调：`--accent`, `--accent-hover`, `--accent-muted`
- 功能：`--success`, `--warning`, `--error`, `--info`
- 边框：`--border`, `--border-hover`

#### 1.3 入口与路由
| 文件 | 说明 |
|------|------|
| `src/main.tsx` | ReactDOM.createRoot + BrowserRouter (basename: `/storyforge`) + 主题恢复 |
| `src/App.tsx` | Routes: `/` → HomePage, `/workspace/:projectId` → WorkspacePage |

#### 1.4 TypeScript 类型定义 — `src/lib/types/`
| 文件 | 导出类型 |
|------|---------|
| `project.ts` | `NovelGenre`（8 种类型）, `Project`, `CreateProjectInput` |
| `ai.ts` | `AIProvider`（6 种）, `AIConfig`, `ChatMessage`, `AIError`, `PROVIDER_PRESETS`（5 家预设） |
| `worldview.ts` | `Worldview`（7 字段）, `StoryCore`（4 字段）, `PowerSystem`（4 字段） |
| `character.ts` | `CharacterRole`（4 种）, `Character`（11 字段）, `Faction`（8 字段） |
| `outline.ts` | `OutlineNodeType`（3 级）, `OutlineNode`, `ChapterStatus`（5 种）, `Chapter` |
| `foreshadow.ts` | `ForeshadowType`（10 种）, `ForeshadowStatus`（4 种）, `Foreshadow` |
| `index.ts` | 统一导出所有类型 |

#### 1.5 数据库 — `src/lib/db/schema.ts`
基于 Dexie.js 的 IndexedDB 数据库，9 张表：

```
projects:      ++id, name, createdAt, updatedAt
worldviews:    ++id, projectId
storyCores:    ++id, projectId
powerSystems:  ++id, projectId
characters:    ++id, projectId, name, role
factions:      ++id, projectId, name
outlineNodes:  ++id, projectId, parentId, order, type
chapters:      ++id, projectId, outlineNodeId, order, status
foreshadows:   ++id, projectId, status, type
```

#### 1.6 状态管理 — `src/stores/`
| 文件 | Store | 功能 |
|------|-------|------|
| `project.ts` | `useProjectStore` | projects 列表, CRUD, 级联删除（删项目时清除所有关联数据） |
| `ai-config.ts` | `useAIConfigStore` | AI 配置（localStorage 持久化）, 提供商切换预设, 连接测试 |

#### 1.7 AI 客户端 — `src/lib/ai/client.ts`
| 函数 | 说明 |
|------|------|
| `streamChat()` | AsyncGenerator 流式聊天，SSE 解析，支持 AbortSignal 中断 |
| `chat()` | 非流式聊天（简单调用） |

兼容所有 OpenAI API 格式的提供商（DeepSeek / OpenAI / 通义千问 / 豆包 / Ollama）。

#### 1.8 页面与组件

| 文件 | 说明 |
|------|------|
| `src/pages/HomePage.tsx` | 项目列表页：新建项目卡 + 项目卡片列表 + 创建项目弹窗（名称/类型/简介/目标字数） |
| `src/pages/WorkspacePage.tsx` | 工作台页：加载项目 → 左侧导航 + 主面板，模块路由分发 |
| `src/components/layout/Sidebar.tsx` | 10 模块导航（基本信息/世界观/故事核心/角色/势力/力量体系/大纲/写作/伏笔/设置） |
| `src/components/project/ProjectInfoPanel.tsx` | 项目基本信息编辑面板（名称/类型/简介/目标字数 + 保存） |
| `src/components/settings/AIConfigPanel.tsx` | AI 配置面板（提供商/Key/URL/模型/温度/MaxTokens/测试连接）+ 主题切换 |

### 当前文件结构
```
storyforge/
├── docs/                              # 8 份设计文档
├── src/
│   ├── main.tsx                       # 入口 + 主题恢复
│   ├── App.tsx                        # 路由（Home / Workspace）
│   ├── index.css                      # 5 套主题 + 全局样式
│   ├── vite-env.d.ts
│   ├── pages/
│   │   ├── HomePage.tsx               # 项目列表 + 创建弹窗
│   │   └── WorkspacePage.tsx          # 工作台（模块路由分发）
│   ├── components/
│   │   ├── layout/
│   │   │   └── Sidebar.tsx            # 10 模块侧边导航
│   │   ├── project/
│   │   │   └── ProjectInfoPanel.tsx   # 基本信息编辑
│   │   └── settings/
│   │       └── AIConfigPanel.tsx      # AI 配置 + 主题切换
│   ├── stores/
│   │   ├── project.ts                 # 项目 CRUD Store
│   │   └── ai-config.ts              # AI 配置 Store
│   ├── lib/
│   │   ├── ai/
│   │   │   └── client.ts             # streamChat + chat
│   │   ├── db/
│   │   │   └── schema.ts             # Dexie 9 张表
│   │   └── types/
│   │       ├── project.ts
│   │       ├── ai.ts
│   │       ├── worldview.ts
│   │       ├── character.ts
│   │       ├── outline.ts
│   │       ├── foreshadow.ts
│   │       └── index.ts              # 统一导出
│   └── hooks/                         # （空，Phase 2 添加）
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
└── PROGRESS.md                        # 本文档
```

### Phase 1 验收状态
- [x] 能创建/删除项目
- [x] 工作台左侧导航 + 主面板布局正常
- [x] 侧边栏可切换模块（未开发模块显示"🚧 该模块将在后续 Phase 中开发"）
- [x] AI 配置能保存到 localStorage
- [x] 主题切换 5 套主题正常工作
- [x] TypeScript `tsc --noEmit` 编译零错误
- [x] `npm run dev` 能正常启动

---

## 🔜 Phase 2 — AI 写作核心（下一步）

> **参考文档**: `docs/07-DEVELOPMENT-PLAN.md` Phase 2 章节
> **预计工作量**: 5-7 天

### 建议开发顺序

按照「跑通完整链路」的思路，先做最简单的 CRUD + AI 场景：

#### 第一步：通用基础组件
| # | 任务 | 产出文件 | 说明 |
|---|------|---------|------|
| 2.1 | useAIStream Hook | `src/hooks/useAIStream.ts` | 流式输出 + 停止 + 错误处理，**所有 AI 模块复用** |
| 2.2 | AIStreamOutput 组件 | `src/components/shared/AIStreamOutput.tsx` | 流式文字显示 + 操作栏（停止/采纳/重试） |

#### 第二步：世界观模块（最简单的 AI CRUD 场景）
| # | 任务 | 产出文件 | 说明 |
|---|------|---------|------|
| 2.3 | Worldview Store | `src/stores/worldview.ts` | 世界观 CRUD + IndexedDB 同步 |
| 2.4 | 世界观面板 | `src/components/worldview/WorldviewPanel.tsx` | 6 个 tab（地理/历史/社会/文化/经济/规则）+ 摘要字段 + AI「帮我扩写」 |
| 2.5 | 世界观提示词 | `src/lib/ai/prompts/worldview.ts` | 世界设计师 System Prompt |

#### 第三步：故事核心 + 力量体系
| # | 任务 | 产出文件 | 说明 |
|---|------|---------|------|
| 2.6 | StoryCore Store | `src/stores/story-core.ts` | |
| 2.7 | 故事核心面板 | `src/components/worldview/StoryCorePanel.tsx` | 主题/冲突/情节模式/故事线 |
| 2.8 | PowerSystem Store | `src/stores/power-system.ts` | |
| 2.9 | 力量体系面板 | `src/components/worldview/PowerSystemPanel.tsx` | 体系 CRUD + 等级列表 |

#### 第四步：角色与势力
| # | 任务 | 产出文件 | 说明 |
|---|------|---------|------|
| 2.10 | Character Store | `src/stores/character.ts` | |
| 2.11 | 角色面板 | `src/components/character/CharacterList.tsx` + `CharacterEditor.tsx` | 列表 + 详情编辑 |
| 2.12 | Faction Store | `src/stores/faction.ts` | |
| 2.13 | 势力面板 | `src/components/faction/FactionList.tsx` + `FactionEditor.tsx` | |

#### 第五步：大纲系统
| # | 任务 | 产出文件 | 说明 |
|---|------|---------|------|
| 2.14 | Outline Store | `src/stores/outline.ts` | |
| 2.15 | 大纲树视图 | `src/components/outline/OutlineTree.tsx` | 卷→篇→章三级树 |
| 2.16 | 大纲 AI 生成 | `src/components/outline/OutlineGenerator.tsx` | AI 生成卷级大纲 + 展开为章节 |
| 2.17 | Context Builder | `src/lib/ai/context-builder.ts` | **核心模块** — 根据操作类型自动组装上下文 |
| 2.18 | 大纲/章节提示词 | `src/lib/ai/prompts/outline.ts` + `chapter.ts` | 大纲师 + "老贼"写手人设 |

#### 第六步：写作编辑器
| # | 任务 | 产出文件 | 说明 |
|---|------|---------|------|
| 2.19 | Chapter Store | `src/stores/chapter.ts` | |
| 2.20 | 章节编辑器 | `src/components/editor/ChapterEditor.tsx` | textarea + 字数统计 |
| 2.21 | AI 工具栏 | `src/components/editor/AIToolbar.tsx` | 生成正文/续写/扩写/润色/去AI味 |
| 2.22 | 上下文查看器 | `src/components/editor/ContextViewer.tsx` | 显示发给 AI 的完整 prompt |
| 2.23 | 自动保存 Hook | `src/hooks/useAutoSave.ts` | debounce 写入 IndexedDB |

#### 第七步：伏笔系统
| # | 任务 | 产出文件 | 说明 |
|---|------|---------|------|
| 2.24 | Foreshadow Store | `src/stores/foreshadow.ts` | |
| 2.25 | 伏笔面板 | `src/components/foreshadow/ForeshadowList.tsx` + `ForeshadowEditor.tsx` | 按状态筛选 + 10 种模式 |

### Phase 2 验收标准
- [ ] 能 AI 生成世界观各维度内容并保存
- [ ] 角色/势力 CRUD 正常
- [ ] 能 AI 生成卷级大纲 → 展开为章节
- [ ] 能从大纲生成章节正文（流式）
- [ ] 能续写/扩写/润色正文
- [ ] 能停止 AI 生成
- [ ] 自动保存正常工作
- [ ] 伏笔 CRUD + 状态流转正常
- [ ] 上下文查看器能显示发送的 prompt

---

## 📋 后续 Phase 概览

详细任务清单见 `docs/07-DEVELOPMENT-PLAN.md`。

### Phase 3 — 世界构建完善
- 补全地理环境面板（带层级地点列表）
- 历史年表面板（时间线视图）
- 社会结构面板
- 道具/法宝系统
- 规则约束面板（写作红线/一致性约束）
- 角色关系编辑

### Phase 4 — 伏笔增强 + 润色功能
- 伏笔与章节关联（埋设/呼应/回收标记到具体章节）
- AI 伏笔建议
- 选中文字 → 扩写/润色/去AI味
- 自定义 AI 指令

### Phase 5 — 导出 + 打磨
- JSON 导出/导入（完整项目备份）
- Markdown/TXT 导出
- 快捷键（Cmd+S / Cmd+Enter / Esc）
- Toast 通知、Loading 骨架屏、错误边界、空状态引导

### Phase 6 — 高级功能
- 自动定时备份（IndexedDB 快照）
- 版本历史面板
- File System Access API（本地文件夹自动保存）
- GitHub Gist 导出
- 角色关系图可视化（react-force-graph-2d）
- PWA 支持

### Phase 7 — 打磨增强
- TipTap 富文本编辑器替换 textarea
- 侧边栏折叠（图标模式）
- 属性面板（选中项详细属性）
- AI 概念地图/图像地图

---

## 🔧 关键设计决策记录

### 1. 为什么用 CSS 变量而不是 Tailwind 的 dark mode？
因为需要 5 套主题，不仅是 light/dark 两种。通过 `data-theme` 属性 + CSS 变量实现，Tailwind 配置中的颜色值直接映射到 CSS 变量。

### 2. 为什么 ID 用自增数字而不是 UUID？
Dexie.js 的 `++id` 自增 ID 性能更好，且 IndexedDB 对数字索引的查询效率高于字符串。

### 3. 为什么 AI 配置存 localStorage 而不是 IndexedDB？
AI 配置是全局的（不跟项目走），数据量小，localStorage 读写同步更方便。

### 4. 为什么 streamChat 用 AsyncGenerator？
比 callback 模式更优雅，调用方可以用 `for await...of` 逐块处理，也方便与 AbortController 配合实现中断。

### 5. 为什么删除项目要做级联删除？
因为所有数据（世界观、角色、大纲、章节、伏笔）都通过 `projectId` 关联，删项目必须清除所有关联数据，否则会留下孤儿数据。

### 6. 为什么先做 textarea 编辑器而不是 TipTap？
降低初期复杂度。Phase 1-4 用 textarea 够用，Phase 7 再升级为 TipTap 富文本编辑器。

---

## 🐛 已知问题

1. **暂无已知 bug** — Phase 1 代码已通过 TypeScript 编译检查，dev 服务器可正常运行。

---

## 📊 字数统计

| 指标 | 数量 |
|------|------|
| 源代码文件 | 18 个 |
| TypeScript 类型定义 | 6 个文件，约 20+ 接口/类型 |
| 数据库表 | 9 张 |
| CSS 主题 | 5 套 |
| 侧边栏模块 | 10 个（2 个已实现，8 个待开发） |
| AI 提供商预设 | 5 家 |
| 设计文档 | 8 份 |
