# StoryForge 最终形态规约(北极星)

> 这份文档是**重构跑偏的兜底机制**。任务清单告诉你"做什么"、铁律告诉你"怎么做"、本文档告诉你 **"做成什么样"**。
> 每完成一个 Phase,**必须对照本文档逐项核对**;形态不符 → Phase 不算完。
> 创建:2026-06-04 | 维护:与代码同步更新。

---

## 〇、为什么需要"北极星"

如果只有任务清单 + 完成判据,可能出现:
- 每个任务局部判据都过了
- 但累积下来代码依然散乱、模块边界模糊、UX 没精品感

→ 这就是"跑偏"。

北极星 = **完成后这个项目应该长什么样**。
每完成一步就抬头看一眼,确保朝着这个样子走,而不是只低头干活。

---

## 一、代码结构最终态

### 1.1 目录树(职责边界)

完成 Phase 1 后,关键目录应该长这样:

```
src/
├── lib/
│   ├── registry/                    ← 三个注册表(单一事实源,新建)
│   │   ├── project-tables.ts        ← PROJECT_TABLES 注册表 + 派生 API
│   │   ├── field-registry.ts        ← FIELD_REGISTRY 注册表
│   │   ├── adoption-schema.ts       ← AdoptionSchema(集合写回)
│   │   ├── context-sources.ts       ← CONTEXT_SOURCES 注册表
│   │   ├── lifecycle.ts             ← cascadeDeleteProject/Group/migrate 派生 API
│   │   ├── adopt.ts                 ← adopt() 统一写回入口
│   │   ├── assemble-context.ts      ← assembleContext() 统一读取入口
│   │   └── validate.ts              ← 启动期注册表完整性校验
│   ├── safety/                      ← 数据安全红线(新建)
│   │   ├── require-backup-before.ts ← 高危操作前强制备份
│   │   └── sanitize.ts              ← HTML/SVG 清洗
│   ├── ai/
│   │   ├── client.ts                ← AI Provider 统一出口(已存在)
│   │   ├── prompt-seeds.ts          ← Prompt 模板(已存在)
│   │   └── adapters/                ← Prompt 构造适配器(已存在)
│   ├── db/
│   │   └── schema.ts                ← Dexie 表声明(已存在)
│   └── export/                      ← 导出/导入
├── stores/                          ← Zustand stores(已存在)
├── components/                      ← UI 组件(已存在)
├── hooks/                           ← React Hooks(已存在)
└── pages/                           ← 路由页面(已存在)

scripts/
└── generate-ai-manual.ts            ← AI 行为说明书自动生成器(Phase 3)

tests/
├── regression/                      ← 反例测试网(17 条)
│   ├── R-01-delete-group.test.ts
│   ├── R-02-migrate-multiworld.test.ts
│   └── ...
├── lifecycle/                       ← 生命周期测试
├── registry/                        ← 注册表完整性测试
└── integration/                     ← 集成测试(多世界往返等)

docs/
├── MASTER-BLUEPRINT.md              ← 施工权威
├── refactor/                        ← 重构交接包(本文件夹)
│   ├── README.md
│   ├── HANDOFF.md
│   ├── TARGET-STATE.md(本文件)
│   └── PROJECT_TABLES_ALL.md
├── AI-FUNCTIONS-MANUAL.generated.md ← 自动生成(Phase 3)
└── AI-FUNCTIONS-MANUAL.semantic.md  ← 人工语义注解
```

### 1.2 模块依赖方向(单向,禁止反向)

```
┌──────────────────────────────────────┐
│  components/ (UI)                    │
│     ↓ 可依赖                          │
│  hooks/                              │
│     ↓ 可依赖                          │
│  stores/                             │
│     ↓ 可依赖                          │
│  lib/ai/  lib/export/  lib/safety/   │
│     ↓ 可依赖                          │
│  lib/registry/  ← 单一事实源,被所有人用 │
│     ↓ 可依赖                          │
│  lib/db/  lib/types/                 │
└──────────────────────────────────────┘
```

**红线**:
- 🚫 `lib/registry/` **不能** import `components/` / `stores/`(反向依赖)
- 🚫 `components/` **不能** 跳过 `lib/registry/` 直接 import `lib/db/`(必须走注册表)
- 🚫 `lib/db/` 中的 store **不能** 在外部模块中被直接 `db.xxx.add` 调用(必须走 adopt)

