import type { ChatMessage } from '../types'
import { jsonrepair } from 'jsonrepair'

export type StructuredOutputStatusV1 =
  | 'ready'
  | 'usable-with-warnings'
  | 'manual-repair'
  | 'blocked'

export type StructuredOutputIssueCategoryV1 =
  | 'parse'
  | 'schema'
  | 'target'
  | 'permission'
  | 'scope'
  | 'stale'
  | 'length'

export const STRUCTURED_OUTPUT_NORMALIZATION_STEPS_V1 = [
  'remove-bom',
  'trim-outer-whitespace',
  'remove-single-json-fence',
  'extract-first-balanced-json',
  'escape-unescaped-json-quotes',
  'insert-missing-array-commas',
  'merge-single-allowed-object-tail',
  'unescape-allowed-root-field',
] as const

export type StructuredOutputNormalizationStepV1 =
  typeof STRUCTURED_OUTPUT_NORMALIZATION_STEPS_V1[number]

export interface StructuredOutputIssueV1 {
  version: 1
  code: string
  category: StructuredOutputIssueCategoryV1
  path: string
  message: string
  repairable: boolean
  fingerprint: string
}

export interface StructuredOutputContractV1 {
  version: 1
  schemaId: string
  target: string
  root: 'object' | 'array'
  maxChars: number
  allowedRootFields?: readonly string[]
  requiredRootFields?: readonly string[]
  unknownRootFieldMessage?: string
  missingRootFieldMessage?: string
}

export interface StructuredOutputAttemptEvidenceV1 {
  version: 1
  schemaId: string
  target: string
  /** Minimal, contract-derived shape needed by the single repair call. */
  contractShape: StructuredOutputContractShapeV1
  status: StructuredOutputStatusV1
  originalText: string
  normalizedText: string
  normalizationSteps: StructuredOutputNormalizationStepV1[]
  issues: StructuredOutputIssueV1[]
}

export interface StructuredOutputContractShapeV1 {
  root: StructuredOutputContractV1['root']
  allowedRootFields: string[] | null
  requiredRootFields: string[]
}

export interface StructuredOutputEvaluationV1<T> {
  output: T
  evidence: StructuredOutputAttemptEvidenceV1
}

export interface StructuredOutputRunEvidenceV1 {
  version: 1
  schemaId: string
  target: string
  status: StructuredOutputStatusV1
  attempts: Array<{
    callIndex: 1 | 2
    purpose: 'generate' | 'repair'
    evidence: StructuredOutputAttemptEvidenceV1
  }>
  repair: null | {
    callIndex: 2
    sourceFingerprint: string
    result: 'repaired' | 'failed'
  }
}

export class StructuredOutputRepairFailedErrorV1 extends Error {
  readonly runEvidence: StructuredOutputRunEvidenceV1

  constructor(runEvidence: StructuredOutputRunEvidenceV1) {
    super('唯一一次结构化输出修复仍未通过；已停止自动调用并保留原始证据。')
    this.name = 'StructuredOutputRepairFailedErrorV1'
    this.runEvidence = runEvidence
  }
}

/**
 * Converts a thrown structured-output failure into the same exact, portable
 * evidence contract used by successful generation runs. Durable callers can
 * persist this before the in-memory Error object disappears on reload.
 */
export function structuredOutputFailureEvidenceV1(
  error: unknown,
): StructuredOutputRunEvidenceV1 | null {
  if (error instanceof StructuredOutputRepairFailedErrorV1) return error.runEvidence
  if (!(error instanceof StructuredOutputPipelineErrorV1)) return null
  return {
    version: 1,
    schemaId: error.evidence.schemaId,
    target: error.evidence.target,
    status: error.evidence.status,
    attempts: [{ callIndex: 1, purpose: 'generate', evidence: error.evidence }],
    repair: null,
  }
}

const evidenceByOutput = new WeakMap<object, StructuredOutputAttemptEvidenceV1>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function shortFingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function issue(input: Omit<StructuredOutputIssueV1, 'version' | 'fingerprint'>): StructuredOutputIssueV1 {
  return {
    version: 1,
    ...input,
    fingerprint: shortFingerprint([
      input.code,
      input.category,
      input.path,
      input.message,
    ].join('\n')),
  }
}

