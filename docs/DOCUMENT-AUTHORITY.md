# StoryForge 文档权威与归档规则

> 版本：2.5.6 · 生效：2026-10-27
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

- `docs/roadmap/CODEX-PROVIDER.md`：Codex 本机登录复用、隔离、传输恢复与提供商验收契约。

- `tools/plugin-sdk/authoring/`：社区插件开发 Skill、通用指令与验收模板；从现行接口约定派生，不创造另一套接口权威。
- `docs/guides/PLUGIN-DEVELOPMENT.md`：插件 SDK、包格式、数据生命周期与静态工坊目录。
- `docs/roadmap/PLUGIN-WORKSHOP-V1.md`：插件体系与创意工坊一期施工契约。

- `docs/products/README.md`
- `docs/products/LONGFORM-AND-NODE.md`
- `docs/products/INDEPENDENT-CREATION.md`
- `docs/products/MOTION-DRAMA.md`
- `docs/products/WORLD-ENGINE.md`：L2 世界引擎/叙事世界基座专项唯一最高权威，服从 L0/L1；集中包含 Narrative IR v1、冻结索引、中立查询/推演边界、产品 Requirement Compiler 接缝、Phase 0～2 工作包与验收矩阵。§10 是核验基线，§11～19 是目标设计；§22 登记 NW-0B 基线，§23 登记 NW-1A 身份/时间/codec 的实际代码与复测；§24～30 记录领域投影、候选采纳、v4 索引、增强查询、两产品接缝、修改影响及规模评测的分支实现和阶段证据。后续卡仍未通过全部交付与外部验收门，不代表正式入口放行或已上线。
- `docs/products/UPPER-PRODUCTS.md`
- `docs/products/TTRPG-AI-KP.md`：跑团 AI KP 专项产品契约。
- `docs/roadmap/TTRPG-DEVELOPMENT-PLAN.md`：跑团唯一专项施工入口，现行 2.1.0；§23–§34 为当前项目修订，末尾完整保留的 2.0.0 原稿与原决策只在不冲突范围生效。对应契约 1.1.0，设计落地不代表 open 已实现。
- `docs/products/TEXT-ADVENTURE.md`：AI 主导文字冒险专项产品契约。
- `docs/products/AVG.md`：AVG/Galgame 整体产品的唯一施工入口；正式目标设计不提升当前 partial 能力或作品成熟度。
- `docs/products/avg-production/README.md`：AVG 三线生产、系统/媒资与验收规格的目录；以下四份子文档受 AVG.md 约束。
- `docs/products/avg-production/01-AGENT-SKILLS-AND-ARTIFACTS.md`：AVG 专业岗位、唯一 Skill/工件写域、依赖、来源与有界执行。
- `docs/products/avg-production/02-SYSTEMS-AND-RUNTIME.md`：AVG 对话/选择/演出、物件及可选交互、版本/消费/存档恢复目标。
- `docs/products/avg-production/03-MEDIA-PRODUCTION-AND-BINDING.md`：AVG 真实参考、媒资家族/配音、加工/采用及 typed 消费绑定。
- `docs/products/avg-production/04-QUALITY-REPAIR-AND-FIRST-SCENE.md`：AVG 分层质量、真实校准、首场景、切片与最小返修验证设计。
- `docs/products/TEXT-OPEN-WORLD-PRODUCT-ARCHITECTURE.md`：文字开放世界整体产品与游戏系统的唯一施工入口。
- `docs/products/TEXT-OPEN-WORLD-NARRATIVE-BASE-ARCHITECTURE.md`：文字开放世界叙事生产子系统规格；受整体产品入口约束。
- `docs/products/TEXT-OPEN-WORLD-VISION-AND-EVOLUTION.md`：文字开放世界愿景、答疑与方案演进记录；不能单独作为施工完成证明。
- `docs/products/TEXT-OPEN-WORLD-SALT-RIDGE-BRIEF.md`：首个纵向验收世界的冻结产品 Brief；只证明小型验收循环。
- `docs/products/text-adventure-production/README.md`：文字冒险专业生产与旗舰交付的唯一施工入口；以下 13 份子文档共同构成该专项方案包，不得脱离入口单独提升权威。
- `docs/products/text-adventure-production/01-DELIVERY-CONTRACT.md`
- `docs/products/text-adventure-production/02-AGENT-TEAM-AND-SKILLS.md`
- `docs/products/text-adventure-production/03-SOURCE-SUFFICIENCY-AND-ADAPTATION.md`
- `docs/products/text-adventure-production/04-STORY-TO-QUEST-AND-SCENE.md`
- `docs/products/text-adventure-production/05-PRODUCTION-DAG-AND-ARTIFACTS.md`
- `docs/products/text-adventure-production/06-RUNTIME-MEDIA-PLAYER-AND-DISTRIBUTION.md`
- `docs/products/text-adventure-production/07-QUALITY-EVAL-AND-ACCEPTANCE.md`
- `docs/products/text-adventure-production/08-IMPLEMENTATION-AND-DELIVERY-PLAN.md`
- `docs/products/text-adventure-production/09-MEDIA-AUTHORING-AND-REVISION.md`
- `docs/products/text-adventure-production/10-MEDIA-QUALITY-AND-BINDING.md`
- `docs/products/text-adventure-production/11-HUMAN-VISUAL-REVIEW-AND-RECOMMENDATION.md`
- `docs/products/text-adventure-production/12-PRODUCT-PACKAGE-IMPORT-AND-COMMUNITY-CANDIDATE.md`
- `docs/products/text-adventure-production/13-FIRST-FLAGSHIP-PRODUCTION-AND-SHOWCASE.md`
- `docs/ROADMAP.md`
- `docs/roadmap/README.md`
- `docs/roadmap/CHARACTER-CHAT-DEVELOPMENT-PLAN.md`：E-CHAT-01 角色聊天专项开发计划，覆盖来源投影、情境与主动叙事、导演控制、长期关系、多人、发行及商业验收，提供可勾选开发步骤与进度证据规则；计划不代表实现完成。
- `docs/roadmap/CAPABILITY-BASELINE.md`
- `docs/roadmap/LONGFORM-SYSTEM-FICTION-QUALITY-PLAN.md`：系统文长篇质量增量的研究、十个施工单元、进度和验收入口；复用分步骤与节点同源主链，不宣称文学或平台验收完成。
- `docs/roadmap/INDEPENDENT-CREATION-DEVELOPMENT-PLAN.md`
- `docs/roadmap/SHORT-NOVEL-DEVELOPMENT-PLAN.md`
- `docs/roadmap/NOVEL-TO-SCREENPLAY-DEVELOPMENT-PLAN.md`
- `docs/roadmap/NOVEL-TO-COMIC-DEVELOPMENT-PLAN.md`
- `docs/roadmap/MOTION-DRAMA-PREPRODUCTION-DEVELOPMENT-PLAN.md`
- `docs/roadmap/MOTION-DRAMA-CONTENT-PRODUCTION-FLOW.md`
- `docs/roadmap/TEXT-OPEN-WORLD-IMPLEMENTATION-PLAN.md`：文字开放世界完整开发清单与当前进度口径。
- `docs/roadmap/TEXT-OPEN-WORLD-WORK-PACKAGE-CARDS.md`：文字开放世界 G1/G2 功能开工卡与风险台账。
- `docs/roadmap/AVG-IMPLEMENTATION-PLAN.md`：E-AVG-01 的系统与表现优先队列、增量依赖、校准、协议升级与兼容切换；当前状态以该计划为准，专业故事生产后置。
- `docs/roadmap/AVG-WORK-PACKAGE-CARDS.md`：AVG 每包的入口/读取/候选采用/生命周期/消费者/正反例与完成边界。
- `docs/roadmap/COMPLETED.md`

