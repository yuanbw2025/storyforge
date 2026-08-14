# HARNESS-84 · Verifier 分类校准与负面 Development 证据（2026-08-15）

> 本记录只保存 aggregate、协议版本、模型身份、用量和 checkpoint hash；不保存 API Key、完整长文、
> 逐例模型输出或 held-out 标签。模型价格来自 StoryForge 本地估算表，实际账单以服务商为准。

## 1. Development 误差分解

对 H83 两份完整 v4 checkpoint 只读重算后发现，主要损失不是完全漏检，而是相邻 subtype 错分：

| 指标 | Doubao v4 | Agnes v4 | 两者关系 |
|---|---:|---:|---:|
| 32 个 high hard 中证据对命中 | 25 | 30 | 并集 31 / 32 |
| 证据对与 subtype 同时正确 | 15 | 15 | 交集 11 / 32 |
| 仅该模型正确 | 4 | 4 | oracle 并集也只有 19 / 32 exact |

典型错分包括 `simultaneity → absolute-time`、`causeless-effect → causal-logic/core-rules`、
`skill-fluctuation ↔ forgotten-ability` 与 `social-norms → core-rules`。这证明简单投票会把 exact recall
降到 34.4%，不能作为可靠 verifier；但把证据发现与 subtype 判定解耦具有继续验证价值。

## 2. 冻结协议演进

- judge v5 为 19 个 subtype 增加通用中文 `operationalDefinitionZh` 与 `decisionBoundaryZh`。v1～v4
  的 taxonomy payload 和实际消息保持不变，旧 artifact/checkpoint 仍可验。
- judge v6 明确最多 8 条最高置信 issue，clean case 必须返回 exact 空根对象；artifact/parser 同时
  执行 8 项上限，避免长输出截断或为了覆盖 taxonomy 凑数。
- judge v7 在定向 repair 后追加静态全约束复核清单，防止修复 `missing_field` 时重新引入
  `ambiguous_evidence`。清单不含上一轮输出、错误 message、引文、hidden labels 或期望答案。
- 每例最多三次尝试，但只有前一错误映射出的 repair 输入与上一轮不同才继续；相同 repair reason
  不再产生第三个同输入调用。HTTP 4xx 中除 408/409/425/429 外均标记
  `verifier_error_non_retryable` 并在一次调用后停止，不能用重复 403 冒充恢复。

## 3. Agnes 2.5 Flash · judge v7

| 项目 | 结果 |
|---|---:|
| verifier | `agnes/agnes-2.5-flash` |
| 状态 | **完成 40 / 40，门禁 FAIL** |
| high-severity hard TP / FP / FN | 21 / 13 / 11 |
| precision | 61.8%（95% Wilson 45.0%–76.1%） |
| recall | 65.6%（95% Wilson 48.3%–79.6%） |
| evidence verification | 100.0%（36 / 36） |
| intent hard escalation | 0 / 2 |
| clean hard false positive | 0 / 2 |
| verifier calls / failed attempts | 44 / 4 |
| verifier input / output | 363,485 / 42,459 tokens |
| estimated cost | USD 0.4909 |
| accumulated provider latency | 326.7 s |
| checkpoint hash | `971a827a789f09a08f015b1e5daf97d1209da31af4c22d0f2849c76f14ade275` |
| score hash | `6879c4a6fee83042a48826fbbea1b2604181cb76fd4b3b9a1287b450096dc451` |

完整性与 sealed score 重算通过。v7 相比 v4 提升了 exact precision/recall，也保持 clean 与作者意图
控制为零误升级，但仍明显低于 90% / 80% 发布门。对 v7 再做证据级分解：32 个 high hard 中找到
正确证据对 29 个，8 个随后被错分 subtype，说明下一实验应只对已验真的候选证据做独立定向分类，
而不是继续堆叠单轮长上下文提示词。

## 4. 中间失败与 Doubao 外部阻断

- Agnes v5 两次运行分别在 35/40 与 38/40 停止；v6 在 16/40 停止。三份失败 checkpoint 均以
  `0600` 归档，用于证明分阶段修复的必要性，不作为质量分数。
- Doubao v7 在第一个 fixture 前返回 `403 AccountOverdueError`。修复前旧 runner 重复了三次无用调用；
  当前 runner 已实测只调用一次，记录 1 次 unmetered failure、0 token、0 cost 后终止。该阻断是方舟
  账户余额状态，不是 API Key 格式、Base URL 或文本模型名错误。
- 当前完整/失败证据保存在本机 Downloads，不进入仓库：
  `storyforge-h4-development-agnes-v7-20260815.json`、
  `storyforge-h4-development-agnes-v5-incomplete-20260815.json`、
  `storyforge-h4-development-agnes-v5b-incomplete-20260815.json`、
  `storyforge-h4-development-agnes-v6-incomplete-20260815.json`、
  `storyforge-h4-development-doubao-v7-billing-terminal-20260815.json`。

## 5. 发布结论

- Agnes development 未过门，Doubao 又被真实账户状态阻断，因此 **held-out 未运行且继续锁定**。
- 不启用 fan-out、自动语义审查或真实 generator 发布裁决；不把 40/40 protocol completion 冒充质量通过。
- 下一单元若实现“候选证据 → 独立定向 subtype adjudication”，必须把每个真实模型调用、阶段输入/
  输出 hash、身份、token、成本和延迟写入 artifact/checkpoint；不得把两次调用伪装成一次 attempt。

## 6. 工程验证

- 定向 report/runner/UI/transport 回归：7 个文件、42 项测试全部通过。
- `npx tsc --noEmit` 与改动范围 ESLint：通过。
- 完整 `npm run ci`：通过；374 个测试文件、1805 项测试全部通过，覆盖率为
  statements 81.95%、branches 73.73%、functions 79.68%、lines 81.95%。
- 生产构建与 bundle budget：通过；3776 个模块，入口约 679.5 KiB、gzip 约 210.9 KiB，
  生产依赖审计 0 漏洞。
- 完整 `npm run ci:e2e`：项目指定 Playwright Chromium、单 worker、独立浏览器数据
  52/52 通过，耗时 4.6 分钟；没有使用或修改作者当前预览项目。
