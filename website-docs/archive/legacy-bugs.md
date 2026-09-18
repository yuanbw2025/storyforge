# 故事熔炉bug收集
::: warning 历史资料
本页从原 WPS 知识库迁移，用于保留历史记录。内容可能对应旧版本，不应单独作为当前功能状态依据；当前能力请优先查看“开始使用”“功能指南”和仓库最新 Changelog。
:::



**迁移时间：**2026-07-06

**来源：**旧多维表《故事熔炉bug收集表.dbt》与功能表中拆出的 bug 和功能类反馈。

**使用方式：**后续新增 bug 请直接在本文档表格中追加；处理人统一写“开发者”。

## 填写规则

|              |                                                                                             |
|--------------|---------------------------------------------------------------------------------------------|
| **项目**     | **说明**                                                                                    |
| **必填材料** | 尽量同时提供截图 + 问题描述 + 复现步骤。无截图可先记录，但默认先标为“待复现”。              |
| **严重度**   | P0=数据丢失/无法启动；P1=核心流程阻断或严重误导；P2=普通功能异常；P3=体验/文案/低影响问题。 |
| **处理状态** | 待复现 → 待修 → 修复中 → 待审 → 打回/已关闭。状态表示当前流程节点。                         |
| **是否解决** | 最终结果，只填“未解决”或“已解决”。不要和处理状态混用。                                      |
| **处理人**   | 统一填“开发者”。                                                                            |
| **日志同步** | 修完后同步仓库 docs/CHANGELOG.md 与 WPS 更新日志。                                          |

## bug 表

