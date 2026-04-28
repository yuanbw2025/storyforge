# StoryForge Design System

> 单一真相源。本文档 + `tokens.css` + `components.css` 一起构成产品的视觉与交互规范。
> 任何 UI 改动必须从这里出发，不要在组件里硬编码颜色 / 字号 / 间距。

---

## 0. 设计哲学

StoryForge 是一个 **AI 辅助小说创作工具**。它的用户每天与产品共处数小时，且核心活动（写作）需要心流。所以我们的设计哲学是：

1. **Tool when working, sanctuary when writing.** 工具该像工具，写作时该像稿纸。
2. **AI 是协作者，不是主角。** AI 输出永远以"建议态"呈现，需要用户主动采纳。
3. **品牌记忆点集中在仪式时刻。** 首页、新建项目、章节扉页、导出预览——这些"瞬间"做戏剧化处理；日常生产力屏保持冷静。

为此我们设计了**三个 theme**，共享一套 token，按场景切换：

| Theme | 关键词 | 用在哪 |
|---|---|---|
| `work` | 暗夜、紧凑、Inter | 编辑器、大纲树、伏笔看板、设置、所有列表 — 生产力主屏 |
| `forge` | 暖色、戏剧、衬线、火光金线 | 首页、欢迎页、新建项目向导、章节扉页、导出预览、空状态 |
| `paper` | 浅色、留白、衬线正文 | 写作焦点模式、章节预览、成稿视图、阅读模式 |

**统一性来自：** 同一品牌主色（火光橙 `#D97757`）、同一字体家族（Inter + Source Serif）、同一间距阶梯、同一组件类名。
**差异性来自：** 背景明度、装饰元素、字号节奏、信息密度。

---

## 1. 色彩系统

### 1.1 品牌色（三 theme 共享）

| Token | 值 | 用途 |
|---|---|---|
| `--brand-flame` | `#D97757` | 主品牌色 / `--accent`（work, forge） |
| `--brand-flame-deep` | `#B85C3F` | hover、pressed、`--accent`（paper） |
| `--brand-flame-soft` | `rgba(217,119,87,0.12)` | accent 软背景 |
| `--brand-gold` | `#C8A155` | 金线装饰（仅 forge） |
| `--brand-ember` | `#8B3E1F` | 余烬最深暖调（仅 paper accent-deep） |

### 1.2 语义色（三 theme 共享）

| Token | 值 |
|---|---|
| `--color-success` | `#4ADE80` |
| `--color-warning` | `#FBBF24` |
| `--color-error` | `#EF4444` |
| `--color-info` | `#60A5FA` |

### 1.3 主题色（按 theme 切换）

每个 theme 都暴露这套 token，组件直接消费：

```
--bg-base       页面背景
--bg-surface    侧栏、顶栏、卡片底
--bg-elevated   悬浮卡片、输入框、按钮
--bg-hover      悬停层
--bg-active     选中态

--text-primary    主文本
--text-secondary  次要文本
--text-muted      最弱文本（caption / placeholder）
--text-inverse    反色（用在 accent 上）

--border-subtle   最弱分隔
--border-default  默认边框
--border-strong   强边框（按钮 hover、active 状态）

--accent          主色（已映射到品牌火光）
--accent-deep     主色加深
--accent-soft     主色软背景
```

**规则：**
- ❌ 永远不要在组件里写 `color: #D97757`，写 `color: var(--accent)`
- ❌ 永远不要在组件里写 `background: #161412`，写 `background: var(--bg-surface)`
- ✅ 切换 `<html data-theme="work|forge|paper|auto">` 整个产品视觉跟着切

---

## 2. 字体系统

### 2.1 字体族

| Token | 用途 |
|---|---|
| `--font-sans` | Inter — 工具 UI、按钮、菜单、表格 |
| `--font-serif` | Source Serif 4 + Songti SC fallback — 作品标题、章节标题、正文（C 模式） |
| `--font-mono` | JetBrains Mono — 代码、ID、统计数字 |
| `--font-ui` | 当前 theme 下 UI 用什么（按 theme 切换） |
| `--font-content` | 当前 theme 下"内容"用什么 |

