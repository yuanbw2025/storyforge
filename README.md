# 🔥 StoryForge / 故事熔炉

> **AI 驱动的小说创作工坊** — 从世界观到正文，一站式完成长篇小说创作

[![React](https://img.shields.io/badge/React-18-blue)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-5-purple)](https://vitejs.dev)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## ✨ 产品定位

StoryForge 是一款**纯前端**的 AI 小说创作工具，专为网文作者设计。用户自带 API Key，所有数据存储在浏览器本地（IndexedDB），无需注册、无需后端。

**核心理念**：AI 是副驾驶，作者是掌舵人。

---

## 🎯 核心功能

### 🌍 10 维度世界构建引擎
完整的世界观、角色、势力、力量体系、地理、历史、道具等设定管理，每个维度都支持 AI 一键生成。

### 📖 智能大纲系统
树形结构管理卷/章节大纲，支持 AI 生成整体大纲、展开单卷为章节。

### ✍️ AI 辅助写作
从大纲生成正文、续写、扩写、润色、去 AI 味，5 种 AI 写作模式。

### 🔮 伏笔追踪系统
10 种伏笔模式（契诃夫之枪、草蛇灰线等），完整的埋设→呼应→回收状态管理。

### 👁 上下文透明
每次 AI 调用都可查看完整的 prompt，让创作过程完全可控。

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建 | Vite 5 |
| 状态管理 | Zustand |
| 数据存储 | Dexie.js (IndexedDB) |
| 样式 | TailwindCSS |
| AI 接口 | OpenAI 兼容协议（流式） |
| 路由 | React Router v6 |

---

## 🤖 支持的 AI 提供商

| 提供商 | 推荐模型 | 说明 |
|--------|---------|------|
| DeepSeek | deepseek-chat | ✅ 推荐，性价比高 |
| OpenAI | gpt-4o | 质量好，价格高 |
| 通义千问 | qwen-max | 中文表现好 |
| 豆包 | doubao-pro-32k | 字节跳动 |
| Ollama | qwen2.5:7b | 🆓 本地运行，免费 |
| 自定义 | — | 任何 OpenAI 兼容 API |

---

## 📂 项目结构

```
storyforge/
├── docs/                          # 📚 设计文档
│   ├── 01-PRODUCT-OVERVIEW.md     # 产品概述
│   ├── 02-FEATURE-SPEC.md         # 功能规格
│   ├── 03-UI-DESIGN.md            # UI 设计规范
│   ├── 04-TECH-ARCHITECTURE.md    # 技术架构
│   ├── 05-WORLD-BUILDING-ENGINE.md# 世界构建引擎
│   ├── 06-AI-PROMPTS-SYSTEM.md    # AI 提示词系统
│   ├── 07-DEVELOPMENT-PLAN.md     # 开发计划
│   └── 08-DATA-SCHEMA.md          # 数据模型
├── src/                           # 源代码（开发中）
│   ├── components/                # React 组件
│   ├── hooks/                     # 自定义 Hooks
│   ├── lib/                       # 工具库
│   │   ├── ai/                    # AI 相关
│   │   ├── db/                    # 数据库
│   │   └── types/                 # 类型定义
│   ├── pages/                     # 页面
│   └── stores/                    # Zustand Store
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🚀 开发计划

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | 脚手架 + 基础框架 | 📋 规划中 |
| Phase 2 | AI 写作核心（世界观→大纲→正文） | ⏳ 待开始 |
| Phase 3 | 世界构建完善（角色/势力/力量） | ⏳ 待开始 |
| Phase 4 | 伏笔系统 + 润色功能 | ⏳ 待开始 |
| Phase 5 | 导出 + UX 打磨 | ⏳ 待开始 |
| Phase 6 | 高级功能（PWA/关系图/富文本） | ⏳ 待开始 |

---

## 📖 文档索引

详细设计文档请查看 `docs/` 目录：

1. **[产品概述](docs/01-PRODUCT-OVERVIEW.md)** — 产品定位、目标用户、竞品分析
2. **[功能规格](docs/02-FEATURE-SPEC.md)** — 完整功能列表、优先级分级、交互说明
3. **[UI 设计规范](docs/03-UI-DESIGN.md)** — 色彩体系、组件规范、页面布局
4. **[技术架构](docs/04-TECH-ARCHITECTURE.md)** — 目录结构、状态管理、AI Client
5. **[世界构建引擎](docs/05-WORLD-BUILDING-ENGINE.md)** — 10 维度世界构建系统设计
6. **[AI 提示词系统](docs/06-AI-PROMPTS-SYSTEM.md)** — 9 种角色人设、上下文组装
7. **[开发计划](docs/07-DEVELOPMENT-PLAN.md)** — 6 个 Phase、任务清单、依赖
8. **[数据模型](docs/08-DATA-SCHEMA.md)** — IndexedDB Schema、TypeScript 类型

---

## 📄 License

MIT
