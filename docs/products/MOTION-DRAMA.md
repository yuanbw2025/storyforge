# 漫剧前期生产产品契约

> 版本：1.1.0 · 生效：2026-09-09 · 权威层级：L2
> 产品：`independent.motion-drama` · 用户名称：漫剧工坊
> 实施状态：已完成当前工程闭环；能力边界与证据以能力基线和自动验证为准。

## 1. 产品目标

漫剧工坊把一句话或已有小说生产为可交给外部 AI 图片/视频工具的专业前期生产包：小说来源、系列策划、漫剧剧本、版本化物料、逐镜分镜、分镜图/关键帧提示词、参考帧和视频生成提示词适配包。

它是独立创作产品，不是现有剧本或页漫功能的模式开关，也不要求 WorldRelease。

## 2. 生产边界

正式主链：

```text
一句话/已有小说/导入文本
→ 小说内容与来源冻结
→ 系列定位/系列圣经/分集推进表
→ 角色/服装/场景/道具/声音物料与参考材料
→ 逐集集纲/漫剧剧本
→ 逐镜分镜
→ 分镜图/首尾关键帧 Image Prompt IR 与参考帧
→ Video Prompt IR
→ Seedance/Runway/LTX 等版本化适配包
→ 单集或整季前期生产 Release
```

明确不拥有：视频生成、视频候选选择、剪辑、字幕成片、调色、混音、最终漫剧文件、发布平台运营。

## 3. Owner 与交接

- 一句话模式在同一工作台复用小说生产能力，小说正文仍由 Novel Work 拥有。
- MotionDrama Work 保存来源 Work、范围、revision、hash 和冻结 source manifest，不反向写小说。
- 系列圣经、分集计划、剧本、物料定义/版本、参考媒资、shots、Prompt IR、适配包、审查问题和 Release 均由 MotionDrama Work/Release 拥有。
- 图片/音频字节可复用共享 Blob 基础设施；语义 owner 不转移给世界引擎、页漫、上层产品或供应商。
- 来源或上游版本改变后，受影响候选必须 stale；已发布 Release 保持不可变。

## 4. 生产节奏

系列策划和主体物料先建立并锁定版本；剧本、分镜、参考帧和 Prompt 包按集生产、按集确认、按集发布。系统不得用一个无限任务生成整季，也不得要求作者每集重建全部物料。

每个用户可见步骤只有 `未开始 → 生成中 → 待确认 → 已确认`，另有失败和过期状态。底层正式 AI 调用继续遵守登记 Skill、Run Contract、Context Manifest、CreativeArtifact、确定性检查、最多一次定点 repair、作者确认与 Adoption。

## 5. 提示词自由与硬边界

作者可以查看、复制、编辑、保存、比较和恢复每一步提示词，并设置 Work 默认或 episode 覆盖。作者不能通过提示词改变：

- 产品/Work/episode/source/asset 作用域；
- 已登记上下文源和可写字段；
- 输出 schema、stable key、版本与引用完整性；
- 调用、预算、repair、stale、媒资权利和确认门；
- provider capability 和 Release 完成门。

每次运行冻结最终模板、变量、版本和 hash，保证候选可解释、Release 可复现。

## 6. 物料与参考帧

正式物料类型为 `style | character | costume | location | prop | voice | sound`；`sound` 的具体用途在声音定义和逐镜 cue 中细分为 ambience、sfx 与 music。每项拥有稳定 key、文本定义、生成 Prompt、禁止漂移项、版本、候选、已选参考媒资、权利和内容 hash。

shot 另有 `start | key | end` 参考帧。参考帧从已确认 shot 和精确物料版本编译，不升级为系列物料身份。物料或参考帧缺失时可以保存/导出 prompt-only 结果，但不得标记 reference-ready。

## 7. Provider-neutral IR

核心领域保存 Image Prompt IR 和 Video Prompt IR，不保存供应商槽位编号或临时参数作为业务真理。Seedance/Runway/LTX 等 adapter 从 IR、所选参考媒资和版本化 capability profile 确定性编译；超能力必须拆分、降级或阻断，不能静默忽略引用。

## 8. 世界边界

V1 不要求、读取或生成 WorldRelease，不向世界引擎写入人物图、服装图、场景图、道具图、声音、剧本、分镜或 Prompt。未来若允许显式世界来源，必须另行修改总纲、需求适配器和产品契约。

## 9. 完成层级

- `prompt-only`：系列、剧本、分镜与 Image/Video Prompt IR 完整，但部分实际参考媒资未锁定。
- `reference-ready`：必需物料和 shot 参考帧已选择，引用实际存在、可解码、权利与 hash 完整，adapter 包通过当前 capability profile。

二者是同一产品的成熟度，不建立第二产品。两级 Release 都停在外部视频生成之前。

## 10. 完成判据

1. Product Hub 可从一句话、已有本地小说或不超过 25,000 字的粘贴文本创建并完成主链；更长文本先进入长篇产品，再作为已有小说冻结。
2. 系列级内容和物料版本与逐集内容严格分层；80 集项目按需读取。
3. 每步 Prompt 可编辑且硬边界不可绕过。
4. 物料、剧本、shot、参考帧、Prompt IR 和 adapter 包引用闭合。
5. 单集/整季 Release 不可变，导出包含清单与内容 hash。
6. 三注册表、schema、迁移、导入导出、删除、重映射、Blob GC 和 stale 有正反例。
7. 刷新、断网、provider 错误、结果未知、拒绝和定点修订可恢复。
8. 完整 CI、隔离 UI E2E 和真实 Prompt 适配抽检通过；不得用编译成功代替内容质量验收。

唯一专项方案：[MOTION-DRAMA-PREPRODUCTION-DEVELOPMENT-PLAN.md](../roadmap/MOTION-DRAMA-PREPRODUCTION-DEVELOPMENT-PLAN.md)。
