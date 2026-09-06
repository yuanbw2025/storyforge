# 11 · 逐图人工审查与推荐候选闸门

> 层级：L2 · 版本：1.0.0 · 生效：2026-09-07
> 性质：文字冒险商业候选的逐图作者确认、质量回执与发布阻断施工合同。

## 1. 要解决的缺口

文字冒险图片需要三种互不替代的证据：

1. `media.audit` 证明需求、Artifact、Runtime 引用、物理 Blob 和权利字段闭合；
2. `quality.visual-review` 由独立 Visual QA Director 检查身份、场景、风格、构图、剧透、伪文字、明显畸形与无障碍问题；
3. 本文定义的逐图人工回执证明作者实际看过当前 Build 的每个冻结图片，并逐项决定接受或退回。

浏览器成功解码图片只证明文件能显示，模型审图只证明受治理的自动检查已经执行。二者都不能代表作者认可最终观感。商业候选缺少第三类证据时只能保持 `preview-ready`，不得生成正式 ProductRelease 或进入社区提交。

## 2. 产品与数据边界

- 产品：独立 `text-adventure` 的生产与发布阶段。
- owner：当前文字冒险 Work / Build；回执写入既有 `productQualityGateReceipts`，不新增私有万能表。
- 输入：当前 Build/Brief/Preview hash、`media.audit`、`quality.visual-review`、RuntimePackage 冻结图片列表及每图 Blob hash。
- 输出：`storyforge.text-adventure-human-visual-review-evidence` V1 和通用 `storyforge.product-quality-gate-receipt` V1。
- 世界引擎：不读取、不写回；图片及审查结果只属于产品 Build。
- AI：本步骤不调用模型；作者决定不能由 Agent 代签。

## 3. 回执合同

质量门 ID 固定为 `text-adventure.visual.author-approval`，版本为 `1`。原始证据必须包含：

```text
schema/version
buildNumber
packageHash / previewHash / briefHash
mediaAuditHash / visualReviewHash
assets[]:
  assetKey / artifactKey / contentHash / blobContentHash / mimeType
  decision: approved | rejected
  note
confirmedAt
passed
```

`assets` 必须按 `assetKey` 排序，并与当前 RuntimePackage 的全部图片一一对应；音频不进入此门。`artifactKey`、两个内容 hash、MIME 和实际 Blob 必须与 Build 当前 accepted/carried-forward Artifact 完全一致。`media.audit` 必须为 `passed`，独立审图必须为 `passed`；不能用人工点击覆盖技术损坏、模型阻塞问题或陈旧审图。

`passed` 只能由系统从“全部图片均为 `approved`”派生。作者可以给任一图片 `rejected` 并附注问题，此时仍保存失败回执，为局部重生成或上传替换提供可追踪证据；失败回执绝不能推进发布状态。

## 4. 陈旧与不可变规则

- 每次上传替换、重生成、视觉演化或重新装配产生新 Build/hash，旧人工回执继续保存在旧 Build，不能迁移或复用。
- 回执写入前再次 CAS 校验 Build、Preview、Artifact、Blob、`media.audit` 和 `quality.visual-review`；任一变化即拒绝写入。
- 相同证据重复提交保持幂等；不同逐图决定生成新的不可变回执。读取“当前结论”只取当前 gateVersion 下最新回执。
- ProductRelease lineage 只记录最终通过回执的 hash，不复制作者私有备注到世界引擎。

## 5. 工作台交互

制作页在每张缩略图下显示当前图片的审图状态，并提供“接受此图/退回修改”选择与可选备注。只有当前 Build 的图片全部作出决定后，才允许冻结本轮人工回执。

页面同时展示三层证据：确定性媒资审计、独立 Visual QA、作者逐图确认。不得继续使用“无需作者手工逐张批准”的误导文案。作者退回图片后，应直接使用既有单项重生成、上传替换或返回视觉需求修订入口；新 Build 必须重新完成三层检查。

## 6. 发布与社区推荐

对含图片的 `commercial-candidate` 文字冒险，Build 晋升 `release-ready` 必须同时满足：

- 包级全部硬门与文字冒险推荐体量门；
- 真实浏览器性能回执；
- 作者确认的主路线完整试玩回执；
- 全部冻结媒资真实浏览器解码回执；
- `media.audit` 与独立 Visual QA 均通过；
- 本文的逐图人工回执通过。

`prepareProductProductionAdoption()`、事务 CAS 和 ProductRelease lineage 必须绑定这份回执 hash。Marketplace 仍需独立的权利复核与目录审核；逐图人工通过不等于已经对外发布。

## 7. 自动验收矩阵

正例：多图全部接受、无图纯文字候选、重复相同提交、刷新后读取最新通过回执、发布 lineage 包含回执 hash。

反例：漏图、重复 assetKey、伪造 hash/MIME、跨 Work Artifact 或 Blob、旧 Build 决定、视觉审图未通过、媒资审计未通过、作者退回图片、回执写入前 Build 变化。

真实浏览器：缩略图解码、逐图选择、退回后局部替换、新 Build 旧确认失效、刷新恢复、全部确认后晋升、发布后同 hash 导出。

## 8. 本批施工顺序

1. 在质量回执服务实现严格 evidence parser、记录/读取/require API。
2. 将商业候选状态投影和发布 adoption CAS 绑定人工视觉门。
3. 在制作工作台实现逐图决定、回执冻结与三层证据展示。
4. 补齐 service/regression/UI 测试，再运行架构、三注册表、TypeScript 和构建闸门。
5. 本批完成后再施工第 12 份“产品包、原子导入与社区推荐档案”方案。
