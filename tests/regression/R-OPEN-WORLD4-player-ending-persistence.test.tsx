import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldSaveSettingsPanel from '../../src/components/text-game/TextOpenWorldSaveSettingsPanel'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { projectTextOpenWorldPlayerEndingV1 } from '../../src/lib/open-world/player-ending'
import {
  branchTextOpenWorldPlayerSaveV1,
  createTextOpenWorldManualSaveV1,
  projectTextOpenWorldPlayerSavesV1,
  type TextOpenWorldPlayerSavesProjectionV1,
  type TextOpenWorldSaveOwnerV1,
} from '../../src/lib/open-world/player-saves'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { createTextOpenWorldPlayerJourneyFixtureV1 } from '../helpers/text-open-world-player-journey-fixture'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function createCompletedJourney(name: string) {
  const journey = await createTextOpenWorldPlayerJourneyFixtureV1()
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: `${name}-${crypto.randomUUID()}`,
    textOpenWorldVNext: journey.runtimePackage,
    title: '盐脊终局时间线',
    seed: 'ending-persistence-seed',
  })
  const owner: TextOpenWorldSaveOwnerV1 = { scope: created.scope, worldGroupId: null }
  const initial = await readProductRuntimeState(created.session.id!)
  const mainline = Object.values(initial.textOpenWorld!.state.quests.instancesByKey)
    .find(instance => instance.definitionKey === journey.keys.finalQuestKey)
  if (!mainline) throw new Error('结局持久化验收缺少最终主线实例')

  await executeTextOpenWorldActionV1({
    sessionId: created.session.id!,
    actionKey: 'action.accept-main',
    targetKey: mainline.instanceKey,
    commandId: 'command.ending-persistence.accept',
  })
  await executeTextOpenWorldActionV1({
    sessionId: created.session.id!,
    actionKey: 'action.complete-main-objective',
    targetKey: mainline.instanceKey,
    commandId: 'command.ending-persistence.objective',
  })
  await executeTextOpenWorldActionV1({
    sessionId: created.session.id!,
    actionKey: journey.keys.claimActionKey,
    targetKey: mainline.instanceKey,
    commandId: 'command.ending-persistence.reward',
  })
  const beforeEnding = await createTextOpenWorldManualSaveV1({
    owner,
    sessionId: created.session.id!,
    name: '终局前抉择',
  })

  const commandId = 'command.ending-persistence.cooperate'
  const preflight = await executeTextOpenWorldActionV1({
    sessionId: created.session.id!,
    actionKey: journey.keys.endingActionKeys[0],
    commandId,
    source: 'fixed-choice',
  })
  if (preflight.status !== 'confirmation-required') {
    throw new Error(`结局选择没有进入确认边界:${preflight.status}`)
  }
  const completed = await executeTextOpenWorldActionV1({
    sessionId: created.session.id!,
    actionKey: journey.keys.endingActionKeys[0],
    commandId,
    source: 'fixed-choice',
    confirmed: true,
    expectedBaseSequence: preflight.baseSequence,
  })
  if (completed.phase !== 'terminal' || completed.status !== 'succeeded') {
    throw new Error(`结局选择没有形成成功终态:${completed.phase}/${completed.status}`)
  }
  const afterEnding = await createTextOpenWorldManualSaveV1({
    owner,
    sessionId: created.session.id!,
    name: '结局后记录',
  })
  return { ...created, journey, owner, beforeEnding, afterEnding }
}

function safeSummary() {
  return {
    runtimeFormat: 'vnext' as const,
    level: 5,
    locationLabel: '盐港广场',
    regionLabel: '盐港',
    mainlineLabel: '断流的盐渠 · 已完成',
    worldTimeLabel: '第 12 天 · 夜晚',
  }
}

