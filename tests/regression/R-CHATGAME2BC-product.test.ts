import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createInteractionAcceptanceSample,
  createStarterInteractionGame,
  inspectInteractionContext,
  publishInteractionGameDraft,
  saveInteractionCharacterProfile,
  saveInteractionSceneTemplate,
  validateInteractionGameDraft,
} from '../../src/lib/character-interaction/authoring'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  branchSimulationSession,
  changeInteractionRelationship,
  commitInteractionPlayerMessage,
  readSimulationState,
  readSimulationStateVersion,
  startInteractionScene,
} from '../../src/lib/simulation/runtime'
import { parseInteractionGameReleaseManifest } from '../../src/lib/text-game/releases'
import { createInteractionGameInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

async function workspace() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'CHATGAME-2BC', genre: 'drama', genres: ['drama'], status: 'drafting',
    description: '角色互动产品回归', targetWordCount: 50_000, createdAt: now, updatedAt: now,
  } as any) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  const ids: number[] = []
  for (const [index, name] of ['阿莉娅', '博', '岑'].entries()) {
    ids.push(await db.characters.add({
      projectId,
      worldId: ownership.scope.worldId,
      name,
      role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: `${name}在钟楼事件中有自己的立场。`,
      appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '',
      speechStyle: index === 0 ? '克制直接' : '谨慎简短',
      createdAt: now + index, updatedAt: now + index,
    } as any) as number)
  }
  return { ...ownership, characterIds: ids }
}

