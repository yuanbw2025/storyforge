import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { loadTtrpgOpenKpContextV1 } from '../../src/lib/ttrpg/open-kp-context'
import { generateTtrpgOpenKpCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { acceptTtrpgOpenKpNarrationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import { projectTtrpgRulePackMechanicalCoreV1 } from '../../src/lib/ttrpg/rule-pack-v2'
import { TTRPG_OPEN_KP_INPUT_PROVIDER_V1 } from '../../src/lib/ttrpg/open-context-provider'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import { ttrpgOpenDeliveredKpSourceKeysV1 } from '../../src/lib/ttrpg/open-kp-delivered-sources'
import * as kpContext from '../../src/lib/ttrpg/open-kp-context'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'

function withRuleNoLongerShared(context: Awaited<ReturnType<typeof loadTtrpgOpenKpContextV1>>) {
  const changed = structuredClone(context)
  const packet = changed.modernResources.find(row => row.suffix === 'kp-input.v3')!.value as { entries: Array<{ value: { action: unknown } }> }
  packet.entries[0].value.action = null
  return changed
}

async function setup(unsharedRule = false) {
  const f = await setupChecksFixtureV1({ cooperative: true, privateDiscovery: true }, pkg => {
    const c = pkg.ttrpg!.campaign
    c.characterTemplates[0].name = '林澈'
    c.characterTemplates[1].name = '余砚'
    c.characterTemplates[2].name = '潮汐商人'
    c.characterTemplates[3].name = 'GM-PRIVATE-NPC-NAME'
    c.characterTemplates[0].playerProfile!.privateGoal = 'PRIVATE-GOAL-NOT-FOR-PARTY'
    c.characterTemplates[1].playerProfile!.secret = 'PRIVATE-PROFILE-NOT-FOR-PARTY'
    c.situationTemplates[0].evidence[0].title = 'PRIVATE-CLUE-NOT-FOR-PARTY'
    c.situationTemplates[0].evidence[0].description = 'PRIVATE-DISCOVERY-NOT-FOR-PARTY'
    for (const binding of c.entityBindings.filter(row => row.kind === 'actor')) {
      binding.audience = binding.templateKey === 'keeper' ? 'gm-only' : 'private'
      binding.knownByActorKeys = binding.templateKey === 'keeper' ? [] : [binding.templateKey]
    }
    if (unsharedRule) c.characterTemplates[1].actionKeys = c.characterTemplates[1].actionKeys.filter(key => key !== pkg.ttrpg!.rulePack.content.actions[0].key)
    for (const template of c.characterTemplates) template.characterSheet = createCompleteTtrpgCharacterSheetV2({ template, rulePack: projectTtrpgRulePackMechanicalCoreV1(pkg.ttrpg!.rulePack.content) })
  })
  await resumeTtrpgOpenChecksV1(f.command)
  return f
}

describe('R-TTRPGOPEN3 public executed-action grounding for KP', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('delivers the public player and shared actual rule through Gateway even when actorsHere is empty, without disclosing private results', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.command.sessionId)
    const context = await loadTtrpgOpenKpContextV1({ scope: f.f.scope, sessionId: f.command.sessionId, actorKey: 'gm' })
    const packet = context.modernResources.map(row => row.value).find(value => value.schema === 'storyforge.ttrpg-open-kp-input')!
    expect(packet).toMatchObject({ version: 3, actors: [] })
    const action = f.f.runtimePackage.ttrpg!.rulePack.content.actions[0]
    expect(JSON.stringify(packet)).toContain('林澈')
    expect(JSON.stringify(packet)).toContain(action.name)
    expect(JSON.stringify(packet)).toContain('not-public')
    for (const hidden of ['PRIVATE-GOAL-NOT-FOR-PARTY', 'PRIVATE-PROFILE-NOT-FOR-PARTY', 'GM-PRIVATE-NPC-NAME', 'PRIVATE-CLUE-NOT-FOR-PARTY', 'PRIVATE-DISCOVERY-NOT-FOR-PARTY']) expect(JSON.stringify(packet)).not.toContain(hidden)
    const provider = TTRPG_OPEN_KP_INPUT_PROVIDER_V1, scope = { ...f.f.scope, productRuntimeSessionId: f.command.sessionId, runtimeActorKey: 'gm' }
    const metadata = await provider.listMetadata({ scope, limit: 1000 })
    expect(provider.providerVersion).toBe('ttrpg-open-kp-provider-v3')
    const current = metadata.items.find(row => row.resourceKey.endsWith(':kp-input.v3'))!
    expect(current.priority).toBe('must-read')
    expect(metadata.items.some(row => /:kp-(input|contract)(\.v2)?$/.test(row.resourceKey))).toBe(false)
    for (const legacy of [...context.resources, ...context.legacyModernResources.slice(0, 2)]) {
      const resourceKey = current.resourceKey.replace(/kp-input\.v3$/, legacy.suffix)
      const retained = await provider.read({ scope, resourceKey, depth: 'full', maxTokens: 16000 })
      expect(retained.content).toBe(canonicalStringify(legacy.value))
      if (legacy.suffix.startsWith('kp-input')) expect(retained.content).not.toContain('林澈')
    }
    const raw = JSON.stringify({ paragraphs: [{ text: `林澈完成了${action.name}，具体结果尚未公开。`, sourceKeys: ['action.receipt'] }] }), runAI = vi.fn(async () => raw)
    const generated = await generateTtrpgOpenKpCandidateV1({ ...await openEnvelopeV1(f.command.sessionId, 'kp.public.action'), scope: f.f.scope, viewerKey: f.command.viewerKey,
      rawInput: 'PRIVATE-RAW-INPUT-NOT-FOR-PARTY', maximumOutputTokens: 800, maximumCostUsd: .1, runAI })
    expect(runAI).toHaveBeenCalledOnce()
    const messages = generated.prepared.messages.map(row => row.content).join('\n')
    expect(messages).toContain('林澈'); expect(messages).toContain(action.name)
    for (const hidden of ['PRIVATE-GOAL-NOT-FOR-PARTY', 'PRIVATE-PROFILE-NOT-FOR-PARTY', 'GM-PRIVATE-NPC-NAME', 'PRIVATE-RAW-INPUT-NOT-FOR-PARTY', 'PRIVATE-CLUE-NOT-FOR-PARTY', 'PRIVATE-DISCOVERY-NOT-FOR-PARTY']) expect(messages).not.toContain(hidden)
    expect(generated.candidate.narration).toEqual(JSON.parse(raw))
    const adoption = { ...await operationInput(f.command.sessionId, f.command.operationKey, 'narration'), runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash }
    const event = await acceptTtrpgOpenKpNarrationV1(adoption)
    expect(await acceptTtrpgOpenKpNarrationV1(adoption)).toEqual(event)
    const after = await readProductRuntimeState(f.command.sessionId)
    expect(after.entities).toEqual(before.entities)
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(after.ttrpg!.openRun!.knowledge).toEqual(before.ttrpg!.openRun!.knowledge)
    expect(after.ttrpg!.openRun!.factLedger).toEqual(before.ttrpg!.openRun!.factLedger)
    expect(after.ttrpg!.openRun!.narrations).toHaveLength(1)
  })
  it('does not disclose the executed rule when another recipient lacks that rule projection', async () => {
    const f = await setup(true), context = await loadTtrpgOpenKpContextV1({ scope: f.f.scope, sessionId: f.command.sessionId, actorKey: 'gm' })
    const packet = context.modernResources.map(row => row.value).find(value => value.schema === 'storyforge.ttrpg-open-kp-input')!
    expect(packet).toMatchObject({ version: 3 })
    const action = f.f.runtimePackage.ttrpg!.rulePack.content.actions[0]
    expect(JSON.stringify(packet)).not.toContain(action.key)
    expect(JSON.stringify(packet)).not.toContain(action.name)
    expect(JSON.stringify(packet)).toContain('林澈')
  })
  it('blocks a retained answer if only the new shared-action projection changes during generation', async () => {
    const f = await setup(), original = kpContext.loadTtrpgOpenKpContextV1
    const raw = JSON.stringify({ paragraphs: [{ text: '林澈完成了这次调查，具体结果尚未公开。', sourceKeys: ['action.receipt'] }] })
    const generated = await generateTtrpgOpenKpCandidateV1({ ...await openEnvelopeV1(f.command.sessionId, 'kp.public.changed.response'), scope: f.f.scope, viewerKey: f.command.viewerKey,
      rawInput: '', maximumOutputTokens: 800, maximumCostUsd: .1, runAI: async () => {
        vi.spyOn(kpContext, 'loadTtrpgOpenKpContextV1').mockImplementation(async input => withRuleNoLongerShared(await original(input)))
        return raw
      } })
    expect(generated.candidate.artifact.status).toBe('blocked')
    expect(generated.candidate.artifact.issues.some(issue => issue.code === 'ttrpg-open-intent-stale' && issue.disposition === 'blocking')).toBe(true)
    expect(await readAgentRunArtifactExactV1({ projectId: f.f.scope.projectId, artifactKind: 'raw-response', contentHash: generated.candidate.rawResponseHash })).toBe(raw)
    expect((await readProductRuntimeState(f.command.sessionId)).ttrpg!.openRun!.narrations ?? []).toEqual([])
  })
  it('rejects adoption if the V3 action becomes unreadable while the legacy context hashes remain equal', async () => {
    const f = await setup(), original = kpContext.loadTtrpgOpenKpContextV1
    const generated = await generateTtrpgOpenKpCandidateV1({ ...await openEnvelopeV1(f.command.sessionId, 'kp.public.changed.adoption'), scope: f.f.scope, viewerKey: f.command.viewerKey,
      rawInput: '', maximumOutputTokens: 800, maximumCostUsd: .1, runAI: async () => JSON.stringify({ paragraphs: [{ text: '林澈完成了这次调查，具体结果尚未公开。', sourceKeys: ['action.receipt'] }] }) })
    const before = await readProductRuntimeState(f.command.sessionId)
    vi.spyOn(kpContext, 'loadTtrpgOpenKpContextV1').mockImplementation(async input => withRuleNoLongerShared(await original(input)))
    await expect(acceptTtrpgOpenKpNarrationV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, 'narration'), runId: generated.prepared.runId,
      requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash })).rejects.toThrow(/变化|stale/)
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(before)
  })
  it('requires exactly the delivered V3 input and binding while retaining the older citation contracts', () => {
    const binding = { operationKey: 'operation.original', frozenPlanHash: 'a'.repeat(64), audience: 'party' }
    const contract = { schema: 'storyforge.ttrpg-open-kp-contract', version: 3, binding, allowedSourceKeys: ['action.receipt'] }
    const packet = { schema: 'storyforge.ttrpg-open-kp-input', version: 3, binding, recipientActorKeys: ['hero'], entries: [{ sourceKey: 'action.receipt' }] }
    expect(ttrpgOpenDeliveredKpSourceKeysV1([contract, packet])).toEqual(['action.receipt'])
    for (const values of [[contract], [contract, { ...packet, version: 2 }], [contract, packet, packet], [contract, { ...packet, binding: { ...binding, operationKey: 'other.operation' } }], [contract, { ...packet, entries: [{ sourceKey: 'invented' }] }]]) expect(() => ttrpgOpenDeliveredKpSourceKeysV1(values)).toThrow()
    expect(ttrpgOpenDeliveredKpSourceKeysV1([{ ...contract, version: 1 }])).toEqual(['action.receipt'])
    expect(ttrpgOpenDeliveredKpSourceKeysV1([{ ...contract, version: 2 }])).toEqual(['action.receipt'])
  })
})
