# 08 · 实现、迁移与旗舰交付计划

> 层级：L2 · 版本：2.4.0 · 生效：2026-09-09
> 性质：当前施工顺序；每批必须留下代码、测试、文档和提交证据。

## 总原则

施工先建立不会说谎的质量底线，再替换生产链，最后生产旗舰。任何中间批次只能声明其真实能力，不以页面存在、mock 通过或目标字段满足冒充成品。

## 批次 A · 纠正基线与文档权威

状态：已实现并有文档/架构检查；旗舰交付前继续保持旧 Build 负向回归。

- 登记本方案包，修订文字冒险产品契约、能力基线和路线图中的过度完成声明。
- 把现有 Build #4 标为工程夹具/不具推荐资格，保存失败证据。
- 增加当前分支专属说明，确认不合入其他产品私域代码。

完成判据：文档权威检查通过；现状与目标清晰分离；工作树只含本产品改动。

## 批次 B · 可信质量底座

状态：路线字量、对白、决定、主线阶段、结局与文案硬门已实现；`qa.autoplay` 八类确定性用例及 `quality.autoplay` 已接入。隔离浏览器生命周期矩阵仍归批次 F/G。

- 实现路线枚举与每路线可见内容、对白、行动、决定、回响、结局和预计时长分析。
- 修复零 NPC、单阶段任务、空效果选择、超长按钮、占位/指令泄漏、混合语言和空结局的门。
- 删除质量 prompt 中硬编码的通过示例；模型评审只能产生问题候选，确定性门派生最终状态。
- 用当前 Build #4 形态建立负向回归，确保不再被放行。

完成判据：旧夹具失败；正向旗舰级夹具通过；性能有上限；其它产品质量门不回归。

## 批次 C · Agent 身份、Skill 与工件合同

状态：18 个独立 Agent 均只有一个核心 Skill；计划测试验证 18 个岗位全部进入真实模型任务，并拒绝同一岗位出现第二个 Skill。叙事设计师的单一 Skill 通过两个有界 Run 生成结构与决定子工件，再由确定性装配器形成正式叙事弧。Showrunner 的 `production.supervision`、专业规划、分场、对白、连续性审校、Visual QA Director 和 Playtest Director 工件均有独立 parser/Run Contract/receipt。

- 扩展 Domain Agent Registry，登记专业 Agent、owner、UI 标签和最小权限。
- 新增来源审计、故事/角色圣经、弧计划、主支线计划、任务脚本、场景、对白、连续性、美术与试玩策略的严格 schema/parser。
- 每个 Skill 只归属对应 Agent，登记 Context Sources、write target、预算和 Harness 回归。
- 旧 `outline` 文字冒险 Skills 标为 legacy-build-only，不再生成新计划。

完成判据：注册表一致性检查通过；不存在一个 Agent 覆盖全部文字冒险专业工件；非法跨岗写入被拒绝。

## 批次 D · 新 Durable DAG 与执行器

状态：`production.supervision` 已成为 DAG 首个真实任务，并被来源、质量和装配链消费；专业依赖拓扑、来源决策专用闸门、分步叙事弧、六个 Scene Writer 场景包、三个确定性分幕装配、三幕 Dialogue Editor、最终确定性装配、连续性审校、自动游玩、质量门和试玩策略已接通。真实 Agnes 调用证明单次超长叙事弧或整幕正文 JSON 会出现截断、漏字段或长期不返回，因此分别拆为职责内聚的结构/决定 Run、场景包 Run 和零模型装配；Scheduler 强制超时不再依赖 Provider 是否响应 AbortSignal，任务预检及返回后证据阶段的逃逸异常也会正式失败而不留下 `running`。跨 Build runtime-only 复用回归证明不会因此把内容 Agent 错误重跑。工作台已区分来源可接受补充与阻断冲突，并保存作者命令证据；总任务与各泳道展示真实 receipt 进度，文字冒险媒资已经按单项 task 显示生成数。图片级锁定、替换和局部重跑已实现；通用文本工件 diff/锁定仍需后续批次评估。

