# StoryForge 已完成能力索引

> 版本：1.3.0 · 更新：2026-08-31
> 只登记可长期成立且已进入当前治理交付树、并有当前代码/检查器证据的能力。完成表示声明范围已交付，不表示永无 Bug、具体产品已经完成或文学质量不再演进。

## 已完成基础能力

| ID | 能力 | 当前证据 |
|---|---|---|
| BASE-DATA-01 | schema required tables 与 `PROJECT_TABLES` 同源治理 | `check:required-tables`，当前 117 张表；迁移/导入导出/删除测试 |
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
| A-GOV-02 | 七项项目级架构治理 | `R-ARCH01`～`R-ARCH07`、`check:architecture`；身份、纯语义 release、三阶段、五项逻辑契约、中立出口、节点同源、能力/成熟度门均已机器化 |
| B-NODE-01 | 官方节点与分步骤正式能力同源 | `src/lib/node-authoring/domain-action-registry.ts`、`domain-execution.ts`、`R-ARCH06-node-same-source.test.ts`；正式节点无通用生成 fallback，实验草稿不能采纳 Canon |
| D-WORLD-01 | 世界身份、能力画像与不可变封存 | `src/lib/world-engine/{ownership,domain,releases}.ts`、`R-ARCH01`、`R-WORLD-D-phase-d-closure.test.ts` |
| D-WORLD-02 | 中立版本化世界资源出口 | `world-release-provider.ts` 的 describe/search/read/original-evidence、两个 requirement adapter、ARCH-05 与 Phase D 回归 |
| D-WORLD-03 | 长/短篇显式派生与多世界关系 | `world-derivation.ts`、稳定 World/Work scope、跨世界关系导航和导入重映射回归；剧本/漫画确定性拒绝 |
| D-WORLD-04 | 世界 release 纯语义边界 | `PROJECT_TABLES.worldSemantic` 唯一派生、owner/packaging/static checks、`R-WORLD2C`、`R-WORLD2D`、`R-OUTLET1`；排除产品媒资与运行状态 |

## 本次权威重建里程碑

- `345aebe8`：建立项目总纲。
- `e2abc188`：建立分支整合证据台账。
- `ffd67963`：Phase 0A～Phase 5 分步骤长篇/Harness、渐进式上下文与百万字符工程规模门进入整合主干。
- A-GOV-01：所有当时已发现的本地/远程分支及开放 PR 独有 head 已进入整合树，并完成 main 同步、远程/本地历史分支清场和验证记录。
- A-GOV-01 是一次整合检查点；之后按开发宪法创建的短期功能分支不使该历史里程碑倒退。
- 清理前文档完整快照已进入 WPS 已过时版本化归档并通过哈希校验。

## 并行产品开发基线

完成 A-GOV-02 与阶段 D 后，短篇、剧本、漫画、跑团、角色聊天和各类文字游戏可以从同一治理提交建立独立分支。各分支只实现产品私有闭环；schema、三注册表、世界网关、逻辑契约、产品目录和锁文件等共享热点先形成单独基础提交，再串行进入主干并让产品分支更新基线。并行开发不等于并行改写同一个共享核心，也不等于产品已通过自己的功能验收。

历史阶段、旧完成卡和评测流水可从 Git 或 WPS 归档追溯，不在本索引复制。
