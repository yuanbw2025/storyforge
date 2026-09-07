# 小说转漫画独立产品开发设计

> 版本：1.2.0 · 生效：2026-09-06 · 权威层级：L2
> 对应总纲：§4.5、阶段 C · 产品：`independent.comic`
> 性质：小说转漫画唯一专项施工方案。它不复用剧本场次作为页格，也不把漫画媒资交给世界引擎。
> 实施状态：`feat/comic-production` 已完成基础闭环；`feat/comic-visual-experience` 完成成图 Prompt 与专业工作台体验复审，最终 CI/E2E 证据以集成审查记录为准。

## 1. 开工卡与边界

- 产品阶段：独立改编产品的生产阶段。
- 用户入口：Product Hub 创建“小说转漫画”，选择本地 Work/章节或导入文本作为来源。
- 用户结果：完成固定页漫画的脚本、分页、页格、视觉圣经、候选图、本地排字、审校和不可变发布，可导出 PNG/WebP/CBZ/PDF。
- 数据 owner：目标 Comic Work；源 Work 只被版本化引用。
- 世界引用：V1 不依赖 World，也不向世界引擎写入人物图、场景图或页面。
- 媒资 owner：Comic Work/Release；共享 blob 只承载字节，不改变产品 owner。
- 形态：固定页漫画，支持 LTR/RTL。Webtoon 需要独立滚动节奏和布局合同，不在 V1 冒充支持。
- 非范围：动画、视频分镜、在线连载平台、印厂下单、自动训练角色 LoRA、无审核全自动出书。

入口到结果：

```text
选择并冻结来源
→ 分块来源分析与改编决策
→ 漫画脚本节拍
→ 页节奏与分页
→ 页格分镜与阅读顺序
→ 视觉圣经及 subject 锚点
→ 生成请求与候选图
→ 选图/局部修复/连续性复核
→ 本地气泡、文字、拟声和排版
→ 页级审校
→ storyboard 或 visual Release
→ PNG / WebP / CBZ / PDF
```

## 2. 专业依据与工程结论

- Dark Horse 的脚本指南按页、格和最终阅读顺序组织描述、对白、旁白和拟声；因此漫画脚本、分页和 panel plan 是独立产物。
- 视觉叙事研究区分叙事结构、格内取景和页面外部布局，并证明复杂页面可能造成阅读顺序歧义；因此 panel order 和 geometry 必须由确定性验证器检查。
- Narrative Graph Prompting、StoryGPT-V 等工作都把稳定实体、跨帧引用和视觉记忆视为专门问题；因此人物一致性不能只靠重复一段 Prompt。
- Clip Studio 现行文档区分 trim、bleed、inner border 和 safety margin；因此正式页面拥有物理版式规格，不能只导出等大图片列表。
- 图片模型对文字的控制不稳定；漫画文字由本地排字层生成，生图请求默认禁止文字、气泡、拟声和水印。

研究支持流程设计，不代表任一模型已经满足商业发布、一致性或权利要求。

## 3. 两级成熟度

### 3.1 `storyboard-ready`

来源、改编 Brief、漫画脚本、分页、页格、阅读顺序、视觉圣经、占位图和本地排字完整。它不要求高级图片 provider，可独立验收为可交给画师的漫画制作包。

### 3.2 `visual-release-ready`

在 storyboard-ready 基础上，所有发布格拥有已选成图；参考图实际传入 provider；人物/服装/道具/场景连续性通过；权利、模型、seed/工作流和内容 hash 可审计；失败格已单独修复。

UI、Release 和产品成熟度必须区分两级。缺少参考图、局部修复或权利证明时只能发布 storyboard，不用占位图冒充视觉成品。

## 4. 当前基线与专项缺口

可复用能力：`AdaptationProject`/source manifest、comic page/panel、visual subject、media asset/blob、候选选择、基础 QA、SVG/PNG/WebP/CBZ renderer 和 ComicStudio。

开工前缺口：

