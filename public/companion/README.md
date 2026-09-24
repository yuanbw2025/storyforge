# 墨灵 · 原创长篇创作助手

`moling-atlas.png` 由 Codex 内置图像生成工具为 StoryForge 原创生成，经第二轮工具编辑仅调整等分网格对齐。未使用 here 或其他项目的角色、代码或素材。生成日期：2026-09-25。

- 图像：1254 × 1254，透明 RGBA，3 列 × 2 行，每格 418 × 627。
- 阅读顺序：待机、倾听、思考书写、说话、候选待确认、异常。
- 所有动作由应用状态选择，CSS 提供可减少的轻微运动。不是 Live2D 骨骼动画或精确口型。
- 路径通过应用 BASE_URL 加载；隐藏形象时不渲染图片。
- 下列提示词记录生成来源，不是产品 Agent 提示词，也不参与小说生成。

## 原始生成提示词

Use case: stylized-concept. Asset type: production-ready transparent character sprite atlas for StoryForge, a Chinese long-form writing app.
Create ONE square sprite atlas with an exact 3-column by 2-row grid of six equal portrait cells. Each cell is 2:3 aspect ratio, so the entire atlas is square. All six cells have a genuinely transparent alpha background, no panel borders, no ground, no checkerboard, no text, no labels, no watermarks. Keep each figure fully within her own cell with generous transparent margins and identical scale and foot baseline. No overlapping neighboring cells.
The same original adult female literary assistant in all six cells: a poised young adult ink-and-paper scholar, unmistakably adult, tasteful fully clothed Chinese-inspired contemporary fantasy outfit, teal and ivory layered dress with subtle antique-gold details, long dark teal hair tied with a simple ribbon, small feather-shaped gold hairpin, a slim ivory manuscript notebook and a calligraphy pen. Warm, observant and capable, not childish, not sexualized. Premium illustrated game character finish, delicate clean linework, elegant shapes, soft cel shading, highly readable at small UI size. Match a calm jade-green and warm-paper writing workspace. Do not copy any existing character.
Reading order of six distinct poses:
Top left: idle, relaxed welcoming smile, holding the notebook against her waist.
Top middle: listening attentively, one hand lightly near her ear, eyes attentive.
Top right: thinking and writing, glancing thoughtfully at the open notebook with pen poised.
Bottom left: speaking, gentle open-mouth conversational expression and open hand gesture.
Bottom middle: draft ready for review, cheerful modest smile presenting one manuscript page.
Bottom right: a recoverable problem, thoughtful concerned expression, hand resting on notebook, not crying or panicking.
This is a single animation sprite-sheet asset. Maintain exactly the same character identity, clothing, lighting, body proportions and baseline across all six cells. Transparent background everywhere outside the figures and their held props.

## 对齐编辑提示词

Edit this existing transparent sprite atlas. Preserve exactly the same adult woman, illustration quality, six expressions, six poses, clothes, colors and transparent background. Change ONLY layout and scale to make it safe for exact CSS sprite cells. Keep a square canvas and exactly 3 columns by 2 rows of equal cells. The six figures must be substantially SMALLER, using only 80% of each cell's height and no more than 78% of each cell's width. Center each figure horizontally at exactly 1/6, 1/2 and 5/6 of canvas width. Top-row figures must have their entire heads and hairpins below 5% of canvas height and their feet above 45% of canvas height. Bottom-row figures must have their entire heads below 55% of canvas height and feet above 95% of canvas height. All hands, loose hair, sleeves and props must stay fully inside their own cell with transparent padding on every side. No element may touch canvas edges or cross a cell boundary. Exact equal grid spacing. No labels, no borders, no background, no shadows outside the figure. This is an asset alignment edit, not a character redesign.
