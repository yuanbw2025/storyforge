# StoryForge 分支整合证据台账

> 建立日期：2026-08-25<br>
> 基准：`origin/main@b9b9c62b`<br>
> 状态：完成；整合、权威重建、验证、推送与引用清理均已闭环

## 1. 目的与原则

本台账证明本次主干统一不是“保留看起来最新的分支”，而是逐项检查本地分支、远程分支、工作树、未提交改动和开放 PR 的独有内容，再通过普通提交与合并整合。

执行约束：

- 不使用强制推送、硬重置、clean 或先删除后补救。
- 未提交工作先扫描敏感信息、异常体积和生成物，再形成可恢复提交。
- 分支存在不等于有独有内容；已经成为 `origin/main` 祖先的分支只需记录覆盖证据。
- PR 冲突或 CI 失败不等于内容无效；先查明原因，再合并或把功能按现行契约移植。
- 只有当最终主干能证明覆盖独有提交或等价内容并通过验证后，才删除源分支和工作树。

## 2. 仓库现场保护

本次审计开始时共有六个工作树。除 `feat/ttrpg-game-platform` 外均为干净状态。

`feat/ttrpg-game-platform` 最初包含：

- 84 个已修改文件；
- 323 个未跟踪文件；
- 已跟踪差异约 28,199 行新增、6,922 行删除；
- 连同未跟踪文件固化后，共 407 个文件、145,931 行新增、6,922 行删除。

敏感值扫描只命中普通 URL 和 `task-cancelled` 状态字符串的模式误报，没有发现真实 API Key、私钥或 GitHub Token。未跟踪文件最大约 460 KiB，没有发现异常大文件、嵌套仓库或子模块。

全部现场内容已经以提交 `54621c2c` 固化在 `feat/ttrpg-game-platform`。提交说明明确表示这是整合前的完整保护点，并不宣告全部商业、社区或在线能力已经达到产品完成标准。该保护点通过：

- `check:architecture`；
- `check:required-tables`，107 张表；
- `check:ai-manual`；
- `tsc --noEmit`；
- `git diff --check`。

## 3. 本地分支与工作树

“主干独有 / 分支独有”使用 `git rev-list --left-right --count origin/main...<ref>` 计算。

| 分支 | 审计时 HEAD | 主干独有 | 分支独有 | 现场结论 | 处理要求 |
|---|---:|---:|---:|---|---|
| `main` | `2c9ad713` | 6 | 0 | 本地引用落后，内容已被远程主干覆盖 | 最终快进到统一主干 |
| `feat/game-production-pipeline-design` | `2c9ad713` | 6 | 0 | 无独有提交 | 记录祖先覆盖后删除 |
| `refactor/product-flow-governance` | `8dc6fa7b` | 3 | 0 | 已是 `origin/main` 祖先 | 记录祖先覆盖后删除 |
| `fix/dexie-premature-commit` | `42e97f9c` | 1 | 2 | 有独立数据库事务修复和反例测试 | 合并并修复已知文档指标门 |
| `feat/short-screenplay-comic` | `a3ded2ae` | 6 | 8 | 有短篇、剧本、漫画、媒资治理和对齐审计 | 合并，按新总纲解决产品边界冲突 |
| `refactor/world-engine-harness` | `60acab18` | 6 | 61 | 有 Phase 0A 至 Phase 5 的长篇/Harness 主体成果 | 作为核心底座优先合并，纠正世界引擎命名与回写规则偏差 |
| `feat/ttrpg-game-platform` | `54621c2c` | 6 | 1 | 一个巨大保护提交，包含上层产品、媒资、在线、社区和商业化成果 | 完整保留并合并；生产可用性与发展顺序另行审计，不虚报完成 |
| `refactor/project-document-authority` | `345aebe8` | 0 | 1 | 新项目总纲 | 当前整合分支，作为全部裁决依据 |

干净分支的基础门禁复核：

- `fix/dexie-premature-commit`：架构、82 张表、AI 手册、TypeScript 通过。
- `feat/short-screenplay-comic`：架构、90 张表、AI 手册、TypeScript 通过。
- `refactor/world-engine-harness`：架构、83 张表、AI 手册、TypeScript 通过；分支自带 Phase 5 完整验收报告，最终仍以整合后重跑为准。

## 4. 远程分支

`git ls-remote --heads origin` 确认远程只有：

| 远程分支 | HEAD | 状态 |
|---|---:|---|
| `origin/main` | `b9b9c62b` | 整合基准 |
| `origin/fix/dexie-premature-commit` | `42e97f9c` | 与 PR #75 相同，待合并 |
| `origin/readme-assets` | `3ac67dad` | 自动更新历史；相对主干的最终内容差异仅为 `storyforge-star-history.svg` |

`readme-assets` 与主干从较早提交分叉，包含 111 个重复更新同一 SVG 的自动提交；最终必须保留最新 SVG 内容和可追溯整合记录，不把“提交数量”误当成 111 项独立产品功能。