- 实现两段式计划和专业依赖拓扑；正文按 Act/场景包有界生成。
- 构建每任务上下文投影、prompt、严格解析、candidate/adopt、checkpoint、stale 和最小修复闭包。
- 工作台显示部门、阶段、事实进度、预算、差异、锁定、暂停和恢复。

完成判据：刷新/中断后可恢复；预算和调用与计划一致；主线/支线/场景真正消费系统与上游设计。

## 批次 E · 任务脚本、编译与完整玩家系统

状态：Quest Script IR、多阶段主线、多解目标、失败推进与 Adventure V2 编译已实现并有运行回归；任务脚本工程师已经从单次大输出改为每幕单解/多解两个 Run 加补充内容 Run，共七个有界合同，再由确定性任务装配唯一正式脚本。冻结系统能力白名单在支线/区域事件 owner 和脚本 parser 两层复验；真实 provider 输出测量已校正玩家可见脚本与区域事件的预算预留。角色、区域、背包、装备、技能、任务、旅程、存档和分支 UI 已接入 Adventure V2。浏览器回归已覆盖冻结插图、系统面板、行动、刷新恢复，以及从导入 Release 建立双结局分支；旗舰实际内容的完整真人操作仍归批次 G。

- 新 Quest Script IR 编译为通用 Adventure V2 状态、行动、任务、storylet 和结局，不再把全主线压成单任务单目标。
- 补全角色/关系、属性/技能、资源、背包、装备、任务、地图、旅程与因果 UI。
- 保持事件权威、RNG、存档、刷新、分支和离线降级；自由输入只形成合法行动候选。

完成判据：多阶段任务、多解目标、状态回响、失败推进和三类 UI 在真实浏览器可用；重放等价。

## 批次 F · 媒资、导入导出和推荐候选

状态：底座已实现。独立视觉圣经 Artifact、角色锚点 hash 绑定作者确认、逐项媒资 durable task，以及作者上传/替换/锁定/解锁/单项重生成的新 Build 派生链已闭合；需求—Artifact—Runtime 的确定性三向审计、独立 Visual QA Director 多模态审图和作者逐图人工回执均已进入正式发布硬门。本地候选包“上传文件 → 离线复验 → 新 Work 原子导入 → 正式 Release 双结局 → 刷新恢复 → 明确确认删除副本”浏览器 E2E 已闭合；删除从 `PROJECT_TABLES` 引用闭包级联会话与私域媒资，并分别验证共享 Blob 保留和末次引用回收。作者退回图片、真实 file input 单图替换、暂停恢复、新 Build 重新装配和新 hash 逐图复验也已有隔离浏览器 E2E。旧两图商业 Build 还可在同一 Production 取消后生成只改变媒资数量与预算的 Brief 修订候选，经作者保存、再次授权形成十二图子 Build；来源 hash 与旧工件保持不变。同一真实旗舰的实际下载文件和全新 Work 再上传仍须在批次 G 留下运行证据。

- 已实现：确定性视觉圣经编译、商业候选角色锚点作者闸门、稳定计划内 assetKey 和逐项生成/有界纯文字降级。
- 已实现：作者上传/替换/锁定/解锁/单项重生成，旧 Build 不变，未受影响图片零 Provider 调用复用，装配与 QA 定向重跑。
- 已实现：确定性清单—素材—Runtime 引用三向核查；合法纯文字降级也留下不可冒充图片覆盖的审计证据。
- 已登记：独立 Visual QA Director、受治理图片输入、逐项 key/hash 审查合同和 prototype 真人复核降级；商业候选审图失败或不确定时必须阻断。
- 已实现：逐图作者接受/退回、退回原因、当前 Artifact/Blob hash 绑定、陈旧失效、发布 adoption/CAS 绑定和三层证据工作台；不以模型返回 JSON 冒充审美正确。
- 已实现：作者与独立玩家双角色真人试玩质量门；每场绑定不同 Build Preview 事件流、公开代号与身份声明、目标时长 75%–125%、叙事选择、不同有效行动、交谈、四项评分、五类反馈及 blocking 问题。单角色 `needs-human`、最新失败 `failed`、双角色通过才进入发布 adoption/lineage/候选包。
- 已实现：人物错位、风格漂移、剧透、伪文字、明显畸形和干净对照的六图视觉缺陷评测夹具；确定性评分要求缺陷零误接受且必需类别全检出，合法 JSON 本身不构成通过。
- 已实现：隔离浏览器中的“退回→冻结失败回执→真实 file input 单图替换→新 Build→重新装配→新 hash 逐图验收”；父 Build 回执不迁移，未修改图片重绑当前 Build assetKey 且继续复用原 Blob。
- 施工合同与证据字段见 [`11-HUMAN-VISUAL-REVIEW-AND-RECOMMENDATION.md`](./11-HUMAN-VISUAL-REVIEW-AND-RECOMMENDATION.md)。
- 已实现产品包导出、原子导入和导入副本删除正反例；未知版本继续 fail-closed，未来包格式升级必须先登记纯函数 migrator 和迁移回执。
- 创建隔离的来源充分旗舰世界；不得修改作者当前项目或用稀疏测试世界硬撑生产。

