import { db } from '../db/schema'
import { executeContextGatewayV1, type ContextGatewayExecutionV1 } from '../context-gateway/execution'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { getAgentSkillV1 } from './skill-registry'

/**
 * MW-1 read boundary for a channel-specific task.
 *
 * The selected world and exact channel are mandatory full reads. The adjacent
 * world's entry/exit/power/takeaway rules arrive only inside the aggregate
 * world-link resource, so traversal cannot silently continue to a second hop.
 */
export async function executeWorldLinkContextV1(input: {
  scope: WorkspaceScope
  targetWorldGroupId: number
  worldGroupLinkId: number
  query: string
  budgetTokens?: number
  signal?: AbortSignal
}): Promise<ContextGatewayExecutionV1> {
  const [target, link] = await Promise.all([
    db.worldGroups.get(input.targetWorldGroupId),
    db.worldGroupLinks.get(input.worldGroupLinkId),
  ])
  if (!target || !await assertRecordInScope(input.scope, 'worldGroups', target, { owner: 'world' })) {
    throw new Error('目标世界不属于当前 World。')
  }
  if (!link || !await assertRecordInScope(input.scope, 'worldGroupLinks', link, { owner: 'world' })) {
    throw new Error('世界通道不属于当前 World。')
  }
  if (link.fromGroupId !== input.targetWorldGroupId && link.toGroupId !== input.targetWorldGroupId) {
    throw new Error('指定通道没有连接目标世界。')
  }
  if (!isPortableResourceUidV1(target.ragDocumentId, 'world-group')
    || !isPortableResourceUidV1(link.ragDocumentId, 'world-group-link')) {
    throw new Error('目标世界或通道缺少有效的 portable resource UID，拒绝继续执行。')
  }
  const targetKey = `world:${target.ragDocumentId}`
  const linkKey = `world-link:${link.ragDocumentId}`
  return executeContextGatewayV1({
    skill: getAgentSkillV1('world-origin.world-link-context', 'world-origin'),
    scope: input.scope,
    worldGroupId: input.targetWorldGroupId,
    query: input.query,
    budgetTokens: input.budgetTokens,
    mandatoryResourceKeys: [targetKey, linkKey],
    mandatoryFullResourceKeys: [targetKey, linkKey],
    targetResourceKeys: [targetKey, linkKey],
    additionalReadsEnabled: false,
    signal: input.signal,
  })
}
