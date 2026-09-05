# 独立创作三方案隔离审查

> 版本：1.0.0 · 审查日期：2026-09-06 · 权威层级：L4
> 审查对象：短篇小说、小说转剧本、小说转漫画三份专项开发设计
> 结论范围：只证明方案可以进入施工；不证明任一功能已经实现或发布。

## 1. 审查结论

结论：**通过，附带施工时必须持续执行的共享底座和串行集成条件。**

三份方案已经分别定义产品身份、入口、owner、状态机、正式产物、Context/Adoption/Table 生命周期、Agent/Skill DAG、Prompt Spec、工作台、发布、样例、反例、E2E、唯一功能分支和完成定义。不存在用一个万能 Agent、同一业务表或同一完成状态代替三个产品的设计。

审查中发现并修正三项问题：

1. 原 654 行总规划同时承载三产品细节，容易被误用为一份共同施工方案。已降为总索引，并新增三份唯一专项方案。
2. 原施工包把漫画脚本和视觉生产写成 `01A/01B`，可能被误读为两个产品或两个混杂分支。现明确为同一 `feat/comic-production` 分支内两个可分别验收的里程碑。
3. 原分支文字只说“分别建分支”，没有阻止从含兄弟产品未提交改动的工作树起分支。现增加串行 integration baseline 和独立 worktree 规则。

## 2. 三产品独立性矩阵

| 维度 | 短篇小说 | 小说转剧本 | 小说转漫画 |
|---|---|---|---|
| 产品 ID | `independent.shortform` | `independent.screenplay` | `independent.comic` |
| 目标 owner | Short Work | Screenplay Work | Comic Work |
| 主结构 | outline + chapter | beat + scene card + scene AST | script beat + page plan + page/panel |
| 审查 | 短篇连续性/结构 | grounding/continuity/dramaturgy/format | narrative/order/lettering/visual/rights |
| 媒资 | 无 | 无 | Comic Work/Release 独占 |
| Release | short manifest | screenplay AST manifest | page/lettering/media manifest |
| 导出 | Markdown/TXT/JSON | Fountain/FDX/PDF | PNG/WebP/CBZ/PDF |
| 功能分支 | `feat/shortform-production` | `feat/screenplay-production` | `feat/comic-production` |
| 完成判据 | 5K～25K 成稿 | 专业 AST 与来源改编闭环 | storyboard/visual 两级闭环 |

结论：三个产品没有共享正式正文、场次、页格、审校问题、Release manifest 或成熟度状态。

## 3. 允许共享的最小基础设施

只允许共享：

- provider-neutral 模型/图片传输；
- durable Run、CreativeArtifact、Context Gateway 和 Adoption 基础设施；
- source manifest/source unit 的冻结、hash 和来源范围；
- 剧本与漫画共同需要的 `AdaptationSourceFactV1`、`AdaptationCausalEdgeV1`、`AdaptationDecisionV1`、`AdaptationBriefV2`；
- 通用 blob 字节存储和内容寻址；
- `creationReleases` 的 append-only/version/hash 外壳。

共享不等于共用记录。所有 adaptation facts/edges/decisions 仍由目标 Work 隔离；Release manifest 使用产品专用闭集；blob 的业务 owner 仍是漫画产品。

禁止共享：

- 短篇 chapter 与 screenplay scene；
- screenplay scene/card 与 comic page/panel；
- 剧本 review issue 与漫画 visual/lettering issue；
- 漫画媒资与世界引擎或上层游戏媒资；
- 任一产品的 current release 指针、候选、阶段或完成状态。

## 4. 共享热点审查

schema、三注册表、备份版本、产品目录和公共 adaptation contracts 是集成热点，不允许三个产品分支同时各改一套。

施工规则：

1. 只有一个产品需要时，合同保持产品专用。
2. 第二个真实调用方出现时，先在独立 foundation 提交中抽取最小共同协议，验证原调用方不回归，再进入后续产品分支。
3. 短篇交付时的 `creationReleases` 仅接受 `short-novel`；小说转剧本开工前必须用独立 foundation 提交扩展产品闭集和共同 hash/version 外壳，不能在剧本 service 内旁路或复制第二张 Release 表。该 foundation 条件已在 `feat/independent-creation-foundation` 完成，产品专用 manifest codec 仍分别由对应产品分支实现。
4. adaptation facts/edges/decisions 是剧本与漫画共同需要的第一批共享合同，应在剧本产品代码之前进入集成基线；漫画只复用已经审定的版本。
5. foundation 不能包含短篇 UI、剧本场次、漫画页格或任一产品 Prompt。

