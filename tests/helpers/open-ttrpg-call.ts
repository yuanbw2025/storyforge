import type { AgentRunContractV1 } from '../../src/lib/types'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { startTtrpgOpenEpochV1, reserveTtrpgOpenModelCallV1 } from '../../src/lib/ttrpg/runtime-commands'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { ttrpgOpenCallBindingHashV1 } from '../../src/lib/ttrpg/open-model-call-evidence'
import { createAgentRunV1, appendAgentRunEventV1, type AgentRunSnapshotV1 } from '../../src/lib/agent/run/event-store'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { createAgentSkillExecutionBindingV1 } from '../../src/lib/agent/execution-binding'
import { createContextManifestV1 } from '../../src/lib/agent/run/context-manifest'
import { recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import { TTRPG_OPEN_AUTHORITY_PROVIDER_V1, TTRPG_OPEN_KNOWLEDGE_PROVIDER_V1 } from '../../src/lib/ttrpg/open-context-provider'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { estimateTokens } from '../../src/lib/ai/context-budget'

export async function preparedOpenTtrpgCallV1(options: { enabled?: boolean; missingRequest?: boolean; missingManifest?: boolean; wrongManifest?: boolean } = {}) {
  const fixture = await readyOpenTtrpgSessionV1('open call lifecycle', pkg => { pkg.ttrpg!.campaign.runtimePolicy.enabled = options.enabled ?? true })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'call.epoch'), viewerKey: OPEN_HUMAN_VIEWER,
    triggerKind: 'submit-action', rawInput: '调查河港' })
  const context = await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'hero' })
  const { readProductRuntimeState } = await import('../../src/lib/product/runtime-core')
  const runtime = (await readProductRuntimeState(fixture.sessionId)).ttrpg!
  const epochKey = runtime.openRun!.coordination.activeEpochKey!
  const stepId = 'ttrpg.open.intent'
  const identity = { actorKey: 'hero', admissionStateHash: context.admissionStateHash,
    visibilityHash: context.visibilityHash, runtimeSourceHash: context.readEvidence.runtimeSourceHash }
  const skill = getAgentSkillV1('prose.ttrpg-open-intent')
  const contract: AgentRunContractV1 = {
    version: 1, objective: '只提出 hero 的行动候选', workflowKind: 'direct-generation',
    scope: { projectId: fixture.scope.projectId, worldGroupId: fixture.session.worldGroupId ?? null,
      runtime: { productRuntimeSessionId: fixture.sessionId, baseSequence: context.readEvidence.sequence,
        stateHash: context.readEvidence.stateHash, visibilityHash: context.visibilityHash, releaseHash: context.readEvidence.runtimeSourceHash } },
    permissions: { contextSourceKeys: ['ttrpgOpenAuthority', 'ttrpgOpenKnowledge'], writeTargets: [] },
    runtimeBindingHash: await ttrpgOpenCallBindingHashV1({ ...identity, authorizationEpochKey: epochKey, sessionKey: context.readEvidence.sessionKey }),
    executionBindings: [{ stepId, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: { maxModelCalls: 2, maxToolCalls: 0, maxInputTokens: 9000, maxOutputTokens: 2000, maxAttemptsPerStep: 2 },
    acceptance: [{ id: 'candidate', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'ttrpg-open-call-test-v1', criterionIds: ['candidate'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  }
  let snapshot = await createAgentRunV1({ scope: fixture.scope, productRuntimeSessionId: fixture.sessionId,
    worldGroupId: contract.scope.worldGroupId, contract })
  const append = async (type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) => {
    snapshot = await appendAgentRunEventV1({ scope: fixture.scope, productRuntimeSessionId: fixture.sessionId, runId: snapshot.run.id,
      type, payload, expectedLastSequence: snapshot.projection.lastSequence } as Parameters<typeof appendAgentRunEventV1>[0])
  }
  await append('step.scheduled', { stepId }); await append('step.started', { stepId, attempt: 1 })
  const frozenScope = { projectId: fixture.scope.projectId, worldId: fixture.scope.worldId, workId: fixture.scope.workId,
    productRuntimeSessionId: fixture.sessionId, runtimeActorKey: 'hero' }
  const sources = []
  const bodies = []
  for (const [sourceKey, provider] of [['ttrpgOpenAuthority', TTRPG_OPEN_AUTHORITY_PROVIDER_V1], ['ttrpgOpenKnowledge', TTRPG_OPEN_KNOWLEDGE_PROVIDER_V1]] as const) {
    const page = await provider.listMetadata({ scope: frozenScope, limit: 1000 })
    const reads = []
    for (const item of page.items) reads.push((await provider.read({ scope: frozenScope, resourceKey: item.resourceKey, depth: 'full', maxTokens: 9000 })).content)
    const body = reads.join('\n'); bodies.push(body)
    sources.push({ key: sourceKey, status: 'included' as const, delivery: 'full' as const, contentHash: await sha256Text(body), tokens: estimateTokens(body) })
  }
  const selectedSources = options.wrongManifest ? sources.slice(0, 1) : sources
  const manifest = await createContextManifestV1({ version: 1, runId: snapshot.run.id, stepId, attempt: 1,
    scope: { projectId: fixture.scope.projectId, worldGroupId: contract.scope.worldGroupId }, inputBudget: 9000,
    totalInputTokens: selectedSources.reduce((n, row) => n + row.tokens, 0), sources: selectedSources })
  await append('context.assembled', { stepId, attempt: 1, manifestHash: manifest.manifestHash })
  const request = JSON.stringify([{ role: 'system', content: '只提出行动，不裁定结果' }, { role: 'user', content: bodies.join('\n') }])
  const record = async (artifactKind: Parameters<typeof recordAgentRunArtifactV1>[0]['artifactKind'], content: string) => {
    const stored = await recordAgentRunArtifactV1({ scope: fixture.scope, runId: snapshot.run.id, productRuntimeSessionId: fixture.sessionId,
      artifactKind, content, stepId, attempt: 1, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = stored.snapshot as AgentRunSnapshotV1
    if (artifactKind === 'raw-response') await append('model.responded', { stepId, attempt: 1, outputHash: stored.artifact.contentHash })
    return stored.artifact.contentHash
  }
  if (!options.missingManifest) await record('source-snapshot', JSON.stringify(manifest))
  const requestHash = options.missingRequest ? await sha256Text(request) : await record('rendered-request', request)
  await append('model.requested', { stepId, attempt: 1, bindingHash: requestHash })
  const reservation = { ...await openEnvelopeV1(fixture.sessionId, 'call.reserve'), ...identity, viewerKey: OPEN_HUMAN_VIEWER,
    runId: snapshot.run.id, runContractHash: snapshot.run.contractHash, skillId: skill.id, stepId, attempt: 1,
    requestHash, inputManifestHash: manifest.manifestHash, reservedInputTokens: 9000, reservedOutputTokens: 1000, reservedCostUsd: 0.1 }
  const reserve = () => reserveTtrpgOpenModelCallV1(reservation)
  return { fixture, reservation, context, reserve, append, record, snapshot: () => snapshot }
}
