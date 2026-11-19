# 地图符号素材

## 实现与素材来源

地图沿用项目已有地理引擎；简笔与连续地形的 Canvas 表现由项目代码实现。Inkarnate、Wonderdraft、Red Blob 等是视觉或算法思路参考，调研链接见 [RESEARCH.md](RESEARCH.md)；本轮未移植这些产品的源码，也未导入其付费印章或纹理。现有网格引擎使用 Delaunator（ISC，其依赖 robust-predicates 为 Unlicense），分发时须保留适用的许可声明；这不是对整个项目历史来源的完整审计。

下述符号表由 AI 生成，并非人工手绘或从商业地图产品提取。可选图片底图增强使用作者配置的图片服务；生成结果的商业使用条件须按相应服务条款核实，不能由项目代码或“AI 生成”这一事实保证。权游等第三方世界样例用于效果对照，不能据此推定获得其世界设定、地名或地图的商业授权。

原型使用内建 imagegen 工具生成透明水彩图集，转码为 WebP 后由 Canvas 读取网格区域。坐标、视角、文字及排布均由应用控制。默认符号与程序绘制降级路径共用地理几何。

连续绘画默认使用 [continuous.ts](../../src/lib/world-map/atlas/continuous.ts) 的程序表面：按已有 ridge/wood/desert/marsh 绘制光照地形、山峰与林冠，山林可分别筛选。高度场仅为美术表现，不代表实测地形。

连续绘画还可显式生成或导入当前地图的图片底图。产品使用的生成提示定义在 [paint-preview.ts](../../src/lib/world-map/atlas/paint-preview.ts) 的 `ATLAS_PAINT_PROMPT`；参考图由同一地图几何的程序连续绘画生成，去除河流、道路、边界、注记、指南针与边框。模型不得生成文字，实际文字由地图组件叠加。Agnes 参考图参数为 `extra_body.image` 数组，走 `/images/generations`；按原生比例等比留边后只裁去留边，不隐式改为文生图。依据 [Agnes Image 2.1 官方协议](https://agnes-ai.com/zh-Hans/docs/agnes-image-21-flash)。返回图片须由作者核对，不能把模型的构图遵循程度当成确定性地理校验。合成以原几何限定海陆，并以程序表面填补错位水色；该配色分离不生成地理事实。绘画底图保存在作者显式导出的底图包中，不随世界语义保存。

[实际使用的符号表](../../src/assets/world-map/watercolor-symbols.webp)

绘本地图的中式山林素材使用另一套原创透明符号：[素材](../../src/assets/world-map/ink-mountains-symbols.png)。同样由内建 imagegen 生成，保留原始透明通道，四列两行；素材选择只更换符号，不改变地理几何、图层或来源。城镇与关隘使用中式建筑，诸天分区和天壑由程序绘制。旧名称“水墨山河”不代表一套独立水墨渲染。

简笔地图由 [sketch.ts](../../src/lib/world-map/atlas/sketch.ts) 原生 Canvas 线绘，不使用上述位图素材。纸纹、山链、树林、沙丘与湿地符号均为确定性绘制；与绘本共用水陆裁剪和河道曲线。山脉仅跟随现有 ridge，不能将制图符号当成真实海拔等高线。字体、点状城镇和要塞符号随简笔样式绘制，图层与导出仍走同一地图组件。

### 三种画风的 AI 美术增强

`generateAtlasPaintPreview` 按当前画风使用独立提示。正式入口支持选择独立图片连接、原版/候选比较、显式使用、本机视图缓存与可移植 V2 底图包。简笔和连续绘画的无装饰参考图均由当前程序绘制；绘本参考图复用随应用提供的符号素材。

V2 使用原地貌遮罩限制模型细节，去除大块背景色并以局部细节混合降低裁剪接缝；低地仅混合模糊色调。程序山林始终保留为基础，模型纹理不能替代全部地理事实。原海岸、水域、岛屿和程序叠加图层保持独立。旧 V1 包仍按整图底图兼容，不声称能单独移除其中山林。

2026-11-19 实验曾出现简笔森林弱化、绘本网格树林以及重绘把树散布到草原的问题，这些证据促成本次受范围约束的合成。当前 UI 实跑 Agnes Image 2.1 Flash 的三种画风，分别产生候选并使用、保存、导出。Agnes 使用 `extra_body.image` 与 `extra_body.response_format`；OpenAI 图片编辑与 Gemini 原生 Interactions 还须按具体账号实测，不把协议接入当成质量验收或商业权利证明。

### 中式插画素材提示

Use case: stylized-concept. Asset type: original transparent sprite sheet for a programmable 2D Chinese xianxia world atlas. Create ONE impeccably detailed hand-painted watercolor-and-fine-ink CARTOGRAPHIC SPRITE SHEET, transparent background, exactly FOUR equal columns by TWO equal rows, eight separate centered illustrations, every illustration fully contained within its cell with generous transparent margins, no text, no grid lines, no labels, no shadows on background. All viewed from the same elevated 3/4 map perspective, top-left soft light, muted mineral pigments, antique silk/ink cartography, rich restrained sage green, ochre, faded cinnabar, blue slate. Tiny intricate linework legible at map scale, soft edges fade to transparency but solid objects remain crisp. Top row left to right: (1) one dramatic cluster of tall blue-grey snow-tipped Chinese karst mountains; (2) one low ochre rocky mountain ridge with winding fold lines; (3) a tight cluster of elegant deep jade pine trees and conifers, no ground patch; (4) a tight cluster of lush moss-green broadleaf forest trees, no ground patch. Bottom row left to right: (5) a compact majestic ancient Chinese walled city with red walls, layered grey-green tiled roofs and a central grand palace, no surrounding landscape; (6) a compact ancient Chinese village of varied roofs and a slender pagoda with some trees, no surrounding landscape; (7) a fortified ancient Chinese mountain-pass gate with two squat stone towers, crenellated wall and watchtower, no European castles; (8) an elegant ancient Chinese mountain monastery of wooden pavilions, terraces and stone steps on a small isolated rock, no surrounding landscape. Eight distinct objects only, one per cell. NO readable writing, NO letters, NO borders, NO parchment background, NO checkerboard, NO western fantasy turrets. This is a reusable asset sheet, NOT a finished map, NOT a diagram.

## 生成提示

An original fantasy cartographer's watercolor map symbol sheet for a printed geographic atlas, eight isolated hand-painted cutouts on TRUE transparent background. Wide landscape, strict evenly spaced four columns by two rows, all 8 cells equal. Center and fit each motif in its cell with very generous clear margins, no overlaps. Row 1 left to right: an asymmetric craggy granite mountain massif with snow on a few peaks; a low warm limestone mountain ridge with rough flanks; a compact naturally uneven cluster of 6 dark green fir trees; a compact stand of rounded olive deciduous trees. Row 2 left to right: an imposing ancient walled keep with towers and a little red banner; a walled coastal city with rust colored roofs and several towers; a small watchtower atop a narrow pass; an irregular cluster of low sandy mesas. Oblique bird's eye illustrated map perspective, consistent light from upper left, subtle ink hatching and earthy gouache color. Delicate faded natural base of each symbol blends into transparency. Artisan miniature illustrations with exceptional readable silhouettes from afar. No lettering, grid lines, emblems, borders, backgrounds, plaques or numbers.