function evidence(input: Omit<StructuredOutputAttemptEvidenceV1, 'version'>): StructuredOutputAttemptEvidenceV1 {
  return { version: 1, ...input }
}

function contractShape(contract: StructuredOutputContractV1): StructuredOutputContractShapeV1 {
  return {
    root: contract.root,
    allowedRootFields: contract.allowedRootFields ? [...contract.allowedRootFields] : null,
    requiredRootFields: [...(contract.requiredRootFields ?? [])],
  }
}

export class StructuredOutputPipelineErrorV1 extends Error {
  readonly evidence: StructuredOutputAttemptEvidenceV1

  constructor(evidenceValue: StructuredOutputAttemptEvidenceV1) {
    super(evidenceValue.issues.map(item => item.message).join('；') || '结构化输出无效。')
    this.name = 'StructuredOutputPipelineErrorV1'
    this.evidence = evidenceValue
  }

  get retryable(): boolean {
    return this.evidence.status === 'manual-repair'
      && this.evidence.issues.some(item => item.repairable)
      && this.evidence.issues.every(item => (
        item.category !== 'permission'
        && item.category !== 'scope'
        && item.category !== 'stale'
        && item.category !== 'length'
      ))
  }
}

function rootMatches(value: unknown, root: StructuredOutputContractV1['root']): boolean {
  return root === 'array'
    ? Array.isArray(value)
    : !!value && typeof value === 'object' && !Array.isArray(value)
}

function firstRootIndex(text: string, root: StructuredOutputContractV1['root']): number {
  return text.indexOf(root === 'array' ? '[' : '{')
}

/**
 * Returns only the first syntactically balanced root. The caller separately
 * rejects another JSON root in the remainder, so this helper never chooses
 * between competing model answers.
 */
function firstBalancedJson(text: string, root: StructuredOutputContractV1['root']): string | null {
  const start = firstRootIndex(text, root)
  if (start < 0) return null
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') stack.push(char)
    else if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '['
      if (stack.pop() !== expected) return null
      if (stack.length === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

/**
 * Prove that an insertion point is between two adjacent JSON string values in
 * an array. Object members are deliberately excluded: inferring a missing
 * object delimiter can change the model's intended field structure.
 */
function isAdjacentArrayStringBoundary(original: string, index: number): boolean {
  if (index < 1 || original[index - 1] !== '"' || original[index] !== '"') return false
  const stack: Array<'object' | 'array'> = []
  let inString = false
  let escaped = false
  for (let cursor = 0; cursor < index; cursor += 1) {
    const char = original[cursor]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') stack.push('object')
    else if (char === '[') stack.push('array')
    else if (char === '}' || char === ']') stack.pop()
  }
  return !inString && stack[stack.length - 1] === 'array'
}

/**
 * Accept only the narrow, lossless subset of jsonrepair that inserts escape
 * characters before existing quotes or commas between adjacent array string
 * values. It still rejects truncation repair, object-member delimiter repair,
 * removed punctuation, rewritten keys, and every content-changing rewrite.
 */
function safeJsonRepairSteps(
  original: string,
  repaired: string,
): StructuredOutputNormalizationStepV1[] | null {
  let originalIndex = 0
  let repairedIndex = 0
  let insertedEscapes = 0
  let insertedArrayCommas = 0
  while (originalIndex < original.length && repairedIndex < repaired.length) {
    if (original[originalIndex] === repaired[repairedIndex]) {
      originalIndex += 1
      repairedIndex += 1
      continue
    }
    if (
      repaired[repairedIndex] === '\\'
      && repaired[repairedIndex + 1] === '"'
      && original[originalIndex] === '"'
    ) {
      insertedEscapes += 1
      repairedIndex += 1
      continue
    }
    if (
      repaired[repairedIndex] === ','
      && isAdjacentArrayStringBoundary(original, originalIndex)
    ) {
      insertedArrayCommas += 1
      repairedIndex += 1
      continue
    }
    return null
  }
  if (originalIndex !== original.length || repairedIndex !== repaired.length) return null
  const steps: StructuredOutputNormalizationStepV1[] = []
  if (insertedEscapes) steps.push('escape-unescaped-json-quotes')
  if (insertedArrayCommas) steps.push('insert-missing-array-commas')
  return steps.length ? steps : null
}

function repairSafeJsonSyntax(text: string): {
  text: string
  steps: StructuredOutputNormalizationStepV1[]
} | null {
  try {
    const repaired = jsonrepair(text)
    const repairSteps = safeJsonRepairSteps(text, repaired)
    return repairSteps ? { text: repaired, steps: repairSteps } : null
  } catch {
    return null
  }
}

/**
 * Fallback for providers that emit many prose quotation marks and make
 * jsonrepair lose track of the surrounding string. A quote is escaped only
 * when it is already inside a JSON string and the following non-space token
 * cannot legally close a JSON string value/key. Adjacent quotes remain
 * ambiguous and are rejected so missing array commas are handled only by the
 * narrower insertion proof above.
 */
function escapeObviouslyInternalJsonQuotes(text: string): string | null {
  let output = ''
  let inString = false
  let escaped = false
  let changed = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      output += char
      escaped = false
      continue
    }
    if (char === '\\') {
      output += char
      if (inString) escaped = true
      continue
    }
    if (char !== '"') {
      output += char
      continue
    }
    if (!inString) {
      output += char
      inString = true
      continue
    }
    let lookahead = index + 1
    while (/\s/.test(text[lookahead] ?? '')) lookahead += 1
    const next = text[lookahead] ?? ''
    if (next === '"') return null
    if (next && ![':', ',', '}', ']'].includes(next)) {
      output += '\\"'
      changed = true
      continue
    }
    output += char
    inString = false
  }
  if (!changed || inString || escaped) return null
  try {
    JSON.parse(output)
    return output
  } catch {
    return null
  }
}

