import type { ChatMessage, ShortNovelReviewIssueV1 } from '../types'
import { SHORT_NOVEL_CONTRACT_KEYS } from './contracts'

export type ShortNovelArtifactKindV1 = 'brief' | 'story-design' | 'scene-plan' | 'chapter-draft' | 'continuity-review' | 'targeted-rewrite'

const ROLE: Record<ShortNovelArtifactKindV1, string> = {
  brief: '你是短篇小说责任编辑，负责把作者意图压缩为可执行创作 Brief。',
  'story-design': '你是短篇小说故事设计师，负责设计单一核心变化、递增压力、不可逆转折、高潮选择与余韵。',
  'scene-plan': '你是短篇小说结构编辑，负责把已确认设计拆成紧凑、有因果推进的章节卡。',
  'chapter-draft': '你是短篇小说作者，只负责写指定一章的完整正文。',
  'continuity-review': '你是独立的短篇小说审校编辑，只定位有证据、可执行的问题，不重写正文。',
  'targeted-rewrite': '你是短篇小说修订编辑，只修复指定问题并返回目标章节的完整替换稿。',
}

function common(kind: ShortNovelArtifactKindV1, context: string, authorInstruction: string): string {
  return [
    ROLE[kind],
    'TRUTH BOUNDARY：只能使用下方登记上下文和作者要求。缺失信息不得伪装为既有事实；必要的新创作应符合已确认 Brief 与设计。',
    'FACT PRIORITY：作者本轮明确要求只在明确说明“修改/替换”时覆盖既有内容；否则 REGISTERED CONTEXT 中已确认的 Brief、设计、章节卡以及当前 Work 的标题和简介都是锁定事实。所有明确出现的人名、身份、关系、地点、引爆事件、期限、核心两难与禁区必须保留，不得换成更顺手的替代设定。',
    'FIDELITY GATE：如果候选改变了锁定人物、职业、关系、场景、引爆事件、倒计时或核心选择，即使文笔更完整也视为失败；只能补足未定义的连接信息，不能另起一个故事。',
    'SCOPE：本次只产生一种 artifact，不顺手修改其他阶段。只输出一个严格 JSON 值，不要 Markdown、解释、代码围栏或隐藏推理。',
    'IDENTITY：章节稳定键只能使用 chapter-1 至 chapter-8；不得输出数据库数字 ID。',
    'PROTOCOL TYPES：所有名为 version 的字段必须使用 JSON 数字 1（不能使用字符串 "1"）；数字字段不得写成字符串；英文枚举标识必须逐字照抄，不得翻译成中文。',
    authorInstruction.trim() ? `AUTHOR CONSTRAINTS：${authorInstruction.trim()}` : 'AUTHOR CONSTRAINTS：无额外要求。',
    `REGISTERED CONTEXT：\n${context}`,
    'FAILURE MODE：上下文不足时，把限制写进对应字段或审校 issue，不得虚构“已发生”的人物、事件或因果。',
    'SILENT CHECKLIST：输出前静默检查字段闭集、因果、视角、字数预算与稳定键；不要输出检查过程。',
  ].join('\n\n')
}

