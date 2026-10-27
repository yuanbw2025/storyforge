# StoryForge 当前能力基线

> 版本：2.5.1 · 本次增量核查：2026-10-26 世界引擎与跑团边界集成 · 权威层级：L2
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
| A-GOV-02 | implemented | 身份/派生、纯语义 WorldRelease、`S1 世界封存 → S2 产品定向 → S3 产品执行`闸门、五项逻辑契约、中立网关、当前产品适配器、节点同源与能力/成熟度门均已机器化；schema v11 与静态门只允许当前产品身份和运行入口 | 后续产品仍须逐项完成专项功能；治理完成不代表这些产品已经完成 |
| BASE-DATA-01 | implemented | Dexie 当前 schema v11；保留 v1～v10 的加表/索引升级（含 Brief hash 索引调整与聊天草稿兼容桥）；`npm run check:required-tables` 本轮验证 128 张 required/project tables；备份 v16，v14/v15 严格校验后可沿显式版本链转换；旧字段和其他不支持版本拒绝 | 新表仍必须先登记；后续 schema 演进继续明确支持窗口并补迁移、回滚和生命周期反例 |
| BASE-REG-01 | implemented | Context、Field/Adoption、Project Tables 三注册表与架构检查器存在；Project 仅为 Workspace 壳，World/Work 身份、作品数据和上层产品读取边界已分离 | 后续新入口必须先登记，不得恢复组件私有清单、Project/Work 镜像或物理世界表读取 |
| BASE-AI-01 | implemented | AI 入口注册表与自动生成手册区分 formal/auxiliary/evaluation/experimental | 登记证明边界，不证明所有 formal UI 纵切面完成 |
| BASE-HARNESS-01 | implemented | Run contract、ledger、checkpoint、candidate/stale、receipt 及多个 durable use case | 并非所有旧按钮都统一到同样成熟度 |
| BASE-CTX-01 | implemented | Context Gateway、稳定 resource descriptor、manifest、长尾检索和规模夹具存在 | 真实百万字作者长期质量未验证 |
| BASE-MEDIA-01 | partial | 共享 blob/OPFS、媒资需求/资产与 build 绑定基础存在 | 跨 provider 生产、一致性、license 和完整 UI 仍不统一 |
| BASE-PROVIDER-01 | partial | 多 provider 配置、任务路由、能力/上下文配置和连接测试存在；Codex 本机订阅适配见 [施工契约](./CODEX-PROVIDER.md)，需运行本地服务 | 市面模型兼容、错误分类与持续契约测试不完整 |

> UI 展示预览（2026-09-14）：首页可显式进入 `/storyforge/ui-preview/index.html`，查看正在调整的 199 个示例页面。该入口独立于正式业务，不读取/写入作品数据库或调用 AI，不改变以下产品能力状态。

> 首页正式接入（2026-09-15）：`/` 与 `/home/*` 使用真实 Work/World、创作任务、发布记录、续写位置、本地搜索、共享设置及备份服务；作品封面由作者选择图片并明确保存。正常首页和 `?tab=home` 已统一；`?tab=home&legacy=1` 仅保留旧工具兼容回归。纯 UI 预览继续独立。首页不新增 AI 调用，不直接采纳候选，不把未接入新版界面的产品标成已完成；印刷装帧、封面生成历史不在此次接入范围。

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
| B-NODE-02 | partial | 节点表进入 PROJECT_TABLES；节点维护已补作者要求、候选修订/拒绝持久化、局部执行、运行证据恢复、跨模式字段与角色采纳、非法连接、备份往返/删除隔离与窄屏 E2E；自由编排维护覆盖双向拖线搜索、前后建点、已有端口连接、提示词版本和参数实际生效 | 仍须逐个官方长篇模板完成跨模式生产验收，不据局部维护提升整体成熟度 |

