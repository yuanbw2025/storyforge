# 11 · 逐图人工审查与推荐候选闸门

> 层级：L2 · 版本：1.3.0 · 生效：2026-09-11
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

制作页按图片原始宽高比完整显示当前图片，不得用固定比例裁切；作者可以放大全屏原图或在新窗口检查，弹层支持关闭按钮与 `Escape` 键退出。资产或作用域变化时必须立即隐藏旧 object URL、清除旧失败态并重新校验；当前 Build 的历史回执尚未加载完成时禁用逐图输入，避免迟到的初始化覆盖作者刚填写的意见。每张图下同时显示职责/mediaKind、场景/beat、请求与实际尺寸、altText、角色锚点、硬约束、独立 Visual QA verdict、五项评分与逐条 issues，并提供“接受此图/退回修改”选择与备注。只有当前 Build 的图片全部作出决定，且每个退回项都有非空原因后，才允许冻结本轮人工回执。

页面同时展示三层证据：确定性媒资审计、独立 Visual QA、作者逐图确认。不得继续使用“无需作者手工逐张批准”的误导文案。作者退回图片后，“按作者意见重生成”只在失败回执已经冻结且仍精确绑定当前 artifactKey/contentHash 时启用；命令把 gate receipt hash、evidence hash、旧图 hash 和原始备注写入结构化 `media.repair-feedback`，图片 Provider 必须消费它，新 Build 再重新完成三层检查。上传替换仍可独立使用，但不能冒充自动消费了作者意见。

视觉锚点确认页必须完整展示全局 palette、构图规则、连续性规则、每位角色身份/外观/色板/硬约束和本轮全部图片职责。确认说明必填并绑定当前视觉圣经 hash。作者若不同意，不是简单“取消”：必须填写具体修改意见，系统先保留并取消当前未发布 Build，再以 `affectedLanes=['visual']` 创建受治理视觉修订 Brief；世界来源、剧情、任务、玩法和旧媒资证据不被原地改写。任何付费图片调用之前还必须存在当前 Build 已通过的真实视觉输入预检 Artifact。

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

真实浏览器：原比例缩略图、全屏原图、逐图合同与 QA 明细、逐图选择、退回回执驱动局部重生成/上传替换、新 Build 旧确认失效、刷新恢复、全部确认后晋升、发布后同 hash 导出。

## 8. 本批施工顺序

1. 在质量回执服务实现严格 evidence parser、记录/读取/require API。
2. 将商业候选状态投影和发布 adoption CAS 绑定人工视觉门。
3. 在制作工作台实现逐图决定、回执冻结与三层证据展示。
4. 补齐 service/regression/UI 测试，再运行架构、三注册表、TypeScript 和构建闸门。
5. 本批完成后再施工第 12 份“产品包、原子导入与社区推荐档案”方案。

## 9. 当前实现证据

2026-09-07 已完成步骤 1–4：严格 parser、记录/读取/require API、商业候选状态投影、adoption/事务 CAS、制作工作台逐图选择和三层证据展示均已接通。回归覆盖全部接受、明确退回、漏图、退回无理由和 Blob 元数据篡改；已有正式执行器回归继续覆盖独立 Visual QA 实际读取图片字节与 key/hash。

隔离浏览器覆盖“退回图片 → 冻结父 Build 失败回执 → 真实 file input 上传单图 → 派生不可变子 Build → 暂停/恢复重审 → 新 hash 全部接受”，并补充“失败回执 → 结构化 repair feedback → 单图重生成任务输入”的控制面闭环。测试同时验证父 Build 失败回执不迁移，子 Build 只生成自己的通过回执，未修改图片保留 Blob 字节但重绑子 Build `assetKey`。同图多用途导致内容 hash 重复时，逐项决定仍完整保存在 evidence，通用 receipt 的输入 hash 集合则确定性去重，避免合法复用被错误拒绝。

该 E2E 证明控制面、文件输入、Build lineage 和回执隔离；它不替代真实旗舰的图片审美判断。真实旗舰仍须在同一最终 Build 上重新通过需求审计、独立 Visual QA、作者逐图确认、真人试玩与发布复验。
