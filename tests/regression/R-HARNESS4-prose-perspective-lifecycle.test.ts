import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { adopt } from '../../src/lib/registry/adopt'
import { useCharacterStore } from '../../src/stores/character'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

describe('HARNESS-4 · 正文视角字段治理生命周期', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  async function seed() {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: '视角生命周期',
      genres: ['fantasy'],
      description: '',
      targetWordCount: 100_000,
      enableMultiWorld: false,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const characterId = await db.characters.add({
      projectId,
      name: '守灯人',
      roleWeight: 'main',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      homeWorldGroupId: null,
      isCrossWorld: false,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const volumeId = await db.outlineNodes.add({
      projectId,
      parentId: null,
      type: 'volume',
      title: '第一卷',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const outlineNodeId = await db.outlineNodes.add({
      projectId,
      parentId: volumeId,
      type: 'chapter',
      title: '第一章',
      summary: '守灯人进入潮门。',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    await finalizeCurrentFixtureV1(projectId)
    return { projectId, characterId, outlineNodeId }
  }

  it('采纳系统校验视角角色外键并允许合法章节写入', async () => {
    const seeded = await seed()
    const base = {
      outlineNodeId: seeded.outlineNodeId,
      title: '第一章',
      content: '',
      wordCount: 0,
      status: 'outline',
      order: 0,
      notes: '',
    }
    const rejected = await adopt({
      projectId: seeded.projectId,
      target: 'chapters',
      mode: 'add',
      data: { ...base, perspectiveCharacterId: 999_999 },
    })
    expect(rejected.written).toHaveLength(0)
    expect(rejected.fkErrors).toContainEqual({
      field: 'perspectiveCharacterId',
      refValue: 999_999,
    })

    const accepted = await adopt({
      projectId: seeded.projectId,
      target: 'chapters',
      mode: 'add',
      data: { ...base, perspectiveCharacterId: seeded.characterId },
    })
    expect(accepted.written).toHaveLength(1)
    expect((await db.chapters.get(accepted.written[0].id))?.perspectiveCharacterId)
      .toBe(seeded.characterId)
  })

  it('导出导入重映射视角角色，删除角色只清空引用不删除章节', async () => {
    const seeded = await seed()
    const now = Date.now()
    const chapterId = await db.chapters.add({
      projectId: seeded.projectId,
      outlineNodeId: seeded.outlineNodeId,
      title: '第一章',
      content: '<p>潮门开启。</p>',
      wordCount: 6,
      status: 'draft',
      order: 0,
      notes: '',
      perspectiveCharacterId: seeded.characterId,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    await finalizeCurrentFixtureV1(seeded.projectId)

    const exported = await deriveExportProjectJSON(seeded.projectId)
    const importedProjectId = await deriveImportProjectJSON(exported)
    const importedCharacter = (await db.characters.where('projectId').equals(importedProjectId).toArray())
      .find(character => character.name === '守灯人')
    const importedChapter = (await db.chapters.where('projectId').equals(importedProjectId).toArray())
      .find(chapter => chapter.title === '第一章')
    expect(importedCharacter?.id).toBeDefined()
    expect(importedCharacter?.id).not.toBe(seeded.characterId)
    expect(importedChapter?.perspectiveCharacterId).toBe(importedCharacter?.id)

    await useCharacterStore.getState().loadAll(seeded.projectId)
    await useCharacterStore.getState().deleteCharacter(seeded.characterId)
    expect(await db.chapters.get(chapterId)).toMatchObject({
      id: chapterId,
      perspectiveCharacterId: null,
    })
  })
})
