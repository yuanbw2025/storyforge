# StoryForge Design System v2

> 适配实际代码库：React 19 + Tailwind 3 + Zustand + Dexie + lucide-react。
> 本文档 + `tokens.css` 是产品视觉的单一真相源。

---

## 0. 设计哲学

StoryForge 是 **AI 辅助小说创作工具**，用户每天与产品共处数小时。

1. **Tool when working, sanctuary when writing.** 工具该像工具，写作时该像稿纸。
2. **AI 是协作者，不是主角。** AI 输出永远以"建议态"呈现（左色条 + 采纳/重试/停止）。
3. **品牌记忆点集中在仪式时刻。** 首页、新建项目、章节扉页做戏剧化；日常生产力屏保持冷静。

---

## 1. 三 Theme 系统

替换原有 5 套主题（midnight/ocean/graphite/mist/parchment），统一为 3 种场景模式：

| Theme | `data-theme` | 关键词 | 用在哪 |
|---|---|---|---|
| **Work** | `work`（默认） | 暗夜、紧凑、Sans | WorkspacePage 所有面板：编辑器、大纲、角色、伏笔、设置 |
| **Forge** | `forge` | 暖色、戏剧、大衬线 | HomePage、新建项目对话框、章节扉页、导出预览、空状态 |
| **Paper** | `paper` | 浅色、留白、衬线正文 | 写作焦点模式（F11）、章节预览、成稿导出视图 |

**统一性来自：** 同一品牌主色（火光橙 `#D97757`）、同一变量名、同一 Tailwind 类。
**差异性来自：** 背景明度、装饰元素、信息密度。

### 1.1 变量名（完全兼容现有代码）

```
--bg-base / --bg-surface / --bg-elevated / --bg-hover
--text-primary / --text-secondary / --text-muted
--accent / --accent-hover / --accent-muted
--border / --border-hover
--success / --warning / --error / --info
```

**新增（不破坏现有引用）：**
```
--accent-soft      accent 软背景（用于 AI 块底色）
--border-subtle    最弱分隔线
--shadow-sm/md/lg  按 theme 自动调
--shadow-glow      仅 forge，橙色光晕
```

### 1.2 页面 → Theme 映射

| 页面/组件 | Theme | 备注 |
|---|---|---|
| `HomePage.tsx` | `forge` | ✅ 已是（但需定义 forge 变量） |
| `WorkspacePage.tsx` 外壳 | `work` | 改为 `data-theme="work"` |
| 所有 `*Panel.tsx` | 继承 work | 无需单独设 |
| 章节扉页（未来） | `forge` | 局部包裹 |
| 焦点模式（未来） | `paper` | 局部包裹 |
| 导出预览 | `paper` | |

### 1.3 旧主题兼容

`tokens.css` 保留了旧主题名的变量定义（ocean/graphite/mist），但将 accent 统一为火光橙。如果用户想切换深色风格变体，这些仍然可用。

---

## 2. 品牌色

| Token | 值 | 用途 |
|---|---|---|
| `--brand-flame` | `#D97757` | 主品牌色 = `--accent`（work/forge） |
| `--brand-flame-deep` | `#B85C3F` | hover pressed = `--accent`（paper） |
| `--brand-gold` | `#C8A155` | forge 装饰金线 |
| `--brand-ember` | `#8B3E1F` | 最深暖调 |

**规则：** 所有主题的 `--accent` 都指向火光橙系，不再用靛蓝 `#6366f1`。

---

## 3. 字体系统

| 用途 | 字体 | Tailwind class |
|---|---|---|
| UI 文字（按钮、菜单、标签） | `--font-sans`（Inter + 系统 fallback） | `font-sans` |
| 作品标题、章节标题、正文 | `--font-serif`（Source Serif 4 + 宋体 fallback） | `font-serif` |
| 代码、ID、统计数字 | `--font-mono`（JetBrains Mono） | `font-mono` |

