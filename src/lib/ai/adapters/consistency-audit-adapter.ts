import type { ChatMessage } from '../../types'
import { formatQualityReviewAnchorsV1, qualityReviewAnchorsV1 } from '../../prose/quality-review'

export type ConsistencyAuditMode = 'fast' | 'deep'
export type ConsistencySeverity = 'hard' | 'risk' | 'unknown'

export const CONSISTENCY_AUDIT_PROMPT_VERSION_V1 = 'consistency-evidence-audit-v5'
// Freeze the shared catalog's numbering rules for this audit protocol.
const AUDIT_ANCHOR_VERSION = 'whole-chapter-quality-review-v10'

export interface ConsistencyCitationPositionV1 {
  sourceKey: 'currentChapter' | 'canonAssertions' | 'itemLedger'
  versionHash: string
  start: number
  end: number
}

export interface ConsistencyAuditCitationSourceV1 extends ConsistencyCitationPositionV1 {
  sourceType: 'canon' | 'observation'
  sourceId: number
  text: string
}

export interface ConsistencyFinding {
  category: string
  severity: ConsistencySeverity
  quote: string
  anchorId?: string
  /** The selected ID resolved, but redundant model text differed; never a hard finding. */
  citationWarning?: boolean
  evidence: Array<{
    sourceType: 'canon' | 'observation' | 'chapter' | 'summary'
    sourceId: number
    quote: string
    anchorId?: string
    position?: ConsistencyCitationPositionV1
  }>
  reason: string
  suggestion?: string
}

export interface ConsistencyAuditResult {
  mode: ConsistencyAuditMode
  findings: ConsistencyFinding[]
}

function evidenceHeading(chapterTitle: string): string {
  return `【章节】${chapterTitle}\n\n【只读资料：规则与已确认条件用于核对，章纲/细纲是计划】\n`
}

export function consistencyAuditEvidenceOffsetV1(chapterTitle: string): number {
  return evidenceHeading(chapterTitle).length
}

export function buildConsistencyAuditPrompt(args: {
  mode: ConsistencyAuditMode
  chapterTitle: string
  chapterContent: string
  evidenceContext: string
  citationSources?: readonly ConsistencyAuditCitationSourceV1[]
  cognitionCatalog?: string
  lifecycleCatalog?: string
}): ChatMessage[] {
  const focus = args.mode === 'fast'
    ? '检查正文内部及其与已确认资料之间的直接矛盾：资源收支、明确时限、实际动作与结算、人物知情来源、证据能否支持结论，以及地点/世界归属、存亡、力量阶段和直接规则冲突。目标是低误报；证据不足就不要报 hard。'
    : '检查因果链、角色动机与长期弧光、伏笔遗漏或错误回收、故事线推进、复杂时间关系、社会规范、世界规则和叙事软风险。'
  const allowedCitations = ['canon', 'observation'].map(type => {
    const ids = args.citationSources?.filter(source => source.sourceType === type).map(source => source.sourceId)
    return ids?.length ? `${type}：${ids.join(',')}` : ''
  }).filter(Boolean).join('；')
  return [
    {
      role: 'system',
      content: `你是小说一致性证据审计器。契约：${CONSISTENCY_AUDIT_PROMPT_VERSION_V1}。${focus}

输出严格 JSON：
{"findings":[{"category":"分类","severity":"hard|risk|unknown","anchorId":"逐字复制正文目录编号","evidence":[{"sourceType":"chapter|observation|canon","sourceId":0,"quote":"证据上下文逐字引文"}],"reason":"为何冲突或有风险","suggestion":"可选建议"}],"cognitionReferences":[{"characterId":1,"knowledgeKey":"闭集中的key","quote":"该角色运用或陈述该知识的正文逐字引文"}],"lifecycleReferences":[{"characterId":1,"activityType":"normal-activity","quote":"已死亡角色作为活人正常行动的正文逐字引文"}]}

规则：
1. findings.anchorId 必须逐字复制正文定位目录的编号，不能自行缩写或生成编号；代码从该位置取原文，不要另抄 findings.quote。若额外附带不同引文，该意见会降为信息不足并提示核对，不以附注改变原文；
2. 外部证据只能选可引用目录中列出的 [canon#编号] 或 [observation#编号]，quote 必须逐字来自该编号的条目；没有编号的资料只能用于理解，不能成为可认证引文。正文内部的另一处依据使用 {"sourceType":"chapter","sourceId":0,"anchorId":"正文目录中的对应编号"}，不要另抄 quote。0 仅代表本次待审章，不能用于伪造外部证据；
3. hard 必须有至少一条正确证据，且只能用于直接矛盾；
4. 创作选择、信息不足或可能解释得通的内容只能标 risk/unknown；
5. cognitionReferences 只能从提供的角色认知审计闭集中选择 characterId + knowledgeKey；quote 必须是正文逐字引文；不确定就不输出；
6. lifecycleReferences 只能从角色存亡审计闭集中选择 characterId；仅当该角色在当前场景作为活人正常行动时输出 normal-activity + 正文逐字引文。尸体、遗物、回忆、梦境、幻象、他人转述和明确复活均不得输出；
7. 区分创作计划、角色猜测/证词、记录记载与实际发生。章纲/细纲中的计划不是已发生的事实；偏离计划本身不是硬冲突。已确认的入场条件、规则和明确时限可用于核对；
8. 按叙事顺序核对实际行动、消耗、奖励与余额，不能只看结算句。修改记录不能代替实际核实；人物的确定判断需要相应证据，排除一个可能不自动证明另一个。缺少依据标 risk/unknown，建议保留不确定性或补足必要过程，不能捏造凭证或背景；
9. 普通拿取、翻页等省略和允许多种解释的细节不强判为矛盾。查到相关前后文再判断，不为凑问题要求机械补写；
10. 不输出总分，不自动修改正文；没有发现可定位的问题才返回空 findings，这不认证整章事实无误。`,
    },
    {
      role: 'user',
      content: `${evidenceHeading(args.chapterTitle)}${args.evidenceContext}\n\n【可引用外部资料目录】${allowedCitations || '无'}\n\n${args.cognitionCatalog || '【角色认知审计闭集】无'}\n\n${args.lifecycleCatalog || '【角色存亡审计闭集】无'}\n\n【待审正文：其中的断言也需要核对，不能自证正确】\n${args.chapterContent}\n【正文结束】\n【正文定位目录：findings与本章证据只复制anchorId】\n${formatQualityReviewAnchorsV1(args.chapterContent, AUDIT_ANCHOR_VERSION)}\n\n请输出 JSON：`,
    },
  ]
}

