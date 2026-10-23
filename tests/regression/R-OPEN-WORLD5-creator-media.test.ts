import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  assertTextOpenWorldCreatorMediaPreparationCurrentV1,
  prepareTextOpenWorldCreatorMediaV1,
} from '../../src/lib/open-world/creator-media'
import {
  readTextOpenWorldCreatorMediaExecutionAuthorityV1,
  resolveTextOpenWorldCreatorImportedMediaTaskResultV1,
  readTextOpenWorldCreatorMediaTaskBudgetV1,
} from '../../src/lib/open-world/creator-media-authority'
import { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } from '../../src/lib/open-world/creator-derived-authority'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { verifyTextOpenWorldMediaRightsV1 } from '../../src/lib/open-world/media-quality'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { setProductProductionPausedV1 } from '../../src/lib/product-production/service'
import { parseProductProductionCommandV1 } from '../../src/lib/product-production/contracts'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import { putMediaBlobObject } from '../../src/lib/product-production/media-blob-store'
import { resolveTrustedRelayMediaCapabilityV1 } from '../../src/lib/product-production/media-transport'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type {
  ProductBuildArtifactRecordV1,
  ProductProductionPlanV3,
  TextOpenWorldMediaRequirementsV1,
} from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from '../helpers/text-open-world-creator-build'

const governance = vi.hoisted(() => ({
  productionId: 0,
  productionStateRevision: 0,
  buildId: 0,
  buildNumber: 0,
  planHash: '',
  artifactKeys: [] as string[],
}))

vi.mock('../../src/lib/open-world/creator-artifact-governance', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/open-world/creator-artifact-governance')>()
  return {
    ...actual,
    readTextOpenWorldArtifactGovernanceV1: vi.fn(async () => ({
      production: { id: governance.productionId, stateRevision: governance.productionStateRevision },
      build: { id: governance.buildId, buildNumber: governance.buildNumber, planHash: governance.planHash },
      summary: {
        currentProblemArtifactCount: 0,
        currentProductionValidatedArtifactCount: governance.artifactKeys.length,
      },
      artifacts: governance.artifactKeys.map(artifactKey => ({
        artifactKey,
        currentEpoch: true,
        health: 'verified',
        productionValidation: 'production-validated',
        artifactStatus: 'accepted',
      })),
    })),
  }
})

const PNG_1X1 = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
), char => char.charCodeAt(0)).buffer

/** A valid PNG with a large ancillary text chunk exercises file bytes, not pixel count. */
function pngWithLargeMetadata() {
  const content = new Uint8Array(1024 * 1024)
  content.set(new TextEncoder().encode('Comment\0'))
  content.fill(65, 8)
  const chunk = new Uint8Array(content.length + 12)
  new DataView(chunk.buffer).setUint32(0, content.length)
  chunk.set(new TextEncoder().encode('tEXt'), 4)
  chunk.set(content, 8)
  let crc = 0xffffffff
  for (const byte of chunk.subarray(4, chunk.length - 4)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  new DataView(chunk.buffer).setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0)
  const png = new Uint8Array(PNG_1X1.byteLength + chunk.length)
  const end = PNG_1X1.byteLength - 12
  png.set(new Uint8Array(PNG_1X1, 0, end))
  png.set(chunk, end)
  png.set(new Uint8Array(PNG_1X1, end), end + chunk.length)
  return png.buffer
}

function fixtureVisualSlots() {
  return [
    ...Array.from({ length: 12 }, (_, index) => ({
      key: `media.background.${String(index + 1).padStart(3, '0')}`,
      kind: 'scene-background' as const,
      subjectKey: `location.creator-test.${String(index + 1).padStart(3, '0')}`,
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      key: `media.portrait.${String(index + 1).padStart(3, '0')}`,
      kind: 'character-portrait' as const,
      subjectKey: `actor.creator-test.${String(index + 1).padStart(3, '0')}`,
    })),
  ]
}

