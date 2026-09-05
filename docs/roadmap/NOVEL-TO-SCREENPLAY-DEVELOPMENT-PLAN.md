# 小说转剧本独立产品开发设计

> 版本：1.0.0 · 生效：2026-09-06 · 权威层级：L2
> 对应总纲：§4.4、阶段 C · 产品：`independent.screenplay`
> 性质：小说转剧本唯一专项施工方案。它不拥有短篇正文、漫画页格或漫画媒资。
> 实施状态：2026-09-06 工程闭环完成；`R-SCREEN2-professional-pipeline`、剧本 Chromium E2E、全量 CI/E2E 为交付证据，模型质量与人工盲评继续作为发布后质量评测。

## 1. 开工卡与边界

- 产品阶段：独立改编产品的生产阶段，没有拍摄运行阶段。
- 用户入口：Product Hub 创建“小说转剧本”，选择本地 Work/章节或导入文本作为来源。
- 用户结果：把冻结小说范围改编为电影、分集剧或短剧的中立 Screenplay AST，经作者审定后发布并导出 Fountain、FDX 和 PDF/打印 HTML。
- 数据 owner：目标 Screenplay Work；源 Work 只被只读、版本化引用。
- 世界引用：V1 不依赖 World，也不把剧本封装为 World；世界引擎不拥有来源分析、场次、审查或剧本 Release。
- 媒资 owner：V1 不生产演员、分镜、视频或音频媒资。
- 非范围：锁页、修订色页、制片分解、预算排期、拍摄通告、多人实时协作。

入口到结果：

```text
选择并冻结来源
→ 分块提取事实、人物状态和事件
→ 构建因果图与改编决策
→ 确认 Adaptation Brief
→ 确认 beat sheet
→ 确认 scene cards
→ 逐场写作 Screenplay AST
→ 来源/连续性/戏剧性/格式审查
→ 定点改写与复审
→ 发布不可变剧本版本
→ Fountain / FDX / PDF 导出
```

## 2. 专业依据与工程结论

一手资料和研究共同指向“先拆解、再改编、后成稿”，不能把小说段落直接换成剧本格式：

- Screen Australia 把 core concept、outline、treatment、scene breakdown 视为递进的开发文档；因此 Brief、beat 和 scene card 必须先于正式场次。
- BBC 与 Final Draft 把场景标题、动作、人物、对白、括注和转场视为不同元素；因此内部保存 AST，不保存一整块难以验证的富文本。
- Fountain 是面向创作和交换的纯文本语法；它适合作为导出，不是 StoryForge 的唯一内部模型。
- R² 使用章节滑窗、事实/事件读取、因果图、场景大纲和幻觉感知修订；因此长来源要分块并保留 source mapping。
- IBSEN 的 director/actor 分工说明全局剧情控制与角色行为生成是不同职责；StoryForge 使用结构编辑 Skill 和场景写作 Skill，而不是一个万能 Agent。

这些结论只决定生产分解，不把研究模型的私有实现或单一格式画像写成产品真理。

## 3. 当前基线与专项缺口

可复用能力：`AdaptationProject`、冻结 source manifest/source unit、`ScreenplayScene` AST、场次编辑与锁定、Fountain/FDX/打印渲染器、CreativeArtifact 和 adaptation durable runner。

开工前缺口：

1. 普通用户没有从零创建和导入来源的完整纵切面。
2. `plan` 过薄，缺少来源事实、因果关系、逐项删改决策、beat 和 scene card。
3. 单次场景生成没有独立 grounding critic、戏剧审查和定点 rewrite。
4. 格式导出可用，但没有从不可变 Release 导出和 round-trip 证明。
5. 缺少长来源规模门、局部 stale、删除来源后的冻结恢复和完整 E2E。

## 4. 数据模型与 owner

### 4.1 共享来源分析

以下最小契约可以与漫画共享，但记录仍由各自目标 Work 拥有：

- `AdaptationSourceFactV1`：事实、事件、人物状态、关系、地点、物件、主题母题；绑定 `manifestVersion` 和 `sourceUnitKeys`。
- `AdaptationCausalEdgeV1`：`cause | enables | motivates | reveals | prevents`，保存首尾稳定 key 和来源证据。
- `AdaptationDecisionV1`：`keep | cut | merge | reorder | externalize | add`，保存理由、目标和作者状态。
- `AdaptationBriefV2`：目标媒介、长度、受众、主题、故事引擎、禁改项、自由度和未决问题。

共享契约只能在独立基础提交中定义；剧本分支不得为漫画创建 page/panel 字段。

### 4.2 剧本专用产物

- `ScreenplayBeatV1`：全局/分集节拍，保存目标、转折、因果入口、时长预算和来源证据。
- `ScreenplaySceneCardV1`：逐场目的、冲突、进入/退出状态、可视动作、信息揭示、来源单元和预计时长。
- `ScreenplayScene`：中立 AST；场景标题与有序 block 分离。
- `ScreenplayReviewIssueV1`：`grounding | continuity | dramaturgy | format`，绑定 scene/block 和 evidence。
- `CreationReleaseV1(productKind = screenplay)`：固定 Brief、决策、beats、scene cards、scene AST、格式画像、验证回执和 hash。

