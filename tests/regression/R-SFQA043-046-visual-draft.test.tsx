import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ComicSourcePanel from '../../src/components/comic/ComicSourcePanel'
import { db } from '../../src/lib/db/schema'
import * as authoring from '../../src/lib/comic/authoring'
import { adoptComicVisualBibleV1 } from '../../src/lib/comic/production'
import { resetCandidateDraftCoordinatorForTestsV1 } from '../../src/lib/agent/candidate-draft-coordinator'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import type { AdaptationProject, WorkspaceScope } from '../../src/lib/types'
import { createSfqa043ComicFixtureV1 } from '../helpers/sfqa043-comic'

const actualRead = authoring.readComicAuthorDraft
const actualSave = authoring.updateComicTargetSpecV1
let host: HTMLDivElement
let mounted: ReturnType<typeof createRoot>
let release: (() => void) | undefined
const reads: Promise<unknown>[] = [], writes: Promise<unknown>[] = []

async function draw(scope: WorkspaceScope, root: AdaptationProject, awaitRead = true) {
  if (root.medium !== 'comic') throw new Error('Expected the actual comic owner')
  const readStart = reads.length
  await act(async () => mounted.render(createElement(ComicSourcePanel, {
    scope, root: { ...root, medium: 'comic' }, units: [], onChanged: async () => {},
  })))
  if (awaitRead) await act(async () => { await Promise.allSettled(reads.slice(readStart)) })
}
function audience() {
  const input = [...host.querySelectorAll('label')].find(label => label.textContent?.startsWith('目标读者'))?.querySelector('input')
  if (!input) throw new Error('Expected the real source specification form')
  return input
}

beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  resetCandidateDraftCoordinatorForTestsV1(); resetPendingEditCoordinatorForTestsV1()
  reads.length = 0; writes.length = 0; release = undefined
  vi.spyOn(authoring, 'updateComicTargetSpecV1').mockImplementation((...args) => {
    const promise = actualSave(...args); writes.push(promise); return promise
  })
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No model or external request authorized') }))
  await db.delete(); await db.open()
  host = document.createElement('div'); document.body.append(host); mounted = createRoot(host)
})
afterEach(async () => {
  await act(async () => { release?.(); await Promise.allSettled(reads); mounted.unmount() })
  expect(fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  resetCandidateDraftCoordinatorForTestsV1(); resetPendingEditCoordinatorForTestsV1()
  host.remove(); db.close()
})

describe('SFQA043 + consumed SFQA046 · real bound visual adoption and source draft CAS', () => {
  it.each(['restored', 'pending'] as const)('%s author draft survives a bound visual update and cannot borrow its next revision', async mode => {
    const f = await createSfqa043ComicFixtureV1()
    const root = await db.adaptationProjects.get(f.adaptation.id!)
    if (!root || root.medium !== 'comic') throw new Error('Expected the actual comic root')
    const key = `target:r${root.revision}`, draft = { ...root.targetSpec, audience: `作者${mode}的未确认规格` }
    await authoring.saveComicAuthorDraft(f.scope, key, JSON.stringify(draft))
    let readComplete = false, hold = mode === 'pending'
    const gate = new Promise<void>(done => { release = done })
    vi.spyOn(authoring, 'readComicAuthorDraft').mockImplementation((...args) => {
      const promise = (async () => {
        const text = await actualRead(...args)
        const delayed = hold; hold = false; readComplete = true
        if (delayed) await gate
        return text
      })()
      reads.push(promise); return promise
    })
    await draw(f.scope, root, mode !== 'pending')
    await vi.waitFor(() => expect(readComplete).toBe(true))
    if (mode === 'restored') {
      await act(async () => { await Promise.allSettled(reads) })
      expect(audience().value).toBe(draft.audience)
    }
    await adoptComicVisualBibleV1({ scope: f.scope, expectedAdaptationRevision: root.revision,
      sourceManifestVersion: root.activeSourceManifestVersion, candidate: f.candidate, allowReplaceExisting: true })
    const next = await db.adaptationProjects.get(root.id!)
    if (!next || next.medium !== 'comic') throw new Error('Expected the actual visual adoption receipt state')
    expect(next.revision).toBe(root.revision + 1)
    expect(next.targetSpec).toEqual(root.targetSpec)
    const subject = await db.comicVisualSubjects.get(f.subject.id!)
    expect(subject).toMatchObject({ id: f.subject.id, stableKey: 'hero', characterId: f.characterId,
      design: { description: f.candidate.subjects[0].design.description } })
    await draw(f.scope, next, mode !== 'pending')
    await act(async () => { release?.(); await Promise.allSettled(reads) })
    expect(audience().value).toBe(draft.audience)
    const save = [...host.querySelectorAll('button')].find(button => button.textContent === '保存制作规格')
    if (!save) throw new Error('Expected the real formal-save action')
    await act(async () => {
      save.click()
      await vi.waitFor(() => expect(writes).toHaveLength(1))
      await Promise.allSettled(writes)
    })
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('漫画规格已变化'))
    expect(authoring.updateComicTargetSpecV1).toHaveBeenCalledWith({ scope: f.scope,
      expectedRevision: root.revision, targetSpec: draft })
    expect(audience().value).toBe(draft.audience)
    expect(await db.adaptationProjects.get(root.id!)).toEqual(next)
    expect(await db.comicVisualSubjects.get(f.subject.id!)).toEqual(subject)
    expect(JSON.parse((await actualRead(f.scope, key))!)).toEqual(draft)
    expect(await db.agentRuns.count()).toBe(0)
  })
})