### 1.3 命名约定

- 注册表常量:全大写 + 下划线 `PROJECT_TABLES / FIELD_REGISTRY / CONTEXT_SOURCES`
- 派生 API:动词开头 `cascadeDeleteProject / assembleContext / adopt`
- 反例测试:`R-XX-描述.test.ts`(R 表示 Regression)
- 适配器:`xxx-adapter.ts`
- 类型文件:`types/xxx.ts`(每个领域一个文件,不混)

---

## 二、代码质量上限(硬指标)

| 指标 | 上限 | 检查方式 |
|---|---|---|
| 单文件行数 | ≤ 500 | CI lint(超出报警) |
| 单函数圈复杂度 | ≤ 15 | ESLint `complexity` 规则 |
| 测试覆盖率(整体) | ≥ 60% | `vitest --coverage` |
| 测试覆盖率(`lib/registry/`) | ≥ 80% | 关键模块 |
| tsc strict | 零错误 | `npx tsc --noEmit` |
| ESLint | 零警告 | `npm run lint` |
| 主包大小(首屏 gzip) | < 300 KB | `npm run build` 报告 |
| 首屏 FCP | < 2s | Lighthouse |

---

## 三、反模式清单(看到立刻警报)

**5.5 自检 + 审查者审查双重网**。任意一条命中 = **任务不算完**。

### 3.1 数据层反模式
- ❌ 任何文件中出现 `db.xxx.add(` 或 `db.xxx.update(` 直接调用(必须经 `adopt()`)
  - 例外:`adopt.ts` 内部、`lifecycle.ts` 内部、`stores/` 内部 CRUD 函数
- ❌ 任何 `db.transaction([...手写表清单...]` (必须 `transactionTablesFor(operation)` 派生)
- ❌ `where('projectId').equals(id).delete()` 在生命周期操作中出现(必须 `cascadeDeleteProject`)
- ❌ Schema 中带 `worldGroupId` 字段的表未在 `PROJECT_TABLES.worldScoped` 标记

### 3.2 AI 层反模式
- ❌ 面板组件中出现 `buildWorldContext(` / `buildCharacterContext(` 等手挑组合(必须 `assembleContext({need: [...]})`)
- ❌ `ai.start(messages)` 不传 `meta.category`(消耗统计漏)
- ❌ `chat()` 调用不接 `AbortSignal`
- ❌ 任何 prompt 模板声明的变量在 adapter 中未传递
- ❌ AI manual `.semantic.md` 中引用的 moduleKey 不存在于 `PromptModuleKey` 枚举

### 3.3 字段写回反模式
- ❌ AI 输出直接 `store.saveXxx(data)` 而不经 `adopt()` 校验
- ❌ 集合写回(角色/伏笔/词条)无去重 + 无 FK 校验
- ❌ `parseXxxOutput` 返回 raw object 直接写库(没经 `FIELD_REGISTRY` 别名映射)

### 3.4 文档反模式
- ❌ 任何正式文档中出现 `略` / `TODO` / `占位` / `暂时` 等占位词
- ❌ `AI-FUNCTIONS-MANUAL.generated.md` 与代码扫描结果不一致
- ❌ CLAUDE.md / TARGET-STATE.md / MASTER-BLUEPRINT.md 之间冲突

### 3.5 工程反模式
- ❌ commit message 不含完成判据状态 + 验证证据
- ❌ 跳过测试直接 push
- ❌ 直接 push 到 main 分支
- ❌ 任务含糊就"自己脑补"继续做(必须 stop + 开 issue)

### 3.6 用户体验反模式
- ❌ 数据丢失类操作(删项目/删世界组/导入覆盖)无强制备份提示
- ❌ AI 长任务无取消按钮 / 取消按钮只是 UI 假象(底层 fetch 仍跑)
- ❌ 错误信息只显示英文堆栈,不显示用户可读说明
- ❌ 导出文件含未 sanitize 的 HTML 内容

---

## 四、每个 Phase 完成后的可观察现象