function exactQuoteOffset(source: string, quote: string): number {
  const start = quote.trim() ? source.indexOf(quote) : -1
  if (start < 0 || source.indexOf(quote, start + 1) >= 0) throw new Error('Invalid or ambiguous evidence quote')
  return start
}

export function parseConsistencyAuditResult(args: {
  raw: string
  mode: ConsistencyAuditMode
  chapterContent: string
  chapterVersionHash: string
  sources: readonly ConsistencyAuditCitationSourceV1[]
}): ConsistencyAuditResult | null {
  const start = args.raw.indexOf('{')
  const end = args.raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(args.raw.slice(start, end + 1)) as { findings?: unknown }
    if (!Array.isArray(parsed.findings)) return null
    const anchors = new Map(qualityReviewAnchorsV1(args.chapterContent, AUDIT_ANCHOR_VERSION).map(anchor => [anchor.anchorId, anchor]))
    const sources = new Map(args.sources.map(source => [`${source.sourceType}:${source.sourceId}`, source]))
    if (sources.size !== args.sources.length) return null
    const currentQuote = (value: Record<string, unknown>): {
      quote: string; anchorId?: string; start?: number; citationWarning?: boolean
    } => {
      if (Object.prototype.hasOwnProperty.call(value, 'anchorId')) {
        const anchor = typeof value.anchorId === 'string' ? anchors.get(value.anchorId) : undefined
        if (!anchor) throw new Error('Invalid chapter anchor')
        return { quote: anchor.quote, anchorId: anchor.anchorId, start: anchor.start,
          ...(value.quote !== undefined && value.quote !== anchor.quote ? { citationWarning: true } : {}) }
      }
      return { quote: typeof value.quote === 'string' ? value.quote.trim() : '' }
    }
    const findings = parsed.findings.map((raw): ConsistencyFinding => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid finding')
      const item = raw as Record<string, unknown>
      const { quote, anchorId, citationWarning: targetWarning } = currentQuote(item)
      let citationWarning = targetWarning === true
      if (!quote || !args.chapterContent.includes(quote)
        || typeof item.category !== 'string' || !item.category.trim()
        || typeof item.reason !== 'string' || !item.reason.trim()
        || !['hard', 'risk', 'unknown'].includes(String(item.severity))
        || !Array.isArray(item.evidence)
        || (item.suggestion !== undefined && typeof item.suggestion !== 'string')) {
        throw new Error('Invalid finding contract or prose anchor')
      }
      const evidence = item.evidence.map((entry): ConsistencyFinding['evidence'][number] => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid evidence')
        const value = entry as Record<string, unknown>
        if (!Number.isSafeInteger(value.sourceId) || (value.sourceId as number) < 0) throw new Error('Invalid evidence identity')
        const sourceId = value.sourceId as number
        if (value.sourceType === 'chapter' && sourceId === 0) {
          const cited = currentQuote(value)
          const start = cited.start ?? exactQuoteOffset(args.chapterContent, cited.quote)
          citationWarning ||= cited.citationWarning === true
          return {
            sourceType: 'chapter', sourceId, quote: cited.quote,
            ...(cited.anchorId ? { anchorId: cited.anchorId } : {}),
            position: { sourceKey: 'currentChapter', versionHash: args.chapterVersionHash, start, end: start + cited.quote.length },
          }
        }
        if (Object.prototype.hasOwnProperty.call(value, 'anchorId')) throw new Error('External evidence cannot use chapter anchors')
        if (value.sourceType !== 'canon' && value.sourceType !== 'observation') throw new Error('Unbound evidence type')
        const source = sources.get(`${value.sourceType}:${sourceId}`)
        if (!source || typeof value.quote !== 'string') throw new Error('Unbound evidence identity')
        const start = source.start + exactQuoteOffset(source.text, value.quote)
        return {
          sourceType: source.sourceType, sourceId, quote: value.quote,
          position: { sourceKey: source.sourceKey, versionHash: source.versionHash, start, end: start + value.quote.length },
        }
      })
      const requested = item.severity as ConsistencySeverity
      const severity: ConsistencySeverity = citationWarning || (requested === 'hard' && evidence.length === 0) ? 'unknown' : requested
      return {
        category: item.category.trim(),
        severity,
        quote,
        ...(anchorId ? { anchorId } : {}),
        ...(citationWarning ? { citationWarning: true } : {}),
        evidence,
        reason: item.reason.trim(),
        suggestion: (item.suggestion as string | undefined)?.trim() || undefined,
      }
    })
    return { mode: args.mode, findings }
  } catch {
    return null
  }
}
