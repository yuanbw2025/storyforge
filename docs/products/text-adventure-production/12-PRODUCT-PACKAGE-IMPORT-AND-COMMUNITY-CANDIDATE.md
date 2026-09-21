# 12 · 产品包、原子导入与社区推荐候选档案

> 层级：L2 · 版本：1.5.2 · 生效：2026-09-11
> 性质：文字冒险发布后分发、离线复验、上传导入与社区候选提交的施工合同。

## 1. 本阶段交付的不是一个 JSON 下载按钮

本阶段属于独立 `text-adventure` 产品的发布与分发阶段。数据 owner 仍是具体文字冒险 Work；输入是不可变 `ProductRelease`、产品自有媒资和与该 Release 同一 Build/hash 的质量证据，输出是可离线验证的文字冒险产品包、导入后的本地 Release 副本，以及作者可检查的社区推荐候选档案。世界引擎只保留来源哈希证明，不被打包、复制或回写。

项目已经有通用 `ProductDistributionBundleV2`、媒资内容寻址存储、`ProductRelease`、市场服务上传下载和 `PROJECT_TABLES` 生命周期。文字冒险不得复制这些底座。本阶段新增的是文字冒险专属的严格外层包和候选资格验证：它证明包内确实是完整文字冒险、内容规模和路线指标来自冻结 RuntimePackage、发布质量报告和真人/浏览器回执可以离线复验，而不是仅凭作者填写的宣传文案宣称“一小时、可推荐”。

## 2. 两层合同

### 2.1 通用分发内层

继续使用 `storyforge.product-distribution-bundle` v2：

- 冻结 ProductRelease manifest、Release contentHash 和来源 WorldRelease contentHash；
- 携带 RuntimePackage 引用的全部产品媒资物理字节；
- 对 schema、未知字段、媒资数量、base64、byteSize、MIME、内容哈希、总大小和 bundleHash 做完整预检；
- 不携带 API Key、Provider 凭据、生产中的 Run、私有草稿、玩家存档或世界数据库行。

### 2.2 文字冒险候选外层

新增 `storyforge.text-adventure-community-package` v1，固定包含：

1. 上述通用分发包；
2. 从冻结 RuntimePackage 确定性重算的候选档案；
3. 原始、已确认的 `commercial-candidate` Brief 快照，以及同一 Build 的完整质量报告；
4. 自动游玩报告、媒资三向审计、独立 Visual QA 等必要 Artifact 快照及其内容哈希；
5. 浏览器性能、作者主路线、作者与独立玩家双角色完整试玩、媒资真实解码和逐图作者确认等不可变 gate receipt；
6. 覆盖全部内容的 `packageHash`。

外层包的默认扩展名是 `.storyforge-adventure.json`。v1 使用 JSON 以便当前浏览器直接导入导出和人工审计；未来若改为 ZIP，只能新增版本，不得让同一版本出现两种编码。

## 3. 推荐候选档案

档案状态只允许：

- `eligible-for-community-submission`：具备提交社区审核的证据资格；
- `blocked`：缺少或存在失败证据。

档案绝不使用“已获社区推荐”措辞。是否公开、是否被社区推荐仍由远程审核和作者最后一次显式提交决定。

档案至少展示并冻结：

- 标题、Release hash、Runtime package hash、来源世界 hash、Build 编号；
- 路线数、可达结局、最短/最长路线可见文本量、最短估算分钟、最短路线对白轮次、叙事选择和持久状态决定；
- NPC、交谈行动、主线阶段、必需目标和最少主线推进动作；
- 大区、区域、地点、场景、主线/支线、storylet、物品、装备、能力、资源和媒资数量；
- 自动游玩每类用例结果、质量硬门结果、正文复制/占位问题；
- 作者与独立玩家分别达到的结局、实测毫秒、选择、总行动、不同有效行动、交谈和四项评分，以及真实浏览器性能、媒资解码与逐图作者判断回执；
- 文本降级是否完整、媒资权利字段和来源归因是否闭合。

所有可从 RuntimePackage 计算的指标都必须在导入时重算并逐字段比对，不能信任包内声明。导入器还必须用包内原始 Brief 对冻结 RuntimePackage 重新执行商业产品质量门，并把每个门的结果和 Build 报告逐项比对；因此不能用短内容、篡改目标时长或伪造的 `passed` 报告冒充推荐候选。所有携带 Artifact 的 `contentHash` 必须由 payload 重算，并存在于 Release 所冻结的 Build manifest receipt 集合。所有 gate receipt 必须重算 receiptHash，状态为 passed，并存在于 Release lineage 的 `quality.receiptHashes`。作者主路线事件中的每个 Choice 还必须逐边匹配冻结 Narrative 图，不能只验证一条自洽但不存在于游戏里的字符串链。

