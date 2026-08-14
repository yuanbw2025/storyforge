# HARNESS-82 · 真实模型评测证据（2026-08-15）

> 本记录只保存去内容化 aggregate、模型身份、失败边界和 checkpoint hash；不保存 API Key、
> 完整长文、逐例输出或 held-out 标签。模型价格来自 StoryForge 本地估算表，实际账单以服务商为准。

## 1. 评测契约

- 代码基线：`feat/harness-rebuild-20260807`，起始 revision `23c3056`。
- 冻结目录：`h4-synthetic-zh-60-v1`，development 40 例、held-out 20 例。
- 生成来源：`fixture/h4-synthetic-corpus`。这是静态合成长文，不是外部生成模型；生成用量为零。
- 独立 verifier：真实外部文本模型；每轮绑定本文记录的 judge v1/v2/v3，temperature `0`，
  每例最多两次尝试，逐例 checkpoint，reject-overflow。v3 另绑定 JSON object transport。
- 预注册 development 门：40 例完成；high-severity hard precision `>= 90%`、recall `>= 80%`；
  evidence verification `100%`；intent escalation `<= 5%`；clean hard false positive `0`；
  provider 用量不可缺失。
- 本 H4 runner 只证明 verifier 能力。真实生成模型的质量、人工修改量、完成率和相对旧入口净收益
  必须由另一个端到端 generator/verifier 配对证据单元交付，不得拿本记录冒充。

## 2. Doubao 1.5 Pro 32K 文本 · Development

| 项目 | 结果 |
|---|---:|
| verifier | `doubao/doubao-1-5-pro-32k-250115` |
| 状态 | **FAIL**，16 / 40 完成 |
| high-severity hard precision | 80.0% |
| high-severity hard recall | 75.0% |
| evidence verification | 100.0% |
| verifier calls | 18 |
| verifier input | 124,579 tokens |
| verifier output | 3,343 tokens |
| estimated cost | USD 0.0407 |
| accumulated provider latency | 121.0 s |
| checkpoint hash | `920bca992e9bd15ff9c9ba9e6c3e305749b1084697cacd73129619da1012a221` |

终止原因：第 17 例连续两次返回无法唯一定位的事实引文，确定性证据解析以
`ambiguous_evidence` fail-closed；runner 没有继续消耗后续 23 例。当前点估计同时低于
90% precision 与 80% recall 门，不能解锁 held-out，也不能用于启用更宽 fan-out、原生 tool
transport 或自动语义审查。失败不是模型地址、Key、上下文窗口或网络错误：同一文本配置的连接测试
已成功，18 次真实 verifier 调用均取得 provider 用量。

## 3. Agnes 2.5 Flash · Development · judge v1

| 项目 | 结果 |
|---|---:|
| verifier | `agnes/agnes-2.5-flash` |
| 状态 | **FAIL**，2 / 40 完成 |
| high-severity hard precision | 100.0% |
| high-severity hard recall | 100.0% |
| evidence verification | 100.0% |
| verifier calls | 4 |
| verifier input | 27,708 tokens |
| verifier output | 2,272 tokens |
| estimated cost | USD 0.0345 |
| accumulated provider latency | 13.3 s |
| checkpoint hash | `eba09fd9761d7f80306f17c368711dd72693d5fbe5f2032e45e892cbcd05f985` |

终止原因：第 3 例连续两次返回来源中不存在的改写引文，确定性证据解析以
`evidence_not_found` fail-closed。两例点估计不能代表完整质量，也不满足 minimum completed cases。
Doubao 与 Agnes 的首次 development 都在逐字证据协议终止，因此下一迭代只加强通用证据复制/唯一性
要求并升级 judge Prompt 版本；不读取或调整 held-out 标签，不降低发布阈值。

## 4. Agnes 2.5 Flash · Development · judge v2

| 项目 | 结果 |
|---|---:|
| verifier | `agnes/agnes-2.5-flash` |
| 状态 | **FAIL**，13 / 40 完成 |
| high-severity hard precision | 50.0% |
| high-severity hard recall | 46.2% |
| evidence verification | 100.0% |
| verifier calls | 15 |
| verifier input | 105,438 tokens |
| verifier output | 8,229 tokens |
| estimated cost | USD 0.1301 |
| accumulated provider latency | 76.4 s |
| checkpoint hash | `d39ee5129f3569d1f40f4aa4b68b75f28a38521a4483fcc8aafda50233cb5887` |

