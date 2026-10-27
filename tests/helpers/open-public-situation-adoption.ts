import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER, openEnvelopeV1 } from './open-ttrpg-session'
import { createTtrpgOpenPublicSituationAuthorizationV1 } from '../../src/lib/ttrpg/open-public-situation-authorization'
import { prepareTtrpgOpenPublicSituationInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { executeTtrpgOpenPublicSituationRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readTtrpgOpenRuntimeCandidateForKernelV1 } from '../../src/lib/ttrpg/open-runtime-candidate'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import type { TtrpgOpenPublicSituationKernelV1 } from '../../src/lib/ttrpg/open-public-situation-kernel'
import { publicSituationOutputV1 } from './open-public-situation-generation'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

/** One explicit mocked response; this fixture is not real-model or human-play evidence. */
export async function setupPublicSituationAdoptionV1(decision: 'draft-only' | 'adopt-this-one-candidate' = 'adopt-this-one-candidate', humanGm = false,
  configure?: Parameters<typeof readyOpenTtrpgSessionV1>[1], transform?: (value: ReturnType<typeof publicSituationOutputV1>) => void) {
  const f = await readyOpenTtrpgSessionV1('Public once adoption', pkg => {
    const c = pkg.ttrpg!.campaign; c.runtimePolicy.enabled = true; c.runtimePolicy.maximumEpochTokens = 50000; c.runtimePolicy.maximumOutputTokens = 8000
    if (humanGm) c.gmMode = 'human'
    c.fronts[0].goal = 'PRIVATE-PUBLIC-ADOPTION-FRONT'
    c.characterTemplates.find(row => row.role === 'npc')!.gmProfile!.secret = 'PRIVATE-PUBLIC-ADOPTION-GM'
    configure?.(pkg)
  })
  const viewerKey = humanGm ? 'viewer.gm' : OPEN_HUMAN_VIEWER
  const auth = await createTtrpgOpenPublicSituationAuthorizationV1({ ...await openEnvelopeV1(f.sessionId, 'public.adoption.authorize'), scope: f.scope,
    viewerKey, rawInput: '  根据共同资料拟定并按本次授权处理候选 e\u0301。\n', sharingDecision: 'share-this-request-with-current-party',
    delegationDecision: decision, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 4000, maximumCostUsd: 0.1 })
  const read = { scope: f.scope, sessionId: f.sessionId, viewerKey, runId: auth.runId, requestKey: auth.requestKey }
  const prepared = await prepareTtrpgOpenPublicSituationInputV1(read)
  const kernel = JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'source-snapshot', contentHash: prepared.evidence.publicKernelHash! })) as TtrpgOpenPublicSituationKernelV1
  let sends = 0
  const value = publicSituationOutputV1(kernel); transform?.(value)
  const result = await executeTtrpgOpenPublicSituationRequestV1({ ...read, runAI: async () => { sends++; return JSON.stringify(value) } })
  if (result.status !== 'candidate') throw new Error('public fixture requires candidate')
  const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1(read, 'public-situation-proposal')
  if (candidate?.schema !== 'storyforge.ttrpg-open-public-situation-candidate' || !candidate.review?.evaluation.accepted) throw new Error('public fixture requires validated original candidate')
  const adoption = { ...read, candidateHash: candidate.candidateHash, templateHash: await hashCanonicalValue(candidate.review.proposal.template), authorizationBasisHash: auth.grant.basisHash }
  return { f, auth, read, prepared, candidate, adoption, kernel, value, sends: () => sends }
}
