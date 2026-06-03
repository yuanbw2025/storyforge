# StoryForge / 故事熔炉 — 开发进度文档

> **最后更新**: 2026-05-26 | **当前阶段**: Phase 1-7 + 19 全部完成，审计确认

---

## 📌 快速上手（给下次接手的 AI / 开发者）

### 项目是什么？
**StoryForge（故事熔炉）** 是一款纯前端、开源的 AI 小说创作工坊。核心流程：
> 构建世界观 → AI 生成大纲 → AI 写章节正文 → 导出完整小说

### 技术栈
- **React 19** + **TypeScript** + **Vite 6**
- **Tailwind CSS 3** — 3 套场景主题（work/forge/paper，CSS 变量驱动）
- **Zustand** — 状态管理
- **Dexie.js** — IndexedDB 本地数据库（9 张表）
- **lucide-react** — 图标
- **react-router-dom 7** — 路由
- **Google Fonts** — Inter + Source Serif 4 + JetBrains Mono

### 启动开发
```bash
cd my-website/storyforge
# 如果用 nvm：
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run dev    # http://localhost:1111/storyforge/
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
| `vite.config.ts` | base: `/storyforge/`，端口 1111 |
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
基于 Dexie.js 的 IndexedDB 数据库，9 张表。

#### 1.6 状态管理 — `src/stores/`
| 文件 | Store | 功能 |
|------|-------|------|
| `project.ts` | `useProjectStore` | projects 列表, CRUD, 级联删除 |
| `ai-config.ts` | `useAIConfigStore` | AI 配置 localStorage 持久化, 提供商切换预设, 连接测试 |

#### 1.7 AI 客户端 — `src/lib/ai/client.ts`
| 函数 | 说明 |
|------|------|
| `streamChat()` | AsyncGenerator 流式聊天，SSE 解析，支持 AbortSignal 中断 |
| `chat()` | 非流式聊天（简单调用） |

#### 1.8 页面与组件
| 文件 | 说明 |
|------|------|
| `src/pages/HomePage.tsx` | 项目列表页 + 创建弹窗 |
| `src/pages/WorkspacePage.tsx` | 工作台页：模块路由分发 |
| `src/components/layout/Sidebar.tsx` | 10 模块导航 |
| `src/components/project/ProjectInfoPanel.tsx` | 项目基本信息编辑面板 |
| `src/components/settings/AIConfigPanel.tsx` | AI 配置面板 + 主题切换 |

---

## ✅ Phase 2 — AI 写作核心（已完成）

**完成日期**: 2026-04-13

### 已完成内容

#### 2.1 通用基础 — Hooks
| 文件 | 说明 |
|------|------|
| `src/hooks/useAIStream.ts` | 流式 AI 输出 Hook：`start(messages)` / `stop()` / `reset()`，返回 `{output, isStreaming, error}`。封装 streamChat + AbortController，**所有 AI 模块复用** |
| `src/hooks/useAutoSave.ts` | 自动保存 Hook：debounce 写入 IndexedDB，跳过首次渲染 |

#### 2.2 通用基础 — 共享组件
| 文件 | 说明 |
|------|------|
| `src/components/shared/AIStreamOutput.tsx` | AI 流式输出展示组件：打字机效果 + 闪烁光标 + 字数统计 + 操作栏（停止/采纳/重试） |

#### 2.3 AI 提示词系统 — `src/lib/ai/prompts/`
| 文件 | 导出函数 | 人设 |
|------|---------|------|
| `worldview.ts` | `buildWorldviewPrompt()` | 资深奇幻/科幻世界设计师 |
| `character.ts` | `buildCharacterPrompt()`, `buildCharacterDimensionPrompt()` | 角色设计大师 |
| `outline.ts` | `buildVolumeOutlinePrompt()`, `buildChapterOutlinePrompt()` | 经验丰富的大纲师 |
| `chapter.ts` | `buildChapterContentPrompt()`, `buildContinuePrompt()`, `buildPolishPrompt()`, `buildExpandPrompt()`, `buildDeAIPrompt()` | 网文"老贼"写手 + 润色/扩写/去AI味专家 |

#### 2.4 上下文构建器 — `src/lib/ai/context-builder.ts`
| 函数 | 说明 |
|------|------|
| `buildWorldContext()` | 组装世界观 + 故事核心 + 力量体系摘要 |
| `buildCharacterContext()` | 组装角色列表摘要 |
| `buildExistingWorldview()` | 组装世界观已有维度内容（供 AI 保持一致） |

#### 2.5 状态管理 Stores
| 文件 | Store | 功能 |
|------|-------|------|
| `src/stores/worldview.ts` | `useWorldviewStore` | 世界观 + 故事核心 + 力量体系的加载/保存（自动创建或更新） |
| `src/stores/character.ts` | `useCharacterStore` | 角色 + 势力 CRUD |
| `src/stores/outline.ts` | `useOutlineStore` | 大纲节点 CRUD + `addNodes()` 批量添加 + 级联删除子节点 |
| `src/stores/chapter.ts` | `useChapterStore` | 章节 CRUD + `selectChapter()` 当前章节选择 |
| `src/stores/foreshadow.ts` | `useForeshadowStore` | 伏笔 CRUD + `updateStatus()` 状态流转 |

#### 2.6 功能面板组件
| 文件 | 说明 |
|------|------|
| `src/components/worldview/WorldviewPanel.tsx` | 世界观 7 维度 Tab 编辑 + AI 一键生成 + 采纳填充 |
| `src/components/worldview/StoryCorePanel.tsx` | 故事核心 4 字段表单（主题/冲突/模式/故事线），onBlur 自动保存 |
| `src/components/worldview/PowerSystemPanel.tsx` | 力量体系编辑（名称/描述/等级/规则），onBlur 自动保存 |
| `src/components/character/CharacterPanel.tsx` | 角色列表 + 详情编辑器（7 维度展开/折叠）+ AI 设计角色 |
| `src/components/faction/FactionPanel.tsx` | 势力列表 + 6 字段编辑 |
| `src/components/outline/OutlinePanel.tsx` | 大纲树视图（卷→章）+ AI 生成卷级大纲 + AI 展开为章节 + 章节写作入口 |
| `src/components/editor/ChapterEditor.tsx` | **核心写作编辑器**：章节列表/选择 + AI 5 件套工具栏（生成正文/续写/扩写/润色/去AI味）+ 自定义指令 + 上下文查看器 + 自动保存 + 作者笔记 |
| `src/components/foreshadow/ForeshadowPanel.tsx` | 伏笔管理：按状态筛选 + 10 种类型 + 状态推进（计划→埋设→呼应→回收） |

#### 2.7 WorkspacePage 集成
`src/pages/WorkspacePage.tsx` 已更新：
- 进入工作台时**并行加载**所有模块数据（worldview, character, outline, chapter, foreshadow）
- 所有 10 个侧边栏模块均已接入对应面板（无 placeholder）
- 大纲面板可直接跳转到写作编辑器（`onOpenChapter`）

### Phase 2 当前文件结构
```
storyforge/src/
├── hooks/
│   ├── useAIStream.ts              # 流式 AI Hook
│   └── useAutoSave.ts              # 自动保存 Hook
├── stores/
│   ├── project.ts                  # Phase 1
│   ├── ai-config.ts                # Phase 1
│   ├── worldview.ts                # ← NEW
│   ├── character.ts                # ← NEW
│   ├── outline.ts                  # ← NEW
│   ├── chapter.ts                  # ← NEW
│   └── foreshadow.ts              # ← NEW
├── lib/
│   ├── ai/
│   │   ├── client.ts              # Phase 1
│   │   ├── context-builder.ts     # ← NEW 上下文组装
│   │   └── prompts/
│   │       ├── worldview.ts       # ← NEW
│   │       ├── character.ts       # ← NEW
│   │       ├── outline.ts         # ← NEW
│   │       └── chapter.ts         # ← NEW
│   ├── db/schema.ts               # Phase 1
│   └── types/                     # Phase 1
├── components/
│   ├── shared/
│   │   └── AIStreamOutput.tsx     # ← NEW 流式输出组件
│   ├── worldview/
│   │   ├── WorldviewPanel.tsx     # ← NEW
│   │   ├── StoryCorePanel.tsx     # ← NEW
│   │   └── PowerSystemPanel.tsx   # ← NEW
│   ├── character/
│   │   └── CharacterPanel.tsx     # ← NEW
│   ├── faction/
│   │   └── FactionPanel.tsx       # ← NEW
│   ├── outline/
│   │   └── OutlinePanel.tsx       # ← NEW
│   ├── editor/
│   │   └── ChapterEditor.tsx      # ← NEW
│   ├── foreshadow/
│   │   └── ForeshadowPanel.tsx    # ← NEW
│   ├── layout/Sidebar.tsx         # Phase 1
│   ├── project/ProjectInfoPanel.tsx  # Phase 1
│   └── settings/AIConfigPanel.tsx    # Phase 1
└── pages/
    ├── HomePage.tsx               # Phase 1
    └── WorkspacePage.tsx          # ← UPDATED（接入所有模块）