## 5. 开放 PR

### PR #75 · Dexie PrematureCommitError

- URL：<https://github.com/yuanbw2025/storyforge/pull/75>
- HEAD：`42e97f9c`，与本地及远程修复分支相同。
- GitHub 判定可合并，但 CI 为红色。
- 失败原因已经从 Actions 日志确认：`check:project-metrics` 检测到旧 `MASTER-BLUEPRINT` 实时规模数字漂移；不是修复实现或回归测试失败。
- 独有内容：批量作用域查询，避免 Dexie 事务在最终写入前变空闲；包含长对话、复杂世界集合和 167→168 事件账本导入往返反例。

结论：必须整合，并在新文档体系中移除对过时 Blueprint 实时数字的错误发布耦合。

### PR #60 · 长篇编辑与大纲改进

- URL：<https://github.com/yuanbw2025/storyforge/pull/60>
- HEAD：`e1780923`；相对现行主干为主干独有 28、PR 独有 4。
- GitHub 判定存在冲突，PR 未提供当前 CI 绿灯，也未完成三注册表等自检勾选。
- 独有功能包括：全局替换、设定查询、三层协调视图、计划与正文对账、伏笔处理、分块大纲生成、章节审查、首页字数汇总。
- 其中 42 个文件约 7,350 行新增、148 行删除；含一个应归档而非作为产品源码的 `docs/pseudocode.py`。

结论：这些能力与独立长篇产品直接相关，不能因 PR 陈旧或冲突而丢弃。整合时必须保留用户价值，同时把旧直连、旧上下文清单、旧状态写入和重复功能改到当前 Harness 与三注册表契约；无法直接沿用的原始实现进入历史归档并在等价移植清单中逐项勾销。

## 6. 实际整合顺序与覆盖证据

全部来源均通过普通双亲 merge 保留原始提交身份；没有使用 squash、cherry-pick 替代整支覆盖、强推或历史改写。

| 顺序 | 整合提交 | 第二父提交 | 被保留内容 |
|---:|---|---|---|
| 1 | `ffd67963` | `60acab18` | Phase 0A～Phase 5 独立长篇、Harness、渐进式上下文与百万字规模门 |
| 2 | `050450da` | `42e97f9c` | Dexie `PrematureCommitError` 修复与 167→168 事件账本反例 |
| 3 | `4ec32a57` | `a3ded2ae` | 独立短篇、小说转剧本、小说转漫画及其独立生产边界 |
| 4 | `da43297e` | `e1780923` | PR #60 全局替换、设定查询、协调视图、大纲与章节改进 |
| 5 | `2df5fd32` | `54621c2c` | 跑团、角色互动、文字游戏、媒资生产、在线与平台保护点 |
| 6 | `5a85c6ee` | `1b9277e7` | 审计期间远程 `main` 新增的流量归档 |
| 7 | `5679dada` | `53d134b1` | `readme-assets` 最新状态与完整历史 |

对上述七个第二父提交逐一执行 `git merge-base --is-ancestor <source> HEAD`，结果全部为真。由此证明最终主干包含每个已知领先来源，而不是仅保留人工挑选的文件快照。

最新星标历史资产先以 `5679dada` 进入可追溯历史；新 README 不再展示该资产后，仓库随后正式退役 SVG、生成脚本和每 15 分钟自动建分支的工作流。GitHub 上 `Refresh README star history` 已先设为 `disabled_manually`，因此清理远程 `readme-assets` 后不会被定时任务重新创建。

## 7. 文档权威重建与 WPS 归档

- 新总纲：`docs/PROJECT-MASTER-CHARTER.md`，提交 `345aebe8`。
- 分支证据基线：本台账，提交 `e2abc188`。
- 新权威体系：AGENTS、开发宪法、文档权威、架构、三注册表治理、Harness/工程质量、产品边界、路线图和协作流程共 26 份受治理文档。
- 纠偏报告：`docs/audits/PROJECT-CHARTER-ALIGNMENT-AUDIT-20260826.md`。初版曾记录 14 项 `ALIGN-01`～`ALIGN-14`；2026-08-27 的 2.0.0 复审把它们重新裁决为 7 项项目级架构偏差，并将具体产品完成度与质量认证转交相应路线图。
- 401 个旧文档、历史报告和过期素材已从现行文档库移除；删除前已形成可恢复 Git 提交，并完成 WPS 上传与回读哈希核验。

WPS 归档位置：`storyforge故事熔炉 / 已过时-v3.9.1-2026-08-26`。

