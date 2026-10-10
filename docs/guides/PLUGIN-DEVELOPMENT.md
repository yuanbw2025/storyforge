# 插件与创意工坊开发约定

> 1.0 体验版 · API 1 · SDK 0.1（开发预览）· 2026-10-08。
> 本文约束当前已经实现的接口；总体施工边界见 [插件施工契约](../roadmap/PLUGIN-WORKSHOP-V1.md)。

## 文档与 AI 开发入口

面向使用者的教程位于 `website-docs/workshop/`，包含能力、安装、开发、AI 协作、发布和恢复；英文在 `website-docs/en/workshop/`。工坊内“使用指南”和“开发与发布”直接提供入口。

`tools/plugin-sdk/authoring/` 维护开发 Skill、通用指令和验收清单。运行 `npm run plugins:build-kit`，从本文、公开类型、教程和示例生成下载资料包，同时用于应用和知识库；`npm run plugins:check-kit` 检查内容摘要与两处产物，禁止手工编辑生成副本。资料包仅是开发参考，构建仍使用匹配的宿主仓库和 Node.js 24 环境。社区 SDK 未发布到 npm。

## 作者和使用者分别需要什么

普通作者只需浏览器中的 StoryForge。从“创意工坊”选择插件或导入 `.sfplugin`，选择作品或世界，确认信任后启用。安装不会运行代码、安装 npm 依赖或启动本机服务。安装包保存在当前浏览器 Origin 的 IndexedDB；换浏览器、端口或网站地址不会自动迁移。

开发者需要项目规定的 Node 环境和仓库依赖。工坊是静态目录和本地管理器；社区可以通过 GitHub Pages 等静态托管维护自己的目录，也可以直接分发文件。当前没有社区账户、评分、收费、自动审核或上传服务器。向官方目录发布采用 PR，经作者许可与功能验证后登记；工坊不执行远程安装脚本。

该版本入口默认隐藏，直接访问应用 `/workshop` 并开启开发预览后显示首页入口。使用测试作品体验；现有产品的默认界面保持原有行为。

## 功能包的最小路径

在 StoryForge 仓库执行：

```sh
npm ci
node tools/plugin-sdk/cli.mjs create ../my-plugin
node tools/plugin-sdk/cli.mjs check ../my-plugin
node tools/plugin-sdk/cli.mjs pack ../my-plugin ../my-plugin.sfplugin
```

先编辑生成的 `manifest.json`，将 `id` 改为自己的命名空间，例如 `yourname.writing-notes`；名称、作者和许可也应改为自己的。代码位于 `src/index.tsx`；样例类型通过 `@storyforge/plugin-sdk` 导入。`check` 使用宿主相同的声明校验器并执行严格 TypeScript 检查；`pack` 将依赖捆绑成一个包内 ESM 工厂，复用宿主 React 和 JSX runtime，不打包第二份 React。

入口示意：

```tsx
import { useState } from 'react'
import type { ExtensionDefinition } from '@storyforge/plugin-sdk'
export default {
  activate(ctx) {
    function MyPanel() {
      const [text, setText] = useState('')
      return <textarea aria-label="自己的功能" value={text}
        onChange={event => setText(event.target.value)}/>
    }
    ctx.ui.registerView('notes', MyPanel)
  },
} satisfies ExtensionDefinition
```

清单须声明对应的 `views`。上述片段只展示界面；持久化、刷新恢复、并发修改的完整实现见仓库 `examples/plugins/writing-notes`。公开类型来自 `tools/plugin-sdk/index.d.ts`，构建示例时由宿主规范自动同步。

禁止导入宿主私有组件、Store、数据库和内部 AI 模块。支持开发时捆绑依赖，不支持运行时从 CDN 动态导入。包内资源放入 `assets/`，通过 `ctx.resources.url()` 获取受生命周期管理的 Blob URL。

## 包与清单

包是 ZIP，后缀 `.sfplugin`。根目录必须有 `manifest.json`；功能包具有包内 `.js` 入口。压缩体积上限 16 MiB，展开上限 32 MiB，最多 256 个文件。宿主校验目录、路径、实际解压长度、CRC 和整包 SHA-256，安装时不求值代码。