/**
 * Repair exactly one premature root-object closure when the remaining text is
 * one new field explicitly allowed by the contract. This covers
 * `{...},"allowed":value}` without accepting duplicate/unknown fields,
 * multiple tails, competing roots, or truncated values.
 */
function mergeSingleAllowedObjectTail(
  text: string,
  contract: StructuredOutputContractV1,
): string | null {
  if (contract.root !== 'object' || !contract.allowedRootFields) return null
  const balanced = firstBalancedJson(text, 'object')
  if (!balanced || !text.startsWith(balanced)) return null
  const remainder = text.slice(balanced.length)
  const tail = /^\s*,\s*"([^"\\]+)"\s*:([\s\S]+)\}\s*$/.exec(remainder)
  if (!tail) return null
  const tailField = tail[1]
  if (!contract.allowedRootFields.includes(tailField)) return null
  try {
    const head = JSON.parse(balanced) as Record<string, unknown>
    if (!isRecord(head) || Object.prototype.hasOwnProperty.call(head, tailField)) return null
    const merged = `${balanced.slice(0, -1)}${remainder}`
    const parsed = JSON.parse(merged)
    if (!isRecord(parsed)) return null
    const added = Object.keys(parsed).filter(key => !Object.prototype.hasOwnProperty.call(head, key))
    if (added.length !== 1 || added[0] !== tailField) return null
    if (Object.keys(parsed).some(key => !contract.allowedRootFields!.includes(key))) return null
    return merged
  } catch {
    return null
  }
}

/**
 * Some OpenAI-compatible models over-escape a root field name as
 * `\"allowedField\"`. Unescape only when the scanner is at the root object,
 * the previous structural token is `{` or `,`, and the field is registered.
 */
function unescapeAllowedRootFields(
  text: string,
  contract: StructuredOutputContractV1,
): string | null {
  if (contract.root !== 'object' || !contract.allowedRootFields) return null
  const stack: Array<'object' | 'array'> = []
  let inString = false
  let escaped = false
  let changed = false
  let output = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '\\' && text[index + 1] === '"'
      && stack.length === 1 && stack[0] === 'object') {
      const match = /^\\"([^"\\]+)\\"\s*:/.exec(text.slice(index))
      const field = match?.[1]
      const previous = output.trimEnd().slice(-1)
      if (match && field && (previous === '{' || previous === ',')
        && contract.allowedRootFields.includes(field)
        && !text.slice(0, index).includes(`"${field}"`)) {
        output += `"${field}":`
        index += match[0].length - 1
        changed = true
        continue
      }
    }
    output += char
    if (char === '"') inString = true
    else if (char === '{') stack.push('object')
    else if (char === '[') stack.push('array')
    else if (char === '}' || char === ']') stack.pop()
  }
  return changed ? output : null
}