### 2.3 机器事实与质量证据

- `docs/audits/TTRPG-DELIVERY-20261027.md`：L4 跑团 PR #196 工程交付回执、产品边界与迁移关键问题、体验包及继续开发入口；不替代唯一施工方案或真人/发行验收。

- `docs/audits/TEXT-OPEN-WORLD-PR134-STAGE-SUMMARY-20261026.md`：L4 开放世界 PR134 阶段交接；记录已合并能力、真实预览通关、待办和恢复入口，不改变产品契约或代替真人/Release验收。

- `docs/AI-FUNCTIONS-MANUAL.generated.md`：代码生成，不手改。
- `docs/AI-FUNCTIONS-MANUAL.semantic.md`：生成清单的人工语义注解。
- `docs/CONSISTENCY-COVERAGE-MAP.md`：Canon 一致性反例状态。
- `docs/audits/NOVEL-PROMPT-CRAFT-20260927.md`：小说工坊提示词公开来源比较、原创内容设计与验证记录；不替代产品契约或模型质量认证。
- `docs/audits/SYSTEM-FICTION-Q01-BASELINE.md`：系统文 Q01 原创样本、模型与预算、评价锚点、实际请求和完成门；是实验协议与证据，不替代真人文学或平台验收。
- `docs/audits/SYSTEM-FICTION-Q02-TECHNIQUE-CARDS.md`：七类系统文技法、原创正反例、阶段映射与小样本校准；不替代真人质量验收。
- `docs/audits/CURRENT-ARCHITECTURE-AUDIT-20260903.md`：当前代码树的项目级架构闭环审计；不替代具体产品方案和质量认证。
- `docs/roadmap/INDEPENDENT-CREATION-PLAN-AUDIT.md`：三份独立创作专项方案的边界、共享底座和分支隔离审查证据；不替代专项方案。
- `docs/roadmap/MOTION-DRAMA-PLAN-AUDIT.md`：漫剧前期生产方案对当前行业流程的交叉审查与修订证据。
- `docs/audits/TEXT-OPEN-WORLD-CAPABILITY-AUDIT-20260906.md`：文字开放世界开工时的能力审计快照；只作实施证据，当前实现以代码、测试与能力基线为准。
- `docs/audits/GAME-PRODUCT-LIFECYCLE-COMPLETENESS-REVIEW-20260927.md`：游戏产品双生命周期、现行 S1/S2/S3 全流程、横切缺口、采纳决议与后续验证任务；七项原则已进入 L0/L1/L2，本文继续作为 L4 论证和实现审计证据，不替代上位规则或宣称实现完成。
- `docs/audits/AVG-PRODUCTION-RESEARCH-20261013.md`：AVG 三条生产流程的历史追溯、头部成品对标、代码基线、专业方法、能力矩阵与评测研究；属于 L4，施工转由 AVG.md 及专项计划/工作包卡，不宣称生成效果或作品商业验收完成。
- `docs/audits/AVG-PROFESSIONAL-METHODS-20261013.md`：AVG 主创方法访谈、官方宣传帧观察、生成方法/参考图接口与许可、专业 Skill 方法草案和原创正反例；属于 L4 研究与未校准提案，不能作为已注册岗位、完整游戏场景研究或真实生成/作品验收证明。
- `docs/audits/evidence/avg-scenes-20261013/public-frame-observations.json`：上述 AVG 研究的公开视频来源、时间码、帧 hash 与观察范围索引；不含商业源图像，不是产品媒资清单、生成 receipt 或作品验收。
- `docs/audits/evidence/avg-final-acceptance-20261026/acceptance-receipt.json`：AVG 最终整合的交付与验收证据，记录实际媒资 hash、完整备份、关闭生产恢复、原始失败及修复结果；L4 证据，未完成检查保留 pending，不提升产品设计、独立听感或商业艺术完成度。
- `docs/audits/AVG-SYSTEMS-AND-MEDIA-RESEARCH-20261013.md`：AVG 对话、物品/证据、存档及可选交互的商业机制对照，完整媒资家族、真实参考/配音和自动配置的基线、合同草案与验证任务；L4 研究，不证明专属系统、自动生成或商业验收已完成。
- `docs/audits/evidence/avg-systems-media-20261013/official-manual-observation.json`：大逆转裁判 PS4 官方操作图的来源、hash 和观察范围索引；不含原图，不是实际游戏操作或产品验收 receipt。

