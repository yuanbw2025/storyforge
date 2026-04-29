import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Project, CreateProjectInput } from '../lib/types'
import { migrateGenre } from '../lib/types'

interface ProjectStore {
  projects: Project[]
  currentProjectId: number | null
  loading: boolean

  loadProjects: () => Promise<void>
  loadProject: (id: number) => Promise<Project | undefined>
  createProject: (data: CreateProjectInput) => Promise<number>
  updateProject: (id: number, data: Partial<Project>) => Promise<void>
  deleteProject: (id: number) => Promise<void>
  setCurrentProject: (id: number | null) => void
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProjectId: null,
  loading: false,

  loadProjects: async () => {
    set({ loading: true })
    const raw = await db.projects.orderBy('updatedAt').reverse().toArray()
    // 兼容旧数据：确保每条记录都有 genres[] 和 status
    const projects = raw.map(migrateGenre)
    set({ projects, loading: false })
  },

  loadProject: async (id: number) => {
    const raw = await db.projects.get(id)
    if (!raw) return undefined
    const project = migrateGenre(raw)
    set({ currentProjectId: id })
    return project
  },

  createProject: async (data: CreateProjectInput) => {
    const now = Date.now()
    const id = await db.projects.add({
      ...data,
      genres: data.genres ?? [],
      status: data.status ?? 'drafting',
      createdAt: now,
      updatedAt: now,
    } as Project)
    await get().loadProjects()
    return id as number
  },

  updateProject: async (id: number, data: Partial<Project>) => {
    await db.projects.update(id, { ...data, updatedAt: Date.now() })
    await get().loadProjects()
  },

  deleteProject: async (id: number) => {
    // 删除项目及所有关联数据
    await db.transaction('rw', [
      db.projects, db.worldviews, db.storyCores, db.powerSystems,
      db.characters, db.factions, db.outlineNodes, db.chapters, db.foreshadows,
      db.geographies, db.histories, db.itemSystems, db.creativeRules,
      db.characterRelations, db.snapshots, db.references,
    ], async () => {
      await db.projects.delete(id)
      await db.worldviews.where('projectId').equals(id).delete()
      await db.storyCores.where('projectId').equals(id).delete()
      await db.powerSystems.where('projectId').equals(id).delete()
      await db.characters.where('projectId').equals(id).delete()
      await db.factions.where('projectId').equals(id).delete()
      await db.outlineNodes.where('projectId').equals(id).delete()
      await db.chapters.where('projectId').equals(id).delete()
      await db.foreshadows.where('projectId').equals(id).delete()
      await db.geographies.where('projectId').equals(id).delete()
      await db.histories.where('projectId').equals(id).delete()
      await db.itemSystems.where('projectId').equals(id).delete()
      await db.creativeRules.where('projectId').equals(id).delete()
      await db.characterRelations.where('projectId').equals(id).delete()
      await db.snapshots.where('projectId').equals(id).delete()
      await db.references.where('projectId').equals(id).delete()
    })
    if (get().currentProjectId === id) {
      set({ currentProjectId: null })
    }
    await get().loadProjects()
  },

  setCurrentProject: (id: number | null) => {
    set({ currentProjectId: id })
  },
}))
