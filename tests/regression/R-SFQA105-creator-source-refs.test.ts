import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as npcCompiler from '../../src/lib/open-world/npc-runtime-catalog-production'
import * as dispatch from '../../src/lib/open-world/creator-artifact-edit-dispatch'
import { db } from '../../src/lib/db/schema'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import {
  confirmTextOpenWorldCreatorArtifactEditIntentV1,
  createTextOpenWorldCreatorDirectEditOperationsV1,
  generateTextOpenWorldCreatorArtifactEditCandidateV1,
  prepareTextOpenWorldCreatorArtifactEditV1,
  rejectTextOpenWorldCreatorArtifactEditCandidateV1,
} from '../../src/lib/open-world/creator-artifact-edit'
import { readTextOpenWorldArtifactGovernanceV1 } from '../../src/lib/open-world/creator-artifact-governance'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1,
} from '../../src/lib/open-world/creator-artifact-edit-dispatch'
import type { TextOpenWorldNpcRuntimeCatalogV1 } from '../../src/lib/types'
import {
  createSfqa105CatalogFixture,
  editSfqa105Target,
  projectSfqa105Target,
  readSfqa105Pointer,
  rehashSfqa105Catalog,
  readSfqa105GovernedCapture,
  seedSfqa105GovernedBuild,
  sfqa105Artifacts,
  SFQA105_ARTIFACT_KEY as artifactKey,
  SFQA105_TASK_KEY as taskKey,
  type Sfqa105CatalogFixture,
} from '../helpers/sfqa105-creator-source-refs'

const variants = ['none', 'once', 'multiple', 'vendor-v3'] as const
const fixtures = new Map<string, Sfqa105CatalogFixture>()
beforeAll(async () => {
  for (const variant of variants) fixtures.set(variant, await createSfqa105CatalogFixture(variant))
})
afterEach(() => vi.restoreAllMocks())

function fixture(variant: typeof variants[number] = 'multiple') {
  const value = fixtures.get(variant)
  if (!value) throw new Error('SFQA105 fixture is not initialized')
  return value
}

function compilerInput(f: Sfqa105CatalogFixture, draft: unknown, entityIdentity: string | null) {
  return { taskKey, baseArtifacts: sfqa105Artifacts(f), context: f.contextText, draft,
    target: { artifactKey, entityIdentity } }
}

