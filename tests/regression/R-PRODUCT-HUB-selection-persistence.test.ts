import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  loadProductHubWorkspaceCatalogV1,
  PRODUCT_HUB_WORK_WORKSPACE_PARAM_V1,
  PRODUCT_HUB_WORLD_WORKSPACE_PARAM_V1,
  resolveProductHubWorkspaceSelectionV1,
  updateProductHubWorkspaceQueryV1,
} from '../../src/lib/workspace/product-hub-selection'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import type { Project, WorkspacePurpose } from '../../src/lib/types/project'

async function createSelectionWorkspace(name: string, purpose: WorkspacePurpose): Promise<Project & { id: number }> {
  const created = await createWorkspace({
    name,
    genres: ['other'],
    status: 'drafting',
    description: `${name} 的测试说明`,
    targetWordCount: 100_000,
  }, { purpose })
  return created.project as Project & { id: number }
}

describe('ProductHub 活动 World/Work 选择', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('用稳定 workspaceUid 写入 URL，刷新解析后仍选择同一导入 Work，并保留既有 query', async () => {
    const first = await createSelectionWorkspace('来源世界', 'world-engine')
    const imported = await createSelectionWorkspace('导入 Work', 'world-engine')
    const authoring = await createSelectionWorkspace('独立作品', 'independent-work')
    const catalog = await loadProductHubWorkspaceCatalogV1([first, imported, authoring])

    let query = new URLSearchParams('build=quality-repair-v6&trace=kept')
    query = updateProductHubWorkspaceQueryV1(query, 'world-engine', imported.workspaceUid)
    query = updateProductHubWorkspaceQueryV1(query, 'independent-work', authoring.workspaceUid)

    const afterReload = new URLSearchParams(query.toString())
    expect(resolveProductHubWorkspaceSelectionV1(
      catalog.worldProjects,
      afterReload.get(PRODUCT_HUB_WORLD_WORKSPACE_PARAM_V1),
    )?.id).toBe(imported.id)
    expect(resolveProductHubWorkspaceSelectionV1(
      catalog.workProjects,
      afterReload.get(PRODUCT_HUB_WORK_WORKSPACE_PARAM_V1),
    )?.id).toBe(authoring.id)
    expect(afterReload.get('build')).toBe('quality-repair-v6')
    expect(afterReload.get('trace')).toBe('kept')
  })

  it('删除、跨项目 Work 指针和错误产品用途都不会被恢复，并安全回退到合法工作区', async () => {
    const valid = await createSelectionWorkspace('合法世界', 'world-engine')
    const foreignOwner = await createSelectionWorkspace('外部世界', 'world-engine')
    const invalid = await createSelectionWorkspace('指针越权世界', 'world-engine')
    const deleted = await createSelectionWorkspace('已删除世界', 'world-engine')
    const wrongPurpose = await createSelectionWorkspace('独立作品', 'independent-work')

    await db.projects.update(invalid.id, { activeWorkId: foreignOwner.activeWorkId })
    await db.projects.delete(deleted.id)
    const invalidSnapshot = (await db.projects.get(invalid.id))!
    const catalog = await loadProductHubWorkspaceCatalogV1([
      valid,
      invalidSnapshot,
      deleted,
      wrongPurpose,
    ])

    expect(catalog.worldProjects.map(project => project.id)).toEqual([valid.id])
    expect(catalog.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: invalid.id, code: 'WORK_ROOT_INVALID' }),
      expect.objectContaining({ projectId: deleted.id, code: 'WORKSPACE_NOT_FOUND' }),
    ]))
    expect(resolveProductHubWorkspaceSelectionV1(
      catalog.worldProjects,
      invalid.workspaceUid,
    )?.id).toBe(valid.id)
    expect(resolveProductHubWorkspaceSelectionV1(
      catalog.worldProjects,
      deleted.workspaceUid,
    )?.id).toBe(valid.id)
    expect(resolveProductHubWorkspaceSelectionV1(
      catalog.worldProjects,
      wrongPurpose.workspaceUid,
    )?.id).toBe(valid.id)
    expect(resolveProductHubWorkspaceSelectionV1(
      catalog.worldProjects,
      'WS-not-a-real-identity',
    )?.id).toBe(valid.id)
  })

  it('拒绝把非稳定身份写进导航 query，清空选择时不影响其他参数', () => {
    const original = new URLSearchParams('build=quality-repair-v6&worldWorkspace=stale')
    expect(() => updateProductHubWorkspaceQueryV1(
      original,
      'world-engine',
      'not-a-workspace-uid',
    )).toThrow('workspaceUid 无效')
    const cleared = updateProductHubWorkspaceQueryV1(original, 'world-engine', null)
    expect(cleared.has(PRODUCT_HUB_WORLD_WORKSPACE_PARAM_V1)).toBe(false)
    expect(cleared.get('build')).toBe('quality-repair-v6')
  })
})
