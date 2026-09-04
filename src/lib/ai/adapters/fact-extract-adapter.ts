/**
 * NS-4 · AI 事实抽取适配器（章节正文 → TemporalFact 候选）。
 *
 * 不变量（设计权威 §14.2 / §22.8 NS-4）：
 * - 谓词必须映射到 FACT_PREDICATE_REGISTRY 的 key/alias，未登记谓词【丢弃】（不入权威账本）；
 * - subject/value 必须非空；引文 quote 必须【逐字】来自待审正文，否则丢弃（杜绝幻觉证据）；
 * - 产出一律 status:'candidate'（Evidence Observation），由作者确认后才升 confirmed（Canon）；
 * - factKind 以谓词注册表为准（event 只增不改）；不在此处做主体 FK 解析（留给 adopt 写回按 name 匹配）。
 */
import type { ChatMessage } from '../../types'
import type { TemporalFact } from '../../types/temporal-fact'
import {
  normalizeFactPredicate,
  normalizeFactValue,
  FACT_PREDICATE_REGISTRY,
} from '../../registry/fact-predicate-registry'

export interface ExtractedFactCandidate {
  subjectName: string
  predicate: string           // 已归一到受控 key
  factKind: TemporalFact['factKind']
  value: string
  /** 客体（关系/持有类谓词）名称，需在 adopt 时解析 FK */
  objectName?: string
  /** 逐字回查正文通过的证据引文 */
  sourceQuote: string
}

export function buildFactExtractPrompt(args: {
  chapterTitle: string
  chapterContent: string
  /** 注入受控谓词清单，引导模型只产已登记谓词 */
}): ChatMessage[] {
  const predicateList = FACT_PREDICATE_REGISTRY
    .map(p => `${p.key}(${p.label}${p.enums?.length ? `，值只能是 ${p.enums.join('|')}` : ''})`)
    .join('、')
  return [
    {
      role: 'system',
      content: `你是小说事实抽取器。从给定章节正文中，抽取关于角色的【可验证客观事实】，用于长篇一致性事实账本。

只允许使用下列受控谓词（不得自创）：${predicateList}

输出严格 JSON：
{"facts":[{"subject":"角色名","predicate":"受控谓词key","value":"事实值","object":"关系/持有的对象名(可选)","quote":"逐字正文引文"}]}

规则：
1. predicate 必须是上面列出的 key（或其常见说法），否则不要输出该条；
2. quote 必须逐字摘自正文（用于回查证据），不得改写、不得编造；
3. 只抽客观、可验证的事实（地点/存亡/伤势/修为/目标/持有/认知/关系），不抽主观评价或推测；
4. 拿不准、正文没有明确依据的，不要输出；宁缺毋滥；
5. 没有可抽取的事实就返回 {"facts":[]}。`,
    },
    {
      role: 'user',
      content: `【章节】${args.chapterTitle}\n\n【正文】\n${args.chapterContent}\n\n请输出 JSON：`,
    },
  ]
}

export function parseFactExtractResult(args: {
  raw: string
  chapterContent: string
}): ExtractedFactCandidate[] {
  const start = args.raw.indexOf('{')
  const end = args.raw.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed: { facts?: unknown }
  try {
    parsed = JSON.parse(args.raw.slice(start, end + 1)) as { facts?: unknown }
  } catch {
    return []
  }
  if (!Array.isArray(parsed.facts)) return []

  return parsed.facts.flatMap((raw): ExtractedFactCandidate[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const item = raw as Record<string, unknown>
    const subjectName = String(item.subject ?? '').trim()
    const quote = String(item.quote ?? '').trim()
    // 谓词必须过受控注册表，未登记直接丢（不入权威账本）
    const spec = normalizeFactPredicate(String(item.predicate ?? ''))
    const value = spec ? normalizeFactValue(spec, item.value) : null
    if (!spec || !subjectName || !value) return []
    // 引文必须逐字回查正文，否则丢（杜绝幻觉证据）
    if (!quote || !args.chapterContent.includes(quote)) return []
    const objectName = String(item.object ?? '').trim() || undefined
    return [{
      subjectName,
      predicate: spec.key,            // 归一后的规范 key
      factKind: spec.factKind,        // 以注册表为准
      value,
      objectName,
      sourceQuote: quote,
    }]
  })
}

/**
 * Parse the editable, current-schema fact candidate emitted by the generation
 * node. This is intentionally separate from the provider wire parser above:
 * provider JSON uses `subject`/`quote`, while persisted candidate JSON has one
 * canonical shape (`subjectName`/`sourceQuote`) and never accepts aliases.
 */
export function parseCanonicalFactCandidateDraftV1(args: {
  raw: string
  chapterContent: string
}): ExtractedFactCandidate[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(args.raw)
  } catch {
    throw new Error('事实候选必须是合法 JSON。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('事实候选根必须是对象。')
  }
  const root = parsed as Record<string, unknown>
  if (Object.keys(root).length !== 1 || !Array.isArray(root.facts)) {
    throw new Error('事实候选只能包含 facts 数组。')
  }
  return root.facts.map((raw, index): ExtractedFactCandidate => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`事实候选 facts[${index}] 必须是对象。`)
    }
    const item = raw as Record<string, unknown>
    const allowed = new Set(['subjectName', 'predicate', 'factKind', 'value', 'objectName', 'sourceQuote'])
    const unknown = Object.keys(item).filter(key => !allowed.has(key))
    if (unknown.length) throw new Error(`事实候选 facts[${index}] 含非当前字段：${unknown.join('、')}。`)

    const subjectName = typeof item.subjectName === 'string' ? item.subjectName.trim() : ''
    const predicate = typeof item.predicate === 'string' ? item.predicate.trim() : ''
    const sourceQuote = typeof item.sourceQuote === 'string' ? item.sourceQuote.trim() : ''
    const spec = FACT_PREDICATE_REGISTRY.find(entry => entry.key === predicate)
    const value = spec ? normalizeFactValue(spec, item.value) : null
    if (!spec || !subjectName || !value || item.factKind !== spec.factKind) {
      throw new Error(`事实候选 facts[${index}] 的主体、谓词、类型或值无效。`)
    }
    if (!sourceQuote || !args.chapterContent.includes(sourceQuote)) {
      throw new Error(`事实候选 facts[${index}] 的逐字证据不在当前正文中。`)
    }
    const objectName = typeof item.objectName === 'string' && item.objectName.trim()
      ? item.objectName.trim()
      : undefined
    return {
      subjectName,
      predicate: spec.key,
      factKind: spec.factKind,
      value,
      objectName,
      sourceQuote,
    }
  })
}
