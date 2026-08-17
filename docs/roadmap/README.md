# StoryForge 开发路线图

> 这是 StoryForge 当前与未来的开发入口。它只承载“现在做什么、为什么做、做到什么算完成”，不再承载全部历史实现流水账。
>
> 相关文档：
> - [世界引擎与社区目标架构](../WORLD-ENGINE-COMMUNITY-ARCHITECTURE.md)：纠正世界、作品、实例和社区的领域层级，保护分步骤模式并登记 WORLD-2 / PLATFORM-1 后续阶段。
> - [当前能力基线](./CAPABILITY-BASELINE.md)：新体系或完整功能读取对应章节，记录代码当前已经具备什么。
> - [已完成索引](./COMPLETED.md)：按功能体系索引已交付能力、测试证据和历史记录。
> - [Agent + Harness 重构交接](../AI-HARNESS-REBUILD-HANDOFF-20260810.md)：跨电脑或跨模型接续当前功能分支时先读，包含完成度、验证状态和下一步入口。
> - [Agent + Harness 大架构更新说明](../AI-HARNESS-REBUILD-RELEASE-20260817.md)：面向项目整体的当前架构、用户价值、验证证据与诚实边界。
> - [记忆工程完整施工方案](../MEMORY-ENGINEERING-DEVELOPMENT-PLAN-20260817.md)：当前主体系的目标、硬盘可编辑映像、人工自检、双向同步、Harness 沉淀、施工顺序和验收门。
> - [记忆工程收口纲领](../MEMORY-ENGINEERING-CLOSURE-CHARTER-20260817.md)：在已完成 MEMORY-0～10 基线上冻结 Deep Audit durable 化、选择性语义投影和真实长篇验收的后续边界。
> - [历史完整快照](../ROADMAP-LEGACY.md)：本分支拆分前 `HEAD:docs/ROADMAP.md` 的原始内容，只读保存，不作为新的施工入口。
> - [项目宪法](../../CLAUDE.md) 与 [施工蓝图](../MASTER-BLUEPRINT.md)：所有功能都必须服从三注册表和 Blueprint 的完成定义；读取范围由 [上下文路由](../CONTEXT-ROUTING.md) 决定。

**迁移安全**：`docs/ROADMAP-LEGACY.md` 与本分支拆分前的 `HEAD:docs/ROADMAP.md` 字节级一致，共 3181 行，SHA-256 为 `e497de7d0f8100489bdcb3a7b3fcb528d07024b9dcb832f7de6e2701d584667d`。任何任务信息丢失或状态不明，先回到历史快照核对，不凭记忆补写。

## 已完成基线：MEMORY 记忆工程

Harness 与 CREL 工程重构已经完成，`MEMORY-0～10` 也已完成施工。它没有新增一个松散“记忆库”，
而是让 Harness 的候选、作者决定、正式 Canon/正文/状态和完成回执长期沉淀，并在 IndexedDB 与作者
硬盘之间形成可读、可编辑、人工触发、三方核对、可恢复的双向工作区。权威边界、数据合同、
`MEMORY-0～10` 施工顺序和完成定义见
[记忆工程完整施工与验收记录](../MEMORY-ENGINEERING-DEVELOPMENT-PLAN-20260817.md)，作者操作、恢复、
隐私和费用边界见[本地记忆工作区指南](../MEMORY-WORKSPACE-GUIDE.md)。

`MEMORY-CLOSE-1～3` 已完成：Fast Guard / Deep Audit 已进入 durable Harness 与统一记忆结算；首批
`storyCores`、`creativeRules` 已按 Work 输出可双向编辑的中文 YAML；隔离的十万字级代表性长篇、
多 World/Work、冲突、中断、清库恢复、历史 Run 重绑定和恢复后继续创作已形成回归证据。完成边界与
诚实样本说明见[记忆工程收口纲领](../MEMORY-ENGINEERING-CLOSURE-CHARTER-20260817.md)。后续不重开本轮，
也不以“全表可编辑”为目标；新增语义投影仍须逐表通过准入门。

旧文件夹绑定后的“进入即覆盖 + 五分钟覆盖”路径已经下线。绑定、重新授权和检查均为零写入；稳定身份、
共同基线、冲突检测、事务恢复、显式采纳和真实文件系统往返均已通过测试。长期一致性以结构化 Canon、
状态账本、时间线、来源证据和依赖图为主，embedding 只允许作为可删除、可重建、无裁决权的可选派生索引。
每个新 Harness 成功、失败或取消终态都在同一 IndexedDB 事务内追加显式记忆结算；该结算只标记硬盘待
人工同步，不建立后台写盘旁路。

## 已完成基线：CREL 创作可靠性工程

`feat/harness-creative-reliability` 在已完成的 Agent + Harness 基线上补齐有限成本下的可用创作交付，
不新增平行 Agent、数据库或模型旁路。权威范围、数据合同、CREL-0～14 施工顺序和发布门见
[创作可靠性工程开发文档](../AI-CREATIVE-RELIABILITY-DEVELOPMENT-20260816.md)。

该工程已通过 PR #63 合入 `main@5021094`，并于 2026-08-17 按
[社区观察产品决策](../adr/HARNESS-COMMUNITY-VALIDATION.md)正式收口。独立作者 A/B 与原预注册社区质量门
不再作为待开发或交付阻塞项；状态是“由产品决策关闭/取代”，不是“已经通过”。

`CREL-0～12` 的生产主路径、成本边界和版本化本机回滚开关已经完成；`CREL-14` 的生产可见实验边界、
费用说明和纯本地结构化反馈入口也已完成。`CREL-13` 已完成三轮真实 Development 和唯一一次 sealed
held-out。前两轮分别暴露布尔 `turningPoint`/事件上限/verifier 截断，以及损坏的可选卷范围误杀、
修复重写劣化和默认输出冗长；所有失败 checkpoint 原样保留。v6 第三轮取得 CREL 100% 可编辑/可采纳、
单次生成、85.8% 语义和机器门 PASS。随后封存集同样取得 100% 可编辑/可采纳、单次生成、83.3%
语义和 100% 叙事推进，但 token/可采纳倍率为 1.5144，略超 1.5 预注册门槛，因此机器门诚实 FAIL。
逐例归因、用量、hash 和本地 checkpoint 位置见
[CREL-13 真实评测证据](../evals/CREL-13-DEVELOPMENT-EVIDENCE-20260816.md)。封存集已经消耗，禁止据此
调参、放宽门槛或重跑；独立作者 A/B 盲评仍为 0/6。当前以实验性入口进入社区观察，收集作者主动
提交的采用结果、修改时间和闭集问题，不宣传“替作者完成 80%”。路线图不再为旧 A/B 或旧质量门保留
施工项；社区出现集中问题时再建立新的有界任务。
首个冻结质量评测入口仍为 `outline.story-arcs`，不能用其它入口的本地测试代替该 development/held-out 门。
生产路径审计同时发现并已收口官方领域节点创作链的直接调用旁路：卷/章纲、细纲和正文现在都保存
`CreativeArtifactV1` 与成本证据，阻断原稿可编辑，采纳后复用已完成上游而不重复付费；该收口不改变
冻结评测集，也不构成历史质量门已通过的证据。

## 一、开发单位标准

| 类型 | 定义 | 交付要求 |
|---|---|---|
| **体系（Portfolio）** | 围绕同一用户目标、共享数据模型或基础能力的一组完整功能 | 先确定边界和依赖；阶段可交付，但不允许平行数据或平行入口 |
| **完整功能（Feature）** | 用户能独立理解、使用和验收的一条端到端能力 | UI、数据、读写、迁移、测试、文档一起收口 |
| **小功能（Micro-feature）** | 价值独立、边界封闭、不会被近期体系重写的能力 | 必须登记归属、范围、非范围、验收和“不重复建设”判断 |
| **Bug / 回归** | 已有承诺行为失效，不创造新产品能力 | 独立 `fix/` 流程；修复后补反例测试，不改变功能组合边界 |
| **治理任务** | 守住架构、安全、发布和文档可信度的工程工作 | 有可测量门槛，不能用无边界重构替代产品交付 |

### 开工登记卡

新体系、完整功能或小功能进入施工前，必须登记：

1. 稳定 ID、名称、类型和用户故事。
2. 主归属、复用的已有能力、会取代/下线的旧入口。
3. 范围与非范围、外部依赖、内部阶段。
4. 四问：读什么、写什么、哪些表参与生命周期、缺失哪个注册表。
5. schema/迁移/导入导出/删除/兼容判断。
6. 端到端验收、反例测试、CI、浏览器/API 验收和文档收口。

默认同一时间只推进一个主体系；最多附带一个无数据红线、不会被主体系重写的小功能。紧急 Bug 可以插队，但修完回到原体系。

### HARNESS-86 完成卡：真实故事线 Generator 主路径 A/B

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-86` 真实质量与发布治理任务。必须用同一 generator 身份比较实际旧故事线入口和生产 `outline.story-arcs` Agent + durable Harness，逐调用保留质量、完成率、成本、延迟和恢复证据；协议失败或环境阻断不能被隐藏，开发者也不能代替独立人工盲评。 |
| 主归属 / 复用 | 归 H4/H5 generator 主路径；复用现有故事线 Context/Skill/Run/候选链、旧 `b6b57f4` prompt/parser、H28 hash/checkpoint 思路、共享 `chat()` 和 DeepSeek V4 Pro 独立 verifier。6 个中文合成世界不含作者手稿。评测只用版本化浏览器存储，不新增项目表、Context Source、可写字段或 Canon 写入。 |
| 协议 / 恢复 | 两路交叉执行；逐调用冻结 variant/stage、身份、prompt、input/output/trace hash、provider usage、成本与延迟。Agent 同一 Run 只允许一次受控恢复，重复指纹停止。生产响应收口为 exact-key `{"storyArcs":[...]}`，JSON object capability 由中央 provider registry 独立登记。机器门要求 6/6 完成、durable 6/6、零泄漏、全量 usage、质量非劣及 p95/token/cost ≤ 1.5x；之后仍需 6 个完整配对的 hash 绑定 A/B 盲评。 |
| 真实结果 / 发布门 | 最终 v4 中旧入口和 Agent 都只完成 2/6；Agent 成功子集 semantic 0.95、required-fact coverage 29.17%，无未来/错世界泄漏，但 p95/token/cost 为旧入口 1.819x/3.817x/4.773x。旧入口 8/8、Agent 18/18 调用均完整计量。机器门因完成率、durable coverage 与三项预算 FAIL；只有 1 个双方成功配对，人工盲评 fail closed，`productionReleaseAllowed=false`。 |
| 验收 / 下一步 | H17/H29/H30/H86 联合定向回归 4 files / 37 tests；完整 CI 为 376 files / 1829 tests，覆盖率 statements/lines 82.12%、branches 73.80%、functions 80.45%，3,786-module 构建与 bundle budget 通过。故事线精确 Chromium 路径 1/1、最终完整套件 52/52（4.6 分钟）通过。五份 `0600` 归档的内部 checkpoint hash、文件 SHA-256、失败分类和 aggregate 见 `docs/evals/HARNESS-86-STORY-ARC-MAIN-PATH-EVIDENCE-20260815.md`。不得继续抽样 v4 追结果；若重开发布研究，须冻结新 generator development/终验协议或使用已证明稳定遵守结构化输出的 generator。 |

### HARNESS-85 完成卡：已验真证据二阶段 subtype adjudication

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-85` 评测可靠性任务。第一阶段已找到并逐字验证证据时，独立判类调用只能读取证据对与通用 taxonomy，必须物理隔离第一阶段标签/摘要和 hidden labels；每一次真实调用、失败与恢复都要可审计，不能把两阶段折叠成一个 attempt。 |
| 主归属 / 复用 | 归 H4/H5；复用 H84 Agnes judge v7 完整 checkpoint、H28 artifact/checkpoint/scorer、同一 40+20 fixture 和共享 `chat()`。不新增表、Context Source、可写字段、业务模型入口或生产 gate。 |
| 协议 / 恢复 | H85 checkpoint 内嵌验签父 checkpoint，逐调用冻结 stage、身份、trace/input/output hash、usage 和 derived issue set。零候选零调用；协议 repair 最多两次。403 等非重试型 4xx 单次终止；429/瞬时失败单次后 `provider-blocked`，仅显式继续才调用，旧两次 429 checkpoint 保持可验可续。设置页支持父 checkpoint 导入、H85 独立恢复、两阶段 aggregate 和只读 JSON 降级导出。 |
| 真实结果 / 发布门 | 同模型 Agnes 历史 development 为 26/7/6、78.8%/81.3% 且 usage 不完整，FAIL。冻结同一 H85 协议、改用独立 `deepseek-v4-pro-260425` 判类后，development 29/3/3、precision/recall 90.6%/90.6%、80/80 调用全部计量，门禁 PASS；随后一次性运行 sealed held-out，H4 父结果 11/7/5，H85 后 14/4/2、precision/recall 77.8%/87.5%、evidence 19/19，但 precision 与 1/2 intent escalation 令门禁 FAIL。生产 gate 继续关闭。 |
| 验收 / 下一步 | H85 runner 10 项、设置 UI 7 项及相关 H17/H28/H82～H84/双文本模型联合回归 15 files / 121 tests 已通过；父子 development/held-out checkpoint 均由仓库验签器和 sealed scorer 复算，全部真实调用有 usage。自包含 artifact、aggregate、hash、用量和本机归档见 `docs/evals/HARNESS-85-TWO-STAGE-ADJUDICATION-EVIDENCE-20260815.md`。held-out 已消耗，禁止据此调参；真实 generator 主路径 A/B、人工修改量/完成率/p95 与独立人工复核仍须另行完成。 |

### HARNESS-84 完成卡：verifier taxonomy 校准与失败重试收口

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-84` 评测可靠性任务。真实 verifier 已找到正确证据却错分相邻 subtype 时，taxonomy 必须提供可审计操作定义和判别边界；协议修复不得因修 A 坏 B、同输入盲重试或重复不可恢复 4xx 耗尽预算。 |
| 主归属 / 复用 | 归 H4/H5；复用 H28 artifact/checkpoint/scorer、H83 repair binding、同一 40+20 fixture 和共享 `chat()`。不新增表、业务写入、模型入口或生产自动 gate。 |
| 协议 | judge v5 冻结 19 subtype 中文操作定义/边界；v6 加 8 项上限和 clean exact 空根；v7 为 repair 加不含旧输出/标签的静态全约束复核。v1～v6 消息/归档继续可验。每例最多三次且相同 repair 不再调用；非重试型 4xx 一次终止。 |
| 真实结果 / 发布门 | Agnes v7 完成 40/40，TP/FP/FN 21/13/11，precision/recall 61.8%/65.6%，evidence 36/36，intent 与 clean 控制均 0 误升级，仍 FAIL。Doubao v7 被方舟 `403 AccountOverdueError` 在 0/40 阻断，当前 runner 实测只调用一次并记录 unmetered failure。held-out 继续锁定。 |
| 验收 / 回滚 | 定向 report/runner/UI/transport 7 files / 42 tests 通过，覆盖旧 prompt 隔离、v7 repair 全清单、8 项上限、不同错误第三次恢复、相同 repair 提前停止和不可恢复 4xx 单次终止；完整 CI 374 files / 1805 tests、生产构建与 bundle budget 通过，项目 Chromium E2E 52/52（4.6 分钟）。真实 aggregate、hash、用量和失败归档见 `docs/evals/HARNESS-84-TAXONOMY-CALIBRATION-EVIDENCE-20260815.md`。下一步只能以诚实多调用 artifact 验证候选证据的定向 adjudication，不能继续扩大单轮提示词后宣称可靠。 |

### HARNESS-83 完成卡：不泄漏标签的 verifier 确定性纠错

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-83` 评测可靠性任务。H4 verifier 的首次协议失败不能在 temperature 0 下原样重试；第二次尝试必须得到可验签、不可注入、无标签泄漏的闭集纠错输入，并保留全部严格 parser 门。 |
| 主归属 / 复用 | 归 H4/H5；复用 H28 artifact/checkpoint、H82 JSON object transport、同一 40+20 fixture 和共享 `chat()`，不新增表、业务写入、模型入口或第二套 runner。 |
| 纠错契约 | judge v4 把确定性错误码映射到六种静态 reason；不传上一轮输出、错误 message、引文或 hidden labels。artifact `judgeRepair + judgeInputHash` 与 checkpoint 前一 attempt 失败码共同验签；provider/网络错误不伪造成协议反馈。v1/v2/v3 artifact/checkpoint 继续可验证。 |
| 真实结果 / 发布门 | Doubao 与 Agnes v4 都从中途终止提升到 40/40，但 TP 均为 15/32：Doubao precision/recall 为 51.7%/46.9%，另有 2/2 clean 硬误报；Agnes 为 45.5%/46.9%。逐字 evidence 均 100%。协议完成不等于质量通过，held-out、fan-out 和自动语义审查继续锁定。 |
| 验收 / 回滚 | 相关 report/runner/UI/transport 定向回归 5 files / 31 tests 通过，覆盖闭集映射、无 raw output/label 泄漏、输入 hash、纠错绑定篡改和旧版本兼容；完整 CI 373 files / 1798 tests、项目 Chromium E2E 52/52 通过。真实 checkpoint 已验签并以 `0600` 归档，aggregate 见 `docs/evals/HARNESS-83-VERIFIER-REPAIR-EVIDENCE-20260815.md`。移除 v4 可回到 v3，但会恢复无效的同输入重试，不能删除严格 parser。 |

### HARNESS-82 完成卡：真实 verifier 证据与双模型会话凭证隔离

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-82` 评测与发布治理任务。开发者可用两个真实文本 provider 运行 H4 development，并取得可恢复、可复制、可验签的质量、token、成本、延迟和失败证据；未记住本机的多预设 API Key 必须按预设隔离，不能在切换 provider 时串用。 |
| 主归属 / 复用 | 归 H4/H5 评测发布；复用 `h4-synthetic-zh-60-v1`、H28 runner/scorer/browser checkpoint、共享 `chat()` 和 AI 预设，不新增表、Canon、模型入口或平行评测运行时。 |
| 范围 / 非范围 | 增加 judge v2 的逐字唯一证据协议与 v3 JSON object transport；页面明确区分静态合成 generator 与真实 verifier，展示最后失败、完整 checkpoint hash、验证用量/估算成本/累计延迟，并提供完整性校验后的剪贴板备份。真实 generator 质量、主路径 A/B、人工 held-out 和质量净收益不在本单元内，不能拿 H4 verifier 结果冒充。 |
| 凭证 / 隐私 | session-only 预设 Key 以 preset id 写入 `sessionStorage`，刷新和任务路由可恢复；localStorage 预设继续只保存空 Key。应用无会话 Key 的异 provider 预设不再继承当前 provider Key；删除预设同步删除会话 Key。零凭证进入仓库、日志或 checkpoint。 |
| 真实结果 / 发布门 | Doubao v1 为 16/40、80% precision、75% recall 后因非唯一引文终止；Agnes v1/v2/v3 分别在 2/40、13/40、14/40 终止；Doubao v3 为 16/40、61.5% precision、50% recall 后终止。所有证据回查为 100%，各 checkpoint 已以 `0600` 权限归档到本机 Downloads，去内容化结果见 `docs/evals/HARNESS-82-REAL-MODEL-EVIDENCE-20260815.md`。两模型均未达到 90%/80% development 门，因此 held-out 继续锁定，fan-out、原生 tool transport 和自动语义审查继续默认关闭。 |
| 验收 / 回滚 | H4 report/runner/storage/UI、JSON transport、预设存储与真实任务路由定向回归 85/85，通过完整 `npm run ci`（1,794 tests）与隔离 `npm run ci:e2e`（52/52）；旧 judge v1/v2 artifact 继续可验签，v3 只增加受版本绑定的 JSON object 请求。移除 v3 可回到 v2 严格文本 JSON，移除 session preset key 可回到单全局会话 Key，但不得重新允许跨 provider 继承。 |

### HARNESS-81 完成卡：H57 下游执行器政策闭集

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-81` 治理任务。作者恢复 fresh H57 current plan 时，每一种计划节点都必须命中显式、可审计的执行器政策；新增或错配的 kind/action/table 组合不能静默退回通用复核，更不能意外获得模型或写权限。 |
| 主归属 / 复用 | 归 `HARNESS-2` 反向反馈通用 DAG；复用 H50 作者复核与 H52～57 可信人工入口、H58 确定性重建、H77/H79 生成式 child 和 H80 canonical schedule，不新增 Agent、模型入口、表或平行状态机。 |
| 范围 / 非范围 | 闭集登记 changed source、fact、source record、summary、retrieval、outline、downstream chapter、storyline progress/crossing、state card、item ledger 与 timeline event 的唯一执行边界。H40/H63/H20 的耦合/整章集合流程不能冒充 H57 单记录 CAS，因此本单元不新增第三个生成式目标，不自动改正文、事实或派生集合。 |
| 读 / 写 / 生命周期 | 只读取 H57 已冻结 item 与来源章纲 ID，精确核对 item/node identity 后返回 executor policy id、执行器和理由并进入 schedule hash。零 Context、零模型、零 Canon 写、零 schema/迁移；人工项继续由既有 handoff 进入精确现有面板并以 H56/H57 证明保存。 |
| 验收 / 回滚 | H81 表驱动专项 2 项覆盖 13 条合法政策路径和 14 个已有来源记录表变体，以及错 item id、kind/action/table/mode/nodeId、非正记录 ID 和未来类型 fail-closed；与 H80、工具栏、H52、H55～57 合跑为 8 文件 / 50 项。完整 `npm run ci` 为 371 文件 / 1785 项，覆盖率 81.95% / 73.72% / 79.68% / 81.95%，3776 模块构建、bundle budget 和生产依赖审计通过。最终代码精确 Chromium 主路径 1/1（17.5 秒）和完整套件 52/52（5.9 分钟）通过；UI 在 H77/H79 阶段分别显示唯一政策与人工模块。移除本政策层只会退回 H80 旧分类，不改变任何正式数据。 |

