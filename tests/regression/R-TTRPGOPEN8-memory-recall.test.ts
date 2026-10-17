import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { recordTtrpgOpenNarrativeMemoryV1, startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { prepareTtrpgOpenIntentInputV1, prepareTtrpgOpenCompanionInputV1, prepareTtrpgOpenKpInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { executeTtrpgOpenIntentRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { assertTtrpgOpenFrozenContextSourcesV1 } from '../../src/lib/ttrpg/open-model-purpose-contract'
import type { TtrpgOpenMemoryDraftV1 } from '../../src/lib/ttrpg/open-memory-contract'

const rawInput = '调查河港的迟到线索', modelIdentity = { provider: 'test-adapter', model: 'injected' }
const output = JSON.stringify({ goal: '调查河港', method: null, targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
async function note(sessionId: number, key: string, summary: string, audience: TtrpgOpenMemoryDraftV1['audience'] = 'private', knownBy = ['hero']) {
  const envelope = await openEnvelopeV1(sessionId, `record.${key}`)
  return recordTtrpgOpenNarrativeMemoryV1({ ...envelope, viewerKey: OPEN_HUMAN_VIEWER,
    draft: { revisionKey: key, observerKey: audience === 'gm-only' ? 'gm' : 'hero', reliability: 'belief', audience, knownBy,
      summary, fromEventSequence: 1, toEventSequence: envelope.baseSequence } })
}
async function setup() {
  return readyOpenTtrpgSessionV1('Formal memory recall', p => {
    p.ttrpg!.campaign.runtimePolicy.enabled = true
    p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
  })
}
async function start(sessionId: number) {
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, 'memory.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput })
}
describe('R-TTRPGOPEN8 actual formal memory recall', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('delivers complete actor memory via Gateway with reliability, source proof and exact retained one-send receipt', async () => {
    const f = await setup(), summary = '甲'.repeat(600) + '迟到线索：我怀疑旧港有人跟踪。'
    await note(f.sessionId, 'private-note', summary)
    await note(f.sessionId, 'gm-note', 'EXCLUDED-GM-MEMORY', 'gm-only', [])
    await start(f.sessionId)
    const prepared = await prepareTtrpgOpenIntentInputV1({ ...await openEnvelopeV1(f.sessionId, 'memory.prepare'), scope: f.scope, actorKey: 'hero',
      viewerKey: OPEN_HUMAN_VIEWER, rawInput, modelIdentity, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    const text = prepared.messages.map(m => m.content).join('\n')
    expect(text).toContain(summary); expect(text).not.toContain('EXCLUDED-GM-MEMORY')
    expect(text).toContain('"reliability":"belief"'); expect(text).toContain('"observerKey":"hero"')
    const selected = prepared.evidence.contextSelection!.selected.filter(r => r.sourceKey === 'ttrpgOpenMemory')
    expect(selected.some(r => r.tierKey === 'memory-summary')).toBe(true)
    const refs = prepared.evidence.preflight.artifacts.filter(r => r.role === 'source-snapshot' && r.sourceKey === 'ttrpgOpenMemory')
    expect(refs.length).toBeGreaterThan(1)
    const originalRows = await db.ttrpgNarrativeMemories.toArray(), before = await readProductRuntimeState(f.sessionId)
    let calls = 0
    const result = await executeTtrpgOpenIntentRequestV1({ scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER,
      runId: prepared.runId, requestKey: prepared.requestKey, runAI: async () => { calls++; return output } })
    expect(result.status).toBe('candidate'); expect(calls).toBe(1)
    const after = await readProductRuntimeState(f.sessionId)
    expect(after.entities).toEqual(before.entities)
    expect(after.ttrpg!.openRun!.knowledge).toEqual(before.ttrpg!.openRun!.knowledge)
    expect(await db.ttrpgNarrativeMemories.toArray()).toEqual(originalRows)
    expect(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: result.status === 'candidate' ? result.candidate.rawResponseHash : '' })).toBe(output)
    const snapshot = await readInstanceAgentRunV1(f.scope, prepared.runId)
    expect(snapshot.contract.permissions.contextSourceKeys).toEqual(['ttrpgOpenAuthority', 'ttrpgOpenKnowledge', 'ttrpgOpenActorContext', 'ttrpgOpenMemory', 'ttrpgOpenLearnedIdentities'])
  })
  it('gives the actual companion its explicitly shared belief and excludes the human owner private and GM notes', async () => {
    const f = await setup()
    await note(f.sessionId, 'hero-only', 'HERO-PRIVATE-MEMORY')
    await note(f.sessionId, 'shared', '迟到线索已明确分享给队友', 'private', ['hero', 'companion.1'])
    await note(f.sessionId, 'gm-only', 'GM-PRIVATE-MEMORY', 'gm-only', [])
    await start(f.sessionId)
    const prepared = await prepareTtrpgOpenCompanionInputV1({ ...await openEnvelopeV1(f.sessionId, 'companion.memory'), scope: f.scope, actorKey: 'companion.1',
      viewerKey: OPEN_HUMAN_VIEWER, rawInput, modelIdentity, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    const text = prepared.messages.map(m => m.content).join('\n')
    expect(text).toContain('迟到线索已明确分享给队友'); expect(text).toContain('"observerKey":"hero"')
    expect(text).not.toContain('HERO-PRIVATE-MEMORY'); expect(text).not.toContain('GM-PRIVATE-MEMORY')
  })
  it('recalls only the whole-party intersection in the actual KP request after real settlement', async () => {
    const f = await setupChecksFixtureV1({ ai: true }); await resumeTtrpgOpenChecksV1(f.command)
    await note(f.f.sessionId, 'subset', 'EXCLUDED-SUBSET-MEMORY', 'private', ['hero', 'companion.1'])
    await note(f.f.sessionId, 'shared-party', '大家已经听说旧港的调查经过', 'party', [])
    const prepared = await prepareTtrpgOpenKpInputV1({ ...await openEnvelopeV1(f.f.sessionId, 'kp.memory.prepare'), scope: f.f.scope,
      viewerKey: OPEN_HUMAN_VIEWER, rawInput, modelIdentity, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    const text = prepared.messages.map(m => m.content).join('\n')
    expect(text).toContain('大家已经听说旧港的调查经过'); expect(text).not.toContain('EXCLUDED-SUBSET-MEMORY')
    expect(prepared.evidence.manifest.sources.some(s => s.key === 'ttrpgOpenPartyMemory' && s.status === 'included')).toBe(true)
    expect(prepared.evidence.manifest.sources.some(s => s.key === 'ttrpgOpenMemory')).toBe(false)
  })
  it('omits an oversized optional note whole while retaining a smaller relevant note and protected rules', async () => {
    const f = await setup()
    await note(f.sessionId, 'huge', '很长'.repeat(7000) + 'OVERSIZED-END')
    await note(f.sessionId, 'small', '迟到线索来自旧港。')
    await start(f.sessionId)
    const prepared = await prepareTtrpgOpenIntentInputV1({ ...await openEnvelopeV1(f.sessionId, 'budget.memory'), scope: f.scope, actorKey: 'hero',
      viewerKey: OPEN_HUMAN_VIEWER, rawInput, modelIdentity, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    const text = prepared.messages.map(m => m.content).join('\n')
    expect(text).toContain('迟到线索来自旧港。'); expect(text).not.toContain('OVERSIZED-END'); expect(text).not.toContain('很长很长')
    expect(prepared.evidence.selector.selected.some(r => r.resourceKey.endsWith(':rules-core'))).toBe(true)
  })
  it('retrieves a middle historical note from its late body text under a budget that excludes most history', async () => {
    const f = await readyOpenTtrpgSessionV1('Relevant late memory', p => {
      p.ttrpg!.campaign.runtimePolicy.enabled = true
      p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
    })
    const relevant = '中'.repeat(700) + '迟到线索：旧港桥下的怀疑。'
    for (let i = 0; i < 7; i++) await note(f.sessionId, `history.${i}`, i === 3 ? relevant : '无关记录'.repeat(180) + `编号${i}`)
    await start(f.sessionId)
    const prepared = await prepareTtrpgOpenIntentInputV1({ ...await openEnvelopeV1(f.sessionId, 'relevant.memory'), scope: f.scope, actorKey: 'hero',
      viewerKey: OPEN_HUMAN_VIEWER, rawInput, modelIdentity, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    expect(prepared.messages.map(m => m.content).join('\n')).toContain(relevant)
    const memories = prepared.evidence.contextSelection!.selected.filter(r => r.sourceKey === 'ttrpgOpenMemory' && r.tierKey === 'memory-summary')
    expect(memories.length).toBeLessThan(7)
  })
  it('finishes a real pre-memory P7 prepared request with its original frozen Skill and no added memory grant', async () => {
    const legacy = JSON.parse(gunzipSync(readFileSync('tests/fixtures/ttrpg-open-pre-memory-prepared-v1.json.gz')).toString())
    // Same persisted IDs simulate an application update. Backup import deliberately has stricter historical-only recovery.
    expect(legacy.format).toBe('same-id-isolated-db')
    await db.transaction('rw', db.tables, async () => {
      for (const [name, rows] of Object.entries(legacy.tables)) if ((rows as unknown[]).length) await db.table(name).bulkAdd(rows as any[])
    })
    const session = (await db.productRuntimeSessions.get(legacy.sessionId))!, scope = legacy.scope
    const call = (await readProductRuntimeState(session.id!)).ttrpg!.openRun!.coordination.calls[0]
    const run = (await db.agentRuns.where('projectId').equals(scope.projectId).toArray()).find(run => run.contractHash === call.runContractHash)!
    const result = await executeTtrpgOpenIntentRequestV1({ scope, sessionId: session.id!, viewerKey: OPEN_HUMAN_VIEWER, runId: run.id!, requestKey: call.requestKey, runAI: async () => output })
    expect(result.status).toBe('candidate')
    expect((await readInstanceAgentRunV1(scope, run.id!)).contract.permissions.contextSourceKeys).toEqual(['ttrpgOpenAuthority', 'ttrpgOpenKnowledge', 'ttrpgOpenActorContext'])
    expect(call.requestKey).toBe(legacy.requestKey)
  })
  it('accepts the exact new generation while rejecting memory grants for GM Oracle and cross-consumer sources', () => {
    const base = ['ttrpgOpenAuthority', 'ttrpgOpenKnowledge', 'ttrpgOpenActorContext']
    expect(assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-intent', [...base, 'ttrpgOpenMemory'])).toHaveLength(4)
    expect(() => assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-intent', [...base, 'ttrpgOpenPartyMemory'])).toThrow()
    expect(() => assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-oracle-interpret', ['ttrpgOpenGmOracleInput', 'ttrpgOpenGmContext', 'ttrpgOpenPartyMemory'])).toThrow()
  })
})