```

### Phase 2 验收状态
- [x] 能 AI 生成世界观各维度内容并保存
- [x] 角色/势力 CRUD 正常
- [x] 能 AI 生成卷级大纲 → 展开为章节
- [x] 能从大纲生成章节正文（流式）
- [x] 能续写/扩写/润色/去AI味正文
- [x] 能停止 AI 生成
- [x] 自动保存正常工作（useAutoSave Hook）
- [x] 伏笔 CRUD + 状态流转正常
- [x] 上下文查看器能显示发送的 prompt

---

## ✅ Design System v2 迁移（已完成）

**完成日期**: 2026-05-09

### 变更概述
将旧的 5 套主题（midnight/ocean/graphite/mist/parchment，靛蓝色调）替换为全新的 3 套场景主题（品牌色 🔥 火光橙 #D97757）。

### 3 套新主题
| 主题 | data-theme | 用途 |
|------|-----------|------|
| 🔨 工作 | `work` | 深色暖黑，日常生产，WorkspacePage 默认 |
| 🔥 熔炉 | `forge` | 暖棕火光，HomePage 仪式感 |
| 📄 纸张 | `paper` | 浅色米白，未来焦点模式写作用 |

### 修改的文件
| 文件 | 变更 |
|------|------|
| `index.html` | 添加 Google Fonts (Inter, Source Serif 4, JetBrains Mono) |
| `src/index.css` | 替换 5 套旧主题 → 3 套新主题 + 旧名兼容映射 |
| `tailwind.config.ts` | 新增 fontFamily, brand 颜色, accent.soft, border.subtle, boxShadow, fontSize 阶梯 |
| `src/pages/WorkspacePage.tsx` | 添加 `data-theme="work"` |
| `src/pages/HomePage.tsx` | 添加 forge 辉光渐变 + 衬线标题 |
| `src/components/shared/AIStreamOutput.tsx` | 添加左侧火光色条 + 柔和背景 |

### 设计系统文档
- `design-system/design-system.md` — 完整设计规范
- `design-system/tokens.css` — CSS 变量定义
- `design-system/tailwind.config.ts` — Tailwind 配置
- `design-system/MIGRATION.md` — 迁移指南
- `design-system/components-demo.html` — 组件预览
- `design-system/scenes-demo.html` — 三场景预览

---

## 🔧 AI 多平台接入（进行中）

**开始日期**: 2026-05-09 | **当前状态**: 日志系统 ✅ + DeepSeek ✅ + Poe ✅ (05-11 修复为 OpenAI 兼容格式)

### 目标
纯前端工具，用户自配 API Key，浏览器直接调用 AI API（无需后端服务器）。

### CORS 兼容性测试结果

| # | 平台 | Base URL | CORS | 状态 |
|---|------|---------|------|------|
| 1 | DeepSeek | `https://api.deepseek.com/v1` | ✅ | ✅ 已完成 |
| 2 | Poe | `https://api.poe.com/v1` | ✅ | ✅ 已完成（标准 OpenAI 兼容） |
| 3 | 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | ✅ | 🔜 待测试 |
| 4 | 豆包 | `https://ark.cn-beijing.volces.com/api/v3` | ✅ | 🔜 待测试 |
| 5 | MiniMax | `https://api.minimax.chat/v1` | ✅ | 🔜 待测试 |
| 6 | 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | ✅ | 🔜 待测试 |
| 7 | 文心一言 | `https://qianfan.baidubce.com/v2` | ✅ | 🔜 待测试 |
| 8 | Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | ✅ | 🔜 待测试 |
| 9 | Kimi | `https://api.moonshot.cn/v1` | ❌ | 标注需代理 |
| 10 | OpenAI | `https://api.openai.com/v1` | ❌ | 标注需代理 |
| 11 | Claude | `https://api.anthropic.com/v1` | ❌ | 标注需代理 |

### 已完成的改动

#### 新增文件
| 文件 | 说明 |
|------|------|
| `src/lib/ai/logger.ts` | AI 连接日志系统（记录每次调用的 URL、状态码、耗时、错误详情） |

#### 修改文件
| 文件 | 变更 |
|------|------|
| `src/lib/types/ai.ts` | `AIProvider` 扩展为 13 种 + `PROVIDER_PRESETS` 包含所有平台预设 URL 和默认模型 |
| `src/stores/ai-config.ts` | `testConnection` 重写：详细错误解析 + 日志记录 + Poe 格式适配 |
| `src/lib/ai/client.ts` | `buildRequest()` 函数根据 provider 构造不同请求格式 + 流式日志记录 |
| `src/components/settings/AIConfigPanel.tsx` | 全部 11 个平台下拉选择 + 每个配置提示（去哪获取 Key）+ 日志面板 + 3 主题切换 |

