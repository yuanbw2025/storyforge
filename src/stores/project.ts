import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Project, CreateProjectInput } from '../lib/types'
import { migrateGenre } from '../lib/types'
import { requireBackupBefore } from '../lib/safety/require-backup-before'
import { cascadeDeleteProject } from '../lib/registry/lifecycle'
import {
  generateWorldCode,
  hasShareableWorldIdentity,
  withWorldIdentity,
} from '../lib/product/world-identity'
import { ensureWorkspaceOwnership } from '../lib/world-engine/ownership'

async function ensureWorldIdentity(project: Project): Promise<Project> {
  if (hasShareableWorldIdentity(project)) return project
  if (!project.id) return withWorldIdentity(project)

  // Legacy projects are upgraded in a transaction so concurrent entry points
  // cannot assign different world codes to the same project.
  return db.transaction('rw', db.projects, async () => {
    const latest = await db.projects.get(project.id!)
    if (!latest) return withWorldIdentity(project)
    if (hasShareableWorldIdentity(latest)) return migrateGenre(latest)
    const normalized = withWorldIdentity(migrateGenre(latest))
    await db.projects.update(project.id!, {
      worldCode: normalized.worldCode,
      worldVersion: normalized.worldVersion,
    })
    return normalized
  })
}

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
    const projects = await Promise.all(raw.map(rawProject => ensureWorldIdentity(migrateGenre(rawProject))))
    set({ projects, loading: false })
  },

  loadProject: async (id: number) => {
    const raw = await db.projects.get(id)
    if (!raw) return undefined
    // WORLD-2C C2: projectId-only legacy routes resolve through one ownership
    // service before any project-scoped stores begin reading the workspace.
    const project = migrateGenre((await ensureWorkspaceOwnership(id)).project)
    const projects = get().projects
    const exists = projects.some(p => p.id === id)
    const nextProjects = exists
      ? projects.map(p => p.id === id ? project : p)
      : [...projects, project].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    set({ currentProjectId: id, projects: nextProjects })
    return project
  },

  createProject: async (data: CreateProjectInput) => {
    const now = Date.now()
    const id = await db.projects.add({
      ...data,
      genres: data.genres ?? [],
      status: data.status ?? 'drafting',
      worldCode: data.worldCode ?? generateWorldCode(),
      worldVersion: data.worldVersion ?? 1,
      createdAt: now,
      updatedAt: now,
    } as Project)
    await ensureWorkspaceOwnership(id as number)
    await get().loadProjects()
    return id as number
  },

  updateProject: async (id: number, data: Partial<Project>) => {
    await db.projects.update(id, { ...data, updatedAt: Date.now() })
    await get().loadProjects()
  },

  deleteProject: async (id: number) => {
    // 数据红线:删项目前强制提示备份(Pre-Phase 0 安全网)
    const proceed = await requireBackupBefore({
      operation: '删除项目',
      projectId: id,
      details: '此操作将清除该项目的全部数据(章节、世界观、角色、词条、状态卡等),不可恢复。',
    })
    if (!proceed) return  // 用户取消

    // Phase 1.1b: 级联删除全部从 PROJECT_TABLES 注册表派生(不再手写表清单)。
    // 加新表 = 注册表加一行,这里自动覆盖。行为与 Phase 0.6 手写版等价(R-05 保证)。
    await cascadeDeleteProject(id)

    if (get().currentProjectId === id) {
      set({ currentProjectId: null })
    }
    await get().loadProjects()
  },

  setCurrentProject: (id: number | null) => {
    set({ currentProjectId: id })
  },
}))
