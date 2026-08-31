# AGENTS.md · StoryForge 开发入口

> 普通任务唯一自动加载的项目文档。先按本文建立关联闭包，再通过
> [`docs/CONTEXT-ROUTING.md`](docs/CONTEXT-ROUTING.md) 按任务读取现行文档片段。
> 项目方向以 [`docs/PROJECT-MASTER-CHARTER.md`](docs/PROJECT-MASTER-CHARTER.md) 为最高权威；
> 未列入 [`docs/DOCUMENT-AUTHORITY.md`](docs/DOCUMENT-AUTHORITY.md) 的旧文档不得作为施工依据。

## 先确定产品边界

StoryForge 是多个独立叙事产品、世界引擎和共享工程底座的组合，不是一个不断膨胀的单体模块。

- 分步骤长篇是独立核心产品；不以世界引擎为前置条件。作者可显式把已确认的长篇内容一键派生为世界草稿或封存版本，原作品 owner 不变、后续修改不自动同步。
- 节点模式是同一长篇能力更自由、更细粒度、更可视和可组合的表达；它可以拆解、替换、连接和检查中间产物，但不得复制第二套生成、记忆或数据体系。
- 短篇、小说转剧本、小说转漫画分别是独立端到端产品。
- 短篇也可由作者显式派生世界；小说转剧本、小说转漫画当前不提供“封装为世界”路径。
- 世界引擎只保存可版本化语义内容，不拥有产品媒资或上层运行状态。
- 跑团、角色聊天、AI 小镇和文字游戏只读引用冻结的世界版本；各自拥有生产、媒资、发布、运行与私域演化，运行结果不得自动回写世界引擎。
- 世界衍生产品统一经过“世界封存 → 产品内交互/配置/用户明确开始 → 产品生产/发布/运行/演化”；不得从世界页面直达正式 runtime。
- 世界出口统一 `describe/search/read`、版本和来源语义，不统一固定 payload；每个产品用自己的需求适配器声明必读、选读、条件读取和禁止读取，冻结 SourcePlan，每次渐进读取留 Context Manifest，发布时聚合 SourceManifest。Skill/Prompt 可辅助语义选择，但不得单独承担版本、权限和必读约束。

开始功能前先声明：它属于哪个产品、三阶段中的哪一阶段（独立产品则声明自己的生产阶段）、数据由谁拥有、接收和产出什么交接物、是否引用世界版本、媒资归哪个产品实例。边界不清时先补产品契约，不用代码制造既成事实。

## 守住三注册表

StoryForge 是 React + TypeScript + IndexedDB 的本地优先生产项目。用户手稿主要存在浏览器中，
`main` 直接进入生产部署，没有 staging。任何扩展必须收口到三个单一事实源：

1. `CONTEXT_SOURCES` + `assembleContext()`：AI 读什么。
2. `FIELD_REGISTRY` + `AdoptionSchema` + `adopt()`：AI 可以正式写什么。
3. `PROJECT_TABLES`：表的导出、导入、删除、迁移、作用域和引用重映射生命周期。

动手前依次回答：

1. 入口和用户结果是什么？
2. AI/代码读取哪些来源，是否已登记在 `CONTEXT_SOURCES`？
3. 候选最终写入哪些字段，是否已登记在 `FIELD_REGISTRY` / `AdoptionSchema`？
4. 涉及哪些表，是否由 `PROJECT_TABLES` 派生完整生命周期？
5. 哪些调用方、下游、反例和真实用户路径会受影响？

登记缺失时，先补注册表、契约与测试，再写功能。禁止在组件或 service 中手拼上下文、散写受治理表、手写表清单、复制 AI/DB/导入导出入口。

## 正式 AI 与 Harness

正式模型调用必须进入登记的 Agent Skill / Run Contract / durable Harness，或在 AI 入口注册表中明确标注只读、内存草稿、评测、模拟等有限边界。