| 归档物 | WPS 链接 | 校验 |
|---|---|---|
| 完整 ZIP（395 项，10,853,452 bytes） | <https://www.kdocs.cn/l/chgdLLD82FoA> | SHA-1 `1a52bbd356058d0a68f8f6b5d064839ecdb8345e`；SHA-256 `80992125d26a4692b1a01537c568fd4a7f7ea90bf8acce57ee546a9ce12710ae` |
| 归档清单 | <https://www.kdocs.cn/l/cidJLBJJTi03> | 与 ZIP 内容清单配套 |
| 归档文件夹 | <https://www.kdocs.cn/mine/556058861849> | 文件夹 ID `sZXj6nTUP1Mqxu4GTZCp1xg9D3awu13zr` |

云端重新下载 ZIP 后计算的哈希与本地归档完全一致，之后才执行仓库文档删除。

## 8. 最终验证证据

最终代码与文档状态通过：

- `npm run ci`：585/585 测试文件、2728/2728 测试；覆盖率 statements/lines `84.82%`、branches `73.04%`、functions `81.12%`；生产依赖 0 个已知漏洞。
- `npm run ci:e2e`：62 passed、5 skipped、0 failed，使用冻结隔离工作区和单 worker，没有操作作者浏览器数据。
- 四条原始失败路径（项目删除、取消删除、多世界详情扩写、多世界建议刷新）定向复跑 4/4 通过；最终整套 E2E 也通过。
- 安全对话框根因已修复：局部 Provider 不再在卸载时清除根级安全适配器，注册清理由所有者作用域控制。
- `check:required-tables`：schema 与 `PROJECT_TABLES` 均为 115 张表。
- `check:ai-entry-registry`：39 个 binding / 43 个调用全部登记。
- `check:source-reachability`：993 个生产源码文件全部可达。
- `check:architecture`、`check:docs`、`check:roadmap`、AI 手册、Lint、TypeScript、生产构建全部通过。
- `check:bundle-size`：入口 575.1 KiB raw / 163.7 KiB gzip，未放宽 700 KiB 预算；最大异步/供应商 chunk 492.9 KiB。
- 百万字规模门再次通过：10 万、30 万、100 万字符均使用有界上下文召回并隔离未来/错世界证据。

第一次最终 CI 尝试中，一条 `CHATGAME-3D` 用例在全量并发负载下单次超出 60 秒；同文件隔离复跑 6/6、0.98 秒通过，随后原样重跑完整 CI 时该文件 1.26 秒通过且整套全绿。没有放宽超时或屏蔽用例。

## 9. 清理前的最终检查表

- [x] 所有独有提交已通过真实父提交关系进入整合 HEAD，并完成祖先覆盖核验。
- [x] 所有工作树在整合与验证阶段均无未提交或未跟踪内容。
- [x] PR #60 与 #75 的完整 HEAD 已成为整合 HEAD 祖先；推送 `main` 后复核 GitHub 最终状态。
- [x] 最新星标历史先进入主干历史；现行 README 不再引用后，自动工作流、脚本与资产已显式退役。
- [x] 过时文档已上传 WPS 版本化归档并回读校验。
- [x] 完整 CI、E2E、构建、覆盖率、架构与 bundle 门全部通过。
- [x] 整合分支已以 `--ff-only` 快进到本地 `main`，并通过普通推送同步远程；没有强推。
- [x] PR #60/#75 均由 GitHub 确认为 `MERGED`；所有待删分支先通过祖先检查，再执行引用清理。
- [x] 清理后本地分支、远程 heads 与工作树均只剩 `main`，且清理基线 SHA 完全相同。

## 10. 推送与引用清理结果

2026-08-26 的最终操作按以下顺序完成：

1. 原项目工作树从 `feat/ttrpg-game-platform` 切换到旧本地 `main`。
2. 使用 `git merge --ff-only refactor/project-document-authority`，把已完整验证的整合历史快进到本地 `main`。
3. 使用普通 `git push origin main` 把远端主干从 `1b9277e7` 更新到 `8ed59765`；没有使用 `--force` 或历史改写。
4. GitHub 随即确认 PR #60 与 #75 均为 `MERGED`，时间为 `2026-08-26T06:56:07Z`；开放 PR 数为 0。
5. 再次证明 `origin/fix/dexie-premature-commit` 与 `origin/readme-assets` 都是 `main` 祖先后，通过 `git push origin --delete` 删除这两个远程分支。
6. 五个辅助工作树均在干净状态下通过非强制 `git worktree remove` 删除。
7. 七个本地来源/整合分支均通过非强制 `git branch -d` 删除。

引用清理完成后的机器核验结果：

| 核验面 | 最终结果 |
|---|---|
| 本地分支 | 仅 `main` |
| 远程 heads | 仅 `refs/heads/main` |
| Git 工作树 | 仅 `/Users/qinyingying/Desktop/project/storyforge` |
| 开放 PR | 0 |
| PR #60 / #75 | 均为 `MERGED` |
| 清理基线 | 本地 `main` = `origin/main` = `8ed59765f0a9cdfc57b3dc2b684e6971d21508c4` |

本节本身是清理完成后的唯一文档追加；提交并普通推送后，以包含本节的最新 `main` SHA 为最终同步点。
