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
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  loadProjectFolderHandle,
  loadFolderHandle,
  projFolderKey,
  saveFolderHandle,
  workspaceFolderKey,
} from '../../src/lib/storage/folder-handle-store'

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
    const now = Date.now()
    const workspaceUid = generateWorkspaceUid()
    const projectId = await db.projects.add({
      workspaceUid,
      name: '稳定身份', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
      description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
    } as any) as number
    const resolved = await ensureWorkspaceOwnership(projectId)
    expect(resolved.project.workspaceUid).toBe(workspaceUid)
    expect(isWorkCode(resolved.work.code)).toBe(true)
    const code = resolved.work.code
    await db.works.update(resolved.work.id!, { title: '改名后的作品' })
    expect((await db.works.get(resolved.work.id!))?.code).toBe(code)
  })

  it('rekeys a JSON clone when its workspace uid already exists', async () => {
    const now = Date.now()
    const workspaceUid = generateWorkspaceUid()
    const projectId = await db.projects.add({
      workspaceUid,
      name: '源项目', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
      description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
    } as any) as number
    await ensureWorkspaceOwnership(projectId)
    const importedId = await importProjectJSON(await exportProjectJSON(projectId))
    const imported = await db.projects.get(importedId)
    expect(isWorkspaceUid(imported?.workspaceUid)).toBe(true)
    expect(imported?.workspaceUid).not.toBe(workspaceUid)
    expect(isWorkCode((await db.works.where('projectId').equals(importedId).first())?.code)).toBe(true)
  })

  it('cascades document baselines with the project', async () => {
    const now = Date.now()
    const workspaceUid = generateWorkspaceUid()
    const projectId = await db.projects.add({
      workspaceUid,
      name: '待删除', genre: '', genres: [], status: 'drafting', description: '',
      targetWordCount: 0, createdAt: now, updatedAt: now,
    } as any) as number
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

  it('migrates a legacy numeric folder binding to the stable workspace key', async () => {
    const workspaceUid = generateWorkspaceUid()
    const handle = { name: '旧绑定', kind: 'directory' as const }
    await saveFolderHandle(projFolderKey(7), handle as any)
    expect(await loadProjectFolderHandle({ id: 7, workspaceUid })).toMatchObject({ name: '旧绑定' })
    expect(await loadFolderHandle(projFolderKey(7))).toBeNull()
    expect(await loadFolderHandle(workspaceFolderKey(workspaceUid))).toMatchObject({ name: '旧绑定' })
  })
})
