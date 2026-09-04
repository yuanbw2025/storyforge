# StoryForge 上下文路由

> 版本：2.2.0 · 生效：2026-08-31
> 目标：保持项目级关联理解，同时只读取当前任务需要的现行文档与源码。三注册表和数据红线不因上下文精简而降低。

## 1. 默认入口

普通编码任务只自动加载 `AGENTS.md`。随后先用 `rg`、类型引用、schema、调用方和测试建立关联闭包，再按本文读取片段。不要把文档链接变成全量必读清单。

每个任务先回答：

- 属于哪个产品和总纲章节？世界衍生产品处于三阶段中的哪一阶段，还是独立产品自己的生产/运行阶段？
- 用户入口、上游、下游和可见结果是什么？
- AI 读哪些 `CONTEXT_SOURCES`，写哪些 Field/Adoption？
- 哪些 `PROJECT_TABLES`、owner、版本、导入导出和删除路径受影响？
- 哪些调用方、反例、真实 UI/API 路径会变化？

## 2. 按任务读取

| 任务类型 | 先定位 | 按需读取 | 默认不读 |
|---|---|---|---|
| 局部 UI、交互、样式、明确 Bug | 组件、store/service、调用方、回归 | 命中源码/测试；触及产品边界时读对应 `docs/products/` | 全部产品文档、历史归档 |
| AI 读取、Prompt、上下文预算 | `moduleKey`、Skill `reads`、source key、Context Manifest | `DATA-GOVERNANCE.md` 相关节；`context-sources.ts`、Context Gateway、Prompt 与测试 | 其它领域 Prompt、完整 AI Manual |
| AI 写回、解析、采纳 | Skill `writes`、field/schema/extension、候选和 stale | Field Registry、Adoption、durable run、目标领域仓储与测试 | 无关表与面板 |
| Agent/Harness、恢复、长程一致性 | run/step/attempt、contract、checkpoint、receipt、context/write scope | `HARNESS-QUALITY-STANDARD.md`；命中的 `src/lib/agent`、Gateway、registry、memory/retrieval 与 eval/test | 旧 Harness 蓝图、完成卡、评测流水 |
| schema、迁移、删除、导入导出 | 表、owner、refs、schema 版本、blob | `DATA-GOVERNANCE.md`；`project-tables.ts`、schema、迁移、export、lifecycle 及正反例 | 手写历史表清单 |
| 分步骤长篇或节点 | 具体模块、Skill、领域数据、节点 adapter | `products/LONGFORM-AND-NODE.md`、能力基线相关行、入口→下游闭包 | 上层产品完整实现 |
| 短篇、剧本、漫画 | work/adaptation kind、source manifest、产物 owner | `products/INDEPENDENT-CREATION.md`、对应领域代码和表/Skill | 世界引擎或游戏媒资的无关实现 |
| 世界引擎 | World draft/release、code/version/completeness、source gateway | `products/WORLD-ENGINE.md`、数据治理、world-engine 代码与三注册表 | 上层运行状态、产品媒资实现 |
| 跑团/聊天/AI 小镇/文字游戏 | WorldReference、产品 requirement adapter、Brief/SourcePlan/SourceManifest、production/build/release/session | `products/UPPER-PRODUCTS.md`、目标产品代码、中立世界资源协议和 owner | 其它上层产品内部细节 |
| 新体系或完整产品 | 总纲阶段、稳定 ID、依赖和当前能力状态 | 总纲、对应产品契约、能力基线、路线图与质量标准 | 旧任务名驱动的历史方案 |
| PR、合并、发布、交接 | branch/commit/PR/check 状态 | `COLLAB-WORKFLOW.md` 相关段、diff、验证证据 | 协作历史全文 |
| 并行产品开发 | 产品 ID、共同基线、共享热点、各自 owner | 总纲 §12.1、`COLLAB-WORKFLOW.md` §2.1、产品契约和受影响注册表 | 其它产品内部实现；禁止多分支各改一套共享协议 |
| 历史追溯 | 任务 ID、commit、被删文件名 | `git log` / `git blame`；必要时 WPS 已过时归档 | 把旧文档重新当现行权威 |
| 文档或宪法冲突 | 冲突条款和代码事实 | 总纲、`DOCUMENT-AUTHORITY.md`、CLAUDE 对应节和检查器 | 无关产品材料 |

只有用户明确要求全仓审计、主干整合或总体接手报告时才扩大扫描；仍应先目录、指标、符号和状态，再读取命中片段。

## 3. 定位示例

```bash
# 产品和当前能力
rg -n -C 4 '长篇|节点|世界引擎|TTRPG|漫画' \
  docs/PROJECT-MASTER-CHARTER.md docs/products docs/roadmap/CAPABILITY-BASELINE.md

# 一个 AI 动作的读写闭包
rg -n 'skill-id|moduleKey|sourceKey|targetField' \
  src/lib/agent src/lib/registry src/components tests

# 一个表的完整生命周期
rg -n 'tableName|ownerField|refs' \
  src/lib/registry/project-tables.ts src/lib/db src/lib/export tests

# 历史原因而不是旧文档预载
git log --all --oneline -- path/to/file
git blame -L START,END path/to/file
```

## 4. 功能开工卡

```text
任务 ID / 总纲章节 / 产品：
当前阶段与为什么现在做：
用户目标与明确非范围：
入口 → 上游 → 动作 → 产物 → 下游：
三阶段位置 / 独立产品生产或运行阶段：
输入交接物 → 输出交接物：
世界来源、需求适配器与锁定版本（如适用）：
媒资 owner（如适用）：
读：CONTEXT_SOURCES / Gateway：
写：FIELD_REGISTRY / Adoption / 普通领域写：
表：PROJECT_TABLES / schema / migration：
复用能力与要下线的旧入口：
正例、反例、生命周期、CI、E2E：
```

## 5. 输出与证据卫生

读取长文件先找标题/符号行号，再取必要范围。成功测试只记录命令与数量；失败保留首个根因和附近堆栈。构建产物、覆盖率明细、重复日志和模型完整原文不进入长期文档。

一个功能在同一任务中完成分析、实现、定向测试、review 和交付；切换到无关产品再开新任务。不要为每个文件重开上下文，也不要让无关旧失败长期占据当前任务。

## 6. 自动门

`npm run check:agent-context` 检查：

- `AGENTS.md` 保持短入口并包含三注册表、产品边界、生产数据与 CI 红线；
- 本路由覆盖局部 UI、AI 读写、schema、新体系、PR 和历史追溯；
- 不恢复强制全文读取旧 Blueprint、路线图或协作日志；
- 宪法继续把任务专用内容委托给本路由。
