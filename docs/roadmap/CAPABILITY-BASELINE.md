# StoryForge 当前能力基线

> 版本：1.9.0 · 基线：2026-09-06 小说转漫画产品交付 · 权威层级：L2
> 本文区分代码存在、纵切面可用和产品完成。旧完成卡不自动恢复权威，但已合入主干并由当前代码/检查器复证的 Phase 5 成果必须保留。

## 状态定义

- `implemented`：明确能力已实现并有当前自动验证，但仍受其声明边界约束。
- `partial`：有真实代码/测试，产品闭环、覆盖或真实体验仍缺。
- `missing`：总纲要求但没有可用实现。
- `experimental`：实现存在但能力门控、非主路径或发展顺序后置。

## A · 治理与共享底座

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| A-GOV-01 | implemented | 总纲、WPS 完整归档、唯一现行文档白名单和当前架构审计已建立 | 后续正常功能分支按协作流程短期存在，不重新解释为长期架构分叉 |
| A-GOV-02 | implemented | 身份/派生、纯语义 WorldRelease、三阶段闸门、五项逻辑契约、中立网关、五种已接入产品适配器、节点同源与能力/成熟度门均已机器化；schema v5 与静态门只允许当前产品身份和运行入口 | 后续产品仍须逐项完成专项功能；治理完成不代表这些产品已经完成 |
| BASE-DATA-01 | implemented | Dexie 当前 schema v5；支持已发布 v1→v2→v3→v4→v5 纯加表迁移并有保留数据反例；`npm run check:required-tables` 验证 106 张 required/project tables；非当前备份和旧字段明确拒绝 | 新表仍必须先登记；后续 schema 演进继续明确支持窗口并补迁移、回滚和生命周期反例 |
| BASE-REG-01 | implemented | Context、Field/Adoption、Project Tables 三注册表与架构检查器存在；Project 仅为 Workspace 壳，World/Work 身份、作品数据和上层产品读取边界已分离 | 后续新入口必须先登记，不得恢复组件私有清单、Project/Work 镜像或物理世界表读取 |
| BASE-AI-01 | implemented | AI 入口注册表与自动生成手册区分 formal/auxiliary/evaluation/experimental | 登记证明边界，不证明所有 formal UI 纵切面完成 |
| BASE-HARNESS-01 | implemented | Run contract、ledger、checkpoint、candidate/stale、receipt 及多个 durable use case | 并非所有旧按钮都统一到同样成熟度 |
| BASE-CTX-01 | implemented | Context Gateway、稳定 resource descriptor、manifest、长尾检索和规模夹具存在 | 真实百万字作者长期质量未验证 |
| BASE-MEDIA-01 | partial | 共享 blob/OPFS、媒资需求/资产与 build 绑定基础存在 | 跨 provider 生产、一致性、license 和完整 UI 仍不统一 |
| BASE-PROVIDER-01 | partial | 多 provider 配置、任务路由、能力/上下文配置和连接测试存在 | 市面模型兼容、错误分类与持续契约测试不完整 |

## B · 分步骤长篇与节点

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| B-LF-01 | implemented | `/workspace/:projectId` 是成熟独立分步骤产品入口，Phase 5 主链已合入；作品内部世界语义 scope 与可分享世界身份分离 | 后续只允许作者通过显式派生动作创建世界草稿，不重新判定长篇未完成 |
| B-LF-02 | implemented | races sealed 金切片完成；`WORLDVIEW_GENERATABLE_FIELD_SPECS`、Skill、Gateway、三个 UI 分区及 FIELD_REGISTRY 同源测试覆盖全部现有可生成世界观字段；故事/角色入口已治理 | 未来新增字段继续登记；其它字段是否增加大样本文学评测按真实反馈决定，不是功能缺口 |
| B-LF-03 | implemented | 世界/故事/角色/主支线/大纲/细纲/正文 durable 主链完成；GATE-P3 在隔离项目用真实 API 跑通到章后对账 | 模型质量和未知 Bug 持续观察，不把验收完成的主链降级 |
| B-LF-04 | implemented | ARC-1、PROGRESS-1、FUTURE-1 已完成故事线、角色、七域章后候选和只向未来演化 | 新体验优化属于增量产品维护 |
| B-LF-05 | implemented | 原文/事实/摘要/索引、Context Gateway、遗漏/充分性、远中近与长尾回查已进入长篇主链 | 隐喻、双关和作者未登记伏笔仍需人机协作，是文学边界而非基础设施缺失 |
| B-LF-06 | implemented | 10万/30万/100万字符工程规模门、远距事实/伏笔召回、错世界/未来隔离和真实模型纵切面已通过 | 只能声明理论工程支撑；真实作者长期文学一致性是持续质量研究，不是未完成功能 |
| B-NODE-01 | implemented | 官方节点动作通过类型化 binding 调用分步骤正式领域 action/Skill；正式模板不能落入通用 `chat()`，实验草稿不能采纳 Canon | 未来新增官方动作必须同时登记映射并补同源回归 |
| B-NODE-02 | partial | 节点表进入 PROJECT_TABLES，具备删除/导入导出基础 | 缺完整跨模式互操作、stale、非法连接和真实 E2E |

