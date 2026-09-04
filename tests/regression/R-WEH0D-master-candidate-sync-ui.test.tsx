import 'fake-indexeddb/auto'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readAgentEvents,
} from '../../src/lib/agent/conversations'
import {
  useMasterCopilot,
  type MasterCopilotController,
} from '../../src/components/agent/useMasterCopilot'
import { db } from '../../src/lib/db/schema'
import type { Project } from '../../src/lib/types'
import {
  flushCandidateDraftsV1,
  resetCandidateDraftCoordinatorForTestsV1,
} from '../../src/lib/agent/candidate-draft-coordinator'
import { seedCurrentMasterCandidate } from '../helpers/current-master-candidate'
import { currentWorldOriginDraftV1 } from '../helpers/current-worldview-field'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let project: Project

let controller: MasterCopilotController | null = null

function Harness() {
  controller = useMasterCopilot({ project, worldGroupId: null })
  return null
}

async function waitForController(predicate: (value: MasterCopilotController) => boolean): Promise<MasterCopilotController> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    if (controller && predicate(controller)) return controller
  }
  throw new Error('useMasterCopilot 状态未按时就绪')
}

describe('WEH-0D master candidate decision barrier', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    resetCandidateDraftCoordinatorForTestsV1()
    await db.delete()
    await db.open()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    await flushCandidateDraftsV1().catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 20))
    host.remove()
    controller = null
    resetCandidateDraftCoordinatorForTestsV1()
    db.close()
  })

  it('最后一版草稿无法同步时不允许采纳，并在内存中保留作者文本', async () => {
    const fixture = await seedCurrentMasterCandidate('候选决策屏障', '数据库中的候选')
    project = fixture.project
    await act(async () => root.render(createElement(Harness)))
    const ready = await waitForController(value => !value.loading && value.pendingCandidates.length === 1)
    const eventId = ready.pendingCandidates[0].event.id!
    vi.spyOn(db.agentEvents, 'update').mockRejectedValueOnce(new Error('测试中的持久化故障'))

    await act(async () => {
      await ready.updateCandidate(eventId, '作者尚未同步的最终草稿')
    })
    const edited = await waitForController(value => (
      value.pendingCandidates[0]?.event.content === '作者尚未同步的最终草稿'
    ))

    let adopted: boolean | undefined
    await act(async () => {
      adopted = await edited.adoptCandidate(edited.pendingCandidates[0])
      await new Promise(resolve => setTimeout(resolve, 10))
    })

    expect(adopted).toBe(false)
    const blocked = await waitForController(value => value.error?.includes('候选草稿尚未同步') === true)
    expect(blocked.pendingCandidates[0].event.content).toBe('作者尚未同步的最终草稿')
    const conversationId = blocked.events[0].conversationId
    const persisted = await readAgentEvents(conversationId)
    expect(persisted.find(event => event.id === eventId)?.content)
      .toBe(currentWorldOriginDraftV1('数据库中的候选'))
    expect(persisted.filter(event => event.kind === 'confirmation')).toHaveLength(0)
    expect(await db.worldviews.count()).toBe(0)
  })

  it('存在未同步候选时刷新意图被显式拦截并触发保存', async () => {
    const fixture = await seedCurrentMasterCandidate('刷新候选屏障', '刷新前初稿')
    project = fixture.project
    await act(async () => root.render(createElement(Harness)))
    const ready = await waitForController(value => !value.loading && value.pendingCandidates.length === 1)
    const eventId = ready.pendingCandidates[0].event.id!
    await act(async () => {
      await ready.updateCandidate(eventId, '刷新前最后一版')
    })
    const event = new Event('beforeunload', { cancelable: true })

    let dispatched = true
    await act(async () => {
      dispatched = window.dispatchEvent(event)
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((await db.agentEvents.get(eventId))?.content === '刷新前最后一版') break
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    })

    expect(dispatched).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect((await db.agentEvents.get(eventId))?.content).toBe('刷新前最后一版')
  })
})