## C · 独立创作产品

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| C-SHORT-01 | implemented | 独立 `ShortNovelProductionV1`、六个专属 Skill/durable run、3～8 章工作台、逐章确认、证据审校/定向重写、完成门、append-only `CreationReleaseV1` 及 Markdown/TXT/JSON 导出已通过确定性回归、备份往返和真实 UI E2E | 文学质量和 provider 表现持续评测；不把剧本或漫画能力混入短篇产品 |
| C-SCREENPLAY-01 | implemented | `/script` 九页正式入口与 Work 选择、原作导入/章节范围、冻结来源事实/因果/删改决定、Beat/Scene Card/场景 AST、十个专属 Skill 与 durable run、来源/戏剧双审查、定点修订、完成门、append-only `CreationReleaseV1` 及 Fountain/FDX/打印导出已通过恢复、备份、生命周期、round-trip 和真实 Chromium E2E | provider 表现和人工盲评持续观察；旧一步式剧本候选与完稿入口已拒绝，不把漫画页格或媒资混入剧本产品 |
| C-COMIC-01 | implemented | Product Hub 正式入口、十二阶段专业改编、漫画脚本/分页/显式阅读链/页格/视觉圣经、provider 能力与参考图实传证据、叙事/视觉双审查、定点修复、storyboard/visual 不可变 Release、Release→Blob 强引用及 PNG/WebP/CBZ/PDF 导出已通过恢复、迁移、备份、媒资生命周期和真实 Chromium E2E | provider 缺少 reference/seed/inpainting 时诚实阻断或降级；新 provider 仍须各自完成真实能力与质量验收，不能把 Prompt 声明当实传证据 |
| C-MOTION-DRAMA-01 | implemented | Product Hub 三种来源入口、冻结 Novel Work、系列/物料圣经、八个专业 Skill 与 durable 候选确认、逐集节拍/剧本/分镜、图片与试听音频版本、Image/Video Prompt IR、Seedance/Runway/LTX/generic 确定性适配包、双成熟度质量门、不可变 Release、v6 生命周期与隔离 Chromium E2E 已形成闭环 | 不包含视频生成、选片、剪辑、混音和成片；第三方能力变化继续通过 adapter 维护和目标工具实测，不把宣传能力当稳定合同 |

## D · 世界引擎

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| D-WORLD-01 | implemented | 独立作品、内部 scope 与显式 `world-draft` 身份已分离；世界 code/revision、按 World/Work 隔离的语义投影、诚实能力画像和不可变 release/hash 已形成闭环 | 新语义域加入时继续登记覆盖、证据、候选/冲突/遗漏统计 |
| D-WORLD-02 | implemented | `describe/search/read/readOriginalEvidence` 中立 WorldRelease provider、冻结 SourcePlan、per-run Context Manifest、发布 SourceManifest，以及跑团、角色互动、AI 小镇、文字冒险、AVG、文字开放世界六个 requirement adapter 已验证 | 当前六 adapter 共用 helper；entityKeys/storyArcKeys/timeRange 搜索未执行过滤。已有生产编译精确资源/依赖 mandatory original 门；不能据此宣称人物视角、事件/因果查询完整 |
| D-WORLD-03 | implemented | 长篇/短篇可显式一键派生且保存来源 revision/range/hash；剧本/漫画被拒绝；多世界关系、通道式导航、导入重映射和 World/Work 隔离已有回归 | 产品是否使用跨世界资源由自己的 adapter 与 Brief 决定 |
| D-WORLD-04 | implemented | `PROJECT_TABLES.worldSemantic` 是封存集合唯一来源；WorldRelease、导出和中立读取排除 product production、媒资、build、可执行蓝图、session 与 runtime | 产品媒资与运行状态继续由各产品生命周期测试守门 |

### D-NW · 叙事世界基座增量（身份/时间/codec 与评测已形成，领域投影/查询待实施）

