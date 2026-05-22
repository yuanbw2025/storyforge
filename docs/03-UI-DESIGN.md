# StoryForge / 故事熔炉 — UI 设计规范

> **版本**: v1.0 | **最后更新**: 2026-04-13 | **状态**: 规划中

---

## 1. 设计风格定义

### 1.1 设计关键词

**暗夜书房** — 沉浸、专注、文学感、工具感

- **暗色主题优先**：长时间创作减少视觉疲劳
- **面板式 IDE 布局**：左侧导航 + 中间编辑 + 右侧属性，类 VS Code
- **信息层级清晰**：世界观数据量大，需要合理的层级和折叠
- **功能性优先**：不追求花哨的动画，追求操作效率

### 1.2 设计参考

| 参考产品 | 借鉴点 |
|---------|--------|
| VS Code | 面板布局、侧边栏导航、暗色主题 |
| Notion | 卡片式项目管理、流畅的编辑体验 |
| Obsidian | 暗色主题色调、Markdown 编辑 |
| Linear | 状态标签设计、简洁的列表视图 |

---

## 2. 色彩体系（5 种主题）

### 2.0 主题切换机制

使用 `data-theme` 属性 + CSS 变量实现零闪烁主题切换：

```typescript
// 主题类型定义
type ThemeName = 'midnight' | 'ocean' | 'graphite' | 'mist' | 'parchment';

interface ThemeConfig {
  id: ThemeName;
  name: string;         // 中文名
  icon: string;         // emoji
  category: 'dark' | 'medium' | 'light';
}

const THEMES: ThemeConfig[] = [
  { id: 'midnight',  name: '深夜书房', icon: '🌑', category: 'dark' },
  { id: 'ocean',     name: '暗夜蓝',   icon: '🌃', category: 'dark' },
  { id: 'graphite',  name: '墨灰',     icon: '🌫️', category: 'medium' },
  { id: 'mist',      name: '烟白',     icon: '☁️', category: 'light' },
  { id: 'parchment', name: '暖纸',     icon: '📜', category: 'light' },
];
```

```html
<!-- HTML 根元素 -->
<html data-theme="midnight">
```

```css
/* 主题通过 data-theme 切换 CSS 变量 */
[data-theme="midnight"] { /* ... */ }
[data-theme="ocean"]    { /* ... */ }
[data-theme="graphite"] { /* ... */ }
[data-theme="mist"]     { /* ... */ }
[data-theme="parchment"]{ /* ... */ }
```

主题选择保存到 `localStorage`，启动时优先读取：

```typescript
const savedTheme = localStorage.getItem('sf-theme') || 'midnight';
document.documentElement.setAttribute('data-theme', savedTheme);
```

---

### 2.1 🌑 深夜书房（默认 — 深色）

纯黑底 + 靛蓝紫强调，适合夜间长时间写作。

```css
[data-theme="midnight"] {
  /* ===== 背景层级 ===== */
  --bg-base: #0a0a0f;
  --bg-surface: #12121a;
  --bg-elevated: #1a1a2e;
  --bg-hover: #252540;
  --bg-active: #2d2d50;
  --bg-input: #16162a;
  
  /* ===== 文字层级 ===== */
  --text-primary: #e8e8ed;
  --text-secondary: #8888a0;
  --text-muted: #555570;
  --text-inverse: #0a0a0f;
  
  /* ===== 主色 ===== */
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --accent-active: #4f46e5;
  --accent-muted: #312e81;
  --accent-text: #a5b4fc;
  
  /* ===== 边框 ===== */
  --border: #2a2a40;
  --border-hover: #3a3a55;
  --border-focus: #6366f1;
  --border-subtle: #1e1e35;
  
  /* ===== 阴影 ===== */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
}
```

### 2.2 🌃 暗夜蓝（深色）

深蓝灰底 + 天蓝色强调，偏冷色系科技感。

