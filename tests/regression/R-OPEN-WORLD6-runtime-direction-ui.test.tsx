import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TextOpenWorldPlayerPreferencesPanel from '../../src/components/text-game/TextOpenWorldPlayerPreferencesPanel'
import {
  createTextOpenWorldRuntimeAIPreferencesStoreV1,
  parseTextOpenWorldRuntimeAIPreferencesV1,
  textOpenWorldRuntimeAIPreferencesStorageKeyV1,
} from '../../src/lib/open-world/runtime-ai-preferences'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function directionToggle(host: ParentNode): HTMLInputElement {
  const label = [...host.querySelectorAll('label')]
    .find(item => item.textContent?.includes('启用 AI 叙事导演建议'))
  const input = label?.querySelector('input')
  if (!(input instanceof HTMLInputElement)) throw new Error('Director建议开关不存在')
  return input
}

describe('R-OPEN-WORLD6 · 叙事导演玩家授权界面', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    localStorage.clear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('默认不产生自动模型调用授权，玩家显式开启后按作品保存并说明确定性边界', async () => {
    const productionKey = 'fixture.runtime-direction-consent'
    await act(async () => root.render(createElement(TextOpenWorldPlayerPreferencesPanel, {
      productionKey,
      audioAvailable: false,
    })))
    const toggle = directionToggle(host)
    expect(toggle.checked).toBe(false)
    expect(host.textContent).toContain('当前关闭，不会为自动地区发牌调用模型')

    await act(async () => {
      toggle.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(directionToggle(host).checked).toBe(true)
    expect(host.textContent).toContain('代码先判定为非空、且至少有两个合法非主线候选')
    expect(createTextOpenWorldRuntimeAIPreferencesStoreV1(productionKey).getSnapshot())
      .toMatchObject({ directionEnabled: true })
    const raw = localStorage.getItem(textOpenWorldRuntimeAIPreferencesStorageKeyV1(productionKey))!
    expect(JSON.parse(raw)).toEqual({
      schema: 'storyforge.text-open-world.runtime-ai-preferences',
      version: 1,
      directionEnabled: true,
    })
    expect(raw).not.toContain('apiKey')

    await act(async () => root.render(createElement(TextOpenWorldPlayerPreferencesPanel, {
      productionKey: 'fixture.runtime-direction-other',
      audioAvailable: false,
    })))
    expect(directionToggle(host).checked).toBe(false)
  })

  it('本地授权Schema严格拒绝额外字段、错误版本和错误类型', () => {
    const valid = {
      schema: 'storyforge.text-open-world.runtime-ai-preferences',
      version: 1,
      directionEnabled: true,
    }
    expect(parseTextOpenWorldRuntimeAIPreferencesV1(valid)).toEqual(valid)
    expect(parseTextOpenWorldRuntimeAIPreferencesV1({ ...valid, apiKey: 'sk-never' })).toBeNull()
    expect(parseTextOpenWorldRuntimeAIPreferencesV1({ ...valid, version: 2 })).toBeNull()
    expect(parseTextOpenWorldRuntimeAIPreferencesV1({ ...valid, directionEnabled: 'yes' })).toBeNull()
  })
})