[专项权威](../products/WORLD-ENGINE.md) §10～23 统一事实、IR、索引、查询、推演边界、施工包和 NW-0B/NW-1A 实测，不重开已完成 D-WORLD 基础，也不降级长篇主链。

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| D-NW-EVAL | implemented | NW-0B：12 原创场景族、120 查询、48 修改、4 族留出；真实当前接口结果与 10 项缺口冻结 | 只完成确定性评测基线/守门；独立人工、模型、规模与增强能力未验收 |
| D-NW-IR | partial | temporalFacts、knowledgeLedger、事件/故事线、WorldRelease 语义快照、候选/采纳已有；NW-1A 实现稳定身份、分轴时间、八类 exact codec、证据/hash/引用校验及同考卷复测 | NW-1B 已加入注册领域注释、八类确定性 projector、确认 CAS、证据/依赖/可见范围闭包与备份 v16；工程验证见 WORLD-ENGINE §24。作者 UI/durable 候选采纳待 NW-1C，冻结 v4/查询待 NW-2A/2B；旧 provider 缺口保持 |
| D-NW-INDEX | missing | v3 有按行目录与部分关系；Work 的检索块/层级摘要为非导出缓存 | 冻结 Narrative Index、原子证据闭包、版本化便携包与无向量查询待 NW-2A/2B/2E |
| D-NW-COMPILER | partial | 六 adapter/plan/manifest 与确定性编译依赖闭包存在 | 完整精确选择、产品级禁止、视角/能力声明接缝待 NW-2C，各产品完整 Compiler 另验 |
| D-NW-IMPACT | partial | 章级 edit impact、stale、修复 Harness 存在 | 世界字段/证据依赖、误伤/漏更新及增量等价验收待 NW-2D |
| D-NW-DYNAMICS | missing | 上层产品有各自状态机；中立 provider 无 validate/simulate | §15 只确定未来合同，Phase 2 后另行授权实施 |

## E · 上层垂直产品

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| E-TTRPG-01 | partial | 已接入中立世界协议、专用需求适配器、统一 Production/Build/ProductRelease v1、AI GM runtime、事件/存档与在线 handoff；独立跑团 UI 已接作品库、无世界 S2 保存、九步配置与提案、实际制作检查发布、产物查看和团局 | 逐字段产物编辑、完整媒资、公共服务权限隔离、真实多人体验及产品整体验收尚未封板；本行描述既有 scripted 能力，标准格式另见 E-TTRPG-OPEN-01，不因新方案降级或翻绿 |
| E-TTRPG-OPEN-01 | missing | 开发分支已接入 open V2 的授权/规则结算与恢复、来源/知识、作者生产发布、Oracle/事实/压力/局势、人工/AI KP 与队友、四门/阶段收束和 P7 实际上下文检视；P8 已有 schema v12/备份 v16 与人工记忆 E15、本人档案、稳定祖先来源及切点复制，玩家/真人主持的手写记忆与明确分享桌面。正常作者页面发布/恢复、旧 scripted 跑团及故障恢复已有隔离浏览器与定向工程证据，详见 [现行方案](./TTRPG-DEVELOPMENT-PLAN.md) §35.48–§35.56；这些是分支代码与工程结果，公共入口仍默认隐藏 | 首期联合真实验收尚未完成，维持 missing；P8 AI 候选/adopt 与注册召回，P9 扩展、P10 媒资/音频/长局、规则问答/分发和真实 provider/独立玩家仍需完成；不得据 fixture 或构建证明产品交付 |
| E-TTRPG-OPEN-02 | missing | 长局口径已定义；schema v12 纯加表、旧备份明确转换及人工记忆的事件/表原子确认、祖先删除与多次完整导入已有工程证据。正式 AI 长记忆、world patch 与 open 真实 provider 连续长局/成本质量基线仍待完成 | 需连续 30 个 worldTurn 以上真实模型记录、Oracle 复算/征兆前置均 100%、事实矛盾/可继续率、回退/分支与一次补丁导出审阅；AI 候选采用和注册召回继续开发，工程回归不能替代真人或商业验收 |
| E-CHAT-01 | partial | 单/多角色互动已接入独立 S2 草稿、主 Agent 候选确认、专用需求适配器、统一 Production/Build/ProductRelease、玩家对话、关系记忆及检查点分支；私密消息过滤、导演决策与部分回复恢复已有回归 | 当前为纯文字；商业内容质量、超长会话与更多模型供应商的实测仍需验收 |
| E-TOWN-01 | partial | 已有专属 Brief/SourceSelection/adapter、Production/Build/ProductRelease、六时段语义地图、居民日程、知识隔离、证据化对话记忆、关系/轻经营、离线演化、检查点/分支、14 日回放、重大变化确认、durable 自治导演、产品专属地点/肖像/表情/环境音媒资 lane、玩家界面与冻结 Build 浏览器旅程 E2E；新版作者界面接入独立 S2 草稿、可恢复会谈候选、来源选择、生产检查与分区游玩 | 真实模型长期角色一致性、真实媒体 provider 的肖像/音频质量、权利/成本/性能回执及非 fixture 浏览器商业验收仍需继续 |
| E-TEXTADV-01 | partial | `/adventure/:pageId?` 已接真实产品入口；冻结 WorldRelease 可进入文字冒险专属 Brief、专业 Agent/Skill DAG、候选工件、规则/任务/场景/对白编译、媒资需求与 Build 绑定、静态质量门/自动游玩、可玩 Preview、确定性事件与存档、不可变 ProductRelease，以及含媒资候选包导出/隔离导入回环；相关定向和浏览器 E2E 已登记 | 真实模型生成的文学质量、真实 provider 媒资、浏览器性能、双角色真人试玩及首个社区推荐成品仍需在每个实际 Build 上完成验收；工程纵切面通过不等于内容成品完成 |
| E-AVG-01 | partial | `/avg/:pageId?` 已接真实作品库、无世界可保存的 S2 草稿、主 Agent 会谈候选回填、冻结版本引用、统一 Production/Build/Release、作者剧情/演出/媒资修订及玩家存档；schema v7 草稿与素材参与备份生命周期 | 通用外部模型生成的完整文学/视听质量与商业标准仍需逐作品验收；原型与内部评审不得冒充商业完成 |
| E-OPENWORLD-01 | partial | `/openworld/:pageId?` 已接真实 S2/S3 产品入口；专属 Creator P0～P10/V1～V3、受治理 Artifact、Build/质量门、不可变 ProductRelease、纯 vNext Runtime、确定性 Action/Event/存档、主支线与动态任务、区域按需演化、角色运行规则、战斗/成长/经济、程序地图和专属玩家面均有当前自动验证；2026-10-13 产品化分支增加三线职责/阻塞/费用总览、V3 v2 来源快照、逐图人工确认及本地体验分类导出（未合并/未部署） | 尚缺作者使用真实独立第二模型取得叙事质量/重复/时长/成本校准回执、真人完成至少两个结局并评分，以及基于真实问题发布直接后继修复版并完成旧档复测；工程闭环不能冒充这些外部事实 |
| E-MIST-HARBOR | implemented | 内置《雾港：失潮钟声》：文字冒险与 AVG 两种玩法、原稿 18 节点/158 节拍/三结局、17 项原版美术；从明确开始经世界版本、正式生产发布到独立存档，支持完整备份恢复 | 预写作品，无运行时模型对话或配音；不提升通用产品成熟度 |
| E-BUILTIN-3D | implemented | 《潮痕：最后一盏灯》《远日点：第七码头》《潮痕：两声之间》随源码提供；文字开放世界玩家页入口、确定性生产发布、3D/文字探索、分支与存档，回归和浏览器验证 | 预写作品；无运行时模型对话或配音，不提升通用产品成熟度 |