function terminalSaveProjection(): TextOpenWorldPlayerSavesProjectionV1 {
  const summary = safeSummary()
  return {
    groups: [{
      uiId: 'save-group-ending',
      title: '盐脊',
      versionLabel: '版本 1',
      sourceKind: '正式发布',
      branchCount: 1,
      branches: [{
        uiId: 'branch-ending',
        actionIdentity: { sessionId: 910_001 },
        title: '盐脊终局时间线',
        statusLabel: '已完成',
        relationship: 'root',
        relationshipLabel: '主时间线',
        parentTitle: null,
        depth: 0,
        isCurrent: true,
        updatedAt: 1_790_000_000_000,
        runtimeFormat: 'vnext',
        summary,
        runtimeHealth: 'available',
        runtimeHealthLabel: '运行状态可读取',
        runtimeRepairable: false,
        terminal: true,
        manualSlots: { used: 2, limit: 20, remaining: 18 },
        checkpoints: [{
          uiId: 'checkpoint-before-ending',
          actionIdentity: { sessionId: 910_001, checkpointId: 920_001 },
          name: '终局前抉择',
          purpose: 'manual',
          purposeLabel: '手动存档',
          createdAt: 1_790_000_000_000,
          summary,
          health: 'available',
          healthLabel: '可读取',
          repairable: false,
          terminal: false,
        }, {
          uiId: 'checkpoint-after-ending',
          actionIdentity: { sessionId: 910_001, checkpointId: 920_002 },
          name: '结局后记录',
          purpose: 'manual',
          purposeLabel: '手动存档',
          createdAt: 1_790_000_001_000,
          summary,
          health: 'available',
          healthLabel: '可读取',
          repairable: false,
          terminal: true,
        }],
      }],
    }],
    totalBranches: 1,
    totalCheckpoints: 2,
  }
}