不是"勾完判据 checkbox 就行",而是**抬头看代码长什么样、跑起来什么感觉**。

### Phase 0 完成 · 紧急修复阶段

**可观察现象**:
- ✅ 跑 `git grep -n "db.transaction" src/stores/` 查看,所有 transaction 表清单与函数体内访问表一致(暂行手写,Phase 1 后改派生)
- ✅ 手动操作:删一个非主世界 → 浏览器 IndexedDB 查看 → 该 wgId 在 10+ 张 worldScoped 表中无残留
- ✅ 手动操作:单世界项目开多世界 → 大纲面板按主世界过滤 → **全部大纲卷依然可见**(P0-8 修复)
- ✅ 手动操作:多世界项目导出 JSON → 删项目 → 导入 → 所有 worldGroupId 正确归属
- ✅ 手动操作:删项目 → 浏览器 IndexedDB → `importFiles/Logs/Jobs/aiUsageLog` 中无该项目残留
- ✅ 8 个反例测试 R-1~R-8 + R-17 全绿
- ✅ tsc 零错 + build 成功

**形态感受**:
> "我之前以为修了实际无效的几处,现在真的修对了。用户做高危操作不会丢数据了。"

---

### Phase 1 完成 · 三注册表上线

**可观察现象**:
- ✅ `src/lib/registry/` 目录存在,8 个核心文件就位(project-tables/field-registry/adoption-schema/context-sources/lifecycle/adopt/assemble-context/validate)
- ✅ 启动应用,console 中无 `[Registry] validation failed` 报错(注册表完整性校验通过)
- ✅ `git grep -rn "db.transaction\(\[" src/stores/` 应**没有匹配**(手写表清单全部移除)
- ✅ `deleteProject` / `deleteGroup` / `migrateToMultiWorld` 函数体均 ≤ 5 行,核心是一句 `await cascadeDeleteXxx(...)`
- ✅ 灵感反推:AI 吐 `summary` 字段能自动映射到 `worldOrigin`(`FIELD_REGISTRY.aliases` 生效)
- ✅ 在测试项目里**新建一张测试表** + 在 PROJECT_TABLES 加一行 → 删项目时自动级联清理(可现场演示)
- ✅ 32+ AI 生成入口全部经 `assembleContext`(grep 验证)
- ✅ 多世界项目同名两个世界 A/B,assembleContext(worldA) 输出不含 worldB 内容(`R-W-isolation` 测试)
- ✅ 注册表反例测试 R-9~R-15 全绿

**形态感受**:
> "现在我看任何一个 store/面板,它要么调 adopt 要么调 assembleContext,**没人手写表清单或字段映射了**。"

---

### Phase 2 完成 · 多世界 + 上下文贯通

**可观察现象**:
- ✅ `worldRulesProfiles` schema 已变 `++id, projectId, worldGroupId`(DB v27),WorldRulesPanel 多世界下显示世界标签
- ✅ 章节正文生成时,实际发送的 prompt 文本中**包含真实与幻想规则**(在 ChromeDevTools Network 面板抓 AI 请求验证)
- ✅ AIFieldCard 单字段生成:用户写半句"修真世界以灵气为本" → 点 AI 生成 → 输出**基于这半句扩写**而非另起
- ✅ 多世界项目批量正文生成:章节属于"斗破"则读斗破设定,属于"遮天"则读遮天设定(逐章验证)
- ✅ 删除角色:`detailedOutlines.appearingCharacterIds` 中不再含该角色(JSON 数组级联清理生效)
- ✅ 导入多世界项目:可选择目标世界,所有 worldview/characters/outline 写入归属正确
- ✅ 反例测试 R-11~R-16 全绿

**形态感受**:
> "AI 真的读到了用户写的所有内容了,不再'闭着眼写'。多世界真的不串台了。"

---

### Phase 3 完成 · 精品化

