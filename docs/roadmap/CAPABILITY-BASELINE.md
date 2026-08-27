# StoryForge 当前能力基线

> 版本：1.2.0 · 基线：2026-08-27 架构复审 · 权威层级：L2
> 本文区分代码存在、纵切面可用和产品完成。旧完成卡不自动恢复权威，但已合入主干并由当前代码/检查器复证的 Phase 5 成果必须保留。

## 状态定义

- `implemented`：明确能力已实现并有当前自动验证，但仍受其声明边界约束。
- `partial`：有真实代码/测试，产品闭环、覆盖或真实体验仍缺。
- `missing`：总纲要求但没有可用实现。
- `experimental`：实现存在但能力门控、非主路径或发展顺序后置。

## A · 治理与共享底座

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| A-GOV-01 | implemented | 总纲、分支整合台账、WPS 完整归档、现行文档体系和 main 同步检查点已建立 | 后续正常功能分支按协作流程短期存在，不重新解释为长期架构分叉 |
| A-GOV-02 | partial | 架构治理审计 2.0 已把产品边界、三阶段、交接物、中立世界协议和七项纠偏包分离清楚 | 文档规则已生效；七项代码/迁移/自动门尚待实施 |
| BASE-DATA-01 | implemented | Dexie schema v79；`npm run check:required-tables` 验证 115 张 required/project tables | 产品 owner 语义仍有总纲偏差 |
| BASE-REG-01 | implemented | Context、Field/Adoption、Project Tables 三注册表与架构检查器存在 | 个别产品读取仍可能借兼容层耦合 Project/World |
| BASE-AI-01 | implemented | AI 入口扫描当前报告 39 bindings / 43 calls，区分 formal/auxiliary/evaluation/experimental | 登记证明边界，不证明所有 formal UI 纵切面完成 |
| BASE-HARNESS-01 | implemented | Run contract、ledger、checkpoint、candidate/stale、receipt 及多个 durable use case | 并非所有旧按钮都统一到同样成熟度 |
| BASE-CTX-01 | implemented | Context Gateway、稳定 resource descriptor、manifest、长尾检索和规模夹具存在 | 真实百万字作者长期质量未验证 |
| BASE-MEDIA-01 | partial | 共享 blob/OPFS、媒资需求/资产与 build 绑定基础存在 | 跨 provider 生产、一致性、license 和完整 UI 仍不统一 |
| BASE-PROVIDER-01 | partial | 多 provider 配置、任务路由、能力/上下文配置和连接测试存在 | 市面模型兼容、错误分类与持续契约测试不完整 |

## B · 分步骤长篇与节点

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| B-LF-01 | implemented | `/workspace/:projectId` 是成熟独立分步骤产品入口，Phase 5 主链已合入主干 | ProductHub 自动世界化属于 ARCH-01 的跨产品身份缺陷；不重新判定长篇未完成 |
| B-LF-02 | implemented | races sealed 金切片完成；`WORLDVIEW_GENERATABLE_FIELD_SPECS`、Skill、Gateway、三个 UI 分区及 FIELD_REGISTRY 同源测试覆盖全部现有可生成世界观字段；故事/角色入口已治理 | 未来新增字段继续登记；其它字段是否增加大样本文学评测按真实反馈决定，不是功能缺口 |
| B-LF-03 | implemented | 世界/故事/角色/主支线/大纲/细纲/正文 durable 主链完成；GATE-P3 在隔离项目用真实 API 跑通到章后对账 | 模型质量和未知 Bug 持续观察，不把验收完成的主链降级 |
| B-LF-04 | implemented | ARC-1、PROGRESS-1、FUTURE-1 已完成故事线、角色、七域章后候选和只向未来演化 | 新体验优化属于增量产品维护 |
| B-LF-05 | implemented | 原文/事实/摘要/索引、Context Gateway、遗漏/充分性、远中近与长尾回查已进入长篇主链 | 隐喻、双关和作者未登记伏笔仍需人机协作，是文学边界而非基础设施缺失 |
| B-LF-06 | implemented | 10万/30万/100万字符工程规模门、远距事实/伏笔召回、错世界/未来隔离和真实模型纵切面已通过 | 只能声明理论工程支撑；真实作者长期文学一致性是持续质量研究，不是未完成功能 |
| B-NODE-01 | partial | `node-authoring`、DAG、节点表、工作区、执行与若干 lifecycle 测试存在 | 官方分步骤全流程未完整映射；部分节点能力与分步骤是否同源需逐项证明 |
| B-NODE-02 | partial | 节点表进入 PROJECT_TABLES，具备删除/导入导出基础 | 缺完整跨模式互操作、stale、非法连接和真实 E2E |

