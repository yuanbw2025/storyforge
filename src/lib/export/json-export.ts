import { db } from '../db/schema'
import type {
  Project, Worldview, StoryCore, PowerSystem,
  Character, Faction, OutlineNode, Chapter,
  Foreshadow, Geography, History, ItemSystem,
  CreativeRules, CharacterRelation,
} from '../types'

/** 完整项目导出数据结构 */
export interface ProjectExportData {
  version: number
  exportedAt: number
  project: Omit<Project, 'id'>
  worldviews: Omit<Worldview, 'id' | 'projectId'>[]
  storyCores: Omit<StoryCore, 'id' | 'projectId'>[]
  powerSystems: Omit<PowerSystem, 'id' | 'projectId'>[]
  characters: Omit<Character, 'id' | 'projectId'>[]
  factions: Omit<Faction, 'id' | 'projectId'>[]
  outlineNodes: (Omit<OutlineNode, 'id' | 'projectId'> & { _exportId: number; _parentExportId: number | null })[]
  chapters: (Omit<Chapter, 'id' | 'projectId' | 'outlineNodeId'> & { _outlineExportId: number })[]
  foreshadows: Omit<Foreshadow, 'id' | 'projectId'>[]
  geographies: Omit<Geography, 'id' | 'projectId'>[]
  histories: Omit<History, 'id' | 'projectId'>[]
  itemSystems: Omit<ItemSystem, 'id' | 'projectId'>[]
  creativeRules: Omit<CreativeRules, 'id' | 'projectId'>[]
  characterRelations: (Omit<CharacterRelation, 'id' | 'projectId' | 'fromCharacterId' | 'toCharacterId'> & {
    _fromCharacterIndex: number
    _toCharacterIndex: number
  })[]
}

/** 导出项目为 JSON */
export async function exportProjectJSON(projectId: number): Promise<ProjectExportData> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('项目不存在')

  const [
    worldviews, storyCores, powerSystems,
    characters, factions, outlineNodes, chapters,
    foreshadows, geographies, histories, itemSystems,
    creativeRules, characterRelations,
  ] = await Promise.all([
    db.worldviews.where('projectId').equals(projectId).toArray(),
    db.storyCores.where('projectId').equals(projectId).toArray(),
    db.powerSystems.where('projectId').equals(projectId).toArray(),
    db.characters.where('projectId').equals(projectId).toArray(),
    db.factions.where('projectId').equals(projectId).toArray(),
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
    db.foreshadows.where('projectId').equals(projectId).toArray(),
    db.geographies.where('projectId').equals(projectId).toArray(),
    db.histories.where('projectId').equals(projectId).toArray(),
    db.itemSystems.where('projectId').equals(projectId).toArray(),
    db.creativeRules.where('projectId').equals(projectId).toArray(),
    db.characterRelations.where('projectId').equals(projectId).toArray(),
  ])

  // 构建大纲 ID 映射（旧 ID → 导出序号）
  const outlineIdMap = new Map<number, number>()
  outlineNodes.forEach((n, i) => { if (n.id) outlineIdMap.set(n.id, i) })

  // 构建角色 ID 映射（旧 ID → 导出序号）
  const charIdMap = new Map<number, number>()
  characters.forEach((c, i) => { if (c.id) charIdMap.set(c.id, i) })

  // 去除 id/projectId，保留关联关系
  const { id: _pid, ...projectData } = project

  return {
    version: 1,
    exportedAt: Date.now(),
    project: projectData,
    worldviews: worldviews.map(({ id: _, projectId: __, ...rest }) => rest),
    storyCores: storyCores.map(({ id: _, projectId: __, ...rest }) => rest),
    powerSystems: powerSystems.map(({ id: _, projectId: __, ...rest }) => rest),
    characters: characters.map(({ id: _, projectId: __, ...rest }) => rest),
    factions: factions.map(({ id: _, projectId: __, ...rest }) => rest),
    outlineNodes: outlineNodes.map((n) => {
      const { id, projectId: __, ...rest } = n
      return {
        ...rest,
        _exportId: outlineIdMap.get(id!) ?? 0,
        _parentExportId: n.parentId ? (outlineIdMap.get(n.parentId) ?? null) : null,
      }
    }),
    chapters: chapters.map((ch) => {
      const { id: _, projectId: __, outlineNodeId, ...rest } = ch
      return {
        ...rest,
        _outlineExportId: outlineIdMap.get(outlineNodeId) ?? 0,
      }
    }),
    foreshadows: foreshadows.map(({ id: _, projectId: __, ...rest }) => rest),
    geographies: geographies.map(({ id: _, projectId: __, ...rest }) => rest),
    histories: histories.map(({ id: _, projectId: __, ...rest }) => rest),
    itemSystems: itemSystems.map(({ id: _, projectId: __, ...rest }) => rest),
    creativeRules: creativeRules.map(({ id: _, projectId: __, ...rest }) => rest),
    characterRelations: characterRelations.map((r) => {
      const { id: _, projectId: __, fromCharacterId, toCharacterId, ...rest } = r
      return {
        ...rest,
        _fromCharacterIndex: charIdMap.get(fromCharacterId) ?? -1,
        _toCharacterIndex: charIdMap.get(toCharacterId) ?? -1,
      }
    }),
  }
}

