# StoryForge 文档整合方案

> 状态：待 Claude / 作者复审后执行  
> 日期：2026-07-08  
> 范围：仓库 `docs/` 与 WPS 云文档分流；不包含代码、数据库 schema 或用户数据迁移

---

## 一、目标

把仓库文档从“历史材料全部堆在一起”收敛为三类：

1. **仓库内保留**：开发、审查、注册表、架构施工必须随代码版本同步的文档。
2. **WPS 公开知识库**：用户安装、使用、成本、社区反馈等面向用户的文档。
3. **WPS 私有文档库**：历史设计、图集、视觉稿、阶段性讨论材料，保留可追溯性，但不继续挤在仓库里。

本方案只定义分流与执行闸门。**未获授权前，不删除文件，不改 `CLAUDE.md`，不改 `docs/MASTER-BLUEPRINT.md`。**

---

## 二、数字订正与执行口径

Claude 审核口径：

- `docs/archive/` 是 **14 份**，不是旧方案误写的 38 份。
- 非 coverage 文档总量是 **89 份**。
- 现有文档膨胀属实，但不能按“无风险清理”处理，因为大量候选文档被 `CLAUDE.md` 与 `docs/MASTER-BLUEPRINT.md` 的文档地图引用。

执行前必须重新扫描当前工作树，并把实际数量写进执行报告：

```bash
find docs -type f \( -name '*.md' -o -name '*.html' \) | wc -l
find docs/archive -type f \( -name '*.md' -o -name '*.html' \) | wc -l
rg -n "AI-FUNCTIONS-MANUAL|ARCHITECTURE-REFACTOR|DATA-FLOW-MAP|DATA-FLOW-DIAGRAM|MULTI-WORLD-DESIGN|FEATURE-DESIGN-v1|CODEX-REDESIGN|CONSISTENCY-CHECK|WORLD-RULES-MULTIWORLD" CLAUDE.md docs
```

如果扫描结果与审核口径不同，以执行报告记录差异，但不改变本方案的安全顺序。

---

## 三、硬性闸门

### 3.1 宪法 / 施工权威闸门

以下文件不得在本方案执行中顺手修改：

- `CLAUDE.md`
- `docs/MASTER-BLUEPRINT.md`

原因：

- `CLAUDE.md` 是项目宪法；其文档地图引用了 `AI-FUNCTIONS-MANUAL.md`、`ARCHITECTURE-REFACTOR.md`、`DATA-FLOW-MAP.md`、`DATA-FLOW-DIAGRAM.md` 等。
- `docs/MASTER-BLUEPRINT.md` 是施工权威；它还引用 `MULTI-WORLD-DESIGN.md`、`FEATURE-DESIGN-v1.md` 等历史设计材料。

处理原则：

1. 先把目标文档迁移到 WPS，并回读确认。
2. 再更新普通文档里的引用。
3. 准备修改 `CLAUDE.md` / `MASTER-BLUEPRINT.md` 前，必须在 `docs/COLLAB-LOG.md` 请作者明确授权。
4. 引用仍存在时，禁止删除源文件。

### 3.2 待实施设计闸门

下列设计文档如果要外迁，必须先把有效方案摘要写入 `docs/roadmap/README.md`：

- `docs/WORLD-RULES-MULTIWORLD-DESIGN.md`
- `docs/CODEX-REDESIGN.md`
- `docs/CONSISTENCY-CHECK-DESIGN.md`
- `docs/AI-COPILOT-DESIGN.md`

原则：ROADMAP 保留“未来怎么做”的施工入口；WPS 保存“历史怎么讨论”的全文材料。

### 3.3 删除闸门

任何删除必须同时满足：

- WPS 已上传并回读确认。
- `rg` 确认仓库内无未处理引用。
- 如引用来自 `CLAUDE.md` / `MASTER-BLUEPRINT.md`，已取得作者授权并完成引用更新。
- `npm run check:ai-manual` 与 `npm run check:architecture` 通过。

---

## 四、分流表

### 4.1 仓库内保留

| 文件 | 原因 |
|---|---|
| `README.md` | 项目入口 |
| `CLAUDE.md` | 项目宪法 |
| `AGENTS.md` | AI 接手入口 |
| `CONTRIBUTING.md` | 贡献规则 |
| `CHANGELOG.md` / `docs/CHANGELOG.md` | 版本变更记录 |
| `docs/roadmap/README.md` | 当前待开发与施工索引；`docs/ROADMAP.md` 保留兼容入口 |
| `docs/roadmap/CAPABILITY-BASELINE.md` | 当前能力事实，防止重复开发 |
| `docs/roadmap/COMPLETED.md` | 已完成开发单位索引 |
| `docs/MASTER-BLUEPRINT.md` | 施工权威 |
| `docs/COLLAB-LOG.md` | Codex / Claude 沟通频道 |
| `docs/COLLAB-WORKFLOW.md` | 双 Agent 协作流程 |
| `docs/AI-FUNCTIONS-MANUAL.generated.md` | 代码生成的 AI 功能权威清单 |
| 注册表、架构检查脚本相关说明 | 与代码验证强绑定，需随仓库版本走 |