```css
[data-theme="ocean"] {
  --bg-base: #0b1120;
  --bg-surface: #0f172a;
  --bg-elevated: #1e293b;
  --bg-hover: #283548;
  --bg-active: #334155;
  --bg-input: #131d30;
  
  --text-primary: #e2e8f0;
  --text-secondary: #7c8ba3;
  --text-muted: #4a5568;
  --text-inverse: #0b1120;
  
  --accent: #38bdf8;
  --accent-hover: #7dd3fc;
  --accent-active: #0ea5e9;
  --accent-muted: #0c3d5e;
  --accent-text: #7dd3fc;
  
  --border: #1e3a5f;
  --border-hover: #2d4a6f;
  --border-focus: #38bdf8;
  --border-subtle: #162a45;
  
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
}
```

### 2.3 🌫️ 墨灰（中色）

温暖灰底 + 琥珀色强调，介于深浅之间，减轻视觉疲劳。

```css
[data-theme="graphite"] {
  --bg-base: #1c1c1e;
  --bg-surface: #2c2c2e;
  --bg-elevated: #3a3a3c;
  --bg-hover: #444446;
  --bg-active: #505052;
  --bg-input: #252527;
  
  --text-primary: #f0f0f0;
  --text-secondary: #9a9a9e;
  --text-muted: #636366;
  --text-inverse: #1c1c1e;
  
  --accent: #f59e0b;
  --accent-hover: #fbbf24;
  --accent-active: #d97706;
  --accent-muted: #4a3512;
  --accent-text: #fbbf24;
  
  --border: #3a3a3c;
  --border-hover: #505052;
  --border-focus: #f59e0b;
  --border-subtle: #2c2c2e;
  
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.25);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.35);
}
```

### 2.4 ☁️ 烟白（浅色）

高级灰白底 + 靛蓝强调，明亮但不刺眼。

```css
[data-theme="mist"] {
  --bg-base: #f8fafc;
  --bg-surface: #ffffff;
  --bg-elevated: #ffffff;
  --bg-hover: #f1f5f9;
  --bg-active: #e2e8f0;
  --bg-input: #f1f5f9;
  
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --text-muted: #94a3b8;
  --text-inverse: #ffffff;
  
  --accent: #6366f1;
  --accent-hover: #4f46e5;
  --accent-active: #4338ca;
  --accent-muted: #eef2ff;
  --accent-text: #4f46e5;
  
  --border: #e2e8f0;
  --border-hover: #cbd5e1;
  --border-focus: #6366f1;
  --border-subtle: #f1f5f9;
  
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);
}
```

### 2.5 📜 暖纸（浅色）

仿古纸张底 + 棕色强调，沉浸式古风阅读体验。

```css
[data-theme="parchment"] {
  --bg-base: #faf7f2;
  --bg-surface: #fff9f0;
  --bg-elevated: #ffffff;
  --bg-hover: #f5efe6;
  --bg-active: #ede4d6;
  --bg-input: #f5efe6;
  
  --text-primary: #292524;
  --text-secondary: #78716c;
  --text-muted: #a8a29e;
  --text-inverse: #faf7f2;
  
  --accent: #92400e;
  --accent-hover: #78350f;
  --accent-active: #653208;
  --accent-muted: #fef3c7;
  --accent-text: #92400e;
  
  --border: #e7e0d5;
  --border-hover: #d6cfc4;
  --border-focus: #92400e;
  --border-subtle: #f0ebe3;
  
  --shadow-sm: 0 1px 2px rgba(120, 80, 20, 0.06);
  --shadow-md: 0 4px 12px rgba(120, 80, 20, 0.1);
  --shadow-lg: 0 8px 24px rgba(120, 80, 20, 0.14);
}
```

### 2.6 通用语义色（所有主题共享）

```css
:root {
  /* ===== 功能色 — 暗色主题 ===== */
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;
  --info: #3b82f6;
  
  /* ===== 伏笔状态色 ===== */
  --foreshadow-planned: #8888a0;
  --foreshadow-planted: #ef4444;
  --foreshadow-echoed: #f59e0b;
  --foreshadow-resolved: #22c55e;
  --foreshadow-abandoned: #555570;
  
  /* ===== 角色定位色 ===== */
  --role-protagonist: #f59e0b;
  --role-heroine: #ec4899;
  --role-supporting: #3b82f6;
  --role-villain: #ef4444;
  --role-mentor: #8b5cf6;
  --role-ally: #22c55e;
}

/* 浅色主题下功能色微调 */
[data-theme="mist"],
[data-theme="parchment"] {
  --success: #16a34a;
  --warning: #d97706;
  --error: #dc2626;
  --info: #2563eb;
  --foreshadow-planned: #9ca3af;
  --foreshadow-abandoned: #9ca3af;
}
```