1. 小说直接进入 storyboard，缺少来源事实、改编决定、漫画脚本和页节奏。
2. page/panel 存在，但阅读顺序、叙事功能、页末转折和文字容量合同不足。
3. provider 请求没有统一的参考图、seed、mask/inpainting 和能力协商。
4. visual subject 不是完整状态机，角色服装/道具/伤势/光线跨格连续性难以验证。
5. 排字、气泡避让、出血/安全区和 PDF/CBZ 发布完整性不足。
6. 没有固定媒资 hash 的不可变 Release，也没有真实视觉纵切面验收。

## 5. 数据模型与 owner

### 5.1 共享来源分析

复用经独立 foundation 审定的 `AdaptationSourceFactV1`、`AdaptationCausalEdgeV1`、`AdaptationDecisionV1` 和 `AdaptationBriefV2`。记录由 Comic Work 拥有；剧本分支不能读取或写入本 Comic Work 的候选。

### 5.2 漫画专用语义

- `ComicScriptBeatV1`：来源事件到漫画节拍的改编，含视觉动作、对白意图、叙事功能和证据。
- `ComicPagePlanV1`：页目标、节拍范围、页末信息、转页策略、预计格数和文字预算。
- `ComicPage`：页面规格、方向、顺序、状态和摘要。
- `ComicPanel`：稳定 key、阅读顺序、geometry、shot、动作、角色/场景状态、lettering、来源单元和生成请求。
- `ComicVisualSubject`：角色/服装/地点/道具的稳定 identity、可见特征、禁止漂移项、参考媒资和来源。
- `ComicMediaAsset`：role、origin、provider/model/seed/workflow、request hash、reference hashes、candidate index、disposition、blob。
- `ComicReviewIssueV1`：`narrative | reading-order | lettering | continuity | rights | media-integrity`。
- `CreationReleaseV1(productKind = comic)`：固定脚本、页格、排字、视觉圣经、选择媒资、版式规格、验证回执和 hash。
- `CreationReleaseAssetV1`：Release 到 blob 的强引用；清理草稿候选不能破坏已发布页面。

禁止把 `ScreenplayScene` 复用为 page plan，禁止把上层游戏 `productMediaAssets` 当成漫画正式媒资。

## 6. 页面、阅读顺序与排字合同

页面规格保存 canvas、trim、bleed、safe area、DPI、色彩画像和阅读方向。Panel geometry 使用归一化页面坐标，并满足：

1. panel 在允许边界内，非设计性重叠和负尺寸直接失败。
2. `order` 唯一且与 LTR/RTL 布局路径一致；复杂布局必须显式声明下一格关系。
3. gutter、跨页和 full-bleed 规则可确定性验证。
4. lettering 拥有稳定 key、种类、文本、speaker、balloon geometry、reading order 和样式。
5. 文字不得超 safe area、遮挡受保护人物/动作区域或与其它气泡重叠。
6. 中文容量按字体、字号、行高和气泡几何测量；不机械套用英文单词上限。

本地 SVG/Canvas 排字层负责气泡、尾巴、旁白框、拟声和强调。所有文字保持可编辑并可重新布局。

## 7. 视觉一致性与 provider 合同

每个生成请求由确定性编译器从以下冻结输入产生：

- panel 的叙事/构图需求；
- visual subject identity 和当前服装/道具/伤势状态；
- 场景、时间、光线和色彩脚本；
- 已选参考图内容 hash；
- provider 能力、model、seed、尺寸、negative constraints；
- 明确的“no text / no speech balloon / no watermark”。

provider capability negotiation 至少区分：reference image、multi-reference、seed、mask/inpainting、image edit、尺寸和结果状态。缺少所需能力时显示 blocker 或降级 storyboard，不静默忽略参考图。

连续性检查分两层：

- 确定性：subject refs、服装状态、道具、地点、时间、参考图、request hash 和媒资完整性。
- 画面审查：当前统一聊天通道不传图片像素，AI 只审机器可验证的媒资元数据，不得假称看过画面；作者必须查看目标页实际成图并显式确认人物身份、发型/服装、相对位置、光线和关键道具，系统把 `author-visual` 依据、panel revision 与时间冻结为发布门禁。未来接入真实视觉输入后才能记录 `model-multimodal`，且仍只产生 issue、不自动选图。