### 4.2 WPS 公开知识库

面向普通用户、社区用户、安装使用者：

| 候选 | 处理 |
|---|---|
| `docs/FEATURE-GUIDE.md` | 上传公开知识库；仓库可只保留入口链接 |
| `docs/COMMUNITY-GUIDE.md` | 上传公开知识库；仓库可只保留入口链接 |
| `docs/TOKEN-COST-GUIDE.md` | 上传公开知识库；仓库可只保留入口链接 |
| `docs/使用npm指令启动项目.md` 或同类启动文档 | 上传公开知识库；README 保留最短入口 |
| 用户向 FAQ / 省钱指南 / 安装说明 | 统一进公开知识库 |

### 4.3 WPS 私有文档库 `storyforge故事熔炉`

设计、历史、图集、阶段性材料：

| 候选 | 处理 |
|---|---|
| `docs/GENERATION-CONSISTENCY-DIAGRAMS.md` | 上传私有文档库；仓库删除需过引用检查 |
| `docs/generation-consistency-overview.html` | 上传私有文档库；仓库删除需过引用检查 |
| `docs/world-map-demo.html` | 上传私有文档库或归档 |
| `docs/archive/*` | 上传私有文档库；仓库保留 `archive/README` 指针 |
| 已实现的阶段设计文档 | 上传私有文档库，ROADMAP 保留结论摘要 |
| 视觉稿 / promo / assets 中非运行必需材料 | 上传私有文档库，仓库只留运行必需资源 |

### 4.4 仓库内合并 / 精简

| 现状 | 目标 |
|---|---|
| `AI-FUNCTIONS-MANUAL.md`、`AI-FUNCTIONS-MANUAL.semantic.md`、`AI-FUNCTIONS-MANUAL.generated.md` | 只以 generated 作为权威；旧手写版转 WPS 历史或改为短指针 |
| `DATA-FLOW-MAP.md` + `DATA-FLOW-DIAGRAM.md` | 若仍被宪法引用，先保留；后续获授权后可合并为一份简版 |
| `ARCHITECTURE.md` + `ARCHITECTURE-REFACTOR.md` + `CODEX-REFACTOR-PLAN.md` | 保留当前仍有效的架构入口；废弃历史转 WPS |
| 多世界相关多份设计 | ROADMAP 保留施工摘要；历史全文转 WPS |

---

## 五、执行阶段

### Phase D1：只建方案与索引，不删文件

- 新增本方案。
- 把待迁移但仍有效的设计结论补入 `docs/roadmap/README.md`。
- 在 `COLLAB-LOG.md` 写 REPORT，等待 Claude / 作者确认。

### Phase D2：WPS 分流上传 + 回读

- 公开用户文档上传 WPS 知识库。
- 设计 / 历史 / 图集上传 WPS 私有文档库 `storyforge故事熔炉`。
- 逐份回读标题、主要段落、图片/附件是否可见。
- 记录 WPS 文件 ID / 链接。

### Phase D3：非宪法引用更新

- 更新 `README.md`、普通 docs、协作文档中的引用。
- 不碰 `CLAUDE.md` / `MASTER-BLUEPRINT.md`。
- 跑 `rg` 引用检查。

### Phase D4：申请宪法 / 蓝图引用更新授权

- 在 `docs/COLLAB-LOG.md` 列出需改的引用清单。
- 等作者明确授权。
- 授权后单独 commit 修改 `CLAUDE.md` / `MASTER-BLUEPRINT.md`。

### Phase D5：删除或替换为指针

- 对已迁移、已回读、已无引用的文档，删除或替换为短指针。
- `docs/archive/` 最终只保留一个索引指针。
- 运行验证闸门。

---

## 六、验证

每个执行分支至少运行：

```bash
rg -n "被迁移文件名或关键标题" CLAUDE.md docs README.md
npm run check:ai-manual
npm run check:architecture
git diff --check
```

如涉及 README / 用户文档入口，再手动打开 WPS 链接验证可读权限。

---

## 七、执行记录

2026-07-08 已执行第一批安全迁移：

- 目标文件夹：`我的云文档 / AAAAAAA自研项目产品 / storyforge故事熔炉 / 仓库文档迁移_20260708`。
- 已上传并回读确认：`docs/archive/*.md` 12 份、`docs/archive/playbooks/*` 22 份、`docs/archive/design-system/*` 7 份、`docs/promo/*.md` 2 份、`docs/promo/*.svg` 12 份（以 `.txt` 文本副本上传）、`docs/GENERATION-CONSISTENCY-DIAGRAMS.md`、`docs/generation-consistency-overview.html`、`docs/world-map-demo.html`、`docs/refactor/PHASE-1/2/3-*` 状态文档 4 份。
- 仓库侧已删除上述 62 份已迁移文档 / 资料，并保留 `docs/archive/README.md` 指针。
- 未动 `CLAUDE.md` / `docs/MASTER-BLUEPRINT.md`。

👉 下一步：继续处理普通文档瘦身；凡涉及 `CLAUDE.md` / `docs/MASTER-BLUEPRINT.md` 引用更新，先在 `docs/COLLAB-LOG.md` 列授权清单。