> 页面状态（2026-09-25）：文字冒险和文字开放世界均已从通用 UI 占位页切换到各自真实 S2/S3 生产与玩家入口；文字开放世界另提供《盐脊：断流之夜》20—30 分钟内置纵向展示，经真实 WorldRelease、scheduler、ProductRelease 和 Session 路径运行。它证明核心系统闭环，不等于 3—5 小时完整验收世界、真实模型质量或商业验收已经完成。

## F · 平台与商业化

| ID | 状态 | 当前事实与证据 | 缺口 |
|---|---|---|---|
| F-PLATFORM-01 | experimental | 市场、发布、在线房间、托管/能力 gate 等代码存在 | 总纲规定后置；无完整账户、云同步、治理、服务可靠性和隐私运营体系 |
| F-COMMERCIAL-01 | experimental | 部分 commercial/performance/release gate 代码存在 | 当前不进入商业化；计费、合规、支持、SLA 与单位经济未设计/验证 |

## 结论

分步骤长篇 Phase 5、七项项目级架构治理、世界引擎语义/版本/出口基线，以及短篇、小说转剧本、小说转漫画、漫剧前期生产四个独立产品均已完成当前工程闭环。四者分别拥有正文、场景 AST、页格/媒资或逐镜提示词包与产品专用 Release；只共享经审定的来源分析、durable Harness、注册表、版本外壳和 Blob 基础设施。图片、音频和视频工具能力继续逐家验证；平台代码继续隔离和门控。
