# HARNESS-86 · 真实故事线 Generator 主路径 A/B 证据（2026-08-15）

> 本记录只提交冻结协议、aggregate、失败分类、模型身份、用量和 hash。完整合成输入与模型输出只以
> `0600` 权限保存在本机，不进入仓库；没有读取、打印或持久化 API Key。成本来自 StoryForge 本地
> 价格表估算，实际扣费以服务商账单或资源包结算为准。

## 1. 评测边界

- development 冻结为 6 个中文合成故事世界，不含作者手稿。每例包含明确目标、必需事实、未来信息和
  错世界诱饵；执行顺序按例交叉，降低固定先后顺序偏差。
- `legacy-direct` 使用 `b6b57f4` 前的真实故事线 prompt 与旧 parser；`agent-harness` 使用生产
  `outline.story-arcs` Skill、登记 Context、durable Run、候选持久化和确定性 Canon 校验。两边使用同一
  generator 身份 `agnes/agnes-2.5-flash`。
- 独立 verifier 为 `doubao/deepseek-v4-pro-260425`，只读取当前 fixture 的允许事实、诱饵和某一路生成
  结果，不读取另一条路径结果，也不充当 generator repair。
- 每次真实调用冻结 stage、variant、provider/model、prompt version、input/output hash、trace hash、
  provider usage、估算成本与实际耗时。provider 未返回 usage 时记为证据缺失，不估算补齐。
- 协议失败与 provider 阻断分开：协议失败可以按预注册上限形成新尝试；不可恢复 provider 失败停止，
  不把环境错误计作质量通过。Agent 同一 Run 的恢复只允许一次，重复相同输入/输出指纹由 durable 契约
  停止。
- 机器门要求双方 6/6 生成和 verifier 完成、Agent durable evidence 6/6、语义/事实回归不超过 0.02、
  未来/错世界泄漏为 0、全部调用有 usage，且 Agent p95、token、cost 均不超过旧入口 1.5 倍。机器门
  通过后仍必须完成独立盲评，不能自动开放生产 gate。

H86 评测状态保存在版本化浏览器存储并可导入、验签和导出，不属于用户项目；本单元没有新增
IndexedDB 表、Context Source、可采纳字段或 Canon 写入，因此三注册表不扩张。

## 2. 生产协议收口

- `story-arc-copilot` 的模型响应改为 exact-key 对象 `{"storyArcs":[...]}`；持久化/可编辑候选继续是裸
  数组，避免把传输 envelope 泄漏到正式数据。Markdown fence、额外字段、错误枚举、空字符串和越界
  阶段均 fail closed。
- JSON object transport 由中央 provider capability 单独登记；当前只对已验证的 OpenAI、方舟和 Agnes
  开启，且与 native tool capability 相互独立。旧入口不因此伪装成同一协议。
- `outline.story-arcs-v4` 明确单类型任务的精确数量、故事线顶层四字段、阶段内可选字段位置，以及不得
  改名、扩大能力、改变时间/成本/因果/身份约束。空白可选字符串归一为省略；`null` 或其它非字符串仍
  拒绝。统一 AI 日志不保存成功响应正文，因而不能凭失败文案推断 provider 一定返回了 `null`，本轮没有
  在冻结评测后猜测性放宽 parser。
- H86 importer 继续验证历史 `current-v1/v2/v3` 和当前 v4 prompt binding，使旧归档可以验签，但新运行
  只使用当前 v4。

## 3. 冻结开发轨迹

五份完整 checkpoint 都由仓库 importer 验签，文件权限均为 `0600`。表中 checkpoint hash 是 JSON 内部
canonical hash；file SHA-256 是下载文件字节 hash，二者用途不同。

