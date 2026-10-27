import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import { generateTtrpgOpenAuthoringDesignCandidateV1 } from '../../src/lib/ttrpg/open-authoring-design-harness'
import { adoptTtrpgOpenAuthoringDesignV1, reconcileTtrpgOpenAuthoringDesignAdoptionV1,
  dismissTtrpgOpenAuthoringDesignRequestV1 } from '../../src/lib/ttrpg/open-authoring-design-adoption'
import { readTtrpgDraft, saveTtrpgDraft } from '../../src/lib/ttrpg/authoring-service'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { createSavedOpenDesignFixtureV1, openDesignResponseFixtureV1 } from '../helpers/ttrpg-open-design'
import * as authoring from '../../src/lib/ttrpg/authoring-service'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as bindings from '../../src/lib/agent/execution-binding'
import * as entries from '../../src/lib/agent/formal-ai-entry'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import * as runs from '../../src/lib/agent/run/event-store'
import { prepareTtrpgOpenAuthoringDesignSourceV1 } from '../../src/lib/ttrpg/open-authoring-design-source'
import { resolveProductSourceReadBoundaryV1 } from '../../src/lib/product/source-contracts'
import { listWorldSemanticResourceDescriptorsV1, readWorldSemanticResourcesV1 } from '../../src/lib/context-gateway/world-release-client'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

