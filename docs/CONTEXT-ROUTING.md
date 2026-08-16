# StoryForge 上下文路由

> 目标：保留工程级全局理解，同时避免每个任务重复注入与当前变更无关的长文档和源码。
> 本文只规定“何时读什么”；三注册表、数据红线和完成定义以 `AGENTS.md` / `CLAUDE.md`
> 为准，不因节省输入而降低。

## 1. 默认上下文

编码 Agent 默认只自动加载根目录 `AGENTS.md`。开始任务后先用 `rg`、类型引用和测试建立
关联闭包，再按下表增量读取。不要把所有链接当作新的必读清单。

每个任务都应能回答：

- 用户入口和当前行为在哪里？
- 读取经过哪个 `CONTEXT_SOURCES` 源，写回经过哪个 field/schema？
- 涉及哪些 `PROJECT_TABLES` 生命周期和外键/作用域？
- 哪些调用方、回归测试和真实用户路径会受影响？

这四项是“项目级理解”的边界，不是“把全仓库放进上下文”的理由。

## 2. 按任务读取

| 任务类型 | 先定位 | 按需读取 | 默认不读 |
|---|---|---|---|
| 局部 UI、交互、样式、明确 Bug | 组件、store/service、调用方、现有回归 | 相关源码与测试的命中片段；触及数据时再转数据路线 | Blueprint、完整路线图、协作日志 |
| AI 读取、Prompt、上下文预算 | `moduleKey`、`reads`、`CONTEXT_SOURCES`、adapter/runner | `context-sources.ts`、`assemble-context.ts`、对应 Prompt/AI Manual 行与测试 | 其它领域 Prompt、整份 AI Manual |
| AI 写回、解析、采纳 | `writes`、field key、schema key、adopt 调用方 | `field-registry.ts`、`adoption-schema.ts`、`adopt.ts`、对应 parser/use-case/test | 无关表、无关面板 |
| Agent Harness、创作可靠性、长运行恢复、完成验证 | run/step/attempt、`completed` 来源、context/write scope、checkpoint/receipt、产物级调用停止与质量分级 | 先读 `AI-HARNESS-REBUILD-RELEASE-20260817.md` 当前总览；实现任务再按命中范围读取 Harness/CREL 设计、Runner、orchestrator、GenerationNode、三注册表和 simulation runtime 对应片段 | 未命中的外部研究、完整 Blueprint、其它阶段实施细节 |
| schema、迁移、删除、合并、导入导出 | 表名、owner、refs、world scope、迁移版本 | `project-tables.ts`、`schema.ts`、相关 lifecycle 实现、迁移/往返/删除测试；Blueprint 对应数据段 | 其它 Phase、历史完成流水 |
| 新体系或完整功能 | 稳定 ID、唯一归属、前置依赖 | 路线图中对应体系、能力基线同名章节、关联设计文档；若有 Blueprint ID，仅读该 ID 的“前置/改法/验证/完成判据” | 路线图其它体系、完整 Blueprint |
| PR、合并、发布、跨模型交接 | branch/commit/PR/check 状态 | `COLLAB-WORKFLOW.md` 相关流程、PR diff、受影响测试 | 全部协作日志 |
| 历史追溯、来源审计 | 任务 ID、commit、文件名 | `git log` / `git blame` / `rg` 命中；必要时读 `ROADMAP-LEGACY.md` 或 `COLLAB-LOG.md` 邻近片段 | 历史文档全文 |
| 宪法冲突或新增架构规则 | 冲突的注册表/红线条款 | `CLAUDE.md` 对应章节、架构检查器和当前代码证据 | 与冲突无关的设计文档 |

只有用户明确要求仓库全量审计、来源鉴定或总体接手报告时，才扩大到跨体系扫描；即便如此，
也应先目录/符号/指标后片段，避免先把大文件全文放入对话。

## 3. 定位示例

```bash
# 找任务在当前路线图中的唯一归属
rg -n -C 4 'CANON-1|CONSISTENCY-2' docs/roadmap

# 找 Blueprint 中某任务的标题，再读取该标题到下一同级标题之间
rg -n '^#{2,4} .*2\\.7|^#{2,4} .*INVENTORY-1' docs/MASTER-BLUEPRINT.md

# 建立一个字段/表/上下文源的代码关联闭包
rg -n 'characterId|itemLedger|CONTEXT_SOURCES|FIELD_REGISTRY|PROJECT_TABLES' src tests

# 追踪历史证据，不预载完整日志
rg -n -C 6 '任务 ID|分支名|commit SHA' docs/COLLAB-LOG.md docs/ROADMAP-LEGACY.md
```

读取长文件时先确定行号，再取相邻必要范围；测试输出成功时只记录命令和通过数量，失败时
保留首个根因与必要堆栈。构建产物、覆盖率明细和重复日志不进入长期任务上下文。

## 4. 一个完整功能的上下文包

一个功能保持在同一任务中完成“分析 → 实现 → 测试 → review”，避免每个文件重开任务。
切换到无关体系时再开新任务，避免旧失败路径长期累积。

开工卡使用以下最小结构：

```text
任务 ID / 用户故事：
唯一归属与非范围：
入口与受影响调用方：
读：CONTEXT_SOURCES / 普通读取
写：FIELD_REGISTRY / AdoptionSchema / 普通写入
表：PROJECT_TABLES / schema / 迁移判断
复用能力与要下线的旧入口：
定向测试、完整闸门、真实项目验证：
```

## 5. 可测门槛

`npm run check:agent-context` 会：

- 限制自动入口体积，防止把任务专用长文档重新塞回 `AGENTS.md`。
- 检查三注册表、生产数据、分支与验证红线没有因瘦身丢失。
- 拒绝恢复“所有任务全文阅读 Blueprint/路线图/协作历史”的指令。
- 检查本路由仍覆盖 UI、AI 读写、数据生命周期、路线图、PR 和历史追溯。

2026-07-25 治理前，入口链强制读取 6 份文档，共 2,979 行、166,002 bytes。治理后的固定输入
只有 `AGENTS.md`；检查器会输出当前大小和相对基线降幅。实际 API/Agent token 仍受系统指令、
对话历史和工具实现影响，因此以“固定项目输入下降”表述，不把该数字冒充完整账单节省。