**可观察现象**:
- ✅ `scripts/generate-ai-manual.ts` 跑一遍 → `AI-FUNCTIONS-MANUAL.generated.md` 更新 → 与代码 100% 一致
- ✅ CI 配置就位:`.github/workflows/lint.yml` 含注册表 lint / AI manual 同步检查 / 反例测试 / build
- ✅ 测试覆盖率 ≥ 60%(关键模块 ≥ 80%),`vitest --coverage` 报告
- ✅ 主包 gzip < 300KB(`npm run build` 后实测)
- ✅ 重面板(world-map / master-studies / 3D 地图)使用 `React.lazy` 懒加载
- ✅ HTML / EPUB 导出文件经过 DOMPurify 清洗,导入恶意 `<script>` 的章节后导出 → 文件不再含脚本
- ✅ GitHub PAT 默认 session-only(关浏览器即清),用户显式勾选才持久化
- ✅ 所有 AI 调用 100% 传 `meta.category`(`UsageStats` 真的全覆盖)
- ✅ 非流式 `chat()` 接 `AbortSignal`,取消按钮真正取消底层 fetch
- ✅ `README.md` 已重写:中英双语 + 截图 + Demo + 五分钟入门 + 三注册表设计说明
- ✅ `CONTRIBUTING.md` 就位
- ✅ Issue / PR template 就位

**形态感受**:
> "这看起来像一个成熟的开源项目了,不像是某个人写的玩具。文档、测试、CI、性能、安全 都过得去。"

---

## 五、UX 最终形态(用户视角)

### 5.1 用户不再遇到这些坑(对比当前)

| 当前问题 | 重构后 |
|---|---|
| 删项目后浏览器缓存爆 | 删项目 = 真正清干净所有数据 + blob |
| 升级多世界后大纲消失 | 升级保持所有内容可见(自动盖章到主世界) |
| 导出 JSON 再导入,世界归属乱了 | 完全可逆,世界归属精确 |
| AI 生成的章节正文跟我写的设定没关系 | AI 真读到所有上游设定 + 当前字段已写内容 |
| 工作流第一步连输入框都没有 | 每步可输入,AI 带着用户写的内容生成 |
| 100 个角色后状态提取 token 爆炸 | 按需召回,相关角色才进 prompt |
| 取消按钮按了 token 还在烧 | 真取消,不烧 token |
| 删世界组后留一堆游魂数据 | 完整级联清理 |

### 5.2 用户能轻松完成

- 5 分钟从空项目到第一章正文(快速上手流畅)
- 高危操作前自动提示导出备份
- 多世界自由切换 + 同名角色跨世界不冲突
- AI 在已写内容基础上扩写(不另起炉灶)
- 导出 JSON 备份 + 任意时间还原(可逆)
- 自定义提示词模板 + 工作流编排
- 实时看到 AI token 消耗与花费

### 5.3 用户感受到的精品标志

- 任何破坏性操作有清晰确认 + 备份提示
- 错误信息可读(中文 + 可操作建议),不显示英文堆栈
- AI 长任务可随时取消,真正停止
- 界面响应 < 100ms(首屏 < 2s)
- 设置可导出可同步(Gist)
- 项目文档完整可查,新用户有迷茫处都有答案

---

## 六、开源精品项目对标

### 6.1 README.md(完成形态)

```
1. Banner + Badges
2. 项目截图 / 演示视频 / Demo 链接
3. 项目简介(中英双语,1 段话)
4. 核心功能亮点(多世界 / 词条 / 三层记忆 / 一致性检测)
5. 五分钟快速上手(图文)
6. 部署(本地 + Vercel + Docker)
7. 技术架构(三注册表设计简述)
8. 文档导航(指向 MASTER-BLUEPRINT / CONTRIBUTING / etc)
9. License + 鸣谢 + Star History
```

### 6.2 CONTRIBUTING.md

必含:
- 接手者第一周清单(同 CLAUDE.md §0.5)
- 三注册表铁律提醒
- 测试与 CI 要求
- PR 模板
- Commit message 约定

### 6.3 Issue / PR Template

- Bug 报告模板(含必填项:复现步骤、IndexedDB 截图、浏览器版本)
- 功能请求模板
- PR 模板(含强制 checkbox:"已读 CLAUDE.md"、"已过四问"、"已跑测试")

### 6.4 开源项目门面(参考)

