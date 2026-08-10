import type {
  ImpactRemediationActionV1,
  ImpactRemediationItemV1,
  ImpactRemediationPlanV1,
} from './impact-remediation-plan'

export const IMPACT_HANDOFF_VERSION_V2 = 2 as const

/** Existing step-by-step workspace modules that can receive manual review. */
export type ImpactHandoffModuleV2 =
  | 'chapters-list'
  | 'fact-library'
  | 'state-table'
  | 'inventory'
  | 'story-arc'
  | 'story-timeline'
  | 'relations'
  | 'characters'
  | 'world-rules'
  | 'worldview-origin'
  | 'worldview-natural'
  | 'worldview-humanity'
  | 'power-system'
  | 'story-design'
  | 'outline'
  | 'detailed-outline'
  | 'rules'
  | 'references'

export interface ImpactHandoffV2 {
  version: typeof IMPACT_HANDOFF_VERSION_V2
  itemId: string
  action: ImpactRemediationActionV1
  table: string
  recordId: number | null
  targetModule: ImpactHandoffModuleV2
  targetRecordId: number | null
  sourceChapterId: number
  sourceOutlineNodeId: number | null
  planHash: string
  graphHash: string
  sourceTextHash: string
  reviewRunId: number
  reviewReceiptHash: string
  returnModule: 'chapters-list'
  returnNodeId: number | null
}

const HASH_RE = /^[a-f0-9]{64}$/
const MANUAL_ACTIONS: ReadonlySet<ImpactRemediationActionV1> = new Set([
  'review-source',
  'review-fact',
  'review-source-record',
  'review-derived-state',
  'review-outline',
  'review-downstream-chapter',
])

const MODULES: ReadonlySet<ImpactHandoffModuleV2> = new Set([
  'chapters-list', 'fact-library', 'state-table', 'inventory', 'story-arc',
  'story-timeline', 'relations', 'characters', 'world-rules', 'worldview-origin',
  'worldview-natural', 'worldview-humanity', 'power-system', 'story-design', 'outline',
  'detailed-outline', 'rules', 'references',
])

/** Map a governed impact item to an existing manual editing surface. */
export function resolveImpactHandoffModuleV2(
  item: Pick<ImpactRemediationItemV1, 'action' | 'table'>,
): ImpactHandoffModuleV2 {
  switch (item.action) {
    case 'review-source':
    case 'review-downstream-chapter':
      return 'chapters-list'
    case 'review-fact':
      return 'fact-library'
    case 'review-outline':
      return 'detailed-outline'
    case 'review-derived-state':
      if (item.table === 'stateCards') return 'state-table'
      if (item.table === 'itemLedger') return 'inventory'
      if (item.table === 'storyTimelineEvents') return 'story-timeline'
      if (item.table === 'characterRelations') return 'relations'
      if (item.table === 'storylineProgress' || item.table === 'storylineCrossings') return 'story-arc'
      return 'fact-library'
    case 'review-source-record':
      if (item.table === 'worldRules') return 'world-rules'
      if (item.table === 'worldviews') return 'worldview-origin'
      if (item.table === 'powerSystems' || item.table === 'cultivationSystems') return 'power-system'
      if (item.table === 'storyCores') return 'story-design'
      if (item.table === 'characters') return 'characters'
      if (item.table === 'characterRelations') return 'relations'
      if (item.table === 'storyArcs' || item.table === 'storylineProgress' || item.table === 'storylineCrossings') return 'story-arc'
      if (item.table === 'outlineNodes') return 'outline'
      if (item.table === 'detailedOutlines') return 'detailed-outline'
      if (item.table === 'creativeRules') return 'rules'
      if (item.table === 'references') return 'references'
      return 'fact-library'
    default:
      throw new Error(`影响项动作无法交接：${String(item.action)}`)
  }
}

