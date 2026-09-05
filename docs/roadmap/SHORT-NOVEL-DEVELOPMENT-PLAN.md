# 短篇小说独立产品开发设计

> 版本：1.0.0 · 生效：2026-09-06 · 权威层级：L2
> 对应总纲：§4.3、阶段 C · 产品：`independent.shortform`
> 性质：短篇小说唯一专项施工方案。它不定义剧本或漫画的产品数据、Agent 和验收。

## 1. 开工卡与边界

- 产品阶段：独立创作产品的生产阶段，没有运行阶段。
- 用户入口：Product Hub 创建“短篇小说”后进入短篇工作台。
- 用户结果：从空白意图完成 5,000～25,000 字短篇，形成可恢复草稿、审校闭环和不可变发布版本。
- 数据 owner：目标 Short Work；世界引擎不拥有 Brief、结构、正文、审校记录或发布版本。
- 世界引用：创作不依赖 World。后续“派生世界”是作者显式转换，不在本包中自动发生。
- 媒资 owner：V1 不生产图片、音频或世界媒资。
- 非范围：百万字长期记忆、节点模式复制、EPUB 精排、自动投稿、剧本场次和漫画页格。

入口到结果：

```text
创建 Short Work
→ 确认创作 Brief
→ 确认故事设计
→ 确认章节/场景计划
→ 逐章生成和编辑正文
→ 连续性审查
→ 定点改写与复审
→ 完成检查
→ 发布不可变版本并导出
```

## 2. 当前基线与专项缺口

可复用能力：Short Work/profile、单卷结构、章节编辑器、正式模型入口、CreativeArtifact、durable Run、三注册表和项目备份。

开工前缺口：

1. 短篇只是长篇配置差异，没有独立生产根和阶段状态。
2. 缺少短篇专属 Brief、故事设计、审校问题和完成证明。
3. 生成入口没有形成“计划—正文—审查—定点改写”闭环。
4. `complete` 只是可变状态，没有 hash 固定的成品版本。
5. 普通用户路径没有短篇专项工作台、恢复和端到端验收。

## 3. 产品状态机与数据模型

状态机：

```text
setup → brief → design → plan → draft → review → rewrite → ready → released
                                                          ↑          │
                                                          └─ reopen ─┘
```

允许退回前一步修改；任何已确认上游变化必须让受影响候选 stale。`released` 只描述当前指针，旧 Release 永不被修改。

核心产物：

- `ShortNovelProductionV1`：Work 唯一生产根；保存阶段、Brief、故事设计、当前审校、正文 revision 和当前 Release。
- `ShortNovelBriefV1`：题材、读者、目标字数、叙事承诺、约束、禁改项和未决问题。
- `ShortNovelStoryDesignV1`：主角欲望、阻力、转折、高潮、结局、视角、时态和主题控制。
- 现有 outline/chapter：继续作为短篇结构和正文正式数据，不复制第二套章节体系。
- `ShortNovelReviewV1`：问题必须有稳定 key、严重度、证据范围、建议和 open/resolved 状态。
- `CreationReleaseV1(productKind = short-novel)`：固定有序结构、章节正文、来源 revision、验证回执和内容 hash。

## 4. 三注册表与数据生命周期

### 4.1 AI 读取

新增并只在 Short Work 生效：

- `shortNovel.production`：已确认 Brief、故事设计、阶段和审校状态。
- `shortNovel.manuscript`：目标章节、相邻连续性和有界全文证据。

所有 Skill 通过 `assembleContext()` 读取；非 Short Work 返回不适用，跨 Work ID 直接拒绝。

### 4.2 候选写回

- `shortNovelProductions.brief`
- `shortNovelProductions.storyDesign`
- `shortNovelProductions.latestReview`
- 既有 outline/chapter 正式字段，通过现有 Adoption 扩展进入。

模型输出先成为候选；作者确认后才调用登记入口。UI 不直接更新上述正式字段。

### 4.3 `PROJECT_TABLES` 与生命周期

- `shortNovelProductions`：Work 一对一 owner；随 Work 导出、导入、删除和重映射。
- `creationReleases`：append-only；当前指针延迟重映射；父版本保持树形拓扑。
- 项目备份必须包含两个表并校验产品类型、owner、版本、父版本、source revision 和 manifest hash。
- 删除草稿不删除已发布版本；删除 Work 才级联删除其生产根和 Release。

## 5. 专业 Agent/Skill DAG

产品 Agent 只负责编排、预算、人工闸门、恢复和终态验证。六个 Skill 互不越权：

