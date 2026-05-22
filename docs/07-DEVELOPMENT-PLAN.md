# StoryForge / 故事熔炉 — 开发计划

> **版本**: v1.0 | **最后更新**: 2026-04-13 | **状态**: 规划中

---

## 1. 开发阶段总览

```
Phase 1 ─── Phase 2 ─── Phase 3 ─── Phase 4 ─── Phase 5 ─── Phase 6
 脚手架      AI写作      世界构建     伏笔系统     打磨优化     高级功能
 +基础框架   +大纲+正文   +角色+势力   +伏笔追踪    +导出+键盘   +PWA+主题
 
 ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 当前
```

---

## 2. Phase 1 — 脚手架 + 基础框架（预计 3-4 天）

### 目标
搭建项目骨架，实现项目 CRUD 和基本布局，AI 配置能跑通。

### 任务清单

| # | 任务 | 详情 | 产出文件 |
|---|------|------|---------|
| 1.1 | 初始化项目 | `npm create vite` + React + TypeScript | `package.json`, `vite.config.ts` |
| 1.2 | 安装依赖 | zustand, dexie, react-router-dom, tailwindcss | `package.json` |
| 1.3 | 配置 Tailwind | 暗色主题 CSS 变量 + Tailwind 配置 | `tailwind.config.ts`, `index.css` |
| 1.4 | 数据库 Schema | Dexie.js 数据库定义 + 所有表 | `src/lib/db/schema.ts` |
| 1.5 | 类型定义 | 所有 TypeScript 接口 | `src/lib/types/*.ts` |
| 1.6 | 路由配置 | Home 页 ↔ Workspace 页 | `src/App.tsx` |
| 1.7 | 首页 | 项目列表 + 创建项目对话框 | `src/pages/HomePage.tsx` |
| 1.8 | 工作台布局 | 三栏布局（侧边栏+主面板+属性面板） | `src/pages/WorkspacePage.tsx` |
| 1.9 | 侧边栏导航 | 13 个模块导航项 | `src/components/layout/Sidebar.tsx` |
| 1.10 | 基本信息面板 | 项目基本信息表单 | `src/components/project/ProjectInfoPanel.tsx` |
| 1.11 | AI 配置面板 | 提供商选择 + Key 输入 + 测试连接 | `src/components/settings/AIConfigPanel.tsx` |
| 1.12 | AI Client | streamChat 流式调用 | `src/lib/ai/client.ts` |
| 1.13 | Project Store | Zustand + IndexedDB 同步 | `src/stores/project.ts` |
| 1.14 | AI Config Store | AI 配置状态管理 | `src/stores/ai-config.ts` |

### 验收标准
- [ ] 能创建/删除项目
- [ ] 工作台三栏布局正常显示
- [ ] 侧边栏可切换模块
- [ ] AI 配置能保存到 localStorage
- [ ] AI 连接测试能通过（至少 DeepSeek）

---

## 3. Phase 2 — AI 写作核心（预计 5-7 天）

### 目标
实现从世界观 → 大纲 → 正文的完整 AI 创作流程。

### 任务清单

| # | 任务 | 详情 | 产出文件 |
|---|------|------|---------|
| 2.1 | 世界观面板 | 世界观各字段编辑 + AI 生成 | `src/components/worldview/WorldviewPanel.tsx` |
| 2.2 | Worldview Store | 世界观状态管理 | `src/stores/worldview.ts` |
| 2.3 | useAIStream Hook | 流式 AI 输出 + 停止 + 错误处理 | `src/hooks/useAIStream.ts` |
| 2.4 | AIStreamOutput 组件 | 流式文字显示 + 操作栏 | `src/components/shared/AIStreamOutput.tsx` |
| 2.5 | System Prompts | 所有 9 个角色人设 | `src/lib/ai/prompts/*.ts` |
| 2.6 | Context Builder | 上下文自动组装器 | `src/lib/ai/context-builder.ts` |
| 2.7 | 大纲树视图 | 树形大纲 + 拖拽排序 | `src/components/outline/OutlineTree.tsx` |
| 2.8 | 大纲 AI 生成 | 卷级生成 + 章节展开 | `src/components/outline/OutlineGenerator.tsx` |
| 2.9 | Outline Store | 大纲状态管理 | `src/stores/outline.ts` |
| 2.10 | 章节编辑器 | textarea 编辑器 + 字数统计 | `src/components/editor/ChapterEditor.tsx` |
| 2.11 | AI 工具栏 | 生成正文/续写按钮 | `src/components/editor/AIToolbar.tsx` |
| 2.12 | Chapter Store | 章节状态管理 | `src/stores/chapter.ts` |
| 2.13 | 上下文查看器 | 显示发给 AI 的完整 prompt | `src/components/editor/ContextViewer.tsx` |
| 2.14 | 自动保存 | debounce 写入 IndexedDB | `src/hooks/useAutoSave.ts` |

