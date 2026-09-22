import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldQuestLogPanel from '../../src/components/text-game/TextOpenWorldQuestLogPanel'
import TextOpenWorldQuestPackagingPanel from '../../src/components/text-game/TextOpenWorldQuestPackagingPanel'
import { createTextOpenWorldDirectorQuestInstanceV1 } from '../../src/lib/open-world/quests'
import type {
  TextOpenWorldRuntimeQuestPackagingPresentationV1,
  TextOpenWorldRuntimeQuestPackagingSlotV1,
} from '../../src/lib/open-world/runtime-quest-packaging'
import { projectTextOpenWorldRuntimeQuestPackagingSlotV1 } from '../../src/lib/open-world/runtime-quest-packaging'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function slot(available = true): TextOpenWorldRuntimeQuestPackagingSlotV1 {
  return {
    version: 1,
    questInstanceKey: 'quest-instance.23.quest.template.supplies.director.6.draw.1',
    questDefinitionKey: 'quest.template.supplies',
    templateKey: 'template.supplies',
    regionKey: 'region.salt-port',
    regionTitle: '盐港',
    currentLocationKey: available ? 'location.salt-port' : 'location.ridge-channel',
    currentLocationTitle: available ? '盐港广场' : '断脊渠口',
    sourceContentHash: 'a'.repeat(64),
    selectedVariantTextKey: 'task-text.supplies.1',
    templateFingerprint: 'fingerprint.supplies',
    requiredReferencedKeys: [
      'quest-instance.23.quest.template.supplies.director.6.draw.1',
      'quest.template.supplies',
      'region.salt-port',
      'task-text.supplies.1',
      'template.supplies',
    ],
    fallback: {
      source: 'frozen-release-variant',
      title: '盐晶短缺',
      description: '守渠人需要两块粗盐晶。',
    },
    generation: available
      ? { available: true, reason: 'current-issuance-region' }
      : { available: false, reason: 'left-issuance-region' },
  }
}

function presentation(): TextOpenWorldRuntimeQuestPackagingPresentationV1 {
  return {
    version: 1,
    source: 'ai-candidate',
    status: 'generated',
    questInstanceKey: slot().questInstanceKey,
    questDefinitionKey: 'quest.template.supplies',
    templateKey: 'template.supplies',
    regionKey: 'region.salt-port',
    title: '雾港的一份临时委托',
    summary: '一桩不起眼的短缺正等着旅人顺手照看。',
    introText: '潮雾压过港边，零散的请求落到旅人面前。',
    objectiveText: '按照任务记录中已经公开的步骤行动。',
    resolutionText: '港边紧绷的气氛终于松动了一些。',
    variantFingerprint: 'fingerprint.supplies',
    referencedKeys: slot().requiredReferencedKeys,
    baseSequence: 8,
    candidateHash: 'b'.repeat(64),
    contextManifestHash: 'c'.repeat(64),
    runId: 9,
  }
}

