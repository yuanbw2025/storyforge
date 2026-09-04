# StoryForge 文档权威与归档规则

> 版本：1.5.0 · 生效：2026-09-03
> 本文回答“哪些文档仍可指导开发”。未列入现行清单的历史材料，不得作为设计或施工权威。

## 1. 裁决层级

| 级别 | 内容 | 发生冲突时 |
|---|---|---|
| L0 | `PROJECT-MASTER-CHARTER.md` | 最高产品边界，除正式修订总纲外不得覆盖 |
| L1 | `AGENTS.md`、`CLAUDE.md`、架构、数据、Harness、工程质量标准 | 必须与总纲一致，约束所有产品实现 |
| L2 | 当前产品契约、能力基线、路线图 | 说明当前状态与下一步；不能降低 L0/L1 |
| L3 | 三注册表、schema、类型、测试、自动生成 AI Manual | 对“代码现在是什么”的事实负责；与总纲冲突时形成纠偏项 |
| L4 | 审计、发布证据、用户指南、公共 README | 提供证据或操作说明，不创造新的产品边界 |
| H | Git 历史与 WPS 已过时归档 | 只供追溯，不可直接恢复为现行方案 |

## 2. 现行文档白名单

### 2.1 入口与规范

- `AGENTS.md`：普通编码任务入口。
- `CLAUDE.md`：详细开发宪法。
- `docs/PROJECT-MASTER-CHARTER.md`：项目总纲。
- `docs/DOCUMENT-AUTHORITY.md`：本文档。
- `docs/CONTEXT-ROUTING.md`：按任务选择上下文。
- `docs/ARCHITECTURE.md`：当前代码架构事实。
- `docs/DATA-GOVERNANCE.md`：三注册表、数据 owner、版本与生命周期。
- `docs/HARNESS-QUALITY-STANDARD.md`：Agent/Skill/Harness 与长程上下文标准。
- `docs/ENGINEERING-QUALITY-STANDARD.md`：工程、测试与发布质量门。
- `docs/COLLAB-WORKFLOW.md`：分支、PR、审查、合并与交接。

### 2.2 产品与计划

- `docs/products/README.md`
- `docs/products/LONGFORM-AND-NODE.md`
- `docs/products/INDEPENDENT-CREATION.md`
- `docs/products/WORLD-ENGINE.md`
- `docs/products/UPPER-PRODUCTS.md`
- `docs/ROADMAP.md`
- `docs/roadmap/README.md`
- `docs/roadmap/CAPABILITY-BASELINE.md`
- `docs/roadmap/COMPLETED.md`

### 2.3 机器事实与质量证据

- `docs/AI-FUNCTIONS-MANUAL.generated.md`：代码生成，不手改。
- `docs/AI-FUNCTIONS-MANUAL.semantic.md`：生成清单的人工语义注解。
- `docs/CONSISTENCY-COVERAGE-MAP.md`：Canon 一致性反例状态。
- `docs/audits/CURRENT-ARCHITECTURE-AUDIT-20260903.md`：当前代码树的项目级架构闭环审计；不替代具体产品方案和质量认证。

### 2.4 用户、维护与法律资料

- 根目录 `README.md`：当前产品概览与本地运行。
- `docs/MEMORY-WORKSPACE-GUIDE.md`：本地记忆工作区操作与隐私边界。
- `docs/guides/I18N.md`：界面多语言维护规则。
- `docs/ttrpg/licenses/SRD-5.2.1-CC-BY-4.0.md`：规则引用许可说明。

根目录 `README.md`、`CONTRIBUTING.md`、`CHANGELOG.md`、`LICENSE`、`SECURITY.md` 和社区治理文件继续有效，但它们不能覆盖项目总纲。

## 3. 清理前完整归档

2026-08-26 已把文档权威重建前的完整快照上传到 WPS：

- 文件夹：[storyforge故事熔炉 / 已过时-v3.9.1-2026-08-26](https://www.kdocs.cn/mine/556058861849)
- 归档清单：[ARCHIVE-MANIFEST-StoryForge-v3.9.1-2026-08-26](https://www.kdocs.cn/l/cidJLBJJTi03)
- 完整 ZIP：[StoryForge-docs-pre-authority-v3.9.1-2026-08-26.zip](https://www.kdocs.cn/l/chgdLLD82FoA)
- 清理前提交：`5679dada86d102c9b55b8d897bf0a8ff5795d1b3`
- ZIP：395 个条目，10,853,452 bytes。
- SHA-1：`1a52bbd356058d0a68f8f6b5d064839ecdb8345e`（云端与本地一致）。
- SHA-256：`80992125d26a4692b1a01537c568fd4a7f7ea90bf8acce57ee546a9ce12710ae`。

归档包含当时 `docs/` 全目录和根目录主要项目文档。因此旧 Blueprint、路线图、施工卡、评测记录、路演材料和产品方案即使从主干移除也可追溯。

## 4. 文档生命周期

新增或修改现行文档必须：

1. 声明它属于 L0～L4 哪一层，并在本文登记；
2. 写清版本、生效日期、描述目标还是当前实现；
3. 引用代码事实时附稳定符号/路径或自动检查，避免手写数量漂移；
4. 取代旧文档时同步删除旧入口和链接；
5. 阶段计划完成后把可长期成立的规则合并到标准，流水证据进入 Git/发布记录，不继续留在默认文档库；
6. 需要历史材料时从 Git 或 WPS 归档读取，经过总纲审查后以新版本重新引入，不能原样恢复权威。

## 5. 防污染规则

- 禁止创建 `FINAL-v2`、`最终版-新`、`REVIEW`、`HANDOFF` 等互相竞争的权威文档。
- 一个主题只能有一个现行入口；研究、评审和施工过程应进入 issue/PR/审计证据。
- `docs/archive/` 不再作为仓库历史仓；完整历史由 Git 与 WPS 版本化归档承担。
- 路线图只登记未完成或明确下一步，完成流水保持精炼。
- 文档引用不存在的文件、已归档文件或旧阶段 ID，CI 应失败。

## 6. 复审

每次总纲版本升级、重大产品边界变化、schema 大版本或发布前，复审本文白名单。若某文档无法判断是否仍有效，先移出默认路由并登记审计，不允许“暂时都保留”继续制造多重事实源。

本次 1.5.0 复审已核对总纲 1.5.0、当前架构审计、产品契约、数据治理、能力基线与完成索引。现行业务、产品入口和权威文档只描述当前架构；历史数据库结构、迁移器与兼容夹具不保留在当前仓库，只能从 Git/WPS 归档取证。旧文档仍不得恢复为施工权威。
