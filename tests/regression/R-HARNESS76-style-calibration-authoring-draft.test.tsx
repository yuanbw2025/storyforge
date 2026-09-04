import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIConfig } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({ chat: vi.fn(async () => '他穿过长街。') }))

vi.mock('../../src/lib/ai/client', () => ({
  chat: mocks.chat,
  resolveRequestConfig: (config: AIConfig) => ({ config }),
}))

import StyleCalibrationPanel from '../../src/components/style/StyleCalibrationPanel'
import { ToastProvider } from '../../src/components/shared/Toast'
import { db } from '../../src/lib/db/schema'
import type { UserStyleProfile } from '../../src/lib/types/user-style'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { useUserStyleStore } from '../../src/stores/user-style'
import { seedCurrentProject } from '../helpers/current-workspace'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let mounted: { host: HTMLDivElement; root: ReturnType<typeof createRoot> } | null = null

function setTextareaValue(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  return Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes(text)) as HTMLButtonElement
}

async function seed(): Promise<{ projectId: number; profile: UserStyleProfile }> {
  const now = Date.now()
  const projectId = await seedCurrentProject({
    name: '校准草稿', genres: ['modern'], status: 'drafting', description: '',
    targetWordCount: 10_000,
    createdAt: now, updatedAt: now,
  } as any) as number
  const { worldId, workId } = await resolveWorkspaceScope(projectId)
  const id = await db.userStyleProfiles.add({
    projectId, worldId, workId, profile: '偏爱短句与白描', enabled: true,
    sourceChapterIds: '[]', sampleCount: 0, sampleWords: 0,
    revisionPairs: '[]', calibrationFeedback: '[]', createdAt: now, updatedAt: now,
  } as any) as number
  await finalizeCurrentFixtureV1(projectId)
  return { projectId, profile: (await db.userStyleProfiles.get(id))! }
}

describe.sequential('R-HARNESS76 · 互动校准 authoring-draft 零隐式写入', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    mocks.chat.mockClear()
  })

  afterEach(async () => {
    if (mounted) {
      await act(async () => mounted?.root.unmount())
      mounted.host.remove()
      mounted = null
    }
    db.close()
  })

  it('生成和编辑只留在内存；反馈与改稿样本分别由作者按钮显式写入', async () => {
    const fixture = await seed()
    await useUserStyleStore.getState().loadProfile(fixture.projectId)
    useAIConfigStore.setState({
      config: {
        provider: 'custom', apiKey: 'test-key', baseUrl: 'http://localhost:1234/v1',
        model: 'test-model', temperature: 0.7, maxTokens: 0,
      },
    })
    const before = await db.userStyleProfiles.get(fixture.profile.id!)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted = { host, root }
    await act(async () => {
      root.render(createElement(ToastProvider, null,
        createElement(StyleCalibrationPanel, { projectId: fixture.projectId, profile: fixture.profile }),
      ))
    })

    const source = host.querySelector<HTMLTextAreaElement>('textarea[placeholder*="待校准短文"]')!
    await act(async () => setTextareaValue(source, '他很快地跑过长街。'))
    await act(async () => {
      button(host, '生成校准稿').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.chat).toHaveBeenCalledOnce()
    expect(mocks.chat.mock.calls[0][2]).toMatchObject({ category: 'style.calibrate', projectId: fixture.projectId })
    expect(await db.userStyleProfiles.get(fixture.profile.id!)).toEqual(before)
    expect(await db.agentRuns.where('projectId').equals(fixture.projectId).count()).toBe(0)

    const result = host.querySelector<HTMLTextAreaElement>('#style-calibration-result')!
    await act(async () => setTextareaValue(result, '他掠过长街。'))
    expect(await db.userStyleProfiles.get(fixture.profile.id!)).toEqual(before)

    const note = host.querySelector<HTMLInputElement>('input[placeholder*="具体哪里"]')!
    await act(async () => setInputValue(note, '动作更克制'))
    await act(async () => {
      button(host, '接近我的风格').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.waitFor(async () => {
        expect(JSON.parse((await db.userStyleProfiles.get(fixture.profile.id!))!.calibrationFeedback!)).toHaveLength(1)
      })
    })
    const afterFeedback = await db.userStyleProfiles.get(fixture.profile.id!)
    expect(JSON.parse(afterFeedback!.calibrationFeedback!)).toEqual([
      expect.objectContaining({ verdict: 'closer', note: '动作更克制', resultExcerpt: '他掠过长街。' }),
    ])
    expect(afterFeedback).toMatchObject({
      profile: before!.profile,
      enabled: before!.enabled,
      revisionPairs: before!.revisionPairs,
    })

    await act(async () => {
      button(host, '保存为改稿样本').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.waitFor(async () => {
        expect(JSON.parse((await db.userStyleProfiles.get(fixture.profile.id!))!.revisionPairs!)).toHaveLength(1)
      })
    })
    const afterPair = await db.userStyleProfiles.get(fixture.profile.id!)
    expect(JSON.parse(afterPair!.revisionPairs!)).toEqual([
      expect.objectContaining({
        chapterTitle: '互动校准样本', beforeText: '他很快地跑过长街。',
        afterText: '他掠过长街。', authorNote: '动作更克制',
      }),
    ])
    expect(afterPair).toMatchObject({ profile: before!.profile, enabled: before!.enabled })
    expect(await db.agentRuns.where('projectId').equals(fixture.projectId).count()).toBe(0)
  })
})
