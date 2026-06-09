# 协作契约(给实施者 5.5 / 审查者 / 项目作者)

> 本文档定义实施者与审查者的协作规则。任何一方违反 = 任务不算完。
> 创建:2026-06-04

---

## 一、角色与责任

| 角色 | 默认人选 | 责任 |
|---|---|---|
| **项目作者** | 你 | 最终拍板者 + main 分支合并者 + 数据安全决策者 |
| **实施者** | GPT 5.5 | 按 MASTER-BLUEPRINT 任务清单写代码 + 自测 |
| **审查者** | Claude(或另一独立 AI) | 审查实施者的产出 + 对照判据 + 对照 TARGET-STATE 北极星 |

**关键原则:实施者和审查者必须是不同的 AI**(责任分离,避免自审过松)。

---

## 二、分支策略

### 2.1 分支命名

```
main                              ← 生产分支(Vercel 自动部署,实施者绝不直接推)
refactor/phase-0-task-0.1         ← Phase 0 任务 0.1
refactor/phase-0-task-0.2
...
refactor/phase-1-registry-tables  ← Phase 1 大任务可用描述性后缀
hotfix/issue-XX                   ← 紧急修复(若 Phase 期间发现新 P0)
```

### 2.2 分支生命周期

```
1. 实施者从最新 main 创建分支 refactor/phase-X-task-Y
2. 实施者完成任务 + 自测 + commit + push
3. 实施者通知审查者(开 PR 或 @ 审查者)
4. 审查者按 §四 审查
5. 审查通过 → 项目作者执行合并到 main
6. main 自动部署 → 观察 1-2 天(P0 阶段)
7. 进入下一个任务
```

**红线**:实施者不允许 `git push origin main`,只能推自己的分支。

---

## 三、实施者交付物格式

### 3.1 每个任务完成后必须提供:

```markdown
# Task Y - <任务标题>(对应 MASTER-BLUEPRINT §4.X.Y)

## 改动文件清单
- src/xxx.ts (+15 -3)
- src/yyy.ts (+20 -0)
- tests/regression/R-XX-...test.ts (+50 -0,新建)

## 完成判据状态(对照 MASTER-BLUEPRINT §4.X.Y 完成判据)
- [x] 判据 1:...
- [x] 判据 2:...
- [x] 判据 3:...

## 验证证据
- `npx tsc --noEmit` 输出:零错(粘贴最后几行)
- `npm run build` 输出:成功(粘贴最后几行)
- `npm test -- R-XX` 输出:1 passed(粘贴 vitest 报告)
- 手动验证(若有):"删一个非主世界 → IndexedDB 检查 → wgId 无残留" 截图或描述

## 形态自检(对照 TARGET-STATE §三 反模式)
- [x] 无 db.transaction([...手写表清单...]) 引入
- [x] 无 db.xxx.add/update 直接调用引入
- [x] 无 buildXxxContext 手挑组合引入
- [x] 文档无 略/TODO/占位 占位词
- [x] commit message 含完成判据 + 验证证据

## 已知问题 / 卡点(如有)
- 无 / 描述具体卡点
```

**3.2 commit message 格式**

```
<type>(<scope>): <subject>

Task: Phase X.Y (MASTER-BLUEPRINT §4.X.Y)
Completion criteria: [x] 1 [x] 2 [x] 3
Verification: tsc ok / build ok / R-XX passed
Body 描述具体改动与原因

Co-Authored-By: <实施者标识>
```

例:
```
fix(world-group): 修复 deleteGroup 事务声明缺失(Task 0.1)

Task: Phase 0.1 (MASTER-BLUEPRINT §4.0.1)
Completion criteria: [x] tsc 零错 [x] R-1 多世界删除冒烟通过 [x] IndexedDB 验证无残留
Verification: tsc ok / build ok / R-1 passed (1.2s)

把 deleteGroup 的 db.transaction 表清单补齐 historicalTimelineEvents/
historicalKeywords/codexEntries/codexCategories 四张表;
Dexie 事务作用域现已与函数体内访问的表完全一致。

Co-Authored-By: GPT-5.5
```

### 3.3 不接受的交付

- ❌ 改动跨多个 Phase(每次 PR 只解决一个任务)
- ❌ commit message 含糊("修了点东西" / "优化了一下")
- ❌ 测试不跑就 push
- ❌ 任务清单只完成一半就申请审查(必须全部完成)
- ❌ "我觉得这个应该没问题"(必须有证据)

