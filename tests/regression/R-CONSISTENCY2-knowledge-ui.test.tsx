import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KnowledgeLedgerPanel from '../../src/components/facts/KnowledgeLedgerPanel'
import { db } from '../../src/lib/db/schema'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('CONSISTENCY-2 · 角色认知用户出口', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    await db.delete()
    await db.open()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    db.close()
  })

  it('事实库角色认知视图展示候选及人工确认/否决出口', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({ name: 'UI', createdAt: now, updatedAt: now })
    const characterId = await db.characters.add({
      projectId, name: '林飞', roleWeight: 'main', moralAxis: 'neutral',
      orderAxis: 'neutral', shortDescription: '', appearance: '', personality: '',
      background: '', motivation: '', abilities: '', relationships: '', arc: '',
      homeWorldGroupId: null, isCrossWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    await db.knowledgeLedger.add({
      projectId, characterId, characterName: '林飞',
      knowledgeKey: 'enemy.true_identity', statement: '黑衣人是城主',
      action: 'learn', sourceType: 'manual', sourceChapterId: null,
      status: 'candidate', createdAt: now, updatedAt: now,
    })
    await finalizeCurrentFixtureV1(projectId)

    await act(async () => {
      root.render(createElement(KnowledgeLedgerPanel, {
        project: (await db.projects.get(projectId))!,
        onShowFacts: () => undefined,
      }))
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('黑衣人是城主'))
    })

    expect(host.textContent).toContain('角色认知账本')
    expect(host.textContent).toContain('黑衣人是城主')
    expect(host.textContent).toContain('enemy.true_identity')
    expect(host.querySelector('button[title="确认事件"]')).not.toBeNull()
    expect(host.querySelector('button[title="否决事件"]')).not.toBeNull()
  })
})