export function buildShortNovelPromptV1(input: {
  kind: ShortNovelArtifactKindV1
  context: string
  authorInstruction: string
  chapterKey?: string
  issue?: ShortNovelReviewIssueV1
}): ChatMessage[] {
  const system = common(input.kind, input.context, input.authorInstruction)
  let objective: string
  if (input.kind === 'brief') {
    objective = `生成 ShortNovelBriefV1。字段严格且仅为：${SHORT_NOVEL_CONTRACT_KEYS.BRIEF_KEYS.join(', ')}。version 必须是数字 1；pointOfView 只能逐字使用 first-person、third-limited、third-omniscient 之一；tense 只能逐字使用 past、present 之一；targetWordCount 和 chapterCount 必须是 JSON 数字并精确沿用 REGISTERED CONTEXT 中的当前 Work 骨架。premise 必须忠实压缩当前 Work 简介，不得另拟主角、职业、关系、地点、谜团或故事引擎；简介中明确的人物、关系、引爆事件、期限和核心两难必须逐项进入 premise 或 mustKeep，明确禁区必须进入 forbidden。目标字数范围 5,000～25,000，章节数范围 3～8；coreChange 表达该名主人公经历后不可逆的变化；storyPromise 可在结尾检验。`
  } else if (input.kind === 'story-design') {
    objective = `生成 ShortNovelStoryDesignV1。字段严格且仅为：${SHORT_NOVEL_CONTRACT_KEYS.DESIGN_KEYS.join(', ')}。version 必须是数字 1；escalation 必须是含 2～5 个非空字符串的 JSON 数组。用一个主角、一条主冲突和有限角色完成闭环；climaxChoice 必须迫使主角用行动回答 thematicQuestion；endingImage 与开场形成变化对照。`
  } else if (input.kind === 'scene-plan') {
    objective = `生成章节计划 JSON 数组，数量必须等于 Brief.chapterCount。每项字段严格且仅为：${SHORT_NOVEL_CONTRACT_KEYS.PLAN_KEYS.join(', ')}。数组元素没有 version 字段，绝对不要添加 version、characters、scenes 或其他键。每项必须精确采用这个 JSON 形状：{"stableKey":"chapter-1","order":0,"title":"非空标题","purpose":"非空文本","viewpoint":"非空文本","openingPressure":"非空文本","conflict":"非空文本","turn":"非空文本","exitState":"非空文本","targetWordCount":1667}。stableKey/order 从 chapter-1/order=0 连续递增；targetWordCount 使用 JSON 数字且总和接近 Work 目标字数；每章包含目标、冲突、转折、离场状态，开头尽快施压，高潮前不给出最终答案。`
  } else if (input.kind === 'chapter-draft') {
    objective = `为 ${input.chapterKey} 生成 ShortNovelChapterDraftV1，字段严格且仅为：${SHORT_NOVEL_CONTRACT_KEYS.DRAFT_KEYS.join(', ')}。version 必须是数字 1，chapterKey 必须精确等于 ${input.chapterKey}。content 使用纯文本自然段，不要 Markdown 标题；它必须是一个合法 JSON 字符串：段落换行编码为\\n\\n，对白一律使用中文引号“”而非未转义的英文双引号，整个响应中不得出现 JSON 字符串之外的正文。严格执行该章结构卡、承接前章离场状态并把下一章所需状态交代清楚。知识边界：完整故事设计与后续章节卡属于幕后规划，不代表当前人物已经知道；本章只能使用前章正文已发生的事实和本章结构卡允许揭示的信息，禁止把后章 turn、真相或高潮结论提前写入。本章非空白字符数必须控制在结构卡“字数预算”的 90%～110%，输出前静默计数并删去重复解释；同一线索、疑问或决定不要换句话重复，不提前兑现后续高潮。`
  } else if (input.kind === 'continuity-review') {
    objective = `生成 ShortNovelReviewV1。顶层必须精确采用这个 JSON 形状：{"version":1,"summary":"非空总结","strengths":["非空优点"],"issues":[]}，不得增加 score、verdict、recommendations 等键。每个 issue 必须精确采用这个 JSON 形状：{"stableKey":"issue-1","severity":"major","category":"continuity","chapterKeys":["chapter-1"],"evidence":"实际短引文或结构事实","problem":"非空问题","suggestion":"非空建议","status":"open"}，字段严格且仅为：${SHORT_NOVEL_CONTRACT_KEYS.ISSUE_KEYS.join(', ')}；绝对不要增加 title、location、line、priority、confidence 或 reasoning。version 必须是数字 1；severity 仅逐字使用 critical/major/minor；category 仅逐字使用 causality/character/continuity/pacing/point-of-view/promise-payoff/prose；status 固定为英文 open。evidence 必须引用短小的实际文本或结构事实；没有问题时 issues=[]，不得为凑数发明问题。`
  } else {
    objective = `只修复下列问题，并为 ${input.chapterKey} 返回 ShortNovelChapterDraftV1，字段严格且仅为：${SHORT_NOVEL_CONTRACT_KEYS.DRAFT_KEYS.join(', ')}。version 必须是数字 1，chapterKey 必须精确等于 ${input.chapterKey}。保持未涉及的情节事实、视角、语气和长度，不改其他章节。问题：${JSON.stringify(input.issue)}`
  }
  return [{ role: 'system', content: system }, { role: 'user', content: objective }]
}