function fail(input: {
  contract: StructuredOutputContractV1
  originalText: string
  normalizedText: string
  steps: StructuredOutputNormalizationStepV1[]
  status?: StructuredOutputStatusV1
  issue: Omit<StructuredOutputIssueV1, 'version' | 'fingerprint'>
}): never {
  throw new StructuredOutputPipelineErrorV1(evidence({
    schemaId: input.contract.schemaId,
    target: input.contract.target,
    contractShape: contractShape(input.contract),
    status: input.status ?? 'manual-repair',
    originalText: input.originalText,
    normalizedText: input.normalizedText,
    normalizationSteps: input.steps,
    issues: [issue(input.issue)],
  }))
}

function schemaIssue(error: unknown): Omit<StructuredOutputIssueV1, 'version' | 'fingerprint'> {
  const message = error instanceof Error && error.message.trim()
    ? error.message
    : '输出没有通过严格 schema。'
  const category: StructuredOutputIssueCategoryV1 = /scope|作用域|权限/.test(message)
    ? /权限/.test(message) ? 'permission' : 'scope'
    : /stale|发生变化|过期/.test(message)
      ? 'stale'
      : 'schema'
  const code = /缺少|不能为空/.test(message)
    ? 'structured-output-missing-field'
    : /不允许|未声明|只能包含|额外字段/.test(message)
      ? 'structured-output-unknown-field'
      : /不在允许范围|只能是|枚举/.test(message)
        ? 'structured-output-invalid-enum'
        : /必须/.test(message)
          ? 'structured-output-invalid-type'
          : 'structured-output-schema-invalid'
  const field = /(?:字段|包含未声明字段|缺少字段|缺少)\s*[：:]?\s*([A-Za-z][A-Za-z0-9_.[\]-]*)/.exec(message)?.[1]
  return {
    code,
    category,
    path: field ? `$.${field}` : '$',
    message,
    repairable: category === 'schema',
  }
}

