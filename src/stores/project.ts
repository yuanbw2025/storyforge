import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Project, CreateWorkspaceInput } from '../lib/types'
import { requireBackupBefore } from '../lib/safety/require-backup-before'
import { cascadeDeleteProject } from '../lib/registry/lifecycle'
import { resolveWorkspaceOwnership } from '../lib/workspace/ownership'
import {
  updateActiveWork,
  updateWorkspace,
  type ActiveWorkPatch,
  type WorkspacePatch,
} from '../lib/workspace/works'
import { clearProjectFolderHandle } from '../lib/storage/folder-handle-store'
import { createWorkspace, type CreateWorkspaceOptions } from '../lib/workspace/create-workspace'

interface ProjectStore {
  projects: Project[]
  currentProjectId: number | null
  loading: boolean

  loadProjects: () => Promise<void>
  loadProject: (id: number) => Promise<Project | undefined>
  createWorkspace: (data: CreateWorkspaceInput, options?: CreateWorkspaceOptions) => Promise<number>
  updateWorkspace: (id: number, data: WorkspacePatch) => Promise<void>
  updateActiveWork: (id: number, data: ActiveWorkPatch) => Promise<void>
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
    set({ projects: raw, loading: false })
  },

  loadProject: async (id: number) => {
    const raw = await db.projects.get(id)
    if (!raw) return undefined
    // Project routes resolve through the sole current ownership service before
    // any project-scoped store begins reading the workspace.
    const project = (await resolveWorkspaceOwnership(id)).project
    const projects = get().projects
    const exists = projects.some(p => p.id === id)
    const nextProjects = exists
      ? projects.map(p => p.id === id ? project : p)
      : [...projects, project].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    set({ currentProjectId: id, projects: nextProjects })
    return project
  },

  createWorkspace: async (data: CreateWorkspaceInput, options?: CreateWorkspaceOptions) => {
    const created = await createWorkspace(data, options)
    await get().loadProjects()
    return created.scope.projectId
  },

  updateWorkspace: async (id: number, data: WorkspacePatch) => {
    await updateWorkspace(id, data)
    await get().loadProjects()
  },

  updateActiveWork: async (id: number, data: ActiveWorkPatch) => {
    await updateActiveWork(id, data)
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
