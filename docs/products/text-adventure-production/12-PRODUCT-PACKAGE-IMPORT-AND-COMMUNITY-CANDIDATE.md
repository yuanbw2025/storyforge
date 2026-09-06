# 12 · 产品包、原子导入与社区推荐候选档案

> 层级：L2 · 版本：1.0.0 · 生效：2026-09-07
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
5. 浏览器性能、作者主路线试玩、媒资真实解码和逐图作者确认等不可变 gate receipt；
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
- 真人主路线达到的结局和选择次数、真实浏览器性能、媒资解码与逐图作者判断回执；
- 文本降级是否完整、媒资权利字段和来源归因是否闭合。

所有可从 RuntimePackage 计算的指标都必须在导入时重算并逐字段比对，不能信任包内声明。导入器还必须用包内原始 Brief 对冻结 RuntimePackage 重新执行商业产品质量门，并把每个门的结果和 Build 报告逐项比对；因此不能用短内容、篡改目标时长或伪造的 `passed` 报告冒充推荐候选。所有携带 Artifact 的 `contentHash` 必须由 payload 重算，并存在于 Release 所冻结的 Build manifest receipt 集合。所有 gate receipt 必须重算 receiptHash，状态为 passed，并存在于 Release lineage 的 `quality.receiptHashes`。作者主路线事件中的每个 Choice 还必须逐边匹配冻结 Narrative 图，不能只验证一条自洽但不存在于游戏里的字符串链。

## 4. 导出规则

只有满足以下条件的本地 Release 可以导出社区候选包：

1. `productType=text-adventure`，RuntimePackage 为 Adventure V2；
2. Release 与本地 Build 的 `releasedProductReleaseId`、buildNumber、buildManifestHash、packageHash 完全一致；
3. 原始 Brief 是 `commercial-candidate`；
4. Build 质量报告 `playable=true`、`releaseReady=true` 且全部硬门通过；
5. 自动游玩完整且通过；
6. 浏览器性能和作者主路线试玩回执均通过；有冻结媒资时，媒资运行解码、媒资审计、独立 Visual QA 和逐图作者确认也必须通过；
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

## 6. 市场提交规则

通用市场继续接收内层分发包；文字冒险创作者提交前，客户端必须先生成并复验外层候选包，显示候选档案和阻断原因。只有 `eligible-for-community-submission` 才允许调用 `registerRelease/createListing/submitListing`。

远程服务最终应保存候选档案 hash，并让审核员能读取同一证据投影；在服务端合同升级前，UI 必须明确标注“本地候选资格已验证，远程仍需人工审核”，不得把通用 bundle 校验冒充完整内容推荐审核。外部注册和提交始终需要作者点击并提供账号凭据；本地导出或导入不能隐式触发网络调用。

市场购得的 Release 可本地游玩和按许可离线保存。`distributionProvenance.source=marketplace` 的副本默认不能作为原创作品重新提交；允许派生时也必须生成新的 Production/Release、遵守 remix 与 attribution 条款，不能直接改标签后上传原 hash。

## 7. 删除、迁移与隐私

- ProductRelease、Release 媒资和运行会话仍由 `PROJECT_TABLES` 的引用和删除策略清理；不新增万能产品表。
- 删除导入副本不得删除 WorldRelease、其他产品、其他 Release 仍引用的内容寻址 Blob，或远程合法副本。
- v1 包导入器只接受精确版本；迁移通过登记的纯函数产生新版本包，并保留原 hash 和迁移回执。
- 包内不得出现凭据、模型原始隐藏推理、未采纳候选、作者私有备注、未公开玩家日志或本地绝对路径。

## 8. UI 与真实用户路径

制作工作台在正式文字冒险 Release 下展示“社区候选档案 / 导出产品包”；导入入口即使社区服务未部署也必须可见。作者应清楚区分：

- 本地导出：得到可离线保存和导入的完整产品包；
- 本地上传导入：复验后写入当前 Work，可直接进入玩家模式；
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
- 缺少主路线试玩、浏览器性能、媒资解码、Visual QA 或作者逐图回执时拒绝社区候选导出；
- 原型/内部质量 Release、Adventure V1、其他产品类型、超 256MiB、重复 asset key、未知字段或不安全 MIME 拒绝；
- 数据库中途写入失败不留下可见半成品 Release；孤立 Blob 可被立即回收；
- 删除导入副本后，原世界 hash、其他 Release 和共享 Blob 引用仍正确；
- 市场来源副本直接作为原创提交被阻断。

完整 E2E 必须在隔离浏览器数据中执行，不得修改作者当前 Work。测试不仅检查按钮存在，还要下载真实文件、清空或切换到全新隔离 Work、重新上传、打开玩家端、走到结局并核对导入前后 Release/package/bundle/candidate hash。

## 10. 完成定义与下一步

本阶段完成意味着：本地文件导出与上传导入真实可用；候选包在无数据库上下文时仍能复验内容规模、运行包、媒资和关键质量证据；导入失败不产生半成品；市场提交对文字冒险执行候选资格门；隔离浏览器往返与删除生命周期通过。

完成后进入批次 G：建立来源充分的隔离 WorldRelease，用专业 Agent 团队正式生产首个约一小时旗舰内容，经过作者试玩与视觉确认后生成同一 Release/hash 的候选包。该旗舰通过本文合同只代表“具备提交资格”；向社区实际上传和公开仍要在展示最终游戏与证据后由作者单独确认。