for (const variant of variants) {
  describe(`SFQA105 ${variant}: real compiler demand provenance`, () => {
    it('each retained actor exposes only its own original demand fields and values', async () => {
      const f = fixture(variant)
      for (const actor of f.artifact.actors) {
        const projected = await projectSfqa105Target(f, `character:${actor.key}`)
        if (actor.demandKind === 'service-replacement') {
          expect(projected.editableFields).toEqual([])
          continue
        }
        const demand = f.context.actorDemands.find(row => row.sourceDemandKey === actor.sourceDemandKey)!
        expect(projected.editableFields.map(row => row.jsonPointer)).toEqual([
          'biography', 'name', 'portrayal',
        ].map(field => `/actors/${demand.demandNumber - 1}/${field}`))
        for (const field of projected.editableFields) {
          const key = field.jsonPointer.split('/').pop()!
          expect(readSfqa105Pointer(projected.draft, field.jsonPointer)).toEqual(Reflect.get(actor, key))
          expect(field.entityIdentity).toBe(`character:${actor.key}`)
        }
      }
    })

    it('each retained faction exposes only its own original demand fields', async () => {
      const f = fixture(variant)
      for (const faction of f.artifact.factions) {
        const projected = await projectSfqa105Target(f, `faction:${faction.key}`)
        const demand = f.context.factionDemands.find(row => row.sourceDemandKey === faction.sourceDemandKey)!
        expect(projected.editableFields.map(row => row.jsonPointer)).toEqual([
          'description', 'moralityMultiplier', 'publicGoal',
        ].map(field => `/factions/${demand.demandNumber - 1}/${field}`))
        for (const field of projected.editableFields) {
          expect(readSfqa105Pointer(projected.draft, field.jsonPointer))
            .toEqual(Reflect.get(faction, field.jsonPointer.split('/').pop()!))
        }
      }
    })

    it('each authored schedule follows its canonical actor source; derived replacements stay read only', async () => {
      const f = fixture(variant)
      for (const schedule of f.artifact.schedules) {
        const actor = f.artifact.actors.find(row => row.key === schedule.actorKey)!
        const projected = await projectSfqa105Target(f, `schedule:${schedule.key}`)
        if (actor.demandKind === 'service-replacement') {
          expect(projected.editableFields).toEqual([])
          continue
        }
        const demand = f.context.actorDemands.find(row => row.sourceDemandKey === actor.sourceDemandKey)!
        expect(projected.editableFields.map(row => row.jsonPointer))
          .toEqual([`/actors/${demand.demandNumber - 1}/scheduleActivities`])
        expect(readSfqa105Pointer(projected.draft, projected.editableFields[0].jsonPointer))
          .toEqual(schedule.entries.map(row => row.activity))
      }
    })

    it('editing each actor biography changes only that entity and retains stable IDs and references', async () => {
      const f = fixture(variant)
      for (const actor of f.artifact.actors.filter(row => row.demandKind !== 'service-replacement')) {
        const value = `${actor.key}的作者独立修订小传。`
        const edited = await editSfqa105Target({ fixture: f, entityIdentity: `character:${actor.key}`, suffix: '/biography', value })
        expect(edited.artifact.actors.find(row => row.key === actor.key)?.biography).toBe(value)
        expect(edited.artifact.actors.filter(row => row.key !== actor.key))
          .toEqual(f.artifact.actors.filter(row => row.key !== actor.key))
        expect(edited.artifact.factions).toEqual(f.artifact.factions)
        expect(edited.artifact.schedules).toEqual(f.artifact.schedules)
        expect(edited.rebuilt.identitySequence).toEqual(edited.projection.identitySequence)
        expect(edited.rebuilt.referenceHash).toBe(edited.projection.referenceHash)
      }
    })

    it('editing each faction changes only that faction', async () => {
      const f = fixture(variant)
      for (const faction of f.artifact.factions) {
        const value = `${faction.key}的作者独立修订描述。`
        const edited = await editSfqa105Target({ fixture: f, entityIdentity: `faction:${faction.key}`, suffix: '/description', value })
        expect(edited.artifact.factions.find(row => row.key === faction.key)?.description).toBe(value)
        expect(edited.artifact.factions.filter(row => row.key !== faction.key))
          .toEqual(f.artifact.factions.filter(row => row.key !== faction.key))
        expect(edited.artifact.actors).toEqual(f.artifact.actors)
        expect(edited.artifact.schedules).toEqual(f.artifact.schedules)
      }
    })

    it('editing each authored schedule changes only that schedule', async () => {
      const f = fixture(variant)
      for (const schedule of f.artifact.schedules) {
        const actor = f.artifact.actors.find(row => row.key === schedule.actorKey)!
        if (actor.demandKind === 'service-replacement') continue
        const value = schedule.entries.map((_, index) => `${schedule.key}的作者活动${index + 1}。`)
        const edited = await editSfqa105Target({ fixture: f, entityIdentity: `schedule:${schedule.key}`, suffix: '/scheduleActivities', value })
        expect(edited.artifact.schedules.find(row => row.key === schedule.key)?.entries.map(row => row.activity)).toEqual(value)
        expect(edited.artifact.schedules.filter(row => row.key !== schedule.key))
          .toEqual(f.artifact.schedules.filter(row => row.key !== schedule.key))
        expect(edited.artifact.actors).toEqual(f.artifact.actors)
        expect(edited.artifact.factions).toEqual(f.artifact.factions)
      }
    })
  })
}