## 4. 导出规则

只有满足以下条件的本地 Release 可以导出社区候选包：

1. `productType=text-adventure`，RuntimePackage 为 Adventure V2；
2. Release 与本地 Build 的 `releasedProductReleaseId`、buildNumber、buildManifestHash、packageHash 完全一致；
3. 原始 Brief 是 `commercial-candidate`；
4. Build 质量报告 `playable=true`、`releaseReady=true` 且全部硬门通过；
5. 自动游玩完整且通过；
6. 浏览器性能、作者主路线和 `text-adventure.playtest.human-coverage` 双角色试玩回执均通过；有冻结媒资时，媒资运行解码、媒资审计、独立 Visual QA 和逐图作者确认也必须通过；
7. Release manifest、lineage、媒资字节和全部候选证据在导出前重新验证。

导出文件名只使用经过清理的游戏标题、Release 版本和短 hash。下载动作是本地可恢复操作，不等于外部发布，不需要市场服务或账号令牌。

## 5. 本地上传与原子导入

用户可在当前已初始化 Work 选择 `.storyforge-adventure.json` 文件。导入顺序必须固定：

1. 读取文本并限制文件大小；
2. 严格解析外层 schema 和未知字段；
3. 完整验证通用分发内层、候选档案、Artifact、quality receipt 和 packageHash；
4. 在任何正式产品行写入前解码并验证全部媒资；
5. 以一个 Work 为目标创建内容寻址媒资对象、ProductRelease、ProductMediaAsset 和绑定；
6. 对相同 Release hash 幂等返回已有副本；同 key/version 不同 hash 必须拒绝；
7. 任一数据库绑定失败时不得留下半个 Release；可能产生的未引用 Blob 由同一导入失败路径立即回收，并保留错误而不是隐藏重试。

本地文件导入的 `distributionProvenance.source` 必须明确为 `local-file`，记录外层包 hash、原始 Release hash、导入时间和“未证明远程作者身份”的事实，不能伪造成 marketplace listing/order/entitlement。导入不会创建 WorldRelease，也不会把来源世界内容展开进当前 Work。

工作台同时列出当前 Work 的导入副本。删除必须再次由用户确认，只接受带 `distributionProvenance` 的副本；原创 Release、跨 Work 记录以及已经成为 Production/Build 血缘来源的副本一律拒绝。删除事务从 `PROJECT_TABLES` 的 `productReleases` 引用闭包派生，级联副本会话、事件、检查点和产品私域媒资；事务完成后才按精确 Blob id 回收无引用对象，仍被其他 Release 或 Build 使用的内容寻址 Blob 必须保留。

## 6. 市场提交规则

通用市场继续接收内层分发包；文字冒险创作者提交前，客户端必须先生成并复验外层候选包，显示候选档案和阻断原因。只有 `eligible-for-community-submission` 才允许按 `createListing/reviseListing → registerRelease → submitListing` 顺序提交。先有目录草稿是服务端验证 creator、listing、productType 与 releaseHash 同一作用域的必要条件，不能在建目录前上传，也不能用 UI mock 的成功回执替代真实网关顺序。

文字冒险上传使用 `storyforge.text-adventure-community-submission` v1：通用 `distributionBundle` 只传一次，旁路信封携带版本化 dossier、完整离线复验 evidence 和 `candidateHash`。服务端必须重建完整 `storyforge.text-adventure-community-package`，执行与本地导入相同的严格验证，逐项绑定 listing、creator、产品类型、Release、bundle、候选 hash 与证据摘要；不得直接信任客户端的 `eligible`、分钟数、质量结果或 receipt。验证成功后，对象存储以 `(listingId, releaseHash)` 为不可变键保存完整候选审核记录和小型 verification attestation，因此同一 listing 修订到新 Release 时保留旧证据历史但绝不复用旧版本。

