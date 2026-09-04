import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  generateDocumentId,
  generateWorkspaceUid,
  generateWorkCode,
  isWorkspaceDocumentId,
  isWorkspaceUid,
  isWorkCode,
} from '../../src/lib/memory/identity'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  loadProjectFolderHandle,
  loadFolderHandle,
  saveProjectFolderHandle,
  workspaceFolderKey,
} from '../../src/lib/storage/folder-handle-store'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { buildWorkspaceSelfCheckReportV1 } from '../../src/lib/memory/workspace-projection'

describe('MEMORY-1 · stable identity and lifecycle', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('generates closed portable identity formats', () => {
    expect(isWorkspaceUid(generateWorkspaceUid())).toBe(true)
    expect(isWorkCode(generateWorkCode())).toBe(true)
    expect(isWorkspaceDocumentId(generateDocumentId())).toBe(true)
    expect(isWorkspaceUid('project-1')).toBe(false)
    expect(isWorkCode('my-title')).toBe(false)
  })

  it('creates stable ids during ownership adoption and keeps work code across renames', async () => {
    const created = await seedCurrentWorkspace('稳定身份')
    const resolved = await resolveWorkspaceOwnership(created.scope.projectId)
    expect(resolved.project.workspaceUid).toBe(created.project.workspaceUid)
    expect(isWorkCode(resolved.work.code)).toBe(true)
    const code = resolved.work.code
    await db.works.update(resolved.work.id!, { title: '改名后的作品' })
    expect((await db.works.get(resolved.work.id!))?.code).toBe(code)
  })

  it('rekeys a JSON clone when its workspace uid already exists', async () => {
    const created = await seedCurrentWorkspace('源项目')
    const importedId = await importProjectJSON(await exportProjectJSON(created.scope.projectId))
    const imported = await db.projects.get(importedId)
    expect(isWorkspaceUid(imported?.workspaceUid)).toBe(true)
    expect(imported?.workspaceUid).not.toBe(created.project.workspaceUid)
    expect(isWorkCode((await db.works.where('projectId').equals(importedId).first())?.code)).toBe(true)
  })

  it('cascades document baselines with the project', async () => {
    const now = Date.now()
    const created = await seedCurrentWorkspace('待删除')
    const projectId = created.scope.projectId
    const workspaceUid = created.project.workspaceUid
    await db.workspaceDocuments.add({
      projectId, workspaceUid, documentId: generateDocumentId(), documentKind: 'work',
      tableName: 'works', relativePath: 'works/a/work.yaml', codec: 'yaml',
      editPolicy: 'author-editable', schemaVersion: 1, baselineCanonicalHash: null,
      databaseCanonicalHash: null, fileCanonicalHash: null, lastSyncRevision: 0,
      createdAt: now, updatedAt: now,
    })
    await cascadeDeleteProject(projectId)
    expect(await db.workspaceDocuments.where('projectId').equals(projectId).count()).toBe(0)
  })

  it('只使用稳定 workspace UID 保存和读取文件夹绑定', async () => {
    const workspaceUid = generateWorkspaceUid()
    const handle = { name: '当前绑定', kind: 'directory' as const }
    await saveProjectFolderHandle({ workspaceUid }, handle as any)
    expect(await loadProjectFolderHandle({ workspaceUid })).toMatchObject({ name: '当前绑定' })
    expect(await loadFolderHandle(workspaceFolderKey(workspaceUid))).toMatchObject({ name: '当前绑定' })
  })

  it('语义工作区对缺失的当前身份直接拒绝，不在读取路径回填', async () => {
    const created = await seedCurrentWorkspace('身份硬门')
    await db.works.update(created.scope.workId, { code: 'INVALID' })
    await expect(buildWorkspaceSelfCheckReportV1(
      created.scope.projectId,
      {} as FileSystemDirectoryHandle,
    )).rejects.toThrow('当前 Work 缺少稳定身份')
    expect((await db.works.get(created.scope.workId))?.code).toBe('INVALID')
  })
})
