import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  buildChapterInformationBoundaryV1,
  parseInformationBoundaryManifestV1,
  validateProseInformationBoundaryV1,
  verifyInformationBoundaryManifestV1,
} from '../../src/lib/agent/information-boundary'
import { prepareProseCopilot } from '../../src/lib/agent/prose-copilot'
import {
  hashProseGenerationCandidateV1,
  isProseGenerationCandidateCurrentV1,
} from '../../src/lib/agent/run/prose-generation-durable'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import type { WorkspaceScope } from '../../src/lib/types'

async function seedBoundaryProject(): Promise<{
  scope: WorkspaceScope
  currentChapterId: number
  currentOutlineId: number
  futureOutlineId: number
  perspectiveCharacterId: number
  futureClaim: string
  privateClaim: string
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '信息边界项目',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    worldCode: 'boundary-world',
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'boundary-world',
    name: '边界世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '边界作品',
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  const scope = { projectId, worldId, workId }
  const volumeId = await db.outlineNodes.add({
    projectId,
    workId,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '',
    order: 0,
    worldGroupId: null,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const currentOutlineId = await db.outlineNodes.add({
    projectId,
    workId,
    parentId: volumeId,
    type: 'chapter',
    title: '潮门之前',
    summary: '守灯人抵达潮门，尚未发现钟楼的秘密。',
    order: 0,
    worldGroupId: null,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const futureClaim = '守灯人在钟楼顶层发现失踪多年的银色钟芯'
  const futureOutlineId = await db.outlineNodes.add({
    projectId,
    workId,
    parentId: volumeId,
    type: 'chapter',
    title: '无声之钟',
    summary: futureClaim,
    order: 1,
    worldGroupId: null,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const currentChapterId = await db.chapters.add({
    projectId,
    workId,
    outlineNodeId: currentOutlineId,
    title: '潮门之前',
    content: '',
    wordCount: 0,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const futureChapterId = await db.chapters.add({
    projectId,
    workId,
    outlineNodeId: futureOutlineId,
    title: '无声之钟',
    content: '',
    wordCount: 0,
    status: 'outline',
    order: 1,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const perspectiveCharacterId = await db.characters.add({
    projectId,
    worldId,
    name: '守灯人',
    role: 'protagonist',
    roleWeight: 'main',
    moralAxis: 'neutral',
    orderAxis: 'neutral',
    shortDescription: '',
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    abilities: '',
    relationships: '[]',
    arc: '守灯人最终成为新一任潮门守卫并放弃返乡',
    ending: '终章时守灯人为封闭潮门永远留在海底',
    homeWorldGroupId: null,
    isCrossWorld: false,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const supportingId = await db.characters.add({
    projectId,
    worldId,
    name: '钟匠',
    role: 'supporting',
    roleWeight: 'secondary',
    moralAxis: 'neutral',
    orderAxis: 'neutral',
    shortDescription: '',
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    abilities: '',
    relationships: '[]',
    arc: '',
    homeWorldGroupId: null,
    isCrossWorld: false,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const privateClaim = '银色钟芯其实一直藏在潮门下方的密室里'
  await db.knowledgeLedger.bulkAdd([
    {
      projectId,
      workId,
      characterId: perspectiveCharacterId,
      characterName: '守灯人',
      knowledgeKey: 'tide-door.closes',
      statement: '潮门会在黎明之前彻底关闭',
      action: 'learn',
      sourceType: 'manual',
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    },
    {
      projectId,
      workId,
      characterId: supportingId,
      characterName: '钟匠',
      knowledgeKey: 'clock-core.location',
      statement: privateClaim,
      action: 'learn',
      sourceType: 'chapter',
      sourceChapterId: futureChapterId,
      status: 'confirmed',
      createdAt: now + 1,
      updatedAt: now + 1,
    },
  ] as any)
  return {
    scope,
    currentChapterId,
    currentOutlineId,
    futureOutlineId,
    perspectiveCharacterId,
    futureClaim,
    privateClaim,
  }
}

describe.sequential('R-HARNESS9 · 正文信息边界', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('冻结规范章序、POV 认知闭集和后续章禁区，并生成可核验哈希', async () => {
    const fixture = await seedBoundaryProject()
    const boundary = await buildChapterInformationBoundaryV1({
      scope: fixture.scope,
      chapterId: fixture.currentChapterId,
      outlineNodeId: fixture.currentOutlineId,
      worldGroupId: null,
      perspectiveCharacterId: fixture.perspectiveCharacterId,
    })

    expect(boundary.chapterOrdinal).toBe(1)
    expect(boundary.perspectiveCharacterName).toBe('守灯人')
    expect(boundary.allowedKnowledgeKeys).toEqual(['tide-door.closes'])
    expect(boundary.forbiddenClaims.some(claim => claim.text === fixture.futureClaim)).toBe(true)
    expect(boundary.forbiddenClaims.some(claim => claim.text === fixture.privateClaim)).toBe(true)
    expect(await verifyInformationBoundaryManifestV1(boundary)).toBe(true)
  })

  it('硬阻断逐字未来事实和 POV 越权认知，但不误伤假设与本章获知过程', async () => {
    const fixture = await seedBoundaryProject()
    const boundary = await buildChapterInformationBoundaryV1({
      scope: fixture.scope,
      chapterId: fixture.currentChapterId,
      outlineNodeId: fixture.currentOutlineId,
      worldGroupId: null,
      perspectiveCharacterId: fixture.perspectiveCharacterId,
    })

    expect(validateProseInformationBoundaryV1(
      `潮水退去后，${fixture.futureClaim}。`,
      boundary,
    ).some(issue => issue.code.includes('future-outline'))).toBe(true)
    expect(validateProseInformationBoundaryV1(
      `守灯人早就知道${fixture.privateClaim}。`,
      boundary,
    ).some(issue => issue.code.includes('private-knowledge'))).toBe(true)
    expect(validateProseInformationBoundaryV1(
      `如果${fixture.futureClaim}，旧传说或许就是真的。`,
      boundary,
    )).toEqual([])
    expect(validateProseInformationBoundaryV1(
      `钟匠告诉守灯人，${fixture.privateClaim}。守灯人这才相信他。`,
      boundary,
    )).toEqual([])
  })

  it('后续章纲变化会改变边界哈希，并使已生成 durable 候选过期', async () => {
    const fixture = await seedBoundaryProject()
    const boundary = await buildChapterInformationBoundaryV1({
      scope: fixture.scope,
      chapterId: fixture.currentChapterId,
      outlineNodeId: fixture.currentOutlineId,
      worldGroupId: null,
      perspectiveCharacterId: fixture.perspectiveCharacterId,
    })
    const sourceTextHash = await hashChapterText('')
    const candidateBody = {
      version: 1 as const,
      type: 'prose-generation-candidate' as const,
      projectId: fixture.scope.projectId,
      chapterId: fixture.currentChapterId,
      chapterTitle: '潮门之前',
      worldGroupId: null,
      operation: 'generate' as const,
      sourceTextHash,
      outputText: '潮水在门外缓慢退去，守灯人握紧灯柄，沿着陌生石阶一步步向下走。',
      outputTextHash: await hashCanonicalValue('潮水在门外缓慢退去，守灯人握紧灯柄，沿着陌生石阶一步步向下走。'),
      expectedContentHash: 'b'.repeat(64),
      informationBoundaryHash: boundary.manifestHash,
      perspectiveCharacterId: fixture.perspectiveCharacterId,
      createdAt: Date.now(),
    }
    const candidate = {
      ...candidateBody,
      durable: {
        runId: 1,
        stepId: 'prose-generation' as const,
        attempt: 1,
        contextManifestHash: 'c'.repeat(64),
        candidateHash: await hashProseGenerationCandidateV1(candidateBody),
      },
    }
    expect(await isProseGenerationCandidateCurrentV1(candidate)).toBe(true)

    await db.outlineNodes.update(fixture.futureOutlineId, {
      summary: '守灯人在钟楼地下发现第二枚从未登记的黑色钟芯',
      updatedAt: Date.now() + 10,
    })
    const changed = await buildChapterInformationBoundaryV1({
      scope: fixture.scope,
      chapterId: fixture.currentChapterId,
      outlineNodeId: fixture.currentOutlineId,
      worldGroupId: null,
      perspectiveCharacterId: fixture.perspectiveCharacterId,
    })
    expect(changed.manifestHash).not.toBe(boundary.manifestHash)
    expect(await isProseGenerationCandidateCurrentV1(candidate)).toBe(false)
  })

  it('主 Agent 正文 GenerationNode 使用同一硬门禁，而不是只在 UI 侧提示', async () => {
    const fixture = await seedBoundaryProject()
    const prepared = await prepareProseCopilot({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      worldGroupId: null,
      authorRequest: '写第一章正文',
      perspectiveCharacterId: fixture.perspectiveCharacterId,
    })
    const gate = await prepared.node.gate?.(
      `潮门外的雾越来越浓，${fixture.futureClaim}。守灯人沉默地站在原地，等潮水退去。`.repeat(2),
    )
    expect(gate?.status).toBe('blocked')
    expect(gate?.issues.some(issue => issue.code.includes('future-outline'))).toBe(true)
  })

  it('持久化信息边界严格拒绝额外字段、坏哈希和重复认知键', async () => {
    const fixture = await seedBoundaryProject()
    const boundary = await buildChapterInformationBoundaryV1({
      scope: fixture.scope,
      chapterId: fixture.currentChapterId,
      outlineNodeId: fixture.currentOutlineId,
      worldGroupId: null,
      perspectiveCharacterId: fixture.perspectiveCharacterId,
    })

    expect(parseInformationBoundaryManifestV1(boundary)).toEqual(boundary)
    expect(() => parseInformationBoundaryManifestV1({ ...boundary, leaked: true }))
      .toThrow('字段无效')
    expect(() => parseInformationBoundaryManifestV1({ ...boundary, manifestHash: 'bad' }))
      .toThrow('manifestHash 无效')
    expect(() => parseInformationBoundaryManifestV1({
      ...boundary,
      allowedKnowledgeKeys: ['same', 'same'],
    })).toThrow('allowedKnowledgeKeys 重复')
  })
})