### 2.7 主题切换 UI

在顶部导航栏右侧放置主题选择器：

```
┌─────────────────────────────────────────────────────────────┐
│  🔥 StoryForge    ...                    [🌑 ▼]  [⚙️]  [?] │
│                                           ┌──────────────┐  │
│                                           │ 🌑 深夜书房 ✓│  │
│                                           │ 🌃 暗夜蓝    │  │
│                                           │ 🌫️ 墨灰      │  │
│                                           │ ☁️ 烟白       │  │
│                                           │ 📜 暖纸       │  │
│                                           └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 排版

### 3.1 字体栈

```css
:root {
  /* 界面字体（UI 元素、按钮、标签） */
  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
             "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  
  /* 编辑器字体（章节正文编辑区） */
  --font-editor: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
                 "Source Han Sans CN", sans-serif;
  
  /* 代码字体（代码块、JSON 预览） */
  --font-mono: "JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace;
}
```

### 3.2 字号体系

| Token | 大小 | 行高 | 用途 |
|-------|------|------|------|
| `--text-xs` | 11px | 16px | 标签、辅助文字 |
| `--text-sm` | 13px | 20px | 次要文字、描述 |
| `--text-base` | 14px | 22px | 正文、表单 |
| `--text-md` | 15px | 24px | 编辑器正文 |
| `--text-lg` | 18px | 28px | 面板标题 |
| `--text-xl` | 22px | 32px | 页面标题 |
| `--text-2xl` | 28px | 36px | 大标题（首页） |

### 3.3 间距体系

基于 4px 网格：

| Token | 值 | 用途 |
|-------|-----|------|
| `--space-1` | 4px | 紧凑间距 |
| `--space-2` | 8px | 元素内间距 |
| `--space-3` | 12px | 小组件间距 |
| `--space-4` | 16px | 标准间距 |
| `--space-5` | 20px | 区块间距 |
| `--space-6` | 24px | 面板内边距 |
| `--space-8` | 32px | 大区块间距 |
| `--space-10` | 40px | 页面级间距 |

---

## 4. 组件规范

### 4.1 按钮

```
类型          样式                           用途
─────────────────────────────────────────────────────────
Primary       bg: accent, text: white        主要操作（保存、创建、AI生成）
Secondary     bg: transparent, border         次要操作（取消、返回）
Ghost         bg: transparent, no border      工具栏按钮、内联操作
Danger        bg: error, text: white          危险操作（删除）
Icon          圆形/方形, 无文字              图标按钮（设置、关闭）

尺寸：
sm: h-7  px-3  text-xs     工具栏小按钮
md: h-9  px-4  text-sm     标准按钮
lg: h-11 px-6  text-base   重要操作按钮
```

### 4.2 输入框

```
状态          边框颜色         背景
─────────────────────────────────────
Default       border           bg-input
Hover         border-hover     bg-input
Focus         border-focus     bg-input (+ ring)
Error         error            bg-input
Disabled      border (opacity) bg-surface (opacity)

变体：
- text input: 单行输入
- textarea: 多行输入（自动增高）
- select: 下拉选择
- tag input: 标签输入（可添加/删除标签）
```

### 4.3 卡片

```css
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: var(--space-4);
  transition: border-color 0.15s;
}
.card:hover {
  border-color: var(--border-hover);
}
.card.selected {
  border-color: var(--accent);
}
```

### 4.4 对话框（Dialog/Modal）

```
┌─ 对话框 ────────────────────────────┐
│                                      │  背景: bg-elevated
│  标题                          ✕     │  边框: border
│  ─────────────────────────────────   │  圆角: 12px
│                                      │  阴影: shadow-lg
│  内容区...                           │  遮罩: rgba(0,0,0,0.6)
│                                      │
│                                      │
│              [取消]     [确认]        │
└──────────────────────────────────────┘
```

### 4.5 状态标签（Badge/Tag）

```
伏笔状态标签：
  ⚪ 已计划   bg: foreshadow-planned/20%  text: foreshadow-planned
  🔴 已埋设   bg: foreshadow-planted/20%  text: foreshadow-planted
  🟡 已呼应   bg: foreshadow-echoed/20%   text: foreshadow-echoed
  🟢 已回收   bg: foreshadow-resolved/20% text: foreshadow-resolved
  ⚫ 已放弃   bg: foreshadow-abandoned/20% text: foreshadow-abandoned