/** 下载 JSON 文件 */
export function downloadJSON(data: ProjectExportData, filename: string) {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 导入项目 JSON — 返回新项目 ID */
export async function importProjectJSON(data: ProjectExportData): Promise<number> {
  if (!data.version || !data.project) {
    throw new Error('无效的导出文件格式')
  }

  const now = Date.now()

  // 1. 创建项目
  const newProjectId = await db.projects.add({
    ...data.project,
    name: `${data.project.name}（导入）`,
    createdAt: now,
    updatedAt: now,
  } as Project) as number

  // 2. 导入世界观相关
  for (const w of data.worldviews || []) {
    await db.worldviews.add({ ...w, projectId: newProjectId } as Worldview)
  }
  for (const sc of data.storyCores || []) {
    await db.storyCores.add({ ...sc, projectId: newProjectId } as StoryCore)
  }
  for (const ps of data.powerSystems || []) {
    await db.powerSystems.add({ ...ps, projectId: newProjectId } as PowerSystem)
  }

  // 3. 导入角色（需要记录新旧 ID 映射）
  const newCharIds = new Map<number, number>()
  for (let i = 0; i < (data.characters || []).length; i++) {
    const c = data.characters[i]
    const newId = await db.characters.add({ ...c, projectId: newProjectId } as Character) as number
    newCharIds.set(i, newId)
  }

  // 4. 导入势力
  for (const f of data.factions || []) {
    await db.factions.add({ ...f, projectId: newProjectId } as Faction)
  }

  // 5. 导入大纲节点（需要重建 parentId 关联）
  const newOutlineIds = new Map<number, number>()
  // 先按 parentId 排序：null 的先导入（顶层节点）
  const sortedNodes = [...(data.outlineNodes || [])].sort((a, b) => {
    if (a._parentExportId === null && b._parentExportId !== null) return -1
    if (a._parentExportId !== null && b._parentExportId === null) return 1
    return (a._exportId ?? 0) - (b._exportId ?? 0)
  })
  for (const n of sortedNodes) {
    const { _exportId, _parentExportId, parentId: _, ...rest } = n
    const newParentId = _parentExportId !== null ? (newOutlineIds.get(_parentExportId) ?? null) : null
    const newId = await db.outlineNodes.add({
      ...rest,
      parentId: newParentId,
      projectId: newProjectId,
    } as OutlineNode) as number
    newOutlineIds.set(_exportId, newId)
  }

  // 6. 导入章节（重建 outlineNodeId 关联）
  for (const ch of data.chapters || []) {
    const { _outlineExportId, ...rest } = ch
    const newOutlineNodeId = newOutlineIds.get(_outlineExportId) ?? 0
    await db.chapters.add({
      ...rest,
      outlineNodeId: newOutlineNodeId,
      projectId: newProjectId,
    } as Chapter)
  }

  // 7. 导入伏笔
  for (const f of data.foreshadows || []) {
    await db.foreshadows.add({ ...f, projectId: newProjectId } as Foreshadow)
  }

  // 8. 导入其他模块
  for (const g of data.geographies || []) {
    await db.geographies.add({ ...g, projectId: newProjectId } as Geography)
  }
  for (const h of data.histories || []) {
    await db.histories.add({ ...h, projectId: newProjectId } as History)
  }
  for (const item of data.itemSystems || []) {
    await db.itemSystems.add({ ...item, projectId: newProjectId } as ItemSystem)
  }
  for (const cr of data.creativeRules || []) {
    await db.creativeRules.add({ ...cr, projectId: newProjectId } as CreativeRules)
  }

  // 9. 导入角色关系（重建 fromCharacterId/toCharacterId）
  for (const r of data.characterRelations || []) {
    const { _fromCharacterIndex, _toCharacterIndex, ...rest } = r
    const fromId = newCharIds.get(_fromCharacterIndex)
    const toId = newCharIds.get(_toCharacterIndex)
    if (fromId && toId) {
      await db.characterRelations.add({
        ...rest,
        fromCharacterId: fromId,
        toCharacterId: toId,
        projectId: newProjectId,
      } as CharacterRelation)
    }
  }

  return newProjectId
}
