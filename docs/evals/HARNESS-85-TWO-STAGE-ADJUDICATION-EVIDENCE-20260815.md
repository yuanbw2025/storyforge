# HARNESS-85 · 已验真证据二阶段判类与 Development 证据（2026-08-15）

> 本记录只保存 aggregate、冻结协议、模型身份、用量和 hash；不保存 API Key、完整长文、逐例模型
> 输出或 held-out 标签。模型价格来自 StoryForge 本地估算表，实际账单以服务商为准。

## 1. 冻结边界

- 第一阶段直接复用已完成且验签通过的 Agnes judge v7 checkpoint，不重新发现证据，也不修改父
  artifact。第二阶段模型只看到确定性 `candidateId`、已逐字验证的两段 quote/sourceId 与 19 subtype
  taxonomy；看不到第一阶段 subtype、issue id、summary、severity、intent、hidden label 或完整来源。
- `h4-long-consistency-subtype-adjudication-v1` 要求逐候选 exact-key 输出
  `candidateId / verdict / subtype / reason`。`not-conflict` 必须使用 `subtype:null`；最终 issue 只保留父
  artifact 的已验真证据对，并采用第二阶段 verdict/subtype。
- H85 checkpoint 内嵌完整父 checkpoint，逐调用记录 stage、模型身份、trace/input/output hash、token、
  成本和延迟；零候选 case 以零调用完成。外层 hash、父 hash、candidate set、逐调用账本、实际 messages
  与 derived issue set 可重新验证，重签篡改仍被拒绝。
- 协议失败最多两次，第二次只追加静态纠错，不回显旧输出。非重试型 4xx 一次终止；429/瞬时 provider
  失败一次后进入 `provider-blocked`，只在作者明确继续时新增调用，不消耗协议修复次数。现场旧版
  `failed + adjudicator_error + AI API Error (429)` checkpoint 保持可验并可继续。
- 设置页可恢复 H4 父 checkpoint，独立展示 H85 development/held-out、两阶段用量和父子 hash，并提供
  下载、复制和只读 JSON 降级导出。H85 development 未通过时 held-out 保持锁定。

该评测状态不属于用户项目，不新增 IndexedDB 表、Canon 写入、Context Source 或可采纳字段；因此三注册表
均不扩展。

## 2. Agnes 2.5 Flash · 二阶段 Development

父 checkpoint 是 HARNESS-84 的完整 Agnes judge v7 结果：
`971a827a789f09a08f015b1e5daf97d1209da31af4c22d0f2849c76f14ade275`。

| 项目 | 结果 |
|---|---:|
| discovery verifier | `agnes/agnes-2.5-flash` · judge v7 |
| subtype adjudicator | `agnes/agnes-2.5-flash` · `h4-long-consistency-subtype-adjudication-v1` |
| 状态 | **完成 40 / 40，门禁 FAIL** |
| high-severity hard TP / FP / FN | 26 / 7 / 6 |
| precision | 78.8%（95% Wilson 62.2%–89.3%） |
| recall | 81.3%（95% Wilson 64.7%–91.1%） |
| evidence verification | 100.0%（35 / 35） |
| intent hard escalation | 0 / 2 |
| clean hard false positive | 0 / 2 |
| discovery calls / failed attempts | 44 / 4 |
| adjudication calls | 38：36 succeeded / 0 protocol-failed / 2 provider-failed |
| adjudication input / output | 73,528 / 12,106 tokens |
| adjudication estimated cost / latency | USD 0.109846 / 98.801 s |
| total calls | 82：80 metered / 2 unmetered |
| total input / output | 437,013 / 54,565 tokens |
| total estimated cost / latency | USD 0.600708 / 425.468 s |
| checkpoint hash | `7c8dcd50dcb2a99ae9d5262bc4c1ebd9631afe744629f93cf677065e870b7ffc` |
| score hash | `a3039362033928ace4007d7fb597545966ec58a98c6c553f044e60ac5234433b` |

相对父 judge v7，TP 增加 5、FP 减少 6、FN 减少 5；precision 提升 17.0 个百分点，recall 提升
15.7 个百分点。recall 已超过预注册 80% 点门，但 precision 仍低于 90%。运行中同一 fixture 曾在旧逻辑下
连续收到两次 Agnes 免费额度 429；两次调用没有 provider usage 回执，故 sealed gate 另以
`usage-evidence-missing` 阻断。修复后的 runner 在真实旧 checkpoint 上从 20/40、22 次调用继续到 40/40，
没有重跑前 20 例；新的 429 回归证明首次阻断只产生一次调用。

## 3. 发布结论

- development gate 失败项是 `high-severity-hard-precision` 与 `usage-evidence-missing`。完成 40/40、
  recall 过点门或相比 H84 提升都不能替代完整 PASS。
- **没有运行 H85 held-out**，也不启用 fan-out、自动语义审查或生产 hard gate。
- Doubao 当前配置是纯文本模型 `doubao-1-5-pro-32k-250115`；H84 的真实方舟
  `403 AccountOverdueError` 尚未解除，因此本单元没有重复制造 H85 Doubao 欠费调用。
- 上述欠费结论只描述 H85 运行时状态。其后账户恢复正常，方舟 DeepSeek V4 Flash/Pro 最小连接均
  成功；这项后续连接证据单独记录在 `ARK-DEEPSEEK-CONNECTION-EVIDENCE-20260815.md`，尚未产生新的
  H4 checkpoint、usage 或质量门结果，不能回写 H85 的历史结论。
- 下一实验若继续提高 precision，只能在 development 上针对 false-positive / wrong-subtype 判定边界做新的
  冻结协议并重新跑完整门；不得查看或运行 held-out 来调参。

## 4. 本机归档

完整自包含 checkpoint 以 `0600` 保存于本机 Downloads，不进入仓库：

`storyforge-h85-development-agnes-two-stage-20260815.json`（382,527 bytes）

归档重新计算 sealed score 后得到本页相同 aggregate、checkpoint hash 与 score hash。

## 5. 工程验证

- `R-HARNESS85-h4-subtype-adjudication` 10 项通过：模型可见隔离、单独调用账本、零候选零调用、静态
  repair、403 单次终止、429 单次暂停/续跑、旧两次 429 checkpoint 兼容、防篡改、共享 scorer 和浏览器
  自包含存储均有反例。
- `R-HARNESS17-context-compression-eval-ui` 7 项通过；设置页恢复、父 checkpoint 导入、H85 锁定、
  aggregate-only 展示与验签后的只读 JSON 降级导出保持可用。
- 完整 `npm run ci` 通过：375 个测试文件、1816 项测试全部通过；coverage 为 statements 81.95%、
  branches 73.73%、functions 79.68%、lines 81.95%；生产依赖审计 0 漏洞。
- 生产构建 3,779 modules 通过；bundle budget 报告入口约 679.5 KiB / gzip 210.9 KiB。
- 完整 `npm run ci:e2e` 使用项目指定 Playwright Chromium、单 worker 和独立浏览器数据，52/52
  通过，耗时 4.6 分钟；没有使用或修改作者当前预览项目。
