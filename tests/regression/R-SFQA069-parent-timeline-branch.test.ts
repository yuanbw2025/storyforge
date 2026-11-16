import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { db } from '../../src/lib/db/schema'
import * as runtime from '../../src/lib/product/runtime-core'
import { branchTextOpenWorldSessionFromCheckpointV1 } from '../../src/lib/open-world/checkpoints'
import { branchTextOpenWorldPlayerSaveV1, createTextOpenWorldManualSaveV1, projectTextOpenWorldPlayerSavesV1 } from '../../src/lib/open-world/player-saves'
import TextOpenWorldSaveSettingsPanel, { type TextOpenWorldSaveSettingsPanelProps } from '../../src/components/text-game/TextOpenWorldSaveSettingsPanel'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('069 must not dispatch a model or external request') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function fixture() {
  const f = await createGovernedTextOpenWorldSessionFixtureV1({ name: '069父时间线',
    textOpenWorldVNext: createTextOpenWorldVNextFixture(), title: '069盐港原档', seed: '069-seed' })
  const owner = { scope: f.scope, worldGroupId: null }
  const checkpoint = await createTextOpenWorldManualSaveV1({ owner, sessionId: f.session.id!, name: '069冻结起点' })
  const prefix = await db.productRuntimeEvents.where('sessionId').equals(f.session.id!).sortBy('sequence')
  expect(prefix.length).toBeGreaterThan(0)
  return { ...f, owner, checkpoint, prefix }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

async function advance(f: Fixture, commandId: string) {
  const result = await executeTextOpenWorldActionV1({ sessionId: f.session.id!, actionKey: 'action.investigate-channel',
    targetKey: 'location.salt-port', commandId })
  expect(result).toMatchObject({ status: 'succeeded', outcomeCommitted: true, gameplayStateChanged: true })
}
function fork(f: Fixture, entry: 'checkpoint' | 'player-save') {
  return entry === 'checkpoint'
    ? branchTextOpenWorldSessionFromCheckpointV1({ checkpointId: f.checkpoint.id!, title: '069子时间线' })
    : branchTextOpenWorldPlayerSaveV1({ owner: f.owner, checkpointId: f.checkpoint.id!, title: '069子时间线' })
}
async function verifyOneChild(f: Fixture, childId: number) {
  const children = await db.productRuntimeSessions.where('parentSessionId').equals(f.session.id!).toArray()
  expect(children).toHaveLength(1)
  expect(children[0].id).toBe(childId)
  expect(children[0]).toMatchObject({ parentSessionId: f.session.id, parentThroughSequence: f.checkpoint.throughSequence,
    productReleaseId: f.session.productReleaseId, runtimeSourceHash: f.session.runtimeSourceHash })
  const initial = runtime.parseProductRuntimeState(children[0].initialStateJson)
  expect(initial.lastSequence).toBe(0)
  expect(initial.textOpenWorld?.lastEventSequence).toBe(0)
  expect(await db.productRuntimeEvents.where('sessionId').equals(childId).count()).toBe(0)
  const parentEvents = await db.productRuntimeEvents.where('sessionId').equals(f.session.id!).sortBy('sequence')
  expect(parentEvents.slice(0, f.prefix.length)).toEqual(f.prefix)
  expect(parentEvents.length).toBeGreaterThan(f.prefix.length)
  expect(fetch).not.toHaveBeenCalled()
}

it.each(['checkpoint', 'player-save'] as const)('a legal parent suffix already present before %s does not change the frozen cut', async entry => {
  const f = await fixture()
  await advance(f, 'command.069.before-inspection')
  const child = await fork(f, entry)
  await verifyOneChild(f, child.id!)
})

it.each([
  ['checkpoint', 'before-shared-read'], ['checkpoint', 'after-shared-commit'],
  ['player-save', 'before-shared-read'], ['player-save', 'after-shared-commit'],
] as const)('legal parent progress at %s / %s returns the single committed child', async (entry, phase) => {
  const f = await fixture()
  const realBranch = runtime.branchProductRuntimeSession
  vi.spyOn(runtime, 'branchProductRuntimeSession').mockImplementation(async input => {
    if (phase === 'before-shared-read') await advance(f, 'command.069.before-shared-read')
    const child = await realBranch(input)
    if (phase === 'after-shared-commit') await advance(f, 'command.069.after-shared-commit')
    return child
  })
  const result = await fork(f, entry).then(child => ({ child, error: null }), error => ({ child: null, error: String(error) }))
  const children = await db.productRuntimeSessions.where('parentSessionId').equals(f.session.id!).toArray()
  expect({ error: result.error, alreadyCommittedChildren: children.length }).toEqual({ error: null, alreadyCommittedChildren: 1 })
  await verifyOneChild(f, result.child!.id!)
})

it('real prefix corruption between inspection and shared branch is rejected without a partial child', async () => {
  const f = await fixture()
  const realBranch = runtime.branchProductRuntimeSession
  vi.spyOn(runtime, 'branchProductRuntimeSession').mockImplementation(async input => {
    // Isolated fixture corruption; retain the event and do not regenerate hashes.
    await db.productRuntimeEvents.update(f.prefix[0].id!, { payloadJson: '{invalid' })
    return realBranch(input)
  })
  await expect(fork(f, 'checkpoint')).rejects.toThrow()
  expect(await db.productRuntimeSessions.where('parentSessionId').equals(f.session.id!).count()).toBe(0)
  expect(await db.productRuntimeEvents.where('sessionId').equals(f.session.id!).count()).toBe(f.prefix.length)
  expect(fetch).not.toHaveBeenCalled()
})

it('an invalid frozen parent runtime source remains rejected at the public player-save entry', async () => {
  const f = await fixture()
  await db.productRuntimeSessions.update(f.session.id!, { runtimeSourceHash: 'f'.repeat(64) })
  await expect(fork(f, 'player-save')).rejects.toThrow()
  expect(await db.productRuntimeSessions.where('parentSessionId').equals(f.session.id!).count()).toBe(0)
  expect(fetch).not.toHaveBeenCalled()
})

it('a parent suffix during actual shared preparation preserves the old cut through the native commit', async () => {
  const f = await fixture()
  const realBranch = runtime.branchProductRuntimeSession
  const realDigest = crypto.subtle.digest.bind(crypto.subtle)
  let insideShared = false
  let appended = false
  vi.spyOn(runtime, 'branchProductRuntimeSession').mockImplementation(async input => {
    insideShared = true
    try { return await realBranch(input) } finally { insideShared = false }
  })
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => {
    if (insideShared && !appended && !Dexie.currentTransaction) {
      appended = true
      await advance(f, 'command.069.inside-shared-preparation')
    }
    return realDigest(algorithm, bytes)
  })
  const child = await fork(f, 'player-save')
  expect(appended).toBe(true)
  await verifyOneChild(f, child.id!)
})