### HARNESS-80 完成卡：H57 跨类型下游调度与完成投影

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-80` 小功能。作者从 fresh H57 current plan 继续处理时，界面以一个可验签调度投影统一显示人工复核、确定性重建、章纲重建和单事件年表重建的依赖状态；不能同时创建两个跨类型待确认候选，也不能把缺失/过期回执算作完成。 |
| 主归属 / 复用 | 归 `HARNESS-2` 反向反馈通用 DAG；复用 H50 review、H57 plan/graph、H58/H77/H79 child receipt、现有 `agentRuns` 父子索引与单父变更锁，不新增 scheduler 表、队列、Agent、模型调用或第二套状态机。 |
| 范围 / 非范围 | 本单元只建立当前计划的确定性 schedule read model、跨类型单 pending 槽和完成语义；不自动点击、不批量调用模型、不替作者确认、不新增第三个生成式目标类型，也不把 unsupported/manual 项伪装成完成。 |
| 读 / 写 | 只读 fresh H57 output、当前 H50 review 和 H58/H77/H79 terminal/pending 证据；schedule 本身按 canonical hash 派生。零 Context Gateway 输入、零模型、零业务 Canon 写、零 `adopt()`；只有既有 child 创建仍写统一 ledger。 |
| 状态 / 依赖 | 当前 active item 只能处于 `blocked / ready / awaiting-confirmation / needs-manual-action / completed`。直接依赖必须已有 current completion proof；目标自身 `acknowledged` 直接完成，`needs-manual-action` 必须走既有 H52～57 修正链，不能继续生成。H58 receipt 覆盖确定性项，H77/H79 receipt 只覆盖精确 item。 |
| 并发 / 恢复 | H77/H79 使用共享 generation slot relation；同一 H57 parent 下已有 active 生成式 child 时，新建在 Run 之前 fail-closed。两个并发请求计算同一 slot，并由现有 parent mutation lock + 唯一 parent/relation 拒绝第二个；刷新从 ledger 重建相同 schedule，不依赖组件内存。 |
| 生命周期 / 回滚 | 不新增表/schema/迁移。调度证据全部由 `PROJECT_TABLES` 已登记 ledger 和现有候选生命周期派生；跨 Work 与导入后旧物理 lineage 不参与 current schedule。移除 H80 只退回 H77/H79 各自入口，不改已确认 Canon。 |
| 验收 | H80 专项 7 项、工具栏 12 项通过；与 H77/H79/工具栏合跑为 4 文件 / 43 项。完整 `npm run ci` 为 370 文件 / 1783 项，覆盖率 81.95% / 73.71% / 79.68% / 81.95%，3775 模块构建和 bundle budget 通过。完整 Chromium 为 52/52（5.5 分钟），H80 组合主路径为 21.4 秒；最终代码独立复跑 1/1（17.0 秒）。专项覆盖稳定拓扑/hash、目标 review 优先级、H58/H77/H79 精确完成、候选崩溃窗单链恢复、跨类型 pending、顺序/并发单 child、父/Work stale 和 UI 五态计数。 |

### HARNESS-79 完成卡：H57 单事件故事年表受控重建

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-79` 小功能。作者取得 fresh H57 当前计划并完成直接依赖复核后，可让既有 Prose Agent 为一个仍受影响的 `storyTimelineEvents` 记录生成修订候选；刷新不重复调用模型，只有作者确认后才更新正式事件。 |
| 主归属 / 复用 | 归 `HARNESS-2` 反向反馈后半链；复用 H50 复核 receipt、H57 parent lineage、H64 `prose.story-timeline-extraction` Skill/登记 Context/严格字段约束、统一 durable ledger/checkpoint、`FIELD_REGISTRY + AdoptionSchema + adopt(storyTimelineEvents)` 和 terminal receipt，不建立第二套年表表或组件级模型入口。 |
| 范围 / 非范围 | 本单元只接受 H57 `remaining/new` 中单个 `review-derived-state + timeline-event` 项，只允许更新既有记录的 `storyTime / importance / description`。冻结 `id / title / chapterId / chapterTitle / order`，不新增、删除、重排事件，不自动批量或级联；整章集合提取继续由 H64 独立承担。 |
| 读 / 写 | 模型只经 `chapterContent / storyTimelineTarget` 两个登记源无损读取目标事件绑定章节的当前正文与精确正式事件；候选额外冻结 H57 item/parent、依赖 proof、目标完整 baseline、Context/Prompt 与严格结果。确认后只经 `adopt(target=storyTimelineEvents, mode=merge-diffs)` 定点写三个允许字段。 |
| 状态机 / 硬验证 | 目标必须仍属于同一 Work 且绑定有效章节；每个直接依赖必须映射到同一 current plan，并有 fresh `acknowledged` 作者复核证明。缺 proof、`needs-manual-action`、删除/越界/漂移目标均在模型调用或正式写前 fail-closed。一次模型调用，未知结果不自动重试；exact-key JSON、目标 CAS、八采纳边界和 terminal verifier 沿同一 child Run 收敛。 |
| 生命周期 / 作用域 | 不新增表/schema/迁移；年表、章节和 ledger 三表均已登记。物理 ID 候选 `portable:false`，导入后未完成 Run 取消、完成回执 stale；其它 World/Work 记录不可恢复或采纳。 |
| UI / 回滚 | H57 面板一次只展示一个就绪的年表事件目标，并与 H77/H44 候选互斥；候选显示旧值、新值、理由和登记证据，可确认或放弃。移除本入口不影响 H64 整章年表提取和人工 CRUD，拒绝候选不改正式数据。 |
| 验收 | H79 专项 9 项、工具栏 11 项通过；与 H64/H77 合跑为 4 文件 / 49 项。独立 Chromium 主路径最终代码 1/1（15.5 秒）与完整套件 52/52（5.1 分钟）均通过，完整套件中 H79 所在用例为 12.5 秒。完整 `npm run ci` 为 369 文件 / 1775 项，覆盖率 81.95% / 73.72% / 79.68% / 81.95%，3773 模块构建和 bundle budget 通过。专项覆盖跨章 RunContract、真实登记 Context/parent、缺依赖零模型零 Run、严格协议、确认前零写、候选恢复、八采纳边界、来源/目标/Context/Prompt/parent/proof stale、Work/导入隔离和完成回执 stale。 |

### HARNESS-78 完成卡：H57 生成式 child 的依赖证明门

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-78` 小功能。作者只能在 H57 当前计划中某个生成式目标的直接上游影响项已有 fresh 作者复核证明后生成候选；不能跳过仍待人工处理的下游正文，靠目标下拉框任意越过依赖。 |
| 主归属 / 复用 | 归 `HARNESS-2` 反向反馈通用依赖闭环；复用 H50 作者复核 receipt、H57 current plan、H77 child Run 和现有 ledger，不建立第二个计划器、队列表或自动级联执行器。 |
| 范围 / 非范围 | 本单元只为 H77 的直接 `dependencyNodeIds` 建立可验证 readiness/proof；首个目标仍只写单个 `outlineNodes.summary`。不自动确认依赖、不自动批量调用模型、不改正文/事实/锁定字段，不把 UI 顺序冒充依赖顺序。 |
| 读 / 写 | 只读 H57 plan、对应 H50 terminal review 与既有 H77 completion；依赖证明随候选冻结并进入 hash。正式写入仍完全由 H77 的 `adopt(outlineNodes, merge-diffs)` 承担，不新增表或写字段。 |
| 状态机 / 硬验证 | 每个直接依赖必须映射到同一 current plan 项；作者确认依赖必须有同 plan/source 的 fresh `acknowledged` receipt，`needs-manual-action` 或缺失证明均阻断且模型调用/新 Run 为零。候选恢复、采纳和终验重新读取并逐项匹配冻结 proof；proof stale 后不得写入。 |
| 生命周期 / 作用域 | proof 只引用已登记、不可便携的 agent ledger 物理 Run/receipt；沿现有 Work 隔离、导入取消和 terminal stale 规则处理，不新增 schema/迁移/导出表。 |
| UI / 回滚 | 目标列表只展示 readiness 已满足的章纲，并说明被哪条上游复核阻断；作者可在既有影响复核控件完成依赖后再生成。移除本门只回到 H77 的单目标选择，不影响任何已确认 Canon。 |
| 验收 | 更新后的 H77 专项 15 项覆盖缺证明、`needs-manual-action`、fresh acknowledged、proof stale、候选前零模型/零 Run、刷新恢复、采纳前 proof 漂移、多个目标逐项解锁、Work/导入隔离；与 H50/H52/H54～58、工具栏合跑 9 文件 / 68 项通过。真实 Chromium 1/1（13.2 秒）从 H57 先确认下游正文依赖，再生成、刷新和确认 H77 候选；完整 `npm run ci` 为 368 文件 / 1765 项全绿，完整 `npm run ci:e2e` 为 52/52（4.9 分钟）。 |

### HARNESS-77 完成卡：H57 生成式后续章纲摘要重建

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-77` 小功能。作者完成人工修正并取得 fresh H57 当前计划后，可以让大纲 Agent 为其中一个仍受影响的后续章纲生成新摘要候选；刷新不重复调用模型，只有作者确认后才改正式摘要。 |
| 主归属 / 复用 | 归 `HARNESS-2` 反向反馈后半链；复用 H56/H57 parent lineage、现有影响图/计划、`outline` Agent、Context Gateway、durable ledger/checkpoint、`FIELD_REGISTRY + AdoptionSchema + adopt(outlineNodes)` 与 terminal receipt，不建立第二个计划器、章纲表或 Harness。 |
| 范围 / 非范围 | 首个生成式目标类型只允许 fresh H57 `remaining/new` 中非来源章的 `review-outline` 项，且只写 `outlineNodes.summary`。不自动挑选或级联全部目标，不改 title/正文/事实/锁定节点/其它字段，不把 H44 作者手填 patch 冒充模型重建，也不扩展 H58 的确定性表白名单。 |
| 读 / 写 | 模型只经 `chapterContent / chapterOutline / adjacentChapterOutlines / canonAssertions / storyCore / characters / storyArcs / writtenChapterProgress / consistencyReport` 登记源读取当前上下文；关键正文与目标章纲必须全文进入真实 Prompt。确认后只经 `adopt(target=outlineNodes, mode=merge-diffs)` 写 `summary`。 |
| 状态机 / 硬验证 | child Run 精确绑定 H57 Run/receipt/output、plan/graph/item；冻结来源正文、完整 Context/Prompt、非目标上游证据和目标业务 baseline。严格 exact-key JSON 仅接受 `summary/reason/evidenceRefs`，证据名必须来自实际分段。一次模型调用；未知结果暂停且不自动重试，重试创建新 child。写入事务内同时做来源与目标 CAS，八个采纳边界沿同一冻结意图幂等收敛。 |
| 生命周期 / 作用域 | 不新增表/schema；`outlineNodes` 与 ledger 三表均已登记。候选含物理 ID 且 `portable:false`，项目导入后未完成 Run 取消、terminal receipt stale；其它 Work、来源章、已解决项、锁定/删除/漂移目标均不可恢复或采纳。 |
| UI / 回滚 | H57 影响面板只在存在合格目标时显示“AI 重建章纲候选”；候选展示摘要、理由和登记证据，可确认或放弃。候选存在时隐藏 H44 手填 patch，避免两套候选并行；拒绝或移除 H77 不修改正式数据，原人工修正、H57/H58 与 H44 路径保留。 |
| 验收 | `R-HARNESS77-impact-outline-regeneration` 12 项与工具栏 10 项覆盖真实 Context/parent、零写候选、严格协议、配置前置、未知模型窗、候选崩溃窗、确认后写前 Context 漂移、来源/目标/Context/H57 stale、八采纳边界、拒绝/重试、完成恢复、终验 stale、作用域和导入生命周期。独立 Chromium 主路径 1/1 通过（10.7 秒）：真实走 H50→H56→H57→H77，刷新恢复时模型仍只调用一次，确认前正式摘要不变，确认后 child/parent 与终态回执、跨刷新正式值均成立。完整 CI 为 368 files / 1762 tests，覆盖率 81.91% statements / 73.87% branches / 79.57% functions / 81.91% lines；3770 模块生产构建、bundle budget 与生产依赖审计通过。完整项目 Chromium E2E 为 52/52（6.3 分钟），其中 H77 路径 10.4 秒。 |

### HARNESS-58 完成卡：绑定修正后计划的确定性下游重建

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-58` 小功能。来源编辑器恢复 fresh H57 当前计划后，作者执行“系统重建”时，检索块与层级摘要重建 Run 必须成为 H57 的 child，证明它执行的是人工修正后的当前 deterministic items；刷新或重复点击只收敛到同一真实输出/receipt。 |
| 主归属 / 复用 | 归 `HARNESS-2` 反向反馈后半链；直接复用 HARNESS-47 `executeImpactRemediationV1()`、既有 `rebuildChapterChunks()` / `rebuildProjectNarrativeSummaries()`、H57 Run/receipt/output hash 和编辑器原按钮，不复制重建器。 |
| 范围 | 为 H47 增加可选父 lineage、真实 output checkpoint 和逐边界幂等恢复；fresh H57 存在时只执行其当前 plan 的 deterministic items。派生写入后 graph/plan 改变会使 H57 成为历史，这是预期状态转换，H58 receipt 成为完成证据。 |
| 非范围 | 不执行 `author-confirmed` 项，不调用模型，不改正文/大纲/事实/状态等 Canon，不自动生成候选，不一次扩展新的确定性表类型，不取消普通 H47 手动重建兼容路径。 |
| 读 / 写 | `chapterContent` 仍经 `CONTEXT_SOURCES + assembleContext()`；父 H57 经 ledger 验证。业务写仅限 `PROJECT_TABLES` 已登记的 `retrievalChunks / narrativeSummaryNodes` 确定性派生生命周期，仍非 AI 写字段、`writeTargets=[]`、不新增 FIELD_REGISTRY。 |
| 表生命周期 | 不新增表；重建表和 ledger 三表均已登记。checkpoint 输出随项目导入按既有非便携/terminal stale 规则处理；父子 lineage 由既有 remap 与导入 stale 闸门覆盖。 |
| 硬验证 | H57 parent receipt/output、当前 plan/source/graph、deterministic item 闭集、Context Manifest、真实重建输出、执行后派生 post-state 与 terminal receipt 全绑定；父 stale、正文/plan 变化、无确定性项、越界、输出/checkpoint 篡改均拒绝。 |
| UI / 回滚 | 编辑器仍使用“执行系统重建”；fresh H57 存在时显示为受控 child，完成后展示 H58 receipt 与真实计数。移除 H58 绑定可回到 H47 普通手动重建，不删除任何派生结果或 H56/H57 历史。 |
| 验收 | H57→H58 父子 receipt 成立；只重建检索/摘要；重复点击返回原真实 output；包括“派生写入后、输出检查点前”在内的 10 个 durable 边界中断均沿同一 child 收敛；父 stale、frozen output 篡改、无 deterministic、正文变化、越界、导入反例通过；普通 H47 兼容路径保留。`R-HARNESS58-impact-post-correction-remediation` 7 项与 H47/H57 合计 20 项定向回归通过。 |

### HARNESS-59 完成卡：剩余分步骤 UI 模型入口注册表与清零守卫

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-59` 治理小功能。维护者必须能回答分步骤 UI 还有多少模型直调、哪些已由 durable/GenerationNode/SIM 治理、哪些确实只读、哪些仍需迁移；新增或移除直调时 CI 必须要求同步裁决。 |
| 主归属 / 复用 | 归 `HARNESS-2` 剩余入口 census；复用 TypeScript AST、现有 `check:architecture`/CI 和真实组件源码，不把 AI Manual 的 category 清单冒充运行治理状态。 |
| 范围 | 登记 `components/hooks/pages` 中 `useAIStream()` 实例与直接 `chat()` 调用构造点的文件、静态数量、三态、机制/迁移单元和理由；一次运行中的重试/分块次数不计作新的静态入口。AST 守卫拒绝漏登、残留、调用数漂移、无理由或无 nextUnit。 |
| 非范围 | 本单元不改模型行为、不迁移具体入口、不宣称 18 个 migration 已完成，不扫描测试/设置外的 lib 内部受控调用，不禁止只读建议或 SIM 隔离运行时。 |
| 读 / 写 / 表 | 仅读源码和静态 JSON 注册表；业务表零读写，不新增 Context/Field/PROJECT_TABLES 项。 |
| 验收 | 初始冻结 29 个文件 / 44 个静态构造点；HARNESS-60～75 已依次收口高风险入口并完成 Prompt 示例的真实风险裁决，当前为 14 个文件 / 26 个静态构造点：7 个 governed、5 个 auxiliary、2 个 migration。Prompt 示例由 HARNESS-75 的 DB/草稿反例证明是 `authoring-draft`，剩余两处文风入口仍明确登记；`check:ai-entry-registry` 已进入 `npm run ci`，AST 自测与 `R-HARNESS59-ai-entry-registry` 回归通过。 |

### HARNESS-61 完成卡：情感节拍 durable 候选与采纳

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-61` 治理小功能。作者在正文前生成情感节拍时，模型输出必须先成为可恢复候选，确认前不能写正式节拍卡。 |
| 主归属 / 复用 | 归 `HARNESS-2` 剩余入口清零；新增 `prose.emotion-beats` Skill，复用 Context Gateway、durable Run/checkpoint、`adopt()` 与 terminal receipt，不引入平行 Harness。 |
| 读 / 写 | 只经 `chapterOutline / detailedOutline / previousChapterEnding / worldview / storyCore / characters / creativeRules` 登记源读取。写入闭集为 `emotionBeatCards.chapterId/chapterTitle/overallArc/beats/source`，只在作者确认后经 `adopt(emotionBeatCards)` 执行。 |
| 硬验证 | 严格 exact-key JSON，3–6 个唯一命名节拍，五字段均非空；候选绑定 Work/World/章节/章纲、Context Manifest、实际输入 hash、现有正式卡 baseline 与 candidate hash。上下文或正式卡改变均 fail-closed。 |
| 生命周期 | `emotionBeatCards` 沿用 `PROJECT_TABLES` 的 Work 归属、章节级联删、导出/导入与 chapter ID 重映射。含物理 ID 的未完成候选 `portable:false`，导入后取消；终验后正式卡变化会撤销旧 receipt。 |
| UI / 回滚 | `EmotionBeatCard` 展示“尚未写入”候选与确认/拒绝；人工新建、编辑、删除保留。旧 `useAIStream` 直调、组件手拼上下文、宽松回退 parser 与生成后立即 `saveCard` 旁路已下线。 |
| 验收 | `R-HARNESS61-emotion-beat-durable` 14 项覆盖真实上下文、零写候选、刷新恢复、严格 parser、stale/拒绝、8 个采纳中断点、写入前二次 CAS、写入后上游 stale 拒绝终验、adoption 后终验前正式卡漂移暂停、终验后卡或上游改变撤销 receipt、导入取消、作用域及旧旁路下线。当时 H59 census 收缩为 27 文件 / 42 入口，16 migration；当前总数以 H59 完成卡为准。 |

### HARNESS-62 完成卡：重要地点 durable 分块提取与采纳

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-62` 治理小功能。作者从当前 Work 全部已写正文提取重要地点时，长任务必须可断点续跑，所有分块完成前不产生可采纳候选，确认前不写地点树。 |
| 主归属 / 复用 | 归 `HARNESS-2` 剩余入口清零；新增 `world-origin.locations` Skill，复用 Context Gateway、Run/event/checkpoint、`adopt()` 和 terminal receipt，不引入平行 Harness。 |
| 读 / 写 | 只经 `chapterContent / locations` 登记源读取当前 Work 正文与当前 World 地点基线。写入闭集为 `importantLocations.name/tags/description/significance/parentId/sortOrder`，只在作者勾选确认后经 `adopt(importantLocations)` 执行。 |
| 状态机 / 硬验证 | 计划冻结提示词模板、章节顺序、每章 Manifest、分块 hash、已有地点 Manifest/baseline 和 Work；每个已完成分块建立进度检查点。只有检查点为最后事件时可续跑；`model.requested` 后结果不可判定则暂停且不自动重试。严格 exact-key JSON、登记标签、唯一地点名与数量上限 fail-closed。 |
| 生命周期 / 作用域 | 不新增表或 schema；`importantLocations` 继续由 `PROJECT_TABLES` 派生 World 归属、树 parent 重映射、导出/导入、删除与引用生命周期。候选/进度含本地 ID、`portable:false`，导入后取消；terminal 后正文、提示词、原有或所选地点漂移均撤销旧 receipt。 |
| UI / 回滚 | `LocationPanel` 恢复候选或安全进度，明示不可判定运行必须放弃重来；采纳中断时恢复冻结选择。人工新建、编辑、树层级和删除保留。旧组件逐章 `chat`、手拼 Context、内存候选和直接 `adopt()` 旁路已下线。 |
| 验收 | `R-HARNESS62-location-extraction-durable` 14 项覆盖多分块零写候选、从下一分块续跑、候选事件与检查点间中断重建同一候选、模型结果不确定窗口、任一分块协议失败时无部分候选、上游 CAS、候选恢复/选择写入、严格 parser、8 个采纳边界幂等收敛、导入取消、Work/World 隔离、terminal 漂移与旧旁路下线。当时 H59 census 为 26 文件 / 41 入口、15 migration；当前总数以 H59 完成卡为准。 |