### 2.4 用户、维护与法律资料

- `docs/guides/CLIENT-DISTRIBUTION.md`：L4 Windows/Android 客户端构建、GitHub 更新、签名与数据保持操作说明；候选实现和设备验收边界不等于正式发行。

- `website-docs/`：L4 官方项目知识库的唯一源目录，维护规则见 `website-docs/AGENTS.md`；面向用户提供产品指南、概念、Prompt、更新日志和反馈入口说明。相关变更进入 `main` 后由 `.github/workflows/deploy-docs.yml` 构建发布到 `https://docs.storyforge-lab.com/`。在线站点是仓库源文件的发布结果，不是可反向覆盖仓库的另一权威源。
- `website-docs/updates/changelog.md`：面向用户的官网更新日志。用户可见入口、能力、限制或操作流程变化时，与对应知识库页面在同一交付中更新；它不替代根目录工程 `CHANGELOG.md`。
- `website-docs/feedback/`：Bug、功能建议和文档反馈的用户说明及入口；`.github/ISSUE_TEMPLATE/` 是备用 GitHub Issue 表单。仓库拥有入口和表单定义，实际提交记录由正式反馈服务或 GitHub Issues 持有，不属于静态知识库正文。
- 根目录 `README.md`、`README.en.md`、`README.fr.md`、`README.de.md`、`README.it.md`、`README.es.md`、`README.pt.md`、`README.ja.md`、`README.ko.md`：L4 九语言用户首页，包含产品导览、开始方式、演示、技术优势、Harness 架构、隐私和交流入口；按当前主干核对，不替代产品契约。更新公共能力、操作路径或限制时同步核对各语言版本，保持语言切换互通；README 翻译不代表界面或关联文档已完成同等语言覆盖。
- `docs/assets/readme/home-current.png`：2026-09-15 当前青绿 UI 首页，隔离浏览器数据截图。
- `docs/assets/readme/longform-create-current.png`：同次核对的长篇作品库内创建入口截图。
- `docs/assets/readme/longform-outline-current.png`：同次核对的长篇大纲工作台，隔离演示作品。
- `docs/assets/readme/ttrpg-current.png`：同次核对的新版原创跑团入口截图。
- `docs/assets/readme/data-current.png`：同次核对的数据管理截图。