发行上传的 `requestId` 是服务端 durable 幂等键，而不是只写审计日志的客户端标签。发行持久层必须先以 `(creatorId, requestId)` 原子登记 `processing` 请求记录，冻结由 `listingId + releaseHash + bundleHash + candidateHash + productType` 形成的 fingerprint、候选回执计划和开始时间；完成发行物、候选记录与 attestation 的写后回读后，再以实际唯一审核记录原子冻结首次终态回执并把同一请求提交为 `completed`。同 fingerprint 重试（包括响应丢失、进程退出和 service 重建）继续完成未结束步骤或返回首次冻结回执；同一 requestId 携带不同绑定一律以 409 `request_conflict` fail-closed。候选审核记录由 `(listingId, releaseHash)` 唯一拥有：第一个成功落盘的记录冻结规范 `verifiedAt` 与 hash；若同一 owner 的记录已经存在，任何新的、并发的或恢复中的 requestId 都必须复用该记录，并在完成 processing 请求时把候选回执计划收敛到实际 recordHash，不能用各自请求开始时间制造第二份候选或让旧请求永久失效。终态 `completedAt` 至少为 `max(当前时钟, createdAt)`，所以进程重建时系统时钟回拨也不能生成逆序状态。非文字冒险继续使用 `{requestId, bundle}`，其 `listingId/candidateHash` 固定为 null，但同样经过 durable 请求回执。

生产对象存储必须显式实现 `storyforge.commercial-release-delivery-capabilities` v1，而不能因为一个通用健康探针返回 ok 就被视为可用。当前能力闭集依次为 `delivery-record-v1`、`delivery-head-v1`、`text-adventure-review-v1`、`text-adventure-review-attestation-v1` 和 `upload-request-idempotency-v1`，存储 schema 版本固定为 1。`productionRuntime.releaseDeliveryPersistence` 同时承担真实读写接口、通用外部依赖活探针和专用能力探针；托管组合根把两种探针合并，schema、版本、顺序或任一能力不匹配时 `object-storage=unhealthy`，平台 readiness 为 false。仓库只定义协议和内存合规夹具，不伪造某家云对象存储；真实 Provider、凭据、桶版本和备份策略仍由部署环境注入。

从旧对象存储 adapter 切换时顺序固定：先停止新上传并完成在途请求盘点；对旧 delivery/review/attestation 做只读快照与 hash 清单；在新命名空间建立 schema v1 和 upload-request 条件写/CAS 能力；复制不可变记录并逐项执行 load/head/候选/attestation 写后回读；历史上传没有可信 requestId 时不得伪造 completed 回执，只允许以后以新 requestId 得到 duplicate 回执；在影子环境强制运行能力探针和恢复夹具；最后一次性切换 `productionRuntime` 绑定并强制刷新 readiness。旧存储保持只读备份直至保留期结束，回滚只能整体恢复旧绑定，禁止双写两个权威存储。

`submitListing`、公开发现和领取只读取可信不可变 HEAD + attestation；`publishListing` 与实际下载重新读取 bundle 和完整候选记录复验，完整上传本身也执行同等级复验。审核员通过受 `catalog:publish` 权限保护的 `review-candidate` 端点读取由服务端确定性投影的 dossier、candidateHash、recordHash 和证据摘要，文字冒险审核 UI 在读取当前 `listingId + releaseHash` 投影前不得启用发布。公开发现一次只处理受控候选页（默认 50、服务端硬上限 100）；证明读取由网关实例级共享 semaphore 约束全局在途并发（默认 4），每项读取都有硬 deadline 和 `AbortSignal`，外部 adapter 必须把 signal 传到底层 HEAD/attestation 请求，挂起、超时、损坏或 legacy 记录均只从该页 fail-closed 隐藏。兼容 `discover()` 仍返回 listing 数组；新客户端通过 `discoverPage` 显式翻页，响应 `x-storyforge-next-cursor` 是绑定规范化 query、productType 及最后扫描 `updatedAt + listingId` 的不透明 keyset 游标，客户端和服务端都严格复验。游标推进已扫描候选而非通过证明的结果，因此空结果页仍可继续；目录头部插入也不会让既有遍历因数字 offset 位移而重复或漏项。筛选变化必须清空 UI 旧游标。

升级前已经是 published、但没有服务端候选记录的文字冒险属于 legacy 未证明内容：不得进入发现、不得新领取或重新下载，必须退回修改并重新上传候选证据。已依法下载到用户本地的副本仍遵守 `localCopyPreserved`，升级不能远程删除。本地候选资格、服务端候选复验和人工社区审核是三件不同的事，任何一个都不得冒充另一个。