async function mediaRequirements(input: {
  productInstanceKey: string
}): Promise<TextOpenWorldMediaRequirementsV1> {
  const hash = 'a'.repeat(64)
  const slot = (
    key: string,
    order: number,
    kind: TextOpenWorldMediaRequirementsV1['slots'][number]['kind'],
    subjectKey: string,
    productionMode: TextOpenWorldMediaRequirementsV1['slots'][number]['productionMode'],
    fallback: TextOpenWorldMediaRequirementsV1['slots'][number]['fallback'],
  ): TextOpenWorldMediaRequirementsV1['slots'][number] => ({
    key,
    order,
    kind,
    subjectKind: kind === 'character-portrait' ? 'actor' : kind === 'scene-background' ? 'location' : 'world',
    subjectKey,
    title: key,
    creativeBrief: `测试媒资需求:${key}`,
    required: true,
    productionMode,
    fallback,
    sourceArtifactKey: 'text-open-world.presentation-profile',
    sourceEntityKey: hash,
    consumerKeys: ['play.scene'],
  })
  const body = {
    schema: 'storyforge.text-open-world-media-requirements' as const,
    version: 1 as const,
    productType: 'text-open-world' as const,
    productInstanceKey: input.productInstanceKey,
    presentationProfileHash: hash,
    npcRuntimeCatalogHash: hash,
    mapInteractionCatalogHash: hash,
    sceneScriptsHash: hash,
    slots: [
      slot('media.map', 1, 'procedural-map', input.productInstanceKey, 'procedural-code', 'procedural-svg'),
      ...fixtureVisualSlots().map((item, index) => slot(
        item.key,
        index + 2,
        item.kind,
        item.subjectKey,
        'generate-or-import',
        'text-description',
      )),
    ],
    coverage: {
      requiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background'] as const,
      coveredRequiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background'] as const,
      requiredActorKeys: fixtureVisualSlots().filter(item => item.kind === 'character-portrait').map(item => item.subjectKey),
      coveredActorKeys: fixtureVisualSlots().filter(item => item.kind === 'character-portrait').map(item => item.subjectKey),
      requiredRegionKeys: ['region.creator-test'],
      coveredRegionKeys: ['region.creator-test'],
      requiredSlotKeys: ['media.map', ...fixtureVisualSlots().map(item => item.key)],
      fallbackReadySlotKeys: ['media.map', ...fixtureVisualSlots().map(item => item.key)],
      missingRequiredSlotKeys: [] as [],
    },
    productionBudget: {
      requestedGeneratedSlotCount: 18,
      authorizedMaximumMediaCalls: 18,
      fitsAuthorizedMediaCalls: true,
      overflowSlotKeys: [] as string[],
    },
    governance: {
      requirementsDerivedAfterContent: true as const,
      mediaNeverBlocksTextFallback: true as const,
      proceduralMapRequiresNoModelCall: true as const,
      everyRequiredSlotHasFallback: true as const,
      rightsCheckedAtAssetAcceptance: true as const,
    },
    basisHash: hash,
    createdAt: 1,
  }
  return {
    ...body,
    mediaRequirementsHash: await hashProductProductionValueV2(body),
  }
}

interface FixtureV1 {
  scope: Awaited<ReturnType<typeof seedCurrentProductWorld>>['scope']
  productionId: number
  buildId: number
  buildNumber: number
  plan: ProductProductionPlanV3
}

