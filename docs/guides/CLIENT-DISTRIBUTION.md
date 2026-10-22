# Windows、macOS 与 Android 客户端分发

> L4 工程操作说明 · 2026-10-15 · 当前为客户端候选实现，尚未发布新的正式 Release。

## 边界与关联闭包

- 产品：共享运行与分发底座；属于 StoryForge 产品能力研发，不改变作品生产的 S1/S2/S3。
- 交接物：Windows NSIS 安装器、macOS DMG、更新元数据、Android APK、构建与校验结果。
- 数据 owner：Work、World 和各产品媒资 owner 沿用现有契约；不新增数据库表、AI 上下文源或 AI 写字段。
- 入口：`scripts/desktop/main.mjs`、Android `MainActivity` → 已有 React 入口 → 原三注册表与 schema。Windows 复用 `createPortableServer()` 与本机 Codex bridge；Android 只适配 HTTPS 流与系统文件保存，不复制模型生成、候选采纳或导入导出链。
- 更新入口：启动后检查、设置中的客户端更新 → 固定 GitHub 仓库 → 用户确认下载 → 完整性校验 → 用户确认安装。更新不读写作品表、不上传作品或 API Key。
- 备份：`downloadJSON()` 继续调用原有备份序列化；Android 保存文件必须收到系统写入结果后，调用方才可继续替换等操作。取消保存应阻断依赖这次备份的操作。

## 构建

使用 Node.js 24 和锁文件安装依赖：

```sh
npm ci
npm run test:clients
npm run build:windows
```

Windows 推荐在 Windows 机器或 `Build Windows and Android Clients` Actions 上构建，输出 `release/windows/StoryForge-<version>-windows-x64-setup.exe`、`latest.yml` 与 `.blockmap`。macOS 交叉构建还依赖 electron-builder 的 Windows 工具运行环境。`npm run desktop:dev` 可启动本机开发窗口。

Android 需要 JDK 21、Android SDK Platform 36，构建工具由当前 Android Gradle Plugin 解析（本地验证使用 Build Tools 35.0.0），设置 `JAVA_HOME`、`ANDROID_HOME`：

```sh
npm run build:android
```

默认得到 `release/android/StoryForge-<version>-android-debug.apk`。测试包的应用 ID 为 `com.storyforge.client.dev`，不参与正式更新。正式包使用固定 `com.storyforge.client`，先提供下列环境变量，再运行：

```sh
npm run build:android:web
node scripts/distribution/build-android.mjs --release
```

| 环境变量 | 含义 |
|---|---|
| `ANDROID_KEYSTORE_PATH` | 本机永久签名文件的绝对路径 |
| `ANDROID_KEYSTORE_PASSWORD` | 签名库密码 |
| `ANDROID_KEY_ALIAS` | 固定密钥别名 |
| `ANDROID_KEY_PASSWORD` | 密钥密码 |

签名文件和密码不得提交 Git。它们需要由维护者另作安全备份；丢失签名通常无法更新已安装 APK。CI 使用 `ANDROID_KEYSTORE_BASE64` 保存签名文件，另外三个同名密码/别名 Secrets；工作流只在临时目录还原并在结束时删除。未配置签名会阻断正式构建，不能改成 debug 签名绕过。

## 更新与发布

1. 版本唯一来源为 `package.json`。Android `versionCode = major × 1,000,000 + minor × 1,000 + patch`；每段 0–999，正式渠道只接受稳定 `x.y.z`。版本必须递增，不要改公式、应用 ID 或签名。
2. 先通过项目既有 CI、E2E、客户端定向检查，并完成两版本覆盖安装与备份恢复验证；在维护者授权的版本范围内发布。
3. 现有 `release.yml` 在便携包和三平台客户端都成功后，向同一个 GitHub Release 上传 `.exe`、`.dmg`、`.blockmap`、`latest.yml`、`.apk`、便携 ZIP 与 `SHA256SUMS.txt`，最后公开 Release。客户端构建工作流手动执行只生成 Actions artifacts，不公开 Release。
4. 公开后的版本不可覆盖。不要单独提前发布更新元数据，也不要在缺少 Android 包时把 Windows 更新先置为 latest。新版本应使用新 tag 和 release notes。
5. 安装操作先等待现有待保存编辑协调器完成写入，失败则阻断安装。Windows 由 `electron-updater` 检查与下载；禁用自动下载、退出时自动安装、预发布和降级。下载与退出安装各有原生确认窗口。GitHub 下载失败仍可使用当前安装。可通过 `CSC_LINK` / `CSC_KEY_PASSWORD` 接入 Windows 代码签名；未配置时为未签名安装器，系统可能提示未知发布者。
6. Android 只检查固定仓库最新稳定 Release，精确匹配 APK 名称与 URL，验证 GitHub asset SHA-256、APK 包名、递增版本号和当前签名，再调用系统安装器。首次需要用户允许“安装未知应用”。下载或校验失败不得启动安装；用户取消系统安装时旧版保留。

## 数据保持

