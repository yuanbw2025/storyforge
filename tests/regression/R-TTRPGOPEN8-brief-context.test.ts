import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { createTtrpgOpenBriefContextProviderV1, loadTtrpgOpenBriefContextV1 } from '../../src/lib/ttrpg/open-brief-context'
import { prepareTtrpgOpenIntentInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { loadTtrpgOpenKpContextV1 } from '../../src/lib/ttrpg/open-kp-context'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { AGENT_TOOL_SCHEMA_HASH_V1 } from '../../src/lib/agent/execution-binding'
import { getAgentToolSchemaSnapshotV1 } from '../../src/lib/agent/tool-registry'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { startTtrpgOpenEpochV1, closeTtrpgOpenStageV1, recordTtrpgOpenHumanNarrationV1, recordTtrpgOpenNarrativeMemoryV1, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { readProductRuntimeState, branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { createContextGatewayToolSessionV1 } from '../../src/lib/context-gateway/tool-session'
import { createContextAccessPolicyForExecutionV1 } from '../../src/lib/context-gateway/skill-policy'
import type { FrozenResourceScopeV1 } from '../../src/lib/registry/types'

const provider = createTtrpgOpenBriefContextProviderV1()
async function setup(enabled = true) {
  const f = await readyOpenTtrpgSessionV1('Stage recap context', p => { p.ttrpg!.campaign.runtimePolicy.enabled = enabled; p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000 })
  return { f, input: { scope: f.scope, sessionId: f.sessionId, actorKey: 'gm' }, scope: { ...f.scope, productRuntimeSessionId: f.sessionId, runtimeActorKey: 'gm' } }
}
async function readAll(scope: FrozenResourceScopeV1) {
  const snapshot = await provider.openReadSession!(scope), page = await snapshot.provider.listMetadata({ scope, limit: 1000 })
  const bodies = await Promise.all(page.items.map(async d => JSON.parse((await snapshot.provider.read({ scope, resourceKey: d.resourceKey, depth: 'full', maxTokens: 16000 })).content)))
  await snapshot.assertCurrent()
  return { page, bodies }
}
describe('R-TTRPGOPEN8 stage recap source foundation', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('freezes the actual current tool declaration and registers the source without granting an existing Skill new authority', async () => {
    expect(await hashCanonicalValue(getAgentToolSchemaSnapshotV1())).toBe(AGENT_TOOL_SCHEMA_HASH_V1)
    expect(CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenBriefInput')!.resources!.providerId).toBe('storyforge.ttrpgOpenBriefInput')
    for (const id of ['prose.ttrpg-open-intent', 'prose.ttrpg-open-kp', 'prose.ttrpg-open-oracle-interpret']) expect(getAgentSkillV1(id).contextSourceKeys).not.toContain('ttrpgOpenBriefInput')
  })
  it('reads a real stage without inventing a KP operation and never exposes trusted state or private profiles', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.f.sessionId)
    await expect(loadTtrpgOpenKpContextV1(f.input)).rejects.toThrow(/实际结算/)
    const context = await loadTtrpgOpenBriefContextV1(f.input), result = await readAll(f.scope)
    expect(context).not.toHaveProperty('loaded')
    expect(context.frame.stage.status).toBe('open')
    expect(result.page.items.filter(d => d.priority === 'must-read')).toHaveLength(2)
    expect(context.entries.some(e => e.kind === 'release-observation' && e.reliability === 'release-time')).toBe(true)
    const text = JSON.stringify(result)
    for (const hidden of ['曾经离开港口', '害怕洪水', 'viewerKey', 'characterSheet', 'frozenContent', 'ruleReceipts', 'runtimeHeadStateJson":', 'open.foundation.seed']) expect(text).not.toContain(hidden)
    expect(await db.agentRuns.count()).toBe(0)
    expect(await readProductRuntimeState(f.f.sessionId)).toEqual(before)
  })
  it('keeps semantic recap bytes stable across actual request bookkeeping while moving the read evidence', async () => {
    const f = await setup(), before = await readAll(f.scope), rawInput = '调查河港'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.f.sessionId, 'brief.stamp.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput })
    await prepareTtrpgOpenIntentInputV1({ ...await openEnvelopeV1(f.f.sessionId, 'brief.stamp.request'), scope: f.f.scope, actorKey: 'hero', viewerKey: OPEN_HUMAN_VIEWER,
      rawInput, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    const after = await readAll(f.scope)
    expect(after.bodies).toEqual(before.bodies)
    expect(after.page.scopeFingerprint).not.toBe(before.page.scopeFingerprint)
    expect(after.page.items[0].sourceRefs.find(r => r.table === 'productRuntimeSessions')!.revision).toBeGreaterThan(before.page.items[0].sourceRefs.find(r => r.table === 'productRuntimeSessions')!.revision as number)
  })
  it('excludes a genuinely private discovery from metadata and every party recap entry', async () => {
    const f = await setupChecksFixtureV1({ ai: true, privateDiscovery: true })
    const input = { scope: f.f.scope, sessionId: f.f.sessionId, actorKey: 'gm' }
    const hero = await loadTtrpgOpenPlayerContextV1({ ...input, actorKey: 'hero' })
    expect(hero.view.knowledge.length).toBeGreaterThan(0)
    const recap = await loadTtrpgOpenBriefContextV1(input)
    const privateRefs = hero.view.knowledge.map(k => k.evidenceRef)
    expect(recap.entries.filter(e => e.kind === 'known-evidence').some(e => privateRefs.includes((e.value as { evidenceRef: string }).evidenceRef))).toBe(false)
  })
  it('retains human narration as attributed prose after the real owner finishes, without upgrading it to a fact', async () => {
    const f = await setupChecksFixtureV1({ ai: true }); await resumeTtrpgOpenPlayV1(f.command)
    const event = await recordTtrpgOpenHumanNarrationV1({ ...await operationInput(f.f.sessionId, f.command.operationKey, 'narration'), reason: 'host-authored', text: '大家在港边再次确认了调查经过。' })
    await resumeTtrpgOpenPlayV1(f.command)
    const context = await loadTtrpgOpenBriefContextV1({ scope: f.f.scope, sessionId: f.f.sessionId, actorKey: 'gm' })
    expect(context.entries.find(e => e.kind === 'retained-narration')).toMatchObject({ observerKey: 'gm', reliability: 'narrated', value: {
      sourceRef: { sequence: event.sequence }, origin: 'human-authored', paragraphs: ['大家在港边再次确认了调查经过。'], noMechanicalAuthority: true, noKnowledgeGrant: true } })
    const result = await readAll({ ...f.f.scope, productRuntimeSessionId: f.f.sessionId, runtimeActorKey: 'gm' })
    expect(result.page.items.find(d => d.resourceKey.includes('.narration.'))!.authority).toBe('derived-summary')
    expect(JSON.stringify(result)).not.toContain('viewerKey')
  })
  it('reads the public closed-stage frame while excluding the actual GM-only closure summary and completion plans', async () => {
    const f = await setupChecksFixtureV1({ ai: true, closure: true })
    await resumeTtrpgOpenChecksV1(f.command)
    await closeTtrpgOpenStageV1({ ...await operationInput(f.f.sessionId, f.command.operationKey, 'stage.close'), summary: 'GM-CLOSURE-SECRET' })
    const context = await loadTtrpgOpenBriefContextV1({ scope: f.f.scope, sessionId: f.f.sessionId, actorKey: 'gm' })
    expect(context.frame.stage.status).toBe('closed')
    expect(JSON.stringify(context)).not.toContain('GM-CLOSURE-SECRET')
    expect(JSON.stringify(context)).not.toContain('frozenContent')
  })
  it.each([false, true])('shares the exact party memory read stamp and frozen Gateway session, narration pending=%s', async pending => {
    const input = pending ? await (async () => { const f = await setupChecksFixtureV1({ ai: true }); await resumeTtrpgOpenChecksV1(f.command); return { ...f.f.scope, productRuntimeSessionId: f.f.sessionId, runtimeActorKey: 'gm' } })() : (await setup()).scope
    const memory = CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenPartyMemory')!.resources!
    const first = await provider.listMetadata({ scope: input, limit: 1000 }), second = await memory.listMetadata({ scope: input, limit: 1000 })
    expect(first.scopeFingerprint).toBe(second.scopeFingerprint)
    const policy = createContextAccessPolicyForExecutionV1(getAgentSkillV1('prose.ttrpg-open-kp'))
    const session = await createContextGatewayToolSessionV1({ scope: input, policy: { ...policy,
      allowedSourceKeys: ['ttrpgOpenBriefInput', 'ttrpgOpenPartyMemory'], mandatorySourceKeys: ['ttrpgOpenBriefInput', 'ttrpgOpenPartyMemory'] },
      allowedResourceKeys: [...first.items, ...second.items].map(d => d.resourceKey), freezeProviderReads: true })
    for (const guard of session.readSessionGuards ?? []) await guard()
  })
  it('rejects partial JSON/original reads, insufficient budget, wrong actor/workspace and missing model consent', async () => {
    const f = await setup(), page = await provider.listMetadata({ scope: f.scope, limit: 1000 }), key = page.items[0].resourceKey
    await expect(provider.read({ scope: f.scope, resourceKey: key, depth: 'full', maxTokens: 1 })).rejects.toThrow(/预算/)
    await expect(provider.read({ scope: f.scope, resourceKey: key, depth: 'summary', maxTokens: 16000 })).rejects.toThrow(/完整/)
    await expect(provider.readOriginal({ scope: f.scope, resourceKey: key, maxTokens: 16000 })).rejects.toThrow()
    await expect(provider.listMetadata({ scope: { ...f.scope, runtimeActorKey: 'hero' }, limit: 100 })).rejects.toThrow(/共同视图/)
    const disabled = await setup(false)
    await expect(provider.listMetadata({ scope: disabled.scope, limit: 100 })).rejects.toThrow(/模型/)
    await expect(provider.listMetadata({ scope: { ...disabled.scope, productRuntimeSessionId: f.f.sessionId }, limit: 100 })).rejects.toThrow()
  })
  it('invalidates an actual pinned stage view and its cursor when memory confirmation advances the real source', async () => {
    const f = await setup(), snapshot = await provider.openReadSession!(f.scope)
    const page = await provider.listMetadata({ scope: f.scope, limit: 1 })
    const e = await openEnvelopeV1(f.f.sessionId, 'brief.memory')
    await recordTtrpgOpenNarrativeMemoryV1({ ...e, viewerKey: OPEN_HUMAN_VIEWER,
      draft: { revisionKey: 'brief.memory', observerKey: 'hero', reliability: 'belief', audience: 'private', knownBy: ['hero'], summary: '私密变化不送给复盘', fromEventSequence: 1, toEventSequence: e.baseSequence } })
    await expect(snapshot.assertCurrent()).rejects.toThrow(/变化/)
    await expect(provider.listMetadata({ scope: f.scope, limit: 1, cursor: page.nextCursor! })).rejects.toThrow(/stale/)
    expect(JSON.stringify(await readAll(f.scope))).not.toContain('私密变化不送给复盘')
  })
  it('retains the recap source after branch authorization and full backup remapping without inheriting private host authority', async () => {
    const f = await setup()
    const child = await branchProductRuntimeSession({ parentSessionId: f.f.sessionId, throughSequence: (await readProductRuntimeState(f.f.sessionId)).lastSequence, title: 'Recap branch' })
    const state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'recap.child.zero'), viewerKey: OPEN_HUMAN_VIEWER,
      selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys })
    const before = await loadTtrpgOpenBriefContextV1({ ...f.input, sessionId: child.id! })
    const projectId = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId))
    const sessions = await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()
    const copy = sessions.find(row => JSON.parse(row.initialStateJson).ttrpg.sessionKey === before.readEvidence.sessionKey)!
    const scope = await resolveScope({ scope: { projectId, worldId: copy.worldId!, workId: copy.workId! } })
    const after = await loadTtrpgOpenBriefContextV1({ scope, sessionId: copy.id!, actorKey: 'gm' })
    expect(after.frame).toEqual(before.frame); expect(after.entries).toEqual(before.entries)
    expect(JSON.stringify(after)).not.toContain('viewerKey')
  })
})