### HARNESS-63 完成卡：物品栏 durable 分块提取与逐章原子替换

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-63` 治理小功能。作者按全部已写章或自定义起止章重提物品流水时，长任务必须可断点续跑，确认前不改任何正式流水；确认后即使跨章中断，也不能留下不可恢复的“部分删旧、部分写新”。 |
| 主归属 / 复用 | 归 `HARNESS-2` 剩余入口清零；新增 `prose.inventory-extraction` Skill，复用 Context Gateway、Run/event/checkpoint、`replaceAdoptedCollection()` 与 terminal receipt，不引入平行 Harness。 |
| 读 / 写 | 只经 `chapterContent / itemLedger / characters` 登记源读取当前 Work 正文/流水与当前 World 角色。写入闭集为 `itemLedger.itemName/action/quantity/heldByName/characterId/chapterId/chapterTitle/note`；作者确认后按登记的 `replaceScope=['chapterId']` 逐章事务替换。 |
| 状态机 / 硬验证 | 冻结范围、提示词、章节清单/Manifest/分块、角色 roster 与正式流水 baseline；每个确定完成分块 checkpoint，只续跑剩余调用。模型结果不可判定则暂停不重试；严格 exact-key JSON、动作枚举、正整数、持有人、去重与总量上限 fail-closed。空候选仍可确认，语义是明确清理所选章旧提取结果。 |
| 采纳恢复 / FK | 采纳意图冻结作者选择和每章正式行；每章清旧+整批写入同一 IndexedDB 事务。若写入后、进度 checkpoint 前中断，恢复先回读同值正式状态再推进，不重复替换；未处理章仍须等于原 baseline。角色姓名只有在冻结 roster 中唯一匹配才写 `characterId`，重名或未知只保留 `heldByName`。 |
| 生命周期 / 作用域 | 不新增表或 schema；`itemLedger` 继续由 `PROJECT_TABLES` 派生 Work 归属、角色/章节软引用、导入导出和重映射生命周期。Work 级范围可包含多个世界组章节；当前 World roster 与其它 Work/World 数据隔离。含本地 ID 的进度/候选 `portable:false`，导入后取消。 |
| UI / 回滚 | `InventoryPanel` 恢复候选或安全分块进度；不可判定运行需放弃重来。意图冻结后不可改勾选，正式替换开始后只能继续收敛。人工新增、编辑、认领和删除保留。旧组件逐章 `chat`、手拼 Context、吞掉单章失败、`deleteByChapter + adopt()` 旁路已下线。 |
| 验收 | `R-HARNESS63-inventory-extraction-durable` 14 项覆盖范围/分块零写候选、从下一分块续跑、候选事件崩溃窗重建、模型结果不可判定、严格协议失败、上游/baseline CAS、空结果清理、唯一姓名/同名角色 FK、8 个采纳边界幂等收敛、导入取消、Work/World 隔离、terminal 漂移与旧旁路下线。H59 census 同步收缩为 25 文件 / 40 入口、14 migration。 |

### HARNESS-64 完成卡：故事年表 durable 分块提取与逐章原子替换

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-64` 治理小功能。作者从当前 Work 的全部已写正文重新提取故事进程年表时，长任务必须可断点续跑，确认前不改正式年表；确认后跨章中断也必须沿同一冻结意图恢复。 |
| 主归属 / 复用 | 归 `HARNESS-2` 剩余入口清零；新增 `prose.story-timeline-extraction` Skill，复用 Context Gateway、Run/event/checkpoint、`replaceAdoptedCollection()` 与 terminal receipt，不引入平行 Harness。 |
| 读 / 写 | 模型只经 `chapterContent` 登记源读取当前 Work 正文；正式年表仅由治理层回读作 CAS，不进入模型 Prompt。写入闭集为 `storyTimelineEvents.title/storyTime/importance/description/chapterId/chapterTitle/order`；作者确认后按登记的 `replaceScope=['chapterId']` 逐章事务替换。 |
| 状态机 / 硬验证 | 冻结提示词、章节清单/Manifest/分块、正文 hash 和完整正式年表 baseline；每个确定完成分块 checkpoint，只续跑剩余调用。模型结果不可判定则暂停且不重试；严格 exact-key JSON、1～3 整数重要度、`chapterId + title` 候选身份和总量上限 fail-closed。 |
| 采纳恢复 | 作者选择冻结后为每个目标章生成 `order=0..n-1` 的正式意图；每章清旧+整批写入同一事务。若写入后、进度 checkpoint 前中断，恢复回读同值正式状态后前进，不重复替换。空候选或空选择只有在作者明确确认后才清理全部目标已写章。 |
| 生命周期 / 作用域 | 不新增表或 schema；`storyTimelineEvents` 继续由 `PROJECT_TABLES` 派生 Work 归属、章节软引用、导入导出和 ID 重映射生命周期。短章/未写章及其它 Work 的正式行保持范围外冻结。进度/候选 `portable:false`，导入后取消。 |
| UI / 回滚 | `StoryTimelinePanel` 恢复候选或安全分块进度；不可判定运行需放弃重来。意图冻结后不可改勾选，正式替换开始后只能继续收敛。人工新增、编辑、删除和章节跳转保留。旧组件 `chat`、手拼 Context、宽松 parser、吞错及 `deleteByChapter + adopt()` 旁路已下线。 |
| 验收 | `R-HARNESS64-story-timeline-extraction-durable` 14 项覆盖合同/Manifest、分块零写与续跑、候选崩溃窗重建、未知模型结果、严格协议、正文/Prompt/baseline CAS、候选身份去重、逐章 order 压缩与范围外冻结、空选择清理、8 个采纳边界、写后 checkpoint 窗口、导入取消、Work 隔离、terminal stale 和旧旁路下线。与 H59/H63 联合回归共 31 项通过；H59 census 收缩为 24 文件 / 39 入口、13 migration。交付基线为完整 CI 348 files / 1486 tests 与项目 Chromium E2E 42/42。 |

### HARNESS-65 完成卡：正文局部编辑 durable 候选与精确范围采纳

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-65` 治理小功能。作者在正文中选中文本执行润色、扩写、缩写或改写时，模型结果必须先成为可恢复候选；只有作者确认且原选区与正文基线仍一致时，才能精确替换原范围。查漏只产生只读报告，永不提供正文写入口。 |
| 主归属 / 复用 | 归 `HARNESS-2` 剩余入口清零；新增 `prose.selection-edit` 与 `prose.selection-check` Skill，复用 Prompt Engine、Context Gateway、durable Run/checkpoint、`adopt(chapters)` 与 terminal receipt，不引入平行 Harness。 |
| 读 / 写 | 模型只经 `manualText` 登记源读取作者冻结的选中文字，不读取整章。治理层回读当前章节正文作 CAS，不进入模型 Prompt。编辑动作写入闭集为 `chapters.content/wordCount`，仅作者确认后经 `adopt()` 写回；查漏 `writeTargets=[]`。 |
| 状态机 / 硬验证 | 冻结 Work/World/章节、动作、TipTap `from/to`、选中文字/hash、完整正文/hash、Prompt 模板/hash、Context Manifest、模型输出与预演后的完整 HTML/hash。一次模型调用；`model.requested` 后结果不可判定时暂停且不自动重试。编辑输出须非空、非同值、满足动作级长度边界；预演结果必须只来自冻结范围。 |
| 采纳恢复 | 编辑候选持久化后等待作者确认；确认前二次校验正文、选区、Prompt 和预演结果。八个 durable 边界冻结同一采纳意图；正式写入后、提交事件前中断时，恢复先回读同值正文再推进，不重复改写。终验只以真实 DB 正文与当前 Prompt 证据签发 receipt。 |
| 生命周期 / 作用域 | 不新增表或 schema；`chapters` 与 ledger 三表均已登记 `PROJECT_TABLES` 生命周期。正文写回继续触发既有章节派生状态 stale 传播。候选含本地章节 ID 与编辑器位置，`portable:false`，导入后取消；切换章节或正文漂移不得误应用候选。 |
| UI / 回滚 | `FloatingToolbar` 恢复同章候选，明确显示“尚未写入”；编辑动作提供替换/放弃，查漏仅关闭。采纳成功后编辑器与已保存正文同步为终验内容。旧 `useAIStream`、组件硬编码 Prompt、内存结果和直接 `replaceSelection()` 旁路下线。 |
| 验收 | `R-HARNESS65-selection-edit-durable` 21 项覆盖最小 Context、候选零写、刷新恢复、查漏零写、严格输出、越界预演、模型结果未知窗口、候选事件崩溃窗、正文文本/纯格式/Prompt stale、拒绝、8 个采纳中断点、终验后正文漂移、导入取消、Work/章节隔离及旧旁路下线；H59 census 收缩为 23 文件 / 38 入口、12 migration。完整 CI 为 349 files / 1509 tests；项目 Chromium E2E 扩展为 43/43，并新增真实 UI/API 路径验证最小选区 Prompt、候选刷新恢复、单次模型调用、确认后精确替换和刷新持久化。 |

### HARNESS-66 完成卡：世界地图 durable 配置候选与定点采纳

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-66` 治理小功能。作者让 AI 根据当前世界的世界观、地理、词条和重要地点生成地图参数时，模型结果必须先成为可恢复候选；只有作者确认且目标世界节点、来源 Context、Prompt 与原地图配置仍一致时，才能替换正式地图。 |
| 主归属 / 复用 | 归 `HARNESS-2` 剩余入口清零；新增 `world-origin.map-config` Skill，复用 Context Gateway、durable Run/checkpoint、`adopt(worldNodes)` 与 terminal receipt，不引入平行 Harness，不改变确定性 Voronoi/空间约束求解器。 |
| 读 / 写 | 模型只经 `worldview / geography / codex / locations` 登记源读取当前 World；目标节点名称由治理层冻结并进入 Prompt。写入闭集只有 `worldNodes.mapConfigJSON`，作者确认后经登记的 record-only AdoptionSchema 与 exact-field CAS 定点替换。 |
| 状态机 / 硬验证 | 冻结 World/Work、世界组、目标节点、原配置精确 hash、Context Manifest、Prompt/hash 和严格规范化后的 `MapGenConfig`/hash。一次模型调用；`model.requested` 后结果不可判定时暂停且不自动重试。输出必须为 exact-key JSON，数值、枚举、实体/关系上限和逐字证据 fail-closed，不再以静默裁剪或随机 seed 掩盖协议错误。 |
| 采纳恢复 | 候选持久化后等待作者确认，确认前正式地图与 UI 主视图保持原值。八个 durable 边界冻结同一采纳意图；同一事务中回读目标节点并校验原配置 hash 后经 `adopt()` 写入。写后 checkpoint 前中断时先回读同值正式配置再推进，不重复生成或覆盖。 |
| 生命周期 / 作用域 | 不新增表或 schema；`worldNodes` 继续由 `PROJECT_TABLES` 派生 World 归属、树、传送门引用重映射、导入导出和删除生命周期。候选含本地节点 ID，`portable:false`，导入后取消；其它项目、World、世界组或节点均不可采纳。 |
| UI / 回滚 | `WorldMapPanel` 恢复同节点候选或不可判定运行，明确显示“尚未写入”；作者可确认或放弃。人工比例尺及其它地图参数编辑保留。旧组件 `useAIStream`、直接 DB 扫描、手拼 Context 与 `updateNode(mapConfigJSON)` AI 旁路下线。 |
| 验收 | `R-HARNESS66-world-map-durable` 22 项覆盖登记 Context、候选零写/刷新恢复、严格协议、模型未知窗口、候选事件崩溃窗、Context/Prompt/节点名/原配置 CAS、拒绝、8 个采纳中断点、写后 checkpoint 窗口、导入取消、World/世界组/节点隔离、terminal stale 与旧旁路下线；与地图读全、空间约束、导出重映射和 H59 组合为 36 项。H59 census 收缩为 22 文件 / 37 入口、11 migration；完整 CI 为 350 files / 1532 tests，项目 Chromium E2E 为 43/43。真实 UI/API 证明候选刷新恢复不重复模型调用、确认前零正式变更、确认后地图生效且人工比例尺刷新持久化。 |

### HARNESS-67 完成卡：世界组七字段扩写 durable 候选与原子采纳

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-67` 治理小功能。作者在世界详情中根据已保存草稿一次扩写世界观时，七字段模型结果必须先成为可恢复候选；只有作者确认且目标世界组、登记 Context、Prompt 与原七字段 baseline 仍一致时，才能原子写入正式世界观。 |
| 主归属 / 复用 | 归 `HARNESS-2` 剩余入口清零；在同一 `world-origin` Agent 下新增有界 `world-origin.worldview-expand` Skill，复用 Context Gateway、durable Run/checkpoint、`adopt(worldviews)` 与 terminal receipt。现有单字段 `world-origin.worldview-field` 保持不变，不引入平行 Harness。 |
| 读 / 写 | 模型只经 `manualText / worldGroups / storyCore / worldview` 登记源读取已保存目标草稿、世界目录、当前 Work 故事核心和当前世界组世界观。写入闭集仅为 `worldOrigin / powerHierarchy / continentLayout / climateByRegion / historyLine / races / factionLayout`，七字段全部非空并在作者确认后经 `FIELD_REGISTRY + adopt()` 一次采纳。 |
| 状态机 / 硬验证 | 冻结 Work/World、目标世界组完整快照、七字段正式 baseline、非目标世界观字段、Context Manifest/实际来源 hash、Prompt 模板/hash 和严格候选/hash。一次模型调用；`model.requested` 后结果不可判定时暂停且不自动重试。输出必须是 exact-key、非空、有长度上限的 JSON 对象，禁止 Markdown 围栏、缺字段、额外字段和静默默认值。 |
| 采纳恢复 | 候选持久化后等待作者确认；确认前正式世界观零写入。八个 durable 采纳边界冻结同一意图；同一 IndexedDB 事务中回读目标世界组与世界观 baseline，再经 `adopt()` 写七字段。正式写入后、事件或终验前中断时回读同值正式状态继续收敛，不重复调用模型或部分覆盖。 |
| 生命周期 / 作用域 | 不新增表、schema 或迁移；`worldviews / worldGroups` 继续由 `PROJECT_TABLES` 派生 World 归属、世界组 ID 重映射、导入导出和删除生命周期。候选含本地世界组 ID，`portable:false`，导入后取消；其它项目、World、Work 或世界组均不可恢复/采纳。 |
| UI / 回滚 | `WorldGroupDetail` 恢复同世界组候选或不可判定运行，明确显示“尚未写入”并提供确认/放弃；存在未保存的世界名称、类型或描述时先要求作者保存，避免模型读取无法持久验证的内存草稿。人工世界组编辑保留。旧 `useAIStream`、直接 DB 读故事核心/手拼跨世界 Context、宽松 parser 和模型返回后立即 `adopt()` 旁路下线。 |
| 验收 | `R-HARNESS67-worldview-expand-durable` 22 项覆盖登记 Context、七字段零写候选/刷新恢复、严格协议、模型未知窗口、候选崩溃窗、目标组/Context/Prompt/baseline CAS、拒绝、八采纳边界、写后恢复、导入取消、World/Work/世界组隔离、terminal stale 和旧旁路下线；组件 UI 5 项与 H59/H13 合计 37 项通过。H59 census 收缩为 21 文件 / 36 入口、10 migration。完整 CI 为 352 files / 1559 tests，3753 模块生产构建与 bundle budget 通过；项目 Chromium E2E 44/44。真实 UI/API 证明候选刷新恢复不重复模型调用、确认前正式世界观不变、确认后七字段持久化。 |

### HARNESS-68 完成卡：多世界建议 durable 整批候选与选择式原子采纳

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-68` 治理小功能。作者在多世界总览输入方向后，2～4 个世界建议必须先成为可刷新恢复的整批候选；作者可勾选任意非空子集，只有确认且当前项目提示、世界目录、世界关系、故事核心、Context 与 Prompt 全部仍 fresh 时才能新建。 |
| 主归属 / 复用 | 归 `HARNESS-2` 剩余入口清零；在同一 `world-origin` Agent 下新增 `world-origin.world-suggest` Skill，复用 Context Gateway、durable Run/checkpoint、`FIELD_REGISTRY + AdoptionSchema + adopt(worldGroups)` 与 terminal receipt，不建立平行 Harness。 |
| 读 / 写 | 模型只经 `manualText / worldGroups / storyCore` 登记源读作者方向、当前 World 目录和当前 Work 故事核心。写入闭集为 `name / type / description / icon / order / entryCondition / powerRestriction / plannedChapterCount`；关系表仍仅人工 CRUD，AI 不自动造边。 |
| 状态机 / 硬验证 | 冻结 World/Work、项目提示快照、完整世界目录/关系/故事核心、Context Manifest、Prompt 和严格候选/hash。输出只接受 2～4 个 exact-key JSON 对象，类型不得为 `primary`，名称不得批内或与已有世界重复，六个模型字段均有类型/长度/枚举边界。未知模型结果不自动重试。 |
| 采纳恢复 | 作者勾选和最终 `order` 冻结为不可便携意图；八个 durable 采纳边界可沿同一 Run 幂等收敛。同一 IndexedDB 事务内二次验证上游和旧世界快照后，一次 `adopt()` 新增冻结子集；写后中断会回读精确新旧集合，不重复调模型或重复建世界。 |
| 生命周期 / 作用域 | 不新增表、schema 或迁移；`worldGroups / worldGroupLinks / storyCores` 继续由 `PROJECT_TABLES` 派生 World/Work 归属、ID 重映射、导入导出和删除生命周期。候选含本地 ID，`portable:false`，导入后取消；其它项目、World 或 Work 不可恢复/采纳。 |
| UI / 回滚 | `WorldGroupOverview` 恢复整批候选、冻结选择或不可判定运行，明示“尚未写入”。人工世界/关系 CRUD 保留。旧 `useAIStream`、内存候选、直接 `createGroup()` 循环与手拼 `buildAllWorldsOverview()` 旁路已下线，无运行调用的 `world-group-context.ts` 同步删除。 |
| 验收 | `R-HARNESS68-world-suggest-durable` 22 项与 UI 5 项覆盖登记边界、三源 Context、候选零写、刷新/选择恢复、严格协议、同名、未知模型窗口、候选崩溃窗、六类上游 stale、拒绝、八采纳边界、终验过期、导入取消、World/Work 隔离、活跃作用域切换和旧旁路下线；与 H59/H67 合计 52 项定向回归通过。H59 census 收缩为 20 文件 / 35 入口、9 migration。完整 CI 为 354 files / 1586 tests，覆盖率 80.93% statements / 73.22% branches / 78.54% functions / 80.93% lines；3753 模块生产构建与 bundle budget 通过。项目 Chromium E2E 45/45；新用例约 7.1 秒，证明刷新不重复模型调用、确认前零写入、作者只选两项时只新建该子集。 |

