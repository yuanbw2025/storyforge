# 09 · 媒资作者控制与版本修订方案

> 层级：L2 · 版本：1.0.0 · 生效：2026-09-07
> 性质：文字冒险图片上传、替换、锁定、解锁和单项重生成的正式施工合同。

## 1. 产品与数据边界

本能力属于独立 `text-adventure` 的生产/发布阶段。它读取当前未发布 Build 的 `media.requirements`、`media.visual-bible`、`media.anchor-decision` 和已验收图片 Artifact；产出一个以旧 Build 为 parent 的新 Build。图片 Blob、媒资 Artifact、Build 和后续 ProductRelease 均归文字冒险产品实例，不能写入 WorldRelease，也不能覆盖旧 Build。

禁止在已经得到 manifest、质量回执或存档引用后原地替换图片字节。每次作者操作必须进入登记命令并派生新 Build：旧 Build、Preview、会话、事件和已发布版本保持可回放；新 Build 只复用能证明未受影响的工件，重新执行确定性装配、自动游玩、质量检查和试玩/发布闸门。

## 2. 操作语义

- `upload-replacement`：作者上传 PNG/JPEG/WebP，声明来源、许可、商用和再分发权利；系统校验 MIME、字节 hash、尺寸、作用域和预算后，把它作为目标 `media.visual.NNN` 的 human-import Artifact。
- `regenerate`：只让目标图片 Provider task 在新 Build 重新执行；其他图片和内容工件沿用。已锁定图片必须先解锁。
- `lock`：新 Build 复用同一物理 Blob，但把目标图片冻结为 human-import 输出并记录作者锁定命令；它不会因同一 Build 后续调度被 Provider 覆盖。
- `unlock`：新 Build 仍使用同一图片，只取消作者锁定；之后作者可再发起单项重生成。

上传与锁定不改变 `media.requirements` 或视觉圣经。若作者要改变角色身份、视觉锚点、整体风格或构图规则，必须走“视觉”演化生成新 Brief/视觉圣经，原锁定素材成为 stale，不能靠锁定掩盖上游变化。

## 3. 新 Build 与 DAG

作者命令必须携带 production revision、parent Build、目标 Artifact key 和预期旧内容 hash；上传还携带已持久化 Blob 的 id/hash/MIME/字节/尺寸、替代文本和权利声明。命令以 CAS 验证当前 Build 后原子创建子 Build：

1. 复制同一已授权 Brief、SourcePlan 和世界版本绑定。
2. 为未受影响 task 创建 Build-local carried-forward Artifact 和显式 reuse 证据。
3. `upload-replacement`、`lock`、`unlock` 把目标图片 task 改为 `human-import`，以零 Provider 调用签署独立 Run/receipt；`regenerate` 保持原 media-provider task。
4. 不复用目标图片的后代：`integration.package`、`qa.autoplay`、`qa.release`、`qa.playtest-strategy` 必须重新执行。
5. 新 Build 重新计算 plan/manifest/package/preview/quality/root receipt；旧 Build 不变。

任何跨作用域 Blob、损坏字节、hash/MIME/尺寸不一致、非图片类型、权利缺失、旧内容 hash 过期、已发布 Build 或锁定后直接重生成都必须在创建新 Build 前失败。

## 4. Artifact 与权利证据

作者导入图片仍使用 `storyforge.generated-media-artifact` V1 的运行装配协议，但 `metadata.source=author-upload`，并追加不可伪造的作者修订元数据：命令 id、parent Build、prior content hash、action、locked。`quality` 记录字节/尺寸校验和未调用 Provider；`rights` 至少记录 `origin=author-upload`、非空 license、commercialUse、redistribution、declaration 和 attribution。

商业候选只有 `commercialUse=true` 且 `redistribution=true` 才能进入社区推荐与导出；作者声明不能代替平台在发布前展示的最终权利复核。

## 5. 工作台与验收

工作台按图片显示缩略图、用途、场景、来源、尺寸、hash、替代文本、权利和锁定状态。作者可替换、锁定/解锁或单项重生成；操作前说明会创建新 Build，操作后展示 parent/child lineage 和真实生产进度。

自动验收至少覆盖：正常上传、错误 MIME、伪造 hash、跨 Work Blob、陈旧 expected hash、锁定后拒绝重生成、解锁后允许、其他图片不重复 Provider 调用、装配/QA 重跑、旧 Build 不变、导出导入后 Blob 引用重映射、删除后无引用 Blob 可回收。真实浏览器 E2E 还必须覆盖 file input、图片解码、刷新、Preview 和发布前权利提示。

## 6. 当前施工状态

已实现：严格 `revise-media-asset` 命令、production revision 与旧图片 hash CAS、作者上传 Blob 的物理 hash/MIME/字节复验、商业权利门、父子 Build lineage、未受影响 Artifact 的 Build-local carry-forward、目标图片 human-import 零调用回执、目标图片及下游定向重跑、锁定后拒绝直接重生成，以及工作台中的缩略图、许可声明、上传替换、锁定、解锁和单项重生成入口。未修改的媒资沿用原 Blob/content hash，但 payload 与 metadata 的稳定 `assetKey` 会确定性重绑当前子 Build；否则新 `media.audit` 会正确拒绝父 Build key。隔离浏览器已覆盖退回、真实 PNG 上传、暂停恢复、新 Build 重审和新旧逐图回执隔离。

本批验证要求：类型检查、命令与调度回归、完整文字冒险生产回归、架构/表/AI 手工调用检查和生产构建全部通过后才允许提交。真实浏览器 file input、刷新与新 Preview 的 E2E 证据在端到端黄金产品验收批次统一冻结，不能用 jsdom 单元测试冒充。
