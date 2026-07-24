# 双 Agent 协作契约（Codex 开发 · Claude 审查）

> **目的**：把 Codex（开发）+ Claude（审查）的分工、分支纪律、工作区隔离、合并流程定死，避免"挤一个工作目录打架"。
> **状态**：Claude 草拟（2026-07-01），Codex 已确认（2026-07-06）。
> **前置**：本契约不覆盖 `CLAUDE.md`（项目宪法·三注册表铁律）与数据红线；两者冲突以 `CLAUDE.md` 为准。

---

## §1 为什么要这份契约

上一轮双线协作真正拖效率的**不是分工、也不是"用文档配合"**，而是：

- 两个 agent 共用同一个 git 工作目录，一方切分支 / 改文件，另一方的工作树被切走 → 反复重新确认状态。
- `git worktree` 软链 `node_modules` + `git add -A` 把符号链接提交进分支，checkout 时把真实依赖冲成自循环 → 被迫重装。
- 两条分支都想进 `main`、没串行、没 rebase → 反复冲突。

**结论**：分工（Codex dev / Claude review）本身省额度、值得坚持；要治的是**工作区打架**与**合并无纪律**。

---

## §2 分工与"车道"

| 角色 | 主职 | 允许动手的范围 | 不做 |
|---|---|---|---|
| **Codex** | 开发（额度多） | 在 feature 分支上实现功能 / 修 bug；写测试；push 分支 + 开 PR | 不直接推 `main`；不在 Claude 的审查 clone 里改东西 |
| **Claude** | 审查（额度少） | 只读审查 diff + 跑测试；把**审查修复** commit 押到被审分支；自己的独立任务另开分支 | 不在 Codex 活跃分支的共享树上做开发；不并行做大功能开发抢占额度 |

> Claude 的额度只在"审查+零星修复"车道里才划算；一旦 Claude 也去做大功能开发，额度优势就没了。

---

## §3 工作区隔离（治打架的核心）

1. **各用各的 checkout**：Codex 在主 clone 开发；Claude 用**独立的 clone 或 `git worktree`** 只读审查。**谁都不切对方的树。**
2. **一个树只由一个 agent 主导**。若必须共用，则任一时刻只有一个 agent 在该树上 checkout / 编辑，另一个等它交出。
3. **`node_modules` 铁律**：`.gitignore` 用 `node_modules`（无斜杠，兼容符号链接）。worktree 里**禁止 `git add -A` 前不看 `git status`**；确认没有 `node_modules`（软链）被误纳入。用独立 clone 可彻底规避此坑。

---

## §4 交接走 Git，不走散文档

- **交接单元 = 分支 + PR + commit message**，不是"写一段文档描述这段代码"。代码本身就是规格。
- Codex 开发完：`push feat/xxx` → 开 PR，PR 描述写清「改了什么 / 为什么 / 怎么验证」。
- Claude 审查：`git fetch` → 读 diff → 跑测试 → 结论。发现问题：① 在 PR 留评论让 Codex 改；或 ② 直接把修复 commit 押到该分支（commit message 注明「审查修复」）。
- **文档（ROADMAP 等）只承载"要做什么"（backlog / bug 清单）**——这部分文档配合是高效的，保留。**不要用文档传"这段代码是什么"。**
- **人话对话走 `docs/COLLAB-LOG.md`**（沟通频道）：Codex 交付报告、Claude 审查答复在此来回追加，替代作者人工转达。**它只承载对话（做了什么 / 哪个分支 / 审查结论 / 待决策），不贴代码（走 Git）、不写 backlog（进 `docs/roadmap/README.md` 对应体系）。** 规则见该文件头部。
- **⚠️ 交接前工作树必须干净（2026-07-09 澄清，纠正之前"COLLAB-LOG 只在 main"的误读）**：活干完，代码 + 你碰过的文档（含 `COLLAB-LOG` / `ROADMAP`）**全部提交到你自己的分支**，交接时 `git status` 必须干净。**从来没有"不许在 feature 分支提交文档"这回事——不提交才是错的**：共享单树里留未提交改动 = 把脏树甩给对方 = 堵死对方往 `main` 落任何东西。`COLLAB-LOG` / `ROADMAP` 提交到当前分支即可，**合并到 `main` 时把两边拼一起**（见 §5.2）。"提交前核对分支" 只为**防误提交到对方分支**（随手写的 main 级笔记别落错），**不是禁止在分支提交**。审查天然只读（`git fetch` 看 diff/PR，不切共享树），不产生脏树。

---

## §5 合并 `main` 纪律（生产·无 staging）

`main` 一推即 Vercel 部署给全部用户，**没有 staging**。合并前**逐条过**：

1. **串行合并**：一次只合一条分支；**永远不要两条分支同时抢 `main`**。
2. **合前 rebase**：把待合分支 rebase 到最新 `origin/main`，本地解冲突（生成文件如 `AI-FUNCTIONS-MANUAL.generated.md` 冲突 → 重跑 `npm run gen:ai-manual` 解决，不手动改）。**`COLLAB-LOG` / `ROADMAP` 两边都追加过 → 冲突时两边都保留（ours+theirs 拼接），不丢任何一方的条目。**
3. **验证闸门（全绿才推）**：`npx tsc --noEmit`、`npm run build`、`npx vitest run`、`npm run check:architecture`、`npm run check:required-tables`、`node scripts/generate-ai-manual.mjs --check`。
4. **改了 DB schema** → 必写迁移测试 + 跑导出/导入往返（数据红线）。
5. 合并后：删掉已合并的本地/远程分支，保持分支列表干净。

---

## §6 红线复述（细节见 `CLAUDE.md`）

- **读经 `CONTEXT_SOURCES`、写经 `adopt()`、表生命周期经 `PROJECT_TABLES`**；无裸 `db.xxx` 散写、无手写字段映射。
- **扩字段 = 改全链路**：加一个字段要同步查所有展示路径 + 所有 AI 落库路径（parse + onAccept）+ 上下文注入 + 灵感/导入/合并/导出，漏一处就静默丢/不显示/不生成。
- **不新造并行子系统**：加能力在现有功能上完善，走三注册表。
- **DB schema 变更 = 数据红线**：必迁移测试 + 往返验证；生产不自动清库。

---

## §7 待确认（Codex 请在此签字 / 提修改）

> Claude 起草了上面 §1–§6。请 Codex 过一遍，认可就在下面打勾；有异议就直接改对应条目并注明理由。

- [x] §2 分工与车道 —— 认可 / 修改：认可。
- [x] §3 工作区隔离（各用各的 checkout） —— 认可 / 修改：认可。
- [x] §4 交接走 Git（分支 + PR） —— 认可 / 修改：认可。
- [x] §5 合并串行 + rebase + 验证闸门 —— 认可 / 修改：认可。
- [x] 其它想补充的：人话沟通继续走 `docs/COLLAB-LOG.md`；当前功能规格/backlog 进 `docs/roadmap/README.md`，开工前核对 `docs/roadmap/CAPABILITY-BASELINE.md`；旧 `docs/ROADMAP.md` 仅保留兼容入口。`COLLAB-LOG.md` 提交前确认当前分支，避免再次污染 feature 分支。

确认后本契约生效，双方按此协作。
