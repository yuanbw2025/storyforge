# 🏗 StoryForge 代码架构总览

> **最后更新**: 2026-05-14 · 代码审查 R1-R4 完成后

---

## 目录结构

```
src/
├── App.tsx                     # 路由入口
├── main.tsx                    # ReactDOM 挂载 + BrowserRouter
├── index.css                   # Tailwind + 5 套主题 CSS 变量
│
├── pages/
│   ├── HomePage.tsx            # 项目列表
│   └── WorkspacePage.tsx       # 工作台（模块路由分发）
│
├── components/                 # 按领域拆分
│   ├── character/              # 角色面板（主角/次要/NPC/路人 四种视图）
│   ├── data/                   # 数据管理面板
│   ├── editor/                 # TipTap 富文本编辑器 + 章节列表
│   ├── export/                 # JSON 导出
│   ├── faction/                # 势力
│   ├── foreshadow/             # 伏笔（列表 + 看板）
│   ├── geography/              # 地理环境 + LocationTreeMap
│   ├── history/                # 历史年表
│   ├── items/                  # 道具系统
│   ├── layout/                 # Sidebar + PropertiesPanel + sidebar-tree
│   ├── master-studies/         # 作品学习系统 UI（P19）
│   ├── outline/                # 大纲 + 细纲
│   ├── project/                # 项目信息 + 参考书目
│   ├── relations/              # 角色关系力导图
│   ├── rules/                  # 创作规则
│   ├── settings/               # AI 配置 + 提示词库
│   │   └── prompt/             # 提示词模板编辑器 + 工作流编排
│   │       ├── PromptWorkflowsPanel.tsx
│   │       ├── WorkflowEditor.tsx      # R3.2b 抽出
│   │       ├── WorkflowRunner.tsx       # R3.2c 抽出
│   │       └── workflow-helpers.ts      # R3.2a 抽出
│   ├── shared/                 # 通用 UI 组件
│   │   ├── AIFieldCard.tsx     # AI 字段卡片
│   │   ├── AIStreamOutput.tsx  # 流式输出展示
│   │   ├── ErrorBoundary.tsx
│   │   ├── PlaceholderPanel.tsx
│   │   ├── PromptRunPanel.tsx  # 调参浮窗
│   │   └── Toast.tsx
│   ├── system/                 # 系统级面板
│   │   ├── ImportDocPanel.tsx  # 导入总编排
│   │   ├── VersionHistoryPanel.tsx
│   │   └── import/             # R3.3 拆出的子组件
│   │       ├── ImportUnfinishedBanner.tsx
│   │       └── ImportUploadZone.tsx
│   └── worldview/              # 世界观 7 维度
│
├── hooks/
│   ├── useAIStream.ts          # 流式 AI 输出（所有 AI 模块复用）
│   ├── useAutoBackup.ts        # R1 清理后的自动备份
│   ├── useAutoSave.ts          # debounce 保存
│   ├── useBeforeUnload.ts      # 离开前提示
│   ├── useFileSystemAccess.ts  # File System Access API
│   └── useKeyboardShortcuts.ts # 全局快捷键
│
├── stores/                     # Zustand stores
│   ├── _factories.ts           # R2.1 通用 store 工厂（createCrudStore / createSingletonStore）
│   ├── project-singletons.ts   # R2.1 8 个 1:1 store 实例（worldview/storyCore/…）
│   ├── project.ts              # 项目列表 CRUD
│   ├── ai-config.ts            # AI 配置（localStorage 持久化）
│   ├── character.ts / character-relation.ts / chapter.ts
│   ├── outline.ts / detailed-outline.ts / foreshadow.ts
│   ├── prompt.ts / workflow.ts / reference.ts / backup.ts
│   ├── import-session.ts       # 导入会话 CRUD + Blob 管理
│   ├── import-status.ts        # 导入 pipeline 实时状态
│   ├── master-study.ts         # 作品学习 store
│   └── worldview.ts            # 世界观（合并 worldview + storyCore + powerSystem）
│
├── lib/
│   ├── doc-parser.ts           # txt/md/csv/pdf/docx 解析
│   │
│   ├── ai/                     # AI 层
│   │   ├── client.ts           # streamChat() + chat()，OpenAI-compatible
│   │   ├── context-builder.ts  # 上下文组装器
│   │   ├── logger.ts           # AI 调用日志
│   │   ├── prompt-engine.ts    # 模板渲染引擎（{{var}} / {{#if}}）
│   │   ├── prompt-preview-vars.ts  # 预览用样例变量
│   │   ├── prompt-seeds.ts     # 43 条内置提示词模板
│   │   ├── prompt-seeds-genre-packs.ts  # 4 套题材包
│   │   ├── workflow-seeds.ts   # 3 条内置工作流
│   │   └── adapters/           # AI 响应适配器
│   │       └── import-adapter.ts
│   │
│   ├── db/
│   │   ├── schema.ts           # Dexie.js DB 定义（v11，24 张表）
│   │   └── ensure-schema.ts    # 首次启动 seed
│   │
│   ├── data/
│   │   └── genre-presets.ts    # 77 条流派标签
│   │
│   ├── export/
│   │   ├── json-export.ts      # 全项目 JSON 导出
│   │   ├── text-export.ts      # TXT/MD 导出
│   │   └── gist-export.ts      # GitHub Gist 导出
│   │
│   ├── import/                 # 大文档分块导入（P18）
│   │   ├── pipeline.ts         # 总控流（runSession / pause / cancel）
│   │   ├── chunker.ts          # 三级切块（章节→段落→硬切）
│   │   ├── chunk-text-registry.ts  # R3.4a 抽出：内存原文缓存
│   │   ├── unified-merge.ts        # R3.4a 抽出：纯函数合并/规范化/报告
│   │   ├── chunk-writer.ts         # R3.4b 抽出：单块落库
│   │   ├── chat-with-abort.ts      # R3.4c 抽出：AbortSignal chat
│   │   └── character-merge.ts      # R3.4c 抽出：AI 跨块角色合并
│   │
│   ├── master-study/           # 作品学习流水线（P19）
│   │   ├── pipeline.ts         # 五维分析流水线
│   │   └── export-archive.ts   # ZIP 打包下载（手写 STORE 模式）
│   │
│   ├── types/                  # 所有 TypeScript 类型
│   │   ├── index.ts            # ★ Barrel export（22 个模块）
│   │   ├── ai.ts / project.ts / worldview.ts / character.ts
│   │   ├── outline.ts / foreshadow.ts / geography.ts / history.ts
│   │   ├── item-system.ts / creative-rules.ts / character-relation.ts
│   │   ├── snapshot.ts / reference.ts / reference-work.ts
│   │   ├── prompt.ts / workflow.ts / detailed-outline.ts
│   │   ├── import-job.ts / import-session.ts / import-session-data.ts
│   │   ├── import-file.ts
│   │   └── master-study.ts
│   │
│   └── utils/                  # 通用工具函数
│
└── vite-env.d.ts
```