## 8. 三注册表与生命周期

### 8.1 Context Sources

- `adaptation.sourceManifest`、`adaptation.sourceFacts`、`adaptation.decisions`
- `comic.scriptBeats`
- `comic.pagePlans`
- `comic.visualBible`
- `comic.currentPages`
- `comic.selectedMedia`

reader 验证 medium、Work、adaptationProject、page/panel/subject 和 manifest version；跨产品或跨 Work 直接拒绝。

### 8.2 Field/Adoption

漫画脚本、page plan、page、panel、visual subject、lettering、review issue 和媒体选择分别登记。图片生成结果先是媒体候选；作者明确选择后才成为正式 panel asset。局部修复产生新候选，不覆盖原 blob。

### 8.3 Project Tables

漫画专用新表与现有 page/panel/subject/media/blob 全部进入 `PROJECT_TABLES`。导入导出必须重映射 adaptation、page、panel、subject、source unit、asset 和 blob；删除顺序不得造成孤儿 blob 或破坏 Release 强引用。

## 9. Agent/Skill DAG 与人工闸门

| Skill | 职业角色 | 唯一职责 | 候选输出 | 人工闸门 |
|---|---|---|---|---|
| `adaptation.source-analysis` | 改编资料编辑 | 分块提取来源事实/事件 | facts | 批量核对 |
| `adaptation.causal-graph` | 故事分析师 | 建立有证据因果边 | edges | 冲突核对 |
| `comic.adaptation-brief` | 漫画改编编辑 | 确定读者、形式、忠实度、风格和限制 | Brief | 确认合同 |
| `comic.decision-pass` | 漫画改编编辑 | keep/cut/merge/reorder/externalize/add | decisions | 逐项确认 |
| `comic.script-adaptation` | 漫画脚本作者 | 把事件变成视觉节拍和文字意图 | script beats | 确认脚本 |
| `comic.page-rhythm` | 漫画编辑 | 分配页面、转页和页末节奏 | page plans | 确认分页 |
| `comic.panel-plan` | 分镜规划师 | 设计页格、镜头、动作和阅读顺序 | panels | 确认分镜 |
| `comic.visual-bible` | 视觉开发师 | 建立 subject 与风格锚点 | visual subjects | 确认视觉圣经 |
| `comic.image-request` | 视觉提示词编辑 | 编译单格 provider-neutral 请求 | media request | 确认生成批次 |
| `comic.visual-continuity-review` | 媒资证据与连续性监修 | AI 审查已选媒资元数据，作者显式验图 | issues + review evidence | 选择问题并确认实际画面 |
| `comic.targeted-repair` | 修图/重生成编排 | 只处理指定 panel/issue | image candidate | 重新选图 |
| `comic.page-review` | 漫画成品编辑 | 审查叙事、文字和页面完整性 | issues | 发布前确认 |

排字布局、几何检查、内容 hash、CBZ/PDF 组装和 Release pinning 是代码职责，不交给模型决定。

## 10. Prompt Spec

- 明确当前阶段：脚本 Skill 不写图片 Prompt，panel Skill 不调用图片 provider，image request 不改故事。
- 每个视觉描述引用 stable subject key 和当前状态，不复制易漂移的自由文本身份。
- panel plan 输出叙事功能、主体、动作瞬间、景别、构图、视线、阅读顺序和受保护区域。
- 图片请求描述一个可冻结瞬间，禁止连续动作堆叠、文字、气泡和水印。
- reviewer 返回 page/panel/subject/asset 定位、可见证据和严重度；无法观察时标记 unknown，不猜测。
- targeted repair 只处理选中的差异，保留未授权 subject、构图、色彩和相邻连续性。
- 所有结构化输出使用闭集 schema；伪造 source key、subject key、asset hash 或越界 geometry 直接拒绝。

## 11. 工作台设计

ComicStudio 分为 Source、Script、Pages、Visual Bible、Images、Lettering、QA、Release 八个区段。

