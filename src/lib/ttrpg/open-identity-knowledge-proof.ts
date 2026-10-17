import type { ProductRuntimeEvent } from '../types'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import type { TtrpgOpenKnowledgeEntryV1 } from './open-knowledge'
import { assertTtrpgOpenIdentityKnowledgeJournalV1, ttrpgOpenIdentityKnowledgeEventV1, ttrpgOpenIdentityKnowledgePayloadV1 } from './open-identity-knowledge'
import { verifyTtrpgOpenBranchLineageV1 } from './open-branch-contract'
import { ttrpgOpenScopedKeyV1 } from './open-coordination'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import * as p from './open-contract-parse'

export async function hashTtrpgOpenIdentityKnowledgeConfirmationV1(knowledge: TtrpgOpenKnowledgeEntryV1): Promise<string> {
  const { confirmationHash: _confirmationHash, ...grant } = knowledge.identityGrant ?? p.fail('身份确认缺少审阅主体')
  return hash({ schema: 'storyforge.ttrpg-open-identity-knowledge-confirmation', version: 1, knowledge: { ...knowledge, identityGrant: grant } })
}
export async function verifyTtrpgOpenIdentityKnowledgeV1(input: { runtime: TtrpgRuntimeStateV2; runtimeSourceHash: string; events: readonly ProductRuntimeEvent[] }): Promise<void> {
  const { runtime } = input
  const entries = runtime.openRun?.knowledge.filter(row => row.identityGrant) ?? []
  if (!entries.length) return
  if (runtime.branchLineage) await verifyTtrpgOpenBranchLineageV1(runtime.branchLineage, runtime.sessionKey)
  assertTtrpgOpenIdentityKnowledgeJournalV1(runtime)
  for (const knowledge of entries) {
    const grant = knowledge.identityGrant!, ref = knowledge.acquisitionRef, source = runtime.openRun!.knowledge.find(row => row.knowledgeKey === grant.sourceKnowledgeKey)!
    const commandId = await ttrpgOpenScopedKeyV1(ref.sessionKey, 'identity-control', [grant.viewerKey, grant.submissionKey])
    if (grant.runtimeSourceHash !== input.runtimeSourceHash || grant.sourceKnowledgeHash !== await hash(source)
      || grant.confirmationHash !== await hashTtrpgOpenIdentityKnowledgeConfirmationV1(knowledge)
      || knowledge.knowledgeKey !== await ttrpgOpenScopedKeyV1(ref.sessionKey, 'identity-grant', [grant.viewerKey, grant.submissionKey])) p.fail('身份确认的冻结来源、原知识或审阅摘要已变化')
    const payload = ttrpgOpenIdentityKnowledgePayloadV1(knowledge), type = ttrpgOpenIdentityKnowledgeEventV1(grant.mode)
    if (ref.sessionKey === runtime.sessionKey) {
      const event = input.events.find(row => row.sequence === ref.sequence)
      if (!event || event.type !== type || event.commandId !== commandId || event.actorKey !== grant.actorKey || event.targetKey !== null
        || stable(JSON.parse(event.payloadJson)) !== stable(payload)) p.fail('身份知识没有原准确正式事件')
    } else {
      const ancestor = runtime.branchLineage?.ancestors.find(row => row.sessionKey === ref.sessionKey), event = ancestor?.events[ref.sequence - 1]
      if (!ancestor || ancestor.runtimeSourceHash !== input.runtimeSourceHash || event?.type !== type || event.payloadHash !== await hash(payload)
        || !ancestor.snapshot.openRun?.knowledge.some(row => stable(row) === stable(knowledge))) p.fail('身份知识没有原祖先切点内的准确事件')
    }
  }
}