function assertHandoff(value: unknown): asserts value is ImpactHandoffV2 {
  if (!value || typeof value !== 'object') throw new Error('影响交接数据不是对象。')
  const row = value as Record<string, unknown>
  if (row.version !== IMPACT_HANDOFF_VERSION_V2) throw new Error('影响交接版本不受支持。')
  if (typeof row.itemId !== 'string' || row.itemId.trim() === '') throw new Error('影响交接缺少 itemId。')
  if (typeof row.action !== 'string' || !MANUAL_ACTIONS.has(row.action as ImpactRemediationActionV1)) throw new Error('影响交接动作无效。')
  if (typeof row.table !== 'string' || row.table.trim() === '') throw new Error('影响交接缺少目标表。')
  if (row.recordId !== null && (!Number.isInteger(row.recordId) || (row.recordId as number) < 1)) throw new Error('影响交接 recordId 无效。')
  if (typeof row.targetModule !== 'string' || !MODULES.has(row.targetModule as ImpactHandoffModuleV2)) throw new Error('影响交接目标模块无效。')
  if (row.targetRecordId !== null && (!Number.isInteger(row.targetRecordId) || (row.targetRecordId as number) < 1)) throw new Error('影响交接 targetRecordId 无效。')
  if (!Number.isInteger(row.sourceChapterId) || (row.sourceChapterId as number) < 1) throw new Error('影响交接来源章节无效。')
  if (row.sourceOutlineNodeId !== null && (!Number.isInteger(row.sourceOutlineNodeId) || (row.sourceOutlineNodeId as number) < 1)) throw new Error('影响交接来源章纲无效。')
  if (typeof row.planHash !== 'string' || !HASH_RE.test(row.planHash)) throw new Error('影响交接 planHash 无效。')
  if (typeof row.graphHash !== 'string' || !HASH_RE.test(row.graphHash)) throw new Error('影响交接 graphHash 无效。')
  if (typeof row.sourceTextHash !== 'string' || !HASH_RE.test(row.sourceTextHash)) throw new Error('影响交接 sourceTextHash 无效。')
  if (!Number.isInteger(row.reviewRunId) || (row.reviewRunId as number) < 1) throw new Error('影响交接 reviewRunId 无效。')
  if (typeof row.reviewReceiptHash !== 'string' || !HASH_RE.test(row.reviewReceiptHash)) throw new Error('影响交接 reviewReceiptHash 无效。')
  if (row.returnModule !== 'chapters-list') throw new Error('影响交接返回模块无效。')
  if (row.returnNodeId !== null && (!Number.isInteger(row.returnNodeId) || (row.returnNodeId as number) < 1)) throw new Error('影响交接返回章节无效。')
  const expectedModule = resolveImpactHandoffModuleV2({
    action: row.action as ImpactRemediationActionV1,
    table: row.table,
  })
  if (row.targetModule !== expectedModule) throw new Error('影响交接目标模块与影响项不匹配。')
  const expectedTargetRecordId = row.action === 'review-source' ? row.sourceOutlineNodeId : row.recordId
  if (row.targetRecordId !== expectedTargetRecordId) throw new Error('影响交接目标记录与影响项不匹配。')
  if (row.returnNodeId !== row.sourceOutlineNodeId) throw new Error('影响交接返回章节与来源不匹配。')
}

export function buildImpactHandoffV2(input: {
  plan: ImpactRemediationPlanV1
  itemId: string
  decision: 'needs-manual-action'
  reviewRunId: number
  reviewReceiptHash: string
  sourceOutlineNodeId: number | null
}): ImpactHandoffV2 {
  if (input.decision !== 'needs-manual-action') throw new Error('只有“需人工处理”的作者决定可以交接。')
  const item = input.plan.items.find(candidate => candidate.id === input.itemId)
  if (!item || item.mode !== 'author-confirmed') throw new Error('只有当前计划中的作者确认项可以交接。')
  if (!input.plan.planHash || !input.plan.graphHash || !input.plan.source.sourceTextHash) throw new Error('影响计划证据不完整，不能交接。')
  const targetModule = resolveImpactHandoffModuleV2(item)
  const targetRecordId = item.action === 'review-source'
    ? input.sourceOutlineNodeId
    : item.recordId
  const handoff: ImpactHandoffV2 = {
    version: IMPACT_HANDOFF_VERSION_V2,
    itemId: item.id,
    action: item.action,
    table: item.table,
    recordId: item.recordId,
    targetModule,
    targetRecordId,
    sourceChapterId: input.plan.source.recordId,
    sourceOutlineNodeId: input.sourceOutlineNodeId,
    planHash: input.plan.planHash,
    graphHash: input.plan.graphHash,
    sourceTextHash: input.plan.source.sourceTextHash,
    reviewRunId: input.reviewRunId,
    reviewReceiptHash: input.reviewReceiptHash,
    returnModule: 'chapters-list',
    returnNodeId: input.sourceOutlineNodeId,
  }
  assertHandoff(handoff)
  return handoff
}

export function serializeImpactHandoffV2(handoff: ImpactHandoffV2): string {
  assertHandoff(handoff)
  return encodeURIComponent(JSON.stringify(handoff))
}

export function parseImpactHandoffV2(raw: string | null | undefined): ImpactHandoffV2 | null {
  if (!raw) return null
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as unknown
    assertHandoff(value)
    return value
  } catch {
    return null
  }
}

export function buildImpactHandoffUrlV2(projectId: number, handoff: ImpactHandoffV2): string {
  if (!Number.isInteger(projectId) || projectId < 1) throw new Error('项目 ID 无效，不能生成影响交接地址。')
  const params = new URLSearchParams({
    module: handoff.targetModule,
    impactHandoff: serializeImpactHandoffV2(handoff),
  })
  return `/workspace/${projectId}?${params.toString()}`
}

/** A valid receipt is only actionable on the module encoded by the handoff. */
export function isImpactHandoffRouteModuleV2(
  routeModule: string | null | undefined,
  handoff: Pick<ImpactHandoffV2, 'targetModule'>,
): boolean {
  return routeModule === handoff.targetModule
}