## 5. 分支与 worktree 拓扑

```text
origin/main
  └─ feat/independent-creation-closure       # 三方案与审查
      └─ feat/independent-creation-integration # 只串行集成，不直接施工
          ├─ feat/shortform-production         # 独立 worktree → 审查 → merge 回 integration
          ├─ feat/screenplay-production        # 从含已审定短篇的 integration 新建
          └─ feat/comic-production             # 从含已审定剧本的 integration 新建
```

后一个产品允许以已经审定并合入 integration 的前一产品为基线，但不得从前一产品尚未合入或存在未提交内容的 worktree 建分支。这样每次 code review 都能以 integration merge-base 精确看到一个产品的增量。

任何阶段都不直接 push `main`；远程推送、PR 和 main 合并按 `COLLAB-WORKFLOW.md` 执行。

## 6. Agent 与 Prompt 隔离审查

通过项：

- 每个 Skill 只有一个结构化转换和闭集 schema。
- 来源分析、创作/改编判断、结构、正文/场次/页格、审查和定点修订已经拆开。
- 审查 Skill 只产出 issue；作者确认前不自动改正式作品。
- 剧本格式、漫画几何/排字、作用域、stale、hash 和 Release 完整性由代码验证。
- 长来源通过 source units、事实和因果邻域渐进读取，不反复拼接全书。
- 漫画图片请求与漫画脚本/分页分开，默认禁止模型生成文字和气泡。

施工审查必须拒绝：万能“创作大师” Prompt、一次调用整书转换、跨产品 Skill 写入、review 后静默改稿、仅用模型评分宣称完成。

## 7. 数据与失败恢复审查

三方案均覆盖：

- 候选确认前零正式写入；
- source/work/scope/version/hash 校验；
- stale、重复采纳、崩溃窗和 provider 结果未知；
- 项目导出/导入、ID 重映射、删除和旧 Release 不变；
- 正例、反例、fault injection、规模门和真实 UI E2E。

漫画额外覆盖 blob 强引用、坏 blob、候选清理、真实参考图传输、局部修复、权利不明和视觉降级。剧本额外覆盖 Fountain/FDX 回读和格式 AST。短篇额外覆盖字数/章节规模与轻量体验。

## 8. 逐方案审查结果

| 审查门 | 短篇 | 剧本 | 漫画 |
|---|---|---|---|
| 产品/阶段/owner 清楚 | PASS | PASS | PASS |
| 与世界引擎边界清楚 | PASS | PASS | PASS |
| 专用数据模型清楚 | PASS | PASS | PASS |
| 三注册表闭环 | PASS | PASS | PASS |
| 多阶段 Skill DAG | PASS | PASS | PASS |
| Prompt/closed schema | PASS | PASS | PASS |
| 人工闸门与 durable 恢复 | PASS | PASS | PASS |
| 发布/导出/旧版本不变 | PASS | PASS | PASS |
| 正反例与 E2E | PASS | PASS | PASS |
| 唯一功能分支/worktree | PASS | PASS | PASS |
| 独立完成判据 | PASS | PASS | PASS |

## 9. 进入实现的条件

三方案可以进入实现。顺序固定为：

1. 把本次规划提交同步到短篇分支，按短篇专项方案审查现有实现并修复差距。
2. 短篇完整 CI/E2E 通过后合入本地 integration。
3. 创建独立 foundation 提交，完成第二调用方所需的 Release/adaptation 共同合同。
4. 从新的 integration baseline 创建 screenplay worktree，完成并审查剧本。
5. 剧本合入 integration 后创建 comic worktree，完成漫画两个里程碑并审查。

任一产品失败只阻断自身和依赖其集成基线的后续施工，不允许把兄弟产品的完成状态拿来抵消。
