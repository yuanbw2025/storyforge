import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readAvgSystemPlanForCompilationV1, stageAvgAuthorArtifactV1 } from '../../src/lib/avg/author-artifacts'
import { validateAvgSystemPlanForAuthorV1, simulateAvgSystemPlanV1 } from '../../src/lib/avg/system-compiler'
import { prepareAvgProfessionalArtifactV1 } from '../../src/lib/avg/artifact-contract'
import { assertAvgProfessionalArtifactAdmissionV1 } from '../../src/lib/avg/artifact-admission'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { createAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { authorFixtureCommand } from '../helpers/avg-author-artifact-fixture'
import { seedAvgAuthorSystem, stageAvgAuthorSystem } from '../helpers/avg-author-system-fixture'
import { avgSystemFixture } from '../helpers/avg-system-fixture'

async function compilationInput(s: Awaited<ReturnType<typeof seedAvgAuthorSystem>>) {
  const build = (await db.productBuilds.get(s.buildId))!
  return { scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch }
}
async function confirm(s: Awaited<ReturnType<typeof seedAvgAuthorSystem>>, candidate: Awaited<ReturnType<typeof stageAvgAuthorSystem>>, commandId = crypto.randomUUID()) {
  const command = await authorFixtureCommand(s, candidate, commandId)
  return { command, result: await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command }) }
}

