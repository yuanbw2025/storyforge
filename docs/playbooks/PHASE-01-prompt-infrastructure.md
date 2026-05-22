# Phase 1：提示词基础设施 — Playbook

> 由 Opus 4.7 撰写并自执行（Phase 0/1 由 Opus 干）。
> 写于 2026-05-06。

---

## § 1. 元信息

```yaml
phase: 01
title: 提示词基础设施（数据层 + 渲染引擎 + 适配器）
prerequisites: [PHASE-00 完成]
estimated_hours: 4-5
recommended_model: Opus 4.7（自执行）
status: in-progress
```

---

## § 2. 本 Phase 的目标（What）

把硬编码在 `src/lib/ai/prompts/*.ts` 的 6 个 prompt 文件全部下沉到 IndexedDB，
让"提示词"从此变成可编辑的数据，而不是硬代码。

**做完之后**：
- 系统启动时自动 seed 14 条系统级模板到 `promptTemplates` 表
- 6 个 Panel 组件**每个仅改 1 行 import 路径**，行为完全不变
- 用户感知不到任何变化（Phase 2 之后才有 UI 来管理）
- `src/lib/ai/prompts/` 整个目录被删除

**不在本 Phase 范围**：
- 提示词管理 UI（Phase 2）
- Dexie v6 大重建（Phase 3 才动其他表；本 Phase 只新增 `promptTemplates` 一张表）
- 工作流/题材包（v3 §3.7、§3.8 后续 Phase）
- 新增 prompt 模板（worldview.generate / story.generate / rules.generate / detail.scene / import.* — 留给后续 Phase 配套模块开发时随用随加）

---

## § 3. 改动清单

### 新增（9 个文件）

- `src/lib/types/prompt.ts` — PromptTemplate / PromptModuleKey / PromptVariableContext
- `src/lib/ai/prompt-engine.ts` — `renderPrompt()` 模板渲染引擎
- `src/lib/ai/prompt-seeds.ts` — 内置系统模板种子数据（迁自旧 prompts/）
- `src/stores/prompt.ts` — Zustand store（loadAll / getActive / seedIfEmpty / saveTemplate / cloneTemplate / setActive）
- `src/lib/ai/adapters/worldview-adapter.ts`
- `src/lib/ai/adapters/character-adapter.ts`
- `src/lib/ai/adapters/outline-adapter.ts`
- `src/lib/ai/adapters/chapter-adapter.ts`
- `src/lib/ai/adapters/foreshadow-adapter.ts`
- `src/lib/ai/adapters/geography-adapter.ts`

> 每个 adapter 导出与旧 `prompts/<name>.ts` **同名同签名**的 `buildXxxPrompt()` 函数，
> 内部改为读 store + 渲染模板。

### 修改（8 个文件，每个仅 1 行）

- `src/lib/db/schema.ts` — 新增 `promptTemplates` 表（v6）
- `src/lib/types/index.ts` — `export * from './prompt'`
- `src/main.tsx` — 启动时调用 `usePromptStore.getState().init()`
- `src/components/worldview/WorldviewPanel.tsx` — 改 import 路径
- `src/components/character/CharacterPanel.tsx` — 改 import 路径
- `src/components/outline/OutlinePanel.tsx` — 改 import 路径
- `src/components/editor/ChapterEditor.tsx` — 改 import 路径
- `src/components/foreshadow/ForeshadowPanel.tsx` — 改 import 路径
- `src/components/geography/GeographyPanel.tsx` — 改 import 路径

### 删除（1 个目录）

- `src/lib/ai/prompts/`（包含 6 个 .ts 文件）

---

## § 4. 任务步骤（How）

按顺序执行。每步完成跑 `npm run build` 验证。

### 4.1 新建类型 `src/lib/types/prompt.ts`

定义 `PromptTemplate`、`PromptModuleKey`、`PromptVariableContext`。
Phase 1 只用到这 7 个 moduleKey（其余留给后续 Phase 增加）：

```
worldview.dimension
character.generate
character.dimension
outline.volume
outline.chapter
chapter.content
chapter.continue
chapter.polish
chapter.expand
chapter.de-ai
foreshadow.generate
geography.concept-map
geography.image-map-prompt
```

> 注：`geography.image-map-prompt` 返回的是字符串而非 ChatMessage[]，
> 但为了统一管理，仍走模板系统，由 adapter 在外层把消息内容拼成字符串返回。

### 4.2 新建渲染引擎 `src/lib/ai/prompt-engine.ts`

签名：

```ts
export function renderPrompt(
  template: PromptTemplate,
  ctx: PromptVariableContext,
): { messages: ChatMessage[]; modelOverride?: { temperature?: number; maxTokens?: number } }
```

**支持语法**：
- `{{var}}` → 字符串替换；缺失时替换为空串并 `console.warn`
- `{{#if var}}...{{/if}}` → var 真值且非空字符串时保留块内容，否则去掉整个块（不嵌套，按行扫描即可）

### 4.3 新建种子数据 `src/lib/ai/prompt-seeds.ts`

把现有 6 个 `src/lib/ai/prompts/*.ts` 中的 `SYSTEM_PROMPT` 字符串和 user 内容**逐字**搬过来，
转成 14 条 `Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>` 字面量数组。

### 4.4 新建 store `src/stores/prompt.ts`

```ts
interface PromptStore {
  templates: PromptTemplate[]
  loaded: boolean
  init(): Promise<void>             // load + seedIfEmpty
  getActive(key: PromptModuleKey): PromptTemplate
  saveTemplate(t: PromptTemplate): Promise<void>
  cloneTemplate(id: number): Promise<number>
  setActive(id: number): Promise<void>
}
```