### HARNESS-69 完成卡：世界宪法扫描 durable 双层确认

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-69` 治理小功能。作者从世界观、力量体系、故事核心和角色档案扫描设定断言时，模型结果先成为可刷新恢复的整批候选；只有作者确认且登记闭集与事实 baseline 仍 fresh 时才能写事实候选，之后仍须逐条确认才成为 Canon。 |
| 主归属 / 复用 | 在同一 `world-origin` Agent 下新增 `world-origin.constitution-extract` Skill，复用 Context Gateway、durable Run/checkpoint、已登记 `fact-ledger` Adoption Extension、事实生命周期和 terminal receipt，不建立平行事实或 Harness 入口。 |
| 读 / 写 | 模型只经 `constitutionScanSources` 读取登记来源、允许主题和当前 World 主体；来源必须无损完整进入实际模型输入。写入仅为 `temporalFacts(status=candidate)`，由 `FACT_PREDICATE_REGISTRY`、来源登记和 PROJECT_TABLES 生命周期治理；不会在批次确认时升级 Canon。 |
| 状态机 / 硬验证 | 冻结 World/Work、完整来源/主体/事实 baseline、Context Manifest/实际输入、Prompt 和 strict exact-key 候选。只接受 `{assertions:[0..80]}`；未知来源/主题/主体、非逐字证据、重复、围栏、额外字段和已有同值证据均失败，不静默跳过。未知模型结果不自动重试。 |
| 采纳恢复 | 作者确认整批后冻结预期事实；事务内再次复核来源、主体和事实 baseline，再原子写入全部候选或零写回滚。八个 durable 采纳边界沿同一意图幂等收敛；写后中断不重复调模型或重复插入。 |
| 生命周期 / 作用域 | 不新增表/schema；`temporalFacts` 与五类来源继续由 PROJECT_TABLES 派生导出/导入、删除、世界/作品作用域与引用重映射。含本地 ID 的候选 `portable:false`，导入后取消；其它 World/Work 不可恢复或采纳。 |
| UI / 回滚 | `WorldConstitutionPanel` 明示扫描批次尚未入库、批次确认后仍只是待确认事实；恢复待确认、已确认采纳和不可判定运行。既有逐条确认、否决和明确取代互斥 Canon 完整保留。旧 `useAIStream`、直接 DB 查主体、宽松 parser 与立即 `adoptSetting` 旁路下线。 |
| 验收 | durable 23 项、UI 5 项、既有 CONSISTENCY-3 4 项和 H59 3 项共 35 项通过。census 收缩为 19 文件 / 34 入口、8 migration。完整 CI 为 355 files / 1613 tests，覆盖率 80.95% statements / 73.24% branches / 78.58% functions / 80.95% lines；3754 模块生产构建与 bundle budget 通过，入口 650.4 KiB / gzip 200.9 KiB，生产依赖审计 0 漏洞。项目 Chromium E2E 46/46；新增用例约 6.8 秒，证明登记来源实际进入请求、候选刷新恢复不重复模型调用、批次确认前零事实写入，确认后仍只新增 `status=candidate` 事实并保留逐条 Canon 确认。 |

### HARNESS-70 完成卡：Codex 词条 durable 分块拆分与原子采纳

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-70` 治理小功能。作者把一段设定拆成当前分类的 Codex 词条时，长来源必须可续跑，模型结果必须先成为可刷新恢复的候选；确认前正式词条零写入。 |
| 主归属 / 复用 | 在同一 `world-origin` Agent 下新增 `world-origin.codex-extract` Skill，复用 Context Gateway、durable Run/checkpoint、`FIELD_REGISTRY + AdoptionSchema + adopt(codexEntries)` 与 terminal receipt，不建立平行提取或写入入口。 |
| 读 / 写 | 模型只经 `manualText / codexExtractionBaseline` 登记源读取作者来源、目标分类/schema 和同世界组既有词条。写入闭集为 `codexEntries` 的分类、名称、图标、摘要、描述、自定义字段、引用、标签、重要度、顺序与世界组字段；只在作者确认后统一采纳。 |
| 状态机 / 硬验证 | 冻结 World/Work/世界组、分类/schema、既有词条、Context Manifest、Prompt、分块和逐调用 hash。每个确定完成分块 checkpoint，只续跑剩余调用；未知模型结果不自动重试。输出只接受 0～200 个 exact-key JSON 对象，未知 schema 字段、类型修复、重复名、围栏与越界值均 fail-closed。 |
| 采纳恢复 | 作者子集与最终顺序冻结后不可改选或取消，只能沿同一意图收敛。事务内二次复核分类、schema、完整既有词条 baseline 后，经 `adopt()` 原子新增全部冻结项；八个采纳边界可幂等恢复。零候选也可确认并签发零写入终态回执。 |
| 生命周期 / 作用域 | 不新增表/schema；`codexEntries / codexCategories` 继续由 `PROJECT_TABLES` 派生 World 归属、ref/FK 清理、导入导出、删除和重映射生命周期。候选含本地分类/词条 ID，`portable:false`，导入后取消；其它 World/Work/世界组/分类不可恢复或采纳。 |
| UI / 回滚 | `CodexPanel` 恢复待确认候选、安全分块进度、冻结选择或不可判定运行。人工 CRUD、字段管理与 ref 编辑保留。旧组件 `chat()`、组件内 `assembleContext()`、宽松 parser、内存候选和直接 `adopt(codexEntries)` 旁路已下线。 |
| 验收 | durable 21 项、UI 5 项和 H59 3 项共 29 项通过；Codex 导入/生命周期/受控视图/Skill 联合回归 43 项通过。census 收缩为 18 文件 / 33 入口、7 migration。完整 CI 为 357 files / 1639 tests，覆盖率 81.05% statements / 73.51% branches / 78.77% functions / 81.05% lines；3756 模块生产构建与 bundle budget 通过，入口 652.6 KiB / gzip 201.6 KiB，生产依赖审计 0 漏洞。项目 Chromium E2E 47/47；新增用例约 6.0 秒，证明登记分类/schema/来源实际进入请求、候选刷新恢复不重复模型调用、确认前零正式写入，确认后词条跨刷新持久化。 |

### HARNESS-71 完成卡：修炼进度 durable 证据提取与原子投影

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-71` 治理小功能。作者分析已写章节的境界变化时，模型只负责提出逐字证据候选；刷新不丢失，确认前正式进度零写入，DAG 变化类型由系统确定。 |
| 主归属 / 复用 | 在同一 `prose` Agent 下新增 `prose.cultivation-progress-extraction` Skill，复用 Context Gateway、durable Run/checkpoint、既有 `cultivation-progress-lifecycle` Adoption Extension、规范章序与 terminal receipt，不建立第二套修炼历程。 |
| 读 / 写 | 模型只经 `chapterContent / cultivationProgressExtractionBaseline` 读取目标正文、当前 World 角色/体系/DAG、规范章序和当前 Work 进度；作者确认后才写 `cultivationProgress` 登记字段，并同步归一化同角色体系的既有后续 transition。 |
| 状态机 / 硬验证 | 冻结 World/Work/世界组/章节、角色/体系/DAG、完整正式进度 baseline、Context Manifest 与 Prompt。只接受 exact-key `{events:[0..100]}`，闭集整数 ID、至少四字且唯一的逐字证据、正文顺序和重复身份均严格验证；模型不得输出 transition，未知结果不重试。 |
| 采纳恢复 | 作者可选择子集；选择与系统投影冻结后不可换项或取消。事务内二次 CAS，全部冻结项经 `adopt(cultivationProgress)` 写入，既有 transition 同事务更新；八个 durable 采纳边界沿同一意图幂等收敛，空结果可签发零写回执。 |
| 生命周期 / 作用域 | 不新增表/schema；进度、章节、角色和修炼体系继续由 PROJECT_TABLES 派生 Work/World 归属、导入导出、删除与引用重映射。含本地 ID 的候选 `portable:false`，其它 World/Work/世界组不可恢复或采纳。 |
| UI / 回滚 | `CultivationProgressPanel` 恢复待确认、选择冻结或不可判定运行；人工删除与反哺开关保留。旧组件 `chat()`、硬编码 prompt、宽松 parser、内存逐条候选与非原子逐条采纳旁路下线。 |
| 验收 | durable 22 项与既有修炼领域/UI 7 项通过；census 收缩为 17 文件 / 32 入口、6 migration。完整 CI 为 358 files / 1661 tests，覆盖率 81.07% statements / 73.50% branches / 78.81% functions / 81.07% lines；3757 模块生产构建与 bundle budget 通过，入口 657.2 KiB / gzip 203.0 KiB，生产依赖审计 0 漏洞。项目 Chromium E2E 47/47；修炼主路径用例约 11.3 秒，证明登记正文/baseline 实际进入请求、候选刷新恢复不重复模型调用、确认前零正式写入，确认后进度及系统确定的 transition 原子持久化。 |

### HARNESS-72 完成卡：伏笔建议 durable 候选与原子采纳

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-72` 治理小功能。作者请求 AI 建议伏笔时，一次模型调用直接生成严格结构候选；候选可刷新恢复，确认前正式伏笔零写入，作者只采纳所选子集。 |
| 主归属 / 复用 | 在同一 `outline` Agent 下新增 `outline.foreshadow-suggestions` Skill，复用 Context Gateway、durable Run/checkpoint、`FIELD_REGISTRY + AdoptionSchema + adopt(foreshadows)`、PROJECT_TABLES 生命周期与 terminal receipt，不建立第二套伏笔表或 Harness。 |
| 读 / 写 | 模型只经登记的 Canon、世界观、故事核心、力量体系、修炼进度、Codex、角色、创作/世界规则、历史、地点与 `foreshadowSuggestionBaseline` 读取当前 Work。作者确认后只新增伏笔名称、类型、描述和系统固定的 `planned` 状态；章节引用与备注固定为空，后续由作者维护。 |
| 状态机 / 硬验证 | 冻结 World/Work、项目、完整正式伏笔 baseline、上游 Context Manifest、实际 Prompt 与 Prompt 模板。只接受 exact-key `{foreshadows:[0..12]}`，每项仅 `name/type/description`；围栏、额外字段、非法枚举、隐式修剪、已有或批内重名均 fail-closed。未知模型结果不自动重试。 |
| 采纳恢复 | 作者可选择子集；选择冻结后不可换项或取消。项目、正式 baseline、上游 Context 与 Prompt fresh 时，事务内二次 CAS 并经 `adopt()` 原子新增全部冻结项；八个 durable 采纳边界沿同一意图幂等收敛，空结果可签发零写回执。 |
| 生命周期 / 作用域 | 不新增表/schema；`foreshadows` 继续由 PROJECT_TABLES 派生 Work 归属、导入导出、删除和引用重映射生命周期。候选含本地作用域证据，`portable:false`，导入后取消；其它 Work 不可恢复或采纳。 |
| UI / 回滚 | `ForeshadowPanel` 恢复待确认、冻结选择或不可判定运行；人工新建、编辑、状态推进与章节关联保留。旧 `useAIStream` 自由文本调用、第二次结构化模型调用、内存候选与逐条 `adopt()` 旁路下线。 |
| 验收 | durable 18 项、组件 UI 2 项、H59 3 项与通用 Context Gateway 3 项通过；census 收缩为 16 文件 / 30 入口、5 migration。完整 CI 为 360 files / 1681 tests，覆盖率 81.34% statements / 73.68% branches / 78.86% functions / 81.34% lines；3759 模块生产构建与 bundle budget 通过，入口 660.2 KiB / gzip 203.9 KiB，生产依赖审计 0 漏洞。项目 Chromium E2E 48/48；新用例约 5.8 秒，证明登记 baseline/严格协议实际进入请求、候选刷新恢复不重复模型调用、确认前零正式写入，确认后伏笔跨刷新持久化。 |

### HARNESS-73 完成卡：历史考据 / 头脑风暴 durable 定点结果

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-73` 治理小功能。作者对历史事件或历史关键词发起考据/头脑风暴时，结果先成为可刷新恢复的持久候选；确认前正式条目零写入，确认后只替换对应结果字段。 |
| 主归属 / 复用 | 在同一 `world-origin` Agent 下新增 `world-origin.history-consult / world-origin.history-storm` 两个 Skill，共用一个目标类型闭集运行器，复用 Context Gateway、durable Run/checkpoint、通用 record-field CAS、`FIELD_REGISTRY + AdoptionSchema + adopt()`、PROJECT_TABLES 生命周期与 terminal receipt。 |
| 读 / 写 | 模型只经 `worldview / historyAgentBaseline` 读取当前 World/世界组、目标事件或关键词、已保存历史总述/纪年与作者补充说明。确认后，考据只写 `historicalTimelineEvents|historicalKeywords.aiConsult`，风暴只写对应 `aiBrainstorm`；条目定稿、概念、另一路结果和其它字段不改。 |
| 状态机 / 硬验证 | 冻结 World/Work/世界组、目标表/ID、完整目标 baseline、来源字段、原结果字段 presence/value、Context Manifest、实际 Prompt 和模板。输出只接受有序标题闭集的非围栏 Markdown；未知模型结果不自动重试，候选 checkpoint 后无需二次模型调用即可恢复。 |
| 采纳恢复 | 确认前复核来源、Context、Prompt 与目标结果字段 CAS；另一结果字段可独立变化。采纳意图冻结后不可取消，只能沿同一 Run 收敛；八个 durable 采纳边界均可幂等恢复，终验回读真实目标字段后才签发 receipt。 |
| 生命周期 / 作用域 | 不新增表/schema；`histories / historicalTimelineEvents / historicalKeywords` 继续由 PROJECT_TABLES 派生 World 归属、世界组、导入导出、删除和重映射生命周期。候选含本地目标 ID，`portable:false`，导入后取消；其它 World/Work/世界组或已删除目标不可恢复/采纳。 |
| UI / 回滚 | `HistoryPanel` 保留人工事件/关键词/总述编辑与已保存结果清除；两个 lane 各自展示候选、拒绝、重试、确认与不可判定运行显式放弃。旧 `useAIStream`、组件内 `assembleContext()`、组件控制器直接 `adopt()` 和内存输出旁路下线。 |
| 验收 | durable 18 项、控制器/UI/既有历史 17 项和注册表 11 项共 46 项定向回归通过；census 收缩为 15 文件 / 28 入口、4 migration。完整 CI 为 361 files / 1699 tests，覆盖率 81.37% statements / 73.69% branches / 78.93% functions / 81.37% lines；3761 模块生产构建与 bundle budget 通过，入口 664.9 KiB / gzip 205.4 KiB，生产依赖审计 0 漏洞。项目 Chromium E2E 49/49；新主路径约 6.3 秒，证明登记 baseline/严格协议进入真实请求、刷新恢复不重复模型调用、确认前零正式结果写入、确认后结果跨刷新持久化。 |

### HARNESS-75 完成卡：Prompt 示例生成 authoring-draft 风险裁决

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-75` 治理小功能。维护者必须依据真实写入路径判断 Prompt 示例生成是否需要 durable Agent，而不是为了 census 清零机械建立项目业务合同。作者要清楚生成结果仍是未保存草稿。 |
| 主归属 / 复用 | 保留设置区 `PromptExamplesEditor → PromptTemplateEditor draft → Prompt store` 单一路径；census 机制登记为 `authoring-draft`，复用既有 AI 配置/消耗分类和 `PROJECT_TABLES` 全局表生命周期，不引入平行 Runner、Context Source 或 AdoptionSchema。 |
| 读 / 写 | 模型只读当前未保存 draft 的 `systemPrompt / userPromptTemplate`，不读取项目/World/Work/Canon。输出只触发父组件 `onChange`；生成后 `promptTemplates` 与 Agent ledger 零写，作者另点顶部「保存」后才写 `promptTemplates.examples`。 |
| 生命周期 / 作用域 | `promptTemplates` 已登记为 `owner=global / exportable=false`，是本机设置而非项目内容；系统模板只读。未保存即离开会按既有编辑器语义丢弃草稿，不把它伪装成可跨项目恢复的 durable 候选。 |
| UI / 失败 | 生成成功明确提示“已加入当前草稿，保存后才生效”；配置缺失零模型调用。作者仍可手动增删示例、预览和一次性保存整个模板。 |
| 验收 | `R-HARNESS75-prompt-examples-authoring-draft` 3 项与 H59 3 项共 6 项定向回归通过：真实 Prompt 输入/category、生成后 DB/ledger 零写、显式保存、离开丢弃、系统模板只读、配置缺失和全局表登记均闭合；census 保持 14 文件 / 26 入口，变为 7 governed / 5 auxiliary / 2 migration。完整 CI 为 365 files / 1728 tests，覆盖率 81.78% statements / 73.79% branches / 79.15% functions / 81.78% lines；3765 模块生产构建、bundle budget 和生产依赖审计通过。项目 Chromium E2E 51/51；新路径 3.9 秒，真实拦截模型请求并验证草稿输入、零 DB/ledger 写入、显式保存和刷新持久化。 |

### HARNESS-74 完成卡：参考分析总结 / 角色聚合 durable 版本派生

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-74` 治理小功能。作者从一个已完成的参考分析版本生成全书总结或角色聚合时，结果先成为可刷新恢复的持久候选；确认前版本和激活参考投影均零写入。 |
| 主归属 / 复用 | 在同一 `inspiration` Agent 下新增 `inspiration.reference-summary / inspiration.reference-characters` 两个 Skill，共用版本派生运行器，复用 Context Gateway、durable Run/checkpoint、通用 record-field CAS、`FIELD_REGISTRY + AdoptionSchema + adopt()`、PROJECT_TABLES 生命周期与 terminal receipt。 |
| 读 / 写 | 模型只经 `referenceDerivedBaseline` 读取当前 Work 中精确参考、精确分析版本及其分块分析、来源/授权声明。总结只写 `referenceAnalysisRuns.analysisSummary`，角色聚合只写 `referenceAnalysisRuns.mergedCharacters`；仅当目标版本仍为 `active` 时同步同字段到 `references` 兼容投影。 |
| 状态机 / 硬验证 | 冻结 Work、参考/版本 ID、版本状态、完整分块派生输入、来源声明、版本与参考投影原字段 presence/value、Context Manifest、实际 Prompt 和模板。总结只接受与非空维度同序 exact-key JSON；角色只接受 1～80 张四字段唯一角色卡。未知模型结果不自动重试。 |
| 采纳恢复 | 确认前复核来源 baseline、Context、Prompt 及两个目标字段 CAS；ready/superseded 版本只写版本字段，active 版本依次写版本和兼容投影。采纳冻结后只能沿原 Run 收敛，版本写后或投影写后中断均可幂等恢复，终验回读两个真实目标后才签发 receipt。 |
| 生命周期 / 作用域 | 不新增表/schema；`references / referenceAnalysisRuns / referenceChunkAnalysis / referenceAnalysisSources` 继续由 PROJECT_TABLES 派生 Work 归属、导入导出、删除和引用重映射生命周期。候选含本地版本 ID，`portable:false`，导入后取消；其它 Work、参考、版本或已删除目标不可恢复/采纳。 |
| UI / 回滚 | `AnalysisReportViewer` 为总结和角色分别展示候选、拒绝、重试、确认与不可判定运行显式放弃；人工版本激活、删除和分块报告阅读保留。旧组件两处直接 `chat()`、内存结果和即时 `updateReferenceAnalysisDerived()` 写回旁路下线。 |
| 验收 | durable 20 项、控制器 3 项、组件 UI 3 项与 H59 3 项共 29 项定向回归通过；缺少模型配置时零 Run，census 收缩为 14 文件 / 26 入口、3 migration。最终完整 CI 为 364 files / 1725 tests，覆盖率 81.41% statements / 73.71% branches / 79.18% functions / 81.41% lines；3765 模块生产构建与 bundle budget 通过，入口 669.7 KiB / gzip 207.1 KiB，生产依赖审计 0 漏洞。项目 Chromium E2E 50/50；新主路径约 8.1 秒，最终代码同路径精确复跑 1/1（9.4 秒），证明登记版本 baseline/严格协议进入真实请求、候选刷新恢复不重复模型调用、确认前零正式写入，确认后版本及 active 参考投影跨刷新持久化。 |

### HARNESS-57 完成卡：人工修正后的 stale / replan

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-57` 小功能。HARNESS-56 证明同一正式目标已发生人工保存后，系统立即以该 fresh receipt 和目标 post-state 为父证据重建当前影响图/计划，并在来源章节恢复时明确展示旧项 `resolved / remaining / new`，而不是让旧 plan/review/handoff 继续冒充当前处理状态。 |
| 主归属 / 复用 | 归 `HARNESS-2` 反向反馈后半链；复用 HARNESS-49 `replanImpactRemediationV1()`、HARNESS-56 child Run/receipt、`buildEditImpactGraphV1()`、`buildImpactRemediationPlanV1()`、durable ledger/checkpoint/terminal receipt 和编辑器现有影响面板。 |
| 范围 | 零模型 child Run；绑定 H56 Run/receipt、冻结旧 plan、目标 post-state、当前 source/graph/plan；按稳定 item ID 做保守确定性差异：旧有新无=`resolved`，新旧均有=`remaining`，新有旧无=`new`。现有项不得仅因目标被编辑就自动宣称 resolved。目标工作区终验后立即执行，来源编辑器可从 ledger 恢复当前结果。 |
| 非范围 | 不改变影响图业务定义，不用模型判断“问题是否解决”，不自动覆盖或重写任何 Canon，不自动执行 HARNESS-47，不生成下游候选，不把 `remaining` 自动关闭，不引入第二个 planner。 |
| 读 | 当前来源正文和影响表仍只经既有确定性图构建器；`chapterContent` 经 `CONTEXT_SOURCES + assembleContext()` 形成 Manifest；目标 post-state 经 `PROJECT_TABLES` 作用域回读；父 H56 receipt 必须 fresh。 |
| 写 | 业务 Canon 零写入，`writeTargets=[]`；只追加既有 Run/event/checkpoint/receipt，不新增 `FIELD_REGISTRY` / AdoptionSchema 项。 |
| 表生命周期 | 不新增表；复用已登记 ledger 三表。包含物理 ID 的检查点 `portable:false`，未完成导入取消、terminal 导入 stale，沿用 HARNESS-56 已验证规则。 |
| 硬验证 | 父 H56 terminal receipt、target post-state、旧 plan hash、当前 source/graph/plan hash、差异集合和 output hash 全绑定；父过期、目标再变、跨 Work、来源删除、检查点篡改、当前计划变化均 fail-closed。 |
| UI / 回滚 | 工作区验证成功文案升级为“修正已验证并重新规划”；返回来源后编辑器从 ledger 展示三类计数和当前 plan。回滚只移除 H57 投影，H56 完成证明与原人工入口不受影响。 |
| 验收 | 目标仅改 `updatedAt` 仍由 H56 阻断；合法修正后只生成一个 H57 child Run；相同结构项保守 remaining、消失项 resolved、新增项 new；刷新恢复幂等；旧 handoff/父 receipt stale、目标二次变化、篡改/跨 Work/导入全部拒绝；定向回归、三注册表、类型、全量测试、构建与 E2E 按风险递增执行。 |