禁止用小说 Chapter 充当 Scene，禁止用 comic panel 充当镜头或 scene。

## 5. Screenplay AST 与格式合同

场景拥有稳定 `sceneKey`、episode/scene number、`INT | EXT | INT_EXT`、location、time of day、summary、预计秒数、来源单元和状态。

有序 block 闭集：

- `action`
- `character`
- `dialogue`
- `parenthetical`
- `transition`
- `shot`

确定性 lint 至少验证：

1. scene heading 的内外景、地点和时间完整。
2. dialogue/parenthetical 前存在一致的 character cue。
3. 角色 cue 规范化后稳定，不因别名产生伪角色。
4. action 只描述可见、可听或可执行的舞台信息；“内心说明”标记为需外化的语义问题。
5. block 顺序、scene number、episode number 和 stable key 唯一。
6. 时长预算与目标画像一致；偏差是可解释 warning/hard failure。

内部 AST 是唯一正式事实；Fountain、FDX、HTML/PDF 都从指定 Release 纯函数渲染。导出文件回读不得丢场景与核心 block 顺序。

## 6. 三注册表与生命周期

### 6.1 Context Sources

- `adaptation.sourceManifest`：冻结来源范围、hash 和 source units。
- `adaptation.sourceFacts`：检索到的事实、人物状态、事件和因果邻域。
- `adaptation.decisions`：作者已确认的 keep/cut/merge/reorder/externalize/add。
- `screenplay.beats`：目标段/集的节拍和时长预算。
- `screenplay.sceneCards`：目标场及相邻场进入/退出状态。
- `screenplay.currentScenes`：当前 AST、相邻连续性和 review evidence。

每个 reader 验证 medium、Work、adaptationProject、manifest version 和目标 ID；越界 fail-closed。

### 6.2 Field/Adoption

Brief、facts、edges、decisions、beats、cards、scenes 和 review issues 分别登记。一个 Skill 只写自己的候选类型，作者确认后经专用 service/adopt 事务写入。

### 6.3 `PROJECT_TABLES`

新增 facts/edges/decisions、beats/cards/review issues 和 screenplay Release 生命周期；全部随目标 Work 导出、导入、删除和 ID 重映射。来源 Work 删除后保留冻结 source units 与 manifest hash，但清除可选物理 FK；已发布剧本继续可读。

## 7. Agent/Skill DAG 与人工闸门

| Skill | 职业角色 | 唯一职责 | 候选输出 | 人工闸门 |
|---|---|---|---|---|
| `adaptation.source-analysis` | 改编资料编辑 | 分块提取来源事实和事件 | facts | 批量核对 |
| `adaptation.causal-graph` | 故事分析师 | 建立有证据的因果边 | edges | 冲突核对 |
| `screenplay.adaptation-brief` | 改编编辑 | 提出核心、受众和删改原则 | Brief | 确认改编合同 |
| `screenplay.decision-pass` | 改编编辑 | 对来源事件逐项 keep/cut/merge/reorder/externalize/add | decisions | 逐项确认 |
| `screenplay.beat-sheet` | 结构编剧 | 分配幕/集、转折和时长 | beats | 确认结构 |
| `screenplay.scene-card` | 场景设计师 | 把 beat 变成逐场因果骨架 | cards | 确认场次 |
| `screenplay.scene-draft` | 场景编剧 | 只写一场 AST | scene | 逐场确认 |
| `screenplay.grounding-review` | 改编连续性编辑 | 核对来源、决定和人物状态 | issues | 选择问题 |
| `screenplay.dramaturgy-review` | 剧本编辑 | 核对冲突、动作化、节奏和对白功能 | issues | 选择问题 |
| `screenplay.targeted-rewrite` | 修订编剧 | 只修改指定 scene/block 和 issue | scene patch | 精确确认 |

格式 lint 和 renderer 是确定性代码，不调用模型。Agent 不允许在审查后静默自动接受改稿。

## 8. Prompt Spec

所有 Skill 明确：职业角色、唯一任务、目标媒介画像、事实层级、冻结 source refs、作者锁定项、允许的改编自由度、输出 schema、禁止事项、失败规则和静默自检。

关键提示词策略：

- 区分 `source fact`、`confirmed decision`、`proposal`；新增桥接内容必须标记 `add`，不可伪装为原文。
- 内心活动必须转换为行为、选择、对白、声音或明确批准的旁白；不能把小说心理段落放进 action。
- 场景写作只读取目标 card、因果邻域、相关 source units 和相邻状态，不读取整部小说全文。
- 对白服务当前行动与冲突，不复制来源长段对白。
- reviewer 必须返回 scene/block 定位和 evidence；无证据不报 grounding failure。
- rewrite 只处理选中的 issue，保持未授权 sceneKey、顺序、人物事实和锁定台词。