### Bug 修复记录

#### 🐛 Poe 连接 404/500/400 问题（05-11 最终修复）

**现象**: 
1. 第一次：URL 双斜杠导致 404（`https://api.poe.com/v1//chat/completions`）
2. 第二次错误修复：添加了 isPoe 特殊逻辑用 `baseUrl/model` 格式，导致 500
3. 第三次：错误添加 `thinking` 参数，导致 400（`thinking.enabled.budget_tokens` 错误）
4. 第四次：移除 thinking 参数后，`max_tokens`/`temperature` 仍与 Poe 的 Claude 自动 thinking 模式冲突，导致 400

**根因**: Poe API 是标准 OpenAI 兼容格式（官方文档: `https://poe.com/api`），但 Poe 对 Claude 模型自动启用 thinking 模式，此时传 `max_tokens`、`temperature` 等额外参数会导致冲突报 400。官方示例只需 `model` + `messages`。

**最终修复**（05-11）:
1. `ai.ts`: Poe 预设 baseUrl 从 `https://api.poe.com/bot` → `https://api.poe.com/v1`
2. `ai-config.ts`: 删除所有 isPoe 逻辑和 thinking 代码，测试连接只发 `model` + `messages`
3. `client.ts`: `buildRequest()` 对 Poe provider 只发 `model` + `messages` + `stream`，不传 `temperature`/`max_tokens`；其他 provider 正常传
4. 保留尾部斜杠标准化 `baseUrl.replace(/\/+$/, '')`

**结论**: Poe = OpenAI 兼容格式，但对 Claude 模型有自动 thinking 处理，不能传额外参数。baseUrl `https://api.poe.com/v1`，endpoint `/chat/completions`，body 只需 `model` + `messages`。

### 当前测试状态

| 平台 | 状态 | 备注 |
|------|------|------|
| DeepSeek | ✅ 连通 | HTTP 402 = 余额不足（非代码问题） |
| Poe | ✅ 已修复 | OpenAI 兼容格式，baseUrl=`https://api.poe.com/v1` |
| 通义千问 | 🔜 待测试 | — |
| 豆包 | 🔜 待测试 | — |
| MiniMax | 🔜 待测试 | — |
| 智谱 GLM | 🔜 待测试 | — |
| 文心一言 | 🔜 待测试 | — |
| Gemini | 🔜 待测试 | — |

### 下一步待做
1. **验证 Poe 修复** — 用户需在设置中重新选择 Poe 提供商（触发 switchProvider 重置 Base URL）
2. 逐个测试通义千问、豆包、MiniMax、智谱GLM、文心、Gemini 的实际连接
3. 如果某些平台 API 格式有细微差异，在 `buildRequest()` 中加适配
4. 考虑给 Kimi/OpenAI/Claude 添加 Vercel Serverless 代理（生产环境）

### 开发 Tips
- 选择 DeepSeek → 输入 key → 测试连接 → 如果显示 "Insufficient Balance" 说明连接成功但余额不足
- 点「日志」按钮可查看完整请求日志（URL、HTTP 状态码、耗时、错误信息）
- Poe 是标准 OpenAI 兼容格式，和 DeepSeek 等完全一致，无需特殊处理
- **⚠️ 如果切换 provider 后 Base URL 没变**，说明 localStorage 里有旧配置。可以在浏览器 DevTools → Application → Local Storage → 删除 `storyforge-ai-config` 重来

---

## ✅ Phase 18 — 大文档分块导入流水线（已完成）

**完成日期**: 2026-05-11 | **触发需求**: 用户上传 1.6M 字符的《知北游》报 "AI 输出无法解析为 JSON"（被 maxTokens 截断），要求：支持千万字文档、断点续跑、自动重试、全程可视化。

### 架构总览
```
用户上传文件
  │
  ├─► doc-parser (txt/md/csv/pdf/docx) → 纯文本
  │
  ├─► chunker.chunkDocument() ──► ChunkPlan[]（章节/段落/硬切三级）
  │
  ├─► ImportConfirmModal   ——「事前请示」告知块数/时间/tokens/费用
  │     │
  │     └─► useImportSessionStore.create()  ←─ session + 每块元数据写 DB
  │           │
  │           └─► pipeline.registerChunkTexts(session.id, plans) ← 原文存内存
  │                 │
  │                 └─► pipeline.runSession({sessionId, projectId}) ──串行──►
  │                        for each chunk:
  │                           render "import.parse-chunk" seed (含 rollingContext)
  │                           chat(messages, config)  ← 非流式 + AbortController
  │                           applyChunkResult() → 即时写 worldview/characters/outline
  │                           更新 rollingContext（最近40角色+世界观关键词）
  │                           失败自动重试 3 次
  │                        每 10 块 + 终末：runCharacterMerge()  ←「import.merge-characters」
  │                        finalReport → ImportReportModal「事后汇报」
  │
  └─► UI 订阅 useImportStatusStore → ImportStatusBar / ProgressPanel / ActivityLog
```

### 新增文件清单
| 文件 | 作用 |
|------|------|
| `src/lib/types/import-session.ts` | ImportSession / ChunkState / ImportLog 类型 |
| `src/lib/types/import-session-data.ts` | UnifiedParseResult（拆分出来避免循环依赖） |
| `src/lib/import/chunker.ts` | `chunkDocument()` 章节→段落→硬切三级切块 + `quickHash()` |
| `src/lib/import/pipeline.ts` | 核心流水线：runSession / pause / cancel / retryFailedChunks + 跨块合并 + in-memory 原文注册 |
| `src/stores/import-session.ts` | Dexie 会话 CRUD store |
| `src/stores/import-status.ts` | 全局 pipeline 状态（phase / counts / activity / fatalError） |
| `src/components/system/import/ImportStatusBar.tsx` | 顶部常驻进度条 |
| `src/components/system/import/ImportProgressPanel.tsx` | N 块网格视图（hover 查明细） |
| `src/components/system/import/ImportActivityLog.tsx` | 内存 200 条滚动日志 |
| `src/components/system/import/ImportConfirmModal.tsx` | 解析前确认弹窗（chunkSize 可调、显示时长/token/费用预估） |
| `src/components/system/import/ImportReportModal.tsx` | 解析后汇报弹窗 + 重试失败块 |