- `docs/MEMORY-WORKSPACE-GUIDE.md`：本地记忆工作区操作与隐私边界。
- `docs/assets/support/afdian-aloneone.jpeg`：根目录 README 使用的爱发电赞助二维码展示资产。
- `docs/guides/I18N.md`：界面多语言维护规则。
- `docs/ttrpg/licenses/SRD-5.2.1-CC-BY-4.0.md`：规则引用许可说明。

以上图片为 L4 展示资产，只说明截图时的界面；不承诺模型效果或产品完成度。更新 README 应保留或替换仍有效的用户入口、操作说明、教程、交流与支持信息；清理历史设计文档不能用工程规范摘要取代用户首页。

根目录 `README.md`、`CONTRIBUTING.md`、`CHANGELOG.md`、`LICENSE`、`SECURITY.md` 和社区治理文件继续有效，但它们不能覆盖项目总纲。

世界引擎专项任务由 `WORLD-ENGINE.md` 内部章节路由，不另设平行 IR/索引权威。上层产品文档只能细化本产品读取与私域投影，不能覆盖世界语义、版本、证据与隔离约束。当前架构/能力基线仍对实现状态负责，专项设计不能把未来能力改标 implemented。

## 3. 清理前完整归档

本文所称“WPS 知识库”专指 WPS 云文档中的“StoryForge故事熔炉”文件夹。它可承载研究、讨论、工作材料和历史归档，但不与仓库 `website-docs/` 或官网自动同步，也不因位于该文件夹而自动获得 L0～L4 权威；材料必须经复核并正式进入现行仓库文档后才能指导开发。

2026-08-26 已把文档权威重建前的完整快照上传到 WPS 知识库：

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

本次 1.7.0 增量复审把 Phase C 总规划拆成短篇、小说转剧本、小说转漫画三份专项施工方案，并登记一次跨方案隔离审查。三份方案各自拥有产品 owner、Skill DAG、UI、数据生命周期、完成条件和唯一功能分支；共享来源分析只允许通过独立 foundation 提交进入集成基线。该拆分未改变总纲 1.5.0 的产品边界、当前架构事实或世界引擎 owner。

本次 1.8.0 复审随总纲 1.7.0 统一世界衍生产品阶段短名为 `S1 世界封存`、`S2 产品定向`、`S3 产品执行`。现行白名单没有增加或删除；L1/L2 文档已同步阶段职责、交接与闸门。旧长标题不再作为另一套阶段名称，但 Git/WPS 历史记录仍按 H 层保留。

本次 1.9.0 复审登记文字冒险专项产品契约及其专业生产方案包。它细化 `UPPER-PRODUCTS.md` 已确定的共同边界，不改变世界引擎、AVG、文字开放世界或共享底座 owner；实现状态仍以能力基线、代码与当前验证证据为准。

