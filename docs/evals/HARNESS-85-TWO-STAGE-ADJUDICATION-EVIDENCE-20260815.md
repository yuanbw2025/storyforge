# HARNESS-85 · 已验真证据二阶段判类与 Development / Held-out 证据（2026-08-15）

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

## 3. Agnes 发现 + DeepSeek V4 Pro 判类 · Development

方舟账户恢复后，不修改 H85 协议、prompt、fixture、父 checkpoint 或发布阈值，只把第二阶段执行身份换为
独立的 `doubao/deepseek-v4-pro-260425`。完整父 checkpoint hash 仍为
`971a827a789f09a08f015b1e5daf97d1209da31af4c22d0f2849c76f14ade275`。

| 项目 | 结果 |
|---|---:|
| discovery verifier | `agnes/agnes-2.5-flash` · judge v7 |
| subtype adjudicator | `doubao/deepseek-v4-pro-260425` · H85 v1 |
| 状态 | **完成 40 / 40，门禁 PASS** |
| high-severity hard TP / FP / FN | 29 / 3 / 3 |
| precision / recall | 90.6% / 90.6% |
| precision / recall 95% Wilson | 75.8%–96.8% / 75.8%–96.8% |
| evidence verification | 100.0%（34 / 34） |
| intent / clean hard escalation | 0 / 2；0 / 2 |
| discovery calls | 44：44 metered；4 次协议失败已由父 runner 恢复 |
| adjudication calls | 36：36 succeeded / 0 protocol-failed / 0 provider-failed |
| adjudication input / output | 65,580 / 13,074 tokens |
| adjudication estimated cost / latency | USD 0.032088 / 277.979 s |
| total calls | 80：80 metered / 0 unmetered |
| total input / output | 429,065 / 55,533 tokens |
| total estimated cost / latency | USD 0.522950 / 604.646 s |
| checkpoint hash | `d32894c00ddef29612a934988a09fdfa3a410fea3c89929fa4c92821a08553d4` |
| score hash | `569d6b2220e87a936f10d9c1bed089a1973dfff9180472c9e215351c8921d3c5` |

development 的 6 个剩余计分错误不再包含 wrong-subtype：2 个父阶段缺失证据对，3 个父阶段把 medium
保留为 high，1 个父阶段把 high 保留为 medium。H85 只拥有 verdict/subtype，不能篡改父 artifact 的
severity；因此没有据此发明 H86 prompt。完整 development 门通过后，设置页按预注册规则解锁一次 sealed
held-out。

## 4. Sealed Held-out

held-out 第一阶段继续使用 Agnes judge v7，第二阶段继续使用同一 DeepSeek V4 Pro H85 v1；运行完成后只
保存共享 scorer aggregate、模型身份、用量和 hash，不查看逐例 hidden label，也不据此调参。

| 项目 | H4 Agnes 发现 | H85 DeepSeek 判类后 |
|---|---:|---:|
| 状态 | 完成 20 / 20，门禁 FAIL | **完成 20 / 20，门禁 FAIL** |
| TP / FP / FN | 11 / 7 / 5 | 14 / 4 / 2 |
| precision | 61.1% | 77.8% |
| recall | 68.8% | 87.5% |
| evidence verification | 100.0%（19 / 19） | 100.0%（19 / 19） |
| intent hard escalation | 1 / 2 | 1 / 2 |
| clean hard false positive | 0 / 1 | 0 / 1 |
| gate failures | precision、recall、intent | precision、intent |
| calls | 20：全部 metered | 20：19 succeeded / 1 protocol-failed / 0 provider-failed，全部 metered |
| input / output | 165,020 / 13,728 | 总计 201,482 / 20,690 tokens |
| estimated cost / latency | USD 0.206204 / 157.092 s | 总计 USD 0.223707 / 306.707 s |
| checkpoint hash | `e6690dae294d427e6a584624dda4bad0a19cc1c4a407509e2b22ad4bd9a9a091` | `09c1ecc4d0eaf9533bd242128b9ac1f95265568af2fa38cdce8cd52178ceecdc` |
| score hash | `98226a6703697d28b630c89c57f9eda1041a877fedd5e515f74650df0ada938f` | `00455a32efa8693bed9ab7fbbfb7e6dedfb140511e4914ea6d8f72eda8b73b08` |

唯一判类协议失败是 `invalid_value`；该调用有 provider usage，冻结静态 repair 后完成对应 case，没有隐藏
调用或缺失计量。DeepSeek 把 TP 提高 3、FP 减少 3、FN 减少 3，但 precision 仍低于 90%，且没有消除
intent control 的一次 hard escalation，故不能启用生产语义 gate。

## 5. 发布结论

- 同模型 Agnes 历史 development 仍是 FAIL；独立 DeepSeek 判类的 development 是完整 PASS，二者是不同
  执行身份的独立 checkpoint，不能互相覆盖历史结论。
- sealed held-out 已运行且 FAIL：`high-severity-hard-precision + intent-escalation`。因此 fan-out、自动语义
  审查和生产 hard gate 继续关闭，不能用 development PASS 冒充发布通过。
- held-out 已消耗，不得检查逐例标签、针对该集合继续改 prompt 或反复试模型。后续 verifier 研究必须先
  冻结新的 development 数据/协议和独立终验集。
- H4 generator 仍是静态合成 fixture；本证据不等于真实创作 generator 主路径的质量、人工修改量、完成率、
  成本、延迟或 p95 收益。
- 成本是 StoryForge 本地价格表估算；免费资源包可能使实际扣费不同，本记录没有服务商账单回执。

## 6. 本机归档

完整自包含 checkpoint 以 `0600` 保存于本机 Downloads，不进入仓库：

`storyforge-h85-development-agnes-two-stage-20260815.json`（382,527 bytes）

`storyforge-h85-development-agnes-discovery-deepseek-pro-adjudication-20260815.json`（381,665 bytes）

`storyforge-h4-held-out-agnes-discovery-20260815.json`（101,299 bytes）

`storyforge-h85-held-out-agnes-discovery-deepseek-pro-adjudication-20260815.json`（196,256 bytes）

归档重新计算 sealed score 后得到本页相同 aggregate、checkpoint hash 与 score hash。

## 7. 工程验证

- `R-HARNESS85-h4-subtype-adjudication` 10 项通过：模型可见隔离、单独调用账本、零候选零调用、静态
  repair、403 单次终止、429 单次暂停/续跑、旧两次 429 checkpoint 兼容、防篡改、共享 scorer 和浏览器
  自包含存储均有反例。
- `R-HARNESS17-context-compression-eval-ui` 7 项通过；设置页恢复、父 checkpoint 导入、H85 锁定、
  aggregate-only 展示与验签后的只读 JSON 降级导出保持可用。
- 完整 `npm run ci` 通过：375 个测试文件、1818 项测试全部通过；coverage 为 statements 82.09%、
  branches 73.74%、functions 80.38%、lines 82.09%；生产依赖审计 0 漏洞。
- 生产构建 3,779 modules 通过；bundle budget 报告入口 679.7 KiB / gzip 211.0 KiB。
- 完整 `npm run ci:e2e` 使用项目指定 Playwright Chromium、单 worker 和独立浏览器数据，52/52
  通过，耗时 4.7 分钟；没有使用或修改作者当前预览项目。