Windows 固定用户目录 `%APPDATA%/StoryForge`，固定本地地址 `http://localhost:17831/storyforge/`；端口冲突时停止，不改端口。Android 固定 `https://localhost/storyforge/` 和应用 ID。升级不执行清库或卸载；数据库仍由现有 Dexie 发布迁移管理。不要用卸载、清除应用数据、改 origin 或降级来解决升级错误。

浏览器便携版、Windows 客户端、Android 是独立存储容器。首次迁移应在旧版导出完整 JSON，在客户端显式导入。原浏览器数据不会自动移动。应用更新不等于跨设备同步。

Android 禁用系统自动云备份，避免把用户选择保存的密钥交给系统备份；完整备份由用户自行导出。APK 在后台可能被系统终止，长时间生成应保持应用前台；结果不确定时不要自动重发。Android 无法使用电脑上的本机 Codex CLI，也不支持浏览器目录句柄备份；普通模型服务使用 HTTPS。

## 验收与当前限制

### 跑团本机配音的安装包接入（开发候选）

桌面端和浏览器便携版复用现有 `/storyforge/local-tts/v1` 产品 bridge。操作者须在启动应用的进程中明确配置已有的 `STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR`；使用 Qwen 时还须配置已完成独立资产准入的 `STORYFORGE_TTRPG_QWEN_TTS_RUNTIME_DIR`。运行库安装、资产核验与许可边界见 [本机语音说明](../../scripts/ttrpg-local-tts/README.md)。本增量不下载模型、不安装 Python、不调用模型或自动采用音轨；当前固定运行库仅在 macOS Apple Silicon 验证，不因 Windows/Linux 包含脚本就宣称这些平台支持新生成。Android 和静态网页不提供本机 Python 服务，已采用音频的播放另按原媒资兼容路径验收。

`local-tts-files.cjs` 从三个当前 product profile 派生同一份精确源码闭包，逐文件校验原 SHA-256，并携带必要的描述、登记证明及许可。便携包保留相对路径；Electron 把同一闭包放在 `resources/local-tts/`，由固定的主进程路径加载，使 Python 能读取实际文件。相关 TypeScript/AI 登记文件只用于原有实现核验，不需要作者的仓库、Git 或 npm 依赖，也不通过网页提供。模型、运行库、任务目录、个人路径和浏览器资料不打入资源包。

未配置或初始化失败时接口返回明确的 JSON 不可用结果，普通应用仍能启动。接口继续要求 loopback、同源和 `X-StoryForge-TTS: 1`；查询及创建等待任务不启动语音，启动、租约、停止、原始结果核查仍沿原唯一任务。初始化失败不在后台反复重试；修正配置后重新启动应用。不能通过修改包中脚本绕过原 profile 校验或为旧任务取得新执行权。

打包回归覆盖独立资源目录的三 profile 核验、真实便携复制函数、Electron 资源路径、同源 HTTP、等待任务幂等与取消后不能启动；使用合成运行库记录，模型调用为零。`smoke-package.py` 再用包内 Node 核验物理资源。实际安装后的 Qwen 生成、两种声线听感、权利确认、采用与完整游戏仍须单独验证，不能以这些工程检查代替。

### 客户端通用验收

- `npm run test:clients`：更新状态、原生确认门、非法 IPC、网络异常、SSE 分块/取消、网页不出现客户端更新入口。
- `node scripts/desktop/smoke.mjs`：独立临时 profile 中启动、renderer 无 Node 权限、重启后 IndexedDB/localStorage 保留。Windows Actions 对真正的解包程序执行此检查。
- Android `testDebugUnitTest`：稳定版本顺序、下载来源白名单与反例。
- Android `:app:connectedDebugAndroidTest`：在隔离模拟器中启动打包 WebView，检查固定 origin、原生插件、HTTPS 限制及 Activity 重建后的 IndexedDB/localStorage；不等于两版本覆盖升级验收。只执行本应用测试，不运行依赖库自带的测试应用。
- 发版前人工/设备验证：旧版保存实际作品与媒资 → 导出备份 → 安装更高版本 → 核对内容与存档 → 重启 → 导入备份；取消安装、网络中断、磁盘不足、签名不匹配均应保留旧版。
- 单元测试和重启探针不等于两版本安装器升级验收。当前还需 Windows 真机与 Android 真机的覆盖升级验收、移动端所有产品的触屏/键盘布局验收，以及首次公开 Release 后的真实 GitHub 更新验证。
- Android 完整 JSON 和数据管理页文本导出已接系统保存；其他专用媒资/独立网页游戏导出入口仍需逐项设备验收，不能因此宣称所有网页能力已完成移动适配。

