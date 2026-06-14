/**
 * Budget / 硬截断 阈值清单（H2 暴露阶段 — 单点查询事实源）
 *
 * 现状：项目里的 budget / 硬截断分散在多个文件：
 *   - context-sources.ts 的 budgetTokens（每个 source 的 token 上限）
 *   - assemble-context.ts 的 DEFAULT_INPUT_BUDGET（assembleContext 总闸）
 *   - 各 reader / formatter 的 slice(0, N)、slice(0, M) 等"条数 / 字数"硬截断
 *
 * 本文件 **不修改任何运行时行为**，只把事实集中起来供：
 *   1. 高级设置面板（H2）按表格只读展示；
 *   2. 各业务面板的"超限提示与警告"（H3）查找各字段对应的字符上限；
 *   3. 大纲 / 正文「查看注入 prompt」面板（H4）显示每段实际占用 vs 上限；
 *   4. 高级设置面板的"调整入口"（H5）写回时定位字段。
 *
 * 维护原则：
 * - 每条记录的 `value` 必须与代码里实际生效的写死值保持一致；改代码时同步改这里。
 * - `targetCode` 只是供面板展示用的"出处"链接文本，不参与运行。
 */

/** 单条 budget 元数据 */
export interface BudgetEntry {
  /** 唯一键，用于 H5 调整入口写回时定位 */
  key: string
  /** 面板上展示的中文标签 */
  label: string
  /** 单位（token / chars / count） */
  unit: 'token' | 'chars' | 'count'
  /** 当前生效的硬编码数值；若为对象表示同一处有多种维度（如条数 + 单条字数） */
  value: number | Record<string, number>
  /** 简要说明：作者看到这个数值会立即知道它影响什么 */
  note: string
  /** 出处文件路径（仅展示用）*/
  targetCode: string
  /** 分组：context-source | assemble | reader | formatter | engine */
  group: 'context-source' | 'assemble' | 'reader' | 'formatter' | 'engine'
}