describe('CHATGAME-2B/2C · product release, authoring and playback', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('内置验收样例冻结三角色、五场景、私密知识和失约修复规则', async () => {
    const owned = await workspace()
    const definition = await createInteractionAcceptanceSample({
      scope: owned.scope,
      characterIds: owned.characterIds,
    })
    const report = await validateInteractionGameDraft(owned.scope, definition.id!)
    expect(report).toMatchObject({ valid: true, participantCount: 3, sceneCount: 5 })
    const profiles = await db.interactionCharacterProfiles.where('gameDefinitionId').equals(definition.id!).sortBy('participantKey')
    const ownerContext = await inspectInteractionContext({ scope: owned.scope, gameDefinitionId: definition.id!, participantKey: profiles[0].participantKey })
    const outsiderContext = await inspectInteractionContext({ scope: owned.scope, gameDefinitionId: definition.id!, participantKey: profiles[1].participantKey })
    expect(ownerContext.visibleKnowledgeKeys).toContain('secret.sealed-letter')
    expect(outsiderContext.visibleKnowledgeKeys).not.toContain('secret.sealed-letter')
    expect(outsiderContext.hiddenKnowledgeKeys).toContain('secret.sealed-letter')
    const publication = await publishInteractionGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    const manifest = parseInteractionGameReleaseManifest(publication.gameRelease.manifestJson)
    expect(manifest.interaction.sceneTemplates).toHaveLength(5)
    expect(manifest.interaction.sceneTemplates.flatMap(item => item.relationshipRules).map(item => item.ruleKey)).toEqual([
      'promise.broken', 'promise.repaired',
    ])
  }, 30_000)

  it('冻结三角色场景，保护秘密，支持离线关系行动、回放和分支', async () => {
    const owned = await workspace()
    const definition = await createStarterInteractionGame({
      scope: owned.scope,
      title: '钟楼密信',
      gameKey: 'clocktower-letter',
      characterIds: owned.characterIds,
    })
    const profiles = await db.interactionCharacterProfiles.where('gameDefinitionId').equals(definition.id!).toArray()
    const aria = profiles[0]
    await saveInteractionCharacterProfile({
      scope: owned.scope,
      gameDefinitionId: definition.id!,
      profileId: aria.id,
      characterId: aria.characterId,
      participantKey: aria.participantKey,
      roleLabel: '知道密信下落的信使',
      voiceRules: '克制直接；未真实说出前不得让其他人知道秘密。',
      initialKnowledgeJson: JSON.stringify([
        { key: `profile.${aria.participantKey}`, content: '阿莉娅是钟楼信使。', visibility: 'public', importance: 50 },
        { key: 'sealed-letter', content: '失踪的信藏在钟楼第三层。', visibility: 'private', importance: 95 },
      ]),
      relationshipDimensionsJson: JSON.stringify([
        { key: 'trust', label: '信任', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 2 },
      ]),
      maxMemoryEntries: 24,
    })
    const scene = await db.interactionSceneTemplates.where('gameDefinitionId').equals(definition.id!).first()
    await saveInteractionSceneTemplate({
      scope: owned.scope,
      gameDefinitionId: definition.id!,
      sceneId: scene!.id,
      sceneKey: 'clocktower',
      title: '钟楼会面',
      purpose: '确认三人是否还愿意共同调查密信。',
      location: '旧钟楼',
      timeLabel: '雨夜',
      participantKeysJson: JSON.stringify(profiles.map(item => item.participantKey)),
      publicKnowledgeKeysJson: JSON.stringify(profiles.map(item => `profile.${item.participantKey}`)),
      goalsJson: '["处理一次失约与补救"]',
      endingConditionsJson: '["秘信去向已经处理"]',
      safetyBoundariesJson: '["不替玩家决定感受"]',
      relationshipRulesJson: JSON.stringify([
        { ruleKey: 'promise.broken', label: '失约', playerText: '承认自己没有赴约', fromParticipantKey: aria.participantKey, toParticipantKey: 'player', dimensionKey: 'trust', delta: -2, reason: '玩家当面承认未履行约定。', significantEventKey: null },
        { ruleKey: 'promise.repaired', label: '补救', playerText: '交出自己找到的证据作为补救', fromParticipantKey: aria.participantKey, toParticipantKey: 'player', dimensionKey: 'trust', delta: 2, reason: '玩家以真实证据补救了失约。', significantEventKey: null },
      ]),
      openingNodeKey: 'entry', endingNodeKey: 'ending', maxTurns: 100, directorBudget: 12, order: 0,
    })

    const report = await validateInteractionGameDraft(owned.scope, definition.id!)
    expect(report).toMatchObject({ valid: true, participantCount: 3, sceneCount: 1 })
    const ariaContext = await inspectInteractionContext({ scope: owned.scope, gameDefinitionId: definition.id!, participantKey: aria.participantKey })
    const otherContext = await inspectInteractionContext({ scope: owned.scope, gameDefinitionId: definition.id!, participantKey: profiles[1].participantKey })
    expect(ariaContext.visibleKnowledgeKeys).toContain('sealed-letter')
    expect(otherContext.visibleKnowledgeKeys).not.toContain('sealed-letter')
    expect(otherContext.hiddenKnowledgeKeys).toContain('sealed-letter')

    const publication = await publishInteractionGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    const manifest = parseInteractionGameReleaseManifest(publication.gameRelease.manifestJson)
    expect(manifest).toMatchObject({
      productType: 'character-interaction',
      interaction: { profiles: expect.arrayContaining([expect.objectContaining({ participantKey: aria.participantKey })]) },
    })
    expect(manifest.interaction.sceneTemplates[0].relationshipRules).toHaveLength(2)

    const session = await createInteractionGameInstance({
      scope: owned.scope,
      gameReleaseId: publication.gameRelease.id!,
      title: '钟楼第一次时间线',
      seed: 'chatgame-fixed-seed',
    })
    let base = await readSimulationStateVersion(session.id!)
    await startInteractionScene({
      sessionId: session.id!, commandId: 'scene.start', baseSequence: base.sequence, baseStateHash: base.stateHash,
      sceneId: 'scene:clocktower:1', sceneKey: 'clocktower',
    })
    base = await readSimulationStateVersion(session.id!)
    const broken = await commitInteractionPlayerMessage({
      sessionId: session.id!, commandId: 'message.broken', baseSequence: base.sequence, baseStateHash: base.stateHash,
      messageId: 'message:broken', text: '我没有赴约。',
    })
    base = await readSimulationStateVersion(session.id!)
    await changeInteractionRelationship({
      sessionId: session.id!, commandId: 'relationship.broken', baseSequence: base.sequence, baseStateHash: base.stateHash,
      fromParticipantKey: aria.participantKey, toParticipantKey: 'player', dimensionKey: 'trust', delta: -2,
      reason: '玩家当面承认未履行约定。', ruleKey: 'promise.broken', sourceEventSequence: broken.sequence,
    })
    const state = await readSimulationState(session.id!)
    expect(state.interaction?.relationships.find(item => item.fromParticipantKey === aria.participantKey)?.value).toBe(-2)
    expect(state.interaction?.relationshipHistory[0]).toMatchObject({ before: 0, after: -2, sourceEventSequence: broken.sequence })
    const child = await branchSimulationSession({ parentSessionId: session.id!, throughSequence: state.lastSequence, title: '从失约后分支' })
    expect(child).toMatchObject({ kind: 'chatgame', gameReleaseId: publication.gameRelease.id })
    expect(await readSimulationState(child.id!)).toMatchObject({ lastSequence: 0, interaction: { totalPlayerTurns: 1 } })

    const backup = await exportProjectJSON(owned.scope.projectId)
    const importedId = await importProjectJSON(backup)
    const importedOwnership = await ensureWorkspaceOwnership(importedId)
    const importedSession = await db.simulationSessions.where('projectId').equals(importedId).filter(item => item.gameReleaseId != null).first()
    expect(importedSession?.workId).toBe(importedOwnership.scope.workId)
    expect((await readSimulationState(importedSession!.id!)).interaction?.profiles).toHaveLength(3)
  }, 30_000)

  it('阻断未声明重大事件的大幅关系规则和无效参与者', async () => {
    const owned = await workspace()
    const definition = await createStarterInteractionGame({ scope: owned.scope, characterIds: owned.characterIds.slice(0, 1) })
    const scene = await db.interactionSceneTemplates.where('gameDefinitionId').equals(definition.id!).first()
    const profile = await db.interactionCharacterProfiles.where('gameDefinitionId').equals(definition.id!).first()
    await db.interactionSceneTemplates.update(scene!.id!, {
      participantKeysJson: '["missing"]',
      relationshipRulesJson: JSON.stringify([{ ruleKey: 'instant-love', label: '突然信任', playerText: '什么都不做', fromParticipantKey: profile!.participantKey, toParticipantKey: 'player', dimensionKey: 'trust', delta: 10, reason: '没有证据', significantEventKey: null }]),
    })
    const report = await validateInteractionGameDraft(owned.scope, definition.id!)
    expect(report.valid).toBe(false)
    expect(report.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'scene.unknown-participant', 'rule.large-change-without-evidence',
    ]))
    await expect(publishInteractionGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })).rejects.toThrow('发布检查未通过')
  })
})