本次 2.0.0 复审登记文字开放世界整体产品、叙事子系统、愿景演进、盐脊验收 Brief、开发清单、开工卡和能力审计。整体产品架构是该产品唯一施工入口；叙事文档只管理叙事生产子系统，愿景与审计不覆盖当前代码事实。该登记不改变 `UPPER-PRODUCTS.md` 的世界衍生产品边界，也不允许文字开放世界接管共享生产、Release 或世界引擎 owner。

本次 2.1.0 复审随总纲 1.8.0 将所有游戏型上层产品的 S3.1 生产统一收束为游戏内容制作、产品系统配置和媒资生产三条依赖式并行泳道，并明确 S2 产品设置与 S3 系统配置的区别。现行白名单没有增加或删除；该修订只统一职责、所有权、交接、组装和验收表达，不建立跨产品万能表、固定 Agent 图或共同游戏规则，也不改变任何产品的当前实现状态。

本次 2.2.0 复审登记游戏产品全生命周期完整性审查。该审查区分 StoryForge 产品能力研发与具体游戏实例生产，记录局部返修、运行时 AI、发布成熟度、发布后维护和横切治理建议；它只为后续总纲/产品契约修订提供依据，不越级改变 L0/L1，不新增产品身份、生产阶段或实现完成度声明。

本次 2.3.0 复审确认总纲 1.9.0 与上层产品契约 2.6.0 正式采纳全生命周期审查的七项长期原则，并同步开发入口、上下文路由、数据治理和 Harness 标准：双生命周期、可玩切片与局部返修、确定性 Build Integrator、分层验收成熟度、运行时 AI 契约、发布后维护和横切治理。该修订不新增 S4/S5、第四条创意泳道、万能 schema 或产品身份，也不把原则采纳误报为具体功能已经实现。

本次 2.4.0 复审登记仓库 `website-docs/` 为“项目知识库”的唯一源目录，明确其通过部署工作流发布到官方知识库站点，并区分内部 `docs/`、公开项目知识库和 WPS 知识库“StoryForge故事熔炉”。同时登记用户更新日志与反馈入口的正确路径，区分仓库中的反馈表单定义和外部系统持有的实际提交记录。该修订只统一名称、路由、权威和同步证据，不复制知识库正文，也不改变任何产品能力状态。

本次 2.4.1 增量登记 AVG 三条生产流程商业对标与研发路线研究，保留其 L4 证据层级；研究建议不自动进入施工队列，不修改总纲、产品 owner、阶段或当前实现状态。

AVG分支 2.5.0 复审登记 AVG 整体产品契约、四份子规格、实施计划和工作包卡，共八份 L2 文档。AVG.md 是唯一整体施工入口，L4 研究保留论据和观察限制；设计明确三线岗位/工件、系统/存档、真实媒资/配音/消费者、版本兼容、质量与依赖。仅完成设计交付，产品仍为 partial，真实调用/首场景/作者玩家及商业证据未因登记而完成；总纲、产品 owner 和其他产品优先级不变。

2.5.1 随 AVG 方案 1.1.0 细化近期施工增量：意图→规则骨架→分场→导演无循环前置，导入首戏先于完整工厂/工作台/跨周目，专业化及图/音实际校准提前，补充 S2 V2 选择、设备/资源与商业参照质量/投入门。后置模块/渠道/规模仍需按真实选用范围细化；不把岗位数、文档检查或短戏通过当作商业效果。

本次 2.5.0 增量复审登记跑团施工方案 2.1.0 与产品契约 1.1.0，确立 open/scripted 同产品格式及版本/作者生产/状态权威/角色知识/授权/恢复边界，新增首次接手信息与施工验收。按当前需求保留原稿和全部旧决策，以明确修订索引撤销冲突旧条款的施工效力；WPS 为同文件工作副本，旧沙盒归档继续仅供追溯。未改变总纲、产品身份闭集、schema、真实实现状态或公开能力；文档合入与 WPS 同步分别验证。

世界基座分支 2.5.0 复审将既有 WORLD-ENGINE.md 升级为叙事世界基座专项入口，保持文件白名单与 L0/L1 优先级不变；登记其中 IR、索引、查询、推演与 NW 施工包的目标属性。同步世界任务路由和未实施 backlog，修正当前 schema/备份口径；历史审计快照不追改。
