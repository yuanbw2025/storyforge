import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useProjectStore } from '../../src/stores/project'
import type { Project } from '../../src/lib/types'

const now = 1_780_000_000_000

async function addProject(name: string, updatedAt: number): Promise<number> {
  return await db.projects.add({
    name,
    genre: 'other',
    genres: ['other'],
    status: 'drafting',
    description: '',
    targetWordCount: 0,
    createdAt: updatedAt,
    updatedAt,
  } as Project) as number
}

describe('CF-20260703-3 · 工作区导入 JSON 后项目列表同步', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useProjectStore.setState({ projects: [], currentProjectId: null, loading: false })
  })

  it('loadProject 会把刚导入但不在 projects 列表里的项目 upsert 进去，避免工作区永久加载中', async () => {
    const existingId = await addProject('旧项目', now)
    const importedId = await addProject('导入项目', now + 10)

    useProjectStore.setState({
      currentProjectId: existingId,
      projects: [(await db.projects.get(existingId))!],
      loading: false,
    })

    const loaded = await useProjectStore.getState().loadProject(importedId)
    const state = useProjectStore.getState()

    expect(loaded?.id).toBe(importedId)
    expect(state.currentProjectId).toBe(importedId)
    expect(state.projects.map(p => p.id)).toContain(importedId)
    expect(state.projects.find(p => p.id === importedId)?.name).toBe('导入项目')
    expect(state.projects.map(p => p.id)).toEqual([importedId, existingId])
  })
})