---

## 数据流

```
用户操作 → React Component → Zustand Store → Dexie.js (IndexedDB)
                                  ↕
                          AI Client (chat / streamChat)
                                  ↕
                         外部 AI API（用户自配 Key）
```

**核心原则**：
- **纯前端**，无后端服务器。AI 请求从浏览器直接发到用户配置的 API endpoint
- **所有数据存本地** IndexedDB，通过 `dexie` 操作
- **状态管理** 统一用 Zustand，每个领域一个 store

---

## Store 架构（R2 重构后）

### 工厂模式（`_factories.ts`）
```ts
createCrudStore<T>({ table, loadFilter, defaults })  // 通用 CRUD
createSingletonStore<T>({ table, defaults })          // 1:1 记录
```

### 8 个 singleton store（`project-singletons.ts`）
通过工厂消除重复样板：worldview / storyCore / powerSystem / geography / history / itemSystem / creativeRules / faction

### 独立 store
项目级：project / character / outline / chapter / foreshadow / detailed-outline / character-relation / reference / backup
全局级：ai-config / prompt / workflow / import-session / import-status / master-study

---

## 导入 pipeline 架构（R3 重构后）

```
pipeline.ts         ← 总控流（runSession / pause / cancel）
    ├── chunker.ts              ← 切块算法
    ├── chunk-text-registry.ts  ← 内存原文缓存
    ├── chat-with-abort.ts      ← AbortSignal 包装的 chat
    ├── chunk-writer.ts         ← 单块解析结果写 DB
    ├── unified-merge.ts        ← 累积结果合并 + 报告生成（纯函数）
    └── character-merge.ts      ← AI 跨块角色去重
```

**设计要点**：
- pipeline.ts 只负责流程控制（遍历 chunk / 重试 / 暂停 / 合并触发）
- 子模块各司其职、可独立测试
- character-merge 通过参数注入 `signal` / `isPaused`，不耦合 pipeline 的模块级变量

---

## Types Barrel（R4 重构后）

所有 type 文件在 `src/lib/types/` 下，通过 `index.ts` 统一导出。

**规则**：外部模块一律 `import type { Xxx } from '../types'`，**不要** deep import `from '../types/xxx'`。

---

## 代码审查记录

| 阶段 | Commit | 内容 |
|------|--------|------|
| R1 | `c3d0438` | 死代码清理：删除未使用的 imports、废弃 backup/ 目录 |
| R2.1 | `bfd37b3` | Store 工厂：`_factories.ts` + `project-singletons.ts`，消除 8 个 store 重复样板 |
| R3.2a | `e5b404e` | 从 PromptWorkflowsPanel 抽出 `workflow-helpers.ts` |
| R3.2b | `ba910dc` | 拆分 `WorkflowEditor.tsx` |
| R3.2c | `70f8605` | 拆分 `WorkflowRunner.tsx` |
| R3.3 | `365c1fd` | ImportDocPanel → `ImportUnfinishedBanner` + `ImportUploadZone` |
| R3.4a | `638e5ab` | pipeline 抽出 `chunk-text-registry.ts` + `unified-merge.ts` |
| R3.4b | `aa7a5ab` | pipeline 抽出 `chunk-writer.ts` |
| R3.4c | `812c487` | pipeline 抽出 `chat-with-abort.ts` + `character-merge.ts` |
| R4 | `e6aa762` | Types 聚合：10 个文件的 deep import → barrel import |