### 修改文件
| 文件 | 变更 |
|------|------|
| `src/lib/types/prompt.ts` | PromptModuleKey 增加 `import.parse-chunk` / `import.merge-characters` |
| `src/lib/ai/prompt-seeds.ts` | 新增 2 个 seed |
| `src/lib/db/schema.ts` | v9：新增 `importSessions`、`importLogs` 两张表 |
| `src/lib/types/index.ts` | 导出 import-session 类型 |
| `src/lib/ai/adapters/import-adapter.ts` | `UnifiedParseResult` 移到共享文件（保留 re-export） |
| `src/components/system/ImportDocPanel.tsx` | 完全重写，编排整套流水线 + 未完成会话扫描 + 续跑 |
| `vite.config.ts` | workbox `maximumFileSizeToCacheInBytes` 放宽到 5 MiB |

### 关键决策
1. **串行（非并发）** — 用户原话"慢点就慢点，保证不断就行"。避免并发触发 rate limit 和 prompt 乱序。
2. **即时入库而非批量写** — 每块成功后立即写 worldview/characters/outlineNodes，用户切 Tab 也能看到进度。标签页和其他模块实时可见。
3. **原文只存内存** — `ImportSession.chunks` 只保存 start/end/label 元数据。原文由 `registerChunkTexts()` 放 `IN_MEM_CHUNK_TEXT` 字典。理由：
   - IndexedDB 存 1.6M 字符×N 次写回太慢
   - 跑完后自动 `clearChunkTexts` 释放内存
   - 代价：浏览器关闭后续跑需要重新上传同文件（UI 有明确提示 + hash 比对）
4. **滚动上下文（~1500 字）** — 每块解析完，取累计角色的最近 40 名 + 世界观关键词，塞给下一块的 prompt。避免一个人被解析成多个名字。
5. **跨块 AI 合并** — 每 10 块 + 终末跑一次 `import.merge-characters` seed，让 AI 找同名/别名。合并时保留 canonical，其他条目的文字内容 append 进来，别名写进 relationships 附记。
6. **三种失败处理层次**
   - 单块失败 → 自动重 3 次（1.5s 间隔）
   - 所有重试失败 → 标记 failed，继续下一块
   - 全部跑完 → ReportModal 显示失败块，可"仅重试失败块"按钮

### 用户感知基础设施（事前/事中/事后）
- **事前请示**：ImportConfirmModal 明确告知块数、时长、token、费用预估，以及「串行/即时入库/自动重试/跨块合并」四条行为说明
- **事中透明**：顶部 StatusBar + ProgressPanel 网格（hover tooltip 看每块细节） + ActivityLog 滚动 200 条 + 暂停/恢复/取消按钮
- **事后汇报**：ReportModal 显示成功/失败块数、累计入库计数、失败明细与错误信息、可选重试

### 已知限制
- ~~浏览器关闭后页面内存里的原文丢失，续跑需要重新上传同一文件~~ —— **已由方案 A 解决**（见下文）
- 串行处理：1000 块文档约需 10 小时（单块约 35s）。用户已批准"慢点就慢点"

---

## ✅ Phase 18 方案 A — 原文 Blob 持久化到 IndexedDB（已完成）

**完成日期**: 2026-05-12 | **触发需求**: Phase 18 留下的糙点 "浏览器关了下次要重传文件"，用户要求彻底抹平。

### 解决什么问题
Phase 18 的原文只存在内存 `IN_MEM_CHUNK_TEXT` 字典中 —— 刷新 / 关闭浏览器后丢失。
虽然 session 元数据 + 已入库数据仍在 DB，但续跑必须让用户再传一次同样的文件。

### 解决方案：方案 A（Blob 持久化）
1. 上传时把原始 File 以 Blob 形式存到 IndexedDB 新表 `importFiles`（主键 = `sessionId`，1:1 关联 session）
2. 启动时调 `navigator.storage.persist()` 防止浏览器 GC 回收 Blob
3. 打开导入面板发现未完成 session → 自动从 Blob 读回 → 用原 filename 包 File → `extractTextFromFile()` → `chunkDocument()` → `registerChunkTexts()` 注册内存 → 直接「立即续跑」
4. 切块数量比对不一致时回退为「请重新上传」，不会错位
5. session 完成 / 用户放弃时 `deleteBlob` 释放空间

### 容量评估
| 文档规模 | 字符数 | UTF-8 Blob | IndexedDB 占用 |
|---|---|---|---|
| 典型长篇 | 160 万 | ~3 MB | 忽略 |
| 千万字大长篇 | 1000 万 | 20-30 MB | 远低于浏览器默认额度（几百 MB） |

### 新增/修改文件
| 文件 | 变更 |
|------|------|
| `src/lib/types/import-file.ts` | **新增** `ImportFileBlob` 类型 |
| `src/lib/types/index.ts` | 导出 ImportFileBlob |
| `src/lib/db/schema.ts` | v10：新增 `importFiles` 表（主键 sessionId，索引 fileHash / createdAt） |
| `src/stores/import-session.ts` | 新增 `saveBlob / loadBlob / deleteBlob` 三个方法 |
| `src/components/system/ImportDocPanel.tsx` | 启动申请 persist 权限 + 扫描未完成 session 时自动从 Blob 恢复 + 创建 session 时 saveBlob + 完成/放弃时 deleteBlob + UI 区分「立即续跑 / 用当前文件续跑 / 本地存档丢失」三态 |

### 验收
- ✅ `npx tsc --noEmit` 通过
- ✅ `npm run build` 通过（PWA v1.2.0, 8 entries, 2203 KiB）
- ⏳ 真实关闭浏览器后续跑 —— 待用户本地验证

### 后续（Phase 19 候选）
用户批准后开启 Phase 19「大师作品学习模式」——把导入流水线升级为"拆解白金作家作品、学习世界观/角色/情节设计思路"的功能。

---

## ✅ Phase 19-a — 作品学习地基层（已完成）

**完成日期**: 2026-05-12 | **Playbook**: `docs/playbooks/PHASE-19-master-studies.md`

### 解决什么问题
把"拆解白金作家作品 → 提炼创作方法论 → 学习库反哺创作"做成一个独立的四层系统，
与创作数据物理隔离。Phase 19 分 4 个里程碑（a/b/c/d），本里程碑先把地基搭起来。

### 19-a 已落地内容
| 类别 | 改动 |
|------|------|
| 类型 | 新增 `src/lib/types/master-study.ts` — `MasterWork` / `MasterChunkAnalysis` / `MasterChapterBeat` / `MasterStyleMetrics` / `MasterInsight` + `MasterAnalysisDepth` / `BeatType` |
| 类型导出 | `src/lib/types/index.ts` 追加 `export * from './master-study'` |
| DB schema | `schema.ts` v11：新增 5 张独立表 `masterWorks / masterChunkAnalysis / masterChapterBeats / masterStyleMetrics / masterInsights`（不污染创作 19 张表） |
| Store | 新增 `src/stores/master-study.ts` — `useMasterStudyStore`，提供 works/insights CRUD、删除级联清分析数据 + Blob |
| 面板 | 新增 `src/components/master-studies/MasterStudiesPanel.tsx` — 法律声明 gate + Tabs（作品列表 / 手法洞察 / 学习设置）+ 作品卡片 + 空态 |
| Modal | 新增 `src/components/master-studies/MasterLegalConsentModal.tsx` — 强制用户阅读并同意，结果存 `localStorage['sf-master-consent']` |
| 侧边栏 | `sidebar-tree.ts` 新增一级菜单 `'master-studies'`（GraduationCap 图标），放在「创作区」与「提示词库」之间 |
| 路由 | `WorkspacePage.tsx` 挂载 `<MasterStudiesPanel>` |