| 轨迹 | 主要变化 | 旧入口完成 | Agent 完成 | checkpoint hash | file SHA-256 |
|---|---|---:|---:|---|---|
| pre-recovery | 初始严格对照 | 2/6 | 1/6 | `b08c117e61537e7beea191c6d23569db788cd1da6321bbce2b6628276129ba0b` | `84ee726a46029904f4d4e5f8be0cdd31fa40df767e9730555c85d68edc143213` |
| durable-recovery | 同一 Run 一次受控恢复 | 4/6（verifier 3/6） | 3/6 | `6c483a8ed87b36900150e5c93c1eb9ff241bd6987cb8c8095c3edf52fb4e4189` | `30c5decfa78cec64ecbf0e170b85df5b5035c7528563d37f716ea85a242fed05` |
| json-object-v2 | Agent 使用已验证 JSON object transport | 4/6 | 3/6 | `ca803c5cfb1b7ccf287de2703e397615cd8310b918ab93b732d375925ad8847d` | `826a5359666b64433c16d82c3373c0e821bdf3cd23b63b5fd0dffd731df2e839` |
| prompt-v3 | 强化数量、事实和禁编造约束 | 4/6（verifier 3/6） | 3/6 | `2b06068a10c982286a36f28371b9e0f2b3fcb8fd6e26688cd6ce8706d9d21930` | `1525d256f53c51e2c3e67c41651b77209e78db8cb3b6775488bc03bfc685540a` |
| final-v4 | 明确顶层/阶段字段位置 | 2/6 | 2/6 | `497cf39cdf7c4e601943f6000f2ab9c0b85b6d379ca1ed7d9412cb8fcd764c64` | `e4c2fee7ade945c1f55f100110992d66a421156d6a93e1be5c61c0ffa2dd3d36` |

这些是 development 轨迹，不是五个可择优发布的独立样本；最终结论固定使用 v4，不能挑选更好的一轮
冒充发布结果。

## 4. 最终 v4 真实结果

| 指标 | 旧入口 | Agent + Harness | 比例 / 回归 |
|---|---:|---:|---:|
| generation completion | 2/6（33.3%） | 2/6（33.3%） | — |
| strict parser pass | 2/6（33.3%） | 2/6（33.3%） | — |
| verifier completion | 2/6（33.3%） | 2/6（33.3%） | — |
| durable evidence coverage | 不适用 | 2/6（33.3%） | — |
| semantic score（成功结果） | 0.75 | 0.95 | regression 0 |
| causal coherence / specificity | 1.00 / 1.00 | 0.95 / 0.95 | — |
| corpus required-fact coverage | 25.0% | 29.17% | regression 0 |
| future / wrong-world leakage | 0 / 0 | 0 / 0 | — |
| input / output tokens | 7,872 / 10,360 | 21,432 / 48,161 | total 3.817x |
| calls with usage / total calls | 8 / 8 | 18 / 18 | 全部计量 |
| total latency | 172.434 s | 346.003 s | — |
| generation p95 | 61.997 s | 112.775 s | 1.819x |
| estimated cost | USD 0.03350714 | USD 0.15993061 | 4.773x |

最终 checkpoint：
`497cf39cdf7c4e601943f6000f2ab9c0b85b6d379ca1ed7d9412cb8fcd764c64`。

逐例失败只报告 parser/协议分类，不提交完整模型正文：

- 旧入口在 dev-01/03/04/06 生成无效 JSON；dev-02/05 完成并通过 verifier。
- Agent 在 dev-01 三次后仍不是严格 JSON 对象；dev-02/03/04 三次后仍给可选 `turningPoint` 非空字符串
  协议失败；dev-05 一次完成且 verifier 满分；dev-06 三次后完成，semantic 0.9，遗漏必需事实 `f2`。
- 最终两个成功 Agent 输出都没有未来信息或错世界泄漏；但成功子集太小，不能外推为总体质量收益。

机器门为 **FAIL**，失败项为：

`legacy-completion / agent-harness-completion / agent-harness-durable-evidence /
p95-latency-budget / token-budget / cost-budget`。

## 5. 人工盲评状态

