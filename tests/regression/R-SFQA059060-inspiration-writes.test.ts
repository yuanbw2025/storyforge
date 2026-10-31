import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { useInspirationWorkspaceStore as store } from '../../src/stores/inspiration-workspace'
import { adopt } from '../../src/lib/registry/adopt'
import {
  createInspirationFragment, createInspirationVersion, MAX_INSPIRATION_FRAGMENTS, MAX_INSPIRATION_VERSIONS,
  parseInspirationFragments, parseInspirationVersions,
} from '../../src/lib/inspiration/workspace'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

async function create(label = '灵感写入隔离回归') {
  return (await createWorkspace({ name: label, description: '', genres: [], status: 'drafting', targetWordCount: 1000 },
    { kind: 'novel', novelProfile: 'long' })).scope
}
async function row(scope: WorkspaceScope) {
  const rows = await db.inspirationWorkspaces.where('projectId').equals(scope.projectId).toArray()
  return rows.find(item => item.workId === scope.workId)!
}
async function allRows() {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
}
const outbound = vi.fn(() => { throw new Error('No model or external service belongs to this test') })
beforeEach(async () => {
  await db.delete(); await db.open()
  store.setState({ scope: null, workspace: null, fragments: [], versions: [], loading: false })
  outbound.mockClear(); vi.stubGlobal('fetch', outbound)
})
afterEach(async () => {
  expect(outbound).not.toHaveBeenCalled()
  vi.unstubAllGlobals(); db.close()
})