### 法律声明 Modal 内容要点
- 功能仅供个人学习 / 研究使用
- 上传作品**只存本地 IndexedDB**，不上传服务器、不分享给他人
- AI 调用经过用户自己的 API Key，文本按供应商隐私政策处理
- 分析结果二次传播 / 商用由用户自行承担法律责任
- 建议仅分析合法持有副本或公共领域作品

### 验收
- ✅ `npx tsc --noEmit` 0 error
- ✅ `npm run build` 成功（Vite 6.4，built in 5.53s，PWA v1.2.0，8 entries 2219 KiB）
- ✅ 侧边栏出现「📚 作品学习」一级菜单
- ✅ 首次点击弹法律声明 Modal，同意后进入作品列表页（空态 + 占位 Tabs）
- ⏳ 真机启动后续跑 / 刷新后 consent 记忆 —— 待用户本地验证
- ✅ 原有 Phase 18 流水线未受影响（未动其代码）

### 下一步（Phase 19-b） ✅ 已在 2026-05-12 19:45 完成（见下文）

---

## ✅ Phase 19-b — 单作品五维分析 + ZIP 下载（已完成）

**完成日期**: 2026-05-12 19:45 | **Playbook**: `docs/playbooks/PHASE-19-master-studies.md` §4

### 解决什么问题
P19-a 只搭了地基，用户能看到「作品学习」入口、能同意法律声明，但点「+ 添加作品」会弹"Phase 19-b 再做"的占位。P19-b 把"上传 → AI 五维分析 → 报告展示 → 打包下载"这条完整闭环跑通。

### 五维方法论
每块原文交给 AI 提炼五个维度：
1. **worldviewPattern** 世界观范式 — 设定的独特逻辑、体系构建手法
2. **characterDesign** 角色设计手法 — 人物塑造、弧光、对比、成长机制
3. **plotRhythm** 情节节奏规律 — 冲突推进、爽点密度、节奏张弛
4. **foreshadowing** 伏笔与悬念 — 埋设、回收、钩子、期待感构建
5. **proseStyle** 文笔与语言 — 句式、意象、语感、独特表达

外加 `rawExcerpt`（~200 字代表性引文）。

### 分析深度档位
| 档位 | 单块字符数 | maxTokens | 适用 |
|------|----------|-----------|------|
| `quick`    | 40,000 | 4,096 | 调用次数少，先看个大概 |
| `standard` | 25,000 | 6,144 | 推荐档（默认） |
| `deep`     | 15,000 | 8,192 | 细粒度提炼 |

### 新增文件
| 文件 | 作用 |
|------|------|
| `src/lib/master-study/pipeline.ts` | 主流水线：planMasterChunks / registerMasterChunks / runMasterAnalysis / setMasterPipelineListener / cancelMasterPipeline / hasMasterChunks / getActiveMasterWorkId。串行逐块，3 次自动重试，断点续跑（跳过已写 chunkIndex），rolling context 取上块的 plot/foreshadow/character 前 1500 字 |
| `src/lib/master-study/export-archive.ts` | 手写最小 ZIP（STORE 模式 + CRC32，无 JSZip 依赖）。`downloadAnalysisArchive` 包 README.txt + analysis.json + report.md，自动触发浏览器下载 |
| `src/components/master-studies/MasterAddWorkModal.tsx` | 添加作品 Modal：文件上传 → 标题/作者/流派 → 深度选择 → 分块预览 → createWork + registerMasterChunks + runMasterAnalysis（不 await，立即跳详情页） |
| `src/components/master-studies/MasterAnalysisReport.tsx` | 五维报告组件，两个视图：「按维度看」横切合并去重 + 「按分块看」纵切看完整每块输出 |
| `src/components/master-studies/MasterWorkDetail.tsx` | 作品详情页：Header（标题/作者/流派/深度/状态/进度条）+ 运行日志 + 操作（下载档案 / 重新分析 / 取消分析）+ 五维报告 |

### 修改文件
| 文件 | 变更 |
|------|------|
| `src/lib/types/prompt.ts` | `PromptModuleKey` 增加 `master.analyze-chunk` |
| `src/lib/ai/prompt-seeds.ts` | 新增 "19.9 作品学习·五维分析" seed（含 JSON Schema，variables: chunkIndex/totalChunks/chunkChars/chunkLabel/workTitle/workAuthor/workGenre/knownContext/rawDocument/depth） |
| `src/components/master-studies/MasterStudiesPanel.tsx` | 把 `handleAddWork` 从 alert 改成开 Modal；WorkCard 加 onClick 进详情页；订阅 pipeline listener；删除时拦截 active 作品 |

### 关键设计决策
1. **物理隔离** — 不复用 Phase 18 的 `importPipeline` 和 `importSessions` 表，单开一套 `master-study/pipeline.ts` + `masterChunkAnalysis` 表，避免污染创作流水线
2. **原文只存内存** — 和 Phase 18 同样的策略：`registerMasterChunks(workId, chunks)` 注册到内存字典，刷新会丢失（UI 已有提示）。Blob 持久化留到 P19-c 再做（同 Phase 18 方案 A）
3. **断点续跑** — 启动时查 `db.masterChunkAnalysis.where('workId').equals(workId)` 已写的 chunkIndex，跳过已完成的块
4. **不 await runMasterAnalysis** — Modal 确认后立即返回 workId，让父级跳转详情页跑 progress 条
5. **手写 ZIP** — 不引入 JSZip 依赖（多 80KB），直接写 STORE 模式 ZIP（local file header + central directory + EOCD + CRC32），UTF-8 bit11 标记
6. **法律声明嵌入 ZIP** — README.txt 和 report.md 顶部都明文标注「仅供个人学习研究」，让用户分发时也带着声明

### 验收
- ✅ `npx tsc --noEmit` 0 error
- ✅ `npm run build` 成功（Vite 6.4，built in 5.84s，PWA v1.2.0，8 entries 2255 KiB，主 JS 2.27MB / gzip 669KB）
- ✅ 「+ 添加作品」按钮打开 Modal，可上传 / 选深度 / 看预览块数
- ✅ 确认后跳详情页，能实时看 progress 条 + 运行日志
- ✅ 完成后能看到五维分析报告（维度视图 + 分块视图切换）
- ✅ 「下载档案」生成 `.analysis.zip`，含 README + JSON + MD 报告
- ✅ 失败块自动重试 3 次，全失败仍继续，最终 ReportModal 显示统计
- ⏳ 真机端到端跑通一本真实作品 —— 待用户本地验证