### 验收标准
- [ ] 能 AI 生成世界观并保存
- [ ] 能 AI 生成卷级大纲
- [ ] 能展开卷为章节大纲
- [ ] 能从大纲生成章节正文（流式）
- [ ] 能续写正文
- [ ] 能停止 AI 生成
- [ ] 自动保存正常工作
- [ ] 上下文查看器能显示发送的 prompt

---

## 4. Phase 3 — 世界构建完善（预计 4-5 天）

### 目标
补全 10 维度世界构建系统的所有面板。

### 任务清单

| # | 任务 | 详情 |
|---|------|------|
| 3.1 | 故事核心面板 | 主题/冲突/情节模式/故事线编辑 |
| 3.2 | 角色管理 | 角色列表 + 角色编辑器 + AI 生成 |
| 3.3 | 角色关系 | 角色关系列表编辑 |
| 3.4 | 势力管理 | 势力列表 + 势力编辑器 + AI 生成 |
| 3.5 | 力量体系 | 等级列表 + 功法分类 + AI 生成 |
| 3.6 | 规则约束 | 写作风格/红线/一致性约束 |
| 3.7 | 地理环境 | 地点列表（层级） |
| 3.8 | 历史年表 | 事件时间线 |
| 3.9 | 道具系统 | 道具列表 |
| 3.10 | 各模块 Store | character/faction/power-system 等 Store |

### 验收标准
- [ ] 所有 10 个维度面板可编辑
- [ ] 角色/势力/力量体系支持 AI 生成
- [ ] 角色关系可管理
- [ ] 数据自动持久化到 IndexedDB

---

## 5. Phase 4 — 伏笔系统 + 润色功能（预计 3-4 天）

### 目标
实现伏笔追踪管理和文字润色/去AI味功能。

### 任务清单

| # | 任务 | 详情 |
|---|------|------|
| 4.1 | 伏笔列表 | 按状态筛选的伏笔列表 |
| 4.2 | 伏笔创建 | 10 种模式选择 + 创建表单 |
| 4.3 | 伏笔状态流转 | planned → planted → echoed → resolved |
| 4.4 | 伏笔与章节关联 | 埋设/呼应/回收关联到章节 |
| 4.5 | 伏笔 AI 建议 | AI 根据已有剧情建议伏笔 |
| 4.6 | Foreshadow Store | 伏笔状态管理 |
| 4.7 | 扩写功能 | 选中文字 → AI 扩写 |
| 4.8 | 润色功能 | 选中文字 → AI 润色 |
| 4.9 | 去 AI 味 | 选中文字 → AI 去 AI 味 |
| 4.10 | 自定义指令 | 用户输入任意指令 |

### 验收标准
- [ ] 伏笔 CRUD 正常
- [ ] 伏笔状态可流转
- [ ] 扩写/润色/去AI味功能正常
- [ ] 自定义指令可用

---

## 6. Phase 5 — 导出 + 打磨（预计 2-3 天）

### 目标
完善导出功能、快捷键、用户体验细节。

### 任务清单

| # | 任务 | 详情 |
|---|------|------|
| 5.1 | JSON 导出 | 完整项目备份 |
| 5.2 | JSON 导入 | 恢复备份到新项目 |
| 5.3 | Markdown 导出 | 按大纲结构导出正文 |
| 5.4 | TXT 导出 | 纯文本导出 |
| 5.5 | 快捷键 | Cmd+S/Cmd+Enter/Esc 等 |
| 5.6 | 错误边界 | React ErrorBoundary |
| 5.7 | 空状态提示 | 各面板空状态引导 |
| 5.8 | Loading 状态 | 数据加载骨架屏 |
| 5.9 | Toast 通知 | 操作反馈通知 |

### 验收标准
- [ ] 导出/导入 JSON 正常
- [ ] 导出 Markdown/TXT 正常
- [ ] 快捷键可用
- [ ] 整体 UX 流畅

---

## 7. Phase 6 — 主题 + 备份 + 可视化（预计 4-6 天）

