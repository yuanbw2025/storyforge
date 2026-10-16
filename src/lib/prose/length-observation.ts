import { countWords } from '../utils/html'

export interface ProseLengthExpectationV1 {
  version: 1
  source: 'author' | 'parameter'
  min: number | null
  max: number | null
  target: number | null
}

export interface ProseLengthObservationV1 {
  version: 1
  wordCount: number
  status: 'unspecified' | 'within' | 'short' | 'long' | 'truncated'
  finishReason: string | null
  expectation: ProseLengthExpectationV1 | null
  message: string | null
}

/** A declared range is exact. A single target uses a visible 20% advisory
 * tolerance; literary quality and acceptance remain author decisions. */
export function proseLengthExpectationV1(authorRequest: string, parameter?: unknown): ProseLengthExpectationV1 | null {
  const valid = (number: number) => Number.isSafeInteger(number) && number > 0 && number <= 200_000
  // Only explicit request clauses are length controls. A character's letter,
  // a quotation or a report about a previous chapter is narrative input.
  const leading = '(?:^|[。！？\\n，,；;])\\s*(?:请\\s*)?(?:(?:本轮|本章|正文|这章|章节)\\s*(?:请\\s*)?)?'
  const declaration = '(?:(?:字数|篇幅|目标字数|目标篇幅|目标|长度)(?:\\s|[:：]|请|为|是|要求|控制在|约|大约){0,6}|(?:只写|续写|写|生成)(?:\\s|约|大约|大概|一段|一章|正文|本章|总计|一共){0,6})'
  const expression = (body: string, required = false) => new RegExp(leading + (required ? declaration : `(?:${declaration})?`) + '\\s*' + body, 'g')
  const lastMatch = (expression: RegExp) => {
    const matches = [...authorRequest.matchAll(expression)]
    return matches[matches.length - 1]
  }
  const range = lastMatch(expression('(\\d+)\\s*(?:[-~～—]|到|至)\\s*(\\d+)\\s*字'))
  if (range) {
    const min = Number(range[1]); const max = Number(range[2])
    if (valid(min) && valid(max) && min <= max) return { version: 1, source: 'author', min, max, target: null }
  }
  const cap = lastMatch(expression('(?:不超过|不要超过|不得超过|最多|至多)\\s*(\\d+)\\s*字'))
  if (cap && valid(Number(cap[1]))) return { version: 1, source: 'author', min: null, max: Number(cap[1]), target: null }
  const floor = lastMatch(expression('(?:不少于|至少|最低)\\s*(\\d+)\\s*字'))
  if (floor && valid(Number(floor[1]))) return { version: 1, source: 'author', min: Number(floor[1]), max: null, target: null }
  const targetMatch = lastMatch(expression('(\\d+)\\s*字(?!\\s*的(?:信|纸条|短信|标语))', true))
  const number = targetMatch ? Number(targetMatch[1]) : Number(parameter)
  if (!valid(number)) return null
  return { version: 1, source: targetMatch ? 'author' : 'parameter', min: Math.max(1, Math.floor(number * 0.8)), max: Math.ceil(number * 1.2), target: number }
}

export function observeProseLengthV1(text: string, expectation: ProseLengthExpectationV1 | null, finishReason: string | null = null): ProseLengthObservationV1 {
  return lengthObservationForCount(countWords(text), expectation, finishReason)
}

function lengthObservationForCount(wordCount: number, expectation: ProseLengthExpectationV1 | null, finishReason: string | null): ProseLengthObservationV1 {
  const status = finishReason === 'length' ? 'truncated'
    : !expectation ? 'unspecified'
    : expectation.min != null && wordCount < expectation.min ? 'short'
    : expectation.max != null && wordCount > expectation.max ? 'long' : 'within'
  const requirement = expectation?.target != null ? `目标约 ${expectation.target} 字（提示范围 ${expectation.min}～${expectation.max}）`
    : expectation?.min != null && expectation.max != null ? `要求 ${expectation.min}～${expectation.max} 字`
    : expectation?.min != null ? `要求不少于 ${expectation.min} 字` : `要求不超过 ${expectation?.max} 字`
  const message = status === 'truncated' ? `模型因输出上限停止，当前 ${wordCount} 字，正文可能尚未完成。请保留当前稿，检查停笔位置后再决定续写或修改要求；没有自动重发。`
    : status === 'short' || status === 'long' ? `${requirement}，当前 ${wordCount} 字，${status === 'short' ? '篇幅不足' : '篇幅偏长'}。这是篇幅提示，不能据此判断文学质量；请检查场景任务，再决定采用或修改。` : null
  return { version: 1, wordCount, status, finishReason, expectation: expectation ? { ...expectation } : null, message }
}

export function parseProseLengthObservationV1(value: unknown): ProseLengthObservationV1 {
  const row = value as ProseLengthObservationV1
  const exact = (value: unknown, keys: string[]) => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === keys.sort().join('|')
  if (!exact(row, ['version', 'wordCount', 'status', 'finishReason', 'expectation', 'message'])
    || row.version !== 1 || !Number.isSafeInteger(row.wordCount) || row.wordCount < 0
    || !['unspecified', 'within', 'short', 'long', 'truncated'].includes(row.status)
    || (row.finishReason !== null && (typeof row.finishReason !== 'string' || row.finishReason.length > 100))
    || (row.message !== null && (typeof row.message !== 'string' || row.message.length > 2000))) throw new Error('正文篇幅记录无效。')
  if (row.expectation !== null) {
    const exp = row.expectation
    if (!exact(exp, ['version', 'source', 'min', 'max', 'target']) || exp.version !== 1 || !['author', 'parameter'].includes(exp.source)
      || [exp.min, exp.max, exp.target].some(number => number !== null && (!Number.isSafeInteger(number) || number <= 0 || number > 200_000))
      || (exp.min === null && exp.max === null)
      || (exp.min !== null && exp.max !== null && exp.min > exp.max)) throw new Error('正文篇幅要求无效。')
  }
  const expected = lengthObservationForCount(row.wordCount, row.expectation, row.finishReason)
  if (row.status !== expected.status || row.message !== expected.message) throw new Error('正文篇幅记录与计数不一致。')
  return expected
}