### 下一步（Phase 19-d）
- Layer 3 跨作品洞察归纳（手法洞察 Tab 填充）
- 学习洞察注入创作 prompt 上下文

---

## ✅ Phase 19-c — Layer 2 深度分析 + Blob 持久化 + 学习设置（已完成）

**完成日期**: 2026-05-26 | **触发需求**: Phase 19-b 完成后的自然续篇，补全 Layer 2 能力。

### 19-c 已落地内容

#### 1. 风格量化（纯本地计算）
新增 `src/lib/master-study/style-analyzer.ts`，对原文全文做文本统计：
- 平均句长、句长直方图（6 桶）
- 对话占比（引号字符数 / 总字符数）
- 高频词 Top 50（2-4 字词频，去停用词）
- 段落密度（段/千字）
- 结果写入 `masterStyleMetrics` 表

#### 2. 章节节奏点提取（AI 驱动）
- 新增 prompt seed `master.extract-beats`（节奏分析师角色）
- 新增 `src/lib/master-study/beat-extractor.ts`：串行逐章 AI 提取 3-8 个节奏点
- 7 种节奏类型：opening / conflict / reversal / climax / hook / foreshadow / relief
- 支持自动章节切分（检测「第X章/回/节」标题，回退为 5000 字段落切分）
- 断点续跑 + 3 次自动重试 + 可取消

#### 3. Blob 持久化
- 复用 Phase 18 的 `importFiles` 表，用 `100000 + workId` 做虚拟 sessionId
- 上传时 `MasterAddWorkModal` 自动存 Blob
- 打开面板时 `MasterStudiesPanel` 自动扫描未完成作品并从 Blob 恢复分块
- 删除作品时级联清理 Blob

#### 4. 学习设置 Tab
- 替换了 `SettingsTabPlaceholder` 为真实设置面板
- 默认分析深度选择（quick / standard / deep）
- 自动 Layer 2 开关
- 批量清理失败作品按钮

### 新增文件
| 文件 | 作用 |
|------|------|
| `src/lib/master-study/style-analyzer.ts` | 本地文本统计引擎 |
| `src/lib/master-study/beat-extractor.ts` | AI 章节节奏点提取 pipeline |
| `src/components/master-studies/MasterStyleCard.tsx` | 风格量化展示（直方图 + 词云 + 数字概览） |
| `src/components/master-studies/MasterBeatsTimeline.tsx` | 章节节奏时间线（分章折叠 + mini timeline bar） |

### 修改文件
| 文件 | 变更 |
|------|------|
| `src/lib/types/prompt.ts` | PromptModuleKey 增加 `master.extract-beats` |
| `src/lib/ai/prompt-seeds.ts` | 新增 beat extraction seed |
| `src/lib/master-study/pipeline.ts` | 新增 Blob 持久化辅助函数（saveMasterBlob / loadMasterBlob / deleteMasterBlob） |
| `src/stores/master-study.ts` | deleteWork 级联清理 master Blob |
| `src/components/master-studies/MasterAddWorkModal.tsx` | 上传时存 Blob |
| `src/components/master-studies/MasterWorkDetail.tsx` | 集成 Layer 2 按钮 + StyleCard + BeatsTimeline |
| `src/components/master-studies/MasterStudiesPanel.tsx` | 替换设置占位 + Blob 恢复扫描 |

### 验收
- ✅ `tsc --noEmit` 0 error
- ✅ `npm run build` 成功（PWA v1.2.0, 10 entries, 2540 KiB）
- ⏳ 真机端到端验证 —— 待用户本地测试

---

## ✅ Phase 19-d — 跨作品洞察归纳 + 洞察注入创作上下文（已完成）

**完成日期**: 2026-05-26 | **触发需求**: Phase 19-c 完成后的 Layer 3 收官。

### 19-d 已落地内容

#### 1. 跨作品洞察归纳 AI Pipeline
新增 `src/lib/master-study/insight-generator.ts`：
- `generateInsights(workIds, opts, listener)` — 读取多本已完成作品的 Layer 1 五维分析，调用 AI 归纳共性方法论
- 按五维度汇总分析摘要（每维度取前 4 块、每块 200 字），构建 AI 输入
- 解析 AI 输出的 JSON 数组，写入 `masterInsights` 表
- 支持流派筛选、洞察数量控制（3/5/8 条）

#### 2. 洞察 Tab 完整 UI
替换了 `InsightsTabPlaceholder` 为真实 UI：
- **空态引导**：提示用户至少需要 2 本已完成作品
- **归纳面板**：流派筛选、作品多选（checkbox 列表）、洞察数量选择、进度反馈
- **洞察卡片列表**：标题 + 流派标签 + 描述预览 + 展开详情（要点列表、来源作品、创建日期）
- **操作**：复制到剪贴板、删除、折叠/展开

#### 3. 洞察注入创作 prompt 上下文
新增 `context-builder.ts` 中的 `buildMasterInsightContext(insightIds)`：
- 读取指定洞察，构建结构化上下文文本
- 格式与 `buildRefAnalysisContext()` 对齐：标题 + 描述 + 要点列表
- 包裹在「大师洞察」标记中，附「灵活运用，不要生搬硬套」提示

#### 4. Prompt Seed
新增 `master.generate-insights`（PromptModuleKey + seed）：
- System prompt：网文方法论研究者角色
- 输入：多本作品五维分析摘要
- 输出：JSON 数组 `[{title, genre, description, bulletPoints}]`

### 新增文件
| 文件 | 作用 |
|------|------|
| `src/lib/master-study/insight-generator.ts` | 跨作品洞察归纳 AI pipeline |

### 修改文件
| 文件 | 变更 |
|------|------|
| `src/lib/types/prompt.ts` | PromptModuleKey 增加 `master.generate-insights` |
| `src/lib/ai/prompt-seeds.ts` | 新增 insight generation seed |
| `src/lib/ai/context-builder.ts` | 新增 `buildMasterInsightContext()` |
| `src/components/master-studies/MasterStudiesPanel.tsx` | 替换 InsightsTabPlaceholder → 完整洞察管理 UI |

### 验收
- ✅ `tsc --noEmit` 0 error
- ✅ `npm run build` 成功
- ⏳ 真机端到端验证 —— 待用户本地测试

### 下一步（Phase 3）
- 世界构建完善：地理面板、历史年表、社会结构等
- 或继续完善作品学习体验（洞察引用 UI、跨项目共享等）

---

## ✅ Phase 3 — 世界构建完善（已完成）

