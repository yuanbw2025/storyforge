# Playbook 标准模板

> 本文档是所有 Phase Playbook 的标准模板。
> 每个 Phase 的 Playbook 必须严格按此模板的 9 个段落组织。
> 目的：让 Sonnet 4.6 / Gemini 3 Pro 等模型能"零理解负担"照做。

---

## 文件命名

`PHASE-XX-<kebab-case-名>.md`，示例：`PHASE-03-data-model-rebuild.md`

---

## 必备 9 段落

### § 1. 元信息

```yaml
phase: XX
title: ...
prerequisites: [PHASE-YY 完成]
estimated_hours: N
recommended_model: Sonnet 4.6 / Gemini 3 Pro / 任意
status: not-started | in-progress | done | blocked
```

### § 2. 本 Phase 的目标（What）

用 3-5 句话讲清楚：
- 做完这个 Phase 之后系统会有什么变化
- 用户能看到什么新东西/不再看到什么
- **不在本 Phase 范围**的事情要明确列出

### § 3. 改动清单（具体到文件）

按"新增 / 修改 / 删除"三类列出**所有**文件：

```markdown
#### 新增
- `src/lib/data/genre-presets.ts`
- `src/lib/types/prompt.ts`

#### 修改
- `src/components/layout/Sidebar.tsx`：见任务步骤 4.1

#### 删除
- `src/lib/ai/prompts/worldview.ts`
```

### § 4. 任务步骤（How）

**核心**：每一步都必须包含：
1. 步骤序号（4.1 / 4.2 / ...）
2. 操作类型（新增/修改/删除/运行命令）
3. 涉及的文件全路径
4. **完整的代码片段**（不是"添加一个函数"，是给出函数全文）
5. 紧接的验证命令或验证语句

**反例**（不允许）：
> 4.1 在 Sidebar 组件中添加一个折叠按钮

**正例**（必须这样写）：
> 4.1 修改 `src/components/layout/Sidebar.tsx`，在第 X 行后添加：
>
> ```tsx
> <button onClick={...}>...</button>
> ```
>
> 验证：`npm run build` 必须 0 error。

### § 5. 数据模型变更（如有）

涉及 Dexie schema 修改时必须列出：
- 旧 schema（精确字段）
- 新 schema（精确字段）
- Dexie version bump 号
- migration 函数（若不删库）或"全清"指令

### § 6. 验收标准（Definition of Done）

**所有项目必须是可二元判定的**（YES/NO，不允许"差不多"）。

```markdown
- [ ] `npm run build` 输出 "built in" 且无 error
- [ ] `npm run lint` 输出 0 errors
- [ ] 浏览器 console 启动时无红色错误
- [ ] 在世界观面板点 AI 生成按钮，3 秒内开始流式输出
- [ ] IndexedDB 中表 `promptTemplates` 存在且至少 14 行数据
```

### § 7. AI 全功能巡检（强制）

每个 Phase 完成后必须跑这 8 步（取自附录 A.4）：

```markdown
1. [ ] 进入测试项目
2. [ ] 世界观 → AI 生成（链 1）正常
3. [ ] 角色 → AI 设计角色（链 2）正常
4. [ ] 大纲 → AI 卷大纲（链 3）正常
5. [ ] 正文编辑器 → AI 写正文（链 5）正常
6. [ ] 续写 + 润色 + 扩写 + 去 AI 味（链 6/7）正常
7. [ ] 伏笔 → AI 建议（链 8）正常
8. [ ] 创建快照、导出 JSON、导入 JSON（链 10）正常
9. [ ] 删一个角色、删一个章节，验证级联清理（A/B/C）正常
```

### § 8. 故障排查（Troubleshooting）

预先列出常见错误和应对：

```markdown
| 症状 | 可能原因 | 应对 |
|------|---------|------|
| `npm run build` 报 TS error 找不到模块 X | import 路径写错 | 检查相对路径 |
| AI 调用 401 | API Key 失效 | 重新配置 |
| ... | ... | ... |
```

### § 9. 提交（Commit）规范

完成后：

```bash
git add .
git commit -m "feat(phase-XX): <概述> [verified by 8-step checklist]"
git push origin main
```

如果接手的是镜像库（storyforge/），还需要：

```bash
# 同步到 my-website/storyforge/
cp -r src/. ../my-website/storyforge/src/
# ...
```

---

## Playbook 编写硬规则

1. **不允许出现"等"、"等等"、"类似的"** — 所有列表必须穷举
2. **不允许出现"参考"、"按照惯例"** — 必须明确给出代码或步骤
3. **不允许出现"应该"、"可能" 没有量化** — 用"必须"、"恰好 N 个"
4. **不允许出现没有验证步骤的任务** — 每一步后必有验证
5. **不允许出现需要 AI 自行决策的选择** — 选择必须由战略文档先决定
6. **每段代码片段必须可直接复制粘贴** — 不能省略 import 等关键行
7. **每个文件路径必须是绝对完整的相对路径**（含 `src/...`）