H86 已实现 hash 绑定的 A/B 随机映射、四项 1～5 分、偏好、编辑结果、行级修改比例、备注、导出与
聚合；评审界面在完成前不暴露 variant 身份。开始盲评前会重新验证 checkpoint，只有 6 例双方均有成功
输出才允许创建记录。

最终 v4 只有 1 例形成双方成功配对，未达到 6/6；因此人工盲评被 fail closed 阻止，不能用单边输出、
开发者主观判断或伪造评分补齐。`productionReleaseAllowed` 保持 `false`。

## 6. 发布结论

- H86 完成了真实 generator 主路径旧入口与 Agent + Harness 的质量、成本、延迟、协议完成率和 durable
  证据对照；结果不支持启用生产 gate。
- Agent 成功子集的语义和事实覆盖未劣于旧入口，且没有检测到泄漏，但两边完成率均只有 33.3%，Agent
  p95、token 和成本分别为旧入口 1.819x、3.817x 和 4.773x，明显超过预注册预算。
- 本轮不再反复抽样 Agnes 或根据失败样本继续改 prompt。若要重开发布研究，应先冻结新的 generator
  development/终验协议，或选用已证明稳定遵守结构化输出的 generator 身份；旧 v4 artifact 保持只读。
- H85 sealed held-out 与 H86 generator A/B 是不同问题：前者证明 verifier 终验未过，后者证明当前真实
  generator 主路径也未过。两者都不能被 development 中某个局部改善覆盖。

## 7. 本机归档

完整 checkpoint 位于本机 Downloads，不进入仓库：

- `storyforge-h86-pre-recovery-agnes-deepseek-20260815.json`（38,580 bytes）
- `storyforge-h86-durable-recovery-agnes-deepseek-20260815.json`（67,512 bytes）
- `storyforge-h86-json-object-v2-agnes-deepseek-20260815.json`（68,984 bytes）
- `storyforge-h86-prompt-v3-agnes-deepseek-20260815.json`（70,966 bytes）
- `storyforge-h86-final-v4-agnes-deepseek-20260815.json`（50,786 bytes）

## 8. 工程验证

- `R-HARNESS86-story-arc-main-path-eval` 9 项覆盖交叉顺序、真实 legacy/Agent 注入、逐调用 usage、受控
  durable 恢复、provider 阻断、checkpoint 防篡改、历史 prompt 兼容、verifier response-format 能力门、人工
  盲评完整配对门和本地存储。
- `R-HARNESS30-story-arc-agent` 9 项覆盖 JSON object transport、exact envelope、额外字段拒绝、候选数组
  编辑契约、空白可选字段归一和非字符串拒绝。
- H17/H29/H30/H86 联合定向回归 4 个文件、37 项通过；`npx tsc --noEmit`、全仓 lint 与
  `git diff --check` 通过。
- 完整 `npm run ci` 从头通过：AI census 为 13 files / 26 calls、7 governed / 6 auxiliary / 0 migration；
  required tables、AI manual、architecture、source reachability、roadmap、agent context/freshness、Canon、
  metrics、生产依赖审计、lint、TypeScript、coverage、build 和 bundle budget 全绿。全量 coverage 为
  376 files / 1829 tests；statements/lines 82.12%、branches 73.80%、functions 80.45%。
- 生产构建 3,786 modules 通过；bundle budget 为入口 679.8 KiB / gzip 211.0 KiB，最大异步/vendor
  chunk 490.8 KiB / gzip 128.1 KiB。
- 首次完整 Chromium E2E 为 51/52：故事线用例的模拟 provider 仍返回旧裸数组，真实 UI 按新协议正确
  fail closed。fixture 改为 `{"storyArcs":[...]}` 后精确路径 1/1（5.3 秒）通过，随后项目指定 Chromium、
  单 worker、独立浏览器数据整套 52/52 通过；最终工作树复跑耗时 4.6 分钟，没有使用或修改作者当前预览项目。