describe('AVG-02A1 author-owned rules, actual confirmation and compilation evidence', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('keeps rules pending until confirmation, verifies structure/entry evidence and compiles only the confirmed revision', async () => {
    const s = await seedAvgAuthorSystem(), candidate = await stageAvgAuthorSystem(s)
    const body = JSON.parse(candidate.metadataJson)
    expect(candidate).toMatchObject({ status: 'pending', kind: 'product-module', producerRunId: null })
    expect(body.version).toBe(2)
    expect(body.systemValidation).toEqual(await validateAvgSystemPlanForAuthorV1(avgSystemFixture()))
    expect(body.systemValidation.coverage).toBe('structure-and-entry')
    expect(body.systemValidation.planHash).toBe(candidate.contentHash)
    expect(await stageAvgAuthorSystem(s)).toEqual(candidate)
    await expect(readAvgSystemPlanForCompilationV1(await compilationInput(s))).rejects.toThrow(/未采用/)
    const before = await compilationInput(s)
    const { command, result } = await confirm(s, candidate, 'system.confirm')
    expect(result.ok).toBe(true)
    await expect(readAvgSystemPlanForCompilationV1(before)).rejects.toThrow(/stale/)
    const compiled = await readAvgSystemPlanForCompilationV1(await compilationInput(s))
    expect(compiled.plan).toEqual(avgSystemFixture())
    expect(compiled.artifact.contentHash).toBe(candidate.contentHash)
    expect(compiled.authorReceiptHash).toBe(result.result.authorReceiptHash)
    const simulated = await simulateAvgSystemPlanV1({ plan: compiled.plan, actionKeys: ['inspect','share'] })
    expect(simulated.completed).toBe(true)
    expect(simulated.planHash).toBe(compiled.validation.planHash)
    const replay = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command })
    expect(replay).toMatchObject({ ok: true, replayed: true, result: result.result })
    expect(await db.productBuildArtifacts.count()).toBe(1)
    expect(await db.agentRuns.count()).toBe(0)
    expect(await db.productRuntimeSessions.count()).toBe(0)
    await db.productBuilds.update(s.buildId, { status: 'preview-ready', packageHash: 'a'.repeat(64) })
    await expect(readAvgSystemPlanForCompilationV1(await compilationInput(s))).rejects.toThrow(/已冻结/)
  })

  it('refuses invalid graphs and initial overflows before storage, and does not gain generic AI or wrong-kind admission', async () => {
    const s = await seedAvgAuthorSystem()
    const broken = avgSystemFixture(); broken.actions[0].toSceneKey = 'missing'
    await expect(stageAvgAuthorSystem(s, broken)).rejects.toThrow(/规则图无效/)
    const overflow = avgSystemFixture(); overflow.scenes[0].onEnter = [{ op: 'increment', path: 'avg.variables.attempts', value: 3 }]
    await expect(stageAvgAuthorSystem(s, overflow)).rejects.toThrow(/attempts/)
    expect(await db.productBuildArtifacts.count()).toBe(0)
    expect(() => prepareAvgProfessionalArtifactV1({ artifactKey: 'avg.system.plan', kind: 'narrative', payload: avgSystemFixture(), allowedOutputKeys: ['avg.system.plan'] })).toThrow(/kind/)
    expect(() => assertAvgProfessionalArtifactAdmissionV1({ productType: 'avg', artifactKey: 'avg.system.plan', kind: 'product-module', payload: avgSystemFixture(), metadata: {} })).toThrow(/尚未就绪/)
    const other = await createAvgDraftV1('另一个作者作品')
    await expect(stageAvgAuthorArtifactV1({ ...(await compilationInput(s)), scope: other.scope, taskKey: 'author.system', artifactKey: 'avg.system.plan', kind: 'product-module', payload: avgSystemFixture(), declaration: '原创规则' })).rejects.toThrow(/跨 Work/)
    await expect(readAvgSystemPlanForCompilationV1({ ...(await compilationInput(s)), scope: other.scope })).rejects.toThrow(/跨 Work/)
    const modelPlan = structuredClone(s.plan)
    modelPlan.tasks[0].executionMode = 'model'; modelPlan.tasks[0].skillId = 'avg.system-plan.v1'
    await db.productBuilds.update(s.buildId, { planJson: canonicalProductProductionJsonV2(modelPlan), planHash: await hashProductProductionValueV2(modelPlan) })
    await expect(stageAvgAuthorSystem(s)).rejects.toThrow(/作者输入写域/)
  })

  it('recomputes validation and refuses a forged compiler observation even when all caller-controlled candidate hashes are recomputed', async () => {
    const s = await seedAvgAuthorSystem(), candidate = await stageAvgAuthorSystem(s)
    const { candidateHash: _oldHash, ...body } = JSON.parse(candidate.metadataJson)
    body.systemValidation.initialStateHash = 'f'.repeat(64)
    const candidateHash = await hashProductProductionValueV2(body)
    await db.productBuildArtifacts.update(candidate.id!, { metadataJson: canonicalProductProductionJsonV2({ ...body, candidateHash }),
      inputHash: await hashProductProductionValueV2({ ...body, payloadHash: null }) })
    const { result } = await confirm(s, { ...candidate, metadataJson: canonicalProductProductionJsonV2({ ...body, candidateHash }) })
    expect(result.ok).toBe(false)
    expect(result.result.message).toMatch(/stale|篡改/)
    expect((await db.productBuildArtifacts.get(candidate.id!))!.status).toBe('pending')
    expect(await db.productProductionCommands.filter(row => row.type === 'adopt-avg-artifact' && row.status === 'failed').count()).toBe(1)
  })

  it('restores a pending rule candidate into a remapped Work, confirms it once and preserves the original candidate', async () => {
    const s = await seedAvgAuthorSystem(), candidate = await stageAvgAuthorSystem(s)
    const command = await authorFixtureCommand(s, candidate, 'restored.system.confirm')
    const importedId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const build = (await db.productBuilds.where('projectId').equals(importedId).first())!
    const restored = { ...s, scope: { projectId: importedId, worldId: build.worldId, workId: build.workId }, productionId: build.productionId, buildId: build.id! }
    expect((await executeProductProductionCommand({ scope: restored.scope, productionId: restored.productionId, command })).ok).toBe(true)
    const actual = await readAvgSystemPlanForCompilationV1(await compilationInput(restored))
    expect(actual.plan).toEqual(avgSystemFixture())
    expect(actual.validation.planHash).toBe(candidate.contentHash)
    expect((await db.productBuildArtifacts.get(candidate.id!))!.status).toBe('pending')
    const secondId = await importProjectJSON(await exportProjectJSON(importedId))
    const secondBuild = (await db.productBuilds.where('projectId').equals(secondId).first())!
    const again = { ...restored, scope: { projectId: secondId, worldId: secondBuild.worldId, workId: secondBuild.workId }, productionId: secondBuild.productionId, buildId: secondBuild.id! }
    expect((await readAvgSystemPlanForCompilationV1(await compilationInput(again))).validation).toEqual(actual.validation)
    await deleteWork(importedId, restored.scope.workId)
    expect(await db.productBuildArtifacts.where('projectId').equals(importedId).count()).toBe(0)
    expect((await db.productBuildArtifacts.get(candidate.id!))!.status).toBe('pending')
  })

  it('invalidates dependent adopted scripts on a rule revision, preserving old rule and script bytes', async () => {
    const s = await seedAvgAuthorSystem(true), candidate = await stageAvgAuthorSystem(s)
    expect((await confirm(s, candidate)).result.ok).toBe(true)
    const scriptPayload = { schema: 'storyforge.avg.scene-script', version: 1, sceneKey: 'desk',
      lines: [{ lineKey: 'line.seal', beatKey: 'line.seal', speakerKey: 'keeper', text: '封口仍在。', informationKeys: [], actionKeys: ['inspect'] }], choices: [{ choiceKey: 'share', text: '说明检查结果', actionKey: 'share' }] }
    const script = await stageAvgAuthorArtifactV1({ ...(await compilationInput(s)), taskKey: 'author.script', artifactKey: 'avg.content.scene-script.desk', kind: 'narrative', payload: scriptPayload, declaration: '原创测试句' })
    expect((await confirm(s, script)).result.ok).toBe(true)
    const plan = avgSystemFixture(); plan.variables[0] = { key: 'attempts', kind: 'number', initial: 0, minimum: 0, maximum: 3, integer: true, optional: false }
    const revision = await stageAvgAuthorSystem(s, plan)
    expect((await confirm(s, revision)).result.ok).toBe(true)
    expect((await db.productBuildArtifacts.get(candidate.id!))!).toMatchObject({ status: 'invalid', payloadJson: candidate.payloadJson })
    expect((await db.productBuildArtifacts.get(script.id!))!).toMatchObject({ status: 'invalid', payloadJson: script.payloadJson })
    const current = await readAvgSystemPlanForCompilationV1(await compilationInput(s))
    expect(current.artifact.version).toBe(2)
    expect(current.plan).toEqual(plan)
    expect(current.validation.planHash).not.toBe(candidate.contentHash)
  })
})