### HARNESS-56 完成卡：人工修正完成证据

| 项目 | 冻结边界 |
|---|---|
| 类型 / 用户故事 | `HARNESS-56` 小功能。作者从可信 impact handoff 到达既有面板并保存后，可以验证“同一目标的正式状态确实变化”，而不是把导航、打开编辑器或点击按钮冒充修正完成。 |
| 主归属 / 复用 | 归 `HARNESS-2` 反向反馈后半链；复用 `ImpactHandoffV2`、HARNESS-54/55 验签与目标解析、`agentRuns / agentRunEvents / agentRunCheckpoints`、RunContract、Context Manifest、terminal receipt 和既有面板保存入口。 |
| 范围 | 零模型开始/恢复/终验 Run；开始时冻结 target pre-state，作者仍在原面板修改，完成时回读同一正式记录并签发 pre/post hash receipt；刷新可从可信 checkpoint 恢复。 |
| 非范围 | 不新增通用修正表单，不拦截或复制各面板保存，不自动写 Canon，不把相同 hash 当作“无需修改”，不 replan，不重跑下游，不引入 OpenCode/Pi/LangGraph/OpenHands 运行时。 |
| 读 | `chapterContent` 仍经 `CONTEXT_SOURCES + assembleContext()` 形成 Manifest；目标正式行只经 `PROJECT_TABLES` 解析和 World/Work scope gate 回读。 |
| 写 | 业务 Canon 零写入，`RunContract.permissions.writeTargets=[]`；只追加既有 durable ledger/checkpoint/receipt 证据，因此不新增 `FIELD_REGISTRY` / AdoptionSchema 项。 |
| 表生命周期 | 不新增表；复用已登记的 `agentRuns / agentRunEvents / agentRunCheckpoints`。项目导入会使 terminal receipt stale；待处理 checkpoint 必须重新验证父 review、scope 与目标，不能在新项目冒充可继续证明。 |
| 硬验证 | 来源正文、旧 plan/graph/source hash、review Run/receipt、最新决定、item、目标 table/record、World/Work、pre/post hash、verifier version 全绑定；目标缺失、跨 Work、错记录、相同 hash、证据篡改全部 fail-closed。 |
| UI / 回滚 | 可信交接提示新增“验证已保存修正”；失败只保留待处理证据并提示作者，关闭提示或返回来源不改业务数据。删除 Run 仍由现有级联生命周期恢复到 HARNESS-55 行为。 |
| 验收 | 导航不完成；合法保存后签发 receipt；错误记录/跨 Work/删除/覆盖/相同 hash/篡改拒绝；刷新恢复不重复建 Run；定向回归、三注册表闸门、类型、全量测试、构建和 E2E 按风险递增执行。 |

## 二、当前功能组合总表

状态：`READY` 可按顺序开工；`DESIGN` 先收敛设计；`DEPENDENT` 等待前置；`LONG-TERM` 保留愿景，不进入近期施工。

| 顺序 | 开发单位 | 作用 | 主要待开发内容 | 完成边界 | 状态 / 依赖 |
|---:|---|---|---|---|---|
| 0 | **GOV-1 架构、质量与发布治理** | 保证扩展前的架构、文档、供应链和发布结论可信 | P1 阻塞与 Agent 固定输入治理已收口；持续治理 `AUDIT-6/7`、`HEALTH-1/4/5` 中的组件复杂度、关键 runner/parser 覆盖、浏览器 smoke 与依赖维护 | 旁路清零或正式登记；关键运行时代码有真实门槛；发布、文档与任务上下文自动对齐 | **P1 COMPLETE；持续治理** |
| 1 | **INV-1 角色物品与状态账本** | 让主角、配角、NPC 拥有真实且可追溯的个人背包 | `INVENTORY-1`、`QUICKWIN-3`、角色状态同步、owner-less 历史数据迁移、按角色一致性 | 持有人、转移、提取范围、角色切换、状态投影、删除/合并、导入导出和迁移一次收口 | **COMPLETE（2026-07-25）** |
| 2 | **CANON-1 长期一致性与 Canon** | 把长篇一致性从提示词劝告升级为可度量、可追溯的软硬工程 | `CONSISTENCY-0`、`CONSISTENCY-2`、`CONSISTENCY-3`、长期一致性路线第 2–4 步、Phase 38 写后事实检测、Phase 39 故事线进度、`EDITOR-2`、`CF-20260703-8` | 覆盖地图、知识账本、世界宪法、时序/故事线、影响传播和编辑器出口闭环；明确硬/软/未覆盖 | **COMPLETE（2026-07-25）** |
| 3 | **PIPE-1 透明生成与质量工作坊** | 让作者看得见、改得动、能分阶段确认 AI 如何生成卷纲、章纲和正文 | `PIPELINE-1`、`PIPELINE-2`、`PIPELINE-3`、`CF-20260702-7`、Phase 38 大纲评估和改进闭环、全局骨架 | 一次性生成与 `GenerationNode` 共用一条管线；提示词、上下文、预算、gate、采纳透明 | **COMPLETE（2026-07-25）** |
| 4 | **WORLD-1 世界知识、词条、地图与修炼** | 把散文设定升级成可关联、可计算、可供创作和运行时共用的知识库 | Codex 世界隔离、Phase 37-a、Phase 34、Phase 35-b/c、`ENH-WORLDMAP-2` 已完成 | Codex/自然/人文无重复入口；地点、势力、物产、器物、修炼、力量阶段与地图关系一致 | **COMPLETE（2026-07-25）** |
| 5 | **STORY-1 角色驱动与动态故事规划** | 让角色变化、角色弧光和主线/支线影响后续大纲 | `CF-20260702-9` 持久化工作区与 `CF-20260702-12` 中途重规划均已完成 | 影响分析 → 作者选择 → 目标范围重规划；不静默修改既有正文 | **COMPLETE（2026-07-25）** |
| 6 | **AUTHOR-1 长篇编辑与作者风格智能** | 提高长篇改稿、个人风格保持和既有作品续写能力 | `EDITOR-5` 与 `FB-5` 高级校准已完成；`FB-4` 已完成可行性审查并在来源/版本/剧情记忆地基就绪前设计暂缓，TipTap 长期优化独立登记 | 实体引用安全重映射；批量改稿预览/快照/撤销；有界改稿样本与作者确认式风格校准；原稿续写不以低保真摘要冒充剧情事实 | **CURRENT SCOPE COMPLETE；FB-4 DESIGN DEFERRED（2026-07-25）** |
| 7 | **IDEA-1 灵感与参考资料演化** | 让灵感和参考资料持续融合、更新、追溯 | `CM-1` 与参考分析版本演化已完成；剧情连续性胶囊仍唯一归未来 `FB-4A` | 灵感与参考分析均具备来源、版本、差异和作者确认边界；失败分析不覆盖当前上下文，原文断点不进入便携备份 | **CURRENT SCOPE COMPLETE（2026-07-25）** |
| 8 | **AGENT-1 对话副驾与 Agent 团队** | 用一个主 Agent 对话组合调用现有能力，不让用户选择分 Agent | 单一主对话、五领域闭环、六角色路由、领域上下文与团队预算已完成；27.2b“整理本章”形成六域可恢复证据候选；27.2c 一致性 Agent 以零 token 后台守卫和显式单次 fast/deep 检测提供只读报告；下一单位先落 SIM-1 共享运行时，再接 NPC 演进 | Tool Registry 薄封装；前台写入必确认；后台默认只读；Canon 负责校验 | **27.2c CONSISTENCY AGENT COMPLETE（2026-07-27）** |
| 9 | **FLOW-2 技术底座 / FLOW-3 领域节点创作** | 把分步骤模式的世界、故事、角色、大纲、正文和连续性能力转化为可自由拆分、连接与控制的完整节点创作系统 | FLOW-2 独立图、运行证据、动态端口、预算、精确资料和确认写回保留；FLOW-3 新增领域节点库、智能前后置创建、语义端口、稳定 Canon 绑定、节点级 AI/API 档案、批量结构生成、脏下游和分步骤同源同步 | 节点模式与分步骤模式能力同源、交互并列；读写与生命周期只走三注册表；不复制第二份世界观/角色/大纲/正文；旧图兼容 | **FLOW-2 ENGINE COMPLETE；FLOW-3A/3B/3C/3D/3E/3F COMPLETE（2026-08-05）** |
| 10 | **SIM-1 世界模拟与互动运行时** | 为跑团、角色聊天、文字游戏和 NPC 演进提供共同状态与事件地基 | SIM-1A 共同运行时核心；SIM-1B 作者选择式 Canon 冻结、来源 hash 审计、角色/地点/物品投影、实体查看和检查点恢复分支；SIM-1C NPC 演进候选、作者确认/拒绝、过期保护和事件回放已交付 | 创作 Canon 与运行时状态分层；模拟不得污染作者原稿；状态变化可回放、可分支；AI 只能产候选 | **SIM-1C COMPLETE（2026-08-03）；TTRPG-1C 与 CHATGAME-1 已消费该基座；NEXT CHATGAME-1 扩展** |
| 11 | **TTRPG-1 跑团与战役主持** | 在 StoryForge 世界中进行单机跑团、规则判定和长期战役 | `TTRPG-1A` 单机战役主持、`1B` 规则与战斗遭遇、`1C` 长期战役已完成；后续 `1D` 多人协作 | AI 叙事与确定性判定分离；第一阶段不做联网多人；战役日志不冒充创作 Canon | **1C COMPLETE（2026-08-05）；NEXT 1D；依赖 SIM-1** |
| 12 | **CHATGAME-1 角色聊天与冒险** | 提供类似酒馆的角色聊天、长期记忆、多角色房间和文字冒险 | ✅ 单角色聊天 MVP：用户身份/场景、冻结角色快照、流式回复、重生成、检查点与分支；后续长期记忆、多角色调度、地点/物品/能力与冒险选择 | 角色知识边界真实；运行时人格/状态不自动反写角色主档；游戏事件只能候选式回流创作层 | **MVP COMPLETE（2026-08-05）；后续扩展依赖 SIM-1，联机依赖 PLATFORM-1** |
| 13 | **PRODUCT-1 新手转化、数据主权与开源信任** | 让新用户快速得到成果，成熟用户敢托付手稿，贡献者能参与 | 当前功能单位：备份恢复可信；后续 `AUDIT-5/8/9/10/11`、加密备份、帮助系统、i18n、安全/贡献/发布政策另行登记 | 当前阶段完成备份导入边界；其余产品能力仍需独立设计和验收 | **CURRENT SCOPE COMPLETE：备份恢复可信（2026-08-05）；后续扩展未完成** |
| 14 | **PLATFORM-1 协作与社区广场** | 支撑世界版本发布、发现、游玩、派生、讨论、协作和社区治理 | 本地世界包 v1/v2 已完成；后续 `PLATFORM-1B/1C` 实施账号、云发布、发现、派生图、协作和治理 | 当前阶段完成不可变本地发布/导入闭环；线上服务服从 `WORLD-2` 世界/作品/实例边界，不直接同步或覆盖本地草稿 | **LOCAL PACKAGE V2 COMPLETE（2026-08-06）；NEXT PLATFORM-1B BACKEND** |
| 15 | **WORLD-2 世界引擎领域重构** | 把散落在分步骤模式中的世界基础、角色资产、主线/支线、大纲/细纲与 SIM 状态机重组为完整世界引擎 | `WORLD-2A` 基线冻结与语义纠偏 → `2B` 完整世界工作台 → `2C` 世界/作品所有权 → `2D` 可执行叙事 → `2E` 版本/发布包 v2 → `2F` 多产品实例统一 | 分步骤模式原样保护；多世界只是可选子系统；世界基础、叙事蓝图和状态机分层；作品与游玩绑定冻结世界版本 | **WORLD-2A 至 WORLD-2F LOCAL FOUNDATION COMPLETE（2026-08-07）** |

## 三、严格施工顺序

1. ✅ GOV-1 第一阶段（2026-07-21）：架构审查治理阻塞与实时版本/规模已收口；持续治理不阻塞下一功能单位。
2. ✅ INV-1（2026-07-25）：按角色物品/状态账本、提取范围、迁移、角色生命周期和一致性升级已收口。
3. ✅ CANON-1（2026-07-25）：覆盖基线 → 认知账本 → 世界宪法 → 存亡时序 → Phase 39 故事线动态进度与交汇全部收口。
4. ✅ PIPE-1（2026-07-25）：透明最终提示词、五阶段章纲工坊、确定性 gate 与既有 Workflow 节点适配已收口；未制造空壳 Agent。
5. ✅ WORLD-1（2026-07-25）：世界隔离地基 → Phase 37-a 修炼体系 → Phase 34 力量追踪 → Phase 35-b 分类/历史合并 → Phase 35-c 导入分类 → ENH-WORLDMAP-2 空间约束地图全部收口。
6. ✅ STORY-1（2026-07-25）：CF-9C 持久化角色驱动工作区与 CF-12 中途角色变化影响分析、作者确认式未来大纲 patch 已收口。
7. ✅ AUTHOR-1 当前范围与 IDEA-1 / CM-1（2026-07-25）：安全实体改名、互动文风校准、FB-4 可行性审查和增量灵感融合已收口。
8. ✅ IDEA-1 参考资料演化（2026-07-25）：来源声明、分析版本、失败隔离、持久化续跑、差异、激活、回滚和便携生命周期已收口；不冒充剧情连续性胶囊。
9. ✅ AGENT-1 主入口与 FLOW-2 核心 MVP（2026-07-26）：主 Agent 已成为唯一对话入口，
   节点模式已使用独立工作区、数据模型和持久运行记录；两者均保持候选与 Canon 分层。
10. ✅ RAG-1 可见资料/检索管理（2026-07-26）：独立入口、Canon 实时投影、稳定资料键、
    记录/字段策略、节点精确选择、真实召回、索引重建/删除和便携往返已收口。
11. ✅ AGENT-1 章后整理与一致性后台守卫（2026-07-27）：整理本章保留作者确认写回；
    一致性后台保存检查零模型调用，显式 fast/deep 最多一次模型调用且全程只读、可恢复。
12. ✅ SIM-1A 共同运行时核心与可见会话壳（2026-07-27）：DB v48 三表、严格追加事件、
    确定性骰子、检查点、分支、导入导出和项目/世界删除已收口；体验中心支持创建、演进、
    刷新恢复和安全删除独立会话。
13. ✅ SIM-1B Canon 冻结选择与运行时实体投影（2026-08-03）：作者显式选择世界、角色、
    地点、物品和规则；冻结来源保留字段、摘要、更新时间与 SHA-256，角色/地点/物品投影为
    独立运行时实体；来源修改/删除不污染存档，检查点恢复建立独立分支。
14. ✅ SIM-1C NPC 演进（2026-08-03）：冻结运行时上下文、严格结构化候选、提案事件、作者确认/拒绝、
    过期保护、确定性 reducer、刷新/分支回放和 NPC 演进 UI 已收口；不新增表、不写回 Canon。
15. ✅ TTRPG-1A 单机战役主持（2026-08-03）：场景、回合顺序、动作、技能检定、AI GM 成功/失败候选、
    原子回合记录和会话续接已收口。
16. ✅ FLOW-3A（2026-08-04）：graph v2 合同、领域目录、语义端口、迁移和三注册表守卫已收口；
    新入口已接入产品综合页与传统工作区，旧 FLOW-2 图仍可迁移读取。
17. ✅ FLOW-3B（2026-08-04）：领域节点工作区、世界/故事候选闭环、项目资料实时绑定概览、来源
    hash 失效提示、下游过期传播和目标 Canon 冲突保护已收口；图删除仍级联清理运行记录且不伤 Canon。
18. ✅ FLOW-3C 完整垂直闭环（2026-08-05）：官方完整创作链覆盖世界→故事→角色→卷纲→章纲→细纲→正文；
    领域 parser、gate、scope、CAS、候选对照/差异、定点绑定和确认写回均复用既有入口。
19. ✅ TTRPG-1B 规则与战斗遭遇（2026-08-05）：AI 遭遇候选确认、确定性先攻、攻击/伤害、资源上下限、
    状态效果、战斗回合、回放和便携往返已收口；下一单元是 FLOW-3D。
20. ✅ FLOW-3D → TTRPG-1C → CHATGAME-1 MVP（2026-08-05）：连续性网络、长期战役和单角色聊天均复用
    SIM 状态层；后续继续扩展互动产品，不为跑团和角色聊天各建一套引擎。
21. ✅ FLOW-3E（2026-08-05）：大图效率、官方模板、执行计划、暂停/断点恢复、过期下游重跑和运行快照
    往返已收口。
22. ✅ FLOW-3F（2026-08-05）：旧 FLOW-2 图兼容读取、显式转换保存、未知节点 fail-closed、备份往返和产品
    入口统一已收口；后续主线进入 PRODUCT-1。
23. ✅ PRODUCT-1 当前阶段（2026-08-05）：备份导入边界新增基于 `PROJECT_TABLES` 的只读结构预检；当前 JSON、文件夹、Gist、
    快照恢复统一在写库前拒绝损坏或未来版本备份，旧格式缺表只给兼容警告。新手成果闭环、加密备份、帮助、i18n
    和法律/贡献文本仍未纳入本次增量。
24. ✅ PLATFORM-1 当前阶段（2026-08-05）：本地世界发布包已交付。作者可以声明署名、许可、内容警告和四类二创用途，包内
    只包含 `PROJECT_TABLES.communityShare='world'` 登记的世界表；SHA-256 预检通过后才可导入为新本地编号副本。
    账号、云同步、评论、协同编辑和发现服务仍需后端/身份/治理架构，不在浏览器端伪造。
25. ✅ WORLD-2 / PLATFORM-1 施工基线（2026-08-05）：先冻结分步骤 Golden Master，纠正“Project=World”与
    “多世界总览=世界引擎”的错误语义，再按完整世界工作台、世界/作品所有权、可执行主支线、不可变发布版本、
    状态机实例和社区服务逐阶段施工。唯一目标架构见
    [WORLD-ENGINE-COMMUNITY-ARCHITECTURE.md](../WORLD-ENGINE-COMMUNITY-ARCHITECTURE.md)。
26. ✅ WORLD-2A / WORLD-2B 第一垂直切片（2026-08-06）：世界引擎不再以 `enableMultiWorld` 为开关，
    新建世界不自动开启多世界；世界完整度改由 `PROJECT_TABLES.worldDomains` 中世界基础、资产和叙事数据派生。
    新的完整世界工作台聚合现有面板，分步骤作品可直接进入，不复制表、不迁移数据。Harness/Agent 工程明确后置，
    先只在分步骤模式独立施工。
27. ✅ WORLD-2C ADR（2026-08-06）：确定 `Project = LocalWorkspace` 物理兼容根，新增显式 World/Work，
    物理 `projectId` 与逻辑 `domainOwner` 分离；旧项目确定性映射为默认世界/作品，迁移采用只加 schema、
    只读预检、持久化 before-image 和逐工作区单事务盖章。两作品读写隔离、v4 往返、删除与回滚反例通过前，
    第二作品入口保持隐藏。正式合同见
    [WORLD-2C-WORLD-WORK-OWNERSHIP.md](../adr/WORLD-2C-WORLD-WORK-OWNERSHIP.md)；C1 schema、
    `domainOwner` 注册合同与架构守卫见下一条，ADR 完成不代表 WORLD-2C 已完成。
28. ✅ WORLD-2C C1 ownership schema（2026-08-06）：DB v49 只新增空的 `worlds`、`works`、
    `workCharacterBindings` 和 `ownershipMigrations`，不在版本升级中搬动旧记录；62 张非全局/全局表继续由
    同一 `PROJECT_TABLES` 覆盖，所有非全局表均登记 `domainOwner`，现有业务表保持 `compat-project`。
    完整备份已能便携重映射新增根与绑定；生产 schema 自检允许正式旧版本交给 Dexie 原子升级，同版本缺表仍
    fail closed。C2 在下一条完成；第二作品入口仍隐藏。