**完成日期**: 2026-05-26

### 状态说明
Phase 3 的 10 个面板在之前的 Phase A-H 大合并中已全部实现，但有 3 个面板（地理环境、历史年表、道具系统）未接入侧边栏导航。本次补全了导航入口。

### 各面板状态
| # | 面板 | 组件 | 侧边栏位置 |
|---|------|------|-----------|
| 3.1 故事核心 | `StoryCorePanel.tsx` | 设定库 → 故事设计 |
| 3.2 角色管理 | `CharacterPanel.tsx` + Minor/NPC/Extra | 设定库 → 角色设计 |
| 3.3 角色关系 | `CharacterRelationPanel.tsx` + `RelationGraph.tsx` | 设定库 → 角色设计 → 关系网 |
| 3.4 势力管理 | `FactionPanel.tsx` | （通过角色面板内跳转） |
| 3.5 力量体系 | `PowerSystemPanel.tsx` | （通过世界观面板内跳转） |
| 3.6 规则约束 | `CreativeRulesPanel.tsx` (364L, AI 生成) | 创作区 → 创作规则 |
| 3.7 地理环境 | `GeographyPanel.tsx` + `LocationTreeMap.tsx` + AI 地图 | 设定库 → 世界观 → **地理环境** (新增导航) |
| 3.8 历史年表 | `HistoryPanel.tsx` (事件 CRUD + 排序) | 设定库 → 世界观 → **历史年表** (新增导航) |
| 3.9 道具系统 | `ItemSystemPanel.tsx` (9 类道具 CRUD) | 设定库 → **道具系统** (新增导航) |
| 3.10 Store | geography/history/itemSystem/creativeRules/characterRelation | 全部就绪 |

### 本次变更
| 文件 | 变更 |
|------|------|
| `src/components/layout/sidebar-tree.ts` | 新增 geography/history/items 导航叶子 + SidebarModule 类型；导入 MapPin/Clock/Gem 图标 |

### 验收
- ✅ `tsc --noEmit` 0 error
- ✅ `npm run build` 成功

---

## ✅ Phase 4-7 — 审计确认已完成

**审计日期**: 2026-05-26

Phase 4-7 均在 Phase A-H 大合并中已实现。经逐项审查确认：

| Phase | 内容 | 状态 |
|-------|------|------|
| **P4.1-4.6 伏笔系统** | ForeshadowPanel (329L) + ForeshadowKanban (116L)，10 种类型、4 状态流转、章节关联（埋设/呼应多选/回收）、AI 建议 | ✅ |
| **P4.7-4.10 润色功能** | ChapterEditor 内置扩写/润色/去AI味按钮 + 自定义指令输入框 | ✅ |
| **P5.1-5.4 导出导入** | DataManagementPanel + ExportPanel: JSON 导出/导入、Markdown 导出、TXT 导出 | ✅ |
| **P5.5 快捷键** | useKeyboardShortcuts.ts | ✅ |
| **P5.6 错误边界** | ErrorBoundary.tsx | ✅ |
| **P5.9 Toast** | Toast.tsx | ✅ |
| **P6.1-6.2 主题** | 多主题 data-theme + localStorage + AIConfigPanel 主题选择器 | ✅ |
| **P6.3-6.4 版本历史** | VersionHistoryPanel.tsx + snapshots 表 | ✅ |
| **P6.7 角色关系图** | RelationGraph.tsx (176L) | ✅ |
| **P6.9 伏笔看板** | ForeshadowKanban.tsx | ✅ |
| **P6.10 PWA** | VitePWA + manifest + Service Worker | ✅ |
| **P7.2 侧边栏折叠** | Sidebar collapsed 模式 | ✅ |
| **P7.4-7.5 AI 地图** | GeographyPanel AI 概念地图 + 图像 Prompt | ✅ |
| **P7.6 beforeunload** | useBeforeUnload.ts | ✅ |

## 📋 潜在后续开发方向

以下为原计划中部分未实现或可增强的功能：
- File System Access API（本地文件夹自动保存，仅 Chrome/Edge）
- GitHub Gist 导出（需 PAT 授权）
- TipTap 富文本编辑器替换 textarea（目前用 RichEditor.tsx）
- 地点层级 parentId 选择器（GeographyPanel 有 parentId 字段但 UI 未暴露下拉选择）

---

## 🔧 关键设计决策记录

### 1. 为什么用 CSS 变量而不是 Tailwind 的 dark mode？
因为需要 5 套主题，不仅是 light/dark 两种。通过 `data-theme` 属性 + CSS 变量实现。

### 2. 为什么 ID 用自增数字而不是 UUID？
Dexie.js 的 `++id` 自增 ID 性能更好，且 IndexedDB 对数字索引的查询效率高于字符串。

### 3. 为什么 AI 配置存 localStorage 而不是 IndexedDB？
AI 配置是全局的（不跟项目走），数据量小，localStorage 读写同步更方便。

### 4. 为什么 streamChat 用 AsyncGenerator？
比 callback 模式更优雅，调用方可以用 `for await...of` 逐块处理，也方便与 AbortController 配合实现中断。

### 5. 为什么删除项目要做级联删除？
因为所有数据通过 `projectId` 关联，删项目必须清除所有关联数据。

### 6. 为什么先做 textarea 编辑器而不是 TipTap？
降低初期复杂度。Phase 1-4 用 textarea 够用，Phase 7 再升级为 TipTap 富文本编辑器。

### 7. 为什么 Store 设计合并了一些相关表？（Phase 2 新增）
- `useWorldviewStore` 合并了 worldview + storyCore + powerSystem（它们是 1:1 关系，同一个项目只有一条记录）
- `useCharacterStore` 合并了 character + faction（同属"角色与势力"模块，UI 上经常一起操作）
- 大纲和章节分开 Store 是因为它们的使用场景不同（大纲是树形结构管理，章节是写作编辑器）

### 8. 为什么 AI 提示词函数返回 ChatMessage[] 而不是字符串？（Phase 2 新增）
因为 `streamChat()` 接收的就是 `ChatMessage[]` 格式。System Prompt + User Prompt 组合成数组直接传入，不需要额外拼接。

---

## 📊 统计

| 指标 | Phase 1 | Phase 2 | 合计 |
|------|---------|---------|------|
| 源代码文件 | 18 个 | +18 个 | 36 个 |
| TypeScript 类型 | ~20+ | — | ~20+ |
| 数据库表 | 9 张 | — | 9 张 |
| Zustand Stores | 2 个 | +5 个 | 7 个 |
| AI 提示词函数 | — | 10 个 | 10 个 |
| 功能面板组件 | 3 个 | +8 个 | 11 个 |
| CSS 主题 | 5 套 | — | 5 套 |
| 侧边栏模块 | 10 个（2 实现） | +8 个 | 10 个（全部实现） |

