# 新版 UI 展示预览

本目录保留 199 个已确认样式的示例页面。独立 HTML 预览继续作为视觉设计参考；正式应用不再挂载这些组件，所有产品路由均进入各自真实页面。预览中的文案、数据和交互只代表样式示例。

- `src/catalog.ts` 定义产品、页面、字段和内部覆盖编号。
- `src/PreviewApp.tsx` 管理展示状态与弹窗；`src/main.tsx` 是独立 HTML 启动入口。独立预览使用 hash 导航，正式应用使用 React Router，二者不共享页面运行态。
- 不导入正式应用的 store、DB、AI、registry 或业务服务，不注册 service worker。
- 复用 `public/demo-assets/mist-harbor` 与 `public/prototypes/tidewake-town/media` 中的既有示例图。本目录只新增纸面外框背景、地图与少量本地示例素材。
- 原始云文档设计参考图与内部审核材料不包含在公开预览中。

Vite 使用独立 HTML 构建入口。运行 `npm run dev` 后可打开 `/storyforge/ui-preview/index.html#home/today`。`npm run build` 同时检查预览 TypeScript 并生成页面；独立 HTML 预览不启动业务数据库，也不进入正式应用路由。预览入口保持原有 PWA 排除规则。

后续实装必须按产品逐步接入现行契约，示例中的「已保存」「已发布」等状态不代表真实业务能力或写入结果。

## 新版应用导航

- `/storyforge/`：新版首页；`/storyforge/long`：已接入功能的长篇。
- `/storyforge/short`、`/world`、`/script`、`/comic`、`/motion`、`/ttrpg`、`/chat`、`/town`、`/avg`、`/adventure`、`/openworld`（均在 `/storyforge` 基址下）：对应正式应用中各产品自己的页面。可选末段为页面 ID，例如 `/storyforge/short/intent`。
- 顶部产品名称与顺序统一来自 `catalog.ts`，不再合并为“其他作品”。
- 原 `?tab=...` 深链接只由正式应用的兼容解析器转向当前产品入口；新版顶部导航和返回首页不经过旧版总览。
- 预览页面的示例操作只改变内存，不创建作品、不采纳内容、不调用业务模型。后续逐个产品替换页面内容与操作。

独立静态预览只供样式参考；其中任何“已保存”“已发布”或示例按钮都不是正式产品能力证据。