**Theme 默认值：**
- `work`: ui=sans, content=sans（密度优先）
- `forge`: ui=serif, content=serif（仪式感）
- `paper`: ui=sans, content=serif（工具是工具，正文是正文）

### 2.2 字号阶梯（1.25 倍率）

```
--fs-xs:   11px   eyebrow / caption
--fs-sm:   12px   按钮、标签
--fs-base: 14px   正文 UI
--fs-md:   15px
--fs-lg:   17px   阅读正文
--fs-xl:   20px   小标题
--fs-2xl:  24px   h2
--fs-3xl:  32px   h1
--fs-4xl:  44px   页面大标题
--fs-5xl:  64px   首页 hero
```

**最小字号：** UI 12px，正文 14px。

### 2.3 工具类

```html
<div class="sf-eyebrow">导航 · 上方小字</div>
<h1 class="sf-title-h1">页面主标题</h1>
<p class="sf-body">普通正文</p>
<p class="sf-prose">章节正文（自动衬线 + 2.1 行高 + 首行缩进）</p>
```

---

## 3. 间距 / 圆角 / 阴影

### 间距（4px 基线）
`--space-0` ~ `--space-20`，对应 `0/4/8/12/16/20/24/32/40/48/64/80px`。

**密度跟随 theme：** 组件用 `--density-padding-x/y` 自动适配。
- work 紧凑：`8px 16px`
- forge 宽松：`16px 32px`
- paper 极宽松：`20px 40px`

### 圆角
`--radius-sm: 4px` 按钮、Pill 内部
`--radius-md: 6px` 默认（按钮、输入框）
`--radius-lg: 8px` 卡片
`--radius-xl: 12px` 大容器、模态
`--radius-pill: 999px` 胶囊

### 阴影
`--shadow-sm/md/lg`，theme 自动调整强度。Forge 多一个 `--shadow-glow`（橙色光晕）。

---

## 4. 组件目录

所有组件类名以 `sf-` 前缀，避免与业务样式冲突。

### Button — `.sf-btn`
变体：`--primary`（主行动）、`--ghost`（次要）、`--danger`、`--sm/--lg`

```html
<button class="sf-btn sf-btn--primary">采纳</button>
<button class="sf-btn">取消</button>
<button class="sf-btn sf-btn--ghost sf-btn--sm">设置</button>
```

### Card — `.sf-card`
变体：`--elevated`、`--interactive`、`--accent`（顶部色条）

```html
<div class="sf-card sf-card--interactive sf-card--accent">
  <h3 class="sf-title-h3">项目名</h3>
  <p class="sf-body-sm">描述</p>
</div>
```

### Input / Textarea — `.sf-input`, `.sf-textarea`
聚焦时边框变 `--accent`。

### Pill — `.sf-pill`
变体：`--accent`、`--success`、`--warning`

```html
<span class="sf-pill sf-pill--accent">玄幻</span>
<span class="sf-pill sf-pill--success"><span class="sf-dot"></span>进行中</span>
```

### Sidebar / Nav — `.sf-sidebar`, `.sf-nav-item`, `.sf-nav-item--active`, `.sf-nav-group`
固定 224px 宽度。Active 项左侧 2px accent 色条。

### Topbar — `.sf-topbar`
固定 48px 高，含品牌 + 项目名 + 模型选择 + 设置。

### Statusbar — `.sf-statusbar`
固定 26px 高，最底部，显示字数 / 模型 / 同步状态。

### 装饰类
`.sf-rule` — 分隔线。Forge 下自动变成金色渐变。
`.sf-glow` — 仅 forge 生效，绝对定位的橙色光晕。
`.sf-paper-bg` — 仅 paper 生效，稿纸横线纹理。
`.sf-cursor-blink` — AI 流式输出时的闪烁光标。

---

## 5. 三 Theme 使用指南

### 5.1 怎么切换

**方式 A — 路由级**：在路由组件 wrap 时设置 `<div data-theme="forge">...</div>`。
**方式 B — 全局**：`<html data-theme="work">`，靠用户偏好或系统设置。
**方式 C — 自动**：`<html data-theme="auto">` 跟随 `prefers-color-scheme`。

