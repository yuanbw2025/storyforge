# StoryForge Design System · 迁移指南

> 给 Claude Code（或任何在本仓库继续开发的 AI / 开发者）的操作手册。

---

## TL;DR

1. 把 `design-system/tokens.css` 和 `design-system/components.css` 复制到你的应用入口（如 `src/styles/`）并 import。
2. 在最外层（`<html>` 或根组件 wrapper）加 `data-theme="auto"`（或 `work` / `forge` / `paper`）。
3. 删掉所有硬编码颜色 / 字号 / 间距，替换为 `var(--xxx)` token。
4. 把现有按钮/卡片/输入替换为 `sf-*` 类（或在 React 里包一层 `<Button>` 组件）。
5. 按 `design-system.md` §5.2 的"页面 → theme"映射表，给每个路由设置正确的 `data-theme`。

---

## Step 1 · 安装

把 `design-system/` 整个目录拷进你的项目（推荐路径 `src/design-system/` 或 `app/styles/design-system/`）。

在应用入口（`main.tsx` / `App.tsx` / `index.html`）按顺序 import：

```ts
import "./design-system/tokens.css";
import "./design-system/components.css";
```

> ⚠️ **顺序很重要**：`tokens.css` 必须先加载，`components.css` 依赖它的变量。

加载 Google Fonts（在 `index.html` 的 `<head>`）：

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:ital,wght@0,400;0,500;0,600;1,400;1,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
```

---

## Step 2 · 设置 theme

### 全局 theme（最简）

`index.html`：
```html
<html data-theme="auto">
```

### 路由级 theme（推荐）

每个 route 组件 wrap 一层：

```tsx
// HomePage.tsx
export default function HomePage() {
  return <div data-theme="forge">...</div>;
}

// EditorPage.tsx
export default function EditorPage() {
  return <div data-theme="work">...</div>;
}

// FocusModePage.tsx
export default function FocusModePage() {
  return <div data-theme="paper">...</div>;
}
```

完整映射见 `design-system.md` §5.2。

---

## Step 3 · 替换硬编码

### 颜色

| 旧 | 新 |
|---|---|
| `color: #fff` / `white` | `color: var(--text-primary)` |
| `background: #1a1a1a` / `#000` | `background: var(--bg-base)` |
| `background: #161412` 之类的"卡片底" | `background: var(--bg-surface)` |
| `border: 1px solid #333` | `border: 1px solid var(--border-default)` |
| `color: #888` / `#999` | `color: var(--text-secondary)` 或 `var(--text-muted)` |
| 任何主色橙 | `var(--accent)` |

### 字体

| 旧 | 新 |
|---|---|
| `font-family: 'Inter', sans-serif` | `font-family: var(--font-sans)` |
| `font-family: serif` | `font-family: var(--font-serif)` |
| `font-size: 14px` | `font-size: var(--fs-base)` |
| 所有魔法字号 | 走 `--fs-xs/sm/base/md/lg/xl/2xl/3xl/4xl/5xl` |

### 间距

| 旧 | 新 |
|---|---|
| `padding: 16px` | `padding: var(--space-4)` |
| `gap: 12px` | `gap: var(--space-3)` |
| 任何"凑出来"的 padding | 走 `--space-N` |

### 圆角 / 阴影

```diff
- border-radius: 8px;
+ border-radius: var(--radius-lg);

- box-shadow: 0 4px 12px rgba(0,0,0,0.3);
+ box-shadow: var(--shadow-md);
```

---

## Step 4 · 组件迁移

### 选项 A · 直接用 `sf-*` 类（最快）

```tsx
<button className="sf-btn sf-btn--primary">采纳</button>
<div className="sf-card sf-card--accent">...</div>
```

### 选项 B · 包一层 React 组件（推荐长期）

```tsx
// design-system/Button.tsx
type Props = {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant, size, className = "", ...rest }: Props) {
  const cls = [
    "sf-btn",
    variant && `sf-btn--${variant}`,
    size && size !== "md" && `sf-btn--${size}`,
    className,
  ].filter(Boolean).join(" ");
  return <button className={cls} {...rest} />;
}
```

