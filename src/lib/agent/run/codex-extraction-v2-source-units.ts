import type { CodexFieldDef } from '../../types/codex'
import type { ExtractedCodexEntry } from '../../ai/adapters/structured-extract-adapter'
import type { WorkspaceScope } from '../../types'
import { canonicalStringify, hashCanonicalValue } from './hash'
import { sha256Text } from '../../ai/chapter-memory/text-normalization'

export const CODEX_PRODUCTION_POLICY_V1 = 'codex-production-source-units-and-drafts-v1' as const
export interface CodexProductionPolicyV1 {
  version: typeof CODEX_PRODUCTION_POLICY_V1
  sourceUnitEnds: number[]
}

/** Paragraphs are indivisible source units. Never invent a character boundary
 * inside an entity just because a request or output exhausted its capacity. */
export function codexSourceUnitEndsV1(source: string): number[] {
  const paragraphEnds: number[] = []
  let lineStart = 0
  // Tokenize line endings first: a CRLF is one newline, never a blank paragraph.
  for (const match of source.matchAll(/\r\n|[\n\r\u2028\u2029]/g)) {
    const end = match.index! + match[0].length
    if (match[0] === '\u2029' || lineStart > 0 && /^[\t ]*$/.test(source.slice(lineStart, match.index))) paragraphEnds.push(end)
    lineStart = end
  }
  if (paragraphEnds[paragraphEnds.length - 1] !== source.length) paragraphEnds.push(source.length)
  const ends: number[] = []
  let paragraphStart = 0
  for (const end of paragraphEnds) {
    const paragraph = source.slice(paragraphStart, end).trim()
    paragraphStart = end
    // A title alone must not consume the entity name while its facts are left
    // in another call. Keep recognized headings attached to the next paragraph.
    const heading = !/[\r\n\u2028\u2029]/.test(paragraph)
      && (/[：:]$/.test(paragraph) || /^【[^】]+】$/.test(paragraph) || /^#{1,6}\s+\S/.test(paragraph) || /^第[^\s]+[章节卷部篇回]/.test(paragraph))
    if (paragraph && (!heading || end === source.length)) ends.push(end)
  }
  if (ends[ends.length - 1] !== source.length) {
    if (ends.length && !source.slice(ends[ends.length - 1]).trim()) ends[ends.length - 1] = source.length
    else ends.push(source.length)
  }
  return ends
}
export function assertCodexProductionPolicyV1(policy: CodexProductionPolicyV1, source?: string): void {
  if (!policy || Object.keys(policy).sort().join('|') !== 'sourceUnitEnds|version'
    || policy.version !== CODEX_PRODUCTION_POLICY_V1 || !Array.isArray(policy.sourceUnitEnds)
    || !policy.sourceUnitEnds.length || policy.sourceUnitEnds.some((end, i) => !Number.isSafeInteger(end)
      || end <= (policy.sourceUnitEnds[i - 1] ?? 0))
    || source !== undefined && canonicalStringify(policy.sourceUnitEnds) !== canonicalStringify(codexSourceUnitEndsV1(source))) {
    throw new Error('冻结原文单元策略无效；保留原件，不改变旧运行策略。')
  }
}
export function splitCodexSourceUnitsV1(input: {
  sourceText: string; startChar: number; endChar: number; policy: CodexProductionPolicyV1
}): Array<{ startChar: number; endChar: number; text: string }> {
  assertCodexProductionPolicyV1(input.policy, input.sourceText)
  const { startChar, endChar, sourceText } = input
  const boundaries = [0, ...input.policy.sourceUnitEnds]
  if (!boundaries.includes(startChar) || !boundaries.includes(endChar) || endChar <= startChar) throw new Error('待处理范围不在冻结原文单元边界。')
  const candidates = boundaries.filter(end => end > startChar && end < endChar)
  if (!candidates.length) throw new Error('单个完整原文单元无法安全缩小；原答已保留，需要作者处理。')
  const middle = candidates.reduce((best, value) => Math.abs(value - (startChar + endChar) / 2)
    < Math.abs(best - (startChar + endChar) / 2) ? value : best)
  return [{ startChar, endChar: middle, text: sourceText.slice(startChar, middle) },
    { startChar: middle, endChar, text: sourceText.slice(middle, endChar) }]
}

/** Only verified fragments of this Root enter here. Baseline Canon is excluded;
 * text preserves all statements; conflicting closed single values are attention. */
export function consolidateCodexDraftsV1(fragments: readonly ExtractedCodexEntry[], baselineNames: readonly string[], fields: readonly CodexFieldDef[]): ExtractedCodexEntry[] {
  const existing = new Set(baselineNames.map(name => name.trim().toLocaleLowerCase()))
  const definitions = new Map(fields.map(field => [field.key, field]))
  const entries = new Map<string, ExtractedCodexEntry>()
  const union = (left: readonly string[], right: readonly string[]) => [...new Set([...left, ...right])]
  for (const input of fragments) {
    const key = input.name.trim().toLocaleLowerCase()
    if (existing.has(key)) throw new Error('原文候选与既有Canon重名；保留原答，不覆盖登记词条。')
    for (const field of Object.keys(input.fields)) {
      const definition = definitions.get(field)
      if (!definition || definition.type === 'ref') throw new Error(`草稿包含未登记或引用字段 ${field}。`)
    }
    const old = entries.get(key)
    if (!old) { entries.set(key, structuredClone(input)); continue }
    if (old.name !== input.name) throw new Error('同名草稿身份存在歧义；原答已保留，需要作者处理。')
    for (const [field, value] of Object.entries(input.fields)) {
      if (old.fields[field] !== undefined && old.fields[field] !== value) {
        const type = definitions.get(field)!.type
        if (type === 'number' || type === 'select') throw new Error(`同Root草稿字段 ${field} 存在不同值；原答已保留，需要作者处理。`)
        // Both source statements survive. This does not prove that natural
        // language conditions/contradictions have been semantically resolved.
        if (!old.fields[field].split('\n\n').includes(value)) old.fields[field] += '\n\n' + value
      } else old.fields[field] = value
    }
    // Keep each distinct supplied prose fragment, including scattered facts.
    if (old.summary !== input.summary && !old.summary.split('\n\n').includes(input.summary)) old.summary += '\n\n' + input.summary
    if (old.description !== input.description && !old.description.split('\n\n').includes(input.description)) old.description += '\n\n' + input.description
    const tagKeys = new Set(old.tags.map(tag => tag.toLocaleLowerCase()))
    for (const tag of input.tags) if (!tagKeys.has(tag.toLocaleLowerCase())) { old.tags.push(tag); tagKeys.add(tag.toLocaleLowerCase()) }
    old.evidenceQuotes = union(old.evidenceQuotes ?? [], input.evidenceQuotes ?? [])
    // Editorial display metadata, not replacement of any source facts.
    old.importance = Math.max(old.importance, input.importance)
  }
  return [...entries.values()]
}

/** Validate the exact progress capture bound to this physical request against
 * already verified same-Run predecessors. No baseline/cross-Run name borrowing.
 * read() must enforce same-Run committed artifact membership and exact bytes. */
export async function readSentCodexProgressNamesV1(input: {
  runId: number; rootHash: string; scope: WorkspaceScope; sourceText: string
  frame: { materialAllocationHash: string; wireFrameHash: string; request: { messagesHash: string } }
  previous: ReadonlyMap<string, readonly ExtractedCodexEntry[]>
  read: (kind: 'tool-result' | 'source-snapshot' | 'rendered-request', hash: string) => Promise<Record<string, unknown>>
}): Promise<string[]> {
  const material = await input.read('tool-result', input.frame.materialAllocationHash)
  if (await hashCanonicalValue(material) !== input.frame.materialAllocationHash || material.authorityHash !== input.rootHash
    || !Array.isArray(material.capturedSourceHashes)) throw new Error('当前请求的完整材料无法核验。')
  const progressHash: unknown = material.capturedSourceHashes[2]
  if (progressHash === undefined) return []
  if (typeof progressHash !== 'string') throw new Error('当前请求草稿来源引用无效。')
  const capture = await input.read('source-snapshot', progressHash)
  if (await hashCanonicalValue(capture) !== progressHash || capture.sourceKey !== 'codexExtractionProgressV2'
    || canonicalStringify(capture.scope) !== canonicalStringify(input.scope) || typeof capture.rawText !== 'string'
    || await sha256Text(capture.rawText) !== capture.rawBodyHash) throw new Error('当前请求草稿捕获不是原作品准确原件。')
  const progress = JSON.parse(capture.rawText) as Record<string, unknown>
  if (progress.runId !== input.runId || progress.rootHash !== input.rootHash || progress.authority !== 'draft-not-canon'
    || canonicalStringify(progress.scope) !== canonicalStringify(input.scope) || !Array.isArray(progress.results)
    || !Array.isArray(progress.names)) throw new Error('草稿不能跨Run或Root借名。')
  const names: string[] = [], seen = new Set<string>()
  for (const result of progress.results) {
    const hash = result && typeof result === 'object' ? (result as Record<string, unknown>).contentHash : null
    if (typeof hash !== 'string' || seen.has(hash) || !input.previous.has(hash)) throw new Error('草稿引用不是已经验证的同Root前序结果。')
    seen.add(hash)
    for (const entry of input.previous.get(hash)!) {
      if (!input.sourceText.includes(entry.name)) throw new Error('草稿名称不能追溯到准确原文。')
      names.push(entry.name)
    }
  }
  if (canonicalStringify(names) !== canonicalStringify(progress.names)) throw new Error('草稿名称与准确结果引用不一致。')
  const wire = await input.read('rendered-request', input.frame.wireFrameHash)
  if (await hashCanonicalValue(wire) !== input.frame.wireFrameHash || !Array.isArray(wire.messages)
    || await hashCanonicalValue(wire.messages) !== input.frame.request.messagesHash
    || !wire.messages.some(message => message && typeof message === 'object'
      && (message as Record<string, unknown>).content === '【本次实际发送的同Root已验证草稿，非Canon】\n' + capture.rawText)) throw new Error('该草稿未出现在本次实际发送的消息中。')
  return [...new Set(names)]
}
