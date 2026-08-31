import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createGuestInteractionCharacterProfile,
  createStarterInteractionGame,
  publishInteractionGameDraft,
  saveInteractionSceneTemplate,
} from '../../src/lib/character-interaction/authoring'
import { buildWorldGroundedInteractionProfile } from '../../src/lib/character-interaction/world-grounding'
import { db } from '../../src/lib/db/schema'
import { parseInteractionGameReleaseManifest } from '../../src/lib/text-game/releases'
import type { Character, CharacterRelation, KnowledgeLedgerEntry } from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

function character(overrides: Partial<Character> = {}): Character {
  return {
    id: 1,
    projectId: 1,
    name: '阿遥',
    role: 'supporting',
    roleWeight: 'secondary',
    moralAxis: 'good',
    orderAxis: 'chaotic',
    shortDescription: '在旧王都隐居的前信使。',
    appearance: '左眼有一道银色伤痕。',
    personality: '警觉，但不会放弃已经答应的人。',
    background: '曾替议会送出改变战争结局的最后一封信。',
    motivation: '查明那封信为何被调包。',
    abilities: '辨认各地密文。',
    relationships: '[]',
    arc: '从逃避旧事到愿意承担见证者责任。',
    identity: '退役王室信使',
    values: '承诺必须留下证据。',
    fears: '再次因为迟到害死同伴。',
    goals: '找到调包者。',
    keyEvents: '在停战日亲眼看见钟楼起火。',
    speechStyle: '句子短，确认事实后才下判断。',
    location: '北山旧驿站',
    ending: '战争结束后离开王都，独自守着未寄出的回信。',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function cognition(overrides: Partial<KnowledgeLedgerEntry>): KnowledgeLedgerEntry {
  return {
    id: 1,
    projectId: 1,
    workId: 1,
    worldGroupId: null,
    characterId: 1,
    characterName: '阿遥',
    knowledgeKey: 'letter.location',
    statement: '信在钟楼。',
    action: 'learn',
    sourceType: 'manual',
    status: 'confirmed',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('CHATGAME-3A · world-grounded character start', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('把人物终局字段、关系和当前认知编译为有边界的角色胶囊', () => {
    const subject = character()
    const other = character({ id: 2, name: '岑', shortDescription: '守钟人。' })
    const relations: CharacterRelation[] = [{
      id: 7,
      projectId: 1,
      fromCharacterId: 1,
      toCharacterId: 2,
      relationType: 'friend',
      label: '失散的搭档',
      description: '两人都以为对方在钟楼火灾中背叛了自己。',
      isBidirectional: true,
      createdAt: 1,
      updatedAt: 1,
    }]
    const result = buildWorldGroundedInteractionProfile({
      character: subject,
      allCharacters: [subject, other],
      relations,
      knowledgeEvents: [
        cognition({ id: 1, knowledgeKey: 'letter.location', statement: '信在钟楼。', action: 'learn', createdAt: 1 }),
        cognition({ id: 2, knowledgeKey: 'letter.location', statement: '信在钟楼。', belief: '信被岑烧掉了。', action: 'mislearn', createdAt: 2 }),
        cognition({ id: 3, knowledgeKey: 'forgotten.code', statement: '密文是白鹭。', action: 'learn', createdAt: 3 }),
        cognition({ id: 4, knowledgeKey: 'forgotten.code', statement: '密文是白鹭。', action: 'forget', createdAt: 4 }),
        cognition({ id: 5, knowledgeKey: 'rejected.secret', statement: '不应进入。', status: 'candidate', createdAt: 5 }),
      ],
    })

    expect(result.roleLabel).toBe(subject.shortDescription)
    expect(result.voiceRules).toContain(subject.speechStyle)
    expect(result.includedCharacterFields).toEqual(expect.arrayContaining([
      'personality', 'background', 'motivation', 'goals', 'keyEvents', 'ending', 'location',
    ]))
    expect(result.relationCount).toBe(1)
    expect(result.cognitionCount).toBe(1)
    expect(result.initialKnowledge.filter(item => item.visibility === 'public')).toEqual([
      expect.objectContaining({ key: 'profile.character-1', content: subject.shortDescription }),
    ])
    const privateText = result.initialKnowledge.filter(item => item.visibility === 'private').map(item => item.content).join('\n')
    expect(privateText).toContain('既有故事结局')
    expect(privateText).toContain('失散的搭档')
    expect(privateText).toContain('信被岑烧掉了')
    expect(privateText).toContain('这不是世界真相')
    expect(privateText).not.toContain('密文是白鹭')
    expect(privateText).not.toContain('不应进入')
  })

  it('创建互动草稿时读取当前 World/Work 资料，并把结果冻结进 GameRelease', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'CHATGAME-3A', genre: 'drama', genres: ['drama'], status: 'drafting',
      description: '世界落地角色起点回归', targetWordCount: 50_000, createdAt: now, updatedAt: now,
      workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    } as any) as number
    const ownership = await ensureWorkspaceOwnership(projectId)
    const firstId = await db.characters.add({
      ...character({ id: undefined, projectId, name: '阿遥' }),
      worldId: ownership.scope.worldId,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const secondId = await db.characters.add({
      ...character({ id: undefined, projectId, name: '岑', shortDescription: '钟楼最后的守钟人。', ending: '继续留在钟楼。' }),
      worldId: ownership.scope.worldId,
      createdAt: now + 1,
      updatedAt: now + 1,
    } as any) as number
    await db.characterRelations.add({
      projectId,
      worldId: ownership.scope.worldId,
      fromCharacterId: firstId,
      toCharacterId: secondId,
      relationType: 'friend',
      label: '失散的搭档',
      description: '终局时仍未解开彼此的误会。',
      isBidirectional: true,
      createdAt: now,
      updatedAt: now,
    } as any)
    await db.workCharacterBindings.add({
      projectId,
      workId: ownership.scope.workId,
      characterId: firstId,
      role: '停战后的关键见证人',
      arc: '在本部作品中决定回到王都作证。',
      outcome: '完成证词后回到北山生活。',
      createdAt: now,
      updatedAt: now,
    })
    await db.knowledgeLedger.add({
      projectId,
      workId: ownership.scope.workId,
      worldGroupId: null,
      characterId: firstId,
      characterName: '阿遥',
      knowledgeKey: 'fire.witness',
      statement: '岑在钟楼起火前已经离开。',
      action: 'learn',
      sourceType: 'manual',
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    })

    const definition = await createStarterInteractionGame({
      scope: ownership.scope,
      title: '战争之后',
      gameKey: 'after-the-war',
      characterIds: [firstId, secondId],
      sceneLocation: '停战纪念馆',
      sceneTimeLabel: '战争结束十年后',
      scenePurpose: '用户带着一封未寄出的信来见两名旧人。',
      chatDirection: '决定是否重新调查钟楼火灾。',
    })
    const profiles = await db.interactionCharacterProfiles.where('gameDefinitionId').equals(definition.id!).toArray()
    const first = profiles.find(item => item.characterId === firstId)!
    const seeds = JSON.parse(first.initialKnowledgeJson) as Array<{ key: string; content: string; visibility: string }>
    expect(first.roleLabel).toBe('停战后的关键见证人')
    expect(seeds).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: `world.character.${firstId}.ending`, visibility: 'private' }),
      expect.objectContaining({ key: `world.work-character.${ownership.scope.workId}.${firstId}.outcome`, visibility: 'private' }),
      expect.objectContaining({ key: `world.relation.1.${firstId}`, visibility: 'private' }),
      expect.objectContaining({ key: `world.cognition.1.${firstId}`, visibility: 'private' }),
    ]))

    const firstScene = await db.interactionSceneTemplates.where('gameDefinitionId').equals(definition.id!).first()
    expect(firstScene).toMatchObject({
      location: '停战纪念馆',
      timeLabel: '战争结束十年后',
      purpose: '用户带着一封未寄出的信来见两名旧人。',
      goalsJson: '["决定是否重新调查钟楼火灾。"]',
    })

    const worldCharacterCount = await db.characters.count()
    const guest = await createGuestInteractionCharacterProfile({
      scope: ownership.scope,
      gameDefinitionId: definition.id!,
      guestKey: 'north-mountain-visitor',
      name: '陆弦',
      roleLabel: '带着旧信来到此地的陌生调查者',
      background: '从未参与战争，却继承了失踪邮差的遗物。',
      relationToWorld: '遗物中有阿遥当年没有寄出的回信。',
    })
    expect(guest.characterId).toBeNull()
    expect(JSON.parse(guest.sourceSnapshotJson ?? '{}')).toMatchObject({
      schema: 'storyforge.interaction-guest-character',
      guestKey: 'north-mountain-visitor',
      name: '陆弦',
    })
    expect(await db.characters.count()).toBe(worldCharacterCount)
    await saveInteractionSceneTemplate({
      scope: ownership.scope,
      gameDefinitionId: definition.id!,
      sceneId: firstScene!.id,
      sceneKey: firstScene!.sceneKey,
      title: firstScene!.title,
      purpose: firstScene!.purpose,
      location: firstScene!.location,
      timeLabel: firstScene!.timeLabel,
      participantKeysJson: JSON.stringify([
        ...JSON.parse(firstScene!.participantKeysJson),
        guest.participantKey,
      ]),
      publicKnowledgeKeysJson: JSON.stringify([
        ...JSON.parse(firstScene!.publicKnowledgeKeysJson),
        `profile.${guest.participantKey}`,
      ]),
      goalsJson: firstScene!.goalsJson,
      endingConditionsJson: firstScene!.endingConditionsJson,
      safetyBoundariesJson: firstScene!.safetyBoundariesJson,
      relationshipRulesJson: firstScene!.relationshipRulesJson,
      openingNodeKey: firstScene!.openingNodeKey,
      endingNodeKey: firstScene!.endingNodeKey,
      maxTurns: firstScene!.maxTurns,
      directorBudget: firstScene!.directorBudget,
      order: firstScene!.order,
    })

    const publication = await publishInteractionGameDraft({ scope: ownership.scope, gameDefinitionId: definition.id!, fixtureOnly: true })
    const frozen = parseInteractionGameReleaseManifest(publication.gameRelease.manifestJson)
    expect(frozen.interaction.profiles.find(item => item.name === '陆弦')).toMatchObject({
      characterKey: 'interaction-guest:north-mountain-visitor',
      roleLabel: '带着旧信来到此地的陌生调查者',
    })
    const frozenFirst = frozen.interaction.profiles.find(item => item.name === '阿遥')
    expect(frozenFirst?.initialKnowledge.map(item => item.content).join('\n')).toContain('岑在钟楼起火前已经离开')

    await db.characters.update(firstId, { ending: '这是发布之后才修改的结局。', updatedAt: now + 10 })
    const stillFrozen = parseInteractionGameReleaseManifest((await db.gameReleases.get(publication.gameRelease.id!))!.manifestJson)
    expect(stillFrozen.interaction.profiles.find(item => item.name === '阿遥')
      ?.initialKnowledge.map(item => item.content).join('\n')).not.toContain('发布之后才修改')
  }, 30_000)
})