export function evaluateStructuredOutputV1<T>(input: {
  raw: string
  contract: StructuredOutputContractV1
  parse: (value: unknown) => T
}): StructuredOutputEvaluationV1<T> {
  const { contract } = input
  const originalText = input.raw
  let normalizedText = originalText
  const steps: StructuredOutputNormalizationStepV1[] = []

  if (normalizedText.startsWith('\uFEFF')) {
    normalizedText = normalizedText.slice(1)
    steps.push('remove-bom')
  }
  const trimmed = normalizedText.trim()
  if (trimmed !== normalizedText) {
    normalizedText = trimmed
    steps.push('trim-outer-whitespace')
  }
  if (!normalizedText) {
    fail({
      contract, originalText, normalizedText, steps,
      issue: {
        code: 'structured-output-empty', category: 'parse', path: '$',
        message: '模型没有返回结构化内容。', repairable: true,
      },
    })
  }
  if (originalText.length > contract.maxChars) {
    fail({
      contract, originalText, normalizedText, steps, status: 'blocked',
      issue: {
        code: 'structured-output-too-large', category: 'length', path: '$',
        message: `结构化输出超过 ${contract.maxChars} 字符，已阻止自动处理。`, repairable: false,
      },
    })
  }

  const fence = normalizedText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fence) {
    normalizedText = fence[1].trim()
    steps.push('remove-single-json-fence')
  }

  const unescapedRootFields = unescapeAllowedRootFields(normalizedText, contract)
  if (unescapedRootFields) {
    normalizedText = unescapedRootFields
    steps.push('unescape-allowed-root-field')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(normalizedText)
  } catch {
    const mergedTail = mergeSingleAllowedObjectTail(normalizedText, contract)
    if (mergedTail) {
      parsed = JSON.parse(mergedTail)
      normalizedText = mergedTail
      steps.push('merge-single-allowed-object-tail')
    }
    const balanced = parsed === undefined ? firstBalancedJson(normalizedText, contract.root) : null
    if (balanced && balanced !== normalizedText) {
      const balancedStart = normalizedText.indexOf(balanced)
      const remainder = `${normalizedText.slice(0, balancedStart)}${normalizedText.slice(balancedStart + balanced.length)}`
      if (/[{[]/.test(remainder) || /^\s*,\s*"[^"\\]+"\s*:/.test(remainder)) {
        fail({
          contract, originalText, normalizedText, steps,
          issue: {
            code: 'structured-output-ambiguous-root', category: 'parse', path: '$',
            message: '模型响应包含多个可能的 JSON 根，无法安全选择。', repairable: true,
          },
        })
      }
      try {
        parsed = JSON.parse(balanced)
        normalizedText = balanced
        steps.push('extract-first-balanced-json')
      } catch {
        parsed = undefined
      }
    }
    if (parsed === undefined) {
      const safeRepair = repairSafeJsonSyntax(normalizedText)
      if (safeRepair) {
        try {
          parsed = JSON.parse(safeRepair.text)
          normalizedText = safeRepair.text
          steps.push(...safeRepair.steps)
        } catch {
          parsed = undefined
        }
      }
      if (parsed === undefined) {
        const quoteFallback = escapeObviouslyInternalJsonQuotes(normalizedText)
        if (quoteFallback) {
          parsed = JSON.parse(quoteFallback)
          normalizedText = quoteFallback
          steps.push('escape-unescaped-json-quotes')
        }
      }
      if (parsed === undefined) {
        fail({
          contract, originalText, normalizedText, steps,
          issue: {
            code: 'structured-output-invalid-json', category: 'parse', path: '$',
            message: '模型响应不是有效且完整的 JSON。', repairable: true,
          },
        })
      }
    }
  }

  if (!rootMatches(parsed, contract.root)) {
    fail({
      contract, originalText, normalizedText, steps,
      issue: {
        code: 'structured-output-root-mismatch', category: 'schema', path: '$',
        message: `结构化输出根必须是 JSON ${contract.root === 'array' ? '数组' : '对象'}。`,
        repairable: true,
      },
    })
  }

  if (contract.root === 'object' && parsed) {
    const source = parsed as Record<string, unknown>
    const allowed = contract.allowedRootFields
    const required = contract.requiredRootFields ?? []
    const unknownField = allowed ? Object.keys(source).find(key => !allowed.includes(key)) : undefined
    if (unknownField) {
      fail({
        contract, originalText, normalizedText, steps,
        issue: {
          code: 'structured-output-unknown-field', category: 'schema', path: `$.${unknownField}`,
          message: contract.unknownRootFieldMessage
            ?? `结构化输出包含未声明字段 ${unknownField}。`,
          repairable: true,
        },
      })
    }
    const missingField = required.find(key => !Object.prototype.hasOwnProperty.call(source, key))
    if (missingField) {
      fail({
        contract, originalText, normalizedText, steps,
        issue: {
          code: 'structured-output-missing-field', category: 'schema', path: `$.${missingField}`,
          message: contract.missingRootFieldMessage
            ?? `结构化输出缺少字段 ${missingField}。`,
          repairable: true,
        },
      })
    }
  }

  let output: T
  try {
    output = input.parse(parsed)
  } catch (error) {
    if (error instanceof StructuredOutputPipelineErrorV1) throw error
    fail({
      contract, originalText, normalizedText, steps,
      issue: schemaIssue(error),
    })
  }
  const attemptEvidence = evidence({
    schemaId: contract.schemaId,
    target: contract.target,
    contractShape: contractShape(contract),
    status: steps.some(step => step !== 'trim-outer-whitespace')
      ? 'usable-with-warnings'
      : 'ready',
    originalText,
    normalizedText,
    normalizationSteps: steps,
    issues: [],
  })
  if (output && typeof output === 'object') evidenceByOutput.set(output as object, attemptEvidence)
  return { output, evidence: attemptEvidence }
}

export function parseStructuredOutputV1<T>(input: {
  raw: string
  contract: StructuredOutputContractV1
  parse: (value: unknown) => T
}): T {
  return evaluateStructuredOutputV1(input).output
}

export function readStructuredOutputEvidenceV1(value: unknown): StructuredOutputAttemptEvidenceV1 | null {
  return value && typeof value === 'object'
    ? evidenceByOutput.get(value as object) ?? null
    : null
}