async function fixture() {
  const f = await createSavedOpenDesignFixtureV1(), runAI = vi.fn(async (messages: Parameters<typeof openDesignResponseFixtureV1>[0]) => openDesignResponseFixtureV1(messages))
  const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI })
  const input = { scope: f.scope, runId: candidate.runId, candidateHash: candidate.candidateHash,
    selection: { pressure: 'design.1' }, confirmedFactKeys: [], confirmation: 'confirm-design-selection-v1' as const }
  return { ...f, candidate, input, runAI }
}
async function protectedRows() { return JSON.stringify(await Promise.all([db.works.toArray(), db.ttrpgAuthoringDrafts.toArray(), db.ttrpgRulePacks.toArray(), db.worldReleases.toArray()])) }
describe('R-TTRPGOPEN2 governed author design adoption', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('writes only the explicitly selected draft through adopt and commits its Run/post-state/terminal receipt once', async () => {
    const f = await fixture(), world = JSON.stringify(await db.worldReleases.toArray()), rule = JSON.stringify(await db.ttrpgRulePacks.toArray())
    const result = await adoptTtrpgOpenAuthoringDesignV1(f.input), saved = await readTtrpgDraft(f.scope)
    expect(result.receiptPending).toBe(false); expect(result.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.revision).toBe(f.revision + 1)
    const settings = JSON.parse(saved.settingsJson), previous = JSON.parse(f.draft.settingsJson)
    expect(settings.openAuthoring.pressure.clocks[0].maximum).toBe(14)
    settings.openAuthoring.pressure = previous.openAuthoring.pressure
    expect(settings).toEqual(previous)
    expect((await db.works.get(f.scope.workId))!.title).toBe('作者保留的战役名称')
    expect(JSON.stringify(await db.worldReleases.toArray())).toBe(world); expect(JSON.stringify(await db.ttrpgRulePacks.toArray())).toBe(rule)
    const snapshot = await readAgentRunV1(f.scope, f.candidate.runId)
    expect(snapshot.run.status).toBe('completed')
    expect(snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
    expect(snapshot.events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(1)
    const again = await adoptTtrpgOpenAuthoringDesignV1(f.input)
    expect(again.adoption.adoptionHash).toBe(result.adoption.adoptionHash)
    expect((await readTtrpgDraft(f.scope)).revision).toBe(saved.revision)
    await expect(adoptTtrpgOpenAuthoringDesignV1({ ...f.input, selection: { pressure: 'design.2' } })).rejects.toThrow('重复写入')
    expect(f.runAI).toHaveBeenCalledTimes(1); expect(await db.productProductions.count()).toBe(0); expect(await db.productBuilds.count()).toBe(0)
  })
  it('rejects generic settings JSON, absent confirmation, unknown choices and unrelated fact confirmations without any author write', async () => {
    const f = await fixture(), before = await protectedRows()
    await expect(adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'ttrpgAuthoringDrafts', recordId: f.draft.id,
      mode: 'replace', data: { settingsJson: f.draft.settingsJson } })).rejects.toThrow('同一采纳事务')
    await expect(adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'ttrpgAuthoringDrafts', recordId: f.draft.id,
      mode: 'replace', preserveAuthorText: true, data: { settingsJson: f.draft.settingsJson } })).rejects.toThrow('精确文字编辑仅限已登记字段')
    await expect(adoptTtrpgOpenAuthoringDesignV1({ ...f.input, confirmation: 'unconfirmed' as never })).rejects.toThrow('明确确认')
    await expect(adoptTtrpgOpenAuthoringDesignV1({ ...f.input, selection: { pressure: 'missing' } })).rejects.toThrow('没有对应候选')
    await expect(adoptTtrpgOpenAuthoringDesignV1({ ...f.input, confirmedFactKeys: ['unselected.fact'] })).rejects.toThrow('新增事实')
    expect(await protectedRows()).toBe(before)
    expect((await readAgentRunV1(f.scope, f.candidate.runId)).run.status).toBe('awaiting_confirmation')
  })
  it('rejects changed source revisions and another Work without replacing newer author settings', async () => {
    const f = await fixture(), other = await createSavedOpenDesignFixtureV1()
    await expect(adoptTtrpgOpenAuthoringDesignV1({ ...f.input, scope: other.scope })).rejects.toThrow()
    const settings = JSON.parse(f.draft.settingsJson); settings.openingSituation = '另一窗口的人工作者修改'
    settings.wizard.savedRulePackId = f.draft.savedRulePackId
    await saveTtrpgDraft(f.scope, f.revision, settings, '作者最新名称')
    const before = await protectedRows()
    await expect(adoptTtrpgOpenAuthoringDesignV1(f.input)).rejects.toThrow('不可采纳')
    expect(await protectedRows()).toBe(before)
  })
  it('rolls back draft, Work metadata, author confirmation and adoption events when the delegated domain save fails', async () => {
    const f = await fixture(), before = await protectedRows(), real = authoring.saveTtrpgDraft
    const saveSpy = vi.spyOn(authoring, 'saveTtrpgDraft').mockImplementation(async (...args) => { await real(...args); throw new Error('injected after domain save') })
    await expect(adoptTtrpgOpenAuthoringDesignV1(f.input)).rejects.toThrow('injected after domain save')
    saveSpy.mockRestore()
    expect(await protectedRows()).toBe(before)
    const snapshot = await readAgentRunV1(f.scope, f.candidate.runId)
    expect(snapshot.run.status).toBe('awaiting_confirmation')
    expect(snapshot.events.some(event => event.type === 'confirmation.recorded' || event.type === 'adoption.committed')).toBe(false)
    expect((await adoptTtrpgOpenAuthoringDesignV1(f.input)).receiptPending).toBe(false)
  })
  it('repairs terminal evidence after an already committed adoption, preserving later human edits and the original target revision', async () => {
    const f = await fixture(), real = artifacts.recordAgentRunArtifactV1
    const storeSpy = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(input => {
      if (input.content.includes('storyforge.ttrpg-open-design-adoption-verification')) throw new Error('injected terminal storage failure')
      return real(input)
    })
    const result = await adoptTtrpgOpenAuthoringDesignV1(f.input)
    expect(result.receiptPending).toBe(true); expect(result.adoption.targetRevision).toBe(f.revision + 1)
    storeSpy.mockRestore()
    const saved = await readTtrpgDraft(f.scope), settings = JSON.parse(saved.settingsJson)
    settings.wizard.savedRulePackId = saved.savedRulePackId; settings.openingSituation = '采纳后作者的新内容'
    await saveTtrpgDraft(f.scope, saved.revision, settings, '采纳后的新标题')
    const beforeRepair = await protectedRows()
    const repaired = await reconcileTtrpgOpenAuthoringDesignAdoptionV1(f.input)
    expect(repaired.receiptPending).toBe(false)
    expect(repaired.adoption.adoptionHash).toBe(result.adoption.adoptionHash)
    expect(repaired.adoption.targetRevision).toBe(f.revision + 1)
    expect(await protectedRows()).toBe(beforeRepair); expect(f.runAI).toHaveBeenCalledTimes(1)
  })
  it('never grants an original readonly frozen Run write authority after the live registry enables adoption', async () => {
    const create = bindings.createAgentSkillExecutionBindingV2, freeze = entries.freezeFormalAIEntryBindingV1
    const bindingSpy = vi.spyOn(bindings, 'createAgentSkillExecutionBindingV2').mockImplementation((skill, input) =>
      skill.id === 'ttrpg.open.authoring-design.v1' ? create({ ...skill, writeTargets: [] }, { ...input, writeTargets: [] }) : create(skill, input))
    const entrySpy = vi.spyOn(entries, 'freezeFormalAIEntryBindingV1').mockImplementation(async id => {
      const value = await freeze(id)
      if (id !== 'ttrpg.open.authoring-design') return value
      const body = { ...JSON.parse(value.bindingJson), adoptAllowed: false, adoptionTargets: [] }
      return { ...value, bindingJson: JSON.stringify(body, Object.keys(body).sort()), bindingHash: await hashCanonicalValue(body) }
    })
    const f = await fixture(); bindingSpy.mockRestore(); entrySpy.mockRestore()
    const before = await protectedRows()
    await expect(adoptTtrpgOpenAuthoringDesignV1(f.input)).rejects.toThrow('旧设计只允许参考')
    expect(await protectedRows()).toBe(before)
  })
  it('rechecks the original row inside the atomic write when another author saves after proof preparation', async () => {
    const f = await fixture(), real = runs.withAgentRunMutationLockV1
    const lockSpy = vi.spyOn(runs, 'withAgentRunMutationLockV1').mockImplementationOnce(async (runId, mutation) => {
      const settings = structuredClone(f.settings); settings.openingSituation = '最后一刻另一位作者的目标'
      await saveTtrpgDraft(f.scope, f.revision, settings, '另一窗口的新标题')
      return real(runId, mutation)
    })
    await expect(adoptTtrpgOpenAuthoringDesignV1(f.input)).rejects.toThrow('原草稿或规则已变化')
    lockSpy.mockRestore()
    const saved = await readTtrpgDraft(f.scope)
    expect(saved.revision).toBe(f.revision + 1); expect(JSON.parse(saved.settingsJson).openingSituation).toBe('最后一刻另一位作者的目标')
    expect(JSON.parse(saved.settingsJson).openAuthoring.pressure.clocks).toEqual([])
    expect((await readAgentRunV1(f.scope, f.candidate.runId)).events.some(event => event.type === 'confirmation.recorded')).toBe(false)
  })
  it('concurrent identical confirmations create one draft revision and one adoption event', async () => {
    const f = await fixture()
    const results = await Promise.all([adoptTtrpgOpenAuthoringDesignV1(f.input), adoptTtrpgOpenAuthoringDesignV1(f.input)])
    expect(results[0].adoption.adoptionHash).toBe(results[1].adoption.adoptionHash)
    expect((await readTtrpgDraft(f.scope)).revision).toBe(f.revision + 1)
    expect((await readAgentRunV1(f.scope, f.candidate.runId)).events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
    expect((await reconcileTtrpgOpenAuthoringDesignAdoptionV1(f.input)).receiptPending).toBe(false)
  })
  it.each([{ confirm: true, badHash: false }, { confirm: false, badHash: false }, { confirm: true, badHash: true }])('checks selected fact provenance and explicit confirmation %j', async option => {
    const f = await createSavedOpenDesignFixtureV1(), prepared = await prepareTtrpgOpenAuthoringDesignSourceV1(f)
    const boundary = await resolveProductSourceReadBoundaryV1(prepared.source.sourcePlan)
    const descriptors = await listWorldSemanticResourceDescriptorsV1(boundary.sourceScope)
    const runAI = vi.fn(async (messages: Parameters<typeof openDesignResponseFixtureV1>[0]) => {
      const value = JSON.parse(openDesignResponseFixtureV1(messages)), key = value.proposals[0].patch.pressure.clocks[0].sourceRefs[0]
      const [resource] = await readWorldSemanticResourcesV1({ scope: boundary.sourceScope, descriptors: [descriptors.find(item => item.resourceKey === key)!] })
      const path = Object.keys(resource.value).find(field => /^[A-Za-z][A-Za-z0-9_-]*$/.test(field))!
      for (let index = 0; index < 3; index++) value.proposals[index].patch.factProposals = [{ ...structuredClone(openCampaignFixture().frozenWorldPredicateIndex.entries[0]),
        factKey: `fact.design.${index}`, sourceResourceRefs: [key], sourceFieldRefs: [{ resourceKey: key, fieldPath: path, contentHash: option.badHash ? 'f'.repeat(64) : resource.descriptor.contentHash }] }]
      return JSON.stringify(value)
    })
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, request: { ...f.request, sections: ['pressure', 'factProposals'] }, runAI })
    const input = { scope: f.scope, runId: candidate.runId, candidateHash: candidate.candidateHash, selection: { pressure: 'design.0', factProposals: 'design.1' },
      confirmedFactKeys: option.confirm ? ['fact.design.1'] : [], confirmation: 'confirm-design-selection-v1' as const }
    expect(candidate.artifact.status).toBe('ready')
    await expect(adoptTtrpgOpenAuthoringDesignV1({ ...input, confirmedFactKeys: ['fact.design.2'] })).rejects.toThrow('当前选中的新增事实')
    if (option.badHash) {
      const before = await protectedRows()
      await expect(adoptTtrpgOpenAuthoringDesignV1(input)).rejects.toThrow('来源缺失、hash 不一致')
      expect(await protectedRows()).toBe(before)
      return
    }
    expect((await adoptTtrpgOpenAuthoringDesignV1(input)).receiptPending).toBe(false)
    const saved = JSON.parse((await readTtrpgDraft(f.scope)).settingsJson).openAuthoring
    expect(saved.factPolicy.map((item: { fact: { factKey: string }; authorConfirmed: boolean }) => [item.fact.factKey, item.authorConfirmed])).toEqual([['fact.design.1', option.confirm]])
    expect(saved.pressure.clocks[0].maximum).toBe(12)
    expect(saved.runtimePolicy).toEqual(f.settings.openAuthoring.runtimePolicy)
  })
  it('requires explicit dismissal of a candidate and separate acknowledgement of an unknown paused request', async () => {
    const f = await fixture(), before = await protectedRows()
    expect(await dismissTtrpgOpenAuthoringDesignRequestV1({ scope: f.scope, runId: f.candidate.runId, confirmation: 'discard-design-request-v1' })).toBe('cancelled')
    expect(await protectedRows()).toBe(before)
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI: async () => { throw new Error('unknown original result') } })).rejects.toThrow('unknown original result')
    const pending = (await db.agentRuns.where('workId').equals(f.scope.workId).toArray()).find(row => row.status === 'paused')!
    await expect(dismissTtrpgOpenAuthoringDesignRequestV1({ scope: f.scope, runId: pending.id!, confirmation: 'discard-design-request-v1' })).rejects.toThrow('未知的等待')
    expect(await dismissTtrpgOpenAuthoringDesignRequestV1({ scope: f.scope, runId: pending.id!, confirmation: 'discard-design-request-v1', acknowledgeUnknown: true })).toBe('cancelled')
    expect(await protectedRows()).toBe(before)
  })
  it('backs up pending and adopted author data with exact raw evidence, while imported local candidates gain no automatic adoption authority', async () => {
    const f = await fixture()
    const pendingProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const pendingDraft = (await db.ttrpgAuthoringDrafts.where('projectId').equals(pendingProject).toArray())[0]
    const pendingRun = (await db.agentRuns.where('projectId').equals(pendingProject).toArray()).find(row => row.workId === pendingDraft.workId)!
    const copyScope = { projectId: pendingProject, worldId: pendingDraft.worldId, workId: pendingDraft.workId }
    expect(pendingDraft.settingsJson).toBe(f.draft.settingsJson)
    const raw = await artifacts.readAgentRunArtifactExactV1({ projectId: pendingProject, artifactKind: 'raw-response', contentHash: f.candidate.rawResponseHash })
    expect(raw).toBe(f.candidate.artifact.originalText)
    await expect(adoptTtrpgOpenAuthoringDesignV1({ ...f.input, scope: copyScope, runId: pendingRun.id! })).rejects.toThrow()
    expect((await readTtrpgDraft(copyScope)).settingsJson).toBe(pendingDraft.settingsJson)
    await adoptTtrpgOpenAuthoringDesignV1(f.input)
    const adoptedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const adoptedDraft = (await db.ttrpgAuthoringDrafts.where('projectId').equals(adoptedProject).toArray())[0]
    expect(JSON.parse(adoptedDraft.settingsJson).openAuthoring.pressure.clocks[0].maximum).toBe(14)
    expect(adoptedDraft.savedRulePackId).not.toBe(f.draft.savedRulePackId)
    expect((await db.ttrpgRulePacks.get(adoptedDraft.savedRulePackId!))!.workId).toBe(adoptedDraft.workId)
    expect(await artifacts.readAgentRunArtifactExactV1({ projectId: adoptedProject, artifactKind: 'raw-response', contentHash: f.candidate.rawResponseHash })).toBe(raw)
    expect(f.runAI).toHaveBeenCalledTimes(1)
  })
})
