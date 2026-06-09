# Phase 13：4 套题材包 + 切换器 UI — Playbook

> Opus 4.7 自执行。2026-05-07。

## 目标

按用户决议（"题材包 = 提示词包，用户自选"）落地 4 套差异化题材包：
仙侠 / 言情 / 现实主义 / 悬疑推理。默认包（玄幻爽文长篇）已是 Phase 12 的现状。

## 改动

新增：
- `src/lib/ai/prompt-seeds-genre-packs.ts`
  · GENRE_PACK_SEEDS: 4 套 × 5 条核心模板 = 20 条新种子
  · GENRE_PACKS: 5 个题材包元信息（含 emoji + 描述）
- `docs/playbooks/PHASE-13-genre-packs.md`

修改：
- `src/lib/ai/prompt-seeds.ts`: import + 拼接 GENRE_PACK_SEEDS
- `src/stores/prompt.ts`: init() 用 `name` 作为唯一键（之前用 moduleKey 会
  导致同 moduleKey 下的多个 genre 模板互相覆盖）
- `src/components/settings/prompt/PromptManagerPanel.tsx`:
  顶部加题材包切换器（emoji 下拉 + 描述提示）

## 4 套题材包内容

每套包覆盖 5 条核心模板（差异最大的）：

### 仙侠修真 ☯️
- chapter.content: 文笔典雅清冷，"道、缘、劫、心境"等词汇，景物喻情
- outline.volume: 围绕境界突破/心境蜕变；卷标用古意词
- character.generate: 道号/灵根/师承/心结/风骨
- story.generate: 道与情、凡与仙、长生与解脱
- worldview.dimension: 修真境界/宗门/灵脉/天劫/法器

### 言情 💗
- chapter.content: 心理描写为主，CP 言外之意，错位感
- outline.volume: 感情进度 + 外部矛盾撑情节
- character.generate: 反"标签化"，强调 CP 张力
- story.generate: 关于"如何爱"和"如何被爱"
- worldview.dimension: 真实感细节（行业/阶层/时代）

### 现实主义 🌃
- chapter.content: 日常感、克制、不回避琐碎
- outline.volume: 人生阶段为节点，时代为底
- character.generate: 优缺点共生，时代/地域/阶层痕迹
- story.generate: 个体与时代的张力
- worldview.dimension: 把真实世界写到细节扎实

### 悬疑推理 🔍
- chapter.content: 信息控制 + 不可靠叙事 + 章末必有反转
- outline.volume: 每卷揭穿一层假象
- character.generate: 每个人都有秘密、动机、可疑面
- story.generate: "为什么"重于"谁干的"
- foreshadow.generate: 专属伏笔类型（红鲱鱼/不可靠叙述/时间漏洞 等）

## 切换器 UX

提示词库顶部一行：
```
📚 题材包: [⚙️ 通用 / 玄幻爽文（默认）  ▾]   [描述文字]
```

切换 genre 时：
- general: 把没 genres 字段或含 'general' 的 system 模板按 moduleKey 激活
- xianxia/yanqing/realism/suspense: 把对应 genres 标签的模板批量 setActive

每个 moduleKey 同一时间只有一个激活模板（store.setActive 已保证）。

## 关键 bug 修复

发现：原 store.init() 用 `moduleKey` 作为唯一键，导致同 moduleKey 下的
多套 seed 互相覆盖（19 个主种子 + 20 个题材包种子 = 应该 39 条，实际只
有 19 条）。

修：改用 `name` 作为唯一键。验证：DB 中确实有 39 条 system 模板，分布
- general: 19
- xianxia/yanqing/realism/suspense: 各 5

## DoD

- [x] build 0 error
- [x] DB 中 39 条 system 模板（19 通用 + 4×5 题材）
- [x] 提示词库顶部显示题材包下拉
- [x] 切换包后对应 moduleKey 的激活模板自动切换
- [x] 列表里能看到 4 套包的种子卡片

## 验证

切换到悬疑包后：
- chapter.content 激活的是「悬疑推理包-章节正文」
- outline.volume 激活的是「悬疑推理包-卷级大纲」
- foreshadow.generate 激活的是「悬疑推理包-伏笔建议」
- 对应模板用户在创作区调用 AI 时自动用上

## 后续可加

- 仙侠/言情/现实/悬疑 4 套各自再补 chapter.continue / character.dimension 等
  非核心模板（先做 5 条核心是 80/20 法则）
- 参数化各包模板（部分已加，可再丰富）
- 用户自建题材包导入/导出