export function buildStructuredOutputRepairMessagesV1(input: {
  evidence: StructuredOutputAttemptEvidenceV1
  extraIssues?: Array<{ code: string; message: string; path?: string }>
}): ChatMessage[] {
  const issues = [
    ...input.evidence.issues.map(item => ({ code: item.code, path: item.path, message: item.message })),
    ...(input.extraIssues ?? []).map(item => ({
      code: item.code,
      path: item.path ?? '$',
      message: item.message,
    })),
  ]
  const shape = input.evidence.contractShape
  const shapeRules = [
    `JSON 根类型必须是 ${shape.root === 'object' ? 'object' : 'array'}。`,
    ...(shape.root === 'object' && shape.allowedRootFields
      ? [`根对象只允许直接包含这些字段：${shape.allowedRootFields.join('、')}。不得增加外层包装字段。`]
      : []),
    ...(shape.root === 'object' && shape.requiredRootFields.length
      ? [`根对象必须包含这些字段：${shape.requiredRootFields.join('、')}。`]
      : []),
  ]
  return [{
    role: 'system',
    content: [
      '你是严格结构修复器。只修复列出的结构、字段和目标错误，不重新创作。',
      '保留上一次输出中的合法内容、事实、名称与顺序；不得添加未要求的新内容。',
      `输出必须符合 schema=${input.evidence.schemaId}，target=${input.evidence.target}。`,
      ...shapeRules,
      '只输出一个完整 JSON 根，不要解释，不要 Markdown。',
    ].join('\n'),
  }, {
    role: 'user',
    content: [
      '【只允许修复的问题】',
      JSON.stringify(issues),
      '【上一次原始输出】',
      input.evidence.originalText,
    ].join('\n'),
  }]
}

export function classifyStructuredGateIssueV1(input: {
  code: string
  message: string
}): StructuredOutputIssueV1 {
  const source = `${input.code} ${input.message}`.toLowerCase()
  const category: StructuredOutputIssueCategoryV1 = /permission|权限/.test(source)
    ? 'permission'
    : /scope|作用域|跨世界|跨作品/.test(source)
      ? 'scope'
      : /stale|过期|发生变化/.test(source)
        ? 'stale'
        : 'target'
  return issue({
    code: input.code,
    category,
    path: '$',
    message: input.message,
    repairable: category === 'target',
  })
}