完成判据：真实 provider 与文字降级均可构建；导出包往返等价；权利和媒资 receipt 完整。

## 批次 G · 首个社区推荐旗舰

状态：真实生产进行中，尚未形成可试玩 Build。隔离世界 `潮钟群岛旗舰来源世界 v4`、商业候选 Brief、冻结 SourcePlan 和来源私域补充决定已经建立。早期 2 图计划已沿不可变子 Build 血缘修订为 12 图商业计划；当前 Production `productprod.mtqcyoyo.ae9e63f7` 的 Build #14 已完成 61/65 项 durable task（规划 14/14、内容 24/24、集成 1/2、QA 10/13、视觉 12/12）。十二项媒资已生成且确定性媒资审计通过；独立 Visual QA 按当前需求重新观察全部实际图片后退回了构图、元素覆盖和伪文字不合格项，因此 `integration.package` 保持 `recovery-required`。下一步只允许按逐图冻结意见派生返修子 Build，不能用通用重试或旧审图回执放行。全仓 CI 当前 507 个测试文件、2511 项测试通过，完整隔离 Chromium E2E 66/66 通过；底座候选包的上传、双结局、刷新和删除生命周期已闭合，真实旗舰的最终 ProductRelease、下载文件和全新 Work 往返仍待本批闭合。

- 以作者确认的 Brief 和 SourcePlan 启动新专业 DAG，生成约一小时原创文字冒险。
- 完成结构审查、自动游玩、内容审校、媒资审查、完整真人计时试玩和有界修复。
- 生成同一 Build/hash 的 Recommendation Candidate、导出包与不可变 ProductRelease；外部发布前向作者展示最终体验和证据并请求确认。

完成判据：满足 [`01-DELIVERY-CONTRACT.md`](./01-DELIVERY-CONTRACT.md) 和 [`07-QUALITY-EVAL-AND-ACCEPTANCE.md`](./07-QUALITY-EVAL-AND-ACCEPTANCE.md)；`npm run ci` 与隔离 `npm run ci:e2e` 通过；工作树干净。

## 建议代码改动范围

- Agent/Skill：`src/lib/agent/skill-registry.ts`、Agent 元数据/路由/手册检查及对应回归。
- 生产合同：`src/lib/types/product-production.ts`、`src/lib/adventure/production-brief.ts`、新增专业 Artifact/Quest Script parser。
- DAG/Harness：`src/lib/product-production/plan.ts`、`context.ts`、`production-executor.ts`、scheduler/repair/adoption。
- 编译/质量：`src/lib/adventure/production-compiler.ts`、`src/lib/product-production/product-quality.ts`、质量回执与发布门。
- UI：`TextAdventureProductionWizard.tsx`、`ProductProductionStudio.tsx`、`AdventureGamePlayer.tsx` 及 stores。
- 生命周期：仅在确需新表时修改 `PROJECT_TABLES`、schema/migration/export/import/delete；优先复用现有版本化 Artifact 表。
- 测试：专业 contract、Skill 权限、DAG、旧夹具反例、编译、玩家 UI、真实 provider、导出导入、完整 E2E。