### 目标
多主题切换、多层备份机制、地图/关系可视化。

### 任务清单

| # | 任务 | 详情 |
|---|------|------|
| 6.1 | 5 种主题 | data-theme CSS 变量切换（midnight/ocean/graphite/mist/parchment） |
| 6.2 | 主题选择器 UI | 顶栏下拉 + localStorage 保存偏好 |
| 6.3 | 自动定时备份 | 每 5 分钟快照到 IndexedDB snapshots 表 |
| 6.4 | 版本历史面板 | 列出最近 10 个快照，支持回退/对比 |
| 6.5 | File System Access | 绑定本地文件夹自动保存 JSON（Chrome/Edge） |
| 6.6 | GitHub Gist 导出 | PAT 授权 → 创建/更新私密 Gist |
| 6.7 | 角色关系图 | react-force-graph-2d 可视化角色关系网络 |
| 6.8 | 地点关系图 | d3-force 力导向图展示地点层级 |
| 6.9 | 伏笔看板 | 伏笔状态看板视图 |
| 6.10 | PWA | Service Worker + 安装到桌面 |

---

## 8. Phase 7 — 打磨增强（预计 2-3 天）

### 目标
编辑器升级、侧边栏优化、AI 概念地图。

### 任务清单

| # | 任务 | 详情 |
|---|------|------|
| 7.1 | TipTap 编辑器 | 替换 textarea 为富文本编辑器 |
| 7.2 | 侧边栏折叠 | 图标模式侧边栏 |
| 7.3 | 属性面板 | 选中项的详细属性展示 |
| 7.4 | AI 概念地图 | AI 分析地理数据 → SVG 示意地图渲染 |
| 7.5 | AI 图像地图 | 调用图像 AI 生成世界地图图片 |
| 7.6 | beforeunload 提醒 | 未保存时浏览器关闭提醒 |

---

## 8. 依赖清单

### 8.1 核心依赖

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "zustand": "^4.5.0",
    "dexie": "^4.0.0",
    "dexie-react-hooks": "^1.1.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0"
  }
}
```

### 8.2 可选依赖（按需引入）

| 依赖 | 版本 | 用途 | 引入阶段 |
|------|------|------|---------|
| `lucide-react` | ^0.400 | 图标库 | Phase 1 |
| `@dnd-kit/core` | ^6.1 | 拖拽排序（大纲树） | Phase 2 |
| `sonner` | ^1.5 | Toast 通知 | Phase 5 |
| `@tiptap/react` | ^2.6 | 富文本编辑器 | Phase 6 |
| `react-force-graph-2d` | ^1.25 | 角色关系图 | Phase 6 |

---

## 9. 质量标准

### 9.1 代码规范

- TypeScript strict mode
- 组件文件不超过 300 行（超出则拆分）
- 每个 Store 模块独立文件
- 自定义 Hook 提取可复用逻辑
- 所有类型定义在 `lib/types/` 下

### 9.2 命名规范

```
文件命名：
  组件: PascalCase.tsx     → CharacterEditor.tsx
  Store: kebab-case.ts     → ai-config.ts
  类型: kebab-case.ts      → character.ts
  工具: kebab-case.ts      → context-builder.ts

变量命名：
  组件: PascalCase          → CharacterEditor
  Hook: camelCase (use前缀) → useAIStream
  Store: camelCase (use前缀)→ useCharacterStore
  类型: PascalCase          → Character, CharacterRole
  常量: UPPER_SNAKE_CASE    → CHAPTER_SYSTEM_PROMPT
```

### 9.3 Git 提交规范

```
feat: 新功能
fix: 修复
docs: 文档
style: 样式（不影响逻辑）
refactor: 重构
chore: 构建/工具
```

---

## 10. 风险与应对

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|---------|
| CORS 限制导致部分 AI 提供商不可用 | 中 | 中 | 优先支持 DeepSeek + Ollama，提供 CORS 解决方案文档 |
| IndexedDB 大数据量性能 | 低 | 中 | 分页加载 + 索引优化 |
| AI 生成内容质量不稳定 | 高 | 中 | 优化 Prompt + 支持重试/重新生成 |
| 拖拽排序交互复杂度 | 中 | 低 | Phase 2 先用按钮排序，Phase 6 引入 dnd-kit |
| 编辑器功能需求膨胀 | 中 | 中 | Phase 1-4 用 textarea，Phase 6 升级 TipTap |
