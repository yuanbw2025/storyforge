import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import {
  buildRelationshipFieldPatches,
  syncRelationToCharacterFields,
} from '../../src/lib/relations/relationship-summary'
import type { Character, CharacterRelation } from '../../src/lib/types'

const panelSource = readFileSync('src/components/relations/CharacterRelationPanel.tsx', 'utf8')
const graphSource = readFileSync('src/components/relations/RelationGraph.tsx', 'utf8')

const now = 1_780_000_000_000

async function createProject(name = '关系测试项目'): Promise<number> {
  return await db.projects.add({
    name,
    genre: '',
    description: '',
    targetWordCount: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
}

async function createCharacter(projectId: number, name: string, relationships = ''): Promise<Character> {
  const id = await db.characters.add({
    projectId,
    name,
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
    relationships,
    arc: '',
    createdAt: now,
    updatedAt: now,
  } as Character) as number
  return (await db.characters.get(id))!
}

function relation(
  projectId: number,
  fromCharacterId: number,
  toCharacterId: number,
  patch: Partial<CharacterRelation> = {},
): CharacterRelation {
  return {
    projectId,
    fromCharacterId,
    toCharacterId,
    relationType: 'master',
    label: '师徒',
    description: '传授破阵术',
    isBidirectional: true,
    createdAt: now,
    updatedAt: now,
    ...patch,
  }
}

describe('CF-20260703-4/5 · 角色关系保存反馈与角色词条同步', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    await db.delete()
    await db.open()
  })

  it('关系图由父组件传入当前项目角色/关系，不直接读取全局 store', () => {
    expect(graphSource).toContain('characters: Character[]')
    expect(graphSource).toContain('relations: CharacterRelation[]')
    expect(graphSource).not.toContain('useCharacterStore')
    expect(graphSource).not.toContain('useCharacterRelationStore')

    expect(panelSource).toContain('characters.filter((c) => c.projectId === projectId)')
    expect(panelSource).toContain('relations.filter((r) => r.projectId === projectId)')
    expect(panelSource).toContain('<RelationGraph characters={projectCharacters} relations={validProjectRelations}')
  })

  it('只在采纳 AI 抽取关系后同步角色词条，手动占位关系不会污染人物关系描述', () => {
    const syncCalls = panelSource.match(/await syncRelationToCharacterFields/g) ?? []
    expect(syncCalls).toHaveLength(1)
    expect(panelSource).toContain('await addRelation(relation)\n        await syncRelationToCharacterFields')
    expect(panelSource).not.toContain("toast.success('关系已保存，并同步到角色词条。')")
    expect(panelSource).toContain("toast.success('关系已保存。')")
  })

  it('构建角色卡人物关系补丁时保留手写内容、双向追加、重复关系不重复写', async () => {
    const projectId = await createProject()
    const a = await createCharacter(projectId, '沈璃', '手写关系：与旧友有约。')
    const b = await createCharacter(projectId, '行止')
    const rel = relation(projectId, a.id!, b.id!)

    const first = buildRelationshipFieldPatches({ projectId, relation: rel, characters: [a, b] })
    expect(first).toEqual([
      { characterId: a.id, relationships: '手写关系：与旧友有约。\n- 与【行止】：师徒。传授破阵术' },
      { characterId: b.id, relationships: '- 与【沈璃】：师徒。传授破阵术' },
    ])

    const second = buildRelationshipFieldPatches({
      projectId,
      relation: rel,
      characters: [
        { ...a, relationships: first[0].relationships },
        { ...b, relationships: first[1].relationships },
      ],
    })
    expect(second).toEqual([])
  })

  it('单向关系给被关联方写入反向说明，端点角色不属于当前项目时跳过', async () => {
    const projectId = await createProject()
    const otherProjectId = await createProject('另一个项目')
    const a = await createCharacter(projectId, '甲')
    const b = await createCharacter(projectId, '乙')
    const outsider = await createCharacter(otherProjectId, '外部角色')

    const oneWay = buildRelationshipFieldPatches({
      projectId,
      relation: relation(projectId, a.id!, b.id!, {
        label: '保护',
        description: '暗中护送',
        isBidirectional: false,
      }),
      characters: [a, b],
    })
    expect(oneWay).toEqual([
      { characterId: a.id, relationships: '- 与【乙】：保护。暗中护送' },
      { characterId: b.id, relationships: '- 被【甲】关联：保护。暗中护送' },
    ])

    const invalid = buildRelationshipFieldPatches({
      projectId,
      relation: relation(projectId, a.id!, outsider.id!),
      characters: [a, outsider],
    })
    expect(invalid).toEqual([])
  })

  it('同步到角色词条时读取最新 DB 值，连续导入多条关系不会互相覆盖', async () => {
    const projectId = await createProject()
    const a = await createCharacter(projectId, '甲', '手写备注。')
    const b = await createCharacter(projectId, '乙')
    const c = await createCharacter(projectId, '丙')
    const staleCharacters = [a, b, c]

    await syncRelationToCharacterFields({
      projectId,
      relation: relation(projectId, a.id!, b.id!, { label: '同盟', description: '共同守城' }),
      characters: staleCharacters,
    })
    await syncRelationToCharacterFields({
      projectId,
      relation: relation(projectId, a.id!, c.id!, { label: '师徒', description: '传授心法' }),
      characters: staleCharacters,
    })
    await syncRelationToCharacterFields({
      projectId,
      relation: relation(projectId, a.id!, b.id!, { label: '同盟', description: '共同守城' }),
      characters: staleCharacters,
    })

    const latestA = await db.characters.get(a.id!)
    const latestB = await db.characters.get(b.id!)
    const latestC = await db.characters.get(c.id!)

    expect(latestA?.relationships).toBe('手写备注。\n- 与【乙】：同盟。共同守城\n- 与【丙】：师徒。传授心法')
    expect(latestA?.relationships.match(/与【乙】：同盟/g)).toHaveLength(1)
    expect(latestB?.relationships).toBe('- 与【甲】：同盟。共同守城')
    expect(latestC?.relationships).toBe('- 与【甲】：师徒。传授心法')
  })
})