| 字段 | 约定 |
| --- | --- |
| `format` / `api` | 均为 1；未知版本和未知清单字段拒绝安装 |
| `id` / `version` | 作者命名空间；准确的 `x.y.z`，没有版本范围或隐式 latest |
| `name` / `description` / `author` / `license` | 必填、非空 |
| `kind` | `feature` 功能插件、`content` 无代码内容包、`bundle` 无代码组合包 |
| `owner` | `world` 或 `work`；不能同时拥有两者 |
| `entry` | 仅功能包使用，指向包内脚本 |
| `dependencies` | 其他插件的准确版本映射；依赖 owner 必须一致 |
| `permissions` | 使用的 SDK 能力声明，见下一节 |
| `views` | 界面贡献，每项具有 id、title、target、mode |
| `schemas` | 自有记录的 schema ID → version/schema |
| `provides` / `consumes` | 插件之间明确提供、消费的服务 ID |
| `networkOrigins` | 明确的 HTTPS origin 或本机 HTTP origin，不能是路径或通配符 |
| `content` | 初始纯 JSON 记录，须符合声明的 schema |
| `flows` | 已登记宿主节点构成的流程，须声明 flows 权限 |
| `aiTasks` | 本插件任务 id、提示、允许的注册上下文和输出 schema |
| `worldSemantics` | 从 world 自有记录到正式词条的明确字段投影 |
| `rulePacks` | 本插件命名空间中的版本化跑团规则 JSON 资源 |
| `connectors` | MCP 连接 id、标题、准确地址、协议版本、允许调用的工具名 |

安装身份由 `id + version + SHA-256` 确定。同版本不同字节不能覆盖，修改后应增加版本。官方参考包在首次正式发布前属于开发样例，不应当作已稳定发布的第三方依赖。

## SDK 接口与边界

| 接口 | 能力及必要声明 |
| --- | --- |
| `ui.registerView` | 只注册清单中的界面。`workbench/add` 添加工作台；`history` 和 `story-timeline` 可 add 或 replace |
| `data.list/put/remove` | `data`；本插件、本作用域、当前数据代，写入带 schema 和预期 revision |
| `domain.history.list/create` | `history.read/write`；世界归世界历史，作品归故事进程，写入复用正式手动领域接口 |
| `ai.openReview` | `ai.history` 或 `ai.timeline`；打开宿主正式 AI 面板，由作者明确开始并确认候选 |
| `ai.propose` | `ai.tasks` 和 `data`；一个独立任务生成一个自有记录候选，经作者确认后正式采纳 |
| `world.publish` | `world.publish`；打开世界语义预览，确认后通过现有 adopt 写入世界词条 |
| `rules.install` | `product.rules`；在跑团作品内验证并导入不可变版本的 RulePack |
| `tools.open` | `mcp`；打开宿主确认面板，不直接执行工具或返回宿主令牌 |
| `flows.open` | `flows`；宿主展示确认，复制声明的图到当前长篇节点工作台；不会自动运行模型 |
| `services.provide/call` | 提供自己的命名空间服务；消费者必须声明服务并锁定提供者依赖，输入输出为 JSON 克隆 |
| `network.fetch` | `network` 和 origin 声明；GET/POST JSON，省略浏览器凭据，拒绝重定向，30 秒超时，响应最多 1 MiB |
| `resources.url` | 包内资源 Blob URL，在停用时释放 |
| `lifecycle.onDispose` / `signal` | 清理监听器、计时器和异步任务；SDK 在停止后拒绝新的操作 |

替换只替换展示与交互入口，不取得官方数据的所有权。一个作用域内，同一目标不能有两个替换者。激活按依赖顺序，停用依赖前须先停用消费者；生命周期清理顺序相反。插件激活失败不启用它的依赖消费者，UI 抛错回退到原面板。

**可信代码模型**：原生 UI 插件和宿主同源执行，声明校验不是权限隔离沙箱。插件作者必须被用户信任；不要向用户宣称恶意插件无法访问其本地数据。错误边界和异步超时不能终止主线程死循环。`?safe-plugins=1` 在模块求值前跳过插件；工坊“安全模式”也可停用故障插件。UI 插件应将重计算自行放入 Worker，界面线程只处理交互；本版未提供标准 Worker 入口协议。

## 数据、迁移与恢复

包全局安装，配置和记录归某个稳定 World/Work。插件不能把本地数字 ID 塞进不透明 payload 并期待导入器猜测重映射；章节和历史关联使用 SDK 的显式 `chapterId`、`historyEventId`。相应核心记录删除时引用清空，插件记录保留。

