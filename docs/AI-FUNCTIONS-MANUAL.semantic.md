# AI 行为说明书 · 语义注解（手工维护）

> 配套 `AI-FUNCTIONS-MANUAL.generated.md`(自动生成的事实清单)。
> 这里写**自动生成抓不到的东西**:每个 AI 动作的业务意图、已知坑、用户视角说明。
> 规则:本文件用 `` 反引号标注 moduleKey 引用时,该 key 必须真实存在于 `PromptModuleKey`(CI 校验,见 ai-manual.test.ts)。
> 创建:Phase 3.1。

---

## 怎么配合两份文档用

- **想知道"有哪些 AI 动作、读什么变量、写哪些字段"** → 看 `.generated.md`(代码扫描,永远准)
- **想知道"这个动作为什么这么设计、有什么坑"** → 看本文件
- **修改 AI 行为后** → `npm run gen:ai-manual` 重新生成 generated 版;必要时在此补语义注解

---

## 核心动作语义注解

### 章节正文生成 — `moduleKey: chapter.content`
- **业务意图**:项目最核心的功能。读取最丰富的上下文(世界观/角色/状态/伏笔/词条/真实与幻想规则/上一章结尾),经三层记忆预算分配后生成正文。
- **多世界**:按章节所属世界(沿大纲父链解析)装配上下文,不串台。
- **坑**:上下文超模型窗口时按 L3→L2→L1 真裁剪(不是只算不裁);用户已写的设定(真实与幻想)现在真注入(Phase 2.2 修复)。

### 灵感反推 — `moduleKey: inspiration.reverse`
- **业务意图**:用户写碎片想法,AI 反向生成世界观/故事核心/角色草稿。是"下游→上游"的反推流。
- **角色模型**:角色草稿必须同时产出戏份权重与九宫格阵营两轴；旧 `role` 只作为派生兼容字段。
- **坑**:写回经 `adopt()`,AI 输出的别名字段(如 `summary`→`worldOrigin`)自动归一,不再静默丢字段(Phase 1.2b 修复)。
- **上下文边界**:HARNESS-34 后生成只进入 Inspiration Agent 的 `inspiration.reverse` Skill；作者勾选的碎片 ID 冻结到 durable plan，未勾选内容不会发给模型，读取只经 `read_inspiration_workspace → assembleContext()`。
- **候选与写回**:结构化候选可刷新恢复、编辑、拒绝或确认；确认只经 `adopt(inspirationWorkspaces)` 新增一个版本，不自动写世界观、故事核心、角色或世界组。版本确认后，面板里的分区/多世界采纳仍是另一项显式作者动作。
- **兼容边界**:碎片来源、增量版本、差异审阅、多世界预览和导出保留；旧面板级 `useAIStream`、直接模型调用和组件级上下文装配已删除。
- **证据边界**:现有回归证明任务契约、碎片隔离、候选 gate/CAS 和版本采纳，不证明真实模型文学质量、成本或延迟收益。

### 角色生成 — `moduleKey: character.generate`
- **业务意图**:根据现有阵容与世界上下文设计角色；戏份(main/secondary/NPC/路人)与阵营(道德轴×秩序轴)彼此独立。
- **写回约束**:`roleWeight`、`moralAxis`、`orderAxis` 三项必填；`role` 由注册表写回层统一派生，调用方不得手写兼容映射。

### 故事核心单字段生成 — `moduleKey: story.generate`
- **业务意图**:七个故事核心字段保留独立生成和人工编辑，但 AI 生成统一进入世界基座 Agent 的 `world-origin.story-core` Skill；每次只产生一个可审查字段候选。
- **上下文**:Skill 声明世界、故事核心、力量、词条、角色、故事线和卷纲来源，统一经 `assembleContext()` 执行预算、压缩和全文救援；空、部分填写和完整填写分别使用明确策略。
- **写回约束**:模型只能返回 `{field,value}`；候选可跨刷新编辑/拒绝/确认，确认前正式数据零写入，确认后只经 `adopt(storyCores)`。任一故事核心字段变化都会使旧候选过期。
- **兼容边界**:`story.generate` Prompt 面板继续承载作者参数和自定义要求，但旧 `story-adapter` 已删除；Prompt 设置不会绕过 Skill 合同或直接成为写入入口。

### 世界基座单字段生成 — `moduleKey: worldview.dimension`
- **业务意图**:世界起源、自然环境和人文环境的 17 个 AI 字段按钮共用 `world-foundation-agent` 的 `world-origin.worldview-field` Skill；不是为每个字段新增 Agent。
- **上下文**:只经 `CONTEXT_SOURCES + assembleContext()` 读取世界观、规则/事实、故事核心、力量、词条、角色、故事线、卷纲和参考资料；空、部分填写和完整填写分别执行创建、下游反推补全和受约束变更。世界观字段的原始长文本是否压缩、全文救援或确定性回退均记录上下文证据。
- **写回约束**:文本字段只能返回 `{field,value}`；`divineDesign` 的 `value` 必须是严格四字段对象。候选进入 durable 主 Agent，确认前 `worldviews` 零写入，确认后只经 `adopt(worldviews)`；完整世界观 snapshot/CAS、字段错投 gate 和终态回读阻止过期候选覆盖作者修改。
- **兼容边界**:人工编辑、力量/神明/自然物产/人文词条和 `worldview.dimension` Prompt 配置继续保留；面板不再调用 `useAIStream`、组件级拼接、`slice()` 或神明二次拆分模型。旧 `world-origin.complete` 只用于历史候选恢复，新请求由 `world-origin.worldview-field` 收口。
- **证据边界**:HARNESS-32 已有 7 项领域合同测试、3 项面板 UI 测试、主 Agent durable 回归和 Chromium 神明刷新闭环；模型仍为模拟响应，不能据此宣称文学质量或真实 provider 成本收益已经提升。

