import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { ChatMessage } from '../../src/lib/types'
import { createSavedOpenDesignFixtureV1, openDesignResponseFixtureV1 } from '../helpers/ttrpg-open-design'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'
import { generateTtrpgOpenAuthoringDesignCandidateV1, composeTtrpgOpenAuthoringDesignV1,
  prepareTtrpgOpenAuthoringDesignSourceV1, ttrpgOpenDesignNeedsInitialFactsV1, parseTtrpgOpenAuthoringDesignRequestV1,
  recoverTtrpgOpenAuthoringDesignCandidateV1, readTtrpgOpenAuthoringDesignReviewV1 } from '../../src/lib/ttrpg/open-authoring-design'
import { verifyTtrpgOpenAuthoringSourceProvenanceV1 } from '../../src/lib/ttrpg/open-source-provenance'
import { renderTtrpgOpenDesignWorldReadsV1 } from '../../src/lib/ttrpg/open-authoring-design-prompt'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import * as skills from '../../src/lib/agent/skill-registry'
import * as artifacts from '../../src/lib/memory/artifact-store'

const sections = ['situationTemplates', 'openingSituationKeys', 'effectPlanTemplates', 'pressure']
async function fullResponse(messages: ChatMessage[]): Promise<string> {
  const keys = JSON.parse(messages[1].content.match(/【实际读取资源闭集】([^\n]+)/)![1]) as string[]
  // The response has only the exact messages, with no out-of-band descriptor
  // lookup that could conceal missing hashes or ambiguous body/key pairing.
  const delivered = JSON.parse(messages[1].content.split('【冻结世界实际读取】\n')[1])
  expect(delivered.schema).toBe('storyforge.ttrpg-open-design-world-reads')
  expect(delivered.resources.map((item: { resourceKey: string }) => item.resourceKey).sort()).toEqual(keys)
  const resource = delivered.resources.find((item: { depth: string }) => item.depth === 'full' || item.depth === 'original')!
  const fieldPath = Object.keys(JSON.parse(resource.readContent)).find(key => /^[A-Za-z][A-Za-z0-9_-]*$/.test(key))!
  expect(await sha256Text(resource.readContent)).toBe(resource.contentHash)
  const campaign = openCampaignFixture(), fact = { ...campaign.frozenWorldPredicateIndex.entries[0],
    sourceResourceRefs: [resource.resourceKey], sourceFieldRefs: [{ resourceKey: resource.resourceKey, fieldPath, contentHash: resource.contentHash }] }
  const map = (value: unknown): unknown => typeof value === 'string' ? value === 'world.harbor' ? resource.resourceKey : value
    : Array.isArray(value) ? value.map(map) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, map(child)])) : value
  return JSON.stringify({ schema: 'storyforge.ttrpg-open-authoring-design-proposals', version: 1,
    proposals: [0, 1, 2].map(index => ({ proposalKey: `full.${index}`, title: `不同压力方向${index}`, pitch: '完整五分区工程输入',
      patch: map({ situationTemplates: campaign.situationTemplates, openingSituationKeys: campaign.openingSituationKeys,
        effectPlanTemplates: campaign.effectPlanTemplates,
        pressure: { clocks: campaign.clocks.map(clock => ({ ...clock, maximum: 12 + index * 2 })), fronts: campaign.fronts }, factProposals: [fact] }) })) })
}

