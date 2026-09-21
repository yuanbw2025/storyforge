# 02 · 专业 Agent 团队与岗位 Skill 方案

> 层级：L2 · 版本：1.7.0 · 生效：2026-09-20
> 性质：目标 Agent/Skill/Run Contract 设计；代码注册、执行回执和测试同时存在后才算实现。

## 1. 核心裁决

Agent 是有稳定职责、权限、上下文边界和最终责任的岗位主体；Skill 是该岗位在某一类工件上执行的版本化方法。不能因为多个 prompt 有不同名字，就把同一个 `outline` Agent 挂载全部 Skill 称作“专业团队”。

每个正式 Agent 必须具有独立 `DomainAgentId`、owner、唯一核心 Skill、输入来源、可写工件、预算、验收与回归。V1.1 不再允许“一个岗位两个相邻 Skill”的折中：连叙事弧与故事圣经、空间架构与系统设计、支线与区域事件、角色圣经与对白审校也分别交给不同 Agent。修复是同一 Skill 的新 attempt，不是再挂一个万能修复 Skill。跨步骤工作只通过已验收工件交接。

## 2. 团队编制

| Agent ID | 岗位 | 核心 Skill | 读取 | 产出与责任 |
|---|---|---|---|---|
| `text-adventure-showrunner` | 制作主管 | `production-supervision.v1` | Brief、固定六阶段和已登记岗位清单 | `production.supervision`；冻结阶段目标、退出证据、停机条件、风险 owner 和作者闸门，不代写专业工件 |
| `text-adventure-creative-director` | 创意总监 | `creative-direction.v1` | Brief、来源审计 | `design.game`；冻结玩家幻想、核心循环、基调和跨部门不变量 |
| `text-adventure-source-editor` | 来源与改编编辑 | `source-sufficiency.v1` | 冻结 SourcePlan、Context Manifest、WorldRelease 资源 | `source.sufficiency`、`adaptation.brief`；不得把产品补充写回世界 |
| `text-adventure-story-architect` | 故事架构师 | `story-bible.v1` | Brief、来源审计、产品方向 | `story.bible`；负责主题、冲突、铺垫回收和结局候选 |
| `text-adventure-narrative-designer` | 叙事设计师 | `narrative-design.v1` | 故事/角色圣经、空间与系统 | 两个有界 Run 分别产出三幕场景卡、决定与回响；确定性装配为 `narrative.arc-plan` |
| `text-adventure-ending-route-designer` | 结局路线设计师 | `ending-route-plan.v1` | 故事/角色圣经、空间架构、正式叙事弧 | `ending-route-plan`；把结局候选绑定到此前决定产生的持久效果，形成互斥、完备且可穷举验证的行动链分区 |
| `text-adventure-cast-director` | 角色总监 | `cast-bible.v1` | 故事圣经、来源角色 | `cast.bible`；负责动机、知识边界、关系弧与声音锚点 |
| `text-adventure-space-designer` | 空间设计师 | `production-architecture.v1` | 故事/角色圣经、来源空间 | `adventure-architecture`；负责大区、区域、地点和场景空间锚点 |
| `text-adventure-game-designer` | 通用玩法系统设计师 | `gameplay-systems.v1` | Brief、故事/角色/空间工件 | `systems.design`；负责属性、技能、资源、物品、装备、关系、时间与检查语义 |
| `text-adventure-main-quest-designer` | 主线任务设计师 | `main-quest-plan.v1` | 故事弧、角色、系统设计 | `quest.main-plan`；把叙事弧拆成阶段、目标、行动路线、代价和状态回响 |
| `text-adventure-side-quest-designer` | 支线任务设计师 | `production-side-quests.v1` | 主线计划、角色、系统、空间 | `quest.side-plan`；生产映照主线且有独立人物诉求的支线 |
| `text-adventure-storylet-designer` | 区域事件设计师 | `production-ambient-events.v1` | 主线计划、角色、系统、空间 | `storylet.plan`；生产有条件、时效和状态回响的区域事件 |
| `text-adventure-quest-scripter` | 任务脚本工程师 | `quest-script-compile.v1` | 主支线/事件计划、系统设计、状态注册表 | `quest.scripts` 候选；把设计编译为条件、命令、检查、效果、阶段和结局条件 |
| `text-adventure-scene-writer` | 分场叙事作者 | `scene-script.v1` | 指定场景卡、角色圣经、任务脚本、前后场摘要 | 分批 `scene.script.*`；写玩家可见正文、对话、选择措辞和失败推进文本 |
| `text-adventure-dialogue-editor` | 独立对白编辑 | `dialogue-pass.v1` | 角色圣经、三幕分场候选 | `dialogue.pass`；逐条审校声音、知识边界、潜台词与玩家选择措辞，只能修订表达文本 |
| `text-adventure-art-director` | 美术总监 | `visual-direction.v1` | 故事/角色/场景定稿与媒资档位 | `media.requirements` 候选；确定性编译器再与角色/空间圣经闭合为 `media.visual-bible`，本 Agent 不直接拥有 provider transport |
| `text-adventure-visual-qa-director` | 独立视觉质检总监 | `visual-quality-review.v1` | 冻结需求、视觉圣经、角色锚点、逐项图片与最小剧情上下文 | `quality.visual-review`；实际观察图片并提出接受、修订、替换或真人复核意见，无权改图或发布 |
| `text-adventure-continuity-editor` | 连续性与内容审校 | `continuity-and-literary-review.v1` | 所有定稿候选和确定性投影 | `quality.continuity`、有证据的问题清单；不能修改原工件或自报通过 |
| `text-adventure-playtest-director` | 试玩与发布验证 | `playtest-strategy.v1` | RuntimePackage、静态报告、自动游玩证据 | 路线矩阵、真人试玩清单、推荐候选意见；正式状态仍由确定性系统执行 |