## C · 独立创作产品

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| C-SHORT-01 | implemented | 独立 `ShortNovelProductionV1`、六个专属 Skill/durable run、3～8 章工作台、逐章确认、证据审校/定向重写、完成门、append-only `CreationReleaseV1` 及 Markdown/TXT/JSON 导出已通过确定性回归、备份往返和真实 UI E2E | 文学质量和 provider 表现持续评测；不把剧本或漫画能力混入短篇产品 |
| C-SCREENPLAY-01 | implemented | Product Hub 正式入口、冻结来源事实/因果/删改决定、Beat/Scene Card/场景 AST、十个专属 Skill 与 durable run、来源/戏剧双审查、定点修订、完成门、append-only `CreationReleaseV1` 及 Fountain/FDX/打印导出已通过恢复、备份、生命周期、round-trip 和真实 Chromium E2E | provider 表现和人工盲评持续观察；旧一步式剧本候选与完稿入口已拒绝，不把漫画页格或媒资混入剧本产品 |
| C-COMIC-01 | implemented | Product Hub 正式入口、十二阶段专业改编、漫画脚本/分页/显式阅读链/页格/视觉圣经、provider 能力与参考图实传证据、叙事/视觉双审查、定点修复、storyboard/visual 不可变 Release、Release→Blob 强引用及 PNG/WebP/CBZ/PDF 导出已通过恢复、迁移、备份、媒资生命周期和真实 Chromium E2E | provider 缺少 reference/seed/inpainting 时诚实阻断或降级；新 provider 仍须各自完成真实能力与质量验收，不能把 Prompt 声明当实传证据 |

## D · 世界引擎

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| D-WORLD-01 | implemented | 独立作品、内部 scope 与显式 `world-draft` 身份已分离；世界 code/revision、按 World/Work 隔离的语义投影、诚实能力画像和不可变 release/hash 已形成闭环 | 新语义域加入时继续登记覆盖、证据、候选/冲突/遗漏统计 |
| D-WORLD-02 | implemented | `describe/search/read/readOriginalEvidence` 中立 WorldRelease provider、冻结 SourcePlan、per-run Context Manifest、发布 SourceManifest，以及跑团、角色互动、文字冒险、AVG、文字开放世界五个 requirement adapter 已验证 | AI 小镇未来增加自己的 adapter；不得把网关扩成固定万能数据包 |
| D-WORLD-03 | implemented | 长篇/短篇可显式一键派生且保存来源 revision/range/hash；剧本/漫画被拒绝；多世界关系、通道式导航、导入重映射和 World/Work 隔离已有回归 | 产品是否使用跨世界资源由自己的 adapter 与 Brief 决定 |
| D-WORLD-04 | implemented | `PROJECT_TABLES.worldSemantic` 是封存集合唯一来源；WorldRelease、导出和中立读取排除 product production、媒资、build、可执行蓝图、session 与 runtime | 产品媒资与运行状态继续由各产品生命周期测试守门 |

## E · 上层垂直产品

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| E-TTRPG-01 | partial | 已接入中立世界协议、专用需求适配器、统一 Production/Build/ProductRelease v1、AI GM runtime、事件/存档与在线 handoff | 专用生产体验、完整媒资、权限隔离、真实多人体验和产品级 E2E 尚未封板 |
| E-CHAT-01 | partial | 单/多角色互动已接入专用需求适配器、统一 Production/Build/ProductRelease v1、玩家 runtime 与 runtime Skill | 主 Agent 会谈、多人导演、长期记忆/可见性和完整发布运行体验需验收 |
| E-TOWN-01 | missing | 有角色互动和通用产品运行时基础能力可复用 | 没有独立 AI 小镇产品的时间、日程、地点、群体与离线演化闭环 |
| E-TEXTADV-01 | partial | 文字冒险已接入专用需求适配器、统一 Production/Build/ProductRelease v1 和独立玩家面 | 可玩内容、规则、媒资、结局和真实 E2E 仍需专项封板 |
| E-AVG-01 | partial | AVG 已接入专用需求适配器、统一 Production/Build/ProductRelease v1、演出与独立玩家面 | 真实视觉/声音资产、演出绑定和完整体验未验收 |
| E-OPENWORLD-01 | partial | 文字开放世界已接入专用需求适配器、统一 Production/Build/ProductRelease v1、专用运行 API 和独立玩家面；状态演化仅是该产品的内部能力 | 区域按需演化、角色自治、长期任务演化与性能门未完整 |

## F · 平台与商业化

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| F-PLATFORM-01 | experimental | 市场、发布、在线房间、托管/能力 gate 等代码存在 | 总纲规定后置；无完整账户、云同步、治理、服务可靠性和隐私运营体系 |
| F-COMMERCIAL-01 | experimental | 部分 commercial/performance/release gate 代码存在 | 当前不进入商业化；计费、合规、支持、SLA 与单位经济未设计/验证 |

## 结论

分步骤长篇 Phase 5、七项项目级架构治理、世界引擎语义/版本/出口基线，以及短篇、小说转剧本、小说转漫画三个独立产品均已完成当前工程闭环。三者分别拥有正文、场景 AST、页格/媒资与产品专用 Release；只共享经审定的来源分析、durable Harness、注册表、版本外壳和 Blob 基础设施。图片 provider 的能力与质量继续逐家验证；平台代码继续隔离和门控。
