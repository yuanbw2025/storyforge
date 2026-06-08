# Phase 1 进度板(三注册表地基)

> Phase 1 = 建立三个单一事实源注册表。这是整个重构的核心。
> 接手者(任何 AI / 人)看这个文件就知道做到哪、下一步是什么。
> **交接规则**:永远从最后一个 commit 接着干,不要从中途工作区。

---

## 总进度

| 子任务 | 状态 | 分支 | 说明 |
|---|---|---|---|
| 1.1a 建 PROJECT_TABLES 注册表 + 派生 API(纯新增) | In progress | `refactor/phase-1-task-1.1a` | 新建 `src/lib/registry/`,登记 45 表;不动现有调用方 |
| 1.1b 生命周期切换到派生 API + 启动校验 | Pending | TBD | deleteProject/Group/migrate/export/import 改派生 |
| 1.2a 建 FIELD_REGISTRY + AdoptionSchema + adopt() | Pending | TBD | 纯新增写回层 |
| 1.2b 写回调用方切换到 adopt() | Pending | TBD | 灵感反推/导入/工作流/saveXxx |
| 1.3a 建 CONTEXT_SOURCES + assembleContext() | Pending | TBD | 纯新增读取层 |
| 1.3b 生成入口切换到 assembleContext() | Pending | TBD | 32+ 生成入口,章节正文优先 |

---

## 设计原则(a/b 两步法)

- **a 步 = 纯新增**:建注册表 + 入口函数,**不碰任何现有调用方**。零风险,旧代码照常工作。可独立 commit。
- **b 步 = 切换调用方**:把散落旧写法改成走注册表。逐个切 + 反例测试兜底。

参考:`MASTER-BLUEPRINT.md` §5(三注册表数据结构 + 三个核心 API 完整伪代码)。

---

## 完成判据(对照 TARGET-STATE §七 Phase 1 形态检查表)

- [ ] `src/lib/registry/` 目录就位,核心文件存在
- [ ] 启动应用 console 无注册表校验报错
- [ ] `git grep -rn "db.transaction(\[" src/stores/` 无匹配(手写表清单全消失)
- [ ] `git grep -rn "buildWorldContext|buildCharacterContext" src/components/ src/hooks/` 无匹配
- [ ] `git grep -rn "db\.[a-z]*\.add\(|db\.[a-z]*\.update\(" src/components/ src/hooks/` 无匹配
- [ ] 添加一张测试表演示生命周期自动覆盖
- [ ] 反例测试 R-01~R-07 + R-17 持续全绿(回归保护)
- [ ] 三注册表单元测试覆盖率 ≥ 80%

---

## 执行日志

### 2026-06-08 · Phase 1 启动(by Claude 接手者)

- 从 `refactor/phase-0-task-0.8`(Phase 0 完成态)切出 `refactor/phase-1-task-1.1a`
- 提交 §5 伪代码文档基线(MASTER-BLUEPRINT §5 三 API 实现伪代码 + HANDOFF FAQ + PROJECT_TABLES_ALL 精修)
- 建本进度板
- 下一步:写 `src/lib/registry/project-tables.ts`(45 表元信息登记,纯新增)
