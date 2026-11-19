import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAIConfigStore, WORK_COVER_PRESET_KEY_V1 } from '../../src/stores/ai-config'
import { readWorkCoverConnectionV1 } from '../../src/lib/work-cover/connection'
import { prepareCoverRunV1, submitCoverImageOnceV1 } from '../../src/lib/work-cover/run'
import { saveWorkCoverDraftV1 } from '../../src/lib/work-cover/drafts'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { db } from '../../src/lib/db/schema'

afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals() })
describe('035 cover connection freshness', () => {
  it('rejects a stale page when another tab changes persisted credential, selection or deletes the preset', async () => {
    await db.delete(); await db.open()
    const preset = { id: 'cover-preset', name: '隔离图片连接', config: { provider: 'agnes' as const,
      baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: 'fixture-original-only', model: 'text-model', temperature: 0.7, maxTokens: 0 } }
    localStorage.setItem('storyforge-ai-presets', JSON.stringify([preset]))
    localStorage.setItem(WORK_COVER_PRESET_KEY_V1, preset.id)
    useAIConfigStore.setState({ presets: [preset], workCoverPresetId: preset.id, activePresetId: null })
    const { scope, work } = await seedCurrentWorkspace('跨页预设')
    const draft = await saveWorkCoverDraftV1({ scope, prompt: '夜空与灯塔', expectedRevision: null, expectedWorkUpdatedAt: work.updatedAt })
    const permit = await prepareCoverRunV1({ scope, draftId: draft.id, expectedDraftRevision: draft.revision,
      connection: readWorkCoverConnectionV1(), currentConnection: readWorkCoverConnectionV1 })
    localStorage.setItem('storyforge-ai-presets', JSON.stringify([{ ...preset, config: { ...preset.config, apiKey: 'fixture-replaced-only' } }]))
    const post = vi.fn(); vi.stubGlobal('fetch', post)
    await expect(submitCoverImageOnceV1(permit)).rejects.toThrow('连接已变化')
    expect(post).not.toHaveBeenCalled()
    expect(readWorkCoverConnectionV1().config.apiKey).toBe('fixture-replaced-only')
    localStorage.setItem(WORK_COVER_PRESET_KEY_V1, 'deleted-preset')
    expect(() => readWorkCoverConnectionV1()).toThrow('选择一个图片连接')
    localStorage.setItem(WORK_COVER_PRESET_KEY_V1, preset.id); localStorage.setItem('storyforge-ai-presets', '[]')
    expect(() => readWorkCoverConnectionV1()).toThrow('选择一个图片连接')
  })
})