v2 加强“完整原句、逐字唯一回查、无法回查则不报告”的通用证据协议，已跨过 v1 第 3 例的
`evidence_not_found`，但第 14 例连续两次返回非单一 JSON 对象，以 `invalid_json` fail-closed。
该轮未启用 provider JSON object transport，不能与后续 transport 约束混写成同一 Prompt 版本。

## 5. Agnes 2.5 Flash · Development · judge v3

| 项目 | 结果 |
|---|---:|
| verifier | `agnes/agnes-2.5-flash` |
| 状态 | **FAIL**，14 / 40 完成 |
| high-severity hard precision | 50.0% |
| high-severity hard recall | 50.0% |
| evidence verification | 100.0% |
| verifier calls | 16 |
| verifier input | 112,494 tokens |
| verifier output | 9,090 tokens |
| estimated cost | USD 0.1398 |
| accumulated provider latency | 114.2 s |
| checkpoint hash | `f3ca14ebe5cbb51e6a970aa35f70824ae54146a8b896459434bf410beb22827c` |

v3 为 v2 Prompt 绑定 OpenAI-compatible JSON object transport，前 14 例没有再出现非 JSON 输出；
第 15 例连续两次额外返回协议禁止的 `subtypeLabel`，以 `unknown_field` fail-closed。该轮同时已显示
50% precision / 50% recall，不能把协议终止掩盖成发布通过，也没有依据放宽 exact-key parser。

## 6. Doubao 1.5 Pro 32K 文本 · Development · judge v3

| 项目 | 结果 |
|---|---:|
| verifier | `doubao/doubao-1-5-pro-32k-250115` |
| 状态 | **FAIL**，16 / 40 完成 |
| high-severity hard precision | 61.5% |
| high-severity hard recall | 50.0% |
| evidence verification | 100.0% |
| verifier calls | 18 |
| verifier input | 126,649 tokens |
| verifier output | 3,330 tokens |
| estimated cost | USD 0.0413 |
| accumulated provider latency | 122.2 s |
| checkpoint hash | `18e619f2b26813ba62a6442607dc97d1039d035b222d6dd90f818a595654a3cd` |

JSON object transport 被方舟接受，但第 17 例仍连续两次返回非唯一事实引文，以
`ambiguous_evidence` fail-closed；加强证据 Prompt 没有使其跨过原失败点。当前点估计也明显低于
90% / 80% 门，不再针对 development 单例放宽 exact evidence 协议。

## 7. 发布结论与待完成

- 当前 Agnes 2.5 Flash 与 Doubao 1.5 Pro 文本都不具备 H4 发布 verifier 证据；development 未通过，
  held-out 必须继续锁定。
- 更宽 fan-out、原生 tool transport 与自动语义审查继续默认关闭；不能把连接成功冒充质量通过。
- 后续只有在取得更可靠、与 generator 身份独立的 verifier 后，才从冻结 development 重新开始；
  只有完整 PASS 才运行该 verifier 的 20 例 sealed held-out。
- 对 held-out 进行独立人工复核，保留分歧。
- 另行交付真实 generator + 独立 verifier 的端到端主路径配对 evidence；必须覆盖质量、人工修改量、
  完成率、token、成本、延迟和 p95，并与旧入口比较。

## 8. 工程验证

- H4 report/fixture/runner/browser storage/UI、JSON transport、AI 预设存储与后台任务路由定向回归：
  8 个测试文件、85 项测试通过；`npx tsc --noEmit` 通过。
- `npm run ci` 完整复跑通过：372 个测试文件、1,794 项测试全部通过；required tables、AI manual、
  AI entry registry、architecture、source reachability、roadmap、agent context/freshness、canon coverage、
  project metrics、dependency audit、lint、TypeScript、coverage、production build 与 bundle size 全部通过。
- 第一轮全量 coverage 中一个既有世界发布/导入用例在并发负载下触发 5 秒超时；该用例随后独立连续
  三次通过，完整 CI 从头复跑也通过。这里记录该抖动，不把首次失败隐去。
- `npm run ci:e2e` 在 Playwright 独立端口与隔离浏览器数据中运行，52 / 52 通过（4.6 分钟）；没有
  修改作者当前预览项目。自动化测试使用模拟 provider，真实 provider 结果只来自本文前述受控浏览器运行。