<table style="width:100%;">
<colgroup>
<col style="width: 5%" />
<col style="width: 2%" />
<col style="width: 7%" />
<col style="width: 12%" />
<col style="width: 13%" />
<col style="width: 2%" />
<col style="width: 3%" />
<col style="width: 2%" />
<col style="width: 4%" />
<col style="width: 3%" />
<col style="width: 3%" />
<col style="width: 2%" />
<col style="width: 14%" />
<col style="width: 4%" />
<col style="width: 4%" />
<col style="width: 13%" />
</colgroup>
<tbody>
<tr class="odd">
<td></td>
<td colspan="6"><h3 id="报告人填写"><strong>报告人填写</strong></h3></td>
<td colspan="9"><h3 id="开发者填写"><strong>开发者填写</strong></h3></td>
</tr>
<tr class="even">
<td><strong>报告日期</strong></td>
<td><h5 id="序号"><strong>序号</strong></h5></td>
<td><h5 id="bug简述或功能优"><strong>bug简述或功能优</strong></h5>
<p><strong>需求简述</strong></p></td>
<td><h5 id="bug详细描述复现步骤">bug详细描述&amp;复现步骤</h5>
<p><strong>功能需求简述</strong></p></td>
<td><h5 id="截图"><strong>截图</strong></h5></td>
<td><h5 id="报告人"><strong>报告人</strong></h5></td>
<td><h5 id="版本环境"><strong>版本·环境</strong></h5></td>
<td><h5 id="严重度"><strong>严重度</strong></h5></td>
<td><h5 id="模块"><strong>模块</strong></h5></td>
<td><h5 id="处理状态"><strong>处理状态</strong></h5></td>
<td><h5 id="是否解决"><strong>是否解决</strong></h5></td>
<td><h5 id="处理人"><strong>处理人</strong></h5></td>
<td><h5 id="开发者批注"><strong>开发者批注</strong></h5></td>
<td><h5 id="关联分支提交"><strong>关联分支·提交</strong></h5></td>
<td><h5 id="日志已同步"><strong>日志已同步✓</strong></h5></td>
<td><h5 id="备注填写说明"><strong>备注/填写说明</strong></h5></td>
</tr>
<tr class="odd">
<td></td>
<td>1</td>
<td><strong>物品栏自定义/物品识别与编辑异常</strong></td>
<td>用户反馈：不会自动识别新章节增加的物品；手动点击 AI 识别会遍历所有章节，平白增加 token 消耗；添加道具功能无效：物品栏无法编辑，AI 识别有误无法手动修正；添加的道具只会显示新道具，无法做任何更改。</td>
<td>原功能表浮动图片/截图，待后续补贴到本文档对应条目。</td>
<td></td>
<td></td>
<td>P1</td>
<td>物品栏 / 道具管理</td>
<td>待审</td>
<td>部分解决</td>
<td>开发者</td>
<td>已实现 QUICKWIN-2：物品栏展开时间线后，可直接编辑物品名、数量、获得/消耗动作和备注；用于修正 AI 识别错误或手动新增后的“新物品”记录。根因是 useItemLedgerStore.updateEntry 已支持任意字段更新，但 InventoryPanel 只暴露 action 下拉和删除按钮，缺 itemName/quantity/note 编辑入口。回归：R-QUICKWIN2-inventory-edit；浏览器预览已确认编辑控件渲染且可通过 UI 删除测试流水。</td>
<td>codex/quickwin-inventory-edit-20260707</td>
<td>是</td>
<td>本次只解决“物品栏无法编辑 / AI 识别有误无法手动修正 / 手动添加后只能显示新物品无法更改”。未解决：新章节增量识别、避免全量遍历导致 token 浪费；这两项需单独设计抽取范围与章节脏标记机制，不能并入本 quickwin。</td>
</tr>
<tr class="even">
<td></td>
<td>2</td>
<td><strong>章节正文界面大小章节号不一致，并疑似影响上下文/物品状态一致性</strong></td>
<td>用户反馈：大章节号上方还有一个小章节号，创建新章节时大部分不一致；导入 65 章时只有第一章大小章节号一致。后续使用熔炉写了 6 章 4k 字后，AI 开始胡言乱语；前 2 章节刚获得的物品已在物品栏和状态栏的人物持有物上出现并且获得渠道可查，但新章节总是重新给该物品赋予获得途径。</td>
<td>原功能表浮动图片/截图，待后续补贴到本文档对应条目。</td>
<td></td>
<td></td>
<td>P1</td>
<td>章节正文 / 上下文一致性 / 物品状态</td>
<td>待复现</td>
<td>未解决</td>
<td>开发者</td>
<td>已记录但本轮未修。该行混合了章节号显示不一致、导入章节映射、上下文注入、物品状态丢失等多个症状；需要先确认 outlineNodes / chapters / chapterNumber / outlineNodeId 的实际数据关系，再判断是否与状态追踪同根。</td>
<td></td>
<td>否</td>
<td>P1：疑似影响正文生成和上下文一致性；需要项目导出或复现步骤。</td>
</tr>
<tr class="odd">
<td></td>
<td>3</td>
<td><strong>编辑 API 模型配置时没有明确保存按钮，修改配置不生效</strong></td>
<td>进入设置 → AI 模型配置 → 编辑已有 API 配置的 URL/Key/模型等字段 → 切换或返回后发现修改未生效；界面只有“保存当前为预设”，容易变成新增预设而不是更新当前配置。</td>
<td>原功能表文字反馈，无独立截图。</td>
<td></td>
<td></td>
<td>P1</td>
<td>AI 设置 / API 配置</td>
<td>已关闭</td>
<td>已解决</td>
<td>开发者</td>
<td>已定位：主配置 setConfig 实际即时持久化，但应用预设后编辑会清空 activePresetId，覆盖当前预设入口消失，用户只能看到“保存当前为预设”。已新增 editingPresetId 保留来源预设，并在设置页显示“保存修改到当前预设 / 另存为新预设”。回归：R-ai-config-storage。</td>
<td>codex/bug-batch-20260707 · cbd7a76</td>
<td>是</td>
<td>本项为配置预设更新路径歧义，不是主配置 localStorage/sessionStorage 持久化失败。</td>
</tr>
<tr class="even">
<td></td>
<td>4</td>
<td>点击大纲就崩溃</td>
<td>点击大纲浏览器崩溃，老问题，之前修过，用户环境偶发、多发，未根治，需要详查根因</td>
<td><p><img src="/assets/migrated/legacy-bugs/media/image1.png" style="width:3.5875in;height:14.80942in" alt="PECMI7ZIADQAU" /></p>
<p><img src="/assets/migrated/legacy-bugs/media/image2.png" style="width:3.5875in;height:4.94375in" alt="C6R547ZIABQAI" /></p></td>
<td></td>
<td></td>
<td>P1</td>
<td>大纲 / outlineNodes</td>
<td>已关闭</td>
<td>已解决</td>
<td>开发者</td>
<td>已定位：历史/导入/运行时脏大纲节点仍可能缺 summary，虽然已有 v34 迁移、导入 defaults、store 兜底，但 selector/OutlinePanel 仍假定 summary 恒为 string 并直接 .trim()。已新增 normalizeOutlineNode，store/selector/OutlinePanel 共用统一边界。回归：R-CF-outline-summary-crash。</td>
<td>codex/bug-batch-20260707 · cbd7a76</td>
<td>是</td>
<td>本地预览大纲页/章节页未再出现 summary.trim 崩溃；若用户复发，需要项目导出和完整错误栈继续查。</td>
</tr>
<tr class="odd">
<td></td>
<td></td>
<td></td>
<td></td>
<td><p><img src="/assets/migrated/legacy-bugs/media/image3.png" style="width:3.5875in;height:1.6874in" alt="5QB4Q7ZIABAHQ" /></p>
<p>用户自己用trae检查时trae的回复，如下：</p>
<h2 id="当前大纲生成的变量传递">当前大纲生成的变量传递</h2>
<p>从 outline.volume 模板 可以看到，系统已经把 storyCore 作为一个整体传入：</p>
<p>storyCore 是一个整合后的字符串，包含上述所有 7 个字段的内容。</p>
<h2 id="您需要添加的参数">✅ 您需要添加的参数</h2>
<p>如果您希望在自定义提示词中 更精细地引用故事设计的各个字段 ，需要添加以下变量：</p>
<h3 id="直接引用整体最简单">直接引用整体（最简单）</h3>
<h3 id="单独引用各个字段更灵活">单独引用各个字段（更灵活）</h3>
<p>如果您想在提示词中 单独控制每个字段的位置和格式 ，需要添加这些变量：</p>
<h3 id="添加硬约束确保不偏离主线">添加硬约束（确保不偏离主线）</h3>
<p>从 CHANGELOG 可以看到，官方已经添加了这个约束：</p>
<h2 id="推荐的完整方案">🎯 推荐的完整方案</h2>
<p>在您的提示词中添加以下内容：</p>
<ol type="1">
<li><p>&#123;&#123;#if storyCore&#125;&#125;</p></li>
<li></li>
<li><p>【故事设计】</p></li>
<li><p>&#123;&#123;storyCore&#125;&#125;</p></li>
<li></li>
<li><p>&#123;&#123;/if&#125;&#125;</p></li>
<li></li>
<li><p>**【铁律·必须严格遵守】**</p></li>
<li><p>&#123;&#123;#if mainPlot&#125;&#125;</p></li>
<li><p>1. 必须服从故事主线：所有章节必须严格围绕「&#123;&#123;mainPlot&#125;&#125;」推进，不</p></li>
<li><p>得另起主线。</p></li>
<li><p>2. 每章必须说明推进了主线的哪一段。</p></li>
<li><p>&#123;&#123;/if&#125;&#125;</p></li>
<li><p>&#123;&#123;#if plotPattern&#125;&#125;</p></li>
<li><p>3. 故事模式约束：采用「&#123;&#123;plotPattern&#125;&#125;」结构进行编排。</p></li>
<li><p>&#123;&#123;/if&#125;&#125;</p></li>
<li><p>&#123;&#123;#if centralConflict&#125;&#125;</p></li>
<li><p>4. 核心冲突约束：所有情节必须服务于「&#123;&#123;centralConflict&#125;&#125;」这一</p></li>
<li><p>核心矛盾。</p></li>
<li><p>&#123;&#123;/if&#125;&#125;</p></li>
<li><p>&#123;&#123;#if theme&#125;&#125;</p></li>
<li><p>5. 主题约束：章节内容应体现「&#123;&#123;theme&#125;&#125;」这一主题。</p></li>
<li><p>&#123;&#123;/if&#125;&#125;</p></li>
</ol>
<h2 id="注意事项">🔧 注意事项</h2>
<ol type="1">
<li><p>变量必须在 variables 数组中声明 ：如果使用单独的字段变量（如 mainPlot 、 plotPattern ），需要在 prompt seed 的 variables 数组中添加它们</p></li>
<li><p>数据来源 ：这些字段的数据来自 storyCore 对象，需要在 assembleContext 中确保 storyCore 被正确收集</p></li>
<li><p>条件渲染 ：使用 &#123;&#123;#if variable&#125;&#125; 可以确保当字段为空时不显示空行</p></li>
</ol>
<p>这样您的大纲生成提示词就能与「故事设计」模块紧密关联，确保生成的大纲严格遵循您设定的故事主线、模式和核心冲突！</p>
<p><img src="/assets/migrated/legacy-bugs/media/image4.png" style="width:3.5875in;height:4.0609in" alt="RVA5S7ZIABQD6" /></p></td>
<td></td>
<td></td>
<td>P2</td>
<td>大纲生成 / 提示词上下文</td>
<td>待复现</td>
<td>未解决</td>
<td>开发者</td>
<td>已记录但本轮未修。当前证据指向 storyCore 已传入但模型未有效遵循，可能是提示词字段权重、上下文排序、内容截断或读取内容偏差。需用同一项目、同一模型、同一输入抓取最终 prompt 与输出对照后再改。</td>
<td></td>
<td>否</td>
<td>不直接改提示词，避免把局部样例误修成全局退化。</td>
</tr>
<tr class="even">
<td></td>
<td></td>
<td></td>
<td>老问题，之前查过，未根治。用户多有反馈，具体情况如下：首次点击生成后有结构化数据，点击采纳后无反应，第二次生成后可正常采纳。需确定根因。</td>
<td><img src="/assets/migrated/legacy-bugs/media/image5.png" style="width:3.5875in;height:1.45458in" alt="E2G4W7ZIACAB2" /></td>
<td></td>
<td></td>
<td>P1</td>
<td>大纲生成 / 采纳流程</td>
<td>待复现</td>
<td>未解决</td>
<td>开发者</td>
<td>已记录但本轮未修。症状是首次生成有结构化数据但采纳无反应，第二次生成后可采纳；需要定位 generatedVolumes/parsedVolumes 的状态初始化、异步解析完成时机和 adopt 输入是否首次为空。</td>
<td></td>
<td>否</td>
<td>P1：影响核心采纳流程；必须用可复现步骤或录屏定位，不盲修。</td>
</tr>
<tr class="odd">
<td></td>
<td></td>
<td></td>
<td>这个ollma可能需要调整一下UI描述，看是否是支持ollma、lm等常见的本地模型管理器，如果是，修改为本地模型或许更佳</td>
<td><img src="/assets/migrated/legacy-bugs/media/image6.png" style="width:3.5875in;height:5.26398in" alt="2KCM27ZIAAAF2" /></td>
<td></td>
<td></td>
<td>P3</td>
<td>AI 设置 / 本地模型</td>
<td>已关闭</td>
<td>已解决</td>
<td>开发者</td>
<td>已实现 QUICKWIN-1：设置页 provider 选项从“Ollama (本地)”调整为“本地模型 (Ollama / LM Studio 等)”，hint 明确 OpenAI-compatible /v1 接口、Ollama :11434/v1 与 LM Studio :1234/v1；快捷按钮保留 LM Studio / 本地 Ollama。回归：R-QUICKWIN1-local-model-label。</td>
<td>codex/consistency-held-items-20260707 · ddff907</td>
<td>是</td>
<td>本次只做命名与说明改造；自动拉取模型按钮 GET /v1/models 仍是单独功能需求，未在本轮实现。</td>
</tr>
<tr class="even">
<td></td>
<td></td>
<td></td>
<td></td>
<td><p><img src="/assets/migrated/legacy-bugs/media/image7.png" style="width:3.5875in;height:3.72316in" alt="TCH467ZIAAAGC" /></p>
<p><img src="/assets/migrated/legacy-bugs/media/image8.png" style="width:3.5875in;height:4.32507in" alt="23U467ZIABACE" /></p></td>
<td></td>
<td></td>
<td>P1</td>
<td>上下文 / 世界观 / 力量体系</td>
<td>已关闭</td>
<td>已解决</td>
<td>开发者</td>
<td>已定位：CONTEXT_SOURCES 中 readWorldview/readPowerSystem 把显式 worldGroupId:null 当成“只查 null 世界”。单世界或未勾选多世界时若数据已有非 null 主世界记录，会导致世界观/力量体系上下文读空。已改为仅 worldGroupId 非 null 时严格隔离；null/未指定先取 null 记录，取不到回退项目首条。回归：assembleContext。</td>
<td>codex/bug-batch-20260707 · cbd7a76</td>
<td>是</td>
<td>对应截图中“设定读取函数对 null 值处理”的问题；仍保留多世界非 null 隔离。</td>
</tr>
<tr class="odd">
<td></td>
<td></td>
<td></td>
<td></td>
<td><p><img src="/assets/migrated/legacy-bugs/media/image9.png" style="width:3.5875in;height:0.9426in" alt="M2T5A7ZIAAAAO" /></p>
<p><img src="/assets/migrated/legacy-bugs/media/image10.png" style="width:3.5875in;height:1.06996in" alt="O3B5A7ZIABAAQ" /></p></td>
<td></td>
<td></td>
<td>P2</td>
<td>上下文 / 生成引用</td>
<td>待复现</td>
<td>未解决</td>
<td>开发者</td>
<td>截图-only 行，当前无法仅凭表内空描述确认是否与 row 9 同根；已查看截图但需要补一句文字说明或复现入口，避免把不同上下文问题误合并。</td>
<td></td>
<td>否</td>
<td>若确认也是世界观/力量体系 null 读取问题，可并入 row 9；否则单独定位。</td>
</tr>
<tr class="even">
<td></td>
<td></td>
<td></td>
<td>描述见截图。</td>
<td><img src="/assets/migrated/legacy-bugs/media/image11.png" style="width:3.5875in;height:1.30647in" alt="ACJNI7ZIABAHC" /></td>
<td></td>
<td></td>
<td>P3</td>
<td>贡献 PR / 功能评估</td>
<td>待复现</td>
<td>未解决</td>
<td>开发者</td>
<td>已记录。该项需要查看对应 GitHub PR 与当前主线差异，判断是可直接参考、需要重做，还是已被现有功能覆盖；本轮未处理。</td>
<td></td>
<td>否</td>
<td>不是可直接修复的运行时 bug，先做 PR triage。</td>
</tr>
<tr class="odd">
<td></td>
<td></td>
<td></td>
<td></td>
<td><img src="/assets/migrated/legacy-bugs/media/image12.png" style="width:3.5875in;height:4.07121in" alt="YDO5K7ZIACQGQ" /></td>
<td></td>
<td></td>
<td>P3</td>
<td>功能优化 / 用户方案评估</td>
<td>待复现</td>
<td>未解决</td>
<td>开发者</td>
<td>已记录。用户本地优化需先判断当前项目是否已有等价能力、是否只是入口未生效，再决定是否吸收方案；本轮未处理。</td>
<td></td>
<td>否</td>
<td>需要截图内容转文字或 PR/代码链接辅助定位。</td>
</tr>
<tr class="even">
<td></td>
<td></td>
<td></td>
<td></td>
<td><p><img src="/assets/migrated/legacy-bugs/media/image13.png" style="width:3.5875in;height:2.95072in" alt="5LQNU7ZIADACQ" /></p>
<p><img src="/assets/migrated/legacy-bugs/media/image14.png" style="width:3.5875in;height:1.59348in" alt="LEGNW7ZIAAQHO" /></p>
<p><img src="/assets/migrated/legacy-bugs/media/image15.png" style="width:3.5875in;height:0.73115in" alt="2EW5W7ZIABACE" /></p></td>
<td></td>
<td></td>
<td>P3</td>
<td>贡献 PR / 推送功能</td>
<td>待复现</td>
<td>未解决</td>
<td>开发者</td>
<td>已记录。需检查用户 PR 记录和推送功能与当前功能的匹配度；若代码落后当前版本，则关闭 PR 并参考设计重做，避免直接合入破坏架构。</td>
<td></td>
<td>否</td>
<td>按“参考 PR 重做”原则处理，不直接合并未知版本差异代码。</td>
</tr>
<tr class="odd">
<td></td>
<td></td>
<td></td>
<td></td>
<td><p><img src="/assets/migrated/legacy-bugs/media/image16.png" style="width:3.5875in;height:1.71332in" alt="YKPN67ZIACQEI" /></p>
<p><img src="/assets/migrated/legacy-bugs/media/image17.png" style="width:3.5875in;height:2.54938in" alt="YO7N67ZIADAE2" /></p></td>
<td></td>
<td></td>
<td>P2</td>
<td>正文修改 / 上下文联动</td>
<td>待设计</td>
<td>未解决</td>
<td>开发者</td>
<td>已记录。该项属于“用户修改正文后，事实/大纲/角色/上下文需要联动更新”的体系能力，不是单点 bug；需要走影响分析、用户确认、分步修订方案，不能自动粗暴改正文。</td>
<td></td>
<td>否</td>
<td>与角色变更影响分析/弧光重规划、长期一致性工程化方案相关。</td>
</tr>
<tr class="even">
<td></td>
<td></td>
<td></td>
<td>用户想要单独修改卷级大纲，但当前功能好像不支持？主角名称在设定角色和生成正文之后不匹配。</td>
<td><img src="/assets/migrated/legacy-bugs/media/image18.png" style="width:3.5875in;height:8.21105in" alt="PGX7G7ZIACABK" /></td>
<td></td>
<td></td>
<td>P2</td>
<td>卷纲编辑 / 角色上下文</td>
<td>待复现</td>
<td>未解决</td>
<td>开发者</td>
<td><p>已记录。卷级大纲单独修改需先查现有 outlineNodes 是否支持卷节点编辑、编辑后如何影响章纲/正文生成/上下文源。主角名称不匹配需抓最终 prompt，判断是角色字段未注入、注意力不足，还是正文已有名称事实未被约束。</p>
<p>补充说明已合并到上方开发者批注。</p></td>
<td></td>
<td>否</td>
<td>包含两个问题，后续最好拆成“卷纲编辑联动”和“角色名称一致性”。</td>
</tr>
<tr class="odd">
<td></td>
<td></td>
<td></td>
<td>打字这个需要查，自行上传大纲这个考虑是否开发。</td>
<td><img src="/assets/migrated/legacy-bugs/media/image19.png" style="width:3.5875in;height:4.55896in" alt="AZG7Q7ZIABAE2" /></td>
<td></td>
<td></td>
<td>P2</td>
<td>输入框 / 大纲导入</td>
<td>待复现</td>
<td>未解决</td>
<td>开发者</td>
<td>已记录。截图包含“打字异常”和“自行上传大纲”两个方向：输入异常需复现输入法/组件组合；上传大纲属于功能需求，需单独设计导入格式、映射规则和数据校验。</td>
<td></td>
<td>否</td>
<td>先定位输入 bug；上传大纲按功能需求排期。</td>
</tr>
<tr class="even">
<td></td>
<td></td>
<td></td>
<td>好像是用微软输入法就会只能输入字母，无法正常输入文字，需要检查一下。</td>
<td><p><img src="/assets/migrated/legacy-bugs/media/image20.png" style="width:3.5875in;height:1.16566in" alt="4TJPS7ZIAAAF2" /></p>
<p><img src="/assets/migrated/legacy-bugs/media/image21.png" style="width:3.5875in;height:2.95072in" alt="SCEPU7ZIAAAFQ" /></p>
<p><img src="/assets/migrated/legacy-bugs/media/image22.png" style="width:3.5875in;height:4.17321in" alt="IQJPW7ZIAAQCY" /></p>
<p><img src="/assets/migrated/legacy-bugs/media/image23.png" style="width:3.5875in;height:2.70048in" alt="5YXPW7ZIADAG2" /></p></td>
<td></td>
<td></td>
<td>P1</td>
<td>输入框 / 微软输入法 / IME</td>
<td>待审</td>
<td>未解决</td>
<td>开发者</td>
<td>已定位并完成代码修复，待审核。根因：角色关系编辑态的关系标签/关系描述使用原生受控 input/textarea，每次 onChange 直接写 store，在微软输入法/中文 IME 组合输入期间容易被 React 重渲染打断，导致拼音字母落入文本。修复：改用现有 CInput/CTextarea 组合输入安全组件，并新增 R-CF20260710-relation-ime-input 回归守卫。</td>
<td>codex/fix-relation-ime-input-20260710 · 78bc1e5</td>
<td>是</td>
<td>2026-07-10 开发者已在分支修复，当前待审；合入 main 后再关闭为已解决。如用户仍在其他页面复现，需要补具体页面与录屏继续扫同类输入框。</td>
</tr>
<tr class="odd">
<td></td>
<td></td>
<td></td>
<td></td>
<td><img src="/assets/migrated/legacy-bugs/media/image24.png" style="width:3.5875in;height:4.19253in" alt="VGQARABIACADW" /></td>
<td></td>
<td></td>
<td>P2</td>
<td>章节正文 / 大纲标题同步</td>
<td>已关闭</td>
<td>已解决</td>
<td>开发者</td>
<td><p>已定位：大纲列表/侧栏显示 outlineNodes.title，正文编辑器标题栏显示 chapters.title；修改大纲章名只更新 outlineNodes，未同步既有 chapter 记录。已在 useOutlineStore.updateNode 单一入口中同步 chapters.title 与 chapter store 内存。回归：R-CF-chapter-title-sync。</p>
<p>已与“章节名修改后正文编辑器仍显示旧标题”合并处理。</p></td>
<td>codex/bug-batch-20260707 · cbd7a76</td>
<td>是</td>
<td>本地章节页预览加载正常；待审核。</td>
</tr>
<tr class="even">
<td></td>
<td></td>
<td></td>
<td></td>
<td><img src="/assets/migrated/legacy-bugs/media/image25.png" style="width:3.5875in;height:14.68312in" alt="IA2AXABIAAQEK" /></td>
<td></td>
<td></td>
<td>P2</td>
<td>世界观生成 / 长期一致性 / RAG</td>
<td>待设计</td>
<td>未解决</td>
<td>开发者</td>
<td><p>已记录。截图提出两类能力：一是现实世界/架空世界的世界观内容取舍；二是长期一致性需要更工程化的按需检索（Agent/RAG/Skill），避免“不分主次一股脑打包”影响模型注意力。该项是方案设计，不属于本轮 row 9 的 null 读取修复。</p>
<p>补充说明已合并到上方开发者批注。</p></td>
<td></td>
<td>否</td>
<td>需进功能方案或 ROADMAP，不能用提示词小修替代。</td>
</tr>
<tr class="odd">
<td></td>
<td></td>
<td></td>
<td>这是个明显的状态追踪的问题，道具应该作为事实细节被提出、记忆。因为用户没有提及是在几章之后，但从时间来看大概中间跨越的章节并不多，道具丢失明显不应该。</td>
<td><img src="/assets/migrated/legacy-bugs/media/image26.png" style="width:3.5875in;height:0.85637in" alt="V2NBBABIAAQE2" /></td>
<td></td>
<td></td>
<td>P1</td>
<td>事实记忆 / 道具状态追踪</td>
<td>已关闭</td>
<td>已解决</td>
<td>开发者</td>
<td>已实现 CONSISTENCY-1 第一版：基于 itemLedger 按规范章序投影“当前已持有物品”，新增 heldItems 上下文源注入正文生成；一致性审校增加 checkHeldItemAcquisition 确定性校验，命中“已持有物品又被写成获得/首次获得”的风险并给出正文引文。纯读，不改 schema。回归：R-CONSISTENCY1-held-items。</td>
<td>codex/consistency-held-items-20260707 · ddff907</td>
<td>是</td>
<td>本次解决“已持有道具被再次赋予获得途径”的确定性校验与上下文注入；物品栏编辑/增量识别仍在 row 1，章节号/上下文混合问题仍在 row 2/3，未合并根因。</td>
</tr>
<tr class="even">
<td></td>
<td>21</td>
<td>Markdown/TXT 导出只有大纲或空章</td>
<td>用户反馈：Markdown（正文导出）/ TXT 导出的文件只有大纲，章节正文没有导出。代码定位为历史重复章节记录时，同一 outlineNodeId 下空章节可能覆盖有正文记录；另有保存按钮读取 React state 滞后风险，可能导致刚输入的内容未及时进入导出链路。</td>
<td>用户反馈截图：导出卡片显示 Markdown/TXT，反馈“导出的文件都是只有大纲，章节里的文案怎么导出”。</td>
<td>用户</td>
<td>网页端</td>
<td>P1</td>
<td>数据管理 / 正文导出 / 章节正文</td>
<td>待审</td>
<td>已解决</td>
<td>开发者</td>
<td>已修复 CF-20260703-10：新增 pickBestChapterForOutline()/buildBestChapterByOutlineMap()，导出、章节列表、上下文快照、canonical 章序统一择优取有正文/字数大/更新时间新的章节记录；ChapterEditor 保存/影响分析/章节记忆改为从 editorRef 读取最新 HTML/纯文本；getOrCreateByOutlineNode 防重复创建。新增回归 R-CF20260703-10-chapter-save-export。</td>
<td>codex/pr24-triage-fixes-20260710 · c26cf86</td>
<td>是</td>
<td>不包含“章纲/细纲也导出为正文”的新功能；历史重复章节自动合并/删除需另做安全数据维护方案。</td>
</tr>
<tr class="odd">
<td></td>
<td>22</td>
<td>章节无记忆导航功能</td>
<td>用户反馈：从章节某章页面切换到其他页面（比如设置），再切回章节时，默认跳到第一章，需要手动找到切换前的章节页面</td>
<td><p><img src="/assets/migrated/legacy-bugs/media/image27.png" style="width:3.5875in;height:1.83634in" alt="2GZKVVRIADAA2" /></p>
<p><img src="/assets/migrated/legacy-bugs/media/image28.png" style="width:3.5875in;height:1.31113in" alt="VYCKXVRIABAFK" /></p></td>
<td>用户</td>
<td>网页端</td>
<td>P3</td>
<td>创作区/章节</td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="even">
<td></td>
<td></td>
<td></td>
<td><p>agent对话遇到的几个问题：</p>
<ol type="1">
<li><p>生成的正文到章节里段落之间有空行，要手动删除</p></li>
<li><p>让它生成章节，结果生成的章节没在卷里面，和卷同级了</p></li>
<li><p>agent似乎不能正常对话，只能做任务，问它是谁，结果它生成了一个角色。</p></li>
</ol></td>
<td><img src="/assets/migrated/legacy-bugs/media/image29.png" style="width:3.5875in;height:5.55935in" alt="SLSVL2BIADAAQ" /></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="odd">
<td></td>
<td>23</td>
<td>文档解析后出现重复角色（不同阶段/状态）的同一角色</td>
<td><p>在文档解析中导入小说，会出现以下问题：</p>
<ol type="1">
<li><p>根据小说角色的不同成长阶段，ai会将其划分为不同的角色卡：如雏龙，幼龙，少年龙，机械义体，青年龙......多次尝试时，极端情况下一个角色甚至分裂出了9张角色卡（四张主要角色，五张次要角色）</p></li>
<li><p>无法辨别同一个角色的死活：前期主角接受了一个逝去角色的传承，后期该角色复活，但ai把这个角色分为两张角色卡。</p></li>
</ol>
<p>希望增加角色卡合并功能：</p>
<ol type="1">
<li><p>允许使用者内置角色发育顺序的标记，使得ai能正确理解角色卡之间的进阶关系。</p></li>
<li><p>希望在合并功能中增加能手动补充和强调设定/状态的功能</p></li>
</ol></td>
<td><img src="/assets/migrated/legacy-bugs/media/image30.png" style="width:2.57292in;height:4.84475in" alt="S3EID2BIABQBA" /></td>
<td>用户</td>
<td><p>网页端</p>
<p>版本：3.9.0-labs</p></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="even">
<td></td>
<td>24</td>
<td>角色名称搜索栏与角色卡排序功能</td>
<td><p>角色太多了300多位，希望能增加一个搜索栏，如：</p>
<ol type="1">
<li><p>搜索名字</p></li>
<li><p>限定标签（如角色阵营）</p></li>
<li><p>搜索关键字（体系，性格，种族，能力....）</p></li>
</ol>
<p>角色卡常用度有所不同，希望能增加顶置功能与排序功能，如：</p>
<ol type="1">
<li><p>置顶功能</p></li>
<li><p>按拼音首字母排序</p></li>
<li><p>按重要程度排序（手动给标记星星，类似这样？</p></li>
</ol>
<p><img src="/assets/migrated/legacy-bugs/media/image31.png" style="width:2.51042in;height:0.30208in" alt="BMHJL2BIABAAW" /></p>
<p>）</p>
<ol start="4" type="1">
<li><p>按创建时间顺序排序</p></li>
</ol></td>
<td><img src="/assets/migrated/legacy-bugs/media/image32.png" style="width:2.64583in;height:2.26042in" alt="S4RJR2BIAAAFW" /></td>
<td>用户</td>
<td><p>网页端</p>
<p>版本：3.9.0</p></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="odd">
<td></td>
<td>25</td>
<td>真实与幻想大类和子类被增加后无法改名，也无法进行排序</td>
<td>真实与幻想的大类和子类被增加后无法改名，也无法进行排序，并且希望增加词条分页</td>
<td><p><img src="/assets/migrated/legacy-bugs/media/image33.png" style="width:2.57292in;height:9.71069in" alt="CKFZ32BIADQAQ" /></p>
<p><img src="/assets/migrated/legacy-bugs/media/image34.png" style="width:2.36458in;height:3.38542in" alt="WKS2B2BIAAAGE" /></p>
<p><img src="/assets/migrated/legacy-bugs/media/image35.png" style="width:3.5875in;height:1.34214in" alt="AIZPR2BIADAHQ" /></p></td>
<td>用户</td>
<td><p>网页端</p>
<p>版本：3.9.0</p></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="even">
<td></td>
<td>26</td>
<td><p>希望能增加几个大类子类的分类</p>
<p>为世界起源内的“世界来源”“力量体系”“神明信仰”增加分类</p></td>
<td><p>在实际创作中想要塑造不同势力/族群对世界来源的不同认知，需要去手动划分强调那些是重合的那些是不同的。</p>
<p>以及力量体系中的力量层级（词条）完全可以挂靠在修炼体系下面。</p>
<p>因此，希望能将世界起源中的“世界来源”“力量体系”“神明信仰”去分层为：</p>
<p>世界起源：</p>
<p>力量体系：</p>
<blockquote>
<p>体系总览：</p>
<p>修炼体系：</p>
<p>总览：XXXXX</p>
<p>法师：</p>
<p>战士：</p>
<p>。。。</p>
<p>力量层级（词条）：</p>
<p>通用词条：</p>
<p>装备：</p>
<p>技能：</p>
<p>。。。</p>
</blockquote>
<p>希望能增加几个大类子类的分类</p></td>
<td><table>
<colgroup>
<col style="width: 8%" />
<col style="width: 20%" />
<col style="width: 70%" />
</colgroup>
<tbody>
<tr class="odd">
<td><img src="/assets/migrated/legacy-bugs/media/image33.png" style="width:0.245in;height:0.92468in" alt="CKFZ32BIADQAQ" /></td>
<td><img src="/assets/migrated/legacy-bugs/media/image34.png" style="width:0.64585in;height:0.92468in" alt="WKS2B2BIAAAGE" /></td>
<td><img src="/assets/migrated/legacy-bugs/media/image36.png" style="width:2.47165in;height:0.92468in" alt="6EGL52BIABADG" /></td>
</tr>
<tr class="even">
<td>总览，修炼体系，力量层级·词条</td>
<td><p>总览，</p>
<p>通用词条，</p>
<p>战士词条，</p>
<p>法师词条....</p></td>
<td><p>（详细词条）</p>
<p>耸肩无视：XXX</p>
<p>黑暗之拥：XXX</p>
<p>硬撑：XXX</p>
<p>壁垒：XXX</p>
<p>重锤：XXX</p>
<p>完美打击：XXX</p></td>
</tr>
</tbody>
</table>
<p>类似这样：</p>
<p>世界起源→力量体系→大类（总览，修炼体系，力量层级·具体词条）→子类（总览，通用，战士，法师....）→词条</p></td>
<td>用户</td>
<td>网页端</td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="odd">
<td></td>
<td>27</td>
<td>在续写长篇已有小说时，我需要批量导入正文到项目章节中。但目前的文档解析只有“转为项目参考”和“直接导入当前项目（总结成节章目标）”两种选项，缺少“直接导入原始正文”的功能。希望能增加这一选项</td>
<td>目前我正在续写一部已有大量存量内容的小说，因此需要将现有正文快速、批量地导入到当前项目的章节结构中。但我发现，现有的“文档解析”功能只提供了两个处理路径：一是“转为项目参考”，二是“直接导入当前项目”。这两种方式都无法实现“将完整正文批量导入为章节内容”的需求，希望能增加一个直接导入正文的选项。</td>
<td></td>
<td>用户</td>
<td>网页端</td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="even">
<td></td>
<td></td>
<td></td>
<td></td>
<td><p><img src="/assets/migrated/legacy-bugs/media/image37.png" style="width:3.5875in;height:1.62559in" alt="LR2K73RJABAHW" /></p>
<p>UI问题</p></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
</tr>
</tbody>
</table>