29. ✅ WORLD-2C C2 lazy ownership migration（2026-08-06）：新增唯一的
    `ensureWorkspaceOwnership(projectId)` / `resolveWorkspaceScope(projectId)`，旧工作区首次进入时先只读统计
    注册表派生表，生成不含正文的 SHA-256 主键/owner 指纹并保存紧凑 before-image，再在单一事务中创建或采纳
    默认 World/Work、按 `domainOwner.legacyDefault` 为存量 world/work 记录盖章并更新 Project 兼容镜像。
    重复和并发进入零重复根；任一表写入失败时根、owner 和 Project 指针全部回滚，只留下失败凭证；未知根、
    owner、跨工作区引用和缺失必填引用 fail closed；无后续作用域变化时可原子回滚，新增 Work 后拒绝自动回滚。
    新建项目也走同一服务。
30. ✅ WORLD-2C C3-C5（2026-08-06）：核心 Store、AI 上下文、结构化写回和 Agent 记录统一经过
    `WorkspaceScope` owner gate；严格 v4 owner 影子 ID、v1-v3 兼容、损坏 owner 零写入拒绝、三级删除生命周期、
    注册表派生的双作用域转换与审计全部落地。同一 World 已开放多 Work 创建、切换和删除，双作品 Golden
    Project 与隔离浏览器 E2E 证明不串数据，WORLD-2C COMPLETE。
31. ✅ WORLD-2D（2026-08-07）：NarrativeModule/Node 合同、StoryArc 可重复投影和五类正式入口已落地；最小图
    原子创建，图身份/重复 key/悬空后继/入口/可达性/条件/效果严格校验。Work 当前蓝图经登记上下文源隔离供
    分步骤写作和 Agent 读取，World/Work 共享范围可显式转换。
32. ✅ WORLD-2E（2026-08-07）：发布范围由注册表派生为世界基础、角色、叙事、大纲四区，正文和私有参考固定
    排除；修订父链、最新差异、稳定 SHA-256、冻结期源变化拒绝、幂等 Release 与严格防篡改世界包 v2 已闭环，
    v1 按历史表合同保持兼容。
33. ✅ WORLD-2F（2026-08-07）：实例冻结可验证 SIM Canon、Release 便携叙事 ID、节点图与运行变量；条件、效果、
    选择、过期序列拒绝、事件回放、检查点和分支均确定。跑团、角色聊天、文字游戏、NPC 演进四类实例相互隔离，
    文字游戏已有实际运行入口。WORLD-2 本地世界引擎基座完成；最终 CI 为 265 文件 / 1001 项，独立 Chromium
    E2E 为 37/37。社区后端、各上层产品扩展和 HARNESS-2 仍是独立阶段。

### FLOW-1 历史实验 / FLOW-2 技术底座 / FLOW-3 当前设计卡

- **历史结论**：FLOW-1 的 `PromptWorkflow.graph` 只证明了 DAG 校验和画布交互可行，
  不是独立节点产品；它继续留在提示词管理中服务分步骤配方。
- **当前入口**：产品综合页和传统工作区的“节点创作”均加载 `NodeAuthoringWorkspace`；作者可创建
  项目级领域节点图，按世界/故事/角色/大纲/正文/执行控制分类添加节点、自由拖动/连线，并运行
  全图或任意祖先闭包。旧 `NodeModeWorkspace` 仅作为 FLOW-2 兼容实现保留。
- **读与记录**：项目元素只经 `CONTEXT_SOURCES → assembleContext()`；精确模式通过
  `ragSelection` 选择稳定记录/字段，`nodeRuns` 逐节点保存真实上游文本、权重、预算、
  来源纳入/省略/裁剪、输出、错误与 gate。
- **写与生命周期**：作品仅在内容输出节点由作者明确确认后经 `adopt()` 写回；
  `nodeFlows/nodeRuns` 进入项目备份、导入、项目/世界删除和运行级联。
- **FLOW-3B 同源同步**：项目概览图只保存 `ragDocumentId + fieldKey` 稳定绑定，运行时经
  `assembleContext()` 读取当前 Canon；来源变化会显示过期并沿 DAG 传播。单字段候选保存目标
  hash，采纳前发现分步骤模式已改动目标时阻止覆盖。`R-FLOW3C-domain-node-sync` 覆盖概览不复制正文、
  来源变更传播和目标冲突保护。
- **RAG-1**：创作区新增“资料与检索库”，实时投影 Canon，支持记录/字段启用、权重、token
  上限、章节索引状态、派生缓存重建/删除和最近实际召回；策略与稳定资料键随源记录导出。
- **当前非范围**：条件、循环、并行、脚本/插件、图模板、脏下游自动重跑和 Agent 自动生成图。
  它们不得通过节点直接查询 IndexedDB 或暗中写 Canon。
- **自动化证据**：`R-FLOW2-free-node-mode` 与 `R-RAG1-visible-library` 覆盖图校验、局部拓扑、
  精确资料、实际输入输出、稳定键往返、确认写回、派生索引和删除边界；完整证据见
  `VISUAL-WORKFLOW-DESIGN.md` 与 `RAG-VISIBLE-LIBRARY.md`。
- **FLOW-3 方向纠正**：节点模式与分步骤模式完成同一套小说创作任务，只改变编排方式；
  世界、人文、地理、故事、角色、大纲、正文、伏笔、地点、状态、物品和事实成为可拆分领域
  节点，并提供 ComfyUI 式前后置智能创建和节点级 AI 配置。
- **三注册表边界**：FLOW-3 不新增平行数据权威；节点目录只引用
  `CONTEXT_SOURCES / FIELD_REGISTRY / AdoptionSchema / PROJECT_TABLES` 和现有 Prompt/use-case，
  首版继续复用 `nodeFlows/nodeRuns`。详细产品、交互、数据、迁移、施工与验收方案见
  `NODE-AUTHORING-MODE-DESIGN.md`。

### AGENT-1 当前阶段交付证据

- Tool Registry 当前登记 14 个只读工具；Phase 27.1-a 首批 13 个加上 27.1-d 的
  `read_inspiration_workspace` 均只做参数/作用域校验和
  `CONTEXT_SOURCES → assembleContext()` 选择，不直接扫描 store、不开第二条 AI 读取路径。
- `projectStatus/worldGroups/outlineTree/searchResults` 四类新读取也进入上下文源注册表；项目搜索零网络、零 embedding，最多 10 条、每条 180 字短摘。
- `projectId/worldGroupId` 只来自执行上下文；多世界未选世界、跨项目章节/节点/角色/世界组、跨世界章节和角色均显式拒绝。
- 每个工具公开 source、预算、included/omitted/trimmed 和估算 token；单一 L0/protected 源也不能突破请求总预算，超长章会显式截断。
- Phase 27.1-b 已交付 provider-neutral 严格 JSON 动作协议与只读 `AgentRunner`：最多
  8 轮/8 工具/48K 模型 token/24K 工具结果，硬上限、协议错误、循环、异常 usage、
  上下文裁剪和取消均由代码停止。
- 客户端锁定 `agent.readonly` 分类和真实项目归属；项目内容只作为不可信证据，消息窗口
  不足时拒绝静默裁掉目标或工具历史。
- 真实项目使用当前已配置提供商在 2 轮内执行 2 个正式工具并完成答复，只有标准
  `aiUsageLog` 增长，全部内容表零变化；专项合跑 3 文件/36 测试。
- Phase 27.1-c 已在工作区交付世界来源 ChatCopilot：只读工具装配当前项目/世界，
  `worldview.dimension` 生成可编辑候选，作者明确确认后才经 GenerationNode gate 与
  `adopt(worldviews.worldOrigin)` 写回；切换作用域会作废旧候选。
- 确认采纳不再次调用模型；空值、长度、无变化、来源过期和注册表异常均阻断。真实项目
  验证了拒绝零写入、编辑候选逐字写回、面板同步和临时内容清理；专项 4 文件/17 测试，
  全量 222 文件/777 测试。
- Phase 27.1-d 首个领域扩展已交付灵感反推：作者勾选已保存碎片后，
  `read_inspiration_workspace` 只装配所选来源与同模式最近确认版本；模型产物先形成
  可编辑结构化候选，拒绝零写入，确认不二次调用模型且只经既有
  `saveVersion → adopt(inspirationWorkspaces)` 新增版本，不自动写世界观、故事核心或角色。
- Phase 27.1-d 第二个领域扩展已交付角色生成：只经 `read_worldview/read_characters`
  读取当前世界关联闭包，复用 `character.generate` 生成闭集 JSON；作者可编辑，拒绝零
  写入，确认不二次调用模型且只经 `GenerationNode → adopt(characters)` 新增一个当前
  世界角色。同名、非法枚举、未知字段和角色名单过期均阻断，不自动创建关系边、物品、
  状态卡或大纲。
- Phase 27.1-d 第三个领域扩展已交付大纲生成：复用手工入口的 17 个
  `CONTEXT_SOURCES → assembleContext()`、`outline.volume/outline.chapter` 模型分类和
  `adopt(outlineNodes)`；作者可编辑整批 JSON，确认不二次调用模型。多世界作用域、
  重复标题、并发快照和“先采纳上游世界/角色候选”均由确定性 gate 阻断；规划清洗还会
  合并同领域重复任务，并阻止把“角色变化/已有世界观”等大纲约束擅自扩大为其它写入领域。
- 角色闭环专项随全部 AGENT-1 测试合跑 7 文件/42 项；该阶段完整 CI 224 文件/792 项、
  Chromium 20/20 通过。真实 Agnes 在隔离项目返回完整角色卡，作者编辑标记逐字写入既有
  角色面板，临时项目随后完整清理。
- 大纲闭环交付后的完整 CI 为 232 文件/826 项，Chromium 23/23；真实 Agnes 先暴露并验证
  修复“同领域重复任务”和“约束词扩大写入范围”，最终一个 outline 任务一次返回两卷，
  作者编辑后的可见 JSON 逐字进入正式大纲，隔离项目随后完整清理。
- Phase 27.1-d 第四个领域扩展已交付正文：从当前世界规范章序选择既有章纲，复用正文
  正式上下文与模型分类；空白章可生成、非空章只允许显式续写，候选可编辑且确认不二次
  调用模型。目标章或正文变化会阻断，写回同步失效旧 RAG 证据。
- 当前主 Agent 已提供泛化自然语言入口、计划与后台领域调度，可执行领域为世界来源、
  灵感反推、新增角色、新增大纲和正文；并行自治团队与长期后台 Agent 尚未交付，不把五个
  领域夸成全功能通用代理。
- 主 Agent 编排及五个已闭环领域可分别绑定已有 AI 预设；角色模型会在正式上下文装配前
  解析，使用量记录实际 provider/model。手工面板仍走原四类通用路由，旧配置无损兼容。
- 五个领域可分别设置精简/均衡/完整上下文档位；旧配置默认均衡，完整档保留原登记上限。
  候选卡保存并展示实际纳入、省略、整段裁剪来源、上下文 token 估算和本轮上限。
- `R-AGENT2-main-orchestrator` 覆盖计划清洗、依赖、确定性降级、事件序号、候选编辑和刷新
  恢复；真实浏览器用 Agnes 完成世界来源幕后任务，返回可编辑候选后选择拒绝，正式项目
  数据零写入，隔离项目随后删除。
- Phase 27.2b 首个后台 Agent 已交付“整理本章”：章节编辑器的状态/事实零散按钮收口为
  一个入口，同一正文只发起一次综合抽取；状态、受控事实、物品、故事年表、关系和伏笔
  六域候选均须逐字证据。候选复用归档 `agentConversations/agentEvents` 保存，刷新可恢复；
  正文 hash 变化阻断写回，物品/年表按章整批替换失败会事务回滚，事实只进入 candidate。
- HARNESS-18～37 已把 21 个领域 Skill、17 个提示词执行版本和 14 个只读工具的规范 schema hash 冻结进
  新主 Agent RunContract 与候选 hash；恢复会拒绝 Skill/Prompt/Tool 漂移，旧合同继续按旧协议
  恢复。CI 新增 45 天复核、owner、版本和回归证据新鲜度闸门；该能力只保证执行可归因，
  不冒充真实模型质量收益。
- HARNESS-19 已把 `prose.review → prose.revise → prose.review` 接入章节正文生成/续写主路径：
  信息边界硬门先行，语义 blocking 必须有候选和登记来源逐字证据，只有明确可局部修复的问题
  最多自动修订一次，随后重跑硬门和语义复核。四次模型调用共用团队预算，三个语义步骤均有
  Context Manifest、冻结执行版本和 durable 事件；通过后仍只形成作者可编辑候选，确认才经
  `adopt(chapters)` 写入。旧候选保持兼容但不伪造新评审证据。
- HARNESS-20 已把正文采纳后的检索、六域交接和章节记忆收口为同一个 durable post-adoption
  Run：自动主路径只调用一次既有“整理本章”综合 Agent，不再额外运行状态专用模型旁路；状态、
  事实候选、物品、年表、关系和伏笔继续逐项由作者确认并复用既有 `adopt()`/领域扩展写入。
  `prose.organize` 与 `prose.memory` 已登记为正文 Agent 的非默认 Skill 并冻结执行版本。章节记忆
  写回后才重建检索块和层级摘要；三步全部成功、六域候选已确认且派生状态匹配当前正文时才签发
  post-adoption terminal receipt。历史 Chapter Transition V1 候选继续只读恢复，不再用于新正文主路径。
- HARNESS-21 已把正文生成 Run 与章后处理 Run 绑定为可移植的父子 lineage：子 Run 的契约固定父
  `runId`、父 terminal receipt hash、关系标识和采纳后正文 hash；`agentRuns.parentRunId` 及复合唯一
  索引防止同一正文重复创建同类子 Run。刷新可从父键恢复，父回执或正文产物变化会阻断/撤销子回执，
  UI 明确区分“正文完成”“下游处理中/待确认/可恢复失败”和“全链完成”。导入导出同时重映射契约
  lineage 与物化父键，历史无 lineage 的 Run 仅保留兼容读取并标为旧链。
- HARNESS-41 已把确定性一致性 Fast Guard 接入正文采纳后的 post-adoption durable Run。新 Run 由四步组成：六域整理、章节记忆、检索/摘要重建、一致性守卫；守卫只读、不调用模型、不写 Canon，候选以正文 hash、Context Manifest、step attempt 和 candidate hash 绑定到同一 Run。V2 terminal verifier 会回读这些证据；旧 H20 三步 Run 继续按兼容规则恢复。语义 Fast/Deep 深审仍是作者显式动作，HARNESS-41 不宣称真实模型质量收益。
- HARNESS-42 已增加章后失败步骤恢复控制面：恢复计划从 durable 事件历史确定性计算，已成功步骤不重跑，可重试失败受 `maxAttemptsPerStep` 限制，不可重试/过期/运行中未知窗口阻断；编辑器的“继续章后处理”复用原父子 Run。该单元已有计划级回归，真实浏览器关闭重开证据仍待补。
- HARNESS-43 已把正文编辑影响分析升级为确定性影响图：正文 hash、来源事实/stale、来源记录、后续章节/大纲、摘要、检索块、故事线进度/交汇和章后派生状态统一成有向节点/边，并由主 Agent 影响报告、`consistencyReport` 和编辑器共用。图保持只读、只提示；受限的 `outlineNodes.summary` patch 已由 HARNESS-44 在独立 durable Run 中补上。
- HARNESS-44 已落地第一条受限反向 patch 路径：独立 `plan-execute` durable Run 将正文/影响图 hash 与 `chapterContent` Context Manifest 绑定到作者确认候选；白名单只有 `outlineNodes.summary`，不改正文、事实权威状态或 `locked` 数据。确认后才经 `adopt(outlineNodes, recordId, merge-diffs)` 写回，回读正式状态并签发 terminal receipt；正文/图 stale、候选篡改、越界和锁定目标均阻断。该单元不包含自动级联修订或依赖重跑。
- HARNESS-45 已把 HARNESS-44 接入正文编辑器“影响分析”主路径：作者只能从当前影响图选择后续大纲节点并填写受限摘要候选；创建、刷新恢复、确认和拒绝均通过 durable Run，确认后才经 `adopt()` 写回。恢复重新核对 candidate/source/graph hash，过期或跨作用域候选不会显示为可确认项。该入口不新增模型调用，不改正文、事实权威状态或 locked 数据。
- HARNESS-46 已把影响图节点转换为确定性处理计划：每个节点按系统可重建或作者确认复核分类，计划固定正文 hash、graph hash、节点依赖和计划 hash，并在正文编辑器中展示计数。该单元只读、只分类，不自动执行重建、改正文、改事实或重跑下游；后续执行器必须复用该计划并再次校验 hash。
- HARNESS-47 已把计划中的摘要与检索项接入正文编辑器“执行系统重建”：一个零模型 `plan-execute` durable Run 读取登记的 `chapterContent` 作为 manifest 证据，重建受影响章节检索块和项目层级摘要，校验正文 hash 后签发终态 receipt；重复点击复用已完成 Run，正文 stale、来源越界或没有确定性项目时 fail-closed。作者确认项仍不自动执行。
- HARNESS-48 已收紧正文信息隔离终态：新 V2/V3 正文合同的 `prose-generation.information-boundary` 是必需 acceptance；候选当前性检查和终态 verifier 都会拒绝缺失 boundary hash 的新 Run，或拒绝未来章纲、私人认知、角色未来弧光泄漏。历史 V1 Run 仅保留兼容读取，不作为新主路径证据。
- HARNESS-49 已补影响处理 stale/replan：`replanImpactRemediationV1()` 在正文或影响图变化后重新读取当前图并生成新 plan，返回 `previousPlanHash + changed + graph/plan`，不写 Canon；正文编辑器增加“刷新计划”按钮，旧计划只作为历史证据保留，新的确定性执行必须再次绑定新 plan hash。
- HARNESS-50 已将计划中的 `author-confirmed` 项变成可追踪的作者复核证据：零模型 durable Run 绑定正文、影响图、计划和项目 hash，记录 `acknowledged` / `needs-manual-action` 与理由并签发 receipt；写集合为空且没有 `adoption.committed`，所以它不代表事实、状态、大纲或正文已修正。stale、越界、非作者项和不完整复核事件均阻断；人工修正入口及依赖重跑仍待后续单元。
- HARNESS-51 已新增 `readImpactAuthorReviewsV1()`：重新分析或刷新计划后，从既有 Run 账本回放当前计划每个作者确认项的最新有效决定、理由和 receipt，并在正文编辑器显示已复核/总数与原始证据。回放重新验证当前 source/graph/plan hash、契约目标和候选 hash；旧计划、损坏事件和跨作用域记录不算当前完成。浏览器自动恢复计划、人工修正入口及依赖重跑仍待后续单元。
- HARNESS-52 已把记录为 `needs-manual-action` 的影响项交接到既有人工入口：`impact-handoff.ts` 只生成绑定当前 `planHash + graphHash + sourceTextHash` 的可校验地址，按影响动作/目标表映射到事实库、状态表、物品栏、故事线、年表、关系网、设定、细纲或章节等现有模块；正文编辑器只在有效复核 receipt 存在时显示“打开人工入口”，工作区显示来源/目标/计划证据并支持返回来源章节。交接不新增表、不调用模型、不自动写 Canon；损坏地址、未知模块、非作者确认项和不完整 hash 均不放行。`R-HARNESS52-impact-handoff` 与 `R-AUDIT6-chapter-editor-toolbar` 覆盖映射、往返解析、拒绝旁路和 UI 转发；模块内的具体人工修正与依赖重跑仍需后续独立单元。
- HARNESS-53 已新增 `readCurrentImpactAuthorReviewStateV1()` 并接入正文编辑器重挂载恢复：它不持久化第二份计划，而是从当前章节重新构建 impact graph/plan，再从 Run 账本回放只属于当前 hash 的作者复核 receipt；没有当前 receipt 时不恢复面板，正文或影响图变化后旧计划返回空。影响复核与待确认 patch 并行恢复、分别隔离损坏证据。`R-HARNESS50-impact-review-durable` 覆盖当前恢复和 stale 反例；“只分析但尚未产生任何 durable 动作”的临时计划仍不会跨浏览器恢复，后续需单独决定是否值得增加持久计划证据。
- HARNESS-54 已将人工交接协议升级为 `ImpactHandoffV2`：地址除当前正文/图/计划 hash 外，必须携带产生 `needs-manual-action` 的 Run ID 和 terminal receipt。`WorkspacePage` 不再信任结构正确的查询参数，而是调用 `validateCurrentImpactHandoffV2()` 在当前 Work 中重建图/计划并回放该 item 的最新有效复核后才展示交接证据。伪造 Run/receipt、旧决定被覆盖、来源章纲错配和正文 stale 均 fail-closed；该单元只读、不写 Canon，人工修正完成证明和依赖重跑仍未交付。
- HARNESS-55 已把“可信地址”收紧为“可信且可达的具体记录”：durable 验签通过 `PROJECT_TABLES` 解析并校验目标存在性和 World/Work 归属，章节/细纲业务主键归一为现有面板使用的 `outlineNodeId`；工作区要求 URL、当前模块与交接模块一致，随后让事实、状态、物品、故事线、年表、关系、角色、大纲、细纲、章节、参考和单记录设定面板解除初始筛选并高亮目标。该导航不自动编辑或写 Canon；错误模块、目标缺失、未登记表、同项目跨 Work 和筛选隐藏反例由 `R-HARNESS55-impact-target-validation` / `R-HARNESS55-impact-target-ui` 覆盖。人工修正完成证据、修正后 stale/replan 和依赖重跑仍待后续单元。
- HARNESS-56 已新增人工修正完成证明：可信 handoff 首次打开时创建零模型 child Run，冻结来源 plan/review lineage、精确目标和忽略 `updatedAt` 的正式 pre-state hash；作者仍通过既有面板保存，只有显式“验证已保存修正”回读同一作用域目标且 post-state 不同时才签发 terminal receipt。刷新复用原 Run，错误记录、相同状态、删除/跨 Work、父 review 覆盖、检查点篡改和终验后再修改均 fail-closed；包含本地物理 ID 的待处理检查点标记为不可便携，项目导入后取消，已完成 receipt 按既有规则 stale。`R-HARNESS56-impact-manual-correction` 覆盖 8 项主路径、恢复、UI 和生命周期反例；本单元不 replan、不调用模型、不写 Canon，修正后 stale/replan 与依赖重跑仍待后续单元。
- HARNESS-57 已把 H56 fresh receipt 接入修正后重规划：`executeImpactPostCorrectionReplanV1()` 复用 HARNESS-49 planner 创建零模型 child Run，绑定人工修正 Run/receipt、目标 post-state、旧 plan、当前 graph/plan 和差异 output hash；按稳定 item ID 保守分类 `resolved / remaining / new`，同一项仍在当前图时绝不因“编辑过”而自动关闭。工作区显式终验后立即执行，若完成 H56 后刷新会自动补做；来源编辑器优先恢复 fresh H57 计划和三类计数，已被 H56 消费的旧 review 不再作为当前计划恢复。父 receipt/目标/当前 plan 再变、检查点篡改、跨 Work 与导入均 stale 或 fail-closed；`R-HARNESS57-impact-post-correction-replan` 覆盖 9 项分类、幂等、8 个 durable 中断边界恢复、父子、防篡改、UI 与生命周期反例。本单元零模型、零 Canon 写入，不自动执行确定性重建或生成式下游重跑。
- HARNESS-58 已把 fresh H57 当前计划接到既有 H47 确定性执行器：来源编辑器执行前重新回读 H57，而不是信任内存对象；H58 child 精确绑定父 Run/receipt/output hash，只允许重建 `retrievalChunks / narrativeSummaryNodes`。H47 新增不可便携的真实 output checkpoint，重复执行返回原计数；包括派生写入后、checkpoint 前在内的 10 个中断边界都可沿同一 child 重入，且中断不会被误记为业务失败。H58 完成后 H57 计划成为历史是预期状态，H58 receipt 证明该计划的确定性余项已经执行；普通 H47 手动重建仍兼容。`R-HARNESS58-impact-post-correction-remediation` 覆盖父子、零模型/零 Canon、真实输出、幂等、10 边界、父 stale、frozen output 篡改、导入和 UI 分流。
- HARNESS-59 已把剩余 UI 模型入口 census 固化为机器可检查的 `ai-entry-registry.json`：AST 从 `components/hooks/pages` 统计 `useAIStream()` 实例与直接 `chat()` 构造点，当前共 29 个文件 / 44 个静态入口；其中 7 个由 durable Run、GenerationNode 或 SIM runtime 治理，4 个只读/评测辅助，18 个明确登记为后续迁移。新增未登记入口、调用数漂移、源码已删除但注册表残留、缺少理由/机制/nextUnit 都会令 CI 失败；物品/年表先删后写、关系逐条写、局部正文直接替换和参考实体合并被明确列为 migration，而非误报“全面完成”。
- HARNESS-22 已为主 Agent 同一轮多任务增加 frozen dependency join：下游候选绑定生成时实际读取的
  上游 candidate/output hash 和 Run generation；上游作者编辑后，旧下游不会因新版本已采纳而被放行。
  下游确认前还会回读上游 step 的正式 adoptionHash/succeeded 状态，避免把对话确认误当成写入完成。
  本单元没有开启并发 Agent；有限 fan-out 与 replan 必须在这套同代 join 上继续实现。