parser 使用闭集 schema，拒绝额外字段、未知 block、伪造 source key 和超目标场景。

## 9. 三类目标画像

- 电影：单一完整时长，按幕/序列分配节拍和场次预算。
- 分集剧：保存 series/episode 目标、每集引擎、集尾推进和跨集状态；不把全部集写成一场长剧本。
- 短剧：保存单集短时长、强入口、高密度转折和连续钩子；不简单把电影页数按比例压缩。

画像是版本化配置，不把“一页一分钟”当成语言无关硬等式；页面估算、预计秒数和实际导出页数分别展示。

## 10. 工作台与恢复

工作台依次展示 Source、Brief、Decisions、Beats、Scene Cards、Scenes、Review、Release。

- 来源页显示冻结范围、manifest version、hash、解析进度和证据回跳。
- 决策页允许批量筛选和逐项确认删改理由。
- Scene Card 与 Scene AST 是两个编辑面板，不能共用一份 JSON 文本框。
- 场次编辑器提供结构化 block、新增/移动/删除、锁定、lint 和来源证据。
- Review 面板按问题类型和场次定位，定点重写前显示精确 diff。
- 刷新后恢复 Run、候选、采纳状态和进度；未知 provider 结果不隐藏重发。

## 11. 发布与导出

发布验证：来源 manifest 完整、所有已纳入决定可追踪、beats/cards/scenes 无缺口、scene lint 通过、无 open critical issue、无 stale/pending 候选、目标时长在画像容差内。

Release 创建后：

- Fountain、FDX、HTML/PDF 都从 Release manifest 生成。
- 修改草稿或源小说不改变旧 Release。
- reopen 生成新草稿 revision；下次发布创建 v2，不覆盖 v1。
- Fountain round-trip 保持场景/核心 block 顺序；FDX 必须是可解析 XML；Unicode 中文字体与分页有自动验证。

## 12. 测试、样例与评测

原创/合成样例：

- `SCREEN-INTERNAL-01`：第一人称强内心、外部动作少，验证 externalize 决策。
- `SCREEN-CAUSAL-01`：事件顺序可调但因果不可破坏，验证 causal edge 与 reorder。
- `SCREEN-EPISODIC-01`：三集短剧，验证分集状态、钩子和时长预算。
- `SCREEN-GROUNDING-01`：混入一个无来源新增事实，review 必须定位并阻断发布。

必测：

- 12K 来源完整 Golden；100K+ 分块来源规模门和 bounded context。
- 删除、合并、重排、外化和新增决定均有 source mapping 正反例。
- 上游单元变化只使受影响 facts/cards/scenes stale；其它已确认产物不被全量作废。
- provider 超时、结果未知、checkpoint 崩溃窗、重复采纳和跨 Work 全部 fail-closed。
- Fountain/FDX round-trip、PDF 分页、角色 cue、scene heading 和 AST lint。
- 发布 v1→reopen→v2，旧 Release 不变；完整备份与来源 FK 删除生命周期。
- Product Hub 从导入小说到剧本 Release/导出的真实 E2E。
- 人工盲评至少覆盖来源忠实度、戏剧性、可视化、人物声音、节奏和可编辑性；不以单一模型总分代替。

## 13. 施工顺序与分支

唯一功能分支：`feat/screenplay-production`；从已审定的独立创作集成基线创建独立 worktree。不得从含未合并漫画改动的工作树拉分支。

1. 共享来源分析契约与迁移先作为独立 foundation 提交落入集成基线。
2. 剧本 beats/cards/issues、三注册表和生命周期。
3. 十个 Skill、Prompt、durable DAG、stale 和恢复。
4. AST 编辑、审查、完成验证、Release 与三种导出。
5. 规模门、Golden、UI E2E、完整 CI 和专项审查。

## 14. 完成定义

电影、分集剧和短剧至少各有一个真实用户路径；长来源分块、来源追踪、专业审校、格式导出、不可变版本和恢复反例全部通过，才将 `independent.screenplay` 标记 released。短篇或漫画状态不参与该结论。

## 15. 研究来源

访问/复核日期：2026-09-06。

- [Screen Australia · Story Documents: Drama](https://www.screenaustralia.gov.au/getmedia/133af42b-7abe-4ebc-a164-799c1c7a4614/Story-Documents-Drama.pdf)
- [BBC Writersroom · Screenplay Format for TV Shows](https://downloads.bbc.co.uk/writersroom/scripts/screenplaytv.pdf)
- [Final Draft · Script Elements](https://kb.finaldraft.com/hc/en-us/articles/27646947570196-What-are-script-elements)
- [Fountain Syntax](https://fountain.io/syntax/)
- [R² · Novel-to-Screenplay with Causal Plot Graphs](https://arxiv.org/abs/2503.15655)
- [IBSEN · Director-Actor Agent Collaboration](https://aclanthology.org/2024.acl-long.88/)
