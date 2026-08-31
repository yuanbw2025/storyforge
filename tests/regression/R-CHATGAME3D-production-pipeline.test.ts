import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  confirmCharacterInteractionBriefV1,
  createCharacterInteractionProductionV1,
} from '../../src/lib/character-interaction/production'
import {
  assertCharacterInteractionProductReleaseUnchangedV1,
  attachCharacterInteractionMediaAssetV1,
  createCharacterInteractionWorldFeedbackCandidateV1,
  degradeCharacterInteractionMediaAssetV1,
  generateCharacterInteractionStepCandidateV1,
  confirmCharacterInteractionStepCandidateV1,
  publishCharacterInteractionProductReleaseV1,
  prepareCharacterInteractionStepDraftV1,
  readCharacterInteractionProductionDetailsV1,
  prepareCharacterInteractionWorldUpgradeCandidateV1,
  applyCharacterInteractionWorldUpgradeV1,
  recoverInterruptedCharacterInteractionProductionsV1,
  type CharacterInteractionCapsulesArtifactV1,
  type CharacterInteractionMediaBibleArtifactV1,
  type CharacterInteractionScenePlanArtifactV1,
} from '../../src/lib/character-interaction/production-pipeline'
import { runCharacterInteractionProductionStepV1 } from '../../src/lib/character-interaction/production-harness'
import { loadCharacterInteractionWorldSourceCatalogV1 } from '../../src/lib/character-interaction/world-source'
import { CHARACTER_INTERACTION_PRODUCTION_STEPS_V1, type WorkspaceScope } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/world-engine/create-workspace'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { stampNewRecord } from '../../src/lib/world-engine/scope'
import { createInteractionGameInstance } from '../../src/lib/world-engine/instances'
import { collectUnreferencedMediaBlobObjects } from '../../src/lib/game-production/media-blob-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'