`put` 必须带 `expectedRevision`：新增用 null，修改用读到的 revision。重复编辑发生冲突时返回错误，插件应提示刷新，不能自动覆盖。schema 采用有界的 JSON Schema 子集：object、array、string、number、integer、boolean、null，properties、required、additionalProperties、items、enum 和有限长度/数值边界；不支持 `$ref`、动态代码、远程 schema、正则和任意格式推断。

停用与卸载保留记录及版本契约。工坊工作台在缺包时仍展示原始内容；完整作品备份包含配置、数据、契约和操作回执，但不包含可执行安装包。导入后配置一律停用，作者重新安装匹配的包并确认后才执行。旧 AI 候选、作者修改与工具结果作为只读历史副本保留；不恢复旧任务的写入权限，也不查询或取消原作品的外部任务。重新创作须在新作品中明确开始。

升级前先停用本插件及依赖它的插件，安装新版本并选择“切换到此版本”。若 schema 版本变化，入口须提供同步、纯数据的 `migrate(record, targetSchemaVersion)`，返回新 payload；不得在迁移时写 DB、调用网络或制造其他副作用。宿主逐条验证后在单一事务中生成新数据代，再切换指针；校验失败、并发变化或事务失败保留旧数据。相同 schema 版本不能改变定义；不允许丢弃仍有记录的 schema。

“数据恢复与操作记录”可选择以前的数据代。恢复也是复制为新一代，保留恢复前的较新编辑，不原地删除或倒退 generation；对应旧包不存在时提示重新安装。备份协议升级为 15，只明确转换完整的版本 14 备份；缺表、损坏或其他历史格式仍拒绝。

## AI、世界与产品契约

`aiTasks` 声明 `id/title/instruction/outputSchema/contextSources`。例如 `examples/plugins/idea-cards` 的任务生成一张灵感卡片；插件使用 `ctx.ai.propose('brainstorm', 'idea_1', '作者要求')` 打开宿主面板，作者点击开始后才调用模型。任务读取自己的当前记录与明确选中的 `worldview/storyCore/characters/historical/storyTimeline` 注册源；不能指定任意表或文件。

开始时冻结插件版本、schema、作用域、目标 revision 和 RegistrySnapshot。宿主登记 `extensions.generate` Skill 与正式 AI 入口，复用 Context Gateway、CreativeArtifact、durable Harness 和 `adopt()`。模型结果先成为可编辑候选；对象的简单字段显示为表单，复杂结构可编辑 JSON。保存候选支持刷新恢复；确认时重新验证来源、插件启用状态、数据代与 revision，并在单一事务中完成采纳和回执。过期候选、未知结果和非重试错误不会暗中重发。每次作者开始最多一次模型调用；历史面板无需安装插件即可读取已保存候选。

`ai.openReview` 仍可进入宿主已有历史/时间线面板，其 instruction 是作者可见的建议。流程包 `flows.open` 复制后归作品所有，卸载不删除流程或生成结果；真正运行由现有 NodeFlow/Harness 快照冻结配置。节点配置不能携带本机记录 ID、密钥或宿主私有绑定。

世界扩展使用 `worldSemantics` 显式列出标题、摘要、描述和其他简单语义字段。`ctx.world.publish(id, recordKeys)` 先预览，作者确认后复制到现有世界 Codex 分类与词条，记录插件版本、摘要和来源。未选择字段、界面布局和运行态不进入 WorldRelease。确认后的词条独立归世界，后续插件编辑不自动同步；重复确认幂等，已有不同正式内容拒绝自动覆盖。其他产品通过原有版本化 WorldRelease/Gateway 读取，无需安装来源插件。参考 `world-festivals`。

游戏规则首个专业适配是 TTRPG 的现有 RulePack DSL，不执行任意插件 JavaScript。`ctx.rules.install(id)` 导入跑团作品自己的规则库；规则 ID 必须是 `plugin.id.rule-id`，版本与插件一致，结构及内置验算全部通过，相同规则版本不同内容拒绝覆盖。作者在产品定向中选择后，完整规则内容、schema/运行协议和 hash 随正式 ProductRelease 冻结。新插件不修改旧发布与旧存档。其他产品的专业算法替换尚未统一开放，不能以通用工作台入口代替各产品适配。