it('the real confirmation button completes once and shows the created branch after a legal parent suffix', async () => {
  const f = await fixture()
  const realBranch = runtime.branchProductRuntimeSession
  vi.spyOn(runtime, 'branchProductRuntimeSession').mockImplementation(async input => {
    const child = await realBranch(input)
    await advance(f, 'command.069.real-confirmation-suffix')
    return child
  })
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let done!: () => void
  const settled = new Promise<void>(resolve => { done = resolve })
  let forkCalls = 0
  let selectedChild: number | null = null
  const unexpected = async () => { throw new Error('069 unexpected UI action') }
  const props: TextOpenWorldSaveSettingsPanelProps = {
    sessionKey: f.session.id!, productionKey: f.release.productionKey, formalSaveAvailable: true, audioAvailable: false,
    saves: await projectTextOpenWorldPlayerSavesV1({ owner: f.owner, currentSessionId: f.session.id }),
    versions: null, busy: false, error: '',
    onCreateManualSave: unexpected, onForkCurrent: unexpected, onSelectBranch: unexpected,
    onDeleteCheckpoint: unexpected, onDeleteBranch: unexpected, onRepairCheckpoint: unexpected,
    onRepairRuntimeHead: unexpected, onRefresh: unexpected,
    onForkCheckpoint: async (checkpointId, title) => {
      forkCalls += 1
      try {
        expect(checkpointId).toBe(f.checkpoint.id)
        const child = await branchTextOpenWorldPlayerSaveV1({ owner: f.owner, checkpointId, title })
        selectedChild = child.id!
        props.saves = await projectTextOpenWorldPlayerSavesV1({ owner: f.owner, currentSessionId: child.id })
        props.sessionKey = child.id!
        root.render(createElement(TextOpenWorldSaveSettingsPanel, props))
        return child.id!
      } finally { done() }
    },
  }
  try {
    await act(async () => { root.render(createElement(TextOpenWorldSaveSettingsPanel, props)) })
    const forkButton = Array.from(host.querySelectorAll('button')).find(button => (
      button.textContent?.trim() === '从此处继续' && button.closest('article')?.textContent?.includes('069冻结起点')
    ))!
    expect(forkButton).toBeDefined()
    await act(async () => { forkButton.click() })
    const dialog = document.querySelector('[role="alertdialog"]')!
    expect(dialog).not.toBeNull()
    const confirm = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent?.trim() === '建立分支并继续')!
    await act(async () => { confirm.click(); await settled })
    expect(forkCalls).toBe(1)
    expect(selectedChild).not.toBeNull()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(host.textContent).not.toContain('操作未能完成')
    expect(props.saves.groups.flatMap(group => group.branches).find(branch => branch.isCurrent)?.actionIdentity.sessionId).toBe(selectedChild)
    await verifyOneChild(f, selectedChild!)
  } finally { await act(async () => { root.unmount() }); host.remove() }
})