describe('SFQA105 target binding and compatibility controls', () => {
  it('compressed governed fixture preserves its exact official export bytes and backup trust contract', async () => {
    const decoded = await readSfqa105GovernedCapture()
    expect(decoded.governed?.version).toBe(17)
    expect(decoded.native).toMatchObject({ entityIdentity: 'character:actor.catalog.008', demandNumber: 8, aliasNumber: 7 })
  })

  it('keeps an unchanged legacy no-target NPC round trip byte-equivalent', async () => {
    const f = fixture()
    const projection = await projectSfqa105Target(f, null)
    const { target: _target, ...input } = compilerInput(f, projection.draft, null)
    expect((await rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1(input)).artifacts[0].payload).toEqual(f.artifact)
  })

  it('allows a whole-catalog null target to edit policy while preserving every entity', async () => {
    const f = fixture()
    const edited = await editSfqa105Target({ fixture: f, entityIdentity: null, suffix: '/label', value: '作者关系标签' })
    expect(edited.artifact.relationshipPolicy.attitudeBands.some(row => row.label === '作者关系标签')).toBe(true)
    expect(edited.artifact.actors).toEqual(f.artifact.actors)
    expect(edited.artifact.factions).toEqual(f.artifact.factions)
    expect(edited.artifact.schedules).toEqual(f.artifact.schedules)
  })

  it('captures the author target, full draft, context and base artifacts before asynchronous rebuild', async () => {
    const f = fixture()
    const edited = await editSfqa105Target({ fixture: f, entityIdentity: 'character:actor.catalog.009', suffix: '/biography', value: '进入重建前已冻结的作者小传。' })
    const draft: { actors: Array<{ biography?: string }> } = JSON.parse(JSON.stringify(edited.applied.draft))
    const input = { ...compilerInput(f, draft, 'character:actor.catalog.009'), baseArtifacts: structuredClone(sfqa105Artifacts(f)) }
    const pending = rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1(input)
    draft.actors[8].biography = '不得进入当前调用的迟到修改。'
    input.target.entityIdentity = 'character:foreign'
    input.context = '{}'
    input.baseArtifacts[0].payload.actors[0].name = '迟到的来源修改'
    const result = await pending
    const catalog: TextOpenWorldNpcRuntimeCatalogV1 = JSON.parse(JSON.stringify(result.artifacts[0].payload))
    expect(catalog.actors.find(row => row.key === 'actor.catalog.009')?.biography).toBe('进入重建前已冻结的作者小传。')
    expect(catalog.actors[0].name).toBe(f.artifact.actors[0].name)
    expect(result.draftHash).toBe(edited.applied.draftHash)
  })

  it.each(['wrong-entity', 'missing-target', 'foreign-artifact', 'null-for-entity'] as const)('rejects %s even when IDs and reference sequences remain unchanged', async mode => {
    const f = fixture()
    const actor = f.artifact.actors.find(row => row.key === 'actor.catalog.009')!
    const edited = await editSfqa105Target({ fixture: f, entityIdentity: `character:${actor.key}`, suffix: '/biography', value: '作者指定此角色的小传。' })
    const input: Parameters<typeof rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1>[0] =
      compilerInput(f, edited.applied.draft, `character:${actor.key}`)
    if (mode === 'wrong-entity') input.target = { artifactKey, entityIdentity: 'character:actor.significant.001' }
    if (mode === 'missing-target') delete input.target
    if (mode === 'foreign-artifact') input.target = { artifactKey: 'text-open-world.player-build', entityIdentity: null }
    if (mode === 'null-for-entity') input.target = { artifactKey, entityIdentity: null }
    await expect(rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1(input)).rejects.toThrow(/作者.*目标|不属于作者目标/)
  })

  it('rejects an extra changed pointer outside the selected entity', async () => {
    const f = fixture()
    const projection = await projectSfqa105Target(f, 'character:actor.catalog.009')
    const draft: { actors: Array<{ biography?: string }> } = JSON.parse(JSON.stringify(projection.draft))
    draft.actors[0].biography = '不属于作者选择的角色。'
    await expect(rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1(
      compilerInput(f, draft, 'character:actor.catalog.009'),
    )).rejects.toThrow(/不属于作者目标/)
  })

  it('rejects a compiler text swap that preserves all global IDs, references and sourceRefs', async () => {
    const f = fixture()
    const edited = await editSfqa105Target({ fixture: f, entityIdentity: 'character:actor.catalog.009', suffix: '/biography', value: '必须保存在角色009的确认文字。' })
    const original = npcCompiler.rebuildTextOpenWorldNpcRuntimeCatalogFromAuthorEditableDraftV1
    vi.spyOn(npcCompiler, 'rebuildTextOpenWorldNpcRuntimeCatalogFromAuthorEditableDraftV1').mockImplementationOnce(async input => {
      const artifact = await original(input)
      const target = artifact.actors.find(row => row.key === 'actor.catalog.009')!
      const other = artifact.actors.find(row => row.key === 'actor.catalog.012')!
      const biography = target.biography
      target.biography = other.biography
      other.biography = biography
      return rehashSfqa105Catalog(artifact)
    })
    await expect(rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1(
      compilerInput(f, edited.applied.draft, 'character:actor.catalog.009'),
    )).rejects.toThrow(/未回写到作者目标字段/)
  })

  it('still rejects sourceRefs tampering even when the outer catalog hash is recomputed', async () => {
    const f = fixture()
    const artifact: TextOpenWorldNpcRuntimeCatalogV1 = structuredClone(f.artifact)
    artifact.actors[0].sourceRefs.pop()
    const changed = { ...f, artifact: await rehashSfqa105Catalog(artifact) }
    await expect(projectSfqa105Target(changed, `character:${artifact.actors[0].key}`)).rejects.toThrow()
  })
})