describe('SFQA059/060 actual public inspiration writes', () => {
  it('retains two overlapping successful additions in native storage, current cache and reload', async () => {
    const scope = await create(); await store.getState().load(scope)
    const result = await Promise.all([
      store.getState().addFragment(scope, { text: 'FIRST_AUTHORED_FRAGMENT' }),
      store.getState().addFragment(scope, { text: 'SECOND_AUTHORED_FRAGMENT' }),
    ])
    expect(result.every(Boolean)).toBe(true)
    expect(new Set(result.map(item => item!.id)).size).toBe(2)
    expect(parseInspirationFragments((await row(scope)).fragments)).toEqual(expect.arrayContaining(result))
    expect(store.getState().fragments).toEqual(expect.arrayContaining(result))
    await store.getState().load(scope)
    expect(store.getState().fragments).toEqual(expect.arrayContaining(result))
    expect(store.getState().fragments).toHaveLength(2)
  })

  it('sequential and overlapping normalized duplicates return the actual retained fragment', async () => {
    const scope = await create(); await store.getState().load(scope)
    const first = await store.getState().addFragment(scope, { text: 'An Original IDEA' })
    const duplicates = await Promise.all([
      store.getState().addFragment(scope, { text: 'An Original IDEA' }),
      store.getState().addFragment(scope, { text: 'an original idea' }),
    ])
    expect(duplicates).toEqual([first, first])
    expect(parseInspirationFragments((await row(scope)).fragments)).toEqual([first])
  })

  it('an explicitly scoped write cannot repaint the currently loaded different Work', async () => {
    const a = await create('Work A'), b = await create('Work B')
    await store.getState().load(a)
    const first = await store.getState().addFragment(a, { text: 'A original' })
    await store.getState().load(b)
    const bFirst = await store.getState().addFragment(b, { text: 'B original' })
    const lateA = await store.getState().addFragment(a, { text: 'A explicitly saved later' })
    expect(parseInspirationFragments((await row(a)).fragments)).toEqual([first, lateA])
    expect(store.getState().workspace?.workId).toBe(b.workId)
    expect(store.getState().fragments).toEqual([bFirst])
    expect(parseInspirationFragments((await row(b)).fragments)).toEqual([bFirst])
  })

  it('an addition racing a confirmation preserves both new content and the confirmed version', async () => {
    const scope = await create(); await store.getState().load(scope)
    const first = await store.getState().addFragment(scope, { text: 'Retained original premise' })
    const [next, version] = await Promise.all([
      store.getState().addFragment(scope, { text: 'Concurrent author addition' }),
      store.getState().saveVersion(scope, { mode: 'single', fragmentIds: [first!.id], result: { premise: 'Confirmed result' } }),
    ])
    const current = await row(scope)
    expect(parseInspirationFragments(current.fragments)).toEqual([first, next])
    expect(parseInspirationVersions(current.versions)).toEqual([version])
    expect(store.getState().fragments).toEqual([first, next])
    expect(store.getState().versions).toEqual([version])
  })

  it('concurrent source removal and confirmation cannot both claim success and leave a dangling source', async () => {
    const scope = await create(); await store.getState().load(scope)
    const first = await store.getState().addFragment(scope, { text: 'Source under confirmation' })
    const results = await Promise.allSettled([
      store.getState().saveVersion(scope, { mode: 'single', fragmentIds: [first!.id], result: { premise: 'Confirmed' } }),
      store.getState().removeFragment(scope, first!.id),
    ])
    expect(results.filter(item => item.status === 'rejected')).toHaveLength(1)
    const current = await row(scope), fragments = parseInspirationFragments(current.fragments)
    for (const version of parseInspirationVersions(current.versions)) {
      expect(version.fragmentIds.every(id => fragments.some(fragment => fragment.id === id))).toBe(true)
    }
  })

  it('foreign and missing source IDs are rejected before any native write', async () => {
    const a = await create('Source owner A'), b = await create('Source owner B')
    await store.getState().load(a)
    const first = await store.getState().addFragment(a, { text: 'Owned source' })
    const foreign = await store.getState().addFragment(b, { text: 'Foreign source' })
    const before = await allRows()
    for (const id of [foreign!.id, 'missing-fragment']) {
      await expect(store.getState().saveVersion(a, { mode: 'single', fragmentIds: [first!.id, id], result: { premise: 'Must not be saved' } })).rejects.toThrow()
      expect(await allRows()).toEqual(before)
    }
  })

  it('the 25th addition explicitly fails and preserves the confirmed original and every stored field', async () => {
    const scope = await create(); await store.getState().load(scope)
    const first = await store.getState().addFragment(scope, { text: 'CONFIRMED_SOURCE_ORIGINAL_TEXT' })
    const version = await store.getState().saveVersion(scope, { mode: 'single', fragmentIds: [first!.id], result: { premise: 'Result does not contain its source text' } })
    for (let index = 1; index < MAX_INSPIRATION_FRAGMENTS; index++) {
      await store.getState().addFragment(scope, { text: `Other source ${index}` })
    }
    const before = await allRows()
    await expect(store.getState().addFragment(scope, { text: 'Must stay in the author input' })).rejects.toThrow(/24|已满|上限/)
    expect(await allRows()).toEqual(before)
    await store.getState().load(scope)
    expect(store.getState().fragments).toContainEqual(first)
    expect(store.getState().versions.find(item => item.id === version.id)?.fragmentIds).toEqual([first!.id])
    expect(await store.getState().addFragment(scope, { text: first!.text })).toEqual(first)
    const removable = store.getState().fragments.find(item => item.id !== first!.id)!
    await store.getState().removeFragment(scope, removable.id)
    const next = await store.getState().addFragment(scope, { text: 'Author made room explicitly' })
    expect(store.getState().fragments).toContainEqual(next)
    expect(store.getState().fragments).toContainEqual(first)
  })

  it('reads a valid existing oversized library without silently truncating its authored records', async () => {
    const scope = await create()
    const fragments = Array.from({ length: MAX_INSPIRATION_FRAGMENTS + 2 }, (_, index) => createInspirationFragment({ text: `Legacy retained ${index}`, now: index + 1 })!)
    const adopted = await adopt({ projectId: scope.projectId, scope, target: 'inspirationWorkspaces', mode: 'replace', data: { fragments: JSON.stringify(fragments), versions: '[]' } })
    expect(adopted.written).toHaveLength(1)
    await store.getState().load(scope)
    expect(store.getState().fragments).toEqual(fragments)
    const before = await allRows()
    await expect(store.getState().addFragment(scope, { text: 'Over capacity' })).rejects.toThrow()
    expect(await allRows()).toEqual(before)
  })

  it('normal bounded version rollover preserves all source text and repairs only pruned parent links', async () => {
    const scope = await create(); await store.getState().load(scope)
    const first = await store.getState().addFragment(scope, { text: 'Stable source across version rollover' })
    let parent: string | null = null
    for (let index = 0; index < MAX_INSPIRATION_VERSIONS + 2; index++) {
      parent = (await store.getState().saveVersion(scope, { mode: 'single', parentVersionId: parent, fragmentIds: [first!.id], result: { index } })).id
    }
    await store.getState().load(scope)
    expect(store.getState().fragments).toEqual([first])
    const versions = store.getState().versions
    expect(versions).toHaveLength(MAX_INSPIRATION_VERSIONS)
    expect(versions[0].parentVersionId).toBeNull()
    expect(versions.slice(1).every((item, index) => item.parentVersionId === versions[index].id)).toBe(true)
    expect(versions.every(item => item.fragmentIds[0] === first!.id)).toBe(true)
  })

  it('keeps two concurrent confirmations and their common valid parent', async () => {
    const scope = await create(); await store.getState().load(scope)
    const first = await store.getState().addFragment(scope, { text: 'Shared confirmed source' })
    const parent = await store.getState().saveVersion(scope, { mode: 'single', fragmentIds: [first!.id], result: { title: 'Parent' } })
    const versions = await Promise.all(['Author A', 'Author B'].map(title => store.getState().saveVersion(scope,
      { mode: 'single', parentVersionId: parent.id, fragmentIds: [first!.id], result: { title } })))
    const current = parseInspirationVersions((await row(scope)).versions)
    expect(current).toHaveLength(3)
    expect(current).toEqual(expect.arrayContaining([parent, ...versions]))
    expect(versions.every(item => item.parentVersionId === parent.id)).toBe(true)
  })

  it('refuses to overwrite an existing array that cannot be read completely', async () => {
    for (const field of ['fragments', 'versions'] as const) {
      const scope = await create(`Malformed ${field}`)
      const written = await adopt({ projectId: scope.projectId, scope, target: 'inspirationWorkspaces', mode: 'replace',
        data: { fragments: '[]', versions: '[]', [field]: '{"preserveThisOriginal":true}' } })
      expect(written.written).toHaveLength(1)
      const before = await allRows()
      await expect(store.getState().addFragment(scope, { text: 'Must not replace malformed original evidence' })).rejects.toThrow('完整读取')
      expect(await allRows()).toEqual(before)
    }
  })

  it('preserves unknown stored properties and leaves the other array byte-for-byte unchanged', async () => {
    const scope = await create(), fragment = createInspirationFragment({ text: 'Extended historical source' })!
    const version = createInspirationVersion({ mode: 'single', fragmentIds: [fragment.id], result: { original: true } })
    const extendedFragment = { ...fragment, extraEvidence: { original: ['A', 'B'] } }
    const extendedVersion = { ...version, extraReceipt: { original: 'retained' } }
    await adopt({ projectId: scope.projectId, scope, target: 'inspirationWorkspaces', mode: 'replace',
      data: { fragments: JSON.stringify([extendedFragment]), versions: JSON.stringify([extendedVersion], null, 2) } })
    await store.getState().load(scope)
    const before = await row(scope)
    const next = await store.getState().addFragment(scope, { text: 'New source' })
    const added = await row(scope)
    expect(JSON.parse(added.fragments)).toEqual([extendedFragment, next])
    expect(added.versions).toBe(before.versions)
    await store.getState().saveVersion(scope, { mode: 'single', parentVersionId: version.id, fragmentIds: [fragment.id], result: { next: true } })
    const confirmed = await row(scope)
    expect(confirmed.fragments).toBe(added.fragments)
    expect(JSON.parse(confirmed.versions)[0]).toEqual(extendedVersion)
  })

  it('captures scope, fragment and version inputs before the first await', async () => {
    const a = await create('Captured A'), b = await create('Unselected B')
    await store.getState().load(a)
    const target = { ...a }, input = { text: 'Original input', label: 'Original label' }
    const pending = store.getState().addFragment(target, input)
    Object.assign(target, b); input.text = 'Changed after invocation'; input.label = 'Changed label'
    const saved = await pending
    expect(saved).toMatchObject({ text: 'Original input', label: 'Original label' })
    expect(parseInspirationFragments((await row(a)).fragments)).toEqual([saved])
    expect(await row(b)).toBeUndefined()
    const request = { mode: 'single' as const, fragmentIds: [saved!.id], result: { text: 'Original result' } }
    const confirmation = store.getState().saveVersion(a, request)
    request.fragmentIds.length = 0; request.result.text = 'Changed result'
    const version = await confirmation
    expect(version.fragmentIds).toEqual([saved!.id])
    expect(JSON.parse(version.resultJson)).toEqual({ text: 'Original result' })
  })

  it('rejects a foreign parent and excess selected source IDs without partial writes', async () => {
    const a = await create('Parent A'), b = await create('Parent B')
    const fragment = await store.getState().addFragment(a, { text: 'A source' })
    const foreignFragment = await store.getState().addFragment(b, { text: 'B source' })
    const foreignParent = await store.getState().saveVersion(b, { mode: 'single', fragmentIds: [foreignFragment!.id], result: { b: true } })
    const before = await allRows()
    await expect(store.getState().saveVersion(a, { mode: 'single', parentVersionId: foreignParent.id, fragmentIds: [fragment!.id], result: { a: true } })).rejects.toThrow('父版本')
    await expect(store.getState().saveVersion(a, { mode: 'single', fragmentIds: Array.from({ length: MAX_INSPIRATION_FRAGMENTS + 1 }, (_, i) => `source-${i}`), result: {} })).rejects.toThrow('最多引用')
    expect(await allRows()).toEqual(before)
  })

  it('round-trips an existing oversized library with its oldest confirmed source intact', async () => {
    const scope = await create()
    const fragments = Array.from({ length: MAX_INSPIRATION_FRAGMENTS + 2 }, (_, i) => createInspirationFragment({ text: `Portable original ${i}`, now: i + 1 })!)
    const version = createInspirationVersion({ mode: 'single', fragmentIds: [fragments[0].id], result: { confirmed: true } })
    await adopt({ projectId: scope.projectId, scope, target: 'inspirationWorkspaces', mode: 'replace',
      data: { fragments: JSON.stringify(fragments), versions: JSON.stringify([version]) } })
    const exported = await exportProjectJSON(scope.projectId), importedProject = await importProjectJSON(exported)
    const imported = await db.inspirationWorkspaces.where('projectId').equals(importedProject).first()
    expect(parseInspirationFragments(imported?.fragments)).toEqual(fragments)
    expect(parseInspirationVersions(imported?.versions)).toEqual([version])
    expect(parseInspirationFragments((await row(scope)).fragments)).toEqual(fragments)
  })
})