| Skill | 职业角色 | 读取 | 候选输出 | 人工闸门 |
|---|---|---|---|---|
| `short.intent-brief` | 短篇策划编辑 | 作者输入、Work 约束 | Brief | 确认创作合同 |
| `short.story-design` | 短篇结构编辑 | Brief | 故事设计 | 确认核心转折与结局 |
| `short.scene-plan` | 场景/章节规划师 | Brief、故事设计 | 3～8 章稳定结构 | 确认章节计划 |
| `short.chapter-draft` | 短篇小说作者 | 目标章计划、连续性证据 | 单章正文 | 逐章确认或编辑 |
| `short.continuity-review` | 连续性与短篇编辑 | 冻结正文、设计 | 带证据问题清单 | 选择处理项 |
| `short.targeted-rewrite` | 修订编辑 | 单一问题、冻结选区 | 定点替换稿 | 确认精确写回 |

禁止一次调用生成整部短篇后直接发布。每个 Skill 使用独立 `moduleKey`、Prompt 版本、闭集 JSON schema、Run Contract 和回归引用。

## 6. Prompt 与输出合同

所有正式 Prompt 按固定骨架组织：职业角色、当前唯一任务、事实层级、冻结输入、作者约束、输出 schema、禁止事项、失败规则和静默自检。

关键约束：

- 不伪造未提供的设定；必要假设必须进入 `openQuestions`，不能冒充已确认事实。
- 章节 stable key 由合同生成并在后续修订中保持不变。
- 正文 Skill 只写一个目标章节，不重写结构或其它章节。
- 审查 Skill 只报告证据充分的问题，不自动改稿。
- 定点改写只处理被选择的问题和范围；不可顺手改动无关正文。
- parser 拒绝额外字段、错误枚举、缺失 key、重复章节和超范围字数。

## 7. 工作台设计

短篇工作台显示六个可恢复阶段：Brief、设计、结构、正文、审校、发布。

- 每阶段同时展示正式值和候选值；采纳、拒绝、编辑后采纳操作明确分开。
- 章节编辑复用正式 outline/chapter 能力，但隐藏百万字规模、复杂卷管理和无关长篇入口。
- 刷新后恢复阶段、Run、候选、问题处理状态和正文。
- 完成报告逐项显示结构、正文、字数、stale、critical issue、待确认候选和发布 hash。
- 导出只从正式草稿或指定 Release 生成，支持 Markdown、TXT、JSON。

## 8. 完成验证器

发布前必须同时满足：

1. 目标字数在 5,000～25,000，章节数在 3～8。
2. 每个正式章节有结构和非空正文，顺序及 stable key 唯一。
3. 最新审查绑定当前正文 revision。
4. 没有 open critical issue。
5. 没有本 Work 的待确认或 stale 短篇候选。
6. Release manifest 回读 hash 与保存值一致。

作者可在 warning 存在时继续发布，但必须看到警告并留下确认；hard failure 不可由 Prompt 绕过。

## 9. 测试与验收样例

确定性样例使用原创材料：

- `SHORT-CLOSED-01`：约 8,000 字单线悬疑，验证三幕压缩和伏笔回收。
- `SHORT-POV-01`：第一人称有限视角，验证越权信息和时态漂移。
- `SHORT-REVISION-01`：包含一条 critical 连续性错误，必须经历定点改写和复审。

必测正反例：

- 六 Skill 实际串行完成，确认前正式表零写入。
- 刷新/崩溃窗恢复同一候选，不重复计费或重复采纳。
- 修改 Brief、设计或目标章后旧候选 stale。
- 跨 Work 读取、采纳和 Release 指针全部拒绝。
- 发布 v1 后 reopen、修改、发布 v2，v1 内容和 hash 不变。
- 完整备份往返、父版本/当前指针重映射、删除生命周期。
- Product Hub 从零创建，手动 Brief、刷新恢复及导出 E2E。

## 10. 施工顺序与分支

唯一功能分支：`feat/shortform-production`；使用独立 worktree，不在剧本或漫画分支继续修改。

1. 合同、类型、schema migration、三注册表和备份生命周期。
2. Context、六 Skill、专业 Prompt 和 durable runner。
3. service、完成验证、Release 与导出。
4. 短篇工作台和 Product Hub 入口收口。
5. 定向测试、故障注入、完整 CI、完整 E2E 和分支审查。

若发现剧本/漫画也需要新的共享协议，不直接在本分支扩大 union；先形成独立共享底座变更并证明调用方。

## 11. 完成定义

短篇只能在本方案的入口、六 Skill、数据生命周期、发布不可变性和真实 E2E 全部通过后标记 released。剧本或漫画是否完成不影响短篇结论；短篇完成也不能提升另外两个产品的成熟度。

## 12. 研究依据

- [Content Planning for Neural Story Generation](https://aclanthology.org/2020.emnlp-main.351/)
- [Plan, Write, and Revise](https://aclanthology.org/N19-4016/)

研究只支持“先规划、再写作、再独立修订”的流程选择；产品 owner、确认边界和验证器仍由 StoryForge 总纲与工程合同决定。