**关键约束**：`getActive()` 必须**同步**返回；适配器是同步的。
所以 store 必须在 App 启动时先 `await init()` 完成，再让任何 panel 调用。
为防御未初始化的边角情况，`getActive()` fallback 到 seed 数组里查找。

### 4.5 修改 `src/lib/db/schema.ts`

在 v5 之后追加 v6：

```ts
this.version(6).stores({
  promptTemplates: '++id, scope, moduleKey, isActive, updatedAt',
})
```

并在 class 顶部加 `promptTemplates!: Table<PromptTemplate>`。

### 4.6 修改 `src/lib/types/index.ts`

末尾加：`export * from './prompt'`。

### 4.7 新建 6 个 adapter

每个 adapter 导出与旧 `prompts/<name>.ts` 中的同名函数；签名一字不改。
内部实现：

```ts
export function buildWorldviewPrompt(dimension, projectName, genre, existingContext, userHint?) {
  const tpl = usePromptStore.getState().getActive('worldview.dimension')
  return renderPrompt(tpl, { dimension, projectName, genres: genre, worldContext: existingContext, userHint }).messages
}
```

### 4.8 改 6 个 Panel 的 import（每个 1 行）

把 `from '../../lib/ai/prompts/<name>'` 改为 `from '../../lib/ai/adapters/<name>-adapter'`。

### 4.9 修改 `src/main.tsx`

在 ReactDOM.createRoot 之前 await store init：

```tsx
import { usePromptStore } from './stores/prompt'
await usePromptStore.getState().init()
```

> Vite 顶层 await 在生产构建支持，但需要包成 async IIFE。
> 实际写法：用一个 `async function bootstrap()` 包住整段渲染。

### 4.10 删除 `src/lib/ai/prompts/`

```bash
rm -rf src/lib/ai/prompts/
```

### 4.11 build 验证

```bash
cd storyforge && npm run build
```

要求 0 error。

---

## § 5. 数据模型变更

### 旧 schema（v5）

```
projects, worldviews, storyCores, powerSystems, characters, factions,
outlineNodes, chapters, foreshadows, geographies, histories, itemSystems,
creativeRules, characterRelations, snapshots, references
```

### 新 schema（v6）

新增一张表：

```ts
promptTemplates: '++id, scope, moduleKey, isActive, updatedAt'
```

其他表不动（Phase 3 才大重建）。Dexie 增量升级，**不需要清库**。

---

## § 6. 验收标准（Definition of Done）

- [ ] `npm run build` 输出 "built in" 且无 error
- [ ] 浏览器 console 启动时无红色错误
- [ ] DevTools → Application → IndexedDB → storyforge → `promptTemplates` 表存在且有 14 行数据
- [ ] 所有 14 行 `scope === 'system'` 且 `isActive === true`（同 moduleKey 内）
- [ ] `src/lib/ai/prompts/` 目录已删除
- [ ] `grep -r "from.*ai/prompts/" src/` 输出为空
- [ ] 6 个 panel 的对应功能（世界观生成 / 角色生成 / 大纲生成 / 章节正文 / 续写 / 伏笔）在浏览器手动点一次能正常工作

---

## § 7. AI 全功能巡检

由于改动是底层无感重构，本 Phase 的巡检 = 跑一遍 6 条 AI 链确认行为一致：

1. [ ] 世界观 → 生成"地理环境"维度 → 流式输出正常
2. [ ] 角色 → AI 设计角色 → 流式输出正常
3. [ ] 大纲 → 生成卷大纲 → 流式输出正常
4. [ ] 大纲 → 展开章节大纲 → 流式输出正常
5. [ ] 章节正文编辑器 → AI 生成正文 → 流式输出正常
6. [ ] 编辑器 → 续写 / 润色 / 扩写 / 去 AI 味 4 项操作均正常
7. [ ] 伏笔面板 → AI 建议伏笔 → 流式输出正常

---

## § 8. 故障排查

| 症状 | 可能原因 | 应对 |
|------|---------|------|
| build 报 `Cannot find module './prompt'` | types/index.ts 没加 export | 补上 4.6 |
| 启动后 panel 报 `Cannot read 'systemPrompt' of undefined` | store 未初始化或 seed 没跑 | 检查 main.tsx 是否 await init；检查 seedIfEmpty 逻辑 |
| 14 行 seed 没进 DB | Dexie v6 升级失败 | 浏览器 DevTools → Application → IndexedDB 删 storyforge 后 reload |
| `{{var}}` 没替换 | 变量名拼写不一致 | 对照 prompt-seeds.ts 里的占位符和 adapter 传入的 key |

---

## § 9. 提交规范

```bash
cd /Users/v_yuanbowen01/Desktop/my-website
git add storyforge/
git commit -m "feat(phase-01): 提示词基础设施落地 — promptTemplates v6 + 渲染引擎 + 6 适配器"
git push origin main
```

镜像同步（用户自行处理）：
- 本机未克隆独立 storyforge 镜像（按用户选择 B 方案）
- 本次 push 仅推 `my-website`
- 用户回到原电脑 / 配置好镜像 clone 后再补镜像同步

---

## § 10. 设计要点回顾

1. **适配器模式**：保护 6 个 Panel 调用方零改动（只换 import 路径）
2. **同步 getActive**：靠 App 启动时一次性 await 加载
3. **种子幂等**：仅在表为空时注入；用户编辑过的不被覆盖
4. **Dexie 仅 +1 表**：不动 v3 大重建，那是 Phase 3 的事
5. **modelOverride 暂搁置**：现有调用方不传 temperature/maxTokens，Phase 2 UI 出来再启用