async function seedMediaFixture(): Promise<FixtureV1> {
  const world = await seedCurrentProductWorld(`G5-08 media ${crypto.randomUUID()}`)
  const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
    source: {
      kind: 'world-release',
      scope: world.scope,
      localReleaseRecordId: world.release.id!,
      expectedReleaseHash: world.release.contentHash,
    },
    sessionKey: `g5-08-media-${crypto.randomUUID()}`,
  })
  const build = (await db.productBuilds.get(creator.buildId))!
  const production = (await db.productProductions.get(creator.productionId))!
  const plan = JSON.parse(build.planJson) as ProductProductionPlanV3
  const visualTask = plan.tasks.find(task => task.taskKey === 'media.visual')!
  expect(visualTask.outputArtifactKeys).toHaveLength(18)
  const requirements = await mediaRequirements({
    productInstanceKey: creator.productionKey,
  })
  const now = Date.now()
  const rows: ProductBuildArtifactRecordV1[] = []
  for (const task of plan.tasks) {
    for (const [index, artifactKey] of task.outputArtifactKeys.entries()) {
      const payload = artifactKey === 'text-open-world.media-requirements'
        ? requirements
        : { schema: artifactKey, version: 1, marker: `base:${artifactKey}` }
      const payloadJson = canonicalProductProductionJsonV2(payload)
      const isVisual = task.taskKey === 'media.visual'
      const mediaKind = isVisual
        ? fixtureVisualSlots()[index]!.kind === 'scene-background' ? 'background' : 'character-pose'
        : null
      const row = stampNewRecord(world.scope, 'productBuildArtifacts', {
        projectId: world.scope.projectId,
        worldId: world.scope.worldId,
        workId: world.scope.workId,
        buildId: build.id!,
        artifactKey,
        requirementKey: isVisual ? visualTask.capabilityRequirementKeys[0] : null,
        version: 1,
        kind: isVisual ? 'image' : artifactKey,
        mediaKind,
        status: 'accepted' as const,
        producerRunId: 10_000 + rows.length,
        producerReceiptHash: await hashProductProductionValueV2({ artifactKey, receipt: true }),
        controlEpoch: build.controlEpoch,
        inputHash: await hashProductProductionValueV2({ artifactKey, input: true }),
        contentHash: await hashProductProductionValueV2(payload),
        payloadJson,
        metadataJson: isVisual ? canonicalProductProductionJsonV2({
          assetKey: `${creator.productionKey}.${artifactKey}`,
          source: 'storyforge-procedural-svg-v1',
          license: 'CC0-1.0',
        }) : '{}',
        qualityJson: '{}',
        rightsJson: '{}',
        blobObjectId: null,
        mimeType: isVisual ? 'image/svg+xml' : null,
        byteSize: new TextEncoder().encode(payloadJson).byteLength,
        parentArtifactHash: null,
        carriedFrom: null,
        createdAt: now,
        updatedAt: now,
      } as never, { owner: 'work' })
      const id = await db.productBuildArtifacts.add(row) as number
      rows.push({ ...row, id } as ProductBuildArtifactRecordV1)
    }
  }
  const manifestHash = await hashProductProductionValueV2({ build: build.buildNumber, rows: rows.length })
  const rootTerminalReceiptHash = await hashProductProductionValueV2({ manifestHash, terminal: true })
  await db.productBuilds.update(build.id!, {
    status: 'release-ready',
    stateRevision: build.stateRevision + 1,
    manifestHash,
    rootTerminalReceiptHash,
    packageHash: await hashProductProductionValueV2({ package: true }),
    completedAt: now,
    updatedAt: now,
  })
  const productionStateRevision = production.stateRevision + 1
  await db.productProductions.update(production.id!, {
    status: 'preview-ready',
    stateRevision: productionStateRevision,
    updatedAt: now,
  })
  governance.productionId = production.id!
  governance.productionStateRevision = productionStateRevision
  governance.buildId = build.id!
  governance.buildNumber = build.buildNumber
  governance.planHash = build.planHash
  governance.artifactKeys = plan.tasks.flatMap(task => task.outputArtifactKeys)
  return {
    scope: world.scope,
    productionId: production.id!,
    buildId: build.id!,
    buildNumber: build.buildNumber,
    plan,
  }
}

async function importedPreparation(fixture: FixtureV1, data = PNG_1X1) {
  const blob = await putMediaBlobObject({
    scope: fixture.scope,
    data,
    mimeType: 'image/png',
    backend: 'indexeddb',
  })
  const derived = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
    scope: fixture.scope,
    buildId: fixture.buildId,
  })
  const visual = derived.productionPlan.tasks.find(task => task.taskKey === 'media.visual')!
  const visualSlots = fixtureVisualSlots()
  return prepareTextOpenWorldCreatorMediaV1({
    scope: fixture.scope,
    productionId: fixture.productionId,
    buildId: fixture.buildId,
    mode: 'author-import',
    imports: visual.outputArtifactKeys.map((artifactKey, index) => ({
      artifactKey,
      slotKey: visualSlots[index]!.key,
      blobObjectId: blob.id!,
      name: `导入图片${index + 1}`,
      altText: `可访问替代文本${visualSlots[index]!.subjectKey}`,
      source: '作者本地导入',
      license: '当前产品永久使用许可',
      rightsBasis: 'author-owned',
      rightsNote: '作者确认拥有完整权利。',
    })),
  })
}

