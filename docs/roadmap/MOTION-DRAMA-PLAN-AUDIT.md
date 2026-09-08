# 漫剧前期生产方案审查

> 版本：1.1.0 · 审查日期：2026-09-09 · 权威层级：L4
> 审查对象：漫剧产品契约、开发规划与内容生产流程图。

## 1. 审查结论

方案可以进入施工，但评审稿遗漏了一个影响最终视频质量的正式节点：**分镜设计之后，视频 Prompt 之前，还需要把 shot 编译为分镜图/首帧/关键帧/尾帧 Prompt，并允许生成、上传和选择实际参考帧。**

本轮已把该节点补进产品契约、数据模型、Prompt/Skill 目录、流程图、Release 和验收矩阵。修订后主链与当前行业成熟做法一致，同时保持 StoryForge 的产品终点在视频生成之前。

## 2. 外部流程交叉验证

| 观察 | 外部证据 | 对 StoryForge 的结论 |
|---|---|---|
| 行业主链包含剧本、资产设定、分镜、分镜图/定妆、图生视频、声音和后期 | 人民邮电出版社 2026 年《AI漫剧创作一本通》的内容提要与目录；湖南日报对动态漫生产小组的报道 | StoryForge 覆盖到分镜图/视频提示词和声音参考，后续视频/剪辑明确出界 |
| 垂直工作台先拆书，再建立角色/场景资产，再把内容拆为可追踪镜头 | YooM 公开产品流程 | 系列、物料和 episode/shot 必须是独立可追踪数据，不能是一个大 Prompt |
| 一致性依赖角色/场景多视图与稳定参考，而不只是重复文字描述 | Runway character/environment plates 指南；行业空间级多视图实践 | 物料库必须包含多角度 plate、候选选择和精确版本绑定 |
| 图生视频文本重点是动作、镜头和时间；输入图负责主体、构图、光线和风格 | Runway Image-to-Video Prompting Guide | 分离 Image Prompt IR 与 Video Prompt IR，避免静态描述和运动描述混写 |
| 视频工具支持并依赖明确的多模态引用角色和时间段控制 | Seedance 2.0/2.5 官方发布 | adapter 必须输出引用用途映射和时间戳段，不能只给一段泛化 Prompt |
| 资产化工具用角色、地点、道具等 Elements 保持跨镜一致性 | LTX Studio 公开能力 | StoryForge 用 stable subject/version 做核心身份，再映射到供应商 Elements |
| 声音不仅是末期配乐，还涉及角色表演、对白时间、环境和音效共同设计 | Seed Audio 1.0 官方发布 | 声音圣经和 cue/timing 必须在剧本/分镜/Prompt 包内，而不是最后补一个“配音风格”字段 |

## 3. 对评审稿发现的缺口与处理

### 已修复

1. **缺少正式参考帧节点**：新增 Image Prompt IR、`start | key | end` shot references、候选生成/上传/选择和 reference-ready 完成门。
2. **静态与动态 Prompt 混用**：拆成 Image Prompt IR 和 Video Prompt IR；后者读取所选帧并聚焦动作、表演、镜头、环境运动、时间和声音。
3. **声音粒度偏粗**：正式区分 voice、ambience、sfx、music motif，要求试听材料或明确 prompt-only 状态。
4. **供应商参数固化风险**：保留 provider-neutral IR，限制和槽位由版本化 capability profile/adapter 编译。
5. **整季自动化过重风险**：坚持系列/物料一次建立、单集有限步骤循环；不建立一个长程自治 Agent。

### 实现复审结果

1. 参考图和试听音频只有在真实字节签名、作用域、hash、权利和作者选择全部成立时才进入版本与 Release；Prompt 中的文字声明不计作已传输参考。
2. V1 支持授权 MP3/WAV/OGG/M4A 试听音频上传与完整声音 Prompt；没有已登记生成能力时不伪造 voice/audio provider 结果。
3. 页漫只复用共享 Blob 等稳定底座，漫剧没有复用页格、排字或漫画媒资 owner 表。
4. medium-neutral 来源清单继续复用；漫剧 series/episode/scene/shot/asset/prompt 均拥有专表和专用 Adoption。
5. 系列与物料一次建立、episode 逐集读取和失效；正式 AI 运行按单个阶段、单集有界执行，不启动整季无限任务。

## 4. 产品质量判断

修订后，流程包含高质量前期生产需要的五条控制线：

- **故事线**：小说来源 → 系列故事引擎 → 分集推进 → 单集退出状态；
- **表演线**：人物欲望/策略 → 可见动作/对白 → shot 表演和时间；
- **视觉线**：风格/角色/服装/场景/道具 → 分镜构图 → 参考帧；
- **声音线**：角色声音/读音 → 对白/旁白 → ambience/sfx/music cue；
- **生成控制线**：shot → Image/Video IR → capability-aware adapter → 引用与校验清单。

这五条线在单集 Release 汇合，足以让外部工具进入视频生成；之后的抽卡、视频返修、剪辑和成片仍由外部流程负责。

## 5. 研究来源

- [ByteDance Seed：Seedance 2.0 Official Launch](https://seed.bytedance.com/en/blog/seedance-2-0-official-launch)
- [ByteDance Seed：Introducing Seedance 2.5](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5)
- [ByteDance Seed：Seed Audio 1.0](https://seed.bytedance.com/en/blog/from-speech-to-audio-creation-introducing-the-seed-audio-1-0-audio-creation-model)
- [Runway：Image-to-Video Prompting Guide](https://help.runwayml.com/hc/en-us/articles/48324313115155-Image-to-Video-Prompting-Guide)
- [Runway：How to create longer videos and films](https://help.runwayml.com/hc/en-us/articles/26871350018835-How-to-create-longer-videos-and-films)
- [LTX Studio](https://website.ltx.studio/)
- [人民邮电出版社：《AI漫剧创作一本通》](https://detail.youzan.com/show/goods?alias=2xf6v9o5op6dd7s&from_source=gbox_seo)
- [湖南日报：AI 动态漫生产流程报道](https://epaper.voc.com.cn/hnrb/images/2026-01/27/08/2026012708_pdf.pdf)
- [YooM：AI 漫剧工作台公开流程](https://www.yoomwork.com/zh)

研究来源用于校验流程节点，不证明任一第三方工具的宣传效果。实际兼容性以 StoryForge 的 capability receipt 和真实输入测试为准。