### 状态提取 — `moduleKey:`(无独立模板,走 state-extract-adapter)
- **业务意图**:章节写完后自动从正文提取已登记角色的动态状态,写回角色状态卡。
- **坑**:用"按需召回"只把相关状态卡喂给 AI；角色名单同时作为严格白名单，地点、物品、文件夹、组织等不能再被误建为角色卡。

### 词条拆分 — `moduleKey: codex.extract`
- **业务意图**:把世界观各方面的整段“全貌”拆成当前分类下的结构化词条，用户确认后经 `adopt()` 批量写入。
- **长文本**:按段落/句子分块，保留重叠区，避免只读取开头；跨块按规范名去重。
- **标签**:默认可关闭；开启“AI 补充词条标签”会增加输出 token，标签作为检索元数据，不覆盖分类专属字段。

### 重要地点提取 — `moduleKey: location.extract`
- **业务意图**:从已写章节中筛出反复出现或推动剧情的重要地点，先给候选，确认后写入地点树的顶层。
- **上下文与作用域**:只经 `chapterContent / locations` 登记源读取当前 Work 正文和当前 World 地点；不会混入同项目的其它 Work/World。
- **长任务边界**:章节顺序和分块在 Run 中冻结，每个已成功分块建立 checkpoint；刷新只续跑未完成分块。模型请求后结果无法判定时禁止自动重试，需作者放弃后重新开始。
- **写回与终验**:所有分块完成才持久化候选；作者勾选后冻结选择，只经 `adopt(importantLocations)` 写入。正文、提示词、原有地点或所选正式地点变化会阻断终验或撤销旧 receipt。
- **语义边界**:普通方位词、一闪而过的房间/道路不应入库；标签只允许使用地点注册表里的合法标签。

### 物品栏提取 — `moduleKey: inventory.extract`
- **业务意图**:按全部已写章或作者选择的起止章，提取任意明确持有人的真实获得/消耗事件，聚合当前持有量与流水。
- **上下文与范围**:只经 `chapterContent / itemLedger / characters` 登记源读取当前 Work 正文/流水与当前 World 角色；范围、章节顺序和分块在 Run 中冻结。
- **长任务边界**:每个确定完成的分块 checkpoint，刷新只续跑未完成调用；模型请求结果不可判定时禁止自动重试。任一分块协议失败不产生部分候选。
- **写回与恢复**:作者确认后按 `chapterId` 逐章事务执行“清旧 + 整批写新”；每章完成后记录可恢复进度。空候选也可确认，表示有意清理所选章旧提取结果。只有唯一姓名匹配才绑定 `characterId`。
- **终验**:正文、提示词、角色 roster、范围外流水或冻结正式结果变化都会阻断采纳或撤销旧 receipt。

### 故事年表提取 — `moduleKey: story-timeline.extract`
- **业务意图**:从正文提取推动剧情的事件，并按章节进程展示；事件可直接跳转到来源章节。

### 工作流执行 — (WorkflowRunner)
- **业务意图**:多步 prompt 编排,上一步输出喂给下一步。
- **坑**:每步现在带用户当前输入 + 项目上下文(BUG-INPUT-WITH-GEN 相关,部分由 Phase 2.3 覆盖)。

### 分步骤主 Agent 的执行版本
- **业务意图**:每次新主 Agent 运行按计划步骤冻结 Skill、提示词和只读工具 schema 版本；候选与运行合同使用同一绑定，刷新恢复时可判断结果究竟由哪套执行协议产生。
- **兼容边界**:HARNESS-18 前的运行没有 execution binding，继续按旧 hash 恢复；新运行不得省略绑定。修改 Skill、提示词协议或工具声明后必须升级相应版本并重跑登记回归。
- **fan-out 回执**:新 fan-out 运行要求每个上游候选先取得绑定 candidate/output、Context Manifest、attempt 和 verifier 版本的确定性步骤回执，汇合模型调用前再次检查 freshness，下游候选冻结实际消费的 receipt hash。作者编辑或重规划会使旧回执失效；历史无回执运行只按旧协议读取，不补造证据。
- **维护闸门**:`check:agent-freshness` 检查 owner、提示词版本、复核日期和回归证据；工具 schema 的实际快照另由 SHA-256 回归校验。版本绑定用于可归因和防漂移，不代表模型输出已经通过质量评测。

---

## 待补充

(此文件随重构推进逐步补全各动作的语义注解。新增 AI 动作时,在 generated 版自动出现后,在此补业务意图。)