## MCP 与可选本机桥

连接声明示例：

```json
{"id":"reference","title":"资料工具","url":"http://127.0.0.1:43127/mcp/reference","protocol":"2026-07-28","tools":["lookup"]}
```

插件调用 `ctx.tools.open('reference', 'lookup', {query:'灯塔'})`。宿主展示地址、工具与发送内容，访问令牌只在宿主本次页面的内存中填写，不加入插件 API、清单、检查点或备份。令牌之外的工具参数与结果会作为本地执行记录保存，开发者不要把凭据作为业务参数传入。

浏览器适配锁定官方 `@modelcontextprotocol/client@2.3.1` 和 `@modelcontextprotocol/ext-tasks@0.2.2`，使用 Streamable HTTP。新协议明确固定为 2026-07-28；旧服务须明确声明 `legacy`，通过官方初始化协商，当前回归覆盖 2025-11-25。不开启不透明的自动降级。工具名称必须同时出现在插件清单与服务目录；输入按服务 schema 验证，响应有大小和时间边界，不跨地址重定向。

Tasks 与基础协议独立协商，长任务标识由官方扩展生成并存入宿主 durable 检查点。点击“查询已有任务”只查询已登记 ID，不重放原始调用。结果未知且未拿到任务 ID 时，停止并让作者在外部服务核实。确定性工具运行的模型预算为零，没有 AI 上下文或正式写回权限；其专用回执保存真实请求与结果 hash，不伪造 AI Context Manifest。结果作为参考显示，不能直接写入受治理作品表。

Apps 界面、sampling、roots 与额外交互授权目前不广告为支持，也不因支持 Tasks 自动启用。普通文本/JSON 工具输出仍可读取；需要这些能力的工具会明确失败。原生 UI 插件属于可信同源代码，因此“宿主不通过 SDK 交出令牌”不是恶意代码隔离保证。

需要本机程序时使用 [可选本机桥](../../tools/mcp-bridge/README.md)：Node.js 22+、准确 Origin、临时配对令牌、本机配置中的命令和工具白名单。插件不能让桥启动任意程序。桥仅支持 2026 的无状态 stdio 请求；旧式服务应提供自己兼容的 HTTP 端点。开发机 macOS 已测试真实 stdio 子进程，Windows/Linux 安装器及平台认证未提供。普通插件运行不需要这个桥。

技术依据：[官方 SDK 版本](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1)、[Tasks SDK](https://tasks.extensions.modelcontextprotocol.io/typescript/)、[Tasks V2 适配器约定](https://modelcontextprotocol.github.io/ext-tasks/typescript/adapters-and-schemas.html)。

## 发布一个社区目录

参考 `public/workshop/catalog.json`。目录包含 `format: 1`、name、entries；每项包含包 id/version/name/description/author/kind/owner/url/digest/dependencies。URL 可以相对目录地址，网络托管须提供正确 CORS。SHA-256 必须与下载的 `.sfplugin` 字节完全相同；所有依赖也应在目录中出现。

```sh
node tools/plugin-sdk/build-examples.mjs
```

该命令重建官方参考包、公共类型和摘要目录，并保留其他身份／版本的社区目录条目；重建后再执行 `npm run plugins:build-kit` 同步开发资料。维护者仍需审查目录差异与包版本不可变性。社区发布者可先通过本地文件安装验证，再在工坊“添加社区目录”填写自己的 HTTPS JSON 地址。目录和包下载有大小/时间限制；读取目录、下载依赖不会启用代码。该版不自动后台更新、自动迁移或自动启用升级。

## 验证清单

提交插件前验证：独立安装、与依赖共同运行、跨作品隔离、刷新恢复、停用再启用、卸载重装、导出导入、升级失败、历史代恢复、UI 异常回退和安全启动。安装包必须独立于源代码仓库；用户运行无需开发环境。外部服务失败要在插件内显示并可重试；禁止无限隐藏重发。

宿主对应验证在 `tests/extensions/plugin-lifecycle.test.ts` 与 `tests/e2e/plugin-workshop.spec.ts`。十二个参考包覆盖自有数据、复杂界面、模块替换、服务依赖、内容/组合包、独立 AI 候选、正式流程组合、世界语义、冻结规则与外部工具。测试外部 HTTP 使用可重复模拟，不能据此声称外部网站可用性已经得到保障。
