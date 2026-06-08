# Phase 1 进度板(三注册表地基)

> Phase 1 = 建立三个单一事实源注册表。这是整个重构的核心。
> 接手者(任何 AI / 人)看这个文件就知道做到哪、下一步是什么。
> **交接规则**:永远从最后一个 commit 接着干,不要从中途工作区。

---

## 总进度

| 子任务 | 状态 | 分支 | 说明 |
|---|---|---|---|
| 1.1a 建 PROJECT_TABLES 注册表 + 派生 API(纯新增) | ✅ Done | `refactor/phase-1-task-1.1a` | 新建 `src/lib/registry/`,登记 45 表;派生 API 单测 10 条通过;现有调用方一行未改 |
| 1.1b 生命周期切换到派生 API + 启动校验 | ✅ Done | `refactor/phase-1-task-1.1b` | deleteProject/deleteGroup/migrate 改派生;main.tsx 接入 validateRegistry;手写表清单全消失;27 测试持续全绿 |
| 1.2a 建 FIELD_REGISTRY + AdoptionSchema + adopt() | ✅ Done | `refactor/phase-1-task-1.2a` | 纯新增写回层;不切现有调用方 |
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

### 2026-06-08 · 1.1a 完成(by Claude)

- 新建 `src/lib/registry/`:
  - `types.ts` — TableSpec / RefSpec(simple/json/array/indirect/blob-owner)/ ExportRemapField
  - `project-tables.ts` — 45 张表全登记(owner / worldScoped / tree / refs / exportRemap),REGISTRY_BY_NAME 索引
  - `lifecycle.ts` — 派生 API:projectScopedTables / worldScopedTables / exportableTables /
    transactionTablesFor / **cascadeDeleteProject** / **cascadeDeleteGroup** / **stampPrimaryWorld**
  - `validate.ts` — checkRegistry / validateRegistry(启动期完整性校验)
- 新建 `tests/registry/project-tables.test.ts`:10 条单测
  - 完整性(45 表双向覆盖)/ 派生选择器 / 三个生命周期 API 行为等价
- 测试中发现并修正 2 个真实约束:
  - projects 根表无 projectId 字段 → 特殊处理(最后 delete)
  - 间接归属父键必须事务前预收集(父表会在事务中被删)
- **关键**:本步纯新增,`src/stores/` 一行未改,现有 deleteProject 等照常工作。

**验证**:tsc=0 / 全套 27 测试通过(17 反例 + 10 注册表)/ build OK / stores 零改动

**下一步(1.1b)**:把 deleteProject/deleteGroup/migrateToMultiWorld 改成调用派生 API,
并在 main.tsx 接入 validateRegistry;反例测试 R-01~R-07 必须持续全绿。

### 2026-06-08 · 1.1b 完成(by Claude)

- `src/stores/project.ts`:deleteProject 删除逻辑 115 行 → `await cascadeDeleteProject(id)` 一行
- `src/stores/world-group.ts`:
  - deleteGroup 手写 70 行 → `await cascadeDeleteGroup(pid, id)`
  - migrateToMultiWorld 手写 stamp → `await stampPrimaryWorld(projectId, primaryId)`
  - 删除 45 行的 PROJECT_TABLES_ALL 手写常量
- `src/main.tsx`:bootstrap 接入 `validateRegistry({ throwOnError: DEV })`
- 切换过程发现并修正 1 处行为差异:
  - 手写 migrate 不盖章任何 codexCategories(分类全局共用)
  - 派生版原本只跳过内置分类 → 改为整表跳过,与手写版一致
- **关键保证**:R-01~R-07 + 注册表单测 27 条持续全绿 = 派生版与手写版行为等价

**验证**:tsc=0 / 27 测试全绿 / build OK / check:required-tables OK
**反模式确认**:`grep "db.transaction('rw', \[" src/stores` 无匹配(手写表清单全消失)

**下一步(1.2a)**:建 FIELD_REGISTRY + AdoptionSchema + adopt() 入口(纯新增)

### 2026-06-08 21:57:04 CST · 1.2a 进行中(by Codex)

- 从 `refactor/phase-1-task-1.1b` 切出 `refactor/phase-1-task-1.2a`。
- 同步 `docs/refactor/REFACTOR-PROGRESS.md`:Phase 0/1.1a/1.1b 状态改为实际完成态,1.2a 改为进行中。
- 扩展 `src/lib/registry/types.ts`:新增 FieldSpec / CollectionAdoptionSpec / AdoptInput / AdoptResult 等写回层类型。
- 新增 `src/lib/registry/field-registry.ts`:登记 worldviews / storyCores / characters / creativeRules / outlineNodes / chapters / detailedOutlines / foreshadows / storyArcs / codexCategories / codexEntries 的可写字段、别名、枚举归一。
- 新增 `src/lib/registry/adoption-schema.ts`:登记集合写回 identity / duplicatePolicy / required / autoStamps / FK / arrayMemberChecks。
- 新增 `src/lib/registry/adopt.ts`:实现统一写回入口,含单例 replace/append、集合 add/add-many/merge-diffs、字段别名归一、类型校验、FK 校验、数组成员过滤、自动盖章、去重写入。
- 扩展 `src/lib/registry/validate.ts`:checkRegistry 同时校验 FIELD_REGISTRY / ADOPTION_SCHEMAS 的 target、字段、required、fk、array member。
- 新增 `tests/registry/adopt.test.ts`:覆盖 registry 完整性、summary→worldOrigin、storyLines→mainPlot、中文 role 归一、重复角色跳过、codex FK fail-safe、数组成员过滤。
- 已通过: `npm test -- tests/registry/adopt.test.ts`。
- 已通过: `npm test -- tests/registry/project-tables.test.ts tests/registry/adopt.test.ts`。
- 已通过: `npx tsc --noEmit`。

### 2026-06-08 21:58:12 CST · 1.2a 完成(by Codex)

- 状态:完成。
- 本步保持 a/b 两步法边界:只新增写回层和测试,未迁移任何现有调用方。
- 验证: `npm test -- tests/registry/adopt.test.ts` 通过(6 tests)。
- 验证: `npm test -- tests/registry/project-tables.test.ts tests/registry/adopt.test.ts` 通过(16 tests)。
- 验证: `npm test` 通过(11 files / 33 tests)。
- 验证: `npm run check:required-tables` 通过(45 tables match schema.ts)。
- 验证: `npx tsc --noEmit` 通过。
- 验证: `npm run build` 通过。Vite 仍输出既有 chunk-size / dynamic-import warning,无构建失败。

**下一步(1.2b)**:把灵感反推 / 多世界扩展 / 导入 chunk-writer / WorkflowRunner / saveXxx 薄壳逐步切到 `adopt()`,每个切换点补反例测试。
