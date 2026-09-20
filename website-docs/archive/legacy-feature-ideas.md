---
search: false
---
# 故事熔炉功能优化与新功能建议收集
::: warning 历史资料
本页从原 WPS 知识库迁移，用于保留历史记录。内容可能对应旧版本，不应单独作为当前功能状态依据；当前能力请优先查看“开始使用”“功能指南”和仓库最新 Changelog。
:::



**迁移时间：**2026-07-06

**来源：**旧表《故事熔炉功能优化&新功能建议收集表.xlsx》。旧表中的 bug 类内容已拆到《故事熔炉bug收集》。

**说明：**旧功能表含 10 张浮动参考图；本智能文档已完整迁移文字内容，并保留原表链接作为图片追溯入口。后续新增建议请直接在本文档表格中追加。

## 功能建议表

<table style="width:100%;">
<colgroup>
<col style="width: 6%" />
<col style="width: 11%" />
<col style="width: 31%" />
<col style="width: 7%" />
<col style="width: 14%" />
<col style="width: 9%" />
<col style="width: 7%" />
<col style="width: 13%" />
</colgroup>
<tbody>
<tr class="odd">
<td colspan="5"><strong>报告人填写</strong></td>
<td colspan="3"><strong>开发者填写</strong></td>
</tr>
<tr class="even">
<td><strong>序号</strong></td>
<td><strong>功能名称</strong></td>
<td><strong>建议描述</strong></td>
<td><strong>提出人</strong></td>
<td><strong>参考（截图·竞品·链接）</strong></td>
<td><strong>价值·优先级</strong></td>
<td><strong>状态</strong></td>
<td><strong>批注</strong></td>
</tr>
<tr class="odd">
<td>1</td>
<td><strong>AI拆书功能增加</strong></td>
<td>在导入模块，增加按章节解析能力：扫描或按用户提示分出章、卷、纲，并罗列供勾选，实现有选择地拆书。深度拆书阶段希望提取卷纲、章纲、大纲、主次角色并建档；将写作技巧、世界观设定等挂到来源章节；可考虑增加事件模块和时间线模块，以识别节奏、起承转合等结构。</td>
<td></td>
<td>星月写作有很多拆书模板，可参考【西瓜出品】黄金拆书。</td>
<td></td>
<td>待评估</td>
<td></td>
</tr>
<tr class="even">
<td>2</td>
<td><strong>章节拖动功能</strong></td>
<td>在大纲里增加章节拖动排序能力。现在添加章节只能添加在最后，在前序章节中间插入章节很麻烦。</td>
<td></td>
<td></td>
<td></td>
<td>待评估</td>
<td></td>
</tr>
<tr class="odd">
<td>3</td>
<td><strong>章节大纲简介编辑</strong></td>
<td>在章节正文板块中，章节大纲/简介区域希望支持编辑，目前不支持编辑。</td>
<td></td>
<td></td>
<td></td>
<td>待评估</td>
<td></td>
</tr>
<tr class="even">
<td>4</td>
<td><strong>项目参考文案调整</strong></td>
<td>项目参考中的 UI 文案“导入”建议调整为“文档解析”。</td>
<td></td>
<td></td>
<td></td>
<td>待评估</td>
<td></td>
</tr>
<tr class="odd">
<td>5</td>
<td><strong>api模型配置功能</strong></td>
<td>在填写 URL 和 Key 后，希望增加“拉取模型”按钮，自动从当前 API 拉取模型列表，避免手动填写模型；可参考酒馆点击连接后自动拉取模型的交互。</td>
<td></td>
<td></td>
<td></td>
<td>待评估</td>
<td>bug 部分（编辑 API 配置无保存按钮/修改不生效）已迁入 bug 文档。</td>
</tr>
<tr class="even">
<td>6</td>
<td><strong>api模型配置功能</strong></td>
<td>配置模型时，希望增加 RPM/并发限制配置。免费 API 模型、公益站通常会设置高并发限制，需要在项目内可配置调用节流。</td>
<td></td>
<td></td>
<td></td>
<td>待评估</td>
<td></td>
</tr>
<tr class="odd">
<td>7</td>
<td><strong>角色设计栏目的建议</strong></td>
<td>主要角色、次要角色、NPC、路人统一采用左侧人物列表 + 右侧信息展示的布局，方便查看和编辑。</td>
<td></td>
<td></td>
<td></td>
<td>待评估</td>
<td></td>
</tr>
<tr class="even">
<td>7-1</td>
<td><strong>角色设计栏目的建议</strong></td>
<td>NPC、路人的介绍建议统一集中到角色信息展示面板里，形成统一面板，方便查看与编辑；参考图为 GPT 生成图。</td>
<td></td>
<td>旧表浮动参考图</td>
<td></td>
<td>待评估</td>
<td>角色设计组合建议，保留在同一功能组。</td>
</tr>
<tr class="odd">
<td>7-2</td>
<td><strong>角色设计栏目的建议</strong></td>
<td>目前有角色设计，但缺少势力、组织管理。建议增加类似角色设计的组织/势力管理功能；参考图为其他软件功能截图。</td>
<td></td>
<td>旧表浮动参考图</td>
<td></td>
<td>待评估</td>
<td>角色设计组合建议，保留在同一功能组。</td>
</tr>
<tr class="even">
<td>7-3</td>
<td><strong>角色设计栏目的建议</strong></td>
<td>组织/势力管理应支持编辑具体信息，并能与人物联动：把人物加入组织/势力，编辑其地位、职位、状态、加入时间等；参考图为其他软件功能截图。</td>
<td></td>
<td>旧表浮动参考图</td>
<td></td>
<td>待评估</td>
<td>角色设计组合建议，保留在同一功能组。</td>
</tr>
<tr class="odd">
<td>8</td>
<td><strong>大纲页面功能升级</strong></td>
<td>大纲卷列表增加多选、全选、批量删除功能。现在只能通过卷大纲删除按钮逐个删除。</td>
<td></td>
<td></td>
<td></td>
<td>待评估</td>
<td></td>
</tr>
<tr class="even">
<td></td>
<td><strong>项目mcp化</strong></td>
<td></td>
<td></td>
<td><img src="/assets/migrated/legacy-feature-ideas/media/image1.png" style="width:1.275in;height:0.38816in" alt="KVD4M7ZIABAD4" /></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="odd">
<td></td>
<td><strong>项目学习社区/文档</strong></td>
<td>可以收集一些文笔、写作相关的资料、书籍、帖子、讨论文章等等，或者写作讨论相关的网站，天堂、龙空之类，给有兴趣的人以有益的参考</td>
<td></td>
<td><img src="/assets/migrated/legacy-feature-ideas/media/image2.png" style="width:1.275in;height:0.85882in" alt="Q5V6C7ZIAAAEO" /></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="even">
<td></td>
<td></td>
<td><p>这是明显的rag的用法，目前的长期真实一致性工作虽然做了抽取和向量，但是考虑到提示词字段拼接容易导致模型注意力丢失或者注意力不足，还是要考虑怎么样能让整个项目持续稳定产出合格内容，不要再出现用户报告过的那种上下文丢失、世界观上下不参考且有冲突、章节正文上下不承接的情况。</p>
<p>可能不得不做工程化了，尽管token消耗会大量增加，但稳定性可能还是要考虑在第一位。</p></td>
<td></td>
<td><img src="/assets/migrated/legacy-feature-ideas/media/image3.png" style="width:1.275in;height:0.27361in" alt="CAO647ZIADQHI" /></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="odd">
<td></td>
<td></td>
<td><p>用户提到了一个类似skill的方式，每次写正文都把相关要强调的设定和角色都再次发送一下。</p>
<p>需要确认当前的长期一致性工作应该是有这个设计的，但好像都是集成在了提示词字段中，还要考虑这个和当前已有的是否会产生并发或者冲突，这种额外的提醒或许可能会有用？这需要严格检查。但好像又会增加模型上下文窗口的压力和token消耗，可以考虑要不要优化这个功能。</p></td>
<td></td>
<td><img src="/assets/migrated/legacy-feature-ideas/media/image4.png" style="width:1.275in;height:0.58661in" alt="DNYQHABIACQAQ" /></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="even">
<td></td>
<td></td>
<td>很多用户对世界观设定需要填写太多东西感到厌倦，希望能有一个一句话生成世界观（自动填充所有内容）的这种设计，一句话生成故事（自动填充故事设计）的这个功能，可以考虑是否要增加。感觉可以有。</td>
<td></td>
<td><img src="/assets/migrated/legacy-feature-ideas/media/image5.png" style="width:1.275in;height:0.52214in" alt="4QAAPABIAAQDA" /></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="odd">
<td></td>
<td></td>
<td>一个明确的可以有的正文改写的功能需求，暂时考虑在用户改写之后出现一个小对话框，这个对话框引用用户的api，结合用户新加入的自定义内容进行改写。</td>
<td></td>
<td><img src="/assets/migrated/legacy-feature-ideas/media/image6.png" style="width:1.275in;height:0.70666in" alt="33EBHABIABQDQ" /></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="even">
<td></td>
<td></td>
<td>这也是一个功能需求，用户需要用一个解析可以导入多个项目，用户想要写多部小说都参考一个解析，这个可以有。</td>
<td></td>
<td><p><img src="/assets/migrated/legacy-feature-ideas/media/image7.png" style="width:1.275in;height:1.36624in" alt="5DFBLABIAAAHC" /></p>
<p><img src="/assets/migrated/legacy-feature-ideas/media/image8.png" style="width:1.275in;height:0.28931in" alt="BWARNABIAAAEO" /></p>
<p><img src="/assets/migrated/legacy-feature-ideas/media/image9.png" style="width:1.275in;height:0.69727in" alt="H47RVABIAAQD4" /></p>
<p><img src="/assets/migrated/legacy-feature-ideas/media/image10.png" style="width:1.275in;height:1.35164in" alt="RMBCDABIABQG2" /></p></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr class="odd">
<td></td>
<td></td>
<td><p>1、agent无法进行会话管理，是否能够新增会话管理功能，对会话进行增删改查。</p>
<p>2、是否能在agnet对话那加个入口，可以快速切换不同agent使用的模型</p>
<p>3、不同agent所用到的提示词是否能自定义</p>
<p>4、新增听书功能</p></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
</tr>
</tbody>
</table>

##
