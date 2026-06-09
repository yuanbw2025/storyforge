# StoryForge · 迁移指南 v2

> 基于实际代码库的精确迁移指南。给 Claude Code / 人类开发者。

---

## 改动总量预估

| 文件 | 改动量 | 说明 |
|---|---|---|
| `src/index.css` | 🔴 大改 | 替换主题部分 |
| `tailwind.config.ts` | 🟡 中改 | 扩展字体 / 颜色 / 阴影 |
| `index.html` | 🟢 小改 | 加 Google Fonts link |
| `src/pages/HomePage.tsx` | 🟢 小改 | `data-theme="forge"` 已有，微调视觉 |
| `src/pages/WorkspacePage.tsx` | 🟢 小改 | 外层加 `data-theme="work"` |
| `src/components/shared/AIStreamOutput.tsx` | 🟡 中改 | 加左色条 + 模型标识 |
| 其他 `*Panel.tsx` | 🟢 无需改 | 继承 theme，Tailwind 类已兼容 |

**核心原则：所有现有 Tailwind 类（`bg-bg-base`、`text-accent` 等）不需要改，它们会自动从新的 CSS 变量取值。**

---

## Step 1 · 安装字体

`index.html` 的 `<head>` 里加：

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:ital,wght@0,400;0,500;0,600;1,400;1,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
```

---

## Step 2 · 替换 index.css 主题部分

把 `src/index.css` 中从 `:root, [data-theme="midnight"]` 到 `[data-theme="parchment"]` 的 **全部 5 套主题定义**（约 120 行）替换为 `design-system/tokens.css` 的内容。

**保留** `index.css` 中的：
- `@tailwind` 指令（前 3 行）
- 全局基础样式（`*`、`body`、`#root`）
- 滚动条样式
- `::selection`
- TipTap 编辑器样式

**具体操作**（给 Claude Code）：

```
1. 读取 design-system/tokens.css 的全部内容
2. 在 src/index.css 中，删除从 ":root," 到 "[data-theme="parchment"] { ... }" 的整个区块（约第 5-130 行）
3. 在 @tailwind utilities; 之后、"全局基础样式" 注释之前，粘贴 tokens.css 的内容
4. 修改 body 的 font-family 为：var(--font-sans)
```

---

## Step 3 · 替换 tailwind.config.ts

用 `design-system/tailwind.config.ts` 直接替换项目根的 `tailwind.config.ts`。

**变化点：**
- 新增 `fontFamily`（sans/serif/mono）
- 新增 `accent.soft`、`border.subtle`
- 新增 `brand.*` 颜色
- 新增 `boxShadow`（theme-sm/md/lg）
- 新增 `fontSize`（xs-sf ~ 5xl-sf 阶梯）
- 新增 `lineHeight.prose-zh`

---

## Step 4 · WorkspacePage 加 theme

`src/pages/WorkspacePage.tsx` 的最外层 `<div>` 加 `data-theme="work"`：

```diff
  return (
-   <div className="h-screen bg-bg-base flex overflow-hidden">
+   <div data-theme="work" className="h-screen bg-bg-base flex overflow-hidden">
```

---

## Step 5 · 增强 AI 输出块

`src/components/shared/AIStreamOutput.tsx` 的输出容器加左色条：

```diff
- <div className="border border-border rounded-lg overflow-hidden">
+ <div className="border border-border rounded-lg overflow-hidden border-l-2 border-l-accent">
```

输出区加软底色：

```diff
- <div className="min-h-[200px] max-h-[500px] overflow-y-auto p-4 bg-bg-surface">
+ <div className="min-h-[200px] max-h-[500px] overflow-y-auto p-4 bg-accent-soft">
```

---

## Step 6 · HomePage 微调

HomePage 已经用 `data-theme="forge"`，forge 变量现在有定义了。可选增强：

1. 加火光辉光背景（hero 区域）：
```tsx
<div className="absolute inset-0 pointer-events-none"
     style={{ background: 'radial-gradient(circle at 50% 0%, rgba(217,119,87,0.18), transparent 60%)' }} />
```

2. 项目名用衬线字体：
```diff
- <h3 className="font-semibold text-text-primary truncate">{project.name}</h3>
+ <h3 className="font-semibold font-serif text-text-primary truncate">{project.name}</h3>
```

3. Hero 标题用衬线 + 更大：
```diff
- <h2 className="text-3xl font-bold text-text-primary mb-2">我的项目</h2>
+ <h2 className="text-4xl font-serif font-normal text-text-primary mb-3 tracking-tight">我的项目</h2>
```

---

## Step 7 · 未来：焦点模式

当实现「焦点模式」时，在编辑器外层加 `data-theme="paper"`：

```tsx
function FocusMode({ children }) {
  return (
    <div data-theme="paper" className="fixed inset-0 z-50 bg-bg-base">
      <div className="max-w-[640px] mx-auto py-20 px-12">
        <div className="font-serif text-lg-sf leading-prose-zh">
          {children}
        </div>
      </div>
    </div>
  )
}
```

正文段落用 `text-indent: 2em` + 行高 2.1。

---

## Step 8 · 验证

迁移完成后检查：

```bash
# 1. 确认没有旧的靛蓝 accent 残留
grep -rn "#6366f1\|#818cf8\|#4338ca" src/

# 2. 确认 forge 变量生效
# 打开首页，检查背景是否为暖色 #1A0F0A 而非旧的 #0a0a0f

# 3. 确认三种 theme 都能工作
# 在浏览器 DevTools 的 <html> 上手动切换：
# data-theme="work" → 深色暖黑
# data-theme="forge" → 深色暖棕
# data-theme="paper" → 浅色米色

# 4. 确认 Tailwind 类没有断裂
# 检查按钮 bg-accent 是否显示为 #D97757
```

---

## 常见问题

### Q: 旧主题还能用吗？
A: 可以。`tokens.css` 保留了 ocean / graphite / mist 的定义，但 accent 已统一为火光橙。如果你以后想做"主题选择器"，可以恢复这些为独立选项。

### Q: Tailwind 的 `text-white` 怎么办？
A: 只在 accent 背景的按钮上用（`bg-accent text-white`）。其他地方用 `text-text-primary`。

### Q: 我用了 `#333` 之类的硬编码怎么办？
A: 逐步替换。`grep -rn "#[0-9a-f]\{3,6\}" src/components/` 找出来，替换为对应 token。

### Q: body 的 font-family 改了会影响什么？
A: 之前是系统字体栈，现在 Inter 在前面。Inter 覆盖了拉丁字符，中文仍然 fallback 到 PingFang SC / Microsoft YaHei。视觉上更统一。