describe.sequential('Text Open World G5-08 · governed Creator media Build', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    governance.productionId = 0
    governance.productionStateRevision = 0
    governance.buildId = 0
    governance.buildNumber = 0
    governance.planHash = ''
    governance.artifactKeys = []
  })
  afterAll(() => db.close())

  it('imports the complete visual sibling group into an immutable adjacent child Build', async () => {
    const fixture = await seedMediaFixture()
    const prepared = await importedPreparation(fixture)
    expect(prepared.mediaPlan.staleTaskKeys).toContain('media.visual')
    expect(prepared.mediaPlan.staleTaskKeys).toContain('v3.runtime-package')
    expect(prepared.mediaPlan.staleTaskKeys).toContain('qa.release')
    expect(prepared.mediaPlan.reuseTaskKeys).toContain('p0.source-lock')
    expect(prepared.mediaPlan.requiredCoverage).toEqual({
      proceduralMapReady: true,
      portraitSlotCount: 6,
      backgroundSlotCount: 12,
      audioFallback: 'silent',
    })
    expect(prepared.mediaPlan.estimatedRerunBudget.mediaCalls).toBe(0)
    await expect(assertTextOpenWorldCreatorMediaPreparationCurrentV1(prepared)).resolves.toBeUndefined()

    const command = {
      type: 'authorize-text-open-world-creator-media' as const,
      commandId: `g5-08-import:${crypto.randomUUID()}`,
      expectedStateRevision: prepared.production.stateRevision,
      baseBuildNumber: prepared.baseBuild.buildNumber,
      expectedBasePlanHash: prepared.baseBuild.planHash,
      expectedMediaPlanHash: prepared.mediaPlan.planHash,
      expectedTargetPlanHash: prepared.targetPlanHash,
      mode: prepared.mediaPlan.mode,
      acknowledgement: {
        completeBundle: true as const,
        rightsAndProvenance: true as const,
        costAndProvider: true as const,
        oldBuildImmutable: true as const,
      },
      authorizationNonce: 'g5-08-import-confirmed',
      authorizedAt: Date.now() + 1,
    }
    expect(parseProductProductionCommandV1(command)).toEqual(command)
    expect(() => parseProductProductionCommandV1({
      ...command,
      acknowledgement: { ...command.acknowledgement, rightsAndProvenance: false },
    })).toThrow(/四项作者确认不完整/)
    expect(() => parseProductProductionCommandV1({ ...command, unexpected: true }))
      .toThrow(/字段不精确/)
    const receipt = await executeProductProductionCommand({
      scope: fixture.scope,
      productionId: fixture.productionId,
      command,
      preparedCreatorMedia: prepared,
    })
    expect(receipt).toMatchObject({ ok: true, replayed: false, commandType: command.type })
    await expect(executeProductProductionCommand({
      scope: fixture.scope,
      productionId: fixture.productionId,
      command,
    })).resolves.toMatchObject({
      ok: true,
      replayed: true,
      commandType: command.type,
      result: receipt.result,
    })
    const target = await db.productBuilds.where('[productionId+buildNumber]')
      .equals([fixture.productionId, fixture.buildNumber + 1]).first()
    expect(target).toMatchObject({
      parentBuildNumber: fixture.buildNumber,
      status: 'authorized',
      planHash: prepared.targetPlanHash,
    })
    const candidates = await db.productBuildArtifacts.where('[buildId+status]')
      .equals([target!.id!, 'candidate']).toArray()
    expect(candidates).toHaveLength(18)
    expect(candidates.every(row => row.blobObjectId != null && row.rightsJson.includes('author-owned'))).toBe(true)

    const authority = await readTextOpenWorldCreatorMediaExecutionAuthorityV1({
      scope: fixture.scope,
      buildId: target!.id!,
    })
    const generic = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
      scope: fixture.scope,
      buildId: target!.id!,
    })
    expect(generic.origin).toBe('creator-media-v1')
    const direct = await resolveTextOpenWorldCreatorImportedMediaTaskResultV1({
      authority,
      taskKey: 'media.visual',
    })
    expect(direct?.result).toMatchObject({
      usage: { modelCalls: 0, mediaCalls: 0, costUsd: 0 },
    })
    expect(direct?.result.artifacts).toHaveLength(18)
    expect(direct?.authorizedStorageBytes).toBe(PNG_1X1.byteLength * 18)

    const imported = candidates[0]
    const imageRequirement = authority.executionBrief.capabilityRequirements.find(item => (
      item.requirementKey === imported.requirementKey
    ))!
    await expect(verifyTextOpenWorldMediaRightsV1({
      artifact: imported,
      qualityProfile: 'commercial-candidate',
      capabilityRequirement: imageRequirement,
    })).resolves.toMatchObject({
      origin: 'imported',
      rightsBasis: 'author-owned',
      commercialPolicyPassed: true,
    })
    // A scheduler acceptance receipt is distinct from the original import
    // command. These are structural validator cases, not a synthetic Run.
    const accepted: ProductBuildArtifactRecordV1 = {
      ...imported, status: 'accepted', producerReceiptHash: 'e'.repeat(64),
    }
    const verifyAccepted = (artifact = accepted, importAuthorizations = [authority.authorization]) => (
      verifyTextOpenWorldMediaRightsV1({
        artifact, qualityProfile: 'commercial-candidate', capabilityRequirement: imageRequirement,
        importAuthorizations,
      })
    )
    await expect(verifyAccepted()).resolves.toMatchObject({
      producerReceiptHash: accepted.producerReceiptHash, origin: 'imported', commercialPolicyPassed: true,
    })
    await expect(verifyAccepted({ ...accepted, status: 'carried-forward',
      controlEpoch: accepted.controlEpoch + 1 })).resolves.toMatchObject({ commercialPolicyPassed: true })
    await expect(verifyAccepted(accepted, [])).rejects.toThrow(/唯一授权/)
    await expect(verifyTextOpenWorldMediaRightsV1({
      artifact: accepted, qualityProfile: 'commercial-candidate', capabilityRequirement: imageRequirement,
    })).rejects.toThrow(/授权谱系/)
    await expect(verifyAccepted({ ...accepted, qualityJson: canonicalProductProductionJsonV2({
      ...JSON.parse(accepted.qualityJson), authorizationHash: 'f'.repeat(64),
    }) })).rejects.toThrow(/物理校验回执不闭合/)
    await expect(verifyAccepted({ ...accepted, rightsJson: canonicalProductProductionJsonV2({
      ...JSON.parse(accepted.rightsJson), rightsNote: 'changed after the import command',
    }) })).rejects.toThrow(/已签署文件或权利清单不一致/)
    await expect(verifyAccepted({ ...accepted, byteSize: accepted.byteSize + 1 }))
      .rejects.toThrow(/已签署文件或权利清单不一致/)
    for (const expected of ['paused', 'resumed']) {
      expect(await setProductProductionPausedV1({ scope: fixture.scope,
        production: (await db.productProductions.get(fixture.productionId))!,
        build: (await db.productBuilds.get(target!.id!))!,
      })).toBe(expected)
    }
    // This authority fixture models the scheduler's atomic Plan rebind; it
    // does not claim to run a production DAG or a real import in a browser.
    const resumed = (await db.productBuilds.get(target!.id!))!
    const reboundPlan = { ...prepared.targetPlan, controlEpoch: resumed.controlEpoch,
      tasks: prepared.targetPlan.tasks.map(task => ({ ...task, reuse: null })) }
    await db.productBuilds.update(target!.id!, { planJson: canonicalProductProductionJsonV2(reboundPlan),
      planHash: await hashProductProductionValueV2(reboundPlan) })
    const readAuthority = () => readTextOpenWorldCreatorMediaExecutionAuthorityV1({
      scope: fixture.scope, buildId: target!.id! })
    const recovered = await readAuthority()
    expect(recovered.targetProductionPlan.controlEpoch).toBe(resumed.controlEpoch)
    const recoveredImport = await resolveTextOpenWorldCreatorImportedMediaTaskResultV1({
      authority: recovered, taskKey: 'media.visual' })
    expect(recoveredImport?.result).toEqual(direct?.result)
    for (const mutated of [
      { ...reboundPlan, controlEpoch: resumed.controlEpoch + 1 },
      { ...reboundPlan, tasks: prepared.targetPlan.tasks },
      { ...reboundPlan, tasks: reboundPlan.tasks.map(task => task.taskKey === 'media.visual'
        ? { ...task, budgetReservation: { ...task.budgetReservation, maximumCostUsd: 99 } } : task) },
    ]) {
      await db.productBuilds.update(target!.id!, { planJson: canonicalProductProductionJsonV2(mutated),
        planHash: await hashProductProductionValueV2(mutated) })
      await expect(readAuthority()).rejects.toThrow()
    }
    await db.productBuilds.update(target!.id!, { planJson: canonicalProductProductionJsonV2(reboundPlan),
      planHash: await hashProductProductionValueV2(reboundPlan) })
    await db.productBuildArtifacts.update(imported.id!, { controlEpoch: resumed.controlEpoch })
    await expect(readAuthority()).rejects.toThrow(/完整暂存sibling/)
  }, 30_000)

  it('uses signed import bytes above procedural storage while preserving the frozen Plan and total ceiling', async () => {
    const fixture = await seedMediaFixture()
    const png = pngWithLargeMetadata()
    const prepared = await importedPreparation(fixture, png)
    const importedBytes = png.byteLength * 18
    const oldBudget = fixture.plan.tasks.find(task => task.taskKey === 'media.visual')!.budgetReservation
    expect(importedBytes).toBeGreaterThan(oldBudget.storageBytes)
    expect(() => parseProductProductionPlanV3(prepared.targetPlan, prepared.targetExecutionBrief))
      .not.toThrow()
    const command = {
      type: 'authorize-text-open-world-creator-media' as const,
      commandId: `g5-08-large:${crypto.randomUUID()}`,
      expectedStateRevision: prepared.production.stateRevision,
      baseBuildNumber: prepared.baseBuild.buildNumber,
      expectedBasePlanHash: prepared.baseBuild.planHash,
      expectedMediaPlanHash: prepared.mediaPlan.planHash,
      expectedTargetPlanHash: prepared.targetPlanHash,
      mode: prepared.mediaPlan.mode,
      acknowledgement: {
        completeBundle: true as const, rightsAndProvenance: true as const,
        costAndProvider: true as const, oldBuildImmutable: true as const,
      },
      authorizationNonce: 'g5-08-large-confirmed',
      authorizedAt: Date.now() + 1,
    }
    expect((await executeProductProductionCommand({
      scope: fixture.scope, productionId: fixture.productionId, command, preparedCreatorMedia: prepared,
    })).ok).toBe(true)
    const target = (await db.productBuilds.where('[productionId+buildNumber]')
      .equals([fixture.productionId, fixture.buildNumber + 1]).first())!
    const commandRow = (await db.productProductionCommands.where('[productionId+commandId]')
      .equals([fixture.productionId, command.commandId]).first())!

    const authorization = JSON.parse(commandRow.resultJson)
    const frozenBefore = (await db.productBuilds.get(target.id!))!
    const authority = await readTextOpenWorldCreatorMediaExecutionAuthorityV1({
      scope: fixture.scope, buildId: target.id!,
    })
    expect(authority.authorization.plan.version).toBe(1)
    const imported = await resolveTextOpenWorldCreatorImportedMediaTaskResultV1({
      authority, taskKey: 'media.visual',
    })
    expect(imported?.authorizedStorageBytes).toBe(importedBytes)
    const task = prepared.targetPlan.tasks.find(task => task.taskKey === 'media.visual')!
    const readBudget = () => readTextOpenWorldCreatorMediaTaskBudgetV1({
      scope: fixture.scope, buildId: target.id!, task,
    })
    expect(await readBudget()).toMatchObject({
      storageBytes: importedBytes, modelCalls: 0, inputTokens: 0, outputTokens: 0,
      mediaCalls: 0, maximumCostUsd: 0,
    })
    expect(imported?.result.usage).toMatchObject({
      storageBytes: importedBytes, modelCalls: 0, mediaCalls: 0, costUsd: 0,
    })
    expect(await db.productBuilds.get(target.id!)).toEqual(frozenBefore)
    expect(authority.executionBrief.productionBudget).toEqual(prepared.sourceExecutionBrief.productionBudget)
    await expect(readTextOpenWorldCreatorMediaTaskBudgetV1({
      scope: fixture.scope, buildId: target.id!,
      task: { ...task, budgetReservation: { ...task.budgetReservation, storageBytes: importedBytes * 2 } },
    })).rejects.toThrow(/预算任务不属于已签署Plan/)

    const { planHash: _mediaHash, ...mediaBody } = authorization.plan
    const { authorizationHash: _authorizationHash, ...authorizationBody } = authorization
    const badMediaBody = {
      ...mediaBody,
      estimatedRerunBudget: { ...mediaBody.estimatedRerunBudget, storageBytes: importedBytes - 1 },
    }
    const badMedia = { ...badMediaBody, planHash: await hashProductProductionValueV2(badMediaBody) }
    const badAuthorizationBody = { ...authorizationBody, plan: badMedia, mediaPlanHash: badMedia.planHash }
    await db.productProductionCommands.update(commandRow.id!, {
      resultJson: canonicalProductProductionJsonV2({
        ...badAuthorizationBody, authorizationHash: await hashProductProductionValueV2(badAuthorizationBody),
      }),
    })
    await expect(readTextOpenWorldCreatorMediaExecutionAuthorityV1({
      scope: fixture.scope, buildId: target.id!,
    })).rejects.toThrow(/media预算不符合签署/)
  }, 30_000)

  it('freezes a real provider identity and positive cost without dispatching during preview', async () => {
    const fixture = await seedMediaFixture()
    const derived = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
      scope: fixture.scope,
      buildId: fixture.buildId,
    })
    const task = derived.productionPlan.tasks.find(item => item.taskKey === 'media.visual')!
    const requirement = derived.contracts.executionBrief.capabilityRequirements.find(item => (
      item.requirementKey === task.capabilityRequirementKeys[0]
    ))!
    const fetcher = vi.fn()
    const provider = await resolveTrustedRelayMediaCapabilityV1({
      requirement,
      relayUrl: 'https://media.storyforge.example/relay',
      environment: 'test',
      fetcher,
      now: 100,
    })
    const prepared = await prepareTextOpenWorldCreatorMediaV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
      mode: 'provider-generate',
      provider,
      maximumCostUsd: 2.5,
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(prepared.mediaPlan.capability).toMatchObject({
      execution: 'provider',
      adapterId: 'openai.gpt-image-2.v1',
      maximumCostUsd: 2.5,
    })
    expect(prepared.targetExecutionBrief.productionBudget.maximumCostUsd)
      .toBe(prepared.sourceExecutionBrief.productionBudget.maximumCostUsd! + 2.5)
    expect(prepared.targetPlan.tasks.find(item => item.taskKey === 'media.visual')?.budgetReservation.maximumCostUsd)
      .toBe(2.5)
  }, 30_000)

  it('fails closed when a prepared import Blob changes before authorization', async () => {
    const fixture = await seedMediaFixture()
    const prepared = await importedPreparation(fixture)
    await db.mediaBlobObjects.update(prepared.imports[0].blobObjectId, { storageState: 'corrupt' })
    await expect(assertTextOpenWorldCreatorMediaPreparationCurrentV1(prepared))
      .rejects.toThrow(/读取集合已变化|已变化|尚未 ready/)
  }, 30_000)
})
