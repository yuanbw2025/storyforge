import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import AiTownPanel from '../../src/components/ai-town/AiTownPanel'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-api'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { useAiTownPlayerStore } from '../../src/stores/ai-town-player'
import { seedAiTownRuntimeFixture } from '../helpers/ai-town-runtime'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const started = Date.now(); let last: unknown
  while (Date.now() - started < 5_000) {
    try { await act(async () => { await assertion() }); return }
    catch (cause) { last = cause; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
  }
  throw last
}

function button(host: ParentNode, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!result) throw new Error(`找不到按钮:${label}`)
  return result
}

describe('R-AITOWN4 · AI 小镇真实玩家面', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    localStorage.clear(); sessionStorage.clear(); await db.delete(); await db.open()
    useAIConfigStore.setState(current => ({ config: { ...current.config, apiKey: '' } }))
    useAiTownPlayerStore.setState({ selectedSessionId: null, error: '', generatingRunId: null, directorRunId: null })
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  afterAll(() => db.close())

  it('从冻结 Build 恢复地图，并经界面保存对话、关系记忆和时间推进', async () => {
    const seeded = await seedAiTownRuntimeFixture({ reverseInteractionProfiles: true })
    await act(async () => {
      root.render(createElement(AiTownPanel, {
        project: seeded.project,
        workspaceScope: seeded.scope,
        worldGroupId: null,
        initialSessionId: seeded.session.id!,
      }))
    })
    await waitFor(() => {
      expect(host.querySelector('[data-testid="ai-town-player"]')).not.toBeNull()
      expect(host.querySelector('[data-testid="ai-town-map"]')).not.toBeNull()
      expect(host.textContent).toContain('第 1 日 · 早上 · 晴朗')
      expect(host.textContent).toContain('修复旧茶屋')
    })
    await act(async () => { button(host, '林舟').click() })
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea[placeholder*="林舟"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, '今天一起照看茶屋吧。')
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '今天一起照看茶屋吧。' }))
    })
    await act(async () => { button(host, '仅保存').click() })
    await waitFor(() => expect(host.textContent).toContain('今天一起照看茶屋吧。'))
    const state = await readProductRuntimeState(seeded.session.id!)
    expect(state.town?.memories.at(-1)).toMatchObject({
      ownerResidentKey: 'town.resident.1', visibility: 'shared', salience: 45,
    })
    expect(state.town?.relationships['town.relationship.player.1'].evidenceSequences).toHaveLength(1)
    await act(async () => { button(host, '等待一个时段').click() })
    await waitFor(() => expect(host.textContent).toContain('第 1 日 · 上午'))
    const version = await readProductRuntimeStateVersion(seeded.session.id!)
    expect(version.sequence).toBeGreaterThan(3)
  }, 15_000)
})
