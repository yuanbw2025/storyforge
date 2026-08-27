# StoryForge 已完成能力索引

> 版本：1.2.0 · 更新：2026-08-27
> 只登记可长期成立且已合入主干、并有当前代码/检查器证据的能力。完成表示声明范围已交付，不表示永无 Bug 或文学质量不再演进。

## 已完成基础能力

| ID | 能力 | 当前证据 |
|---|---|---|
| BASE-DATA-01 | schema required tables 与 `PROJECT_TABLES` 同源治理 | `check:required-tables`，当前 115 张表；迁移/导入导出/删除测试 |
| BASE-REG-01 | 三注册表成为 AI 读、AI 写和表生命周期单一入口 | `src/lib/registry`、`check:architecture` |
| BASE-AI-01 | 生产模型调用机器登记与分类 | `ai-entry-registry.json`、`check:ai-entry-registry` |
| BASE-HARNESS-01 | durable run、事件、checkpoint、stale、采纳与 receipt 基础 | `src/lib/agent/run` 与对应回归套件 |
| BASE-CTX-01 | Context Gateway 渐进式目录、预选、详情/原文与检索证据 | `src/lib/context-gateway` 与 CTXG/长程规模测试 |
| B-LF-01 | 独立分步骤长篇产品入口与 Phase 5 工程主链 | `/workspace/:projectId`、`ffd67963`；自动世界化缺陷另归 ARCH-01，不回退长篇完成状态 |
| B-LF-02 | races 金切片与全部现有可生成世界观字段统一治理 | `ce347212`、`R-WE1-worldview-generatable-contract`、RACE/GATE-P2 套件；故事/角色 Phase 2 治理 |
| B-LF-03 | 故事→角色→主支线→大纲→细纲→正文完整 durable Harness | STORY/CHAR/ARC/OUTLINE/DETAIL/PROSE 完成提交；`ef6b79fa` GATE-P3 真实 API 纵切面 |
| B-LF-04 | 主支线、角色、章后与只向未来持续演化 | `a062b45c`、`bb9d346b`、`2cde40c5` 及对应回归 |
| B-LF-05 | 长篇原文/事实/摘要/索引、渐进式读取和长尾召回 | Context Gateway、memory/retrieval、Manifest、遗漏/充分性与长程回归 |
| B-LF-06 | 10万/30万/100万字符理论工程规模门 | `401cc4cf` Phase 4、远距事实/伏笔召回和错世界/未来隔离；不宣称长期文学一致性证书 |

## 本次权威重建里程碑

- `345aebe8`：建立项目总纲。
- `e2abc188`：建立分支整合证据台账。
- `ffd67963`：Phase 0A～Phase 5 分步骤长篇/Harness、渐进式上下文与百万字符工程规模门进入整合主干。
- A-GOV-01：所有当时已发现的本地/远程分支及开放 PR 独有 head 已进入整合树，并完成 main 同步、远程/本地历史分支清场和验证记录。
- A-GOV-01 是一次整合检查点；之后按开发宪法创建的短期功能分支不使该历史里程碑倒退。
- 清理前文档完整快照已进入 WPS 已过时版本化归档并通过哈希校验。

历史阶段、旧完成卡和评测流水可从 Git 或 WPS 归档追溯，不在本索引复制。