角色定位标签：
  主角     bg: role-protagonist/20%  text: role-protagonist
  女主     bg: role-heroine/20%      text: role-heroine
  配角     bg: role-supporting/20%   text: role-supporting
  反派     bg: role-villain/20%      text: role-villain
  导师     bg: role-mentor/20%       text: role-mentor

章节状态标签：
  草稿     bg: text-muted/20%   text: text-muted
  已大纲   bg: info/20%         text: info
  写作中   bg: warning/20%      text: warning
  已完成   bg: success/20%      text: success
```

### 4.6 Toast/通知

```
位置: 右下角
持续: 3秒自动消失（错误消息不自动消失）

类型：
  ✅ 成功: "项目创建成功"
  ⚠️ 警告: "API Key 未配置，AI功能不可用"
  ❌ 错误: "连接失败：API Key 无效"
  ℹ️ 信息: "数据已自动保存"
```

---

## 5. 页面布局

### 5.1 首页布局

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  🔥 StoryForge                    ⚙️ AI设置  🐙  │   │  顶栏 h-14
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │                                                  │   │
│  │  我的作品                          [📥 导入项目]  │   │
│  │                                                  │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐           │   │
│  │  │   ＋    │ │ 🗡️      │ │ 🏙️      │           │   │
│  │  │         │ │ 剑道独尊 │ │ 都市修仙 │           │   │
│  │  │ 新建项目 │ │ 玄幻     │ │ 都市     │           │   │
│  │  │         │ │ 12章     │ │ 5章      │           │   │
│  │  │         │ │ 3.2万字  │ │ 1.5万字  │           │   │
│  │  │         │ │ 3天前编辑 │ │ 1周前    │           │   │
│  │  └─────────┘ └─────────┘ └─────────┘           │   │
│  │                                                  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  StoryForge v0.1.0 | 开源 AI 小说创作工坊        │   │  页脚
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**布局参数**：
- 最大宽度: 1200px，居中
- 项目卡片: 网格布局 `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`
- 卡片高度: 约 200px

### 5.2 工作台布局（三栏）

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← 返回  │  《剑道独尊》              [⚙️ AI设置] [📤 导出] [💾]   │  顶栏 h-12
├──────┬───────────────────────────────────────────────┬───────────────┤
│      │                                               │               │
│ 侧边栏│              主编辑区                          │   属性面板     │
│ w-56 │          flex-1 (自适应)                       │   w-80        │
│      │                                               │               │
│ 📋基本│                                               │               │
│ 🌍世界│                                               │               │
│ 💫故事│                                               │               │
│ 👤角色│                                               │               │
│ ⚔势力│                                               │               │
│ 💪力量│                                               │               │
│ 🗺地理│                                               │               │
│ 📜历史│                                               │               │
│ 💎道具│                                               │               │
│ 📐规则│                                               │               │
│ ────│                                               │               │
│ 📖大纲│                                               │               │
│ ✍写作│                                               │               │
│ 🔮伏笔│                                               │               │
│      │                                               │               │
├──────┴───────────────────────────────────────────────┴───────────────┤
│  字数：42,300 | 章节：12/30 | 模型：deepseek-chat | ✅ 已连接        │  状态栏 h-7
└──────────────────────────────────────────────────────────────────────┘
```

**布局参数**：
- 侧边栏: 固定宽度 224px (w-56)，可折叠为图标模式 (w-14)
- 主面板: flex-1，最小宽度 500px
- 属性面板: 固定宽度 320px (w-80)，可折叠隐藏
- 状态栏: 固定底部 h-7

### 5.3 侧边栏导航项