async function fixture(mediaTier: 'text-core' | 'portrait-standard' | 'voice-optional' = 'text-core') {
  const now = Date.now()
  const owned = await createWorkspace({
    name: '角色互动生产闭环', genre: 'drama', genres: ['drama'], status: 'drafting',
    description: 'CI-3 到 CI-5', targetWordCount: 20_000, createdAt: now, updatedAt: now,
  } as any, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const projectId = owned.scope.projectId
  for (const [index, name] of ['岑星', '白榆'].entries()) {
    await db.characters.add(stampNewRecord(owned.scope, 'characters', {
      projectId, name, role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: `${name}经历过旧港停战。`, appearance: '', personality: '克制', background: '旧港居民',
      motivation: '重新理解彼此', abilities: '', relationships: '[]', arc: '终局后的新生活',
      speechStyle: '谨慎简短', createdAt: now + index, updatedAt: now + index,
    } as any, { owner: 'world' }))
  }
  const revision = await createWorldRevision({ scope: owned.scope, label: '角色互动生产来源' })
  const release = await publishWorldRevision(revision.id!, '角色互动生产来源 v1')
  const catalog = await loadCharacterInteractionWorldSourceCatalogV1({ scope: owned.scope, worldReleaseId: release.id! })
  const created = await createCharacterInteractionProductionV1({
    scope: owned.scope, productionKey: 'old-harbor-living-chat', worldReleaseId: release.id!,
    participantCharacterExportIds: catalog.records.characters!.map(item => item.exportId),
    brief: {
      title: '旧港余生', userInstruction: '和两位旧友回忆往事并处理新的灯塔异响。', userRole: 'self',
      storyMode: 'new-event', timeContext: '停战十年后', locationContext: '守潮灯塔',
      historicalContext: '原故事已经完结。', chatGoal: '在日常相处中调查异响。',
      desiredDirections: ['叙旧', '调查'], safetyBoundaries: ['不推翻终局'],
      publicKnowledge: ['停战已经十年'], privateKnowledge: ['匿名信仍未拆开'],
      prohibitedDisclosure: ['调查前不揭露寄信人'], sceneCount: 2, maxTurnsPerScene: 40,
      directorBudget: 8, endingStrategy: 'user-decides', mediaTier,
      allowWorldFeedbackCandidate: true,
    },
  })
  const confirmed = await confirmCharacterInteractionBriefV1({ scope: owned.scope, productionId: created.production.id })
  return { ...owned, projectId, release, confirmed }
}

async function formalCandidate(input: {
  scope: WorkspaceScope
  productionId: number
  stepKey: (typeof CHARACTER_INTERACTION_PRODUCTION_STEPS_V1)[number]
}) {
  if (!['character-capsules', 'scene-plan', 'media-bible'].includes(input.stepKey)) {
    return generateCharacterInteractionStepCandidateV1(input)
  }
  const base = await prepareCharacterInteractionStepDraftV1(input)
  const proposal = input.stepKey === 'character-capsules'
    ? {
        refinements: (base as CharacterInteractionCapsulesArtifactV1).capsules.map(item => ({
          participantKey: item.participantKey,
          identitySummary: item.identitySummary,
          voiceRules: item.voiceRules,
          publicStance: item.publicStance,
          privateAnchor: item.privateAnchor,
        })),
      }
    : input.stepKey === 'scene-plan'
      ? {
          refinements: (base as CharacterInteractionScenePlanArtifactV1).scenes.map(item => ({
            sceneKey: item.sceneKey,
            title: item.title,
            purpose: item.purpose,
            goals: item.goals,
            endingConditions: item.endingConditions,
          })),
        }
      : {
          styleDescription: (base as CharacterInteractionMediaBibleArtifactV1).style.description,
          slots: (base as CharacterInteractionMediaBibleArtifactV1).slots.map(item => ({
            slotKey: item.slotKey,
            prompt: item.prompt,
            fallbackText: item.fallbackText,
            altText: item.altText,
          })),
        }
  return (await runCharacterInteractionProductionStepV1({
    ...input,
    stepKey: input.stepKey as 'character-capsules' | 'scene-plan' | 'media-bible',
    runAI: async () => JSON.stringify({
      schema: 'storyforge.character-interaction-ai-step-proposal',
      version: 1,
      stepKey: input.stepKey,
      proposal,
    }),
  })).artifact
}

describe('CHATGAME-3D · CI-3..5 产品生产、发布与运行候选闭环', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('强制顺序候选与逐步人工确认，最终产生不可变 Product/Game Release 并可创建多人 Instance', async () => {
    const owned = await fixture()
    await expect(generateCharacterInteractionStepCandidateV1({
      scope: owned.scope, productionId: owned.confirmed.production.id, stepKey: 'scene-plan',
    })).rejects.toThrow('必须先确认前置步骤')

    for (const stepKey of CHARACTER_INTERACTION_PRODUCTION_STEPS_V1) {
      const candidate = await formalCandidate({
        scope: owned.scope, productionId: owned.confirmed.production.id, stepKey,
      })
      expect(candidate).toMatchObject({ status: 'candidate', sourceSelectionHash: owned.confirmed.selection.selectionHash })
      await confirmCharacterInteractionStepCandidateV1({
        scope: owned.scope, productionId: owned.confirmed.production.id, artifactId: candidate.id!,
      })
    }
    const ready = await readCharacterInteractionProductionDetailsV1({ scope: owned.scope, productionId: owned.confirmed.production.id })
    expect(ready.production.status).toBe('release-ready')
    expect(ready.steps.filter(step => step.status === 'confirmed')).toHaveLength(CHARACTER_INTERACTION_PRODUCTION_STEPS_V1.length)
    expect(ready.mediaAssets).toHaveLength(0)

    const published = await publishCharacterInteractionProductReleaseV1({
      scope: owned.scope, productionId: owned.confirmed.production.id,
    })
    expect(published.productRelease.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(published.productRelease.releaseUid).toMatch(/^PR-character-interaction-/)
    expect(published.productRelease.sourceManifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(published.productRelease.lineageHash).toMatch(/^[a-f0-9]{64}$/)
    const sourceManifest = JSON.parse(published.productRelease.sourceManifestJson!)
    expect(sourceManifest.runContextManifests).toHaveLength(3)
    expect(sourceManifest.runContextManifests.every((item: Record<string, unknown>) => !('runId' in item))).toBe(true)
    expect(published.gameRelease.gameDefinitionId).toBeNull()
    const manifest = await assertCharacterInteractionProductReleaseUnchangedV1({
      scope: owned.scope, productReleaseId: published.productRelease.id!,
    })
    expect(manifest.source.selection.productType).toBe('character-interaction')
    expect(manifest.sourceContracts.sourceManifestHash).toBe(published.productRelease.sourceManifestHash)
    expect(JSON.stringify(manifest)).not.toContain('characterId')

    const session = await createInteractionGameInstance({
      scope: owned.scope, gameReleaseId: published.gameRelease.id!, title: '旧港余生 · 新会话',
    })
    const state = JSON.parse(session.initialStateJson)
    expect(state.interaction.profiles).toHaveLength(2)
    expect(state.interaction.sceneTemplates).toHaveLength(2)
    const feedback = await createCharacterInteractionWorldFeedbackCandidateV1({
      scope: owned.scope, simulationSessionId: session.id!, authorInstruction: '整理值得回到世界引擎审阅的新事实。',
    })
    expect(feedback).toMatchObject({ kind: 'world-feedback-candidate', status: 'candidate', sourceSessionId: session.id })
    expect(await db.worldRevisions.count()).toBe(1)

    const exported = await exportProjectJSON(owned.projectId)
    const importedProjectId = await importProjectJSON(exported)
    const importedProject = await db.projects.get(importedProjectId)
    const importedScope = {
      projectId: importedProjectId,
      worldId: importedProject!.activeWorldId!,
      workId: importedProject!.activeWorkId!,
    }
    const importedRelease = await db.characterInteractionProductReleases.where('projectId').equals(importedProjectId).first()
    const importedManifest = await assertCharacterInteractionProductReleaseUnchangedV1({
      scope: importedScope, productReleaseId: importedRelease!.id!,
    })
    expect(importedManifest.source.selection.worldReleaseId).toBe(importedRelease!.sourceWorldReleaseId)
    expect(importedRelease!.contentHash).toBe(published.productRelease.contentHash)
    await cascadeDeleteProject(importedProjectId)
    expect(await db.characterInteractionProductionSteps.where('projectId').equals(importedProjectId).count()).toBe(0)
    expect(await db.characterInteractionArtifacts.where('projectId').equals(importedProjectId).count()).toBe(0)
    expect(await db.characterInteractionProductReleases.where('projectId').equals(importedProjectId).count()).toBe(0)
  }, 60_000)

  it('篡改候选 payload 后确认失败，且未确认媒资/产物不能发布', async () => {
    const owned = await fixture()
    await expect(generateCharacterInteractionStepCandidateV1({
      scope: owned.scope,
      productionId: owned.confirmed.production.id,
      stepKey: 'character-capsules',
      candidatePayload: { schema: 'unregistered-bypass', version: 1 } as any,
    })).rejects.toThrow('字段不精确')
    expect(await db.characterInteractionArtifacts.count()).toBe(0)
    const candidate = await generateCharacterInteractionStepCandidateV1({
      scope: owned.scope, productionId: owned.confirmed.production.id, stepKey: 'character-capsules',
    })
    await db.characterInteractionArtifacts.update(candidate.id!, { payloadJson: '{"tampered":true}' })
    await expect(confirmCharacterInteractionStepCandidateV1({
      scope: owned.scope, productionId: owned.confirmed.production.id, artifactId: candidate.id!,
    })).rejects.toThrow('payload hash')
    await expect(publishCharacterInteractionProductReleaseV1({
      scope: owned.scope, productionId: owned.confirmed.production.id,
    })).rejects.toThrow('release-ready')
    expect(await db.gameReleases.count()).toBe(0)
    expect(await db.characterInteractionProductReleases.count()).toBe(0)
  }, 30_000)

  it('标准头像档位必须绑定真实图片字节或由作者逐槽显式降级，媒资未完成时保持 preview-ready', async () => {
    const owned = await fixture('portrait-standard')
    for (const stepKey of CHARACTER_INTERACTION_PRODUCTION_STEPS_V1) {
      const candidate = await formalCandidate({
        scope: owned.scope, productionId: owned.confirmed.production.id, stepKey,
      })
      await confirmCharacterInteractionStepCandidateV1({
        scope: owned.scope, productionId: owned.confirmed.production.id, artifactId: candidate.id!,
      })
    }
    let details = await readCharacterInteractionProductionDetailsV1({ scope: owned.scope, productionId: owned.confirmed.production.id })
    expect(details.production.status).toBe('preview-ready')
    expect(details.mediaAssets).toHaveLength(2)
    const [first, second] = details.mediaAssets
    await expect(attachCharacterInteractionMediaAssetV1({
      scope: owned.scope, productionId: owned.confirmed.production.id,
      slotKey: first.slotKey, expectedSpecHash: first.specHash,
      data: new Uint8Array([1, 2, 3, 4]).buffer, mimeType: 'image/png',
      rights: { sourceKind: 'author-owned-import', license: 'author-owned', authorConfirmed: true },
    })).rejects.toThrow('真实字节签名')
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=', 'base64')).buffer
    await attachCharacterInteractionMediaAssetV1({
      scope: owned.scope, productionId: owned.confirmed.production.id,
      slotKey: first.slotKey, expectedSpecHash: first.specHash, data: png, mimeType: 'image/png',
      rights: { sourceKind: 'author-owned-import', license: 'author-owned', authorConfirmed: true },
    })
    await degradeCharacterInteractionMediaAssetV1({
      scope: owned.scope, productionId: owned.confirmed.production.id,
      slotKey: second.slotKey, expectedSpecHash: second.specHash, reason: '作者确认本版本使用文字头像。',
    })
    details = await readCharacterInteractionProductionDetailsV1({ scope: owned.scope, productionId: owned.confirmed.production.id })
    expect(details.production.status).toBe('release-ready')
    expect(details.mediaAssets.map(item => item.status).sort()).toEqual(['available', 'degraded'])
    const linkedBlobId = details.mediaAssets.find(item => item.status === 'available')!.blobObjectId!
    expect((await collectUnreferencedMediaBlobObjects({ scope: owned.scope })).retained).toContain(linkedBlobId)
  }, 60_000)

  it('世界新版本只能形成显式升级候选并新建 Production，便携往返后仍保持旧版本绑定和哈希有效', async () => {
    const owned = await fixture()
    const oldReleaseId = owned.confirmed.selection.worldReleaseId
    const character = await db.characters.where('projectId').equals(owned.projectId).first()
    await db.characters.update(character!.id!, {
      shortDescription: `${character!.shortDescription} 新版本补充了灯塔值守职责。`,
      updatedAt: Date.now(),
    })
    const nextRevision = await createWorldRevision({ scope: owned.scope, label: '角色互动升级来源' })
    const nextRelease = await publishWorldRevision(nextRevision.id!, '角色互动升级来源 v2')
    const upgrade = await prepareCharacterInteractionWorldUpgradeCandidateV1({
      scope: owned.scope,
      productionId: owned.confirmed.production.id,
      newWorldReleaseId: nextRelease.id!,
    })
    expect(upgrade).toMatchObject({ status: 'candidate', kind: 'world-upgrade-plan' })
    expect(JSON.parse(upgrade.payloadJson)).toMatchObject({
      from: { worldReleaseId: oldReleaseId },
      to: { worldReleaseId: nextRelease.id },
      unresolved: [],
      action: 'create-new-production',
    })

    const exported = await exportProjectJSON(owned.projectId)
    const portableArtifact = exported.characterInteractionArtifacts!.find(item => item.kind === 'world-upgrade-plan')!
    const portablePlan = JSON.parse(portableArtifact._portablePayloadJson!)
    const oldPortableRelease = exported.worldReleases!.find(item => item.contentHash === owned.release.contentHash)!._exportId
    const nextPortableRelease = exported.worldReleases!.find(item => item.contentHash === nextRelease.contentHash)!._exportId
    expect(portablePlan.from.worldReleaseId).toBe(oldPortableRelease)
    expect(portablePlan.to.worldReleaseId).toBe(nextPortableRelease)

    const importedProjectId = await importProjectJSON(exported)
    const importedProject = await db.projects.get(importedProjectId)
    const importedScope = {
      projectId: importedProjectId,
      worldId: importedProject!.activeWorldId!,
      workId: importedProject!.activeWorkId!,
    }
    const importedOld = await db.characterInteractionProductions.where('projectId').equals(importedProjectId).first()
    const importedUpgrade = await db.characterInteractionArtifacts.where('projectId').equals(importedProjectId)
      .and(item => item.kind === 'world-upgrade-plan').first()
    const upgraded = await applyCharacterInteractionWorldUpgradeV1({
      scope: importedScope,
      productionId: importedOld!.id!,
      upgradeArtifactId: importedUpgrade!.id!,
      productionKey: 'old-harbor-living-chat-v2',
    })
    const oldDetails = await readCharacterInteractionProductionDetailsV1({ scope: importedScope, productionId: importedOld!.id! })
    expect(oldDetails.selection.worldContentHash).toBe(owned.confirmed.selection.worldContentHash)
    expect(oldDetails.selection.worldReleaseId).not.toBe(upgraded.selection.worldReleaseId)
    expect(upgraded.selection.worldContentHash).toBe(nextRelease.contentHash)
    expect(upgraded.production.productionKey).toBe('old-harbor-living-chat-v2')
    expect((await db.characterInteractionArtifacts.get(importedUpgrade!.id!))?.status).toBe('confirmed')
  }, 60_000)

  it('可选语音未生成不阻止文本/头像版本发布，未完成的 optional 槽不会伪装为已发布媒资', async () => {
    const owned = await fixture('voice-optional')
    for (const stepKey of CHARACTER_INTERACTION_PRODUCTION_STEPS_V1) {
      const candidate = await formalCandidate({
        scope: owned.scope, productionId: owned.confirmed.production.id, stepKey,
      })
      await confirmCharacterInteractionStepCandidateV1({
        scope: owned.scope, productionId: owned.confirmed.production.id, artifactId: candidate.id!,
      })
    }
    let details = await readCharacterInteractionProductionDetailsV1({ scope: owned.scope, productionId: owned.confirmed.production.id })
    const portraits = details.mediaAssets.filter(item => item.kind === 'portrait')
    const voices = details.mediaAssets.filter(item => item.kind === 'voice-sample')
    expect(portraits).toHaveLength(2)
    expect(voices.every(item => item.status === 'planned' && !item.productionRequired)).toBe(true)
    for (const portrait of portraits) {
      await degradeCharacterInteractionMediaAssetV1({
        scope: owned.scope, productionId: owned.confirmed.production.id,
        slotKey: portrait.slotKey, expectedSpecHash: portrait.specHash, reason: '本版本使用文字头像。',
      })
    }
    details = await readCharacterInteractionProductionDetailsV1({ scope: owned.scope, productionId: owned.confirmed.production.id })
    expect(details.production.status).toBe('release-ready')
    const published = await publishCharacterInteractionProductReleaseV1({ scope: owned.scope, productionId: owned.confirmed.production.id })
    const manifest = await assertCharacterInteractionProductReleaseUnchangedV1({
      scope: owned.scope, productReleaseId: published.productRelease.id!,
    })
    expect(manifest.media).toHaveLength(2)
    expect(manifest.media.every(item => item.kind === 'portrait' && item.status === 'degraded')).toBe(true)
  }, 60_000)

  it('刷新后把遗留 running attempt 收敛为可审失败证据，恢复操作幂等且不隐藏重试', async () => {
    const owned = await fixture()
    const stepId = await db.characterInteractionProductionSteps.add({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      productionId: owned.confirmed.production.id, stepKey: 'character-capsules', attempt: 1,
      status: 'running', inputHash: 'a'.repeat(64), candidateArtifactId: null, confirmedArtifactId: null,
      producerRunId: null, checkpointJson: '{}', errorJson: null,
      startedAt: Date.now(), completedAt: null, updatedAt: Date.now(),
    }) as number
    await db.characterInteractionProductions.update(owned.confirmed.production.id, { status: 'building' })
    expect(await recoverInterruptedCharacterInteractionProductionsV1(owned.scope)).toEqual([stepId])
    expect(await db.characterInteractionProductionSteps.get(stepId)).toMatchObject({ status: 'failed' })
    expect((await db.characterInteractionProductionSteps.get(stepId))?.errorJson).toContain('interrupted')
    expect((await db.characterInteractionProductions.get(owned.confirmed.production.id))?.status).toBe('failed')
    expect(await recoverInterruptedCharacterInteractionProductionsV1(owned.scope)).toEqual([])
  }, 30_000)
})