## C · 独立创作产品

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| C-SHORT-01 | partial | Work kind/novel profile、短篇目标字数、outline skeleton 和创建入口存在 | 仍与同一 Project/Workspace 表达强耦合；轻量完整产品体验和导出未独立验收 |
| C-SCREENPLAY-01 | partial | adaptation source/brief/plan、screenplay scenes、durable flow 和 Studio 存在 | 大规模源文 mapping、格式导出、刷新/stale/人工审校纵切面未完整验收 |
| C-COMIC-01 | partial | comic page/panel/visual subject/media 表、Skill、durable flow 和 Studio 存在 | 真实生图、人物一致性、气泡/排版与成品导出仍未形成完整产品 |

## D · 世界引擎

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| D-WORLD-01 | partial | world code/version、projection/completeness、release/packaging 与分享基础存在 | 当前每个 Project 被综合页投影为世界；草稿/独立作品/封存世界边界不完整 |
| D-WORLD-02 | partial | Context Gateway、resource descriptor 和多种 product source selection 可复用 | 缺中立 describe/search/read WorldRelease provider、产品 requirement adapter、冻结 SourcePlan、per-run Context Manifests 与发布 SourceManifest；现有产品仍直接解析 manifest/table selection |
| D-WORLD-03 | partial | World/Work、多世界、world link/context 和引用重映射基础存在 | 独立长篇显式发布、世界引用、通道语义和跨世界版本契约需收口 |
| D-WORLD-04 | partial | 上层媒资拥有独立表与共享 blob owner，运行表有 product/session owner | 需 schema/代码审计证明世界投影/导出从不携带上层媒资和状态 |

## E · 上层垂直产品

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| E-TTRPG-01 | partial | 产品 authoring、campaign、production、AI GM runtime、事件/存档、在线 handoff 和大量测试存在 | 中立世界协议适配、完整媒资、权限隔离、真实多人体验和产品级 E2E 尚未封板 |
| E-CHAT-01 | partial | 单/多角色互动、production step/artifact/media/release 与 runtime Skill 存在 | 主 Agent 会谈、多人导演、长期记忆/可见性和完整发布运行体验需验收 |
| E-TOWN-01 | missing | 有 simulation/角色交互和研究性基础代码可复用 | 没有独立 AI 小镇产品的时间、日程、地点、群体与离线演化闭环 |
| E-TEXTADV-01 | partial | authoring/workbench/player、intent/result Skill、runtime 与 production handoff 存在 | 可玩内容/规则/媒资/结局的统一 build/release E2E 不完整 |
| E-AVG-01 | partial | AVG authoring/player、演出审查、game production 与 media 设施存在 | 真实视觉/声音资产、演出绑定和完整体验未验收 |
| E-OPENWORLD-01 | partial | open-world module、quest/scene Skill、player/workbench、simulation 设施存在 | 区域按需模拟、角色自治、长期任务演化与性能门未完整 |

## F · 平台与商业化

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| F-PLATFORM-01 | experimental | 市场、发布、在线房间、托管/能力 gate 等代码存在 | 总纲规定后置；无完整账户、云同步、治理、服务可靠性和隐私运营体系 |
| F-COMMERCIAL-01 | experimental | 部分 commercial/performance/release gate 代码存在 | 当前不进入商业化；计费、合规、支持、SLA 与单位经济未设计/验证 |

## 结论

当前代码的共享底座和许多产品模块明显领先于一般原型。分步骤长篇 Phase 5 工程基线已经完成，不能再以旧任务名重复施工；当前最近工作应集中在 A-GOV-02 七项大架构纠偏和 B-NODE 同源收口。短篇、改编和上层产品随后按各自专项契约开发；平台代码继续隔离和门控。
