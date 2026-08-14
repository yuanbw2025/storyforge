# HARNESS-83 · Verifier 确定性纠错与完整 Development 证据（2026-08-15）

> 本记录只保存去内容化 aggregate、协议版本、模型身份、用量和 checkpoint hash；不保存 API Key、
> 完整长文、逐例模型输出或 held-out 标签。模型价格来自 StoryForge 本地估算表，实际账单以服务商为准。

## 1. 纠错协议

- judge v4 继承 v3 的逐字证据、精确字段和 JSON object transport，不降低 exact-key、枚举、来源存在、
  来源内唯一、两证据不同区间或 hidden-label 隔离门槛。
- 当一次尝试被确定性 parser 拒绝时，runner 只把错误码映射成闭集 reason：`json-contract`、
  `exact-schema`、`verbatim-evidence`、`unique-evidence`、`distinct-evidence` 或
  `protocol-contract`。第二次调用只收到该 reason 对应的静态纠错指令。
- 上一轮输出、错误 message、引文、hidden labels 和期望答案都不会进入纠错消息；provider/网络类
  `verifier_error` 不伪装成协议反馈。
- 成功 artifact 显式记录 `h4-long-consistency-repair-v1` reason 或 `null`，`judgeInputHash` 覆盖实际
  纠错消息；checkpoint 校验还要求它与前一 attempt 的失败码一致。修改 reason 后即使重签外层 hash，
  仍无法通过 artifact/checkpoint 验证。
- 冻结 development 仍为 40 例、每例最多两次尝试。H4 generator 仍是静态
  `fixture/h4-synthetic-corpus`，所以本记录只评价 verifier，不是外部生成模型收益。

## 2. Doubao 1.5 Pro 32K 文本 · judge v4

| 项目 | 结果 |
|---|---:|
| verifier | `doubao/doubao-1-5-pro-32k-250115` |
| 状态 | **完成 40 / 40，门禁 FAIL** |
| protocol repair | 3 次；原 v3 固定失败点已越过 |
| high-severity hard TP / FP / FN | 15 / 14 / 17 |
| precision | 51.7%（95% Wilson 34.4%–68.6%） |
| recall | 46.9%（95% Wilson 30.9%–63.6%） |
| evidence verification | 100.0% |
| intent hard escalation | 0 / 2 |
| clean hard false positive | 2 / 2 |
| verifier calls | 43 |
| verifier input / output | 306,437 / 8,430 tokens |
| estimated cost | USD 0.1004 |
| accumulated provider latency | 293.2 s |
| checkpoint hash | `35fd9e1052702b63e571a7ca3436f27780eb20ffe8a7961af7e6ee335d8a9864` |

完整性重算通过。门禁失败项为 `high-severity-hard-precision`、
`high-severity-hard-recall` 和 `clean-hard-false-positive`。协议修复解决了中途终止，但不能把
低质量判断提升为发布证据。

## 3. Agnes 2.5 Flash · judge v4

| 项目 | 结果 |
|---|---:|
| verifier | `agnes/agnes-2.5-flash` |
| 状态 | **完成 40 / 40，门禁 FAIL** |
| protocol repair | 5 次；原 v3 固定失败点已越过 |
| high-severity hard TP / FP / FN | 15 / 18 / 17 |
| precision | 45.5%（95% Wilson 29.8%–62.0%） |
| recall | 46.9%（95% Wilson 30.9%–63.6%） |
| evidence verification | 100.0% |
| intent hard escalation | 0 / 2 |
| clean hard false positive | 0 / 2 |
| verifier calls | 45 |
| verifier input / output | 320,670 / 34,821 tokens |
| estimated cost | USD 0.4251 |
| accumulated provider latency | 395.5 s |
| checkpoint hash | `1b9d9c42dfe53367d021f77f0f0daef8251c6df667e0cc20a214ba07497e8f87` |

完整性重算通过。门禁失败项为 `high-severity-hard-precision` 和
`high-severity-hard-recall`。Agnes 没有 clean control 硬误报，但总体 false positive 更多，仍不具备
发布 verifier 资格。

## 4. 发布结论

- v4 把两款文本模型的 protocol completion 从 16/40、14/40 提升到 40/40，证明闭集纠错链有效；
  两者都只命中 15 / 32 个高严重度硬冲突，且 precision 明显低于 90%，质量门仍失败。
- evidence verification 保持 100%，失败不是放宽引文协议造成；不得用“完整跑完”替代“质量通过”。
- held-out 继续锁定；不得根据 sealed labels 调参。fan-out、自动语义审查和发布默认值继续关闭。
- 两个已验签 checkpoint 以 `0600` 权限保存在本机 Downloads：
  `storyforge-h4-development-doubao-v4-20260815.json` 与
  `storyforge-h4-development-agnes-v4-20260815.json`，不进入仓库。
- 下一步必须更换更可靠且与 generator 身份独立的 verifier，或先冻结并在 development 证明新的
  多模型协议；不能把这两款模型直接用于真实 generator 主路径的发布裁决。

## 5. 工程验证

- 定向回归：5 个文件、31 项测试全部通过，覆盖 v4 artifact/runner、旧版本兼容、设置页失败证据和
  JSON object transport。
- `npm run ci`：373 个测试文件、1798 项测试全部通过；全仓 lint、TypeScript、coverage、生产构建、
  bundle budget、生产依赖审计和全部架构/注册表/文档闸门通过。
- coverage：statements/lines 81.95%、branches 73.73%、functions 79.68%。
- `npm run ci:e2e`：项目指定 Playwright Chromium、单 worker、独立浏览器数据完整运行 52/52 通过，
  耗时 4.6 分钟；未使用或修改作者当前预览项目。
- `git diff --check`：通过。