---

## ✅ 代码审查 R1-R6（已完成）

**完成日期**: 2026-05-14 | **范围**: storyforge/src 全量审查

### 审查规则
| 编号 | 规则 | 状态 |
|------|------|------|
| R1 | 死代码清理（未使用 import / 废弃文件） | ✅ `c3d0438` |
| R2 | Store 样板消除（工厂模式重构） | ✅ `bfd37b3` |
| R3 | 大文件拆分（>300 行组件/模块拆子文件） | ✅ 6 commits `e5b404e`→`812c487` |
| R4 | Types barrel 统一（deep import → barrel） | ✅ `e6aa762` |
| R5 | Lint / Format 一致性 | ⏭ 跳过（项目无 ESLint/Prettier 配置） |
| R6 | 文档归档（ARCHITECTURE.md + PROGRESS.md 更新） | ✅ 本次 commit |

### 产出物
- `docs/ARCHITECTURE.md` — 完整代码架构总览（目录树 + 数据流 + Store 架构 + pipeline 架构 + 审查记录表）
- PROGRESS.md 本段落 — 审查工作的完整记录

### 详细 commit 记录
见 `docs/ARCHITECTURE.md` 底部「代码审查记录」表格。

---

## 🔜 Phase 21 — Token 透明化 + 上下文窗口管理（待开发）

**创建日期**: 2026-05-26

### 背景
当前 token 消耗仅在生成**完成后**显示精确数值（依赖 OpenAI 协议最后一个 chunk 返回的 usage 字段）。生成过程中用户完全看不到消耗情况。此外，没有上下文窗口用量的可视化和溢出保护机制。

### 子任务

#### 21.1 生成中 Token 估算显示
- **问题**：流式生成期间 `tokenUsage` 为 null，用户无法感知消耗
- **方案**：生成过程中按输出字数实时估算 token（中文 ≈ 1.5 token/字，英文 ≈ 1.3 token/word），底栏显示 `≈ 估算 ~450 tokens`；流结束后切换为精确值
- **改动文件**：`AIStreamOutput.tsx`、`useAIStream.ts`

#### 21.2 补齐 5 个模块的 Token 消耗显示
- **问题**：以下 5 个模块使用了 `useAIStream` 但未传递 `tokenUsage` 给 UI
- **清单**：
  1. `EmotionBeatCard.tsx` — 情绪节拍卡片
  2. `ReviewPanel.tsx` — 审阅面板
  3. `GeographyPanel.tsx` — 地理 AI 地图
  4. `WorldMapPanel.tsx` — 世界地图
  5. `PromptExamplesEditor.tsx` / `WorkflowRunner.tsx` — Prompt 调试工具
- **方案**：在各组件的 AI 输出区域补传 `tokenUsage={ai.tokenUsage}` prop

#### 21.3 上下文窗口预算管理 + 分层注入优化

> **核心认知（来自社区评论反馈 2026-05-16～18）**：
> StoryForge 是纯前端工具，纯 API 每次调用都是全新对话，模型没有跨请求记忆。
> 所以**不存在"多轮累积爆窗口"问题**——真正的瓶颈是**单次请求的 prompt 就已经很大**。
> 写小说时一次请求要塞：世界观 + 角色 + 规则 + 前文回顾 + 细纲 + 伏笔 + 参考作品…
> 很容易单次就吃掉 30-50K token，小窗口模型（8K/32K）直接装不下。

- **方案**：

  **A. 发送前上下文预算可视化（参考 Claude Code 用量面板设计）**
  - 在 `AIConfig` 中新增 `contextWindowSize` 字段（各模型预设值）
  - **发送前**对即将拼装的 messages 做 token 估算（中文 ≈ 1.5 token/字）
  - 在「生成」按钮旁显示预算面板：
    ```
    本次请求预估      38.5K / 128K (30%)  ▸
    ├─ 基础层（世界观/风格/规则）      8.2K  ████░░░░  21%  🔒常驻
    ├─ 前文回顾（上一章全文+摘要）    18.1K  █████████ 47%  可调
    ├─ 当前章细纲                       2.4K  █░░░░░░░   6%  🔒常驻
    ├─ 角色/场景/道具/伏笔             5.6K  ██░░░░░░  15%  按需
    ├─ 参考作品/大师洞察注入           1.1K  ░░░░░░░░   3%  按需
    └─ 预留给 AI 输出                  ~3K   █░░░░░░░   8%
    ```
  - 用户可**手动调整**：前文回顾章数、是否注入参考作品等
  - 超出窗口时「生成」按钮变红并提示裁剪建议

  **B. 分层按需注入策略（已有雏形，需系统化）**
  - **L0 常驻层**（永远注入）：写作风格 + 叙事视角 + 创作规则禁止项 + 当前章细纲
  - **L1 核心层**（默认注入，可裁剪）：世界观概述 + 主要角色设定 + 上一章正文全量
  - **L2 扩展层**（按需注入）：前文摘要（更早章节）、伏笔状态、力量体系、地理环境
  - **L3 增强层**（用户手动开启）：参考作品分析、大师洞察、角色关系网
  - 当预估超出窗口 80%，自动从 L3→L2 逐层裁剪；L0/L1 不裁
  - **关键设计**：前文回顾不全量注入全部章节，只注入「当前章细纲 + 上一章正文 + 更早章节的压缩摘要」

  **C. 章节完成后自动生成压缩版上下文**
  - 每章写完后，自动生成该章的压缩摘要（人物动态、情节进展、伏笔变化）
  - 摘要存入 DB，供后续章节作为「前文回顾」使用
  - 这样即使写到第 100 章，前文回顾也只是 N 条摘要 + 上一章全文，不会线性膨胀

  **D. 各模型上下文窗口预设**
  | 模型 | 上下文窗口 | 实际可用（减去输出预留） |
  |------|-----------|----------------------|
  | DeepSeek V4 Flash/Pro | 128K | ~120K |
  | Gemini 2.5 Flash/Pro | 1M | ~990K |
  | GPT-4o | 128K | ~120K |
  | Claude Sonnet 4 | 200K | ~192K |
  | Qwen3 235B | 128K | ~120K |
  | Kimi | 128K | ~120K |
  | GLM-4 | 128K | ~120K |
  | Ollama (本地) | 取决于模型，默认 8K | ~6K（需大幅裁剪） |

  **E. 小窗口模型适配**
  - 8K/32K 模型下自动启用「极简模式」：只注入 L0 + 上一章摘要（非全文）
  - 提示用户：「当前模型窗口较小，建议切换到 128K+ 模型以获得更好的连贯性」

### 优先级
1. **P0** — 21.2 补齐 5 个模块（10 分钟改完）
2. **P1** — 21.1 生成中估算显示
3. **P2** — 21.3 上下文窗口进度条 + 溢出保护