function buttonByText(root: ParentNode, text: string, contains = false): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button')).find(candidate => (
    contains ? candidate.textContent?.includes(text) : candidate.textContent?.trim() === text
  ))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮:${text}`)
  return button
}

function articleByText(root: ParentNode, text: string): HTMLElement {
  const article = Array.from(root.querySelectorAll('article'))
    .find(candidate => candidate.textContent?.includes(text))
  if (!(article instanceof HTMLElement)) throw new Error(`找不到存档条目:${text}`)
  return article
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function inputText(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('Text Open World G4-15 · 结局持久化与存档边界', () => {
  beforeEach(async () => {
    document.body.replaceChildren()
    await db.delete()
    await db.open()
  })
  afterAll(() => db.close())

  it('completed与权威结局通过PROJECT_TABLES导出导入后仍可核验，并保留结局前分支和完成态手动存档', async () => {
    const created = await createCompletedJourney('结局项目往返')
    const completedSession = await db.productRuntimeSessions.get(created.session.id!)
    const completedState = await readProductRuntimeState(created.session.id!)
    expect(completedSession?.status).toBe('completed')
    expect(projectTextOpenWorldPlayerEndingV1({
      projection: completedState.textOpenWorld,
      sessionStatus: completedSession!.status,
    })).toMatchObject({
      phase: 'completed',
      ending: { title: '共管盐渠', summary: '两地共同维护盐渠。' },
    })

    const backup = await exportProjectJSON(created.scope.projectId)
    expect(backup.productRuntimeSessions).toHaveLength(1)
    expect(backup.productRuntimeSessions[0]).toMatchObject({ status: 'completed' })
    expect(backup.productRuntimeCheckpoints.map(checkpoint => checkpoint.name))
      .toEqual(expect.arrayContaining(['终局前抉择', '结局后记录']))

    const importedProjectId = await importProjectJSON(backup)
    const importedOwnership = await resolveWorkspaceOwnership(importedProjectId)
    const importedSession = await db.productRuntimeSessions
      .where('projectId').equals(importedProjectId)
      .filter(session => session.title === '盐脊终局时间线')
      .first()
    if (!importedSession?.id) throw new Error('导入后缺少终局Session')
    const importedOwner: TextOpenWorldSaveOwnerV1 = {
      scope: importedOwnership.scope,
      worldGroupId: null,
    }
    const importedState = await readProductRuntimeState(importedSession.id)
    expect(importedSession.status).toBe('completed')
    expect(importedState.textOpenWorld?.state.endings.reachedKey).toBe('ending.cooperate')
    expect(projectTextOpenWorldPlayerEndingV1({
      projection: importedState.textOpenWorld,
      sessionStatus: importedSession.status,
    })).toMatchObject({ phase: 'completed', ending: { title: '共管盐渠' } })

    const saves = await projectTextOpenWorldPlayerSavesV1({
      owner: importedOwner,
      currentSessionId: importedSession.id,
    })
    const importedBranch = saves.groups.flatMap(group => group.branches)
      .find(branch => branch.isCurrent)
    expect(importedBranch).toMatchObject({
      statusLabel: '已完成',
      terminal: true,
      runtimeHealth: 'available',
    })
    const beforeEnding = importedBranch?.checkpoints.find(checkpoint => checkpoint.name === '终局前抉择')
    const afterEnding = importedBranch?.checkpoints.find(checkpoint => checkpoint.name === '结局后记录')
    expect(beforeEnding).toMatchObject({ health: 'available', terminal: false })
    expect(afterEnding).toMatchObject({ health: 'available', terminal: true })

    await expect(branchTextOpenWorldPlayerSaveV1({
      owner: importedOwner,
      checkpointId: afterEnding!.actionIdentity.checkpointId,
      title: '非法终局后分支',
    })).rejects.toThrow('结局后存档只能读取')
    const child = await branchTextOpenWorldPlayerSaveV1({
      owner: importedOwner,
      checkpointId: beforeEnding!.actionIdentity.checkpointId,
      title: '另一种结局',
      seed: 'alternate-ending-seed',
    })
    expect(child).toMatchObject({ status: 'active', parentSessionId: importedSession.id })
    expect((await readProductRuntimeState(child.id!)).textOpenWorld?.state.endings.reachedKey).toBeNull()

    const memorial = await createTextOpenWorldManualSaveV1({
      owner: importedOwner,
      sessionId: importedSession.id,
      name: '导入后的终局留念',
    })
    expect(memorial).toMatchObject({ sessionId: importedSession.id, purpose: 'manual' })
  }, 90_000)

  it('存档UI禁用终局后继续和当前进度派生，同时保留结局前派生与完成态手动存档', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const actions = {
      onCreateManualSave: vi.fn(async (_name: string) => undefined),
      onForkCurrent: vi.fn(async (_title: string) => undefined),
      onForkCheckpoint: vi.fn(async (_checkpointId: number, _title: string) => undefined),
      onSelectBranch: vi.fn(async (_sessionId: number) => undefined),
      onDeleteCheckpoint: vi.fn(async (_checkpointId: number) => undefined),
      onDeleteBranch: vi.fn(async (_sessionId: number) => undefined),
      onRepairCheckpoint: vi.fn(async (_checkpointId: number) => undefined),
      onRepairRuntimeHead: vi.fn(async (_sessionId: number) => undefined),
      onRefresh: vi.fn(async () => undefined),
    }
    try {
      await act(async () => {
        root.render(<TextOpenWorldSaveSettingsPanel
          sessionKey="session:ending"
          productionKey="fixture.salt-ridge"
          formalSaveAvailable
          audioAvailable={false}
          saves={terminalSaveProjection()}
          versions={null}
          busy={false}
          {...actions}
        />)
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      const afterEnding = articleByText(host, '结局后记录')
      const terminalContinue = buttonByText(afterEnding, '从此处继续')
      expect(terminalContinue.disabled).toBe(true)
      expect(terminalContinue.title).toContain('结局后存档只能读取')
      await click(terminalContinue)
      expect(actions.onForkCheckpoint).not.toHaveBeenCalled()

      const beforeEnding = articleByText(host, '终局前抉择')
      const historicalContinue = buttonByText(beforeEnding, '从此处继续')
      expect(historicalContinue.disabled).toBe(false)
      await click(historicalContinue)
      const confirmation = document.querySelector<HTMLElement>('[role="alertdialog"]')!
      expect(confirmation.textContent).toContain('新的时间线分支')
      await click(buttonByText(confirmation, '建立分支并继续'))
      expect(actions.onForkCheckpoint).toHaveBeenCalledWith(920_001, '盐脊终局时间线 · 终局前抉择')

      const saveName = host.querySelector<HTMLInputElement>('#text-open-world-manual-save-name')!
      await inputText(saveName, '终局留念')
      const saveButton = buttonByText(host, '保存当前进度')
      expect(saveButton.disabled).toBe(false)
      await click(saveButton)
      expect(actions.onCreateManualSave).toHaveBeenCalledWith('终局留念')

      await click(buttonByText(host.querySelector('nav')!, '分支', true))
      expect(host.textContent).toContain('这条时间线已经抵达结局')
      expect(host.textContent).toContain('请从结局前的存档建立分支')
      expect(host.querySelector<HTMLInputElement>('input[aria-label="新时间线名称"]')?.disabled).toBe(true)
      expect(buttonByText(host, '建立').disabled).toBe(true)
      expect(actions.onForkCurrent).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
