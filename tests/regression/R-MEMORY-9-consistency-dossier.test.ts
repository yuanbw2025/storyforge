import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import { db } from '../../src/lib/db/schema'
import {
  buildLongTermConsistencyDossierV1,
  formatLongTermConsistencyDossierV1,
} from '../../src/lib/memory/consistency-dossier'
import { generateWorkCode, generateWorkspaceUid } from '../../src/lib/memory/identity'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { useUserStyleStore } from '../../src/stores/user-style'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

async function seed() {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(), name: '一致性工程', genre: 'fantasy', genres: [], status: 'drafting',
    description: '', targetWordCount: 1000, createdAt: now, updatedAt: now,
  } as any) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  const firstOutlineId = await db.outlineNodes.add({
    projectId, workId: ownership.scope.workId, parentId: null, type: 'chapter', title: '旧章', summary: '龙印第一次出现',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const firstContent = '<p>林霜获得龙印，仍在青城。</p>'
  const firstChapterId = await db.chapters.add({
    projectId, workId: ownership.scope.workId, outlineNodeId: firstOutlineId, title: '旧章', content: firstContent,
    wordCount: 12, status: 'final', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  const boundaryOutlineId = await db.outlineNodes.add({
    projectId, workId: ownership.scope.workId, parentId: null, type: 'chapter', title: '新章', summary: '龙印再次发光',
    order: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const boundaryChapterId = await db.chapters.add({
    projectId, workId: ownership.scope.workId, outlineNodeId: boundaryOutlineId, title: '新章', content: '',
    wordCount: 0, status: 'outline', order: 1, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  const otherWorldId = await db.worlds.add({
    projectId, code: 'other-world', name: '隔离世界', description: '', currentVersion: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const otherWorkId = await db.works.add({
    projectId, worldId: otherWorldId, code: generateWorkCode(), title: '隔离作品', description: '', genres: [],
    status: 'drafting', targetWordCount: 100, createdAt: now, updatedAt: now,
  } as any) as number
  return { now, projectId, scope: ownership.scope, firstChapterId, boundaryChapterId, firstContent, otherWorkId }
}

describe('MEMORY-9 · structured long-term consistency dossier', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useUserStyleStore.setState({ profile: null, loading: false })
  })
  afterEach(async () => { db.close(); vi.restoreAllMocks() })

  it('uses exact scoped facts and local keywords while embeddings and models stay off', async () => {
    const seeded = await seed()
    const factBase = {
      projectId: seeded.projectId, workId: seeded.scope.workId, worldGroupId: null,
      subjectName: '林霜', predicate: 'location', factKind: 'state', sourceType: 'chapter',
      sourceChapterId: seeded.firstChapterId, validFromChapterId: seeded.firstChapterId,
      status: 'confirmed', locked: false, createdAt: seeded.now, updatedAt: seeded.now,
    }
    await db.temporalFacts.bulkAdd([
      { ...factBase, value: '青城' },
      { ...factBase, value: '云海' },
      { ...factBase, workId: seeded.otherWorkId, subjectName: '隔离人物', value: '不应出现' },
    ] as any)
    await db.knowledgeLedger.add({
      projectId: seeded.projectId, workId: seeded.scope.workId, worldGroupId: null,
      characterName: '林霜', knowledgeKey: 'dragon-seal', statement: '龙印会发光', action: 'learn',
      sourceType: 'chapter', sourceChapterId: seeded.firstChapterId, status: 'confirmed',
      createdAt: seeded.now, updatedAt: seeded.now,
    } as any)
    await db.stateCards.add({
      projectId: seeded.projectId, workId: seeded.scope.workId, category: 'character', entityName: '林霜',
      fields: JSON.stringify([{ key: '位置', value: '青城' }]), lastChapterId: seeded.firstChapterId,
      createdAt: seeded.now, updatedAt: seeded.now,
    } as any)
    await db.itemLedger.add({
      projectId: seeded.projectId, workId: seeded.scope.workId, itemName: '龙印', action: 'gain', quantity: 1,
      heldByName: '林霜', chapterId: seeded.firstChapterId, chapterTitle: '旧章', createdAt: seeded.now,
    } as any)
    await db.storyTimelineEvents.add({
      projectId: seeded.projectId, workId: seeded.scope.workId, title: '获得龙印', storyTime: '第一日',
      importance: 2, chapterId: seeded.firstChapterId, chapterTitle: '旧章', order: 0, createdAt: seeded.now,
    } as any)
    await db.retrievalChunks.add({
      projectId: seeded.projectId, workId: seeded.scope.workId, worldGroupId: null,
      sourceChapterId: seeded.firstChapterId, chunkIndex: 0, text: '林霜获得龙印，仍在青城。',
      keywords: ['林霜', '龙印'], embedding: [0.1, 0.9], embeddingModel: 'must-not-be-used',
      sourceTextHash: await hashChapterText(seeded.firstContent), createdAt: seeded.now,
    } as any)

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const dossier = await buildLongTermConsistencyDossierV1({
      scope: seeded.scope, boundaryChapterId: seeded.boundaryChapterId, query: '龙印', maxTokens: 1200,
    })
    expect(dossier.retrievalPolicy.embedding).toMatchObject({ enabled: false, authoritative: false })
    expect(dossier.tokenBudget.modelCalls).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(dossier.structuredFacts.join('\n')).toContain('青城')
    expect(dossier.structuredFacts.join('\n')).not.toContain('隔离人物')
    expect(dossier.keywordEvidence.join('\n')).toContain('龙印')
    expect(dossier.findings.some(row => row.code === 'simultaneous-canon-values' && row.severity === 'blocking')).toBe(true)
    expect(dossier.sourceRefs.every(row => row.contentHash).valueOf()).toBe(true)
    expect(dossier.dossierHash).toMatch(/^[a-f0-9]{64}$/)

    const rendered = formatLongTermConsistencyDossierV1(dossier)
    expect(rendered).toContain('embedding=off')
    expect(rendered).toContain('模型调用=0')
    const assembled = await assembleContext({
      projectId: seeded.projectId, scope: seeded.scope, chapterId: seeded.boundaryChapterId,
      sourceKeys: ['consistencyDossier'], inputBudgetTokens: 8_000,
    })
    expect(assembled.included).toEqual(['consistencyDossier'])
    expect(assembled.text).toContain('长期一致性档案')
  })

  it('keeps generative review behind explicit author authorization without spending a call', async () => {
    const seeded = await seed()
    const normal = await buildLongTermConsistencyDossierV1({ scope: seeded.scope, boundaryChapterId: seeded.boundaryChapterId })
    const authorized = await buildLongTermConsistencyDossierV1({
      scope: seeded.scope, boundaryChapterId: seeded.boundaryChapterId, authorizeGenerativeReview: true,
    })
    expect(normal.checks.L3).toBe('disabled')
    expect(authorized.checks.L3).toBe('author-authorized')
    expect(authorized.tokenBudget.modelCalls).toBe(0)
    expect(authorized.findings.some(row => row.execution === 'optional-model')).toBe(true)
  })

  it('lets the author inspect, disable, and delete learned style memory per Work', async () => {
    const seeded = await seed()
    await db.userStyleProfiles.add({
      projectId: seeded.projectId, worldId: seeded.scope.worldId, workId: seeded.scope.workId,
      profile: '短句，克制。', enabled: true, sourceChapterIds: JSON.stringify([seeded.firstChapterId]),
      sampleCount: 1, sampleWords: 10, revisionPairs: '[]', calibrationFeedback: '[]',
      createdAt: seeded.now, updatedAt: seeded.now,
    } as any)
    await useUserStyleStore.getState().loadProfile(seeded.scope)
    expect(useUserStyleStore.getState().profile?.profile).toContain('短句')
    await useUserStyleStore.getState().setEnabled(false)
    expect(useUserStyleStore.getState().profile?.enabled).toBe(false)
    await useUserStyleStore.getState().clearLearnedStyle()
    expect(useUserStyleStore.getState().profile).toBeNull()
    expect(await db.userStyleProfiles.where('projectId').equals(seeded.projectId).count()).toBe(0)
  })
})
