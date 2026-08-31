import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Project, CreateProjectInput } from '../lib/types'
import { migrateGenre } from '../lib/types'
import { requireBackupBefore } from '../lib/safety/require-backup-before'
import { cascadeDeleteProject } from '../lib/registry/lifecycle'
import { ensureWorkspaceOwnership } from '../lib/world-engine/ownership'
import { updateProjectAndActiveWork } from '../lib/world-engine/works'
import { clearProjectFolderHandle } from '../lib/storage/folder-handle-store'
import { backfillResourceUidsV1 } from '../lib/context-gateway/resource-identity'
import { createWorkspace, type CreateWorkspaceOptions } from '../lib/world-engine/create-workspace'

interface ProjectStore {
  projects: Project[]
  currentProjectId: number | null
  loading: boolean

  loadProjects: () => Promise<void>
  loadProject: (id: number) => Promise<Project | undefined>
  createProject: (data: CreateProjectInput, options?: CreateWorkspaceOptions) => Promise<number>
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
    // 汇总每个项目的字数（从 chapters 表实时计算）
    const allChapters = await db.chapters.toArray()
    const wordCountByProject = new Map<number, number>()
    for (const ch of allChapters) {
      wordCountByProject.set(
        ch.projectId,
        (wordCountByProject.get(ch.projectId) ?? 0) + (ch.wordCount ?? 0),
      )
    }
    // 兼容旧数据：确保每条记录都有 genres[] 和 status
    const projects = raw.map(rawProject => {
      const migrated = migrateGenre(rawProject)
      migrated.currentWordCount = wordCountByProject.get(rawProject.id!) ?? 0
      return migrated
    })
    set({ projects, loading: false })
  },

  loadProject: async (id: number) => {
    const raw = await db.projects.get(id)
    if (!raw) return undefined
    // WORLD-2C C2: projectId-only legacy routes resolve through one ownership
    // service before any project-scoped stores begin reading the workspace.
    const project = migrateGenre((await ensureWorkspaceOwnership(id)).project)
    // CTXG-2 explicit workspace-entry migration. Catalog/search remain strictly
    // read-only; legacy identity repair happens once before feature stores load.
    await backfillResourceUidsV1(id)
    const projects = get().projects
    const exists = projects.some(p => p.id === id)
    const nextProjects = exists
      ? projects.map(p => p.id === id ? project : p)
      : [...projects, project].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    set({ currentProjectId: id, projects: nextProjects })
    return project
  },

  createProject: async (data: CreateProjectInput, options?: CreateWorkspaceOptions) => {
    const created = await createWorkspace(data, options)
    await get().loadProjects()
    return created.scope.projectId
  },

  updateProject: async (id: number, data: Partial<Project>) => {
    await updateProjectAndActiveWork(id, data)
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

    const project = await db.projects.get(id)

    // Phase 1.1b: 级联删除全部从 PROJECT_TABLES 注册表派生(不再手写表清单)。
    // 加新表 = 注册表加一行,这里自动覆盖。行为与 Phase 0.6 手写版等价(R-05 保证)。
    await cascadeDeleteProject(id)
    if (project) {
      try {
        await clearProjectFolderHandle(project)
      } catch (error) {
        // The project is already deleted. A stale browser handle grants no
        // automatic access, so cleanup failure must not leave the UI stuck.
        console.warn('[project-storage] 删除项目后清理文件夹关联失败', error)
      }
    }

    if (get().currentProjectId === id) {
      set({ currentProjectId: null })
    }
    await get().loadProjects()
  },

  setCurrentProject: (id: number | null) => {
    set({ currentProjectId: id })
  },
}))
