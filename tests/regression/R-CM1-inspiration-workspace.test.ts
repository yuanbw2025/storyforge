import { createWorldWork } from '../../src/lib/workspace/works'
import { freezePromptExecutionOptionsV1, renderFrozenPromptExecutionV1 } from '../../src/lib/agent/prompt-execution'
import { parseInspirationPromptConfigV1, type InspirationPromptChoiceV1 } from '../../src/lib/inspiration/prompt-config'
import { deleteWork, deleteWorld } from '../../src/lib/workspace/lifecycle'
import { resolveScopeLike } from '../../src/lib/workspace/scope'
import { adopt } from '../../src/lib/registry/adopt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { seedCurrentProject, seedCurrentWorkspace } from '../helpers/current-workspace'

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

async function boundChoice(): Promise<InspirationPromptChoiceV1> {
  const frozen = await freezePromptExecutionOptionsV1({
    request: { version: 1, moduleKey: 'inspiration.reverse' },
    template: { id: 900071, scope: 'user', moduleKey: 'inspiration.reverse', promptType: 'generate',
      name: 'Owned immutable version', description: '', systemPrompt: 'OWNED_SYSTEM {{tone}}', userPromptTemplate: 'OWNED_USER', variables: ['tone'],
      parameters: [{ key: 'tone', label: 'Tone', type: 'text', default: 'original' }], isActive: false, createdAt: 17, updatedAt: 23 },
  })
  return { kind: 'bound', template: frozen.template, templateHash: frozen.templateHash, parameterValues: { tone: 'chosen' } }
}
async function databaseRows() {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
}

