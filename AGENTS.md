# AGENTS.md · AI 接手者指南

> 本文件遵循 [agents.md](https://agents.md/) 约定，作为 AI 编码助手（OpenAI Codex / Cursor / Aider 等）进入本仓库时的入口指南。
> Claude Code 用户请优先读 `CLAUDE.md`（内容更完整）。

---

## ⚠️ 第一动作：先读 `CLAUDE.md`

`CLAUDE.md` 是本项目的**宪法**，含：
- 🔒 第一铁律：三个注册表（CONTEXT_SOURCES / FIELD_REGISTRY / PROJECT_TABLES）
- 🚫 动手前的「四问」
- ❌ 反面教材
- 🛑 立刻停下的信号
- 📚 必读文档地图

**任何动手前不得跳过此文件。**

---

## 第二动作：读 `docs/MASTER-BLUEPRINT.md`

唯一的施工权威，含完整的 Phase 0/1/2/3 任务清单 + 三个注册表的数据结构与 API。

---

## 第三动作：找到你被分配的任务

按 MASTER-BLUEPRINT §4 找对应 Phase 的任务 ID（如 `0.1` / `1.2` / `2.7`），严格按「前置 → 改法 → 验证 → 完成判据」执行。

---

## 关键约束（再强调一次）

- **不允许直接 push main**：所有改动走分支，分支名 `refactor/phase-X-task-Y`
- **不允许跳过测试**：每个任务的「验证」步骤必跑
- **不允许散落写代码**：所有 AI 读写必须走注册表（见 CLAUDE.md 四问）
- **不允许"先这样吧"**：含糊任务立刻停下，开 issue 等决策

---

## 项目背景速览

- 纯前端 React + TypeScript + IndexedDB（Dexie）
- ~59000 行 / 282 个源文件 / 45 张表 / 56 个 AI 动作
- 已有真实用户，数据全在浏览器
- 没有 staging 环境，main 即生产

详细规模与漏洞清单见 `docs/MASTER-BLUEPRINT.md` §1。