- HARNESS-23 已在该 join 上开启首批最多 2 路的候选 fan-out：仅显式“世界来源 + 已保存灵感”
  且无共享写表的叶子并行模型调用，所有 durable 事件、候选提交和正式采纳仍串行。并发预算会
  预留未结算调用；一叶失败保留成功候选，恢复只重跑失败叶，后续角色汇合冻结两叶版本。
  `storyforge:harness:fan-out-v1=disabled` 可无数据迁移回到顺序执行。大纲/正文并行、每叶终态
  receipt、通用审计 fan-out 和 p95/质量 A/B 仍未交付。
- HARNESS-24 已把主 Agent 失败分成临时、协议、stale、确定性、预算、取消和未知类别，并持久化
  action/fingerprint 与失败调用预算。同一错误第二次出现后不再原样重试，而是在 RunContract 授权的
  1 次上限内只 patch 失败任务及下游；身份、Skill、workflow 和权限不可变。契约换代、局部 stale、
  未受影响候选 carry-forward、对话失效标记和新检查点同事务提交；已确认/已采纳候选不原地重规划。
  `storyforge:harness:master-agent-replan-v1=disabled` 可关闭该能力。作者任意 steering UI 和 H3 的
  p95/质量 A/B 仍未交付。
- HARNESS-25 已给新 fan-out Run 的每个候选签发独立确定性步骤回执，并在汇合模型调用前强制验证
  上游回执仍与 candidate/output、Context Manifest、attempt、verifier 和当前 generation 一致。下游候选
  冻结实际消费的 receipt hash；编辑、重规划、篡改、导入和删除都走可回放失效/重签或注册表生命周期。
  历史运行不伪造回执，`agentEvents.durableRunId` 由 DB v53 索引并通过 `PROJECT_TABLES` 便携重映射。
  HARNESS-25 本身只交付候选级确定性回执；首批领域语义终验由 HARNESS-27 接续，通用 fan-out 仍未交付。
- HARNESS-26 已建立顺序执行与有限 fan-out 的离线配对评测和发布门：每个 fixture 冻结内容、输入、计划、
  provider/model、Prompt 和 Tool schema hash/版本，按奇偶交叉执行以减小顺序偏差，再由不同
  provider/model 身份的独立 verifier 评分。记录只保留 output/trace/receipt hash 与聚合指标，完整正文、
  隐藏标签和未知字段均被严格 schema 拒绝；两个变体继续生成可验证的 H0 benchmark artifact。
  发布门要求至少 6 组配对样本、生成完成率与回执覆盖率 100%、语义与证据回归不超过 2 个百分点、
  未来/错世界泄漏为 0、fan-out p95 延迟不高于顺序执行的 90%、token/cost 不超过 1.15 倍，零成本不会
  被伪装成通过。回归已直接运行真实 durable 主 Agent 的顺序/fan-out 路径并核对 1/2 最大并发、逐步
  回执和零 Canon 写入；当前尚未用真实外部模型跑满 6 组发布样本，因此不据此扩大 fan-out 范围。
- HARNESS-27 已为现有限定 fan-out 的世界来源与灵感独立叶子增加领域专用语义终验 Skill。reviewer
  重新经 `assembleContext()` 装配登记来源，且必须使用不同于生成器的 provider/model；blocking 必须同时
  绑定候选逐字引文、`CONTEXT_SOURCES` key 和来源逐字引文，无登记证据的文学质量意见只能 warning 或
  uncertain。通过后候选签发 `master-candidate-step-v2-semantic` fresh receipt，汇合与终局验证同时核对生成/
  审查两个 Context Manifest、artifact hash、执行版本和 durable review 事件。作者编辑会移除旧 artifact 并
  stale 回执，重新执行生成/终验前不能汇合或采纳；当前没有只复审编辑稿的自动局部入口。有限重规划会
  使受审叶及全部下游重新生成；审查阻断暂停给作者处理，不自动消耗重规划额度。
  reviewer 调用计入父候选团队预算，证据复用既有 `agentEvents`/`PROJECT_TABLES` 生命周期；内部 review、
  revise、organize、memory Skill 不能伪装成主计划生成任务。由于 HARNESS-26 尚无真实外部模型的 6 组通过
  artifact，新能力默认关闭，只能显式设置 `storyforge:harness:master-candidate-semantic-review-v1=enabled`；
  不扩大 fan-out 白名单，也不宣称已交付通用审计、自动修订或质量净收益。
- HARNESS-28A–28D 已完成 H4 的证据协议、长篇夹具目录、headless runner 和开发入口迁移：按论文原文冻结 ConStory 五类/19 子型；verifier 只交
  `sourceId + quote`，代码统一计算标准化来源 hash 与 UTF-16 半开 offset，并拒绝不存在、错来源、重复歧义
  和证据篡改。类别、hard/advisory 和 intentional/ambiguous 降级由代码决定。版本化 artifact 绑定 fixture
  输入/隐藏标签、来源、生成/审查身份、Prompt/benchmark、token、延迟、成本和 trace hash，可严格导入导出，
  不复制整篇来源且不写 Canon。headless 目录包含 40+20 个 8,000–12,000 字符的合成长文，四类任务均衡、
  19 子型达到 2+1 覆盖，并含 clean、作者意图及中段/远距控制；不透明公开 ID 和模型可见投影阻止隐藏标签
  泄漏，60 例都已通过正式证据定位/artifact 路径。runner 强制独立模型身份、有限重试、预算、逐例 checkpoint、
  防篡改 JSON 恢复和失败用量核算；aggregate-only scorer 提供预注册 precision/recall、证据、意图/clean 门、
  Wilson 区间及配对 bootstrap 错误密度比较。开发设置页已改走 H4 40+20，逐例验签持久化、刷新恢复、
  development 门禁解锁 held-out、aggregate 展示和 checkpoint 导出均已接入；旧 NS-0/NS-1 模型入口及结果 key
  已删除，H17 保留。当前只有模拟响应/jsdom 的工程证据，sealed 不代表源码标签保密；真实外部模型 40+20
  artifact 与真实浏览器运行已在 H82～H85 补齐；sealed held-out 门禁 FAIL，人工复核和真实创作 generator
  质量收益仍待后续，因此不能把 H4 工程完成误报为生产质量通过。
- HARNESS-29 已把 provider 原生 `tool_calls` 接到现有只读 Agent Runner，但它只是默认关闭的 transport
  优化，不是第二套 Agent 或工具系统。工具 schema 从 `AGENT_READ_TOOLS` 派生，读取仍经
  `CONTEXT_SOURCES + assembleContext()`，执行仍经 `executeAgentTool()` 且没有业务写权限；schema token
  计入物理窗口和 Runner 预算，未知工具、畸形响应及非法参数 fail closed，不会在失败后隐藏重跑文本协议。
  真实任务路由在开始时冻结，新 durable Run 绑定 provider/model/transport capability hash，旧 Run 不补造
  历史绑定。只有 capability matrix 已验证且显式启用时才使用原生 transport；目前只有模拟端点回归，
  尚无真实 provider 的 token、延迟和质量配对证据，因此默认仍是 `text-json-v1`。
- HARNESS-30 已把分步骤模式的故事线 AI 生成收口为现有 `outline` Agent 的 `outline.story-arcs` Skill。
  Skill 从声明的 `CONTEXT_SOURCES` 经 `assembleContext()` 读取世界、故事核心、角色、既有故事线与大纲
  等来源，支持 empty/partial/complete 输入策略和预算压缩；模型只产生严格的 main/sub 多阶段候选。
  候选进入既有 durable Run，刷新可恢复，作者可编辑、拒绝或确认；确认后唯一通过
  `adopt(target=storyArcs)` 写入，并由 snapshot/CAS、结构 gate 和正式数据终验保护。旧
  `story-arc-adapter` 及生成后直接 `addArc()` 的 AI 旁路已删除，人工新增/编辑/删除继续保留。
  当前只证明工程闭环和模拟模型合同，不证明故事线质量收益；角色弧、事件图和阶段 3 全量语义评审仍待后续。
- HARNESS-31 已把分步骤故事核心七字段的 AI 生成收口为现有世界基座 Agent 的
  `world-origin.story-core` Skill。Skill 只经 `assembleContext()` 读取声明的世界、故事核心、力量、词条、
  角色、故事线和卷纲，具备 empty/partial/complete 输入处理、预算压缩与全文救援；每轮只返回一个严格
  `{field,value}` 候选。候选进入 durable Run，刷新可恢复且可编辑/拒绝/确认；确认前正式数据零写入，
  确认后只经 `adopt(storyCores)`，完整故事核心 snapshot/CAS、字段 gate 和 terminal verifier 回读正式值。
  旧 `story-adapter` 和组件级上下文拼接已删除，人工编辑与 Prompt 配置保留。当前只有工程闭环及模拟模型
  的 Chromium 刷新证据，不能宣称真实生成质量已经提升。
- HARNESS-32 已把世界基座三面板的 17 个 AI 字段收口为现有世界基座 Agent 的
  `world-origin.worldview-field` Skill。Skill 只经 `CONTEXT_SOURCES + assembleContext()` 读取正式基座和下游
  反推证据，按 empty/partial/complete 选择创建、参考创建或受约束变换，支持预算压缩/全文救援；每轮只返回
  一个严格 `{field,value}` 候选。确认前 `worldviews` 零写入，确认后只经 `adopt(worldviews)`，完整快照/CAS、
  durable 刷新恢复、作者编辑/拒绝/确认、字段错投和终态回读均有专项回归与 Chromium 证据。旧
  `world-origin.complete` 仅保留历史 durable Run 兼容，人工编辑、词条、历史年表和 Prompt 配置保留；当前
  只证明工程闭环和模拟模型合同，不证明真实模型文学质量收益，也不改动世界引擎体验。
- HARNESS-33 已把分步骤角色面板的普通 AI 生成收口为现有 Character Agent 的
  `character.create` Skill。Skill 只经 Tool Registry → `assembleContext()` 读取世界、故事核心、角色、世界规则
  和历史，按 empty/partial/complete 处理并使用受治理压缩预算；每轮只返回一个严格闭集 JSON 候选。确认前
  `characters` 零写入，确认后只经 `adopt(characters)`，roster snapshot/CAS、刷新恢复、候选编辑/拒绝/确认、
  同名/未知字段/非法枚举/stale 和终态回读均有专项回归。旧 `useAIStream → parseCharacterOutput` 旁路及死代码
  已删除，人工 CRUD、角色轴/维度选择和 Prompt 配置保留；当前不自动创建关系、物品或大纲，不证明真实模型质量收益。
- HARNESS-34 已把分步骤灵感反推面板收口为现有 Inspiration Agent 的 `inspiration.reverse` Skill。作者勾选的
  碎片 ID 会冻结到主 Agent durable plan，读取经正式工具和 `assembleContext()`，候选可刷新恢复、编辑、拒绝
  或确认；确认只新增灵感工作区版本，不自动写入世界观、故事核心、角色或世界组。旧 `useAIStream` 和面板级
  上下文装配已删除，碎片库、差异审阅、多世界预览和后续显式采纳保留。
- HARNESS-35 已把角色驱动开书规划收口为现有大纲 Agent 的 `outline.character-driven` Skill。当前方案 ID
  冻结进 durable plan，方案输入与正式上游均经登记上下文读取；严格候选可刷新恢复、编辑、拒绝或确认。第一次
  确认只保存当前方案，第二次勾选卷才写正式大纲。旧 `useAIStream`、自动保存和弱 parser 已删除，人工弧光输入、
  版本、激活参考、中途重规划和 Prompt 配置保留；角色反推世界基座仍是后续 Foundation Skill。
- HARNESS-36 已把角色中途重规划收口为大纲 Agent 的 `outline.character-revision` Skill。角色变更、正文保护边界、
  过渡区、策略、锚点和方案 ID 固定进 durable plan；其余正式资料只经 `assembleContext()` 装配。严格三档候选会
  由代码拒绝未知/重复节点、已写或保护区 patch 和锚点改名。作者选择具体档位及 patch 后才经
  `adopt(outlineNodes.title/summary)` 写未来大纲，已有空正文行只同步 `chapters.title`；正文、主线、伏笔及影响建议
  不自动写。刷新恢复、完整 snapshot/CAS、确认后部分中断恢复和终态回读已有专项回归与 Chromium 证据；旧
  `useAIStream`、Prompt service 和非 durable patch helper 已删除。当前不证明真实模型质量收益，也不等于完整反馈图。
- HARNESS-37 已把章节正文页与独立细纲页的单章 AI 生成统一到大纲 Agent 的 `outline.details` Skill 和同一个
  durable 控制器。Skill 声明章纲、相邻章、当前细纲及世界/故事/角色/规则等正式来源；严格闭集 JSON 在候选
  持久化前拒绝未知字段、非法枚举和类型，解析失败不再隐藏调用第二个模型。确认前 `detailedOutlines` 零写入，
  刷新后可恢复；确认时重算 Context Manifest，来源变化即 stale，确认后只经 `adopt()`，正式字段匹配后才签发
  terminal receipt。人工场景 CRUD、五阶段工坊和 HARNESS-10 批量细纲保留；当前不证明真实模型场景质量收益。
- HARNESS-38 已把四个角色面板的“AI 补全设定”收口为 Character Agent 的 `character.supplement` Skill。
  目标角色 ID、字段闭集和反向哺喂开关冻结进 durable plan；`targetCharacter` 与其它正式来源只经
  `assembleContext()`，事实和正文表现仅在开关开启时读取。严格候选确认前不写 `characters`，刷新可恢复并可按
  字段编辑、拒绝或确认；确认时逐来源原始 hash 变化即 stale，之后只经 `adopt(recordId, merge-diffs)`，正式状态
  匹配后才签发 terminal receipt。旧组件模型直调、即时写回和宽松空补丁 parser 已删除，人工编辑与四个入口保留。

### GOV-1 第一阶段交付证据

- AI Manual 改用 TypeScript AST 扫描 59 个唯一 moduleKey / 204 条模板；运行时测试独立校验模板元数据、`100_000` 数字预算与重复 key，消除同源假绿。
- 参考分析的结果行、状态更新和整批替换进入 `FIELD_REGISTRY`、`ADOPTION_SCHEMAS`、`adopt()`；跨项目 `referenceId` 被 FK 归属校验拒绝。
- `check:architecture` 扩展到 `src/lib/**` 的受治理表写回和旧 context builder，并带 AST 自测；事实账本与角色合并作为有策略注册表、唯一入口和复审日期的 `ADOPTION_EXTENSIONS`。
- `check:dependencies` 已进入本地与 GitHub CI；React Router
  `GHSA-qwww-vcr4-c8h2` 已通过受控迁移到 `react-router@8.3.0` 修复，同时按官方
  v8 兼容线升级 React，未采用会破坏性降级的 `npm audit fix --force`。
- 覆盖率排除静态 Prompt 数据，真实运行时基线设总门槛以及 AI / import / registry 分层门槛；不再以静态字符串抬分。
- UI 显示语义版本 + 构建 SHA；Blueprint §1.1 的版本、源码、schema、三注册表和 Prompt 规模由 `check:project-metrics` 自动锁定。
- Agent 自动入口改为自包含短宪法，任务专用资料由 `docs/CONTEXT-ROUTING.md` 按 UI、AI 读写、数据生命周期、路线图、PR 和历史追溯分流；`check:agent-context` 锁定入口体积、核心红线和禁止全文必读回退。

### CANON-1 已交付证据

- `CONSISTENCY-COVERAGE-MAP.md` 的 6 个反例均进入 `tests/canon/` 并执行真实机制：物品重复获得、认知边界、检索期世界隔离、设定互斥 2 类和存亡时序全部为活动测试，当前无假绿 todo。
- `check:canon-coverage` 进入 CI，要求 🟢 行有活动反例、🔴 行保留 `todo`，同时锁定活动测试必须调用真实判决/检索机制。
- `knowledgeLedger` 用 v39 事件表分离世界真相与角色认知；候选只能由作者确认后投影，角色/章节/项目/世界和导出导入生命周期均进入三注册表。
- 写作上下文按规范章序注入目标章之前的 known/mistaken 状态；审校从已确认闭集提取逐字引用，再由 `checkCognitionBoundary` 比对并显示在 ReviewPanel。
- 世界宪法复用 `temporalFacts`，以受控主题、四类显式来源 FK、来源指纹和闭集逐字抽取建立可追溯设定 Canon；普通确认遇到异值硬阻断，只有作者第二次明确操作才能取代未锁定旧断言。
- `canonAssertions` 把来源仍有效的 confirmed 宪法回注正文、设定、大纲和审校；事实库提供扫描、候选、确认、冲突、明确取代及来源异常复核入口。
- `aliveStatus` 枚举写前归一到闭集；存亡状态按规范大纲章序实时投影，`superseded` 历史 Canon 在有效区间内仍可读。ReviewPanel 只从已死亡角色闭集中接收“正常活动”逐字引用，再由代码硬比对。
- Phase 39 复用 `StoryArc/StoryStage` 静态闭集，以 v40 `storylineProgress/storylineCrossings` 保存作者确认的动态投影和交汇；AI 输出必须通过 arc、stage、状态和正文逐字证据校验，新线只能经作者明确创建。
- 故事线进度进入正文、大纲和一致性审校上下文，按规范章序阻断未来信息；删章保留证据并断 FK，删阶段清悬空指针，删线硬级联，导出导入重映射均进入三注册表。
- 当前诚实基线为 **6 类可执行、0 类未覆盖**；LLM 只负责候选/引用抽取且仍可能漏，章内复杂时序、未登记语义和生成后世界实体隔离仍不冒充硬保证。