export function parseStructuredOutputRunEvidenceV1(value: unknown): StructuredOutputRunEvidenceV1 {
  if (!isRecord(value) || value.version !== 1) throw new Error('结构化输出运行证据版本无效。')
  if (typeof value.schemaId !== 'string' || !value.schemaId.trim()) throw new Error('结构化输出运行证据缺少 schemaId。')
  if (typeof value.target !== 'string' || !value.target.trim()) throw new Error('结构化输出运行证据缺少 target。')
  if (!['ready', 'usable-with-warnings', 'manual-repair', 'blocked'].includes(value.status as string)) {
    throw new Error('结构化输出运行证据 status 无效。')
  }
  if (!Array.isArray(value.attempts) || value.attempts.length < 1 || value.attempts.length > 2) {
    throw new Error('结构化输出运行证据 attempts 必须为 1-2 项。')
  }
  const attempts = value.attempts.map((attemptValue, index) => {
    if (!isRecord(attemptValue) || !isRecord(attemptValue.evidence)) {
      throw new Error(`结构化输出运行证据 attempts[${index}] 无效。`)
    }
    const attempt = attemptValue.evidence
    const callIndex = attemptValue.callIndex
    const purpose = attemptValue.purpose
    if (callIndex !== index + 1 || (purpose !== 'generate' && purpose !== 'repair')) {
      throw new Error(`结构化输出运行证据 attempts[${index}] 身份无效。`)
    }
    if (
      attempt.version !== 1
      || attempt.schemaId !== value.schemaId
      || attempt.target !== value.target
      || !['ready', 'usable-with-warnings', 'manual-repair', 'blocked'].includes(attempt.status as string)
      || typeof attempt.originalText !== 'string'
      || attempt.originalText.length > 240_000
      || typeof attempt.normalizedText !== 'string'
      || attempt.normalizedText.length > 240_000
      || !Array.isArray(attempt.normalizationSteps)
      || !Array.isArray(attempt.issues)
    ) throw new Error(`结构化输出运行证据 attempts[${index}].evidence 无效。`)
    const shape = attempt.contractShape
    const allowedRootFields = isRecord(shape) ? shape.allowedRootFields : undefined
    const requiredRootFields = isRecord(shape) ? shape.requiredRootFields : undefined
    if (
      !isRecord(shape)
      || (shape.root !== 'object' && shape.root !== 'array')
      || !(allowedRootFields === null || Array.isArray(allowedRootFields))
      || (Array.isArray(allowedRootFields) && allowedRootFields.some(field => (
        typeof field !== 'string' || !field
      )))
      || !Array.isArray(requiredRootFields)
      || requiredRootFields.some(field => typeof field !== 'string' || !field)
      || (Array.isArray(allowedRootFields) && requiredRootFields.some(field => (
        !allowedRootFields.includes(field)
      )))
    ) throw new Error(`结构化输出运行证据 attempts[${index}].contractShape 无效。`)
    if (attempt.normalizationSteps.some(step => (
      !STRUCTURED_OUTPUT_NORMALIZATION_STEPS_V1.includes(step as StructuredOutputNormalizationStepV1)
    ))) {
      throw new Error(`结构化输出运行证据 attempts[${index}] 包含未知 normalize 步骤。`)
    }
    const allowedCategories: StructuredOutputIssueCategoryV1[] = [
      'parse', 'schema', 'target', 'permission', 'scope', 'stale', 'length',
    ]
    for (const [issueIndex, rawIssue] of attempt.issues.entries()) {
      if (
        !isRecord(rawIssue)
        || rawIssue.version !== 1
        || typeof rawIssue.code !== 'string'
        || !rawIssue.code
        || !allowedCategories.includes(rawIssue.category as StructuredOutputIssueCategoryV1)
        || typeof rawIssue.path !== 'string'
        || !rawIssue.path
        || typeof rawIssue.message !== 'string'
        || !rawIssue.message
        || typeof rawIssue.repairable !== 'boolean'
        || typeof rawIssue.fingerprint !== 'string'
        || rawIssue.fingerprint !== shortFingerprint([
          rawIssue.code,
          rawIssue.category,
          rawIssue.path,
          rawIssue.message,
        ].join('\n'))
      ) throw new Error(`结构化输出运行证据 attempts[${index}].issues[${issueIndex}] 无效。`)
    }
    const successful = attempt.status === 'ready' || attempt.status === 'usable-with-warnings'
    if (successful !== (attempt.issues.length === 0)) {
      throw new Error(`结构化输出运行证据 attempts[${index}] status 与 issues 矛盾。`)
    }
    return {
      callIndex: callIndex as 1 | 2,
      purpose: purpose as 'generate' | 'repair',
      evidence: attempt as unknown as StructuredOutputAttemptEvidenceV1,
    }
  })
  if (attempts[0].purpose !== 'generate' || (attempts[1] && attempts[1].purpose !== 'repair')) {
    throw new Error('结构化输出运行证据调用顺序无效。')
  }
  if (value.status !== attempts[attempts.length - 1].evidence.status) {
    throw new Error('结构化输出运行证据最终 status 与末次尝试不一致。')
  }
  if (value.repair !== null) {
    if (
      !isRecord(value.repair)
      || value.repair.callIndex !== 2
      || typeof value.repair.sourceFingerprint !== 'string'
      || !['repaired', 'failed'].includes(value.repair.result as string)
      || attempts.length !== 2
    ) throw new Error('结构化输出运行证据 repair 无效。')
    const expectedFingerprint = attempts[0].evidence.issues[0]?.fingerprint
      ?? (attempts[0].evidence.normalizationSteps.join(':') || 'structured-output')
    const finalSucceeded = attempts[1].evidence.issues.length === 0
    if (
      value.repair.sourceFingerprint !== expectedFingerprint
      || (value.repair.result === 'repaired') !== finalSucceeded
    ) throw new Error('结构化输出运行证据 repair 结果与尝试证据不一致。')
  } else if (attempts.length !== 1) {
    throw new Error('结构化输出运行证据缺少 repair 身份。')
  }
  return {
    version: 1,
    schemaId: value.schemaId,
    target: value.target,
    status: value.status as StructuredOutputStatusV1,
    attempts,
    repair: value.repair as StructuredOutputRunEvidenceV1['repair'],
  }
}