**安装字体**（在 `index.html` 的 `<head>` 加）：
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:ital,wght@0,400;0,500;0,600;1,400;1,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
```

**用法规则：**
- Work 模式：全 Sans（紧凑）
- Forge 模式：标题用 Serif，UI 仍 Sans
- Paper 模式：正文用 Serif（行高 2.1 + 首行缩进），UI 仍 Sans

---

## 4. 组件规范（Tailwind 类）

所有组件已经用 Tailwind + CSS 变量写法，保持不变。统一以下模式：

### 4.1 Button

```tsx
// 主行动
<button className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-40 transition-colors text-sm font-medium">
  采纳
</button>

// 默认
<button className="px-3 py-1.5 bg-bg-elevated text-text-secondary rounded-md hover:text-text-primary border border-border transition-colors text-sm">
  取消
</button>

// 幽灵
<button className="px-2 py-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors text-sm">
  设置
</button>
```

### 4.2 Card

```tsx
<div className="bg-bg-surface border border-border rounded-xl p-5 hover:border-accent/50 transition-all">
  {/* 主项目加顶部色条 */}
  {/* className="... border-t-2 border-t-accent" */}
</div>
```

### 4.3 Input / Textarea

```tsx
<input className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors text-sm" />
```

### 4.4 Pill / Badge

```tsx
<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
  玄幻
</span>
<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/10 text-success flex items-center gap-1">
  <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" /> 进行中
</span>
```

### 4.5 Sidebar Nav Item

```tsx
// Active
<button className="w-full flex items-center gap-2 text-sm py-1.5 pr-3 text-accent bg-accent/10 border-r-2 border-accent" style={{ paddingLeft: `${12 + depth * 12}px` }}>
  <Icon className="w-3.5 h-3.5" /> 世界观
</button>

// Inactive
<button className="... text-text-secondary hover:text-text-primary hover:bg-bg-hover">
```

---

## 5. AI 协作 UI 规范

### 已实现（AIStreamOutput.tsx）✅
- 流式输出 + 闪烁光标（`animate-pulse`）
- 操作栏：停止 / 重试 / 采纳
- P15：好示例 / 反例标记

### 需要增强
1. **AI 块左侧色条**：在 Work 模式下给 AI 输出块加 `border-l-2 border-accent bg-accent/5`
2. **Paper 模式下的边批**：AI 建议显示在右侧 marginalia rail，更小字号 + 斜体
3. **模型标识**：始终显示 `deepseek-chat` 等模型名
4. **字数统计**：已有 ✅

---

## 6. Forge 模式视觉元素

仅在 `data-theme="forge"` 区域使用：

```tsx
{/* 火光辉光 — 绝对定位 */}
<div className="absolute inset-0 pointer-events-none"
     style={{ background: 'radial-gradient(circle at 50% 0%, rgba(217,119,87,0.18), transparent 60%)' }} />

{/* 金色分隔线 */}
<hr className="border-0 h-px"
    style={{ background: 'linear-gradient(90deg, transparent, var(--brand-gold), transparent)' }} />
```

---

## 7. 给开发的硬规则

### ✅ 必须做
- 所有颜色走 CSS 变量（通过 Tailwind `bg-bg-*` / `text-text-*` / `text-accent` 等）
- 切 theme 只用 `data-theme` attribute
- AI 输出必须是"建议态"（采纳/重试/停止）
- 新增颜色先扩展 `tokens.css`

### ❌ 不要做
- 不写 `text-white`（用 `text-text-primary`，除非在 accent 背景上）
- 不写 `bg-gray-900`（用 `bg-bg-base`）
- 不在 Work 里放衬线大标题
- 不在 Paper 里塞密集表格
- 不给 AI 输出加全屏蒙层

---

## 8. 文件清单

```
design-system/
├── tokens.css              ← 替换 src/index.css 中的主题部分
├── design-system.md        ← 本文档
├── tailwind.config.ts      ← 替换项目根 tailwind.config.ts
├── components-demo.html    ← 组件可视化（三 theme 切换）
├── scenes-demo.html        ← 三场景 mockup
├── MIGRATION.md            ← 逐文件迁移指南
└── index.html              ← 总入口
```