同一个 `text-adventure-scene-writer` 可以按 Act/场景启动多个独立 Run，因为它们属于同一核心 Skill 的同类工作；每个 Run 仍有单独输入、预算、checkpoint 和 receipt。这不同于让一个 Agent 兼任多个生产步骤。一小时旗舰把每幕冻结为两个场景包，共六个 Scene Writer Run；每个包只填充自己获配的场景槽位，三个零模型调用的分幕装配任务再分别生成 `content.scene-script.act-1/2/3`。叙事设计师也采用同一规则：`narrative-design.v1` 先执行“三幕与场景卡”Run，再以其结果执行“玩家决定与跨场景回响”Run；两者是一个专业方法的分步合同，不是两个岗位 Skill，正式 `narrative.arc-plan` 由确定性装配器生成。结局路线设计师随后单独消费正式叙事弧，用 `ending-route-plan.v1` 为每个结局选择具有因果意义的持久效果集合；严格 parser 穷举所引用二元决定的全部组合，要求每种组合恰好命中一个结局且每个结局至少可达。任务脚本工程师的唯一 `quest-script-compile.v1` Skill 则把每一幕按单解/多解目标分为两个 Run，再执行一个支线/区域事件 Run，共七个有界合同；它们分别逐项覆盖冻结目标，最后由零模型调用装配器生成正式 `quest.scripts`。这样既避免长 JSON 在 provider 侧截断，也让多路线目标与玩家可见正文获得独立预算，而不把职责重新塞回万能 Agent。当前登记的 19 个岗位各自只有一个核心 Skill；计划回归会进一步验证 19 个岗位全部真实出现在模型任务中，而且同一岗位在计划里不会出现第二个 Skill。

`production.supervision` 现在是专业 DAG 的第一个真实模型任务，不再是纸面 Skill。其严格 parser 要求固定 G1–G6 顺序、19 个已登记 Agent 不重不漏且每个只分配一次、至少三项风险、三项作者闸门和三项非目标。来源审计必须读取这份监督工件；内容质量审查和最终装配也把它纳入输入与发布证据。纯运行包演化可携带该工件，来源或内容变化会使它与下游闭包一起重新生产。

## 3. 权限矩阵

- Showrunner 只能产出阶段监督候选；任务创建、依赖、预算、调度、暂停和恢复由冻结 Plan 与确定性 Scheduler 执行。Showrunner 不能动态追加调用、改变依赖或把任何工件标为通过。
- 专业 Agent 只读登记上下文和上游已采纳工件，只能写自己的候选 Artifact key。
- Quest Scripter 只能生成已注册通用状态与命令的候选；确定性编译器负责拒绝未登记字段和执行语义。
- Scene Writer 和 Dialogue Editor 可写表达文本，不能直接改变正式条件、资源、任务阶段或结局规则。
- Continuity Editor 与 Playtest Director 必须独立于被审查工件的 producer，不得复用同一个 Run receipt 自审。
- Art Director 只形成视觉圣经和需求；Provider Adapter 持有 transport 与凭据，Visual QA Director 独立审图，任何模型上下文都不得包含 API Key。
- 作者独占来源范围、商业候选的角色锚点、高影响重生成、最终推荐候选和 ProductRelease 的采纳权。角色锚点确认只对当前 `media.visual-bible` hash 生效，不能跨变化后的视觉方向静默沿用。

## 4. 每个 Skill 的最低合同

每个 Skill 注册必须明确：

1. 唯一 Agent owner 与版本化 prompt/schema。
2. 必读、选读、禁止读取资源；Context Gateway 的最大读取次数、token 和回退边界。
3. 输入工件 schema/version/hash 与允许写入的唯一 Artifact key。
4. 正常、空来源、陈旧、非法、超大、预算不足、provider 失败、刷新恢复、拒绝、采纳、下游传播和错作用域反例。
5. 最大调用、输入/输出 token、时长、成本和尝试次数；结果未知时暂停，不能隐藏重发。
6. 结构验收、专业验收和下游消费证据。模型自述“完成”不算验收。

## 5. 作者界面

工作台按制作部门和阶段显示，而不是把内部表倾倒给作者。每个任务卡显示岗位、输入版本、进度、当前 attempt、预算消耗、候选状态、阻塞原因和下游影响。作者可以锁定已认可工件、比较修复前后差异、只重跑依赖闭包、暂停高成本任务；被锁定工件发生上游 stale 时必须显式提示，不能静默覆盖。