---

## 四、审查者审查清单

审查者收到 PR / 完成通知后,**依次跑下面 7 步**:

### Step 1 · 看 git diff 是否在范围内
```bash
git diff main..refactor/phase-X-task-Y --stat
```
- ✅ 改动文件与任务"位置"声明一致
- ❌ 多改了无关文件 → 打回:"为什么改了 xxx?"

### Step 2 · tsc + build 硬验证
```bash
git fetch && git checkout refactor/phase-X-task-Y
npm install
npx tsc --noEmit && echo "TSC OK"
npm run build && echo "BUILD OK"
```
任意一步失败 → 直接打回。

### Step 3 · 跑该任务对应反例测试
```bash
npm test -- R-XX
```
- ✅ 该测试 + 之前所有绿色测试都过
- ❌ 引入新的红色 → 打回

### Step 4 · 反模式 grep 自检(对照 TARGET-STATE §三)
```bash
# 示例:Phase 1 完成后
git grep -rn "db.transaction\(\[" src/stores/  # 应无匹配
git grep -rn "buildWorldContext\|buildCharacterContext" src/components/ src/hooks/  # 应无匹配
git grep -rn "\b略\b\|TODO\|占位\|暂时" docs/MASTER-BLUEPRINT.md docs/refactor/  # 应无匹配
```
任意命中 → 打回。

### Step 5 · 灾难场景反推
对照该任务的"💥 灾难场景还原"(MASTER-BLUEPRINT §4 中),手动跑一遍:
- 这个 bug 现在还可能发生吗?
- 边缘场景(空项目 / 大数据量 / 多世界)是否覆盖?

### Step 6 · 对照 TARGET-STATE 形态检查表
打开 TARGET-STATE.md §七,找到对应 Phase 的"形态检查表",逐项核对。

### Step 7 · 输出审查结论

格式:
```markdown
# Review of Phase X.Y (commit abc1234)

## 结论
✅ 通过,可合并 / ❌ 打回,需修复

## 验证证据
- tsc: ok
- build: ok
- R-XX test: passed
- 反模式 grep: 无命中
- 灾难场景反推: 已覆盖

## 问题(如有)
1. xxx
2. xxx

## 建议(可选)
- xxx
```

---

## 五、卡点处理(实施者遇到含糊时)

### 5.1 立刻停下的信号(同 CLAUDE.md §🛑)

- 任务描述含糊(出现"略 / 暂时 / 大概")
- 不确定操作是否会丢用户数据
- tsc 错误超过 30 分钟未解
- 反例测试持续失败
- 文档与代码冲突
- 想"先这样吧"

### 5.2 处理流程

```
1. 立刻 STOP,不要"自己脑补"继续做
2. 在 GitHub Issue 开新 issue,标题:[Phase X.Y] 卡点:<简述>
3. issue body 含:
   - 任务上下文
   - 卡点具体描述
   - 你尝试过的方案
   - 需要决策的具体问题
4. @ 项目作者 + @ 审查者
5. 等待决策,期间不要继续相关代码
6. 决策给出 → 按决策继续 → 在 PR 引用该 issue
```

### 5.3 不允许的做法

- ❌ 跳过含糊部分,继续做后面任务(欠债会越滚越大)
- ❌ 自己猜一个方案就做,不告知任何人
- ❌ 把含糊任务标记为 "DONE"(假完成)

---

## 六、审查者打回时实施者的处理

收到打回结论:

```
1. 阅读打回原因,不要立刻反驳
2. 如果你认为打回理由不成立 → 在 PR 评论中说明你的依据
3. 如果打回成立 → 修改 + 推送新 commit 到同一分支(不要开新分支)
4. 修复完通知审查者重审
5. 重审依然不过 → 升级到项目作者决策
```

**红线**:不允许在不解决打回问题的情况下"硬合并"。

---

## 七、Phase 完成的庆祝与下一步

每个 Phase 完成时:

1. 实施者写一份 `docs/refactor/PHASE-X-COMPLETION.md`(简短),含:
   - 该 Phase 改动汇总
   - 反例测试通过列表
   - TARGET-STATE 形态检查表勾选
   - 已知遗留(如有)
2. 项目作者审定签字
3. 打 git tag `phase-X-complete`(便于后续回滚)
4. 在群里通告用户:"Phase X 已完成,主要改进 ..."
5. 观察 2-3 天用户反馈 → 启动下一个 Phase