- Script 与 Pages 是两个编辑层，不把来源段落直接显示为 panel。
- 页面画布显示 trim/bleed/safe area、LTR/RTL 阅读序号、panel/balloon 选区和问题标记。
- Images 面板展示 provider 能力、实际参考图、请求 hash、候选、选图和局部修复历史。
- Lettering 允许编辑文本、气泡类型、位置、尾巴、拟声和层级，不把文字烤进底图。
- QA 区分 storyboard blocker 与 visual blocker；用户始终知道当前能发布哪一级。
- 刷新后恢复脚本、页面、Run、候选、上传/生成状态和已选媒资；结果未知不自动重发。

## 12. 发布、导出与权利

Storyboard Release 要求脚本、分页、页格、阅读顺序、视觉圣经、占位/线框和本地排字完整。Visual Release 额外要求每格已选成图、参考图实际传输、连续性/权利/媒资完整性通过。

- PNG/WebP：逐页按 Release 规格合成。
- CBZ：稳定文件名和阅读顺序，包含 manifest/checksums；解压后每页可验证。
- PDF：页面尺寸、出血/裁切策略、字体和阅读方向明确。
- Release 固定所有已选 blob hash；草稿清理只删除无强引用候选。
- provider/model/权利声明、用户上传来源和再分发限制写入可审计 manifest。权利未知时阻断 visual release，不阻断本地 storyboard 保存。

## 13. 测试、样例与评测

原创/合成样例：

- `COMIC-RHYTHM-01`：同一事件拆成 4 页，验证页末转折和反应格。
- `COMIC-RTL-01`：同一页面 LTR/RTL 双画像，验证阅读顺序和气泡顺序。
- `COMIC-CONTINUITY-01`：角色换装、受伤和关键道具跨 12 格，验证 subject state。
- `COMIC-LETTERING-01`：中英文混排、拟声和窄气泡，验证本地容量与避让。
- `COMIC-REPAIR-01`：一格手部/道具错误，只允许局部修复该格。

必测：

- 来源事实→决定→脚本→分页→panel 的证据链完整，确认前正式表零写入。
- LTR/RTL、复杂 panel 几何、safe area、balloon overlap 和阅读顺序正反例。
- provider 无 reference/seed/inpaint、网络中断、未知结果、重复点击和坏 blob 的降级/阻断行为。
- 请求确实携带参考图内容，不只在 Prompt 中声称；request/response/blob hash 可回读。
- 单格重做不改变其它 panel 或旧候选；视觉审查问题可解决和复审。
- Storyboard v1 与 Visual v2 均不可变；删除草稿候选后 Release 媒资仍可导出。
- 项目备份/导入、ID 重映射、源 Work 删除、Comic Work 删除和 blob GC。
- PNG/WebP 解码、CBZ 解压顺序/checksum、PDF 页面规格和字体。
- Product Hub 从小说来源到 storyboard release 的固定 E2E；真实 provider 的 visual E2E 单独记录能力、模型、成本和人工评分。

人工评分维度：叙事清楚度、页节奏、阅读顺序、构图可执行性、角色/服装/场景一致性、文字可读性、修订成本和来源忠实度。

## 14. 施工顺序与分支

唯一功能分支原则：任何施工阶段只在一个漫画专属 worktree 中进行。基础实现分支为 `feat/comic-production`，视觉体验复审分支为 `feat/comic-visual-experience`；两者都从已审定的独立创作集成基线创建，不得沿用剧本 worktree 或包含其未提交改动，复审通过后才按顺序合入集成分支。

1. 共享来源分析契约只从 foundation/集成基线同步。
2. 漫画脚本、page plan、review issue、release asset pinning 与三注册表。
3. 脚本→分页→panel→视觉圣经的 durable Skill DAG。
4. 页面画布、确定性排字、LTR/RTL、storyboard Release 和导出。
5. provider 能力协商、真实参考图、候选选择、局部修复和连续性审查。
6. 真实媒资 E2E、完整 CI、完整 E2E 和专项审查。