describe('R-OPEN-WORLD6 · 地区任务AI包装玩家界面', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('从预制文案显式发起AI包装，并明确不改任务规则', async () => {
    const onGenerate = vi.fn()
    const current = slot()
    await act(async () => root.render(createElement(TextOpenWorldQuestPackagingPanel, {
      slot: current,
      presentation: null,
      completed: false,
      busy: false,
      issue: null,
      onGenerate,
    })))
    expect(host.textContent).toContain('发布时预制变体')
    expect(host.textContent).toContain('AI只改文案，不改任务规则')
    const button = host.querySelector('button') as HTMLButtonElement
    expect(button.textContent).toContain('AI包装这个地区任务')
    await act(async () => button.click())
    expect(onGenerate).toHaveBeenCalledWith(current.questInstanceKey)
  })

  it('分层展示只读包装，只有任务正式完成后才显示预生成收束文字', async () => {
    const current = slot()
    const generated = presentation()
    const render = async (completed: boolean) => act(async () => root.render(createElement(TextOpenWorldQuestPackagingPanel, {
      slot: current,
      presentation: generated,
      completed,
      busy: false,
      issue: null,
      onGenerate: vi.fn(),
    })))
    await render(false)
    expect(host.textContent).toContain('盐港 · AI只读候选')
    expect(host.textContent).toContain(generated.title)
    expect(host.textContent).toContain('正式目标、奖励、期限与状态')
    expect(host.textContent).not.toContain(generated.resolutionText)
    await render(true)
    expect(host.textContent).toContain('旅程收束')
    expect(host.textContent).toContain(generated.resolutionText)
  })

  it('模型失败或玩家离开发牌地区时保留预制任务且不暴露内部错误', async () => {
    const onGenerate = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldQuestPackagingPanel, {
      slot: slot(false),
      presentation: null,
      completed: false,
      busy: false,
      issue: 'provider secret must not appear',
      onGenerate,
    })))
    expect(host.textContent).toContain('AI包装当前不可用')
    expect(host.textContent).toContain('离开任务发放地区')
    expect(host.textContent).not.toContain('provider secret')
    expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('任务日志只在正式Director模板实例详情中挂载包装入口', async () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const dynamic = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies',
      sourceInstanceKey: 'packaging-ui.1',
      worldMinute: projection.state.time.worldMinute,
    })
    projection.state.quests.instancesByKey[dynamic.instanceKey] = dynamic
    projection.state.director.drawCount = 1
    projection.state.director.generatedQuestInstanceCount = 1
    projection.state.director.revealedQuestInstanceKeys = [dynamic.instanceKey]
    projection.state.director.recentFingerprints = [{
      fingerprint: 'fingerprint.supplies',
      worldMinute: projection.state.time.worldMinute,
    }]
    projection.state.director.lastDrawWorldMinuteByRegionKey = {
      'region.salt-port': projection.state.time.worldMinute,
    }
    projection.state.director.lastResolvedWorldMinuteBySourceKey = {
      'template.supplies': projection.state.time.worldMinute,
    }
    projection.state.director.history = [{
      drawNumber: 1,
      worldMinute: projection.state.time.worldMinute,
      regionKey: 'region.salt-port',
      trigger: 'talk',
      outcomeKind: 'template-quest',
      sourceKey: 'template.supplies',
      questInstanceKey: dynamic.instanceKey,
      variantTextKey: 'task-text.supplies.1',
      fingerprint: 'fingerprint.supplies',
      intensity: 2,
    }]
    projection.director = structuredClone(projection.state.director)
    const dynamicSlot = projectTextOpenWorldRuntimeQuestPackagingSlotV1({
      runtimePackage,
      projection,
      questInstanceKey: dynamic.instanceKey,
    })!
    const onGenerate = vi.fn()
    await act(async () => {
      root.render(createElement(TextOpenWorldQuestLogPanel, {
        sessionId: 1,
        projection,
        events: [],
        actions: [],
        busy: false,
        questPackagingSlots: { [dynamic.instanceKey]: dynamicSlot },
        questPackagingPresentations: {},
        questPackagingBusyInstanceKey: null,
        questPackagingIssueInstanceKey: null,
        onGenerateQuestPackaging: onGenerate,
        onExecute: vi.fn(),
        onFocusLocation: vi.fn(),
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(host.querySelector('[data-testid="text-open-world-runtime-quest-packaging"]')).toBeNull()
    const randomFilter = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('随机任务')) as HTMLButtonElement
    await act(async () => {
      randomFilter.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    const packaging = host.querySelector('[data-testid="text-open-world-runtime-quest-packaging"]')!
    expect(packaging.textContent).toContain('AI包装这个地区任务')
    await act(async () => (packaging.querySelector('button') as HTMLButtonElement).click())
    expect(onGenerate).toHaveBeenCalledWith(dynamic.instanceKey)
  })
})