参考：[Electron 更新](https://www.electron.build/v26/docs/features/auto-update/)、[Capacitor 原生代码](https://capacitorjs.com/docs/android/custom-code)、[Android 签名](https://developer.android.com/studio/publish/app-signing)。

## 客户端反馈与观测候选增量

本增量依赖客户端 PR #142 与本地故障摘要 PR #144；未发布前不代表固定下载包具备这些能力。属于总纲 §8 共享工程底座的产品研发，数据 owner 为安装环境及维护者反馈服务；不涉及 S1/S2/S3、世界引用、作品媒资、AI 上下文/采纳或 PROJECT_TABLES。安装偏好和有界队列使用独立 localStorage 键，不进入作品导出。服务器独立 SQLite 保存运营数据，由 platform 仓库管理迁移、过期与删除。

统一 HTTPS 接口 `/v1/client-support/{events,feedback,forget}`，协议 version=1。客户端包不携带后台管理凭证。反馈必须点击确认；只有回执 id 与请求 id 一致才显示成功，未知结果保留同一请求 id 供手动重试。错误正文、手稿、Prompt、模型回复、密钥、完整 URL/磁盘路径、屏幕和内存转储不进入自动协议。

统计首次观测与活跃采用安装随机 UUID，服务器使用私有 HMAC 摘要；按北京时间和独立安装/日期去重。D1/D7 为精确自然日 cohort，未成熟显示 null；离线补传最长 30 天，cohort 在延迟窗口后固化汇总。Debug APK 和 Windows 测试用户目录禁用自动采集；CI 不创建安装标识。GitHub 工作流同时验证 shared feedback/diagnostics 变动。

Windows 只保存固定枚举的进程异常摘要；主进程原生硬崩溃未能捕获时只能以未正常退出提示，不能冒称已获得转储。Android Java handler 保持系统终止行为，Android 11+ 读取本应用 ApplicationExitInfo 元数据，不读取 trace 流。原生数据返回后再通过统一白名单校验。

验证包括：同安装跨升级及日内去重、离线乱序与成熟留存、删明细后的迟到重传、权限/过载/非法字段、普通 Bug 无日志提交、建议不带诊断、失败保留输入与同编号重试、关闭采集、真实打包启动和独立浏览器操作。

## 用户协议与首次启动（2026-10-16 候选）

共享客户端版本准备为 4.0.2，尚未发布正式 Release。Windows、Android 和便携包复用 `ClientAgreement` 与随包提供的 `client-legal.ts`。官网体验与开发预览不使用安装版启动门。

统一协议版本和接受时间保存在本机独立设置中，不进入作品表。当前版本未接受时不挂载编辑器或更新提示；只保留本地初始化。旧统计开关与待发记录不能越过新协议门；接受新协议前清理旧记录；同意统一协议后启用协议披露的支持处理，首启和设置均无独立上报开关。拒绝不会删除作品。设置页只提供同一份协议全文；支持记录的查询、更正、删除及撤回通过协议内联系渠道处理。存储失败不假装接受成功，后台/离线/跨页签清理与版本失效均有回归。

软件使用与故障诊断处理只在统一协议正文说明；客户端不解释后台指标。随机标识为去标识处理，不将其冒称为完全匿名。手动问题或建议仍逐次预览、确认和获取回执。

独立安装态浏览器验证：先运行 `npm run build:portable -- --outDir dist-client-verification`，再运行 `npx playwright test --config playwright.clients.config.ts`。该配置仅选择支持/协议路径，使用独立端口和浏览器资料；开发模式完整 E2E 不替代此生产模式门禁测试。Windows smoke 与 Android WebView instrumentation 同时验证单一协议入口、接受前不上传与重启持久化。

## macOS 与正式覆盖更新验证（4.0.2）

`npm run build:macos -- --arm64` 或 `--x64` 生成对应 DMG；应用使用同一桌面入口、固定 origin 和 `~/Library/Application Support/StoryForge`。当前采用 ad-hoc 签名，不是 Developer ID 签名或 Apple 公证。macOS 更新固定读取官方仓库最新稳定版，选择当前 CPU 的精确文件名，验证大小与 GitHub SHA-256；用户确认后再次验 hash、打开 DMG 并退出，由用户拖入“应用程序”替换，不假装完成无人值守安装。

`upgrade-smoke.mjs` 在隔离目录运行 4.0.1 和 4.0.2，Windows 实际运行两个 NSIS 安装器，Mac 从新 DMG 替换应用。4.0.1 的 Mac app 是测试基线，非历史公开发行。生产 `createWorkspace()`、注册表派生的完整导出/导入是测试唯一作品入口；比较完整导出，验证正文、封面、OPFS 探针、非法备份零写入与恢复后重启。此证据不代替全部产品媒资/游戏存档或真人移动布局验收。

Android 正式验证用永久密钥在本机签署测试 runner，测试 runner 与两个正式 APK 暂存于 Release 草稿，CI 只接收签名后的 APK，不接收密钥。分别安装旧 APK、执行 seed、`adb install -r` 新 APK、执行恢复和重启校验。测试 JS 只进入 androidTest 的 assets，不进入公开应用。发布前删除三个 `upgrade-test-*.apk` 附件。

没有 Actions 签名 Secrets 时，正式发布工作流读取草稿中维护者已上传的同版本 APK，校验正式应用 ID、版本和固定证书指纹。未提供正式 APK 则发布失败；不会退回 debug 包。Windows/macOS 仍由 GitHub 自动构建。iOS 本次暂缓。