两个成熟度阶段属于同一个漫画产品和同一个功能分支，不拆成与漫画并列的第四个产品。

## 15. 完成定义

`storyboard-ready` 可单独作为首个可交付里程碑。`independent.comic` 的本地产品可以在分镜版、作者上传成图的视觉版、Release 媒资固定和最终导出通过后发布；某个图片 provider 只有在自己的真实纵切面、参考图实际传输、跨格一致性和权利证据通过后，才能被标为可生成 visual release。当前 provider 缺少 reference/seed/inpainting 时必须诚实阻断或降级，不能影响作者上传成图或分镜版的独立完成结论。短篇或剧本状态不参与漫画结论。

已实现的收口项：十二阶段 durable Skill DAG、作者确认候选协议、来源事实/因果/决定、漫画脚本、分页、显式阅读链、页格、视觉圣经、provider 能力与参考图实传证据、单格修复、页级 AI 审校、媒资元数据 AI 审查与作者实际画面确认、storyboard/visual 双层不可变 Release、Release→Blob 强引用、PNG/WebP/CBZ/PDF 与 v14 备份往返。旧的一步式漫画候选和直接完稿入口已拒绝；未接入视觉输入的模型不会被标成多模态审查者。

### 15.1 视觉体验复审补充

- 页面工作区收口为左侧真实页缩略图、中央纸张画布、右侧格属性；画布格可直接选中，页面按目标比例显示，不再把管理表单当作主要操作面。
- 空白 storyboard 使用带镜头、构图、主体剪影和可画瞬间的确定性分镜稿；成图后由本地 SVG 层继续合成对白气泡、思绪气泡、旁白和拟声，文字不烤进底图。
- 图片 Prompt V2 固定单格瞬间、相邻格语境、视觉锚点完整身份、本格服装/道具/状态、阅读方向、精确画幅和排字安全区，并明确拒绝海报、拼贴、多格页、文字、水印和重复主体。
- 角色、地点、道具、画风分别使用转面、空间反打、正交结构或风格样片的设定图语言；角色使用竖幅候选，其余设定使用横幅候选。
- 当前 OpenAI-compatible transport 仍是 text-only。没有 reference image/seed/inpainting 时必须显式确认有限一致性，成功候选也继续显示能力警告；本轮不把 Prompt 改良描述成参考图已传输。

## 16. 研究来源

访问/复核日期：2026-09-06。

- [Dark Horse · Script Format and Specifications](https://images.darkhorse.com/darkhorse08/company/submissions/scriptguide.pdf)
- [The Architecture of Visual Narrative Comprehension](https://pmc.ncbi.nlm.nih.gov/articles/PMC4076615/)
- [Navigating Comics: Reading Comic Page Layouts](https://pmc.ncbi.nlm.nih.gov/articles/PMC3629985/)
- [Narrative Graph Prompting for Visually Consistent Storytelling](https://openaccess.thecvf.com/content/ICCV2025W/AISTORY/html/Shin_Generating_Visually_Consistent_Images_for_Storytelling_via_Narrative_Graph_Prompting_ICCVW_2025_paper.html)
- [StoryGPT-V: Consistent Story Visualizers](https://openaccess.thecvf.com/content/CVPR2025/html/Shen_StoryGPT-V_Large_Language_Models_as_Consistent_Story_Visualizers_CVPR_2025_paper.html)
- [Clip Studio Paint · Creating a New Canvas](https://help.clip-studio.com/en-us/manual_en/210_file/Creating_a_New_Canvas.htm)
- [Clip Studio Paint · Margins](https://help.clip-studio.com/en-us/manual_en/270_canvas/Margins.htm)
- [MediBang Paint · Creating Comics](https://medibangpaint.com/en/tutorial/pc/create-comics/)
- [MediBang Paint · Text Tool](https://medibangpaint.com/en/use/2023/11/protext/)
- [MediBang Paint · 7 Tips for Drawing Easy-to-Read Manga](https://medibangpaint.com/en/use/2021/07/7-tips-for-drawing-easy-to-read-manga/)
