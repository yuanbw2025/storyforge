import type {
  AuthorLengthIntentV1, AuthorLengthQuantifierV1, LengthBasisV1, LengthOperationV1,
  LengthTaskKindV1, TaskLengthArrangementV1, TaskLengthComponentV1, TaskLengthPlanV1,
} from '../types/agent-run'

export interface AuthorLengthControlValueV1 {
  mode: 'automatic' | AuthorLengthQuantifierV1
  targetWords: number | null
  minWords: number | null
  maxWords: number | null
  basis?: LengthBasisV1
}
export const AUTOMATIC_AUTHOR_LENGTH_V1: AuthorLengthControlValueV1 = {
  mode: 'automatic', targetWords: null, minWords: null, maxWords: null,
}
const kinds: readonly LengthTaskKindV1[] = ['setting-field', 'setting-set', 'chapter', 'volume', 'work', 'short-field']
const operations: readonly LengthOperationV1[] = ['create', 'expand', 'rewrite', 'polish', 'continue', 'correct', 'name']
const bases: readonly LengthBasisV1[] = ['final-text', 'additional-text']
const quantifiers: readonly AuthorLengthQuantifierV1[] = ['approximate', 'exact', 'range', 'at-least', 'at-most']
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('篇幅记录必须是对象。')
  return value as Record<string, unknown>
}
function exact(row: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(row).sort().join('|') !== [...keys].sort().join('|')) throw new Error('篇幅记录字段不匹配。')
}
function words(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error('字数必须是可可靠计数的正整数。')
  return value as number
}
function sourceKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim()) || new Set(value).size !== value.length) throw new Error('篇幅安排来源无效。')
  return [...value] as string[]
}
export function createAuthorLengthIntentV1(input: {
  quantifier: AuthorLengthQuantifierV1; basis: LengthBasisV1; source: AuthorLengthIntentV1['source']
  targetWords?: number | null; minWords?: number | null; maxWords?: number | null
}): AuthorLengthIntentV1 {
  if (!quantifiers.includes(input.quantifier) || !bases.includes(input.basis)
    || !['control', 'instruction', 'parameter'].includes(input.source)) throw new Error('篇幅要求身份无效。')
  let targetWords: number | null = null
  let minWords: number | null = null
  let maxWords: number | null = null
  let acceptedMin: number | null = null
  let acceptedMax: number | null = null
  if (input.quantifier === 'approximate' || input.quantifier === 'exact') {
    targetWords = words(input.targetWords)
    if (input.quantifier === 'exact') minWords = maxWords = acceptedMin = acceptedMax = targetWords
    else {
      const target = BigInt(targetWords)
      const ceiling = (target * 6n + 4n) / 5n
      if (ceiling > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('篇幅要求的提示范围超出安全整数范围。')
      acceptedMin = Math.max(1, Number(target * 4n / 5n))
      acceptedMax = Number(ceiling)
    }
  } else {
    if (input.quantifier !== 'at-most') minWords = acceptedMin = words(input.minWords)
    if (input.quantifier !== 'at-least') maxWords = acceptedMax = words(input.maxWords)
    if (minWords !== null && maxWords !== null && minWords > maxWords) throw new Error('最少字数不能大于最多字数。')
  }
  return { version: 1, targetWords, minWords, maxWords, basis: input.basis, source: input.source,
    quantifier: input.quantifier, acceptance: { minWords: acceptedMin, maxWords: acceptedMax } }
}
export function parseAuthorLengthIntentV1(value: unknown): AuthorLengthIntentV1 {
  const row = record(value)
  exact(row, ['version', 'targetWords', 'minWords', 'maxWords', 'basis', 'source', 'quantifier', 'acceptance'])
  if (row.version !== 1) throw new Error('篇幅要求版本无效。')
  const parsed = createAuthorLengthIntentV1(row as unknown as Parameters<typeof createAuthorLengthIntentV1>[0])
  const acceptance = record(row.acceptance)
  exact(acceptance, ['minWords', 'maxWords'])
  if (row.targetWords !== parsed.targetWords || row.minWords !== parsed.minWords || row.maxWords !== parsed.maxWords
    || acceptance.minWords !== parsed.acceptance.minWords || acceptance.maxWords !== parsed.acceptance.maxWords) throw new Error('篇幅要求的界限不一致。')
  return parsed
}
function maskQuotedMaterial(text: string): string {
  const blank = (value: string) => value.replace(/[^\r\n]/g, ' ')
  let masked = text.replace(/```[\s\S]*?```/g, blank).replace(/^\s*>.*$/gm, blank)
  for (const pair of [['“', '”'], ['‘', '’'], ['「', '」'], ['『', '』'], ['"', '"'], ['`', '`']]) {
    let start = 0
    while (start < masked.length) {
      const opening = masked.indexOf(pair[0], start)
      if (opening < 0) break
      const closing = masked.indexOf(pair[1], opening + pair[0].length)
      if (closing < 0) break
      const end = closing + pair[1].length
      masked = masked.slice(0, opening) + blank(masked.slice(opening, end)) + masked.slice(end)
      start = end
    }
  }
  return masked
}
export function authorLengthFromInstructionV1(text: string, fallbackBasis: LengthBasisV1): AuthorLengthIntentV1 | null {
  let result: AuthorLengthIntentV1 | null = null
  for (const clause of maskQuotedMaterial(text).split(/[。！？\n，,；;]/)) {
    const trimmed = clause.trim()
    const prefix = trimmed.match(/^(?:(?:目标字数|目标篇幅|本轮|本次|本章|这章|章节|正文|本项|设定|世界观|字数|篇幅|目标|长度|要求|控制在|调整为|改成|改为|总共|总计|全文|净新增|新增|追加|只写|续写|扩写|生成|请|写)(?:\s|[:：]|为|是)*)+/)?.[0] ?? ''
    const body = trimmed.slice(prefix.length).trim()
    const finalIndex = Math.max(prefix.lastIndexOf('全文'), prefix.lastIndexOf('总共'), prefix.lastIndexOf('总计'))
    const additionalIndex = Math.max(prefix.lastIndexOf('新增'), prefix.lastIndexOf('追加'), prefix.lastIndexOf('续写'))
    const basis = finalIndex < 0 && additionalIndex < 0 ? fallbackBasis : finalIndex > additionalIndex ? 'final-text' : 'additional-text'
    const range = body.match(/^(\d+)\s*(?:[-~～—]|到|至)\s*(\d+)\s*字/)
    const floor = body.match(/^(?:不少于|至少|最低)\s*(\d+)\s*字/)
    const cap = body.match(/^(?:不超过|不要超过|不得超过|最多|至多)\s*(\d+)\s*字/)
    const precise = body.match(/^(?:恰好|正好|严格(?:为|控制在)?)\s*(\d+)\s*字/)
    const target = body.match(/^(?:约|大约|大概)?\s*(\d+)\s*字(?!\s*的(?:信|纸条|短信|标语|摘要))/)
    if (range) result = createAuthorLengthIntentV1({ quantifier: 'range', minWords: Number(range[1]), maxWords: Number(range[2]), basis, source: 'instruction' })
    else if (floor) result = createAuthorLengthIntentV1({ quantifier: 'at-least', minWords: Number(floor[1]), basis, source: 'instruction' })
    else if (cap) result = createAuthorLengthIntentV1({ quantifier: 'at-most', maxWords: Number(cap[1]), basis, source: 'instruction' })
    else if (precise) result = createAuthorLengthIntentV1({ quantifier: 'exact', targetWords: Number(precise[1]), basis, source: 'instruction' })
    else if (target && (prefix || /^(?:约|大约|大概)/.test(body))) result = createAuthorLengthIntentV1({ quantifier: 'approximate', targetWords: Number(target[1]), basis, source: 'instruction' })
  }
  return result
}
export function authorLengthInstructionNoticeV1(text: string, basis: LengthBasisV1): string | null {
  return authorLengthFromInstructionV1(text, basis) === null && /(?:\d|[一二两三四五六七八九十百千万亿]).{0,12}字/.test(maskQuotedMaterial(text))
    ? '这段篇幅说明尚未转换为可计数范围；原要求仍完整发送，可用篇幅控件明确目标。' : null
}
export function authorLengthFromControlV1(value: AuthorLengthControlValueV1 | null | undefined, basis: LengthBasisV1): AuthorLengthIntentV1 | null {
  if (!value || value.mode === 'automatic') return null
  return createAuthorLengthIntentV1({ ...value, quantifier: value.mode, source: 'control', basis: value.basis ?? basis })
}
export function parseTaskLengthPlanV1(value: unknown): TaskLengthPlanV1 {
  const row = record(value)
  exact(row, row.mode === 'automatic'
    ? ['version', 'taskKind', 'operation', 'basis', 'countingVersion', 'arrangement', 'mode', 'referenceWords', 'components']
    : ['version', 'taskKind', 'operation', 'basis', 'countingVersion', 'arrangement', 'mode', 'intent'])
  if (row.version !== 1 || row.countingVersion !== 'non-whitespace-utf16-v1' || !kinds.includes(row.taskKind as LengthTaskKindV1)
    || !operations.includes(row.operation as LengthOperationV1) || !bases.includes(row.basis as LengthBasisV1)) throw new Error('篇幅计划身份无效。')
  const arrangement = record(row.arrangement)
  exact(arrangement, ['version', 'basis', 'sourceKeys'])
  if (arrangement.version !== 1 || !['confirmed-outline', 'confirmed-work-target', 'task-semantics', 'preserve-original'].includes(String(arrangement.basis))) throw new Error('篇幅安排无效。')
  sourceKeys(arrangement.sourceKeys)
  if (row.mode === 'explicit') {
    const intent = parseAuthorLengthIntentV1(row.intent)
    if (intent.basis !== row.basis) throw new Error('篇幅计划与作者计数范围不一致。')
  } else if (row.mode === 'automatic') {
    if (row.referenceWords !== null) words(row.referenceWords)
    if (!Array.isArray(row.components)) throw new Error('分项篇幅安排无效。')
    const keys: string[] = []
    for (const value of row.components) {
      const component = record(value)
      exact(component, ['componentKey', 'taskKind', 'referenceWords'])
      if (typeof component.componentKey !== 'string' || !component.componentKey.trim() || !kinds.includes(component.taskKind as LengthTaskKindV1)) throw new Error('分项篇幅安排身份无效。')
      if (component.referenceWords !== null) words(component.referenceWords)
      keys.push(component.componentKey)
    }
    if (new Set(keys).size !== keys.length) throw new Error('分项篇幅安排不能重复。')
  } else throw new Error('篇幅计划模式无效。')
  return structuredClone(row) as unknown as TaskLengthPlanV1
}
export function resolveAuthorLengthIntentV1(input: {
  basis: LengthBasisV1; control?: AuthorLengthControlValueV1 | null
  instruction?: string; explicitParameter?: unknown
}): AuthorLengthIntentV1 | null {
  const { basis } = input
  const controlled = authorLengthFromControlV1(input.control, basis)
  const declared = controlled ? null : authorLengthFromInstructionV1(input.instruction ?? '', basis)
  const parameter = input.explicitParameter
  const parameterWords = typeof parameter === 'number' ? parameter : typeof parameter === 'string' && /^\d+$/.test(parameter.trim()) ? Number(parameter) : null
  return controlled ?? declared ?? (parameterWords !== null && parameterWords > 0
    ? createAuthorLengthIntentV1({ quantifier: 'approximate', targetWords: parameterWords, basis, source: 'parameter' }) : null)
}
export function resolveTaskLengthPlanV1(input: {
  taskKind: LengthTaskKindV1; operation: LengthOperationV1; basis?: LengthBasisV1
  control?: AuthorLengthControlValueV1 | null; instruction?: string; explicitParameter?: unknown
  intent?: AuthorLengthIntentV1 | null
  arrangement?: TaskLengthArrangementV1; referenceWords?: number | null; originalWords?: number | null
  components?: readonly TaskLengthComponentV1[]
}): TaskLengthPlanV1 {
  const basis = input.basis ?? (input.operation === 'continue' || input.operation === 'expand' ? 'additional-text' : 'final-text')
  const intent = input.intent !== undefined ? input.intent === null ? null : parseAuthorLengthIntentV1(input.intent) : resolveAuthorLengthIntentV1({ ...input, basis })
  const preserve = input.operation === 'polish' || input.operation === 'correct' || input.operation === 'name'
  const arrangement = input.arrangement ?? { version: 1 as const, basis: preserve ? 'preserve-original' as const : 'task-semantics' as const, sourceKeys: [] }
  const common = { version: 1 as const, taskKind: input.taskKind, operation: input.operation,
    basis: intent?.basis ?? basis, countingVersion: 'non-whitespace-utf16-v1' as const, arrangement }
  if (intent) return parseTaskLengthPlanV1({ ...common, mode: 'explicit', intent })
  const referenceWords = input.referenceWords !== undefined ? input.referenceWords
    : preserve ? input.originalWords != null && input.originalWords > 0 ? input.originalWords : null : input.taskKind === 'setting-field' || input.taskKind === 'chapter' ? 4000 : null
  return parseTaskLengthPlanV1({ ...common, mode: 'automatic', referenceWords, components: input.components ?? [] })
}
export function describeTaskLengthPlanV1(plan: TaskLengthPlanV1): string {
  const parsed = parseTaskLengthPlanV1(plan)
  const unit = parsed.basis === 'additional-text' ? '净新增内容' : '最终内容'
  if (parsed.mode === 'automatic') {
    const components = parsed.components.map(item => `${item.componentKey}：${item.referenceWords === null ? '按该分项的实际内容安排' : `约${item.referenceWords}字作为参考`}`)
    return `自动，按任务安排${parsed.referenceWords === null ? '' : `，${unit}约${parsed.referenceWords}字作为参考`}${components.length ? `；各分项独立安排：${components.join('；')}` : ''}；参考值不是上限。`
  }
  const intent = parsed.intent
  const range = intent.acceptance
  return `${unit}：${intent.quantifier === 'exact' ? `恰好${intent.targetWords}` : range.minWords === null ? `最多${range.maxWords}` : range.maxWords === null ? `至少${range.minWords}` : `${range.minWords}～${range.maxWords}`}字。`
}