/** Context source 级别的 token 上限（来自 context-sources.ts 各 source 的 budgetTokens） */
export const CONTEXT_SOURCE_BUDGETS: BudgetEntry[] = [
  { key: 'src.contextMemo',        label: '上下文快照',       unit: 'token', value: 1500, note: '装入 assembleContext 时的 token 硬上限。',                                  targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.chapterOutline',     label: '当前章节大纲',     unit: 'token', value: 800,  note: '当前章节的标题 + 摘要，注入正文写作。',                                      targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.detailedOutline',    label: '本章细纲（场景拆解）', unit: 'token', value: 1500, note: '逐场景拆解信息，注入正文写作。',                                            targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.previousChapterEnding', label: '上一章结尾',     unit: 'token', value: 500,  note: '正文写作时由调用方手动传入。',                                                targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.worldview',          label: '世界观',          unit: 'token', value: 2500, note: '世界观全字段格式化后的 token 上限。',                                          targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.storyCore',          label: '故事核心',         unit: 'token', value: 1200, note: 'logline / 主题 / 冲突 / 主线 / 复线 等。',                                    targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.powerSystem',        label: '力量体系',         unit: 'token', value: 1200, note: '力量体系名称 + 等级阶梯 + 规则。',                                            targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.codex',              label: '设定词条',         unit: 'token', value: 2500, note: '所有词条按分类紧凑序列化后的 token 上限。',                                  targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.characters',         label: '角色档案',         unit: 'token', value: 2500, note: '主角 + 重要配角 + 其他角色（分档处理）。',                                    targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.creativeRules',      label: '创作规则',         unit: 'token', value: 1000, note: '风格 / 视角 / 基调 / 禁忌 / 一致性等。',                                       targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.worldRules',         label: '真实与幻想规则',   unit: 'token', value: 1200, note: '世界规则清单。',                                                            targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.historical',         label: '历史时间线 / 关键词', unit: 'token', value: 1800, note: '历史年表 + 关键词条目（条目定稿）。',                                        targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.locations',          label: '重要地点',         unit: 'token', value: 1200, note: '按 sortOrder 取前若干条。',                                                  targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.foreshadows',        label: '伏笔',            unit: 'token', value: 1200, note: '当前章节关联的伏笔；无章节时取前若干条。',                                    targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.storyArcs',          label: '故事线（StoryArc）', unit: 'token', value: 1500, note: '主线 / 支线阶段卡。',                                                       targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.emotionBeats',       label: '情感节拍',         unit: 'token', value: 1000, note: '当前章节的整体弧线 + 节拍清单。',                                              targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.stateCards',         label: '状态卡',          unit: 'token', value: 1800, note: '按引用文本 / 手动勾选过滤后的状态卡列表。',                                  targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.references',         label: '引用手法',         unit: 'token', value: 2000, note: '已分析的参考作品的方法论结论。',                                              targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
  { key: 'src.userStyleProfile',   label: '我的文风',         unit: 'token', value: 700,  note: '作者文风画像（启用时）。',                                                  targetCode: 'src/lib/registry/context-sources.ts', group: 'context-source' },
]

/** assembleContext 全局总闸 */
export const ASSEMBLE_BUDGETS: BudgetEntry[] = [
  { key: 'assemble.defaultInputBudget', label: 'assembleContext 总闸', unit: 'token', value: 24000,
    note: 'assembleContext 装配后总 token 上限。超出按 L3 → L2 → L1 整层裁剪。',
    targetCode: 'src/lib/registry/assemble-context.ts', group: 'assemble' },
]

/** Reader 级别的"条数 + 单条字符"硬截断（写死在 reader 函数里的 slice(0, N)） */
export const READER_BUDGETS: BudgetEntry[] = [
  { key: 'reader.foreshadows',  label: '伏笔（无章节时）',   unit: 'count', value: { 最多条数: 25, 单条字符: 120 },
    note: '无 chapterId 时取最近 25 条未结束伏笔，每条描述截 120 字。',
    targetCode: 'src/lib/registry/context-sources.ts → readForeshadows', group: 'reader' },
  { key: 'reader.storyArcs',    label: '故事线 storyArcs',   unit: 'count', value: { 最多故事线: 8, 每条阶段数: 6, 描述字符: 120, 阶段字符: 120 },
    note: '故事线最多 8 条，每条阶段最多 6 个；描述与阶段各截 120 字。',
    targetCode: 'src/lib/registry/context-sources.ts → readStoryArcs', group: 'reader' },
  { key: 'reader.stateCards',   label: '状态卡',            unit: 'count', value: { 无引用文本时: 40, 每卡字段数: 8 },
    note: '无引用文本时取前 40 张状态卡；每卡 fields 取前 8 个。',
    targetCode: 'src/lib/registry/context-sources.ts → readStateCards', group: 'reader' },
  { key: 'reader.locations',    label: '重要地点',          unit: 'count', value: { 最多条数: 25, 总字符上限: 1200 },
    note: '按 sortOrder 取前 25 条；整段输出截 1200 字。',
    targetCode: 'src/lib/ai/context-builder.ts → buildLocationContext', group: 'reader' },
  { key: 'reader.historical',   label: '历史时间线 + 关键词', unit: 'chars', value: 2000,
    note: '事件 + 关键词整体字符上限（其中事件最多占 60%）。',
    targetCode: 'src/lib/ai/context-builder.ts → buildHistoricalContext', group: 'reader' },
  { key: 'reader.historical.event描述',    label: '历史事件 · 描述截断',  unit: 'chars', value: 80,
    note: '每条事件的 description 在注入大纲 / 正文 prompt 时按此长度截断（事件标题 / 时间 / 地理范围另算）。',
    targetCode: 'src/lib/ai/context-builder.ts → buildHistoricalContext', group: 'reader' },
  { key: 'reader.historical.关键词描述',   label: '历史关键词 · 描述截断', unit: 'chars', value: 40,
    note: '每条历史关键词的 description 在注入 prompt 时按此长度截断（关键词名 / 分类 / 时期另算）。',
    targetCode: 'src/lib/ai/context-builder.ts → buildHistoricalContext', group: 'reader' },
  { key: 'reader.codex',        label: '设定词条',          unit: 'count', value: { 每分类最多: 30, 每条字段数: 3, 总字符上限: 2500 },
    note: '词条按分类排版；超过总上限会被尾部截断。',
    targetCode: 'src/lib/ai/codex-context.ts → buildCodexContext', group: 'reader' },
]

/** Formatter 级别的字段 slice 上限（context-builder 里的 .slice(0, N)） */
export const FORMATTER_BUDGETS: BudgetEntry[] = [
  { key: 'fmt.storyCore.mainPlot',     label: '故事核心 · 主线',  unit: 'chars', value: 250, note: '故事核心的"主线"字段，超出截 250 字。', targetCode: 'src/lib/ai/context-builder.ts → formatStoryCoreBlock', group: 'formatter' },
  { key: 'fmt.storyCore.subPlots',     label: '故事核心 · 复线',  unit: 'chars', value: 200, note: '故事核心的"复线"字段，超出截 200 字。', targetCode: 'src/lib/ai/context-builder.ts → formatStoryCoreBlock', group: 'formatter' },
  { key: 'fmt.character.appearance',   label: '角色 · 外貌',     unit: 'chars', value: 150, note: '主角 / 反派档位。', targetCode: 'src/lib/ai/context-builder.ts → buildCharacterContext', group: 'formatter' },
  { key: 'fmt.character.personality',  label: '角色 · 性格',     unit: 'chars', value: 150, note: '主角 / 反派档位。', targetCode: 'src/lib/ai/context-builder.ts → buildCharacterContext', group: 'formatter' },
  { key: 'fmt.character.background',   label: '角色 · 背景',     unit: 'chars', value: 200, note: '主角 / 反派档位。', targetCode: 'src/lib/ai/context-builder.ts → buildCharacterContext', group: 'formatter' },
  { key: 'fmt.character.motivation',   label: '角色 · 动机',     unit: 'chars', value: 150, note: '主角 / 反派档位。', targetCode: 'src/lib/ai/context-builder.ts → buildCharacterContext', group: 'formatter' },
  { key: 'fmt.character.abilities',    label: '角色 · 能力',     unit: 'chars', value: 150, note: '主角 / 反派档位。', targetCode: 'src/lib/ai/context-builder.ts → buildCharacterContext', group: 'formatter' },
  { key: 'fmt.character.arc',          label: '角色 · 成长弧线', unit: 'chars', value: 150, note: '主角 / 反派档位。', targetCode: 'src/lib/ai/context-builder.ts → buildCharacterContext', group: 'formatter' },
  { key: 'fmt.character.relationships',label: '配角 · 一句话关系', unit: 'chars', value: 80,  note: 'supporting 档位才注入；主 / 反派档位中此字段不进 prompt。', targetCode: 'src/lib/ai/context-builder.ts → buildCharacterContext', group: 'formatter' },
  { key: 'fmt.rules.style',            label: '创作规则 · 写作风格', unit: 'chars', value: 200, note: '——', targetCode: 'src/lib/ai/context-builder.ts → buildCreativeRulesContext', group: 'formatter' },
  { key: 'fmt.rules.atmosphere',       label: '创作规则 · 基调氛围', unit: 'chars', value: 150, note: '——', targetCode: 'src/lib/ai/context-builder.ts → buildCreativeRulesContext', group: 'formatter' },
  { key: 'fmt.rules.special',          label: '创作规则 · 特殊要求', unit: 'chars', value: 200, note: '——', targetCode: 'src/lib/ai/context-builder.ts → buildCreativeRulesContext', group: 'formatter' },
  { key: 'fmt.worldview.summary',      label: '世界观 · 摘要',    unit: 'chars', value: 300, note: 'formatWorldviewBlock 中各字段还有更细粒度的截断，详见原文件。', targetCode: 'src/lib/ai/context-builder.ts → formatWorldviewBlock', group: 'formatter' },
]

/** Engine 级别（few-shot / 续写裁剪等） */
export const ENGINE_BUDGETS: BudgetEntry[] = [
  { key: 'engine.fewShot.good',     label: 'few-shot 好示例上限', unit: 'count', value: 3,
    note: '拼到 user prompt 末尾的好示例最多 3 条。', targetCode: 'src/lib/ai/prompt-engine.ts → renderPrompt', group: 'engine' },
  { key: 'engine.fewShot.bad',      label: 'few-shot 反例上限',   unit: 'count', value: 2,
    note: '拼到 user prompt 末尾的反例最多 2 条。', targetCode: 'src/lib/ai/prompt-engine.ts → renderPrompt', group: 'engine' },
  { key: 'engine.continueTail',     label: '续写时取已有正文末尾', unit: 'chars', value: 3000,
    note: 'chapter.continue 模板里 existingContent.slice(-3000)。', targetCode: 'src/lib/ai/adapters/chapter-adapter.ts → buildContinuePrompt', group: 'engine' },
  { key: 'engine.previousEnding',   label: '正文写作 · 前一章结尾', unit: 'chars', value: 500,
    note: 'ChapterEditor 取前一章 plainText 末尾的字符数。', targetCode: 'src/components/editor/ChapterEditor.tsx', group: 'engine' },
]

/** 全部预算分组（高级设置面板按这个顺序展示） */
export const BUDGET_GROUPS: { id: BudgetEntry['group']; label: string; entries: BudgetEntry[]; description: string }[] = [
  { id: 'assemble',       label: '装配总闸',     entries: ASSEMBLE_BUDGETS,        description: 'assembleContext 装配完所有 source 后再施加的全局 token 总闸。超出会按层级裁剪。' },
  { id: 'context-source', label: '上下文源预算', entries: CONTEXT_SOURCE_BUDGETS,  description: '每个 context source 自己的 token 硬上限，先于装配总闸生效。' },
  { id: 'reader',         label: 'Reader 截断',  entries: READER_BUDGETS,          description: '各 source 的 reader 函数内部写死的"条数 / 单条字符"上限。' },
  { id: 'formatter',      label: '字段格式化截断', entries: FORMATTER_BUDGETS,    description: 'context-builder 里把单条记录序列化为文本时，对每个字段做的 slice。' },
  { id: 'engine',         label: 'Prompt 引擎截断', entries: ENGINE_BUDGETS,      description: '提示词引擎 / 适配器层的尾部裁剪，例如 few-shot 数量、续写取尾长度。' },
]

/** Leaf entry：把对象型 entry 拆成单值（key + 子字段名）。供高级设置面板和 effective-limits 使用。 */
export interface BudgetLeaf {
  /** flat key，例如 'reader.foreshadows.最多条数' / 'src.contextMemo' */
  flatKey: string
  /** 顶层 entry */
  parent: BudgetEntry
  /** 对象型 entry 的子字段名；单值时为 null */
  subKey: string | null
  /** 该 leaf 的默认值（运行时硬编码值） */
  defaultValue: number
  /** 面板展示的标签 */
  label: string
}

/** 把一个 BudgetEntry 拆成 1+ 个 leaf。 */
export function flattenBudgetEntry(entry: BudgetEntry): BudgetLeaf[] {
  if (typeof entry.value === 'number') {
    return [{ flatKey: entry.key, parent: entry, subKey: null, defaultValue: entry.value, label: entry.label }]
  }
  return Object.entries(entry.value).map(([sub, num]) => ({
    flatKey: `${entry.key}.${sub}`,
    parent: entry,
    subKey: sub,
    defaultValue: num,
    label: `${entry.label} · ${sub}`,
  }))
}