### PIPE-1 已交付证据

- `GenerationNode` 统一封装 `assembleInput → run → gate → adopt`，输入快照会克隆并校验；运行器默认永不自动采纳，只有前台作者确认才能显式写回。
- 卷纲/章纲四类入口与正文生成/续写均走同一节点运行器；透明模式默认关闭，开启后可编辑拼接后的最终 system/user 消息，覆盖只存在于本次会话。
- 当前“章节 → 场景细纲”真实入口提供五阶段工坊：现状扫描 → 动机推演 → 碰撞预演 → 质量闸门 → 场景卡。步骤不可跳级，重做会清后续瞬态产物，同一步可比较和采用最近历史版本。
- 工坊按节点挑选登记上下文，不在五次调用中整包重复项目资料；UI 显示登记上下文和本节点估算 token，并明确深度模式为 5 次调用。
- 新章尚未创建正文记录时，物品与认知投影可直接按 `outlineNodeId` 的规范章序确定“本章之前”边界，不为校验偷偷创建空 Chapter。
- 质量节点和最终采纳前均执行确定性 gate：重复获得、认知闭集引用和世界宪法闭集 claim 命中即阻断；反套路项只作软建议，不冒充硬判。
- 最终场景与不可写清单经 `FIELD_REGISTRY + adopt()` 写入 `detailedOutlines`，非法角色/伏笔 ID 过滤；不可写清单通过 `detailedOutline` 上下文回注正文生成。
- 仓库尚无可运行 `AgentRunner`，因此 PIPELINE-3 只把现有 PromptWorkflow step 适配到同一节点接口；真正的对话/多 Agent 编排仍唯一归 `AGENT-1`。

### WORLD-1 当前阶段证据

- `73e68f4` 冻结 Codex 作用域契约：分类 schema 项目级共享，词条在单世界与多世界中严格精确匹配；手动新增、AI 拆分、ref、编辑器提示和 AI 上下文不再串世界。
- 删除词条、分类或世界会在同一事务清理剩余词条 `refs` 和角色 `raceEntryId`；旧备份中分类残留的 `worldGroupId` 只置空、不删除共享分类。
- DB v41 新增 `cultivationSystems`；`CultivationStage.parentStageIds` 经过重复 ID、悬空父节点、自环和有向环校验，支持线性、分叉与合流。
- 力量体系页面区分世界底层能量与多套修炼流派，并提供境界 DAG 编辑；角色卡可关联种族、主修体系和当前设定境界，异兽词条可关联体系/境界。
- 修炼体系按世界注入既有 `powerSystem` 上下文源，并进入世界宪法来源闭集；修改来源会把旧断言标为 stale，删除来源会降级为 source-missing。
- DB v42 新增 `cultivationProgress` 作者确认事件流；AI 只从角色/体系/境界闭集映射正文唯一逐字证据，候选不落库，作者确认后按规范章序实时投影当前境界、实际路径与时间线。
- 角色卡“当前设定境界”与正文进度严格分层；临时压制、封印、伪装、短时爆发和接近突破不改变事件流。可选回注默认关闭，开启后仍只读取目标章之前的 confirmed 事件。
- 项目/世界删除、单世界转多世界盖章、v41/v42 空迁移、章节/角色/阶段/体系删除、角色/异兽引用以及全部 FK 导出导入均有回归测试；真实浏览器验证了分析候选、作者确认、刷新恢复和开关持久化。
- Phase 35-b 将政治、经济、文化拆成三份概述与三类 Codex；旧合并字段和 `humSociety` 只在兼容区保留，不做语义猜测迁移。
- DB v43 只把同世界旧 `historyLine/worldEvents` 桥接到空的正式 `histories.overview`，已有历史不覆盖；历史上下文读取正式总述、纪年、事件和关键词，且多世界精确隔离。
- 城池词条通过可移植软 FK 关联 `importantLocations`；删地点子树会在同一事务置空引用而不删词条，完整 JSON 往返会重映射新地点 ID。
- 人文页历史入口直达正式历史年表；浏览器端已验证三字段保存、历史导航、城池关联、刷新恢复和删除地点后的安全断链。
- `ENH-WORLDMAP-2` 以“AI 定性关系图 → 本地证据校验 → 确定性约束求解 → Voronoi
  命名实体对齐”落实八向方位、远近和显式里程；同种子同关系可回放，矛盾关系公开残差。
- 比例尺按手动、用户疆域宽度、显式距离、系统估算四级决议并显示来源；里/日程/月程
  换算不伪装成用户公里数，手动值写回当前世界配置。
- 命名首都和聚落只落到适宜陆地；国家规模影响领土扩张，聚落规模影响人口、图标和
  标签，命名河流只匹配最近物理河道。旧配置继续走原 Voronoi 路径。

### STORY-1 交付证据

- DB v44 新增项目级 `characterDrivenPlans`，保存角色弧光快照、作者要求、生成卷章、状态与版本链；工作台提供新建、打开、复制新版、重命名、删除和刷新回填。
- `projects.activeCharacterDrivenPlanId` 只由作者显式设置；`characterDrivenPlan` 上下文源在无 active 时为空，有 active 时进入卷纲、章纲、细纲、场景和正文生成。
- 角色改名显示当前名与快照名；删除角色只断开软 ID，方案和弧光文本不级联删除；合并角色更新 canonical 引用。
- 项目 active、父版本和弧光角色 ID 均使用便携导出序号重映射；旧格式原始 ID 不猜测，导入时安全置空。
- 采纳卷章统一走 `adopt(target=outlineNodes)`，重复采纳幂等；不改 `storyCore`，不触碰既有正文。
- `R-CF9C-*` 覆盖 CRUD、迁移、上下文、导出导入、删除降级与采纳；Chromium 验证真实项目/角色、版本、激活与刷新恢复。
- “开书规划 / 中途重规划”共用角色驱动入口；CF-12 从规范章序和真实正文内容划分已写保护区、近期过渡区与未写规划区，保护边界不得低于最后已写章。HARNESS-36 再把变更、保护区、锚点和方案选择冻结进 durable plan。
- 影响分析只经登记上下文源读取项目资料；严格三档 AI 输出会在本地拒绝未知节点、重复节点、正文/保护区 patch 和锚点改名，并公开警告。
- 作者选择先固化到候选，二次确认后只经 `adopt(target=outlineNodes)` 写未来标题/摘要；已有空正文行仅同步标题。应用前重读完整快照，确认后中断可幂等补齐。
- `R-CF12-character-revision`、`R-HARNESS36-character-revision-agent/panel-ui` 与 Chromium 真实流程验证了已写正文保护、刷新候选恢复、未来 patch 和终态回读；完整边界见 `CHARACTER-REVISION-WORKFLOW-DESIGN.md`。

### AUTHOR-1 当前阶段证据

- `EDITOR-5` 在既有全文查找替换中新增“智能实体改名”：只对角色、重要地点和词条三类稳定实体开放，物品因缺少独立稳定身份继续阻断。
- 预览同时公开 canonical 正文命中、稳定 FK 冗余名同步、名称冲突和自由文本人工复核；跨类型旧名冲突或新名已被实体/物品占用时不允许执行。
- 执行前创建完整项目快照；主档、正文、状态卡、事实显示名、角色认知、修炼进度和物品持有人在单一事务中提交，失败整批回滚。
- 本次会话撤销覆盖相同多表 patch，并在任何记录发生后续修改时拒绝局部恢复；历史角色驱动方案与证据引文不被盲改。
- `R-EDITOR5-entity-rename` 覆盖三类实体、富文本、同名反例、快照/事务失败、过期预览、原子撤销与新名称状态召回；真实浏览器项目验证 2 处正文与主档同步改名及完整撤销。完整边界见 `ENTITY-RENAME-DESIGN.md`。
- `FB-5` 高级阶段复用 `userStyleProfiles` 单例，在对照润色保存后只截取真实变化附近的短片段；最多保存 8 组，学习和下游上下文最多注入 3 组，并优先作者说明。
- 文风学习一次最多读取 6 章、每章 2500 字符；互动校准执行“短文重写 → 作者编辑/判断 → 显式保存样本”，未经确认的 AI 输出不自动学习。
- `style.learn` 继续走分析模型，`style.calibrate` 走创作模型；关闭或不存在非空画像时，画像、样本和反馈均不进入下游上下文。
- `R-FB5-advanced-style`、`R-FB5-style-calibration-ui` 和 Chromium 真实流程覆盖样本边界、导出导入、画像学习、校准反馈、刷新恢复与 TipTap 双栏生命周期。完整边界见 `STYLE-CALIBRATION-DESIGN.md`。
- `FB-4` 审查确认历史方案依赖的 `master-study` 已删除，现有 13 维参考分析只有方法论、没有角色终态/事件因果/结局状态等可校验剧情记忆，上传链也没有来源授权记录。
- 原稿续写因此设计暂缓：不得整本回灌、不得把参考分析摘要当 Canon、不得默认仿写原作者声音；重新立项前必须先具备可追溯来源、版本化剧情胶囊、有界上下文和持久化断点续跑。完整结论见 `FB4-CONTINUATION-FEASIBILITY.md`。

### IDEA-1 已交付证据

- 原“灵感反推”入口升级为项目级增量工作区；碎片记录作者、参考启发、研究资料或其他来源，可勾选本次参与项，未选内容不发送给 AI。
- DB v45 `inspirationWorkspaces` 保存最多 24 个碎片和 12 个确认版本；每轮只带入最多 9000 字符所选碎片和 5000 字符上一版，避免反复回灌全部历史。
- AI 结果先与上一确认版本做字段级差异，未确认时不能采纳到世界观、故事核心、角色或多世界；确认后记录父版本和参与碎片。
- 已确认版本引用的碎片不可删除；旧 `localStorage` 草稿继续兼容，但不会被后台猜测迁移。项目删除、便携导出导入和 v45 空迁移均进入注册表与回归测试。
- Agnes 真实双轮融合验证了新增素材、冲突修正、确认、刷新恢复和来源保护；同时补齐 JSON5 对象字面量及对象字段可读化兼容。完整边界见 `INCREMENTAL-INSPIRATION-DESIGN.md`。
- DB v46 为每份参考增加独立 `referenceAnalysisRuns` 和仅本地的 `referenceAnalysisSources`；分析版本绑定文件哈希、深度、来源类别、使用范围和声明时间，研究/待确认资料被硬收窄为仅分析。
- 新上传先写独立候选版本，旧 active 在分析、失败和取消期间继续作为唯一创作上下文；首版自动激活，后续版本必须由作者显式激活或回滚。
- 分块按 `analysisRunId + chunkIndex` 隔离并持久化真实解析文本用于刷新续跑；TXT/Markdown 可直接上传，EPUB/DOCX/PDF 继续走统一解析入口，避免把二进制当文本。
- 报告支持最多 6 版、维度差异、历史查看、非 active 删除和派生总结/角色按版本保存；AI `rawExcerpt` 只有能在对应原文块核对时才落库。
- 旧 v45 分块在运行时无损桥接为来源待确认的 active v1；项目 JSON 只携带 reference/run/chunk 并重映射 ID，不导出断点原文。参考与项目删除均按注册表原子清理。
- Agnes 合成双版本真实流程验证了 v1 持续生效、v2 候选差异、显式激活、刷新恢复、v2→v1→v2 回滚和零控制台错误。完整边界见 `REFERENCE-ANALYSIS-EVOLUTION-DESIGN.md`。

## 四、原任务唯一归属

| 原任务 | 主归属 | 迁移规则 |
|---|---|---|
| `QUICKWIN-3` | INV-1 | 随按角色账本交付，不单独开发平行提取器 |
| `EDITOR-2` | CANON-1 | 一致性引擎的编辑器出口 |
| `CF-20260703-8` | CANON-1 | 世界宪法反例，不做局部 Prompt 补丁 |
| `CF-20260702-7` | PIPE-1 | 统一质量 gate，不在卷纲/章纲/正文各写一套 |
| `Phase 38` | CANON-1 | 事实检测内核唯一归 Canon；PIPE 只消费 |
| `Phase 39` | CANON-1 | 故事线注册和时序属于 Canon；STORY 只消费影响结果 |
| `Phase 34`、`Phase 35`、`Phase 37`、`Phase 40`、`ENH-WORLDMAP-2` | WORLD-1 | 统一世界知识、力量和地图模型 |
| `CF-20260702-9/12` | STORY-1 | 变化 → 影响分析 → 作者选择 → 局部重规划 |
| `EDITOR-5`、`FB-4/5` | AUTHOR-1 | 安全改稿与个人风格画像不拆成平行 AI 系统 |
| `CM-1`、参考资料演化 | IDEA-1 | 增量素材、来源、差异和版本统一管理 |
| `AUDIT-5`、`AUDIT-8`、`AUDIT-9`、`AUDIT-10`、`AUDIT-11` | PRODUCT-1 | 新手、数据主权、帮助、安全、国际化统一规划 |
| `AUDIT-6`、`AUDIT-7`、`HEALTH-1`、`HEALTH-4`、`HEALTH-5` 的死代码/包体积部分 | GOV-1 | 作为持续治理门槛 |
| `HEALTH-5` 的 i18n 部分 | PRODUCT-1 | 作为产品国际化能力 |
| `Phase 27.1/27.2b` | AGENT-1 | 工具 → 执行 → 对话 → 多 Agent |
| `Phase 27.3` | SIM-1 | 世界模拟，不塞进 Agent MVP |
| 作者提出的 ComfyUI 式节点工作流 | FLOW-1 | 升级现有 PromptWorkflow 并编译到 GenerationNode，不建立平行工作流系统 |
| 作者提出的跑团功能 | TTRPG-1 | 共用 SIM-1 状态、事件和规则层；多人联网等待 PLATFORM-1 |
| 作者提出的酒馆式角色聊天冒险 | CHATGAME-1 | 共用 SIM-1 状态/记忆；角色主档与游戏运行时严格分层 |

> 需要查看迁移前完整任务说明时，使用 [ROADMAP-LEGACY.md](../ROADMAP-LEGACY.md) 搜索原任务 ID。已完成任务的当前能力请先看 [CAPABILITY-BASELINE.md](./CAPABILITY-BASELINE.md)，不要直接根据历史标题重新实现。

## 五、设计文档入口

| 体系 | 设计文档 |
|---|---|
| Canon / 一致性 | [`CONSISTENCY-ENGINEERING-ROUTE.md`](../CONSISTENCY-ENGINEERING-ROUTE.md)、[`CONSISTENCY-COVERAGE-MAP.md`](../CONSISTENCY-COVERAGE-MAP.md)、[`CONSISTENCY-CHECK-DESIGN.md`](../CONSISTENCY-CHECK-DESIGN.md) |
| 透明生成 | [`TRANSPARENT-GENERATION-PIPELINE.md`](../TRANSPARENT-GENERATION-PIPELINE.md) |
| 对话副驾 / Agent | [`AGENT-TOOL-REGISTRY-DESIGN.md`](../AGENT-TOOL-REGISTRY-DESIGN.md)、[`AI-COPILOT-DESIGN.md`](../AI-COPILOT-DESIGN.md) |
| 世界知识 | [`CODEX-REDESIGN.md`](../CODEX-REDESIGN.md)、[`WORLD-RULES-MULTIWORLD-DESIGN.md`](../WORLD-RULES-MULTIWORLD-DESIGN.md) |
| 动态故事规划 | [`CHARACTER-DRIVEN-WORKSPACE-DESIGN.md`](../CHARACTER-DRIVEN-WORKSPACE-DESIGN.md)、[`CHARACTER-REVISION-WORKFLOW-DESIGN.md`](../CHARACTER-REVISION-WORKFLOW-DESIGN.md) |
| 作者工具 / 灵感 | [`ENTITY-RENAME-DESIGN.md`](../ENTITY-RENAME-DESIGN.md)、[`STYLE-CALIBRATION-DESIGN.md`](../STYLE-CALIBRATION-DESIGN.md)、[`FB4-CONTINUATION-FEASIBILITY.md`](../FB4-CONTINUATION-FEASIBILITY.md)、[`INCREMENTAL-INSPIRATION-DESIGN.md`](../INCREMENTAL-INSPIRATION-DESIGN.md) |
| Agent | [`AI-COPILOT-DESIGN.md`](../AI-COPILOT-DESIGN.md) |
| 节点模式 | [`NODE-AUTHORING-MODE-DESIGN.md`](../NODE-AUTHORING-MODE-DESIGN.md)（FLOW-3 当前方案）、[`VISUAL-WORKFLOW-DESIGN.md`](../VISUAL-WORKFLOW-DESIGN.md)（FLOW-1/2 历史与技术证据） |
| 跑团 / 角色聊天 / 互动运行时 | [`INTERACTIVE-RUNTIME-ROADMAP.md`](../INTERACTIVE-RUNTIME-ROADMAP.md) |

设计文档提供方案细节，`README.md` 提供当前归属和施工顺序；两者冲突时，先停止开发并回到 `CLAUDE.md`、`MASTER-BLUEPRINT.md` 和本路线图裁决。

## 六、迁移后仍需单独追踪的边界

这些条目不应混入新功能组合，但也不能因拆分而消失：

| 类型 | 原条目 | 当前处理 |
|---|---|---|
| Bug 复测 | `CF-20260703-7` | 代码与组件回归已完成，仍需恢复预览连接后的真实 UI 复测；按 bug 流程处理，不算新功能体系。 |
| 已交付第一阶段 | `CF-20260702-11` | `/v1/models` 刷新与选择已完成；Ollama pull 仍是待决策扩展，只有重新登记为独立小功能后才能施工。 |
| 历史部分完成标题 | Phase 26 / 28 / 30 / 31 | 对应已交付子项见 `COMPLETED.md`；不得因为标题写着“部分”就推断缺号任务。Phase 31.3 已被 Phase 32 取代。 |
| 重复历史记录 | `FB-3 原始记录` | 已被后续完整 `FB-3` 完成记录覆盖，只作纠错证据，不重新施工。 |
| Canon 阶段记录 | `NS-0`～`NS-6` | 当前代码能力与未完成边界统一由 CANON-1 和能力基线裁决；旧文中的“待审”“⬜”不能单独作为当前状态。 |

### 旧低优先项与长期项的唯一归属

| 原事项 | 唯一主归属 | 处理规则 |
|---|---|---|
| 提示词内容质量审查、`React.lazy` 面板懒加载、UI 运行时走查 | GOV-1 | 转化为可测治理门槛后才能排期，不以无边界“优化”开工。 |
| 移动端适配、i18n、WebDAV、Vercel 代理、帮助与桌面安全形态 | PRODUCT-1 | 先登记独立用户故事和架构边界；不在现有功能旁顺手实现。 |
| TipTap 长期优化 | AUTHOR-1 | 作为编辑体验的小功能或完整功能登记，必须有明确验收。 |
| 协同编辑、账号、云同步、发布发现、社区治理 | PLATFORM-1 | 必须独立完成后端/身份/同步/治理设计后再开工。 |
| OpenCode、Pi、LangGraph、OpenHands 等通用 Agent Harness 对标 | HARNESS-2 后续治理 | 当前先按既有 StoryForge 原生方案完成反向反馈、剩余入口和真实评测主链；不引入第二套 Agent Loop、会话、权限、checkpoint 或持久化运行时。主链完成后再以权限矩阵、turn snapshot/压缩、interrupt/幂等、事件与观测四类机制做只读差距审计，只有可验证缺口才拆成独立小单元。 |

迁移分类的全量计数、部分完成裁决与防漏规则见 [COMPLETED.md](./COMPLETED.md#迁移审计账本)。CI 通过 `npm run check:roadmap` 锁定历史快照、当前归属和文档链接。

## 七、外部反馈与待开发登记（2026-08-03）

WPS 知识库与 GitHub Issue/PR 的最新审计、合并判断和待开发开发表见
[EXTERNAL-FEEDBACK-TRIAGE-20260803.md](./EXTERNAL-FEEDBACK-TRIAGE-20260803.md)。

本次登记遵循三个裁决：

- `SIM-1C` 与 `TTRPG-1A` 已分别作为完整功能单位收口，当前主线转为 `TTRPG-1B`；外部 UI/产品候选不得改变
  `TTRPG-1B → TTRPG-1C → CHATGAME-1 → PRODUCT-1 / PLATFORM-1` 顺序。
- 已被主线覆盖的反馈不重复登记；关闭 PR 的代码只作为问题定位和设计参考，不作为当前实现来源。
- `EXT-*` 只是反馈证据，不是功能单位。候选必须归并到 `PIPE-1`、`CANON/STORY/AUTHOR`、
  `AGENT/PRODUCT`、`WORLD-1` 或 `PLATFORM-1` 等完整功能包；开工前必须补开工登记卡、三注册表四问、
  数据生命周期判断、反例测试和验收证据。