describe('SFQA105 actual governed legacy and fresh candidate replay', () => {
  it('keeps the original v17 Build readable and refuses a new edit until the author selects a frozen protagonist', async () => {
    await db.delete()
    await db.open()
    try {
      const f = await seedSfqa105GovernedBuild({ capture: 'legacy', includeComparisonHashes: false })
      const selection = { scope: f.scope, productionId: f.productionId, buildId: f.buildId,
        expectedSnapshotHash: f.governanceSnapshotHash, artifactKey, entityIdentity: f.entityIdentity }
      const context = await prepareTextOpenWorldCreatorArtifactEditV1(selection)
      const field = context.editableFields.find(value => value.jsonPointer.endsWith('/biography'))!
      const operations = await createTextOpenWorldCreatorDirectEditOperationsV1({
        context, values: { [field.fieldId]: '旧简报缺少作者明确选择的封存主角。' },
      })
      const before = await db.agentRuns.where('projectId').equals(f.scope.projectId).count()
      await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection, mode: 'direct', operations }))
        .rejects.toThrow(/旧简报未明确选择封存主角/)
      expect(await db.agentRuns.where('projectId').equals(f.scope.projectId).count()).toBe(before)
    } finally {
      db.close()
    }
  }, 120_000)

  it('rejects an old compressed-index field catalog, then confirms a fresh candidate by actual hash replay without changing the parent Build', async () => {
    await db.delete()
    await db.open()
    try {
      const f = await seedSfqa105GovernedBuild()
      const actor = f.catalog.actors.find(row => row.key === 'actor.catalog.009')!
      const wrongActor = f.catalog.actors.find(row => row.key === 'actor.catalog.008')!
      expect(actor).toBeDefined()
      expect(wrongActor).toBeDefined()
      const entityIdentity = `character:${actor.key}`
      const legacyOwner = `character:${wrongActor.key}`
      const governance = await readTextOpenWorldArtifactGovernanceV1({ scope: f.scope, productionId: f.productionId })
      const selection = { scope: f.scope, productionId: f.productionId, buildId: f.buildId,
        expectedSnapshotHash: governance.snapshotHash, artifactKey, entityIdentity }

      // Reproduce only the pinned pre-fix domain adapter semantics: the old
      // compacted offset labeled actor008's draft fields as actor009's fields.
      // The public Run/checkpoint/candidate writers and governance remain real.
      const project = dispatch.projectTextOpenWorldCreatorAuthorEditableDraftV1
      const rebuild = dispatch.rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1
      vi.spyOn(dispatch, 'projectTextOpenWorldCreatorAuthorEditableDraftV1').mockImplementation(async input => {
        if (input.taskKey !== taskKey || input.target.entityIdentity !== entityIdentity) return project(input)
        const projected = await project({ ...input, target: { artifactKey, entityIdentity: legacyOwner } })
        return {
          ...projected, target: { artifactKey, entityIdentity },
          editableFields: await Promise.all(projected.editableFields.map(async field => ({
            ...field, entityIdentity,
            fieldId: `field.${await hashProductProductionValueV2({ taskKey, artifactKey, entityIdentity, jsonPointer: field.jsonPointer })}`,
          }))),
        }
      })
      vi.spyOn(dispatch, 'rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1').mockImplementation(input => (
        input.taskKey === taskKey ? rebuild({ ...input, target: { artifactKey, entityIdentity: legacyOwner } }) : rebuild(input)
      ))
      const legacyContext = await prepareTextOpenWorldCreatorArtifactEditV1(selection)
      const oldField = legacyContext.editableFields.find(field => field.jsonPointer.endsWith('/biography'))!
      expect(oldField.jsonPointer).toBe('/actors/7/biography')
      const operations = await createTextOpenWorldCreatorDirectEditOperationsV1({
        context: legacyContext, values: { [oldField.fieldId]: '旧版错位候选的文字，不得被当前确认采纳。' },
      })
      const legacy = await generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection, mode: 'direct', operations })
      const legacyCatalog: TextOpenWorldNpcRuntimeCatalogV1 = JSON.parse(JSON.stringify(legacy.candidate.rebuiltArtifacts[0].payload))
      expect(legacyCatalog.actors.find(row => row.key === wrongActor.key)?.biography).toBe('旧版错位候选的文字，不得被当前确认采纳。')
      expect(legacyCatalog.actors.find(row => row.key === actor.key)?.biography).toBe(actor.biography)
      vi.restoreAllMocks()

      await expect(confirmTextOpenWorldCreatorArtifactEditIntentV1({
        selection, runId: legacy.snapshot.run.id, warningAcknowledgementCodes: [],
      })).rejects.toThrow(/目标字段已变化/)
      const staleRun = await readAgentRunV1(f.scope, legacy.snapshot.run.id)
      expect(staleRun.events.some(event => event.type === 'confirmation.recorded')).toBe(false)
      expect(staleRun.projection.terminalReceiptHash).toBeUndefined()
      await rejectTextOpenWorldCreatorArtifactEditCandidateV1({ selection, runId: legacy.snapshot.run.id })

      const freshContext = await prepareTextOpenWorldCreatorArtifactEditV1(selection)
      const field = freshContext.editableFields.find(value => value.jsonPointer.endsWith('/biography'))!
      expect(field.jsonPointer).toBe('/actors/8/biography')
      const freshOperations = await createTextOpenWorldCreatorDirectEditOperationsV1({
        context: freshContext, values: { [field.fieldId]: '当前作者明确确认给角色009的小传。' },
      })
      const fresh = await generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection, mode: 'direct', operations: freshOperations })
      const confirm = { selection, runId: fresh.snapshot.run.id, warningAcknowledgementCodes: [] }
      const accepted = await confirmTextOpenWorldCreatorArtifactEditIntentV1(confirm)
      const replayed = await confirmTextOpenWorldCreatorArtifactEditIntentV1(confirm)
      expect(accepted.snapshot.projection.state).toBe('completed')
      expect(accepted.intent.candidateHash).toBe(fresh.candidate.candidateHash)
      expect(replayed.snapshot.projection.terminalReceiptHash).toBe(accepted.snapshot.projection.terminalReceiptHash)
      expect(replayed.candidate.candidateHash).toBe(fresh.candidate.candidateHash)
      const catalog: TextOpenWorldNpcRuntimeCatalogV1 = JSON.parse(JSON.stringify(replayed.candidate.rebuiltArtifacts[0].payload))
      expect(catalog.actors.find(row => row.key === actor.key)?.biography).toBe('当前作者明确确认给角色009的小传。')
      expect(catalog.actors.filter(row => row.key !== actor.key)).toEqual(f.catalog.actors.filter(row => row.key !== actor.key))
      expect(await hashProductProductionValueV2(await db.productBuilds.get(f.buildId))).toBe(f.buildHash)
      expect(await hashProductProductionValueV2(await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray())).toBe(f.artifactsHash)
      expect(await db.agentRunEvents.where('projectId').equals(f.scope.projectId).filter(row => row.type === 'model.responded').count()).toBe(f.modelResponses)
    } finally {
      vi.restoreAllMocks()
      db.close()
    }
  }, 120_000)
})
