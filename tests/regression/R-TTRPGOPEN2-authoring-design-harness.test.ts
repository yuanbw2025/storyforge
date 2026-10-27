import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { ChatMessage } from '../../src/lib/types'
import { createFreshOpenDraftFixtureV1 } from '../helpers/open-ttrpg-fresh-authoring'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'
import { saveTtrpgDraft, saveTtrpgSourceSelection } from '../../src/lib/ttrpg/authoring-service'
import { suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { generateTtrpgOpenAuthoringDesignCandidateV1, recoverTtrpgOpenAuthoringDesignCandidateV1,
  listTtrpgOpenAuthoringDesignRunsV1, readTtrpgOpenAuthoringDesignReviewV1, TTRPG_OPEN_DESIGN_STEP_V1 } from '../../src/lib/ttrpg/open-authoring-design-harness'
import { appendAgentRunEventV1, createAgentRunV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import * as artifactStore from '../../src/lib/memory/artifact-store'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

const request = { schema: 'storyforge.ttrpg-open-authoring-design-request', version: 1, instruction: '给港口调查提供三种不同压力节奏', sections: ['pressure'] }
async function fixture() {
  const f = await createFreshOpenDraftFixtureV1(), settings = structuredClone(f.settings)
  settings.openAuthoring = { ...settings.openAuthoring, factPolicy: [], situationTemplates: [], openingSituationKeys: [],
    effectPlanTemplates: [], pressure: { clocks: [], fronts: [] }, dynamicEntityTemplates: [] }
  let draft = await saveTtrpgDraft(f.scope, f.draft.revision, settings, '模型辅助设计的作者')
  const starts = await suggestProductStartingPoints({ scope: f.scope, worldReleaseId: draft.worldReleaseId! })
  const choice = starts.suggestions.find(item => item.recommendedProductTypes.includes('ttrpg'))!
  draft = await saveTtrpgSourceSelection(f.scope, draft.revision, choice.suggestionKey, starts.selectionDefaults[choice.suggestionKey])
  return { ...f, draft, revision: draft.revision, request }
}
function proposals(messages: ChatMessage[]) {
  const match = messages[1].content.match(/【实际读取资源闭集】([^\n]+)/)
  if (!match) throw new Error('missing actual read keys')
  const keys = JSON.parse(match[1]) as string[], campaign = openCampaignFixture()
  return JSON.stringify({ schema: 'storyforge.ttrpg-open-authoring-design-proposals', version: 1,
    proposals: [0, 1, 2].map(index => ({ proposalKey: `direction.${index}`, title: `方向${index}`, pitch: '依实际来源调整压力节奏',
      patch: { pressure: { clocks: campaign.clocks.map(clock => ({ ...structuredClone(clock), maximum: 12 + index * 2, sourceRefs: [keys[0]] })),
        fronts: campaign.fronts.map(front => ({ ...structuredClone(front), sourceRefs: [keys[0]] })) } } })) })
}
async function protectedRows() {
  return JSON.stringify(await Promise.all([db.works.toArray(), db.ttrpgAuthoringDrafts.toArray(), db.ttrpgRulePacks.toArray(), db.worldReleases.toArray()]))
}
describe('R-TTRPGOPEN2 durable actual-source author design candidates', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
  it('persists one exact raw answer before three CreativeArtifact proposals and recovers without sending or changing author data', async () => {
    const f = await fixture(), before = await protectedRows(), runAI = vi.fn(async (messages: ChatMessage[]) => proposals(messages))
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI })
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(candidate.artifact.status).toBe('ready'); expect(candidate.proposals?.proposals).toHaveLength(3)
    expect(candidate.artifact.callEvidence).toHaveLength(1); expect(candidate.artifact.repair).toBeNull()
    const snapshot = await readAgentRunV1(f.scope, candidate.runId)
    expect(snapshot.run.status).toBe('awaiting_confirmation')
    const rawIndex = snapshot.events.findIndex(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response')
    const candidateIndex = snapshot.events.findIndex(event => event.type === 'candidate.persisted')
    expect(rawIndex).toBeGreaterThan(0); expect(candidateIndex).toBeGreaterThan(rawIndex)
    expect(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: candidate.rawResponseHash })).toBe(runAI.mock.results[0] && await runAI.mock.results[0].value)
    const eventsBefore = await db.agentRunEvents.count()
    expect(await recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, runId: candidate.runId })).toEqual(candidate)
    expect(await db.agentRunEvents.count()).toBe(eventsBefore)
    expect(runAI).toHaveBeenCalledTimes(1); expect(await protectedRows()).toBe(before)
    expect(await db.productProductions.count()).toBe(0); expect(await db.productBuilds.count()).toBe(0)
  })
  it('retains malformed output as a blocked artifact without retry or authority to update the draft', async () => {
    const f = await fixture(), before = await protectedRows(), runAI = vi.fn(async () => 'not valid JSON — original answer')
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI })
    expect(candidate.proposals).toBeNull(); expect(candidate.artifact.status).toBe('blocked')
    expect(candidate.artifact.originalText).toBe('not valid JSON — original answer')
    expect(candidate.artifact.issues[0].code).toBe('ttrpg-design-protocol')
    expect(runAI).toHaveBeenCalledTimes(1); expect(await protectedRows()).toBe(before)
  })
  it('keeps an unknown dispatched request paused and refuses recovery or a second automatic send', async () => {
    const f = await fixture(), runAI = vi.fn(async () => { throw new Error('connection lost after sending') })
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI })).rejects.toThrow('connection lost')
    const [run] = await listTtrpgOpenAuthoringDesignRunsV1(f.scope)
    expect(run.status).toBe('paused')
    await expect(recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, runId: run.id })).rejects.toThrow('不会发起模型请求')
    const second = vi.fn(async (messages: ChatMessage[]) => proposals(messages))
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI: second })).rejects.toThrow('另一份设计请求')
    expect(runAI).toHaveBeenCalledTimes(1); expect(second).not.toHaveBeenCalled()
  })
  it('recovers the retained raw answer after a metadata-write failure without a second provider call', async () => {
    const f = await fixture(), runAI = vi.fn(async (messages: ChatMessage[]) => proposals(messages))
    const real = artifactStore.recordAgentRunArtifactV1
    const storeSpy = vi.spyOn(artifactStore, 'recordAgentRunArtifactV1').mockImplementation(async input => {
      if (input.artifactKind === 'source-snapshot' && input.content.includes('storyforge.ttrpg-open-design-response-metadata')) {
        throw new Error('injected metadata storage failure')
      }
      return real(input)
    })
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI })).rejects.toThrow('metadata storage failure')
    expect(runAI).toHaveBeenCalledTimes(1)
    storeSpy.mockRestore()
    const [run] = await listTtrpgOpenAuthoringDesignRunsV1(f.scope)
    const candidate = await recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, runId: run.id })
    expect(candidate.artifact.status).toBe('ready'); expect(candidate.artifact.callEvidence[0].latencyMs).toBeNull()
    expect(runAI).toHaveBeenCalledTimes(1)
    expect((await readAgentRunV1(f.scope, run.id)).events.filter(event => event.type === 'model.requested')).toHaveLength(1)
  })
  it('allows only the earlier native Run to send when two requests overlap', async () => {
    const f = await fixture()
    let release!: () => void, entered!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve }), dispatched = new Promise<void>(resolve => { entered = resolve })
    const first = vi.fn(async (messages: ChatMessage[]) => { entered(); await waiting; return proposals(messages) })
    const second = vi.fn(async (messages: ChatMessage[]) => proposals(messages))
    const pending = generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI: first })
    await dispatched
    try {
      await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI: second })).rejects.toThrow('另一份设计请求')
    } finally { release() }
    const candidate = await pending
    expect(candidate.artifact.status).toBe('ready')
    expect(first).toHaveBeenCalledTimes(1); expect(second).not.toHaveBeenCalled()
    expect((await db.agentRunEvents.toArray()).filter(event => event.type === 'model.requested')).toHaveLength(1)
  })
  it('uses the frozen formal entry and one real client transport attempt, retaining an explicit non-retried HTTP denial', async () => {
    const f = await fixture(), before = await protectedRows()
    const transport = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'fixture unauthorized' } }), { status: 401 }))
    vi.stubGlobal('fetch', transport)
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, aiConfig: {
      provider: 'custom', model: 'fixture-model', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-only',
      temperature: 0.7, maxTokens: 16_000, contextWindow: 131_072,
    } })).rejects.toThrow()
    expect(transport).toHaveBeenCalledTimes(1)
    const [run] = await listTtrpgOpenAuthoringDesignRunsV1(f.scope), snapshot = await readAgentRunV1(f.scope, run.id)
    expect(snapshot.run.status).toBe('failed')
    expect(snapshot.contract.executionBindings?.[0]).toMatchObject({ version: 2, skillId: 'ttrpg.open.authoring-design.v1',
      formalEntry: { entryId: 'ttrpg.open.authoring-design' } })
    expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(await protectedRows()).toBe(before)
  })
  it('keeps the original review basis after an author save and refuses another Work or an explicitly staled candidate', async () => {
    const f = await fixture(), runAI = vi.fn(async (messages: ChatMessage[]) => proposals(messages))
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI })
    expect((await readTtrpgOpenAuthoringDesignReviewV1({ scope: f.scope, runId: candidate.runId })).current).toBe(true)
    const settings = JSON.parse(f.draft.settingsJson); settings.openingSituation = '作者已经在另一个窗口调整了开场'
    await saveTtrpgDraft(f.scope, f.revision, settings, '作者的新标题')
    const review = await readTtrpgOpenAuthoringDesignReviewV1({ scope: f.scope, runId: candidate.runId })
    expect(review.current).toBe(false); expect(review.source.revision).toBe(f.revision)
    expect(review.source.settings.openingSituation).not.toBe(settings.openingSituation)
    const foreign = await fixture()
    await expect(readTtrpgOpenAuthoringDesignReviewV1({ scope: foreign.scope, runId: candidate.runId })).rejects.toThrow()
    const snapshot = await readAgentRunV1(f.scope, candidate.runId)
    await appendAgentRunEventV1({ scope: f.scope, runId: candidate.runId, type: 'candidate.staled',
      payload: { stepId: TTRPG_OPEN_DESIGN_STEP_V1, candidateHash: candidate.candidateHash, reason: 'explicit fixture stale' },
      expectedLastSequence: snapshot.projection.lastSequence })
    await expect(recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, runId: candidate.runId })).rejects.toThrow('已过期')
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('repairs a missing final checkpoint from the original candidate without repeating the raw request or candidate event', async () => {
    const f = await fixture(), runAI = vi.fn(async (messages: ChatMessage[]) => proposals(messages))
    const original = checkpoints.createAgentRunCheckpointV1
    const checkpointSpy = vi.spyOn(checkpoints, 'createAgentRunCheckpointV1').mockImplementation(async input => {
      if ((input.resumePayload as { schema?: string })?.schema === 'storyforge.ttrpg-open-design-checkpoint') throw new Error('injected final checkpoint failure')
      return original(input)
    })
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI })).rejects.toThrow('final checkpoint failure')
    checkpointSpy.mockRestore()
    const [run] = await listTtrpgOpenAuthoringDesignRunsV1(f.scope)
    const candidate = await recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, runId: run.id })
    const restored = await checkpoints.readLatestVerifiedAgentRunCheckpointV1(f.scope, run.id)
    expect(restored?.resumePayload).toMatchObject({ candidateHash: candidate.candidateHash })
    const snapshot = await readAgentRunV1(f.scope, run.id)
    expect(snapshot.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
    expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('refuses a modified raw body even when its old candidate and checkpoint remain present', async () => {
    const f = await fixture(), runAI = vi.fn(async (messages: ChatMessage[]) => proposals(messages))
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI })
    const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([f.scope.projectId, 'raw-response', candidate.rawResponseHash]).first()
    await db.agentRunArtifacts.update(row!.id!, { content: 'changed bytes' })
    await expect(recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, runId: candidate.runId })).rejects.toThrow()
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('retains an over-budget provider response as blocked with actual usage and no retry', async () => {
    const f = await fixture()
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const messages = JSON.parse(String(init!.body)).messages as ChatMessage[]
      return new Response(JSON.stringify({ choices: [{ message: { content: proposals(messages) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 16001, total_tokens: 16101 } }), { status: 200 })
    })
    vi.stubGlobal('fetch', transport)
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, aiConfig: {
      provider: 'custom', model: 'fixture-model', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-only', temperature: 0.7, maxTokens: 16000, contextWindow: 131072,
    } })
    expect(candidate.artifact.status).toBe('blocked'); expect(candidate.proposals).toBeNull()
    expect(candidate.artifact.issues[0].code).toBe('ttrpg-design-budget')
    expect(candidate.artifact.callEvidence[0]).toMatchObject({ usageSource: 'provider', outputTokens: 16001 })
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('does not treat an unrelated pending audit that quotes the Skill name as an author design request', async () => {
    const f = await fixture()
    await createAgentRunV1({ scope: f.scope, worldGroupId: null, contract: { version: 1,
      objective: '只读审计提及 ttrpg.open.authoring-design.v1，不是设计请求', workflowKind: 'read-only-audit',
      runtimeBindingHash: await hashCanonicalValue({ purpose: 'unrelated-read-only-audit-fixture', scope: f.scope, revision: f.revision }),
      scope: { projectId: f.scope.projectId, worldGroupId: null }, permissions: { contextSourceKeys: ['worldRelease'], writeTargets: [] },
      budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1000, maxOutputTokens: 1000, maxAttemptsPerStep: 1 },
      acceptance: [{ id: 'manual.read', kind: 'deterministic-check', required: true }],
      verificationPlan: [{ id: 'manual.terminal', kind: 'terminal', verifier: 'manual.fixture', criterionIds: ['manual.read'] }],
      failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
    } })
    const runAI = vi.fn(async (messages: ChatMessage[]) => proposals(messages))
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI })
    expect(candidate.artifact.status).toBe('ready'); expect(runAI).toHaveBeenCalledTimes(1)
    expect(await listTtrpgOpenAuthoringDesignRunsV1(f.scope)).toHaveLength(1)
    expect(await db.agentRuns.count()).toBe(2)
  })
})
