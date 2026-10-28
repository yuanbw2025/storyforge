import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import { acceptedAvgSoundArtifactV1, adoptAvgSoundArtifactV1, adoptAvgSoundSourcesV1, avgSoundHarnessFixtureV1, cycleAvgSoundUntilV1,
  stageAvgSoundArtifactV1, confirmAvgSoundCandidateV1 } from '../helpers/avg-sound-harness-fixture'
import { readAvgSoundProposalEvidenceV1 } from '../../src/lib/avg/sound-planning-evidence'
import { readAvgConfirmedSoundPlanV1 } from '../../src/lib/avg/author-artifacts'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { compileAvgSoundRequirementsV1 } from '../../src/lib/avg/sound-requirements'
import { verifyAcceptedProductBuildArtifactV1 } from '../../src/lib/product-production/artifact-store'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: 'test-only-intercepted-no-external-network',
    model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unconfigured request forbidden') }))
  // Only an isolated feature fence. Every domain author/start/Run/producer
  // permission below is created by actual commands, never mocked or seeded.
  vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

describe('AVG sound actual command/Harness/model proposal/author compilation path', () => {
  it('calls configured HTTP only after source adoption, retains exact raw evidence, independently adopts edits and compiles the actual selected plan', async () => {
    const s = await avgSoundHarnessFixtureV1()
    expect(s.calls).toHaveLength(0)
    await adoptAvgSoundSourcesV1(s); await cycleAvgSoundUntilV1(s, 'avg.proposal.sound-plan')
    expect(s.calls).toHaveLength(1)
    const original = (await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan'))!, proof = await readAvgSoundProposalEvidenceV1(s.scope, original)
    expect(proof.rawText).toBe(s.output); expect(proof.binding.provider).toBe('agnes'); expect(proof.binding.model).toBe('agnes-2.5-flash')
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.media.sound-plan')).toBeUndefined()
    const edited = structuredClone(s.author.plan); edited.direction.dialogueSpace = '作者修改：对白期间保持空间和低密度织体'
    const candidate = await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', edited)
    expect(JSON.parse(candidate.metadataJson)).toMatchObject({ version: 8, origin: 'model-proposal', soundProposalValidation: {
      authorEdited: true, proposal: { artifactKey: original.artifactKey, contentHash: original.contentHash } } })
    await cycleAvgSoundUntilV1(s, 'avg.media.compiled-sound-requirements')
    const compiled = (await acceptedAvgSoundArtifactV1(s, 'avg.media.compiled-sound-requirements'))!
    expect(JSON.parse(compiled.payloadJson)).toEqual(await compileAvgSoundRequirementsV1(s.brief.avgSoundPlanning!.scope, edited))
    const build = (await db.productBuilds.get(s.buildId))!
    expect((await readAvgConfirmedSoundPlanV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch })).payload).toEqual(edited)
    expect(s.calls).toHaveLength(1); expect(s.calls[0].packet).not.toHaveProperty('scripts')
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm')).toBeUndefined()
    await expect(stageAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan)).rejects.toThrow(/已被下游执行消费/)
  }, 60_000)

  it('retains a malformed original response and bounded usage without inventing a proposal or replaying on another cycle', async () => {
    const s = await avgSoundHarnessFixtureV1({ malformed: true }); await adoptAvgSoundSourcesV1(s)
    for (let i = 0; i < 5; i++) await runProductProductionSchedulerCycleV1(s)
    expect(s.calls).toHaveLength(1); expect(await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan')).toBeUndefined()
    const artifacts = await db.agentRunArtifacts.where('projectId').equals(s.scope.projectId).toArray()
    expect(artifacts.some(r => r.artifactKind === 'raw-response')).toBe(true)
    expect(JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks['avg.sound.propose.plan'].usage).toMatchObject({ modelCalls: 1, mediaCalls: 0, costUsd: null })
    await runProductProductionSchedulerCycleV1(s); expect(s.calls).toHaveLength(1)
  }, 60_000)

  it('refuses an author plan with an unauthorized source and detects a changed original proposal before author confirmation', async () => {
    const s = await avgSoundHarnessFixtureV1(); await adoptAvgSoundSourcesV1(s); await cycleAvgSoundUntilV1(s, 'avg.proposal.sound-plan')
    const wrong = structuredClone(s.author.plan); wrong.entries[1].librarySourceKey = 'unapproved.source'
    await expect(stageAvgSoundArtifactV1(s, 'avg.media.sound-plan', wrong)).rejects.toThrow(/允许/)
    const pending = await stageAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan)
    const original = (await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan'))!
    await db.productBuildArtifacts.update(original.id!, { payloadJson: original.payloadJson.replace('静谧', '损坏') })
    const result = await confirmAvgSoundCandidateV1(s, pending)
    expect(result.ok).toBe(false); expect(await acceptedAvgSoundArtifactV1(s, 'avg.media.sound-plan')).toBeUndefined(); expect(s.calls).toHaveLength(1)
  }, 60_000)

  it('verifies original sealed proposal and compiled producers, then refuses damaged raw-response bytes without a replacement call', async () => {
    const s = await avgSoundHarnessFixtureV1(); await adoptAvgSoundSourcesV1(s); await cycleAvgSoundUntilV1(s, 'avg.proposal.sound-plan')
    await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan); await cycleAvgSoundUntilV1(s, 'avg.media.compiled-sound-requirements')
    const original = (await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan'))!, compiled = (await acceptedAvgSoundArtifactV1(s, 'avg.media.compiled-sound-requirements'))!
    for (const row of [original, compiled]) await expect(verifyAcceptedProductBuildArtifactV1({ scope: s.scope, buildId: s.buildId,
      artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })).resolves.toMatchObject({ id: row.id })
    const proof = await readAvgSoundProposalEvidenceV1(s.scope, original)
    const raw = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.scope.projectId, 'raw-response', String(proof.quality.rawResponseHash)]).first()
    expect(raw).toBeDefined(); await db.agentRunArtifacts.delete(raw!.id!)
    await expect(readAvgSoundProposalEvidenceV1(s.scope, original)).rejects.toThrow()
    const build = (await db.productBuilds.get(s.buildId))!
    await expect(readAvgConfirmedSoundPlanV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch })).rejects.toThrow()
    expect(s.calls).toHaveLength(1)
  }, 60_000)

  it('rejects a self-rehashed original proposal instead of trusting its same schema or author declaration', async () => {
    const s = await avgSoundHarnessFixtureV1(); await adoptAvgSoundSourcesV1(s); await cycleAvgSoundUntilV1(s, 'avg.proposal.sound-plan')
    const original = (await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan'))!, payload = JSON.parse(original.payloadJson)
    payload.payload.direction.goal = 'Self-rehashed forged goal'
    const wire = canonicalProductProductionJsonV2(payload)
    await db.productBuildArtifacts.update(original.id!, { payloadJson: wire, contentHash: await hashProductProductionValueV2(payload), byteSize: new TextEncoder().encode(wire).byteLength })
    await expect(stageAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan)).rejects.toThrow()
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.media.sound-plan')).toBeUndefined(); expect(s.calls).toHaveLength(1)
  }, 60_000)

  it.each(['model', 'route'] as const)('stops before HTTP when the actual configured %s differs from the frozen child binding, including after reopen', async mode => {
    const s = await avgSoundHarnessFixtureV1(); await adoptAvgSoundSourcesV1(s)
    const next = mode === 'model' ? { model: 'agnes-2.5-pro' } : { baseUrl: 'https://changed-sound-proposal.fixture.invalid/v1' }
    useAIConfigStore.getState().setConfig(next)
    expect(useAIConfigStore.getState().config).toMatchObject(next)
    for (let i = 0; i < 5; i++) await runProductProductionSchedulerCycleV1(s)
    expect(s.calls).toHaveLength(0); expect(await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan')).toBeUndefined()
    db.close(); await db.open(); await runProductProductionSchedulerCycleV1(s); expect(s.calls).toHaveLength(0)
  }, 60_000)

  it('retains a received response and usage but refuses its admission when adopted source bytes change during HTTP', async () => {
    const s = await avgSoundHarnessFixtureV1({ onResponse: async () => { await corrupt() } })
    const corrupt = async () => {
      const rules = (await acceptedAvgSoundArtifactV1(s, 'avg.system.plan'))!
      const payload = JSON.parse(rules.payloadJson); payload.characters[0].displayName += ' changed during HTTP'
      await db.productBuildArtifacts.update(rules.id!, { payloadJson: canonicalProductProductionJsonV2(payload) })
    }
    await adoptAvgSoundSourcesV1(s)
    for (let i = 0; i < 5; i++) await runProductProductionSchedulerCycleV1(s)
    expect(s.calls).toHaveLength(1); expect(await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan')).toBeUndefined()
    const raw = await db.agentRunArtifacts.where('projectId').equals(s.scope.projectId).filter(r => r.artifactKind === 'raw-response').toArray()
    expect(raw).toHaveLength(1)
    expect(JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks['avg.sound.propose.plan'].usage).toMatchObject({ modelCalls: 1, mediaCalls: 0, costUsd: null })
    await runProductProductionSchedulerCycleV1(s); expect(s.calls).toHaveLength(1)
  }, 60_000)

  it('keeps original model/author/compiled bytes through full backup/remap, denies imported adoption authority and deletes only the copy', async () => {
    const s = await avgSoundHarnessFixtureV1(); await adoptAvgSoundSourcesV1(s); await cycleAvgSoundUntilV1(s, 'avg.proposal.sound-plan')
    await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan); await cycleAvgSoundUntilV1(s, 'avg.media.compiled-sound-requirements')
    const original = (await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan'))!, compiled = (await acceptedAvgSoundArtifactV1(s, 'avg.media.compiled-sound-requirements'))!
    const proof = await readAvgSoundProposalEvidenceV1(s.scope, original), backup = await exportProjectJSON(s.scope.projectId), copyProjectId = await importProjectJSON(backup)
    const copyBuild = (await db.productBuilds.where('projectId').equals(copyProjectId).first())!
    const copyScope = { projectId: copyProjectId, workId: copyBuild.workId!, worldId: copyBuild.worldId! }
    const copyOriginal = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([copyBuild.id!, original.artifactKey]).first())!
    const copyCompiled = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([copyBuild.id!, compiled.artifactKey]).first())!
    expect((await readAvgSoundProposalEvidenceV1(copyScope, copyOriginal)).rawText).toBe(proof.rawText)
    expect(copyOriginal.payloadJson).toBe(original.payloadJson); expect(copyCompiled.payloadJson).toBe(compiled.payloadJson)
    const copyBrief = (await db.productProductionBriefs.where('productionId').equals(copyBuild.productionId).filter(r => r.briefHash === copyBuild.briefHash).first())!
    expect(parseProductProductionBriefV3(copyBrief.briefJson).avgSoundPlanning?.version).toBe(1)
    await expect(readAvgConfirmedSoundPlanV1({ scope: copyScope, buildId: copyBuild.id!, expectedBuildRevision: copyBuild.stateRevision, controlEpoch: copyBuild.controlEpoch })).rejects.toThrow()
    await deleteWork(copyScope.workId)
    expect({ ...await exportProjectJSON(s.scope.projectId), exportedAt: 0 }).toEqual({ ...backup, exportedAt: 0 })
    expect(s.calls).toHaveLength(1)
  }, 60_000)

  it.each(['context', 'route', 'skill'] as const)('refuses caller-substituted %s against the actual child claim before model HTTP', async mode => {
    const s = await avgSoundHarnessFixtureV1(); await adoptAvgSoundSourcesV1(s)
    const executor: typeof s.executor = input => s.executor(mode === 'context' ? { ...input, contextText: input.contextText + '\nUnregistered instructions' }
      : mode === 'route' ? { ...input, capabilityBindings: input.capabilityBindings.map(b => ({ ...b, bindingHash: 'e'.repeat(64) })) }
        : { ...input, task: { ...input.task, skillId: 'avg.visual-bible.v1' } })
    for (let i = 0; i < 5; i++) await runProductProductionSchedulerCycleV1({ ...s, executor })
    expect(s.calls).toHaveLength(0); expect(await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan')).toBeUndefined()
    expect(JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks['avg.sound.propose.plan'].usage).toMatchObject({ modelCalls: 0, mediaCalls: 0, costUsd: 0 })
  }, 60_000)
})