describe('R-TTRPGOPEN2 initial design fact dependency and pre-dispatch capacity', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
  async function rows() { return JSON.stringify(await Promise.all([db.ttrpgAuthoringDrafts.toArray(), db.worldReleases.toArray(), db.works.toArray()])) }
  it('rejects a genuinely empty situation request without fact proposals before any Run, event, model call or author write', async () => {
    const f = await createSavedOpenDesignFixtureV1(), before = await rows(), runAI = vi.fn(async () => '')
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, request: { ...f.request, sections }, runAI })).rejects.toThrow('同时选择“新增世界事实”')
    expect(runAI).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(0); expect(await db.agentRunEvents.count()).toBe(0)
    expect(await rows()).toBe(before)
  })
  it('does not manufacture an initial-fact dependency for an existing designed draft or a draft already containing source facts', async () => {
    const f = await createSavedOpenDesignFixtureV1(), base = structuredClone(f.settings.openAuthoring)
    expect(ttrpgOpenDesignNeedsInitialFactsV1(base)).toBe(true)
    const campaign = openCampaignFixture()
    base.situationTemplates = campaign.situationTemplates
    expect(ttrpgOpenDesignNeedsInitialFactsV1(base)).toBe(false)
    base.situationTemplates = []; base.factPolicy = [{ fact: campaign.frozenWorldPredicateIndex.entries[0], authorConfirmed: false }]
    expect(ttrpgOpenDesignNeedsInitialFactsV1(base)).toBe(false)
    // A named basis does not confirm it or grant any runtime authority.
    expect(base.factPolicy[0].authorConfirmed).toBe(false)
  })
  it('uses the original client capacity calculation and rejects a known small window before transport or an unknown Run exists', async () => {
    const f = await createSavedOpenDesignFixtureV1(), before = await rows(), transport = vi.fn()
    vi.stubGlobal('fetch', transport)
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, aiConfig: {
      provider: 'codex', model: 'gpt-6.1-sol', apiKey: '', baseUrl: '/storyforge/local-codex/v1', temperature: 0.7,
      maxTokens: 0, contextWindow: 16000,
    } })).rejects.toThrow('输入预算不足以容纳完整设计请求')
    expect(transport).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(0); expect(await db.agentRunEvents.count()).toBe(0)
    expect(await rows()).toBe(before)
  })
  it('keeps all five requested sections and exact delivered source keys, returning only unconfirmed facts before explicit adoption', async () => {
    const f = await createSavedOpenDesignFixtureV1(), before = await rows()
    const prepared = await prepareTtrpgOpenAuthoringDesignSourceV1(f)
    const request = { ...f.request, sections: [...sections, 'factProposals'] }
    const runAI = vi.fn(fullResponse)
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, request, runAI })
    expect(candidate.artifact.status).toBe('ready'); expect(candidate.proposals!.proposals).toHaveLength(3); expect(runAI).toHaveBeenCalledOnce()
    const context = { request: parseTtrpgOpenAuthoringDesignRequestV1(request), base: f.settings.openAuthoring,
      readWorldResourceKeys: JSON.parse(runAI.mock.calls[0][0][1].content.match(/【实际读取资源闭集】([^\n]+)/)![1]) }
    const value = composeTtrpgOpenAuthoringDesignV1(candidate.proposals, Object.fromEntries(request.sections.map(key => [key, 'full.1'])), context)
    expect(value.factPolicy).toHaveLength(1); expect(value.factPolicy[0].authorConfirmed).toBe(false)
    expect(await verifyTtrpgOpenAuthoringSourceProvenanceV1({ sourcePlan: prepared.source.sourcePlan,
      facts: value.factPolicy.map(item => item.fact) })).toEqual(value.factPolicy[0].fact.sourceFieldRefs)
    expect(value.situationTemplates[0].driverBeliefs[0].factRef).toBe(value.factPolicy[0].fact.factKey)
    expect(value.companionPolicy).toEqual(f.settings.openAuthoring.companionPolicy)
    expect(value.runtimePolicy).toEqual(f.settings.openAuthoring.runtimePolicy)
    expect(await rows()).toBe(before); expect(await db.productProductions.count()).toBe(0); expect(await db.productBuilds.count()).toBe(0)
    const system = runAI.mock.calls[0][0][0].content
    expect(system).toContain('至少一条 factRef 必须非 null'); expect(system).toContain('不能用 world resource')
    expect(system).toContain('effects 与 alternatives 两个数组字段都必须保留，且严格二选一')
    expect(system).toContain('直接执行时 effects 有1–100项、alternatives=[]')
    expect(system).toContain('需要玩家选择时 effects=[]、alternatives 有2–20项')
    expect(system).toContain('不能只有一个备选，也不能两者都为空')
  })

  it.each([20045, 24001])('freezes the complete situation request at 24K and retains actual provider output %i under that exact contract', async outputTokens => {
    const f = await createSavedOpenDesignFixtureV1(), before = await rows()
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body))
      expect(body.max_tokens).toBe(24000)
      expect(body.messages[0].content).toContain('输出验收上限 24000 tokens')
      expect(body.messages[0].content).toContain('开放效果禁止 clock.advance 和 clue.discover')
      return new Response(JSON.stringify({ choices: [{ message: { content: await fullResponse(body.messages) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: outputTokens, total_tokens: 100 + outputTokens } }), { status: 200 })
    })
    vi.stubGlobal('fetch', transport)
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, request: { ...f.request, sections: [...sections, 'factProposals'] }, aiConfig: {
      provider: 'custom', model: 'fixture-model', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-only', temperature: 0.7, maxTokens: 16000, contextWindow: 131072,
    } })
    const snapshot = await readAgentRunV1(f.scope, candidate.runId)
    expect(snapshot.contract.budget).toMatchObject({ maxModelCalls: 1, maxAttemptsPerStep: 1, maxInputTokens: 64000, maxOutputTokens: 24000 })
    const base = getAgentSkillV1('ttrpg.open.authoring-design.v1'), full = getAgentSkillV1('ttrpg.open.authoring-design.full.v1')
    expect(full).toMatchObject({ contextSourceKeys: base.contextSourceKeys, optionalContextSourceKeys: [], readToolNames: [],
      writeTargets: base.writeTargets, inputPolicy: base.inputPolicy, contextGateway: base.contextGateway })
    expect(snapshot.contract.executionBindings?.[0]).toMatchObject({ skillId: full.id,
      formalEntry: { entryId: 'ttrpg.open.authoring-design.full' }, writeTargets: [{ table: 'ttrpgAuthoringDrafts', fields: ['settingsJson'], mode: 'author-confirmed' }] })
    expect(candidate.artifact.callEvidence[0]).toMatchObject({ usageSource: 'provider', outputTokens })
    expect(candidate.artifact.status).toBe(outputTokens <= 24000 ? 'ready' : 'blocked')
    expect(candidate.proposals?.proposals.length ?? 0).toBe(outputTokens <= 24000 ? 3 : 0)
    expect(await recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, runId: candidate.runId })).toEqual(candidate)
    expect(transport).toHaveBeenCalledOnce(); expect(await rows()).toBe(before)
    expect(await db.productProductions.count()).toBe(0); expect(await db.productBuilds.count()).toBe(0)
  })
  it('recovers a preserved 16K request from its original raw after an interrupted materialization, even when a full 24K profile is available', async () => {
    const f = await createSavedOpenDesignFixtureV1(), before = await rows()
    expect(getAgentSkillV1('ttrpg.open.authoring-design.v1').maxOutputTokens).toBe(16000)
    expect(getAgentSkillV1('ttrpg.open.authoring-design.full.v1').maxOutputTokens).toBe(24000)
    let raw = ''
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)); expect(body.max_tokens).toBe(16000)
      raw = openDesignResponseFixtureV1(body.messages)
      return new Response(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20045, total_tokens: 20145 } }), { status: 200 })
    })
    vi.stubGlobal('fetch', transport)
    const record = artifacts.recordAgentRunArtifactV1
    const interrupted = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
      if (input.artifactKind === 'source-snapshot' && input.content.includes('storyforge.ttrpg-open-authoring-design-candidate')) throw new Error('candidate-write-interrupted')
      return record(input)
    })
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, aiConfig: {
      provider: 'custom', model: 'fixture-model', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-only', temperature: 0.7, maxTokens: 24000, contextWindow: 131072,
    } })).rejects.toThrow('candidate-write-interrupted')
    interrupted.mockRestore()
    const original = (await db.agentRuns.toArray())[0], snapshot = await readAgentRunV1(f.scope, original.id)
    expect(snapshot.run.status).toBe('paused'); expect(snapshot.contract.budget.maxOutputTokens).toBe(16000)
    const candidate = await recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, runId: original.id })
    expect(candidate.artifact.status).toBe('blocked'); expect(candidate.proposals).toBeNull(); expect(candidate.artifact.originalText).toBe(raw)
    expect(candidate.artifact.issues[0].code).toBe('ttrpg-design-budget')
    expect(await artifacts.readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: candidate.rawResponseHash })).toBe(raw)
    expect((await readTtrpgOpenAuthoringDesignReviewV1({ scope: f.scope, runId: original.id })).maxOutputTokens).toBe(16000)
    expect((await recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, runId: original.id })).candidateHash).toBe(candidate.candidateHash)
    expect(transport).toHaveBeenCalledOnce(); expect(await rows()).toBe(before)
  })
  it.each(['rules.fail-forward', 'rules.open-checks'])('retains an invented rule reference as blocked under the new frozen protocol: %s', async badRule => {
    const f = await createSavedOpenDesignFixtureV1(), before = await rows()
    const runAI = vi.fn(async (messages: ChatMessage[]) => {
      const refs = JSON.parse(messages[1].content.match(/【本次可引用规则闭集】([^\n]+)/)![1]) as string[]
      expect(refs).not.toContain(badRule)
      const value = JSON.parse(await fullResponse(messages))
      value.proposals[0].patch.effectPlanTemplates[0].ruleRef = badRule
      return JSON.stringify(value)
    })
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, request: { ...f.request, sections: [...sections, 'factProposals'] }, runAI })
    expect(candidate.artifact.status).toBe('blocked'); expect(candidate.proposals).toBeNull()
    expect(candidate.artifact.issues[0].message).toContain('后果模板引用未冻结规则')
    expect(candidate.artifact.originalText).toContain(badRule)
    expect(await recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, runId: candidate.runId })).toEqual(candidate)
    expect(runAI).toHaveBeenCalledOnce(); expect(await rows()).toBe(before)
  })
  it('retains a legacy frozen prompt’s deferred rule validation after the live prompt changes, without replaying the model or rewriting its raw', async () => {
    const f = await createSavedOpenDesignFixtureV1(), before = await rows(), actualSkill = skills.getAgentSkillV1
    const legacy = vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
      const value = actualSkill(id)
      return id === 'ttrpg.open.authoring-design.v1' ? { ...value, promptVersion: 'ttrpg-open-authoring-design-v1' } : value
    })
    const runAI = vi.fn(async (messages: ChatMessage[]) => {
      const value = JSON.parse(openDesignResponseFixtureV1(messages))
      for (const item of value.proposals) item.patch.effectPlanTemplates = openCampaignFixture().effectPlanTemplates.map(plan => ({ ...plan, ruleRef: 'author.provisional.rule' }))
      return JSON.stringify(value)
    })
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, request: { ...f.request, sections: ['pressure', 'effectPlanTemplates'] }, runAI })
    legacy.mockRestore()
    expect(skills.getAgentSkillV1('ttrpg.open.authoring-design.v1').promptVersion).toBe('ttrpg-open-authoring-design-v3')
    expect(candidate.artifact.status).toBe('ready')
    const review = await readTtrpgOpenAuthoringDesignReviewV1({ scope: f.scope, runId: candidate.runId })
    expect(review.ruleRefs).toBeUndefined(); expect(review.maxOutputTokens).toBe(16000)
    expect(review.candidate).toEqual(candidate)
    expect((await recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, runId: candidate.runId })).candidateHash).toBe(candidate.candidateHash)
    expect(runAI).toHaveBeenCalledOnce(); expect(await rows()).toBe(before)
  })
  it('preserves a blocked frozen v2 full candidate after live v3 instructions change, with no automatic choice or second model call', async () => {
    const f = await createSavedOpenDesignFixtureV1(), before = await rows(), actual = skills.getAgentSkillV1
    const legacy = vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
      const value = actual(id)
      return id === 'ttrpg.open.authoring-design.full.v1' ? { ...value, promptVersion: 'ttrpg-open-authoring-design-v2' } : value
    })
    let raw = ''
    const runAI = vi.fn(async (messages: ChatMessage[]) => {
      const value = JSON.parse(await fullResponse(messages)), plan = value.proposals[0].patch.effectPlanTemplates[0]
      plan.alternatives = [{ alternativeKey: 'only-one', title: '只有一个附加备选', effects: structuredClone(plan.effects) }]
      raw = JSON.stringify(value); return raw
    })
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, request: { ...f.request, sections: [...sections, 'factProposals'] }, runAI })
    const snapshot = await readAgentRunV1(f.scope, candidate.runId)
    const originalRequest = await artifacts.readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'source-snapshot', contentHash: candidate.requestArtifactHash })
    expect(candidate.artifact.status).toBe('blocked'); expect(candidate.proposals).toBeNull()
    expect(candidate.artifact.issues[0].message).toContain('必须二选一')
    expect(JSON.parse(snapshot.contract.executionBindings![0].skillDefinitionJson).promptVersion).toBe('ttrpg-open-authoring-design-v2')
    legacy.mockRestore()
    expect(skills.getAgentSkillV1('ttrpg.open.authoring-design.full.v1').promptVersion).toBe('ttrpg-open-authoring-design-v3')
    const review = await readTtrpgOpenAuthoringDesignReviewV1({ scope: f.scope, runId: candidate.runId })
    expect(review.ruleRefs).toContain('standard'); expect(review.maxOutputTokens).toBe(24000)
    expect(review.candidate).toEqual(candidate); expect(review.candidate.artifact.originalText).toBe(raw)
    expect(await recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: f.scope, runId: candidate.runId })).toEqual(candidate)
    expect(await artifacts.readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'source-snapshot', contentHash: candidate.requestArtifactHash })).toBe(originalRequest)
    expect(runAI).toHaveBeenCalledOnce(); expect(await rows()).toBe(before)
    expect(await db.productProductions.count()).toBe(0); expect(await db.productBuilds.count()).toBe(0)
  })
  it('stops an unsupported prompt version before any Run, model attempt or canonical write instead of treating it as legacy', async () => {
    const f = await createSavedOpenDesignFixtureV1(), before = await rows(), actual = skills.getAgentSkillV1
    vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => ({ ...actual(id), promptVersion: 'ttrpg-open-authoring-design-v99' }))
    const runAI = vi.fn(async () => '')
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI })).rejects.toThrow('设计格式版本尚未支持')
    expect(runAI).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(0); expect(await db.agentRunEvents.count()).toBe(0)
    expect(await rows()).toBe(before)
  })
  async function worldReads() {
    const full = JSON.stringify({ title: '灯塔', detail: '完整来源字段' }), contentHash = await sha256Text(full)
    const sourceRefs = [{ table: 'worldReleases' as const, recordId: 1, field: 'records.location.1', revision: 'frozen-r1', contentHash }]
    const read = { resourceKey: 'world-release:release:entities:location:coordinate', sourceKey: 'worldRelease', reason: 'mandatory', depth: 'full' as const,
      revision: 'frozen-r1', contentHash, policyRevision: 1, policyHash: 'a'.repeat(64), sourceRefs, tokenCount: 20 }
    return { retrievalTrace: { mandatory: [read], autoSelected: [], agentReads: [] },
      sourceSnapshots: [{ sourceKey: 'worldRelease', resourceKey: read.resourceKey, sourceRefs, content: full }] }
  }
  it('pairs each exact full read with its original resource hash, while a summary keeps only its actual body and depth', async () => {
    const input = await worldReads(), full = input.sourceSnapshots[0].content
    const rendered = JSON.parse(await renderTtrpgOpenDesignWorldReadsV1(input)).resources[0]
    expect(rendered).toEqual({ resourceKey: input.retrievalTrace.mandatory[0].resourceKey, contentHash: await sha256Text(full), depth: 'full', readContent: full })
    const summary = { ...input, retrievalTrace: { ...input.retrievalTrace, mandatory: [{ ...input.retrievalTrace.mandatory[0], depth: 'summary' as const }] },
      sourceSnapshots: [{ ...input.sourceSnapshots[0], content: '仅提供灯塔摘要' }] }
    const partial = JSON.parse(await renderTtrpgOpenDesignWorldReadsV1(summary)).resources[0]
    expect(partial.depth).toBe('summary'); expect(partial.readContent).toBe('仅提供灯塔摘要')
    expect(partial.contentHash).toBe(rendered.contentHash); expect(partial.contentHash).not.toBe(await sha256Text(partial.readContent))
    expect(partial.readContent).not.toContain('完整来源字段')
  })
  it.each(['duplicate', 'missing', 'hash', 'truncated', 'source-ref'] as const)('refuses mismatched actual-read anchors before a request can be constructed: %s', async kind => {
    const input = await worldReads()
    if (kind === 'duplicate') input.sourceSnapshots.push(input.sourceSnapshots[0])
    if (kind === 'missing') input.sourceSnapshots = []
    if (kind === 'hash') input.retrievalTrace.mandatory[0].contentHash = 'f'.repeat(64)
    if (kind === 'truncated') input.sourceSnapshots[0].content = input.sourceSnapshots[0].content.slice(0, 10)
    if (kind === 'source-ref') input.sourceSnapshots[0].sourceRefs = [{ ...input.sourceSnapshots[0].sourceRefs[0], field: 'records.other.2' }]
    await expect(renderTtrpgOpenDesignWorldReadsV1(input)).rejects.toThrow('世界读取正文与逐资源来源锚点不一致')
  })
})