- 上下文由注册源、Context Gateway 和渐进式披露选择；固定条数裁剪只能是最终预算保护。
- 模型输出先成为 `CreativeArtifact` 候选；作者确认后才可 `adopt()`。
- durable run 保存 contract、manifest、事件、checkpoint、stale 证据、repair 与终态 receipt。
- 重试必须有界且可见；授权、余额、非重试型 4xx、结果未知或 stale 不得隐藏重发。
- 可验证的 schema、事务、作用域、版本、权限、预算和状态机不得只写进提示词。

## 任务开始方式

1. 查看 `git status --short --branch`、相关提交和任务描述，保护现有改动。
2. 用 `rg` 定位入口、符号、调用方、三注册表行、schema/migration 与测试，建立“入口 → 读取 → 候选/写回 → 生命周期 → 下游 → 测试”的关联闭包。
3. 按 `docs/CONTEXT-ROUTING.md` 读取命中的现行文档；历史原因从 Git 与 WPS 归档取证，不恢复旧文档权威。
4. 新体系或完整功能先核对当前能力基线与路线图；复用已经存在的基础设施，不按旧任务标题重复开发。
5. 在独立分支工作，使用 `feat/`、`fix/` 或 `refactor/`；不得直接 push `main`。

不同产品可从同一个已验证治理提交建立独立分支并行开发。产品分支只改自己的表、adapter、Agent、生产、媒资、release 与 runtime；schema、三注册表、WorldRelease provider、跨产品逻辑契约、产品目录和锁文件等共享热点先拆成独立基础提交，串行集成并验证后再让各产品分支更新基线。Git 无冲突不等于架构无冲突。

## 数据与发布红线

- schema、迁移、删除、合并、导入导出、引用重映射必须有正反例；涉及真实用户数据时，用隔离测试项目完成往返或生命周期验证。
- 新表先登记 `PROJECT_TABLES`，新 AI 可写字段先登记 `FIELD_REGISTRY`，新上下文源先登记 `CONTEXT_SOURCES`。
- 新入口取代旧入口时同步下线旧入口；半成品必须标为实验性并默认隐藏。
- 世界引擎与上层产品之间只允许显式、版本化读取；上层运行数据和媒资不得落入世界引擎。
- 阶段二的设置属于具体产品，不能建立全产品万能配置表；正式生产必须有用户开始授权、产品 Brief 和冻结 SourcePlan，正式运行必须绑定不可变 ProductRelease。
- 五种跨阶段交接物是逻辑契约而非五张万能表：主 Agent 可起草 Brief/SourcePlan；WorldReference、实际 SourceManifest 和 release lineage 必须由确定性系统按真实版本与运行证据生成、校验和冻结。
- 不确定是否丢数据、迁移失败、文档与代码无法裁决或关键反例失败时停止扩大改动，保留证据并请求决策。
- 不运行破坏性 Git/文件命令，不覆盖无关改动，不使用 `npm audit fix --force`。

## 验证与完成

验证按风险递增：

1. 先跑改动对应的定向测试或检查器。
2. 代码提交前至少通过 `npm run check:architecture`、`npm run check:required-tables`、
   `npm run check:ai-manual`、`npx tsc --noEmit`、相关测试和 `npm run build`。
3. 交付单元运行 `npm run ci`；外部依赖审计若受上游公告阻塞，单独报告，其余闸门仍须完成。
4. 涉及真实 UI/API、数据恢复或跨产品纵切面时，在隔离浏览器数据中运行 `npm run ci:e2e`，不得修改作者当前项目。
5. 提交前运行 `git diff --check`；提交信息写明任务、边界与验证证据。

完成意味着：产品边界正确、主路径可用、旧入口收口、三注册表与数据生命周期完整、刷新/失败可恢复、下游真实生效、有回归和必要 E2E、文档更新且工作树干净。PR、合并和交接按 `docs/COLLAB-WORKFLOW.md` 执行。