---

## 八、紧急情况(用户报告生产环境 bug)

如果重构期间 main 上有用户报告新 bug:

1. **暂停当前 refactor 分支工作**
2. 从 main 开 `hotfix/issue-XX` 分支
3. 实施者改完 → 审查者快速审 → 合并 main
4. **回到 refactor 分支:`git rebase main`** 让重构分支保持最新
5. 继续 refactor

**绝不允许**:在 refactor 分支上偷偷修生产 bug 一起推。

---

## 九、协作中的礼仪

- 实施者:不臆测审查者意图,有问题直接问
- 审查者:不"摆架子",指出具体问题 + 给修复建议
- 项目作者:不绕开审查者直接合并(除非紧急)
- 任何 AI:遇到自己不确定的 → 老实说"不确定",不假装懂

---

## 十、本契约的修改

任何修改本契约需要项目作者书面同意(在群里 / issue 中明确表态)。

实施者或审查者认为契约不合理 → 开 issue 讨论 → 项目作者决策。

---

## 附录 A · 常见疑问(FAQ)

### A1. 自动备份模块为什么只集成到 3 个高危操作,不是 4 个?

`require-backup-before.ts` 当前集成到:
- `deleteProject`(删项目)
- `deleteGroup`(删世界组)
- `migrateToMultiWorld`(启用多世界)

**未集成 `importProjectJSON`**,理由:当前 `importProjectJSON` 行为是 **"新建项目"**(把 ExportData 转成新项目),不会覆盖任何现有数据,**没有数据破坏风险**。

**Phase 0.5 修改导入逻辑时**(把它包进事务 + FK fail-fast),如果**新增"覆盖目标项目"功能**,届时必须集成 `requireBackupBefore`。在 Phase 0.5 任务交付物里**明确登记此项**。

### A2. 反例测试只有 R-01 一条,R-02~R-17 在哪里?

R-01 是**完整样板**(含 `beforeEach` 清库 / `it.skip` 标记 / 准备数据 / 断言模式)。

**实施者(5.5)按 R-01 模板自己写后续测试**:
- 修 Phase 0.X 任务时,**同步写对应的 R-0X 测试**
- 不要等审查者写,这是你的交付物的一部分
- 测试代码 ≤ 100 行,模式参考 R-01,不需要发明轮子

每个 P0 任务的"完成判据"都含对应反例测试,见 MASTER-BLUEPRINT §4.0.X。

### A3. MASTER-BLUEPRINT §5 三注册表的"工具函数"留给我自己写,会不会跑偏?

不会。`§5` 三个核心 API(`cascadeDeleteProject` / `adopt` / `assembleContext`)的**伪代码已经把核心难点(事务作用域、拓扑序、间接归属、Blob owner、别名映射、FK 校验、真裁剪、多世界解析)全部点透**。

留给你自由实现的辅助函数(`topoSort` / `removeJsonRef` / `validateAndCoerce` / `normalizeAndValidate` / `findExisting` / `mergeByStrategy` / `getCurrentFieldValue` / `resolveNodeWorldGroupId` / `estimateTokens`)都是 **< 30 行纯函数**,不会跑偏。

如果你写的某个工具函数超过 30 行,**停下来思考是否模式不对**,开 issue 与审查者讨论。

### A4. 任务描述里出现"暂行步骤 / 暂时硬编码"怎么办?

Phase 0 部分任务(如 0.1 `deleteGroup`)的改法包含"暂行步骤"(暂时手写 45 张表名,Phase 1 后改派生)。**这是已经规划好的过渡方案,不是含糊任务**。

执行规则:
- 严格按"暂行步骤"写
- Phase 1 启动时把暂行代码改成派生(届时由审查者明确告知)
- **不要自作主张提前改成派生**(违反 Phase 串行原则)

### A5. 我跑测试发现一个新 bug,但不在 P0/P1 清单里,怎么办?

不要立刻动手。

1. 在 GitHub Issue 开新 issue,标题 `[New bug] xxx`
2. 描述:复现步骤 / 影响范围 / 你的初步分析
3. @ 审查者 + 项目作者
4. 等决策:
   - 严重度 P0 → 紧急修(hotfix 分支),完成后继续 Phase
   - 严重度 P1/P2 → 加入 ROADMAP,Phase X 完成后处理
   - 误报 → 关 issue 继续 Phase
