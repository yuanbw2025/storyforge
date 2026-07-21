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

## 🤝 协作契约（Codex 请优先过目并确认）

本仓库当前是 **Codex 开发 / Claude 审查** 的双 Agent 模式。分工、分支纪律、工作区隔离、合并流程见：

**[`docs/COLLAB-WORKFLOW.md`](docs/COLLAB-WORKFLOW.md)** —— Claude 已草拟，**请 Codex 过一遍并在该文件 §7「待确认」处打勾 / 提修改**，双方确定后生效。

要点速览：① 各用各的 checkout，别挤一个工作树；② 交接走「分支 + PR + commit message」，不用散文档传代码；③ 合 `main` 串行 + 合前 rebase + 六项验证闸门全绿；④ `main` 一推即生产（无 staging）。

---

## 第二动作：读 `docs/MASTER-BLUEPRINT.md`

唯一的施工权威，含完整的 Phase 0/1/2/3 任务清单 + 三个注册表的数据结构与 API。

---

## 第三动作：读路线图与当前能力基线

先读 [`docs/roadmap/README.md`](docs/roadmap/README.md)，确认任务的唯一功能体系归属；再读 [`docs/roadmap/CAPABILITY-BASELINE.md`](docs/roadmap/CAPABILITY-BASELINE.md)，确认已有代码、注册表和测试，禁止重复开发。

若任务属于 MASTER-BLUEPRINT Phase 0/1/2/3，再按对应任务 ID（如 `0.1` / `1.2` / `2.7`）严格执行「前置 → 改法 → 验证 → 完成判据」。历史背景按原任务 ID 查 [`docs/ROADMAP-LEGACY.md`](docs/ROADMAP-LEGACY.md)，不要把历史快照当作当前 backlog。

---

## 关键约束（再强调一次）

- **不允许直接 push main**：所有改动走分支，分支名 `refactor/phase-X-task-Y`
- **不允许跳过测试**：每个任务的「验证」步骤必跑
- **不允许散落写代码**：所有 AI 读写必须走注册表（见 CLAUDE.md 四问）
- **不允许"先这样吧"**：含糊任务立刻停下，开 issue 等决策

---

## 项目背景速览

- 纯前端 React + TypeScript + IndexedDB（Dexie）
- 约 56k 行 / 275+ 源文件 / 39 required tables；具体规模以当前仓库扫描、`schema.ts`、`REQUIRED_TABLES`、`PROJECT_TABLES` 和生成版 AI manual 为准
- 已有真实用户，数据全在浏览器
- 没有 staging 环境，main 即生产

详细规模与漏洞清单见 `docs/MASTER-BLUEPRINT.md` §1。
