import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createAvgDraftV1, readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgAuthorWorkspaceV1, saveAvgEditorV1 } from '../../src/lib/avg/editor-service'
import { parseAvgAuthorStageV1, parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { readAvgSystemPlanForCompilationV1, stageAvgAuthorArtifactV1 } from '../../src/lib/avg/author-artifacts'
import { compileAdoptedAvgBuildV2 } from '../../src/lib/avg/executable-compiler'
import { stageAvgAuthorSystem } from '../helpers/avg-author-system-fixture'
import { avgSystemFixture } from '../helpers/avg-system-fixture'
import { legacyPackage } from '../helpers/avg-carrier-fixture'
import { avgAuthorStageFixture, avgAuthorWorkspaceFixture, confirmAuthorStageFixture, seedAvgAuthorStageInputs, stageAuthorStageFixture, stageInput } from '../helpers/avg-author-stage-fixture'
import { authorFixtureCommand } from '../helpers/avg-author-artifact-fixture'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { assertAvgProfessionalArtifactAdmissionV1 } from '../../src/lib/avg/artifact-admission'
import { avgReadingAudioFixture } from '../helpers/avg-reading-fixture'
import { freezeAvgVisualProductionBatchV1 } from '../../src/lib/avg/media-source'

describe('AVG-05A explicit author assembly and portable workspace', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('retains only portable drafts with CAS, refuses unknown IDs/versions and protects legacy editing in both directions', async () => {
    const s = await createAvgDraftV1('作者系统工作区'), workspace = avgAuthorWorkspaceFixture()
    const saved = await saveAvgAuthorWorkspaceV1(s.scope, 0, workspace)
    expect(JSON.parse(saved.editorJson!)).toEqual(workspace)
    await expect(saveAvgAuthorWorkspaceV1(s.scope, 0, workspace)).rejects.toThrow(/其他页面/)
    await expect(saveAvgEditorV1(s.scope, saved.revision, 'a'.repeat(64), legacyPackage())).rejects.toThrow(/原生系统/)
    expect(() => parseAvgAuthorWorkspaceV1({ ...workspace, version: 2 })).toThrow(/版本/)
    expect(() => parseAvgAuthorWorkspaceV1({ ...workspace, blobObjectId: 42 })).toThrow(/字段/)
    expect(() => parseAvgAuthorWorkspaceV1({ ...workspace, mediaBatch: undefined })).toThrow()
    expect(() => parseAvgAuthorStageV1({ ...workspace.presentation, reading: undefined })).toThrow()
    expect(() => parseAvgAuthorStageV1({ ...workspace.presentation, stage: { ...workspace.presentation.stage, blobObjectId: 1 } })).toThrow(/字段/)
    expect(() => parseAvgAuthorWorkspaceV1({ ...workspace, scripts: [...workspace.scripts, workspace.scripts[0]] })).toThrow(/重复/)
    // Draft save may retain incomplete work, but does not authorize/adopt a Build.
    expect((await saveAvgAuthorWorkspaceV1(s.scope, saved.revision, { ...workspace, scripts: [] })).revision).toBe(2)
    expect(await db.productProductions.count()).toBe(0)
    const old = await createAvgDraftV1('旧版编辑草稿')
    const pkg = { ...legacyPackage(), productType: 'avg' as const }
    await saveAvgEditorV1(old.scope, 0, 'a'.repeat(64), pkg)
    await expect(saveAvgAuthorWorkspaceV1(old.scope, 1, workspace)).rejects.toThrow(/旧版编辑草稿/)
    expect(JSON.parse((await readAvgDraftV1(old.scope)).editorJson!)).toEqual(pkg)
  })

  it('compiles only an adopted stage with exact rule/script revisions; stores pending before confirmation and replays the real receipt once', async () => {
    const s = await seedAvgAuthorStageInputs(), candidate = await stageAuthorStageFixture(s)
    const body = JSON.parse(candidate.metadataJson)
    expect(body).toMatchObject({ version: 3, origin: 'author-import', assemblyValidation: { schema: 'storyforge.avg.assembly-validation', version: 1 } })
    expect(candidate).toMatchObject({ status: 'pending', producerRunId: null, blobObjectId: null })
    const product = { key: 'avg.author.fixture', title: '真实作者采用组装', description: '原创固定测试文本' }
    await expect(compileAdoptedAvgBuildV2({ ...(await stageInput(s)), product })).rejects.toThrow(/未采用/)
    const command = await authorFixtureCommand(s, candidate, 'stage.confirm')
    const result = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command })
    expect(result.ok).toBe(true)
    expect((await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command })).replayed).toBe(true)
    const compiled = await compileAdoptedAvgBuildV2({ ...(await stageInput(s)), product })
    expect(compiled.source.authorStage!.authorReceiptHash).toBe(result.result.authorReceiptHash)
    expect(compiled.runtimePackage).toMatchObject({ version: 2, productType: 'avg' })
    expect(compiled.runtimePackage.narrative.beats[0].text).toBe('封口仍在。')
    expect(compiled.source.scripts.map(row => row.artifact.version)).toEqual([1,1,1])
    expect(await db.agentRuns.count()).toBe(0)
    expect(await db.productRuntimeSessions.count()).toBe(0)
    expect(() => assertAvgProfessionalArtifactAdmissionV1({ productType: 'avg', artifactKey: candidate.artifactKey, kind: candidate.kind,
      payload: avgAuthorStageFixture(), metadata: {} })).toThrow()
    const other = await createAvgDraftV1('另一个 AVG')
    await expect(compileAdoptedAvgBuildV2({ ...(await stageInput(s)), scope: other.scope, product })).rejects.toThrow(/跨 Work/)
    await db.productBuilds.update(s.buildId, { previewHash: 'a'.repeat(64), status: 'preview-ready' })
    await expect(stageAuthorStageFixture(s)).rejects.toThrow(/已冻结/)
  })

  it('bounds author assembly before scanning or retaining physical media', async () => {
    const stage = avgAuthorStageFixture(), { asset } = await avgReadingAudioFixture(10)
    stage.stage.assets = [{ ...asset, byteSize: 64*1024*1024 }]
    expect(parseAvgAuthorStageV1(stage).stage.assets).toHaveLength(1)
    stage.stage.assets[0].byteSize++
    expect(() => parseAvgAuthorStageV1(stage)).toThrow(/64 MiB/)
    stage.stage.assets = Array.from({ length:129 }, (_,i) => ({ ...asset, assetKey:`voice.${i}` }))
    expect(() => parseAvgAuthorStageV1(stage)).toThrow(/128 项/)
    expect(await db.avgDraftMedia.count()).toBe(0)
  })

  it('rejects wrong line/actor/asset/audio bindings and recomputes rather than trusting a caller-signed assembly observation', async () => {
    const s = await seedAvgAuthorStageInputs(), bad = avgAuthorStageFixture()
    bad.stage.cues = [{ cueKey: 'bad', beatKey: 'missing.line', type: 'set-tone', tone: 'night', phase: 'before', durationMs: 0, order: 0, easing: 'linear' }]
    await expect(stageAuthorStageFixture(s, bad)).rejects.toThrow(/stage 无效/)
    const missing = avgAuthorStageFixture(); missing.reading = { schema: 'storyforge.avg.reading-plan', version: 1, manualVoice: 'wait', voiceFailure: 'pause', maximumVoiceWaitMs: 5000, autoDelayMs: 0, voices: [{ lineKey: 'line.desk', assetKey: 'missing.voice', text: '旧台词', textRevision: 1, speakerKey: 'keeper', locale: 'zh-CN' }] }
    await expect(stageAuthorStageFixture(s, missing)).rejects.toThrow()
    const candidate = await stageAuthorStageFixture(s)
    const { candidateHash: _prior, ...body } = JSON.parse(candidate.metadataJson)
    body.assemblyValidation.moduleHash = 'f'.repeat(64)
    const metadataJson = canonicalProductProductionJsonV2({ ...body, candidateHash: await hashProductProductionValueV2(body) })
    await db.productBuildArtifacts.update(candidate.id!, { metadataJson, inputHash: await hashProductProductionValueV2({ ...body, payloadHash: null }) })
    const result = await confirmAuthorStageFixture(s, { ...candidate, metadataJson })
    expect(result.ok).toBe(false)
    expect(result.result.message).toMatch(/stale|篡改/)
    expect((await db.productBuildArtifacts.get(candidate.id!))!.status).toBe('pending')
  })

  it('invalidates dependent stage on a rule change and preserves all prior payload bytes', async () => {
    const s = await seedAvgAuthorStageInputs(), candidate = await stageAuthorStageFixture(s)
    expect((await confirmAuthorStageFixture(s, candidate)).ok).toBe(true)
    const rules = avgSystemFixture(); rules.title = '修改后的规则标题'
    const revised = await stageAvgAuthorSystem(s, rules)
    expect((await confirmAuthorStageFixture(s, revised)).ok).toBe(true)
    expect((await db.productBuildArtifacts.get(candidate.id!))!).toMatchObject({ status: 'invalid', payloadJson: candidate.payloadJson })
    await expect(readAvgSystemPlanForCompilationV1({ ...(await stageInput(s)), includeAuthorStage: true })).rejects.toThrow(/未采用/)
  })

  it('rejects an old pending stage after a script revision and invalidates the adopted stage when text changes again', async () => {
    const s = await seedAvgAuthorStageInputs(), old = await stageAuthorStageFixture(s)
    const payload = avgAuthorWorkspaceFixture().scripts[0]
    const revise = async (text: string) => {
      payload.lines[0].text = text
      const candidate = await stageAvgAuthorArtifactV1({ ...(await stageInput(s)), taskKey: 'script.desk',
        artifactKey: 'avg.content.scene-script.desk', kind: 'narrative', payload, declaration: '作者修订固定测试句' })
      expect((await confirmAuthorStageFixture(s, candidate)).ok).toBe(true)
    }
    await revise('封口尚未拆开。')
    expect((await confirmAuthorStageFixture(s, old)).ok).toBe(false)
    const current = await stageAuthorStageFixture(s)
    expect((await confirmAuthorStageFixture(s, current)).ok).toBe(true)
    await revise('请先看封口。')
    expect((await db.productBuildArtifacts.get(current.id!))!).toMatchObject({ status: 'invalid', payloadJson: current.payloadJson })
    expect((await db.productBuildArtifacts.get(old.id!))!.status).toBe('pending')
    await expect(compileAdoptedAvgBuildV2({ ...(await stageInput(s)), product: { key:'avg.author.fixture',title:'新文本',description:'' } })).rejects.toThrow(/未采用/)
  })

  it('round-trips an adopted assembly and pending editable workspace across remapped IDs, then deletes only the imported Work', async () => {
    const s = await seedAvgAuthorStageInputs(), candidate = await stageAuthorStageFixture(s)
    expect((await confirmAuthorStageFixture(s, candidate)).ok).toBe(true)
    const draft = await readAvgDraftV1(s.scope)
    const workspace = avgAuthorWorkspaceFixture()
    workspace.mediaBatch = await freezeAvgVisualProductionBatchV1({ schema: 'storyforge.avg.visual-production-batch', version: 1,
      batchKey: 'portable.pending', revision: 1, requirements: [{
        requirementKey: 'desk.background', revision: 1, assetKey: 'avg.generated.desk', name: '桌前背景', altText: '原创背景需求',
        family: { subjectKey: 'desk', familyKey: 'desk.view', variantKey: 'day', revision: 1 },
        consumer: { consumerKey: 'desk.background', domain: 'stage', slot: 'background', subjectKey: 'desk', sceneKey: 'desk', lineKey: null, required: true, fallback: 'none' },
        triggerBeatKey: 'line.desk', itemVariantKey: null, mediaKind: 'background', prompt: '原创桌前场景', negativePrompt: '', invariants: [], forbiddenDepictions: [],
        width: 1536, height: 864, resolutionTier: '1K', alpha: 'not-required', references: [],
      }] }, workspace)
    await saveAvgAuthorWorkspaceV1(s.scope, draft.revision, workspace)
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const build = (await db.productBuilds.where('projectId').equals(projectId).first())!
    const scope = { projectId, worldId: build.worldId, workId: build.workId }
    const compiled = await compileAdoptedAvgBuildV2({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch,
      product: { key: 'avg.author.fixture', title: '恢复后的组装', description: '' } })
    expect(compiled.source.authorStage!.artifact.contentHash).toBe(candidate.contentHash)
    expect((await readAvgDraftV1(scope)).editorJson).toBe((await readAvgDraftV1(s.scope)).editorJson)
    expect(parseAvgAuthorWorkspaceV1((await readAvgDraftV1(scope)).editorJson).mediaBatch).toEqual(workspace.mediaBatch)
    expect(build.id).not.toBe(s.buildId)
    await deleteWork(projectId, scope.workId)
    expect(await db.avgAuthoringDrafts.where('projectId').equals(projectId).count()).toBe(0)
    expect((await db.productBuildArtifacts.get(candidate.id!))!.status).toBe('accepted')
  })
})