推荐组合：**全局 `auto` + 仪式时刻局部 `forge` + 写作页局部 `paper`**。

### 5.2 哪些页面用哪个 theme

| 页面 | Theme | 备注 |
|---|---|---|
| 首页 / 项目库（无项目时） | forge | 强品牌，hero 大字 |
| 首页 / 项目库（有项目时） | work 或 auto | 列表为主 |
| 新建项目向导 | forge | 仪式 |
| 项目首页 | work | 信息聚合 |
| 世界观 / 大纲 / 角色 / 伏笔 | work | 编辑器 |
| 章节扉页（每章首屏 1.5s） | forge | 戏剧化过渡 |
| 章节正文编辑器（默认） | work | 三栏 |
| 章节正文编辑器（焦点模式） | paper | F11 切入 |
| 章节预览 / 成稿视图 | paper | 阅读 |
| 导出预览 | paper | |
| 设置 | work | |
| 关于 / 帮助 | forge | 品牌延伸 |

### 5.3 跨 theme 一致的东西

- 主色（火光橙）— 任何 theme 下 accent 都来自这一支
- 圆角 / 间距阶梯
- 组件类名
- 字体家族（具体哪一支按 theme 切，但都在 Inter + Source Serif 范围内）
- 信息架构（侧栏宽度、顶栏高度、状态栏高度）

### 5.4 跨 theme 差异化的东西

- 背景明度
- 字体默认（forge 全衬线，work 全无衬线，paper 混）
- 装饰（forge 有金线 + 火光，paper 有稿纸纹理，work 干净）
- 信息密度
- 字号节奏（forge/paper 喜欢大衬线 hero，work 紧凑）

---

## 6. AI 协作 UI 规范

所有 AI 输出必须是**显式建议态**，不直接修改用户内容：

1. **AI 块的视觉语言**：
   - work 模式：左侧 2px accent 色条 + `--accent-soft` 背景
   - paper 模式：右侧边批栏，更小字号 + 斜体注解
   - 流式输出末尾必带 `.sf-cursor-blink`

2. **必备三按钮**：`采纳` (primary) / `重写` (ghost) / `丢弃` (ghost)

3. **AI 标识**：始终显示模型名（如 `deepseek-chat`），让用户知道是谁说的。

4. **不悄悄写入**：AI 永远不直接 patch 用户文本，必须经过明确的"采纳"动作。

---

## 7. 命名约定

- CSS 类：`sf-` 前缀 + kebab-case，BEM 风格修饰符（`sf-btn--primary`）
- CSS 变量：kebab-case，按 `--<category>-<role>` 组织（`--bg-surface`，`--text-primary`）
- React 组件：PascalCase，按 theme 中性命名（`Button`、`Card`，不是 `WorkButton`）
- 文件：组件库放 `design-system/`，应用代码引 `import "@/design-system/tokens.css"`

---

## 8. 给开发的硬性规则

✅ **必须做：**
- 所有颜色走 token
- 所有间距走 `--space-*`
- 用 `sf-*` 类做组件，不在业务里复制粘贴样式
- 切 theme 用 `data-theme` attribute，不要新建一套类

❌ **不要做：**
- 不要写 `color: #fff` / `color: white`
- 不要写魔法数字 `padding: 13px`（要么是 token，要么解释为什么）
- 不要在 work 里塞衬线大标题（那是 forge/paper 的语言）
- 不要在 paper 里塞密集表格（那是 work 的事）
- 不要给 AI 输出加 `position: fixed` 全屏蒙层 — 永远 inline、可滚动、可关闭

---

## 9. 文件清单

```
design-system/
├── tokens.css           # 所有 CSS 变量（色彩、字体、间距、圆角、阴影、3 theme）
├── components.css       # 所有 sf-* 组件类
├── design-system.md     # 本文档
├── components-demo.html # 组件库可视化（所有组件 × 3 theme）
├── scenes-demo.html     # 三场景代表性 mockup（首页/编辑器/焦点）
└── MIGRATION.md         # 给 Claude Code：怎么把现有代码迁过来
```
