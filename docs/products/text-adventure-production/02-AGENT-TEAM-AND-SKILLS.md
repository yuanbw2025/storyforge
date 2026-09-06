# 02 · 专业 Agent 团队与岗位 Skill 方案

> 层级：L2 · 版本：1.0.0 · 生效：2026-09-06
> 性质：目标 Agent/Skill/Run Contract 设计；代码注册、执行回执和测试同时存在后才算实现。

## 1. 核心裁决

Agent 是有稳定职责、权限、上下文边界和最终责任的岗位主体；Skill 是该岗位在某一类工件上执行的版本化方法。不能因为多个 prompt 有不同名字，就把同一个 `outline` Agent 挂载全部 Skill 称作“专业团队”。

每个正式 Agent 必须具有独立 `DomainAgentId`、owner、允许的 Skill 集、输入来源、可写工件、预算、验收与回归。一个 Agent 默认只有一个核心 Skill，最多再拥有一个同一专业域的修复 Skill；跨专业任务必须通过工件交接，而不是继续给同一 Agent 增加 Skill。

## 2. 团队编制

| Agent ID | 岗位 | 核心 Skill | 读取 | 产出与责任 |
|---|---|---|---|---|
| `text-adventure-showrunner` | 制作主管 | `production-supervision.v1` | Brief、计划、所有工件状态与质量回执摘要 | 冻结计划、调度、暂停、风险与作者闸门；不代写专业工件 |
| `text-adventure-source-editor` | 来源与改编编辑 | `source-sufficiency.v1` | 冻结 SourcePlan、Context Manifest、WorldRelease 资源 | `source.sufficiency`、`adaptation.brief`；不得把产品补充写回世界 |
| `text-adventure-story-architect` | 故事架构师 | `story-bible-and-arcs.v1` | Brief、来源审计、选定世界资源 | `story.bible`、`narrative.arc-plan`；负责主题、冲突、节奏、铺垫回收和结局候选 |
| `text-adventure-cast-director` | 角色与对白总监 | `cast-bible.v1`、`dialogue-pass.v1` | 故事圣经、来源角色、场景脚本 | `cast.bible`、对白修订；负责动机、知识边界、关系弧与说话差异 |
| `text-adventure-game-designer` | 通用玩法系统设计师 | `gameplay-systems.v1` | Brief、故事圣经、角色圣经 | `systems.design`；负责属性、技能、资源、物品、装备、关系、时间与检查语义 |
| `text-adventure-main-quest-designer` | 主线任务设计师 | `main-quest-plan.v1` | 故事弧、角色、系统设计 | `quest.main-plan`；把叙事弧拆成阶段、目标、行动路线、代价和状态回响 |
| `text-adventure-side-content-designer` | 支线与区域内容设计师 | `side-and-storylet-plan.v1` | 主线计划、角色、系统、空间 | `quest.side-plan`、`storylet.plan`；不得生产与主线无关的填充任务 |
| `text-adventure-quest-scripter` | 任务脚本工程师 | `quest-script-compile.v1` | 主支线/事件计划、系统设计、状态注册表 | `quest.scripts` 候选；把设计编译为条件、命令、检查、效果、阶段和结局条件 |
| `text-adventure-scene-writer` | 分场叙事作者 | `scene-script.v1` | 指定场景卡、角色圣经、任务脚本、前后场摘要 | 分批 `scene.script.*`；写玩家可见正文、对话、选择措辞和失败推进文本 |
| `text-adventure-art-director` | 美术总监 | `visual-bible-and-asset-plan.v1` | 故事/角色/场景定稿与媒资档位 | `visual.bible`、`media.requirements`、审图结果；不直接拥有 provider transport |
| `text-adventure-continuity-editor` | 连续性与内容审校 | `continuity-and-literary-review.v1` | 所有定稿候选和确定性投影 | `quality.continuity`、有证据的问题清单；不能修改原工件或自报通过 |
| `text-adventure-playtest-director` | 试玩与发布验证 | `playtest-strategy.v1` | RuntimePackage、静态报告、自动游玩证据 | 路线矩阵、真人试玩清单、推荐候选意见；正式状态仍由确定性系统执行 |

同一个 `text-adventure-scene-writer` 可以按 Act/场景启动多个独立 Run，因为它们属于同一专业岗位的同类工作；每个 Run 仍有单独输入、预算、checkpoint 和 receipt。这不同于让一个 Agent 兼任故事架构、系统设计、任务编译、美术和质量审查。

## 3. 权限矩阵

- Showrunner 可创建已登记任务、读取状态与提交暂停/恢复/重跑候选；不能绕过计划新增模型调用，也不能把工件直接标为通过。
- 专业 Agent 只读登记上下文和上游已采纳工件，只能写自己的候选 Artifact key。
- Quest Scripter 只能生成已注册通用状态与命令的候选；确定性编译器负责拒绝未登记字段和执行语义。
- Scene Writer 和 Cast Director 可写表达文本，不能直接改变正式条件、资源、任务阶段或结局规则。
- Continuity Editor 与 Playtest Director 必须独立于被审查工件的 producer，不得复用同一个 Run receipt 自审。
- Art Director 只形成视觉圣经、需求和审查；Provider Adapter 持有 transport 与凭据，模型上下文永不包含 API Key。
- 作者独占来源范围、主要角色锚点、高影响重生成、最终推荐候选和 ProductRelease 的采纳权。

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