```typescript
const SIDEBAR_ITEMS = [
  // 世界构建组
  { key: 'project-info', icon: '📋', label: '基本信息', group: 'world' },
  { key: 'worldview',    icon: '🌍', label: '世界观',   group: 'world' },
  { key: 'story-core',   icon: '💫', label: '故事核心', group: 'world' },
  { key: 'characters',   icon: '👤', label: '角色管理', group: 'world' },
  { key: 'factions',     icon: '⚔️', label: '势力阵营', group: 'world' },
  { key: 'power-system', icon: '💪', label: '力量体系', group: 'world' },
  { key: 'geography',    icon: '🗺️', label: '地理环境', group: 'world' },
  { key: 'history',      icon: '📜', label: '历史年表', group: 'world' },
  { key: 'items',        icon: '💎', label: '道具系统', group: 'world' },
  { key: 'rules',        icon: '📐', label: '规则约束', group: 'world' },
  // 分隔线
  { type: 'divider' },
  // 创作组
  { key: 'outline',      icon: '📖', label: '大纲',     group: 'writing' },
  { key: 'writing',      icon: '✍️', label: '写作',     group: 'writing' },
  { key: 'foreshadows',  icon: '🔮', label: '伏笔',     group: 'writing' },
];
```

### 5.4 响应式断点

| 断点 | 宽度 | 布局调整 |
|------|------|---------|
| `lg` | ≥ 1280px | 三栏完整展示 |
| `md` | 1024-1279px | 侧边栏折叠为图标，属性面板浮层 |
| `sm` | 768-1023px | 侧边栏抽屉，属性面板浮层 |
| `xs` | < 768px | 全部浮层/标签页切换（基本可用） |

---

## 6. 交互规范

### 6.1 AI 生成交互

```
┌─────────────────────────────────────────┐
│  AI 生成区域                             │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │
│  │  流式文字输出...                 │    │  边框: accent (动画闪烁)
│  │  █ 光标                         │    │  背景: bg-elevated
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ████████████░░░░░░  67%  已生成: 1.2k字 │  进度条
│                                         │
│  [⏹ 停止]  [✅ 采用]  [📋 复制]  [🗑]   │  操作栏
└─────────────────────────────────────────┘

状态流转：
  空闲 → 点击生成 → 加载中(spinner) → 流式输出 → 完成
                                    → 用户点停止 → 部分内容
                                    → 错误 → 显示错误信息 [重试]
```

### 6.2 自动保存

```
用户输入 → debounce 1s → 写入 IndexedDB → 状态栏显示 "✅ 已保存"
                                       → 失败时显示 "⚠️ 保存失败"
```

### 6.3 删除确认

所有删除操作都需要二次确认：

```
┌────────────────────────────────────┐
│  ⚠️ 确认删除                       │
│                                    │
│  确定要删除角色"陈风"吗？            │
│  此操作不可恢复。                   │
│                                    │
│           [取消]    [删除]          │
└────────────────────────────────────┘
```

### 6.4 快捷键（Phase 5）

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl + S` | 手动保存 |
| `Cmd/Ctrl + Enter` | AI 生成/确认 |
| `Escape` | 停止 AI 生成 / 关闭弹窗 |
| `Cmd/Ctrl + B` | 切换侧边栏 |
| `Cmd/Ctrl + ]` | 切换属性面板 |

---

## 7. 图标方案

### 7.1 主图标

- **来源**: Lucide Icons（开源，MIT 协议，与 shadcn/ui 配合好）
- **大小**: 侧边栏 20px，工具栏 16px，按钮内 14px
- **颜色**: 默认 text-secondary，hover/active 时 text-primary

### 7.2 Emoji 导航图标

侧边栏导航使用 Emoji 作为图标（如上 SIDEBAR_ITEMS），理由：
1. 不需要额外图标库
2. 辨识度高，每个模块一目了然
3. 跨平台一致性可接受
4. 如后续需要可替换为 Lucide 图标

---

## 8. 动画与过渡

### 8.1 基础过渡

```css
/* 默认过渡 */
transition: all 0.15s ease;

/* 面板展开/收起 */
transition: width 0.2s ease, opacity 0.15s ease;

/* 弹窗出现 */
animation: fadeIn 0.15s ease, scaleIn 0.15s ease;

/* 流式文字光标 */
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
```

### 8.2 原则

- **快速**: 不超过 200ms
- **克制**: 只在必要时使用动画
- **不阻塞**: 动画不应阻止用户操作
- **可关闭**: 尊重 `prefers-reduced-motion`