可对标项目(规模 + 风格类似):
- [Tiptap](https://github.com/ueberdosis/tiptap)(纯前端编辑器)
- [Excalidraw](https://github.com/excalidraw/excalidraw)(纯前端协作工具)
- [Logseq](https://github.com/logseq/logseq)(纯前端笔记)

要做到的精品感:
- README 一眼能看懂"这是什么 + 为什么用它"
- 一行命令跑起来 + 截图证明
- 文档体系自洽(任何疑问都能在文档找到答案)
- 提 issue 有响应 / 提 PR 有审查
- 社区透明:三注册表设计 = 项目本身的"透明度卖点"

---

## 七、每个 Phase 完成时的「形态检查表」

完成 Phase 时,**逐项核对本表**;任何一项不符 → 这个 Phase 不算完。

### Phase 0 形态检查表

- [ ] `git grep -rn "略\|TODO\|占位" docs/MASTER-BLUEPRINT.md` 无新增(允许复核)
- [ ] 8 个 P0 任务每个有独立 commit(便于回滚)
- [ ] 每个 P0 commit 含验证证据(测试通过截图 / grep 结果 / IndexedDB 截图)
- [ ] 反例测试 R-1~R-8 + R-17 全绿
- [ ] 多世界往返冒烟手动跑一遍通过
- [ ] tsc + build 零错
- [ ] **第三方接手者(另一个 AI 或人)能根据 commit + README 复现这些修复**(可邀请第二审查者实测)

### Phase 1 形态检查表

- [ ] `src/lib/registry/` 目录就位,8 个文件存在
- [ ] `git grep -rn "db.transaction(\[" src/stores/` 应无匹配(全部派生)
- [ ] `git grep -rn "buildWorldContext\|buildCharacterContext" src/components/ src/hooks/` 应无匹配(全部经 assembleContext)
- [ ] `git grep -rn "db\.[a-z]*\.add\(\|db\.[a-z]*\.update\(" src/components/ src/hooks/` 应无匹配(全部经 adopt)
- [ ] 启动应用 console 无注册表校验报错
- [ ] 添加一张测试表演示生命周期自动覆盖
- [ ] 反例测试 R-9~R-15 全绿
- [ ] 三注册表的单元测试覆盖率 ≥ 80%

### Phase 2 形态检查表

- [ ] `worldRulesProfiles` schema 含 `worldGroupId`(DB v27)
- [ ] 章节正文 prompt 实际含 worldRules 文本(实测验证)
- [ ] AIFieldCard 生成基于 currentValue 扩写(实测验证)
- [ ] 多世界批量生成无串台(R-13 测试)
- [ ] 角色删除后 JSON 引用清空(R-7 测试)
- [ ] 反例测试 R-11~R-16 全绿
- [ ] 多世界往返冒烟二次跑通

### Phase 3 形态检查表

- [ ] `npm run gen:ai-manual` 跑通,生成的 manual 与代码 100% 一致
- [ ] `.github/workflows/lint.yml` 含 6 类 CI 检查
- [ ] `npm run test:coverage` 报告 ≥ 60%
- [ ] `npm run build` gzip 主包 < 300KB
- [ ] README + CONTRIBUTING + Issue/PR template 就位
- [ ] HTML/EPUB 导出经 sanitize(注入测试)
- [ ] AI 调用 100% 含 meta.category
- [ ] chat AbortSignal 真取消(实测验证)
- [ ] 自动备份模块在所有 4 个高危操作前生效

---

## 八、跑偏信号(出现立刻停下)

- 🚩 完成了任务但 grep 反例清单 §3 还有命中
- 🚩 commit message 含糊("修了点小问题""优化了一下")
- 🚩 测试覆盖率下降
- 🚩 tsc/ESLint 引入新警告
- 🚩 单文件超过 500 行(必须拆)
- 🚩 注册表新增条目但没写对应测试
- 🚩 出现 `// TODO` / `// FIXME` 未跟踪 issue
- 🚩 PR 描述中出现"暂时这样,后面再统一"

任何一条出现 → **暂停 + 在 ROADMAP 开 issue + 与审查者讨论后再继续**。不允许"先走着看"。

---

## 〆 总结

> 这份文档不告诉你"明天要做什么任务",
> 它告诉你 **"6 周后项目应该长成什么样"**。
>
> 每天写代码前,**先看一眼这个样子**。
> 每天写完代码,**对照这个样子检查一遍**。
>
> 朝着北极星走,不会迷路。
