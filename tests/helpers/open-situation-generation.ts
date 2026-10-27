import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { loadTtrpgOpenSituationKernelInputV1 } from '../../src/lib/ttrpg/open-generated-situation-context'
import type { TtrpgOpenSituationProposalBasisV1 } from '../../src/lib/ttrpg/open-generated-situation-contract'

export const SITUATION_GENERATION_INPUT_V1 = '结合港口、守灯人和英雄身份拟定一个新局势'
export function situationGenerationOutputV1(basis: TtrpgOpenSituationProposalBasisV1) {
  const template = structuredClone(basis.campaign.situationTemplates[0])
  const map = new Map(template.evidence.map((e, i) => [e.clueRef, basis.assignedTemplateKey + '.evidence.' + i]))
  const remap = (value: unknown): unknown => typeof value === 'string' ? map.get(value) ?? value : Array.isArray(value) ? value.map(remap)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)])) : value
  const { templateKey: _key, ...body } = template
  return { schema: 'storyforge.ttrpg-open-situation-proposal', version: 1,
    template: { ...(remap(body) as typeof body), motive: 'knowledge', driverGoal: 'PRIVATE-GENERATED-SITUATION-GOAL' },
    personalizationSourceKeys: [basis.personalizationSources[0].sourceKey] }
}
export async function setupSituationGenerationV1(humanGm = false, configure?: Parameters<typeof readyOpenTtrpgSessionV1>[1]) {
  const f = await readyOpenTtrpgSessionV1('Formal situation generation', pkg => {
    pkg.ttrpg!.campaign.runtimePolicy.enabled = true
    pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
    pkg.ttrpg!.campaign.runtimePolicy.maximumOutputTokens = 8000
    if (humanGm) pkg.ttrpg!.campaign.gmMode = 'human'
    pkg.ttrpg!.campaign.characterTemplates.find(c => c.role === 'npc')!.gmProfile!.secret = 'PRIVATE-GM-SITUATION-SOURCE'
    configure?.(pkg)
  })
  const viewerKey = humanGm ? 'viewer.gm' : OPEN_HUMAN_VIEWER, input = { scope: f.scope, sessionId: f.sessionId, viewerKey }
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'situation.formal.start'), viewerKey, triggerKind: 'request-situation', rawInput: SITUATION_GENERATION_INPUT_V1 })
  const kernel = await loadTtrpgOpenSituationKernelInputV1({ ...input, actorKey: 'gm' })
  const request = { ...input, ...await openEnvelopeV1(f.sessionId, 'situation.formal.prepare'), rawInput: SITUATION_GENERATION_INPUT_V1, maximumOutputTokens: 4000, maximumCostUsd: 0.1 }
  return { f, input, kernel, request, value: kernel.basis.campaign.situationTemplates.length ? situationGenerationOutputV1(kernel.basis) : null }
}