外部注册和提交始终需要作者点击并提供账号凭据；本地导出或导入不能隐式触发网络调用。生产对象存储 adapter 必须实现 delivery HEAD、候选记录、attestation 与 upload request 的不可变/条件写入、read-after-write 和版本化备份恢复；损坏记录一律 fail-closed，普通上传不能静默覆盖。市场 Fetch 边界以实际 `ReadableStream` 字节为权威逐块计数，默认发行上传硬上限 360MiB、单进程同时读取最多 2 个大包；Origin、方法、Content-Type、声明长度与 header-only Bearer preflight 必须在取得大包槽之前通过，认证边界缺失或异常时以 503 拒绝且不读正文。非法或已超限 `Content-Length` 在提前拒绝时也必须 cancel 未读流；实际字节越界立即 cancel reader，超过并发预算返回 429 与 `Retry-After`。正文读取同时监听请求 `AbortSignal` 和硬 deadline（普通命令默认 10 秒，发行上传默认 120 秒），超时返回 408 并取消 reader，任何完成、拒绝、中止、超时和异常路径都必须释放槽。`Content-Length` 只用于提前拒绝，缺失或伪造偏小都不能绕过流式限额。当前 JSON v1 在上限内仍需完整组装后严格解析；真实反向代理/Serverless 运行环境还必须施加不高于该值的流量、内存、超时和并发限制。

市场购得的 Release 可本地游玩和按许可离线保存。`distributionProvenance.source=marketplace` 的副本默认不能作为原创作品重新提交；允许派生时也必须生成新的 Production/Release、遵守 remix 与 attribution 条款，不能直接改标签后上传原 hash。

## 7. 删除、迁移与隐私

- ProductRelease、Release 媒资和运行会话仍由 `PROJECT_TABLES` 的引用和删除策略清理；不新增万能产品表。
- 删除导入副本不得删除 WorldRelease、其他产品、其他 Release 仍引用的内容寻址 Blob，或远程合法副本。
- 删除命令需要明确确认 token；原创 Release、跨 Work 目标和已进入本地生产血缘的副本 fail-closed。删除结果必须回报删除的会话/媒资绑定数，以及实际回收和因仍有引用而保留的 Blob id。
- v1 包导入器只接受精确版本；迁移通过登记的纯函数产生新版本包，并保留原 hash 和迁移回执。
- 包内不得出现凭据、模型原始隐藏推理、未采纳候选、作者私有备注、未公开玩家日志或本地绝对路径。

## 8. UI 与真实用户路径

制作工作台在正式文字冒险 Release 下展示“社区候选档案 / 导出产品包”；导入入口即使社区服务未部署也必须可见。作者应清楚区分：

- 本地导出：得到可离线保存和导入的完整产品包；
- 本地上传导入：复验后写入当前 Work，可直接进入玩家模式；
- 本地副本管理：刷新后仍可列出导入 Release，并经二次确认删除其会话和产品私域媒资；
- 社区提交：上传内层发行物并进入远程人工审核，不等于立即公开或推荐。

真实路径为：冻结世界 → 专业 Agent DAG → Build → 自动/真人/浏览器/视觉质量门 → ProductRelease → 生成候选档案 → 导出文件 → 全新隔离 Work 上传 → 哈希等价验证 → 从开局玩到结局 → 保存/刷新/分支 → 删除导入副本并确认世界不受影响 → 作者另行确认社区提交。

## 9. 测试矩阵

正例：

- 纯文字商业候选导出、全新 Work 上传、打开、存档、刷新并到达结局；
- 带图候选的全部字节、尺寸、权利、运行引用和人工回执往返一致；
- 相同文件重复导入只返回同一 Release，不复制媒资；
- 本地导入与市场导入使用不同 provenance，均不创建 WorldRelease。

反例与破坏性边界：

