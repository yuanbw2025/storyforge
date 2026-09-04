import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  buildInspirationFusionInput,
  createInspirationFragment,
  diffInspirationResults,
  MAX_INSPIRATION_FRAGMENT_CHARS,
  MAX_INSPIRATION_FRAGMENTS,
  MAX_INSPIRATION_FUSION_CHARS,
  MAX_INSPIRATION_VERSIONS,
  parseInspirationFragments,
  upsertInspirationFragment,
} from '../../src/lib/inspiration/workspace'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { useInspirationWorkspaceStore } from '../../src/stores/inspiration-workspace'
import { seedCurrentProject } from '../helpers/current-workspace'

async function createProject(name = 'CM1 Test'): Promise<number> {
  const now = Date.now()
  return await seedCurrentProject({
    name,
    genres: [],
    description: '',
    targetWordCount: 0,
    enableMultiWorld: false,
    createdAt: now,
    updatedAt: now,
  } as never) as number
}

describe('R-CM1 · 增量灵感工作区', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useInspirationWorkspaceStore.setState({
      workspace: null,
      fragments: [],
      versions: [],
      loading: false,
    })
  })
  afterEach(() => db.close())

  it('对碎片去重并同时限制单条、总数与融合输入', () => {
    const first = createInspirationFragment({
      text: '  深海里的失忆守塔人  ',
      label: '开场',
      now: 1,
    })!
    expect(first.text).toBe('深海里的失忆守塔人')
    expect(createInspirationFragment({
      text: '潮'.repeat(MAX_INSPIRATION_FRAGMENT_CHARS + 1),
    })).toBeNull()

    let fragments = upsertInspirationFragment([], first)
    fragments = upsertInspirationFragment(fragments, createInspirationFragment({
      text: '深海里的 失忆守塔人',
      now: 2,
    })!)
    expect(fragments).toHaveLength(1)

    for (let index = 0; index < MAX_INSPIRATION_FRAGMENTS + 3; index++) {
      fragments = upsertInspirationFragment(fragments, createInspirationFragment({
        text: `${index}-` + '潮'.repeat(MAX_INSPIRATION_FRAGMENT_CHARS - `${index}-`.length),
        now: index + 10,
      })!)
    }
    expect(fragments).toHaveLength(MAX_INSPIRATION_FRAGMENTS)
    expect(Math.max(...fragments.map(fragment => fragment.text.length)))
      .toBeLessThanOrEqual(MAX_INSPIRATION_FRAGMENT_CHARS)

    const input = buildInspirationFusionInput({
      fragments,
      selectedIds: new Set(fragments.map(fragment => fragment.id)),
    })
    expect(input.length).toBeLessThanOrEqual(MAX_INSPIRATION_FUSION_CHARS)
    expect(input).toContain('本次参与融合的灵感碎片')
  })

  it('持久化来源、父版本与参与碎片，并只保留最近版本', async () => {
    const projectId = await createProject()
    const store = useInspirationWorkspaceStore.getState()
    const fragment = await store.addFragment(projectId, {
      text: '旧城每次下雨都会忘记一个人',
      label: '规则',
      sourceKind: 'author',
    })
    expect(fragment).not.toBeNull()

    let parentId: string | null = null
    for (let index = 0; index < MAX_INSPIRATION_VERSIONS + 2; index++) {
      const version = await useInspirationWorkspaceStore.getState().saveVersion(projectId, {
        mode: 'single',
        parentVersionId: parentId,
        fragmentIds: [fragment!.id],
        result: { storyCore: { logline: `版本 ${index}` } },
      })
      parentId = version.id
    }

    const row = await db.inspirationWorkspaces.where('projectId').equals(projectId).first()
    const storedFragments = parseInspirationFragments(row?.fragments)
    const storedVersions = JSON.parse(row!.versions) as Array<{
      id: string
      parentVersionId: string | null
      fragmentIds: string[]
      resultJson: string
    }>
    expect(storedFragments[0]).toMatchObject({
      text: '旧城每次下雨都会忘记一个人',
      label: '规则',
      sourceKind: 'author',
    })
    expect(storedVersions).toHaveLength(MAX_INSPIRATION_VERSIONS)
    const retainedIds = new Set(storedVersions.map(version => version.id))
    expect(storedVersions[0].parentVersionId).toBeNull()
    expect(storedVersions.slice(1).every(version => (
      version.parentVersionId === null || retainedIds.has(version.parentVersionId)
    ))).toBe(true)
    expect(storedVersions.at(-1)?.fragmentIds).toEqual([fragment!.id])
    expect(storedVersions.at(-1)?.resultJson).toContain(`版本 ${MAX_INSPIRATION_VERSIONS + 1}`)
    const assembled = await assembleContext({
      projectId,
      sourceKeys: ['inspirationWorkspace'],
      inspirationFragmentIds: [fragment!.id],
      inspirationMode: 'single',
    })
    expect(assembled.included).toEqual(['inspirationWorkspace'])
    expect(assembled.text).toContain('旧城每次下雨都会忘记一个人')
    expect(assembled.text).toContain(`版本 ${MAX_INSPIRATION_VERSIONS + 1}`)
    await expect(useInspirationWorkspaceStore.getState().removeFragment(projectId, fragment!.id))
      .rejects.toThrow('不能删除来源证据')
  })

  it('导出导入重映射项目，删除项目级联清理工作区', async () => {
    const projectId = await createProject()
    const fragment = await useInspirationWorkspaceStore.getState().addFragment(projectId, {
      text: '所有影子都在午夜离开主人',
      sourceKind: 'research',
    })
    await useInspirationWorkspaceStore.getState().saveVersion(projectId, {
      mode: 'single',
      fragmentIds: [fragment!.id],
      result: { storyCore: { logline: '追赶逃走的影子' } },
    })

    const exported = await exportProjectJSON(projectId)
    expect(exported.inspirationWorkspaces).toHaveLength(1)
    expect(exported.inspirationWorkspaces?.[0].fragments).toContain('午夜')

    const importedProjectId = await importProjectJSON(exported)
    const imported = await db.inspirationWorkspaces
      .where('projectId').equals(importedProjectId).first()
    expect(imported?.projectId).toBe(importedProjectId)
    expect(imported?.versions).toContain('追赶逃走的影子')

    await cascadeDeleteProject(projectId)
    expect(await db.inspirationWorkspaces.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.inspirationWorkspaces.where('projectId').equals(importedProjectId).count()).toBe(1)
  })

  it('差异预览公开新增、修改与删除字段', () => {
    const changes = diffInspirationResults(
      {
        storyCore: { theme: '复仇', logline: '旧版本' },
        characters: [{ name: '林照', motivation: '复仇' }],
      },
      {
        storyCore: { theme: '宽恕', logline: '新版本' },
        characters: [{ name: '林照', motivation: '寻找真相' }, { name: '顾夜', motivation: '阻止他' }],
      },
    )
    expect(changes).toContainEqual({
      path: 'storyCore.theme',
      before: '复仇',
      after: '宽恕',
    })
    expect(changes.some(change => change.path === 'characters[顾夜].name' && change.before === '')).toBe(true)
  })
})