describe('R-CM1 · 增量灵感工作区', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useInspirationWorkspaceStore.setState({
      scope: null, workspace: null,
      fragments: [],
      versions: [],
      loading: false,
    })
  })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

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

    for (let index = 0; index < MAX_INSPIRATION_FRAGMENTS - 1; index++) {
      fragments = upsertInspirationFragment(fragments, createInspirationFragment({
        text: `${index}-` + '潮'.repeat(MAX_INSPIRATION_FRAGMENT_CHARS - `${index}-`.length),
        now: index + 10,
      })!)
    }
    expect(fragments).toHaveLength(MAX_INSPIRATION_FRAGMENTS)
    expect(() => upsertInspirationFragment(fragments, createInspirationFragment({ text: '超出容量的新输入' })!))
      .toThrow('上限')
    expect(fragments[0]).toEqual(first)
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
    expect(storedVersions[storedVersions.length - 1]?.fragmentIds).toEqual([fragment!.id])
    expect(storedVersions[storedVersions.length - 1]?.resultJson).toContain(`版本 ${MAX_INSPIRATION_VERSIONS + 1}`)
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

  it('keeps bound configuration bytes/timestamps through backup owner remap and ignores a colliding global template id', async () => {
    const projectId = await createProject(), scope = await resolveScopeLike(projectId)
    const choice = await boundChoice()
    const config = await useInspirationWorkspaceStore.getState().savePromptConfig(scope, { expected: null, modes: { 'inspiration.reverse': choice, 'inspiration.reverse.multiworld': { kind: 'follow-default' } } })
    const original = (await db.inspirationWorkspaces.where('projectId').equals(projectId).first())!
    expect(original.workId).toBe(scope.workId)
    const collision = { id: 900071, scope: 'user' as const, moduleKey: 'inspiration.reverse' as const, promptType: 'generate' as const,
      name: 'COLLISION', description: '', systemPrompt: 'COLLISION_SYSTEM', userPromptTemplate: 'COLLISION_USER', variables: [], isActive: true, createdAt: 99, updatedAt: 100 }
    await db.promptTemplates.add(collision)
    const globalBefore = await db.promptTemplates.toArray()
    const exported = await exportProjectJSON(projectId)
    expect(exported.inspirationWorkspaces[0].promptConfig).toBe(original.promptConfig)
    const importedId = await importProjectJSON(exported), importedScope = await resolveScopeLike(importedId)
    const imported = (await db.inspirationWorkspaces.where('projectId').equals(importedId).first())!
    expect(imported.workId).toBe(importedScope.workId)
    expect(imported.workId).not.toBe(scope.workId)
    expect(imported.promptConfig).toBe(original.promptConfig)
    expect(await db.promptTemplates.toArray()).toEqual(globalBefore)
    expect(parseInspirationPromptConfigV1(imported.promptConfig)).toEqual(config)
    const bound = config.modes['inspiration.reverse']!
    if (bound.kind !== 'bound') throw new Error('expected a bound snapshot')
    expect(bound.template).toMatchObject({ id: 900071, createdAt: 17, updatedAt: 23 })
    const options = await freezePromptExecutionOptionsV1({ request: { version: 1, moduleKey: 'inspiration.reverse', selection: { template: bound.template, templateHash: bound.templateHash }, parameterValues: bound.parameterValues }, template: collision })
    const rendered = await renderFrozenPromptExecutionV1({ options, context: {}, hardSystem: 'HARD', authorInstruction: 'Author request' })
    expect(rendered.messages[0].content).toContain('OWNED_SYSTEM chosen')
    expect(JSON.stringify(rendered)).not.toContain('COLLISION_SYSTEM')
  })

  it('rejects corrupt config JSON/module/hash before any import write and leaves legacy missing fields absent', async () => {
    const projectId = await createProject()
    await useInspirationWorkspaceStore.getState().addFragment(projectId, { text: 'Legacy source' })
    const legacy = await exportProjectJSON(projectId)
    expect(legacy.inspirationWorkspaces[0]).not.toHaveProperty('promptConfig')
    const importedId = await importProjectJSON(legacy)
    expect(await db.inspirationWorkspaces.where('projectId').equals(importedId).first()).not.toHaveProperty('promptConfig')
    const choice = await boundChoice()
    if (choice.kind !== 'bound') throw new Error('expected bound')
    const valid = { version: 1, revision: 1, updatedAt: 5, modes: { 'inspiration.reverse': choice } }
    const bad = [
      '{"preserveRaw":',
      JSON.stringify({ ...valid, modes: { 'inspiration.reverse.multiworld': choice } }),
      JSON.stringify({ ...valid, modes: { 'inspiration.reverse': { ...choice, template: { ...choice.template, systemPrompt: 'TAMPERED_HASH' } } } }),
    ]
    for (const promptConfig of bad) {
      const backup = structuredClone(legacy)
      backup.inspirationWorkspaces[0].promptConfig = promptConfig
      const before = await databaseRows(), inputBytes = JSON.stringify(backup)
      await expect(importProjectJSON(backup)).rejects.toThrow()
      expect(await databaseRows()).toEqual(before)
      expect(JSON.stringify(backup)).toBe(inputBytes)
    }
  })

  it('deletes configuration through the existing Work, World and project lifecycles without deleting global templates', async () => {
    const scopes = await Promise.all(['work', 'world', 'project', 'survivor'].map(async label => resolveScopeLike(await createProject(label))))
    for (const scope of scopes) await useInspirationWorkspaceStore.getState().savePromptConfig(scope, { expected: null, modes: { 'inspiration.reverse': { kind: 'follow-default' } } })
    const global = await db.promptTemplates.toArray()
    await deleteWork(scopes[0].workId)
    await deleteWorld(scopes[1].worldId, { confirm: true })
    await cascadeDeleteProject(scopes[2].projectId)
    for (const scope of scopes.slice(0, 3)) expect(await db.inspirationWorkspaces.where('projectId').equals(scope.projectId).count()).toBe(0)
    expect(await db.inspirationWorkspaces.where('projectId').equals(scopes[3].projectId).count()).toBe(1)
    expect(await db.promptTemplates.toArray()).toEqual(global)
  })

  it('uses independent revision CAS without overwriting content, including overlapping writes, resets and failed storage', async () => {
    const projectId = await createProject(), scope = await resolveScopeLike(projectId)
    const store = useInspirationWorkspaceStore.getState()
    await store.load(scope)
    await store.addFragment(scope, { text: 'Original retained content' })
    const original = (await db.inspirationWorkspaces.where('projectId').equals(projectId).first())!
    const input = { expected: original, modes: { 'inspiration.reverse': { kind: 'follow-default' as const } } }
    const results = await Promise.allSettled([store.savePromptConfig(scope, input), store.savePromptConfig(scope, input)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const saved = (await db.inspirationWorkspaces.get(original.id!))!
    expect({ ...saved, promptConfig: undefined }).toEqual({ ...original, promptConfig: undefined })
    expect(parseInspirationPromptConfigV1(saved.promptConfig)?.revision).toBe(1)
    const [reset] = await Promise.all([
      store.savePromptConfig(scope, { expected: saved, modes: input.modes }),
      store.addFragment(scope, { text: 'Concurrent retained content' }),
    ])
    expect(reset.revision).toBe(2)
    const current = (await db.inspirationWorkspaces.get(original.id!))!
    expect(parseInspirationFragments(current.fragments)).toHaveLength(2)
    const before = await databaseRows()
    await expect(store.savePromptConfig(scope, input)).rejects.toThrow('已变化')
    expect(await databaseRows()).toEqual(before)
    const pending = { expected: current, modes: { 'inspiration.reverse': await boundChoice() } }
    const payload = structuredClone(pending)
    const update = vi.spyOn(db.inspirationWorkspaces, 'update').mockRejectedValueOnce(new Error('IDB_WRITE_FAILURE'))
    await expect(store.savePromptConfig(scope, pending)).rejects.toThrow('IDB_WRITE_FAILURE')
    update.mockRestore()
    expect(pending).toEqual(payload)
    expect(await databaseRows()).toEqual(before)
  })

  it('isolates captured scope/config from later mutations and never publishes a save into another loaded Work', async () => {
    const a = await resolveScopeLike(await createProject('Config A')), b = await resolveScopeLike(await createProject('Config B'))
    const store = useInspirationWorkspaceStore.getState()
    await store.load(b)
    const scope = { ...a }, input = { expected: null, modes: { 'inspiration.reverse': { kind: 'follow-default' as const } } }
    const pending = store.savePromptConfig(scope, input)
    scope.workId = b.workId
    delete (input.modes as Partial<typeof input.modes>)['inspiration.reverse']
    await pending
    const aRow = (await db.inspirationWorkspaces.where('projectId').equals(a.projectId).first())!
    expect(parseInspirationPromptConfigV1(aRow.promptConfig)?.modes['inspiration.reverse']).toEqual({ kind: 'follow-default' })
    expect(useInspirationWorkspaceStore.getState().scope).toEqual(b)
    expect(useInspirationWorkspaceStore.getState().workspace).toBeNull()
    const before = await databaseRows()
    await expect(store.savePromptConfig(b, { expected: aRow, modes: {} })).rejects.toThrow('已变化')
    await expect(store.savePromptConfig({ ...a, workId: b.workId }, { expected: aRow, modes: {} })).rejects.toThrow('scope')
    expect(await databaseRows()).toEqual(before)
  })

  it('keeps malformed raw config on ordinary content edits and forbids AI adoption from writing author configuration', async () => {
    const projectId = await createProject(), scope = await resolveScopeLike(projectId)
    const store = useInspirationWorkspaceStore.getState()
    const config = await store.savePromptConfig(scope, { expected: null, modes: {} })
    const original = (await db.inspirationWorkspaces.where('projectId').equals(projectId).first())!
    const denied = await adopt({ projectId, scope, target: 'inspirationWorkspaces', mode: 'replace', data: { promptConfig: JSON.stringify({ ...config, revision: 100 }) } })
    expect(denied.written).toHaveLength(0)
    expect(await db.inspirationWorkspaces.get(original.id!)).toEqual(original)
    const raw = '{"preserveBrokenConfig":'
    await db.inspirationWorkspaces.update(original.id!, { promptConfig: raw })
    await store.addFragment(scope, { text: 'Still authorable content' })
    const current = (await db.inspirationWorkspaces.get(original.id!))!
    expect(current.promptConfig).toBe(raw)
    await expect(store.savePromptConfig(scope, { expected: current, modes: {} })).rejects.toThrow('JSON')
    expect(await db.inspirationWorkspaces.get(original.id!)).toEqual(current)
  })


  it('keeps distinct Work choices inside the same semantic World in the world-engine entry', async () => {
    const created = await seedCurrentWorkspace('World engine owner', { purpose: 'world-engine' })
    const a = created.scope, workB = await createWorldWork(a.projectId, { title: 'Other World Work' })
    const b = { ...a, workId: workB.id! }, store = useInspirationWorkspaceStore.getState()
    await store.savePromptConfig(a, { expected: null, modes: { 'inspiration.reverse': await boundChoice() } })
    await store.savePromptConfig(b, { expected: null, modes: { 'inspiration.reverse.multiworld': { kind: 'follow-default' } } })
    await store.load(a)
    const selectedA = parseInspirationPromptConfigV1(useInspirationWorkspaceStore.getState().workspace?.promptConfig)!
    expect(selectedA.modes['inspiration.reverse']?.kind).toBe('bound')
    expect(selectedA.modes['inspiration.reverse.multiworld']).toBeUndefined()
    await store.load(b)
    const selectedB = parseInspirationPromptConfigV1(useInspirationWorkspaceStore.getState().workspace?.promptConfig)!
    expect(selectedB.modes['inspiration.reverse']).toBeUndefined()
    expect(selectedB.modes['inspiration.reverse.multiworld']).toEqual({ kind: 'follow-default' })
    await deleteWork(b.workId)
    expect(await db.inspirationWorkspaces.filter(item => item.workId === a.workId).count()).toBe(1)
    expect(await db.inspirationWorkspaces.filter(item => item.workId === b.workId).count()).toBe(0)
  })

})