需要包的核心组件：`Button`、`Card`、`Input`、`Textarea`、`Pill`、`Sidebar`、`NavItem`、`Topbar`、`Statusbar`、`AiBlock`。

---

## Step 5 · AI 协作 UI 必改

如果你现有的 AI 输出是直接 patch 到正文里 / 全屏蒙层 / 没有"采纳/重写/丢弃"三选项 —— **必须改**。

正确模式（见 `design-system.md` §6 和 `components-demo.html` §9）：

```tsx
<div style={{
  borderLeft: "2px solid var(--accent)",
  background: "var(--accent-soft)",
  padding: "var(--space-4) var(--space-5)",
  borderRadius: "0 var(--radius-md) var(--radius-md) 0",
}}>
  <header>{/* 模型名 + token 数 + 时间 */}</header>
  <p className="sf-body">{streamingText}<span className="sf-cursor-blink"/></p>
  <footer>
    <Button variant="primary" size="sm" onClick={accept}>采纳</Button>
    <Button variant="ghost" size="sm" onClick={regenerate}>重写</Button>
    <Button variant="ghost" size="sm" onClick={discard}>丢弃</Button>
  </footer>
</div>
```

---

## Step 6 · 检查清单

迁移完成后逐条检查：

- [ ] `grep -rE "#[0-9a-fA-F]{3,6}"` 在业务代码里返回的硬编码颜色 ≤ 5 处（且都有充分理由）
- [ ] `grep -rE "font-size: \d+px"` 业务代码里 = 0
- [ ] `grep -rE "padding: \d+px"` 业务代码里 = 0（除非是 token 等价值且加了注释）
- [ ] 切换 `data-theme` 整个页面视觉跟着变，不需要改组件
- [ ] AI 输出都走"建议态 + 三按钮"模式
- [ ] 首页 / 新建项目 / 章节扉页 用 `forge`
- [ ] 编辑器 / 大纲 / 设置 用 `work`
- [ ] 焦点模式 / 成稿预览 用 `paper`
- [ ] 字数 / 章数 等数字加 `font-feature-settings: 'tnum'`（或用 `.sf-tnum`）

---

## Step 7 · 常见坑

### 坑 1：在 Tailwind 项目里
不用 Tailwind 的 color/spacing utilities，直接用 token 写自定义类，或在 `tailwind.config.js` 里把 token 桥接进 theme：

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        accent: "var(--accent)",
        "bg-base": "var(--bg-base)",
        // ...
      },
    },
  },
};
```

但更推荐：**直接 `style={{ color: "var(--accent)" }}` 或写 CSS Module**，避免 Tailwind 把 token 静态化。

### 坑 2：Server Components / SSR
`<html data-theme>` 必须在服务端就渲染好，否则会闪烁。Next.js 的 `app/layout.tsx`：

```tsx
export default function RootLayout({ children }) {
  return <html lang="zh" data-theme="auto">...</html>;
}
```

### 坑 3：暗色截图 / Open Graph
`forge` 是暖色暗调，截图前先确认 OG 卡片是用 `forge` 还是 `paper` 渲染——它们看起来差很大。

### 坑 4：第三方组件库
如果用了 Radix / Headless UI / shadcn —— 把它们的 token 也桥到 `var(--xxx)`。**千万别让 shadcn 默认的 `--background` 跟我们的 `--bg-base` 打架。** 重命名我们的或重命名它的。

---

## 文件清单（拷进项目根的 `design-system/` 里）

```
design-system/
├── tokens.css           ← 必须
├── components.css       ← 必须
├── design-system.md     ← 规范文档（不参与构建，开发参考）
├── components-demo.html ← 离线打开看效果
├── scenes-demo.html     ← 三场景示意
└── MIGRATION.md         ← 本文档
```

---

## 给 Claude Code 的最后一句话

> 这套设计系统**是产品的视觉契约**。
> 不要在业务组件里"临时"加一个新颜色 / 新字号——任何新需求都先回来扩 `tokens.css`。
> 三个 theme 的边界要尊重：work 不放衬线大字，paper 不塞密集表格，forge 不用纯灰背景。
> 这样产品才会越做越统一，而不是越做越花。