- 修改正文、选择、结局、目标分钟、质量硬门、自动游玩结果、任一 receipt 或图片字节后拒绝；
- 缺少作者主路线、双角色真人试玩、浏览器性能、媒资解码、Visual QA 或作者逐图回执时拒绝社区候选导出；同一事件流冒充两种试玩身份、降低时长/交互阈值或篡改主观证据同样拒绝；
- 原型/内部质量 Release、Adventure V1、其他产品类型、超 256MiB、重复 asset key、未知字段或不安全 MIME 拒绝；
- 数据库中途写入失败不留下可见半成品 Release；孤立 Blob 可被立即回收；
- 删除导入副本后，原世界 hash、其他 Release 和共享 Blob 引用仍正确；
- 市场来源副本直接作为原创提交被阻断。
- 服务端拒绝 candidateHash、dossier、receipt、bundle 或证据摘要任一篡改，以及 creator/listing/productType/releaseHash 的跨作用域绑定；HEAD/attestation 损坏时不得提交或领取，完整 bundle/review 损坏时不得发布或下载；
- 同一 listing 修订到新 Release 后，审核 UI 必须重新读取新 `(listingId, releaseHash)` 候选，旧缓存不能解锁发布；legacy published 文字冒险若无 attestation，不得出现在发现或领取结果中；
- 上传在发行物或候选记录已经落盘后中断时，新 service 实例用相同 requestId 必须恢复并返回首次冻结回执；即使重建实例的系统时钟早于 processing.createdAt，completedAt 仍不得倒退；响应丢失后的精确重试也不得重复创建，换 listing/release/bundle/candidate 复用同一 requestId 必须返回 409；
- 请求 A 在审核记录落盘前中断、请求 B 用不同 requestId 完成同一 listing/release/candidate 后，A 的精确重试必须复用 B 已冻结的 review/attestation 并完成；两个不同 requestId 并发写同一候选也必须收敛到同一 recordHash；
- 生产对象存储缺少 upload-request、HEAD、候选或 attestation 任一能力，能力 schema/版本不匹配，或专用探针异常时 readiness 必须 fail-closed；内存 adapter 不能冒充 production；
- 大包使用 chunked body、无 Content-Length 或伪造偏小 Content-Length 时都按真实流字节在越界处终止且不调用发行网关；非法或声明超限 Content-Length 必须在拒绝时取消未读流；并发预算占满返回 429，前一请求完成后必须释放名额；
- 未认证、错误方法或错误 Content-Type 的大包必须在读取正文和取得并发槽前拒绝并取消流；两个永不结束的慢流必须在 deadline 后返回 408、取消 reader、释放全部槽，随后合法上传可立即进入；客户端 AbortSignal 也必须触发同一释放语义；
- 公开发现对每个请求最多读取配置页大小的 HEAD/attestation，多个并发请求的实际在途读取总数也不得超过共享 semaphore 上限；单项证明挂起必须在 deadline 后通过 AbortSignal fail-closed。坏 attestation 不改变候选游标推进，空结果页仍能加载下一页；opaque keyset cursor 必须绑定筛选和稳定排序键，目录头部插入不得造成旧遍历重复/漏项，查询变化不得复用旧游标；旧 discover 调用仍兼容返回数组第一页；
- 非文字冒险仍接受原 `{requestId, bundle}` 上传合同，但提交时必须确认目录 productType 与冻结 bundle manifest 一致，不能把文字冒险伪装成其他产品绕过候选门。

完整 E2E 必须在隔离浏览器数据中执行，不得修改作者当前 Work。测试不仅检查按钮存在，还要下载真实文件、清空或切换到全新隔离 Work、重新上传、打开玩家端、走到结局并核对导入前后 Release/package/bundle/candidate hash。

## 10. 完成定义与下一步

本阶段完成意味着：本地文件导出与上传导入真实可用；候选包在无数据库上下文时仍能复验内容规模、运行包、媒资和关键质量证据；导入失败不产生半成品；市场提交对文字冒险执行候选资格门；隔离浏览器往返与删除生命周期通过。

当前实现已闭合导入副本的明确确认、注册表派生级联、共享 Blob 保留与回收回执，并把“上传 → 双结局 → 刷新 → 删除 → 世界不变”纳入隔离浏览器 E2E；远端市场现已接收并服务端复验文字冒险候选信封、持久化待审记录、向审核员暴露同一证据投影，并在提交、发布、发现、领取和下载边界 fail-closed。发行上传已持久化 creator/request fingerprint、处理状态与首次回执，并覆盖进程重建恢复、响应丢失精确重试、request 冲突和非文字冒险兼容；对象存储能力以显式版本协议进入生产 readiness，大包 Fetch 则按真实流字节和并发预算 fail-closed。仓库没有配置真实云对象存储，Provider、外部探针实现和迁移执行仍是部署环境接入项。完成后进入批次 G：建立来源充分的隔离 WorldRelease，用专业 Agent 团队正式生产首个约一小时旗舰内容，经过作者试玩与视觉确认后生成同一 Release/hash 的候选包。该旗舰通过本文合同只代表“具备提交资格”；向社区实际上传和公开仍要在展示最终游戏与证据后由作者单独确认。
