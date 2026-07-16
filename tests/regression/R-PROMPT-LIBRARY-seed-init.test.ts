import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { NOVEL_PROMPT_LIBRARY_SEEDS } from '../../src/lib/ai/prompt-library-seeds'
import { usePromptStore } from '../../src/stores/prompt'

describe('Prompt 系统 seed 增量初始化', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    usePromptStore.setState({ templates: [], loaded: false, libraryLoaded: false })
  })

  afterEach(() => db.close())

  it('第二次初始化不重写未变化的 118 个资产', async () => {
    await usePromptStore.getState().init()
    await usePromptStore.getState().ensureLibraryLoaded()
    const first = await db.promptTemplates.toArray()
    const libraryBefore = new Map(first
      .filter(item => item.library?.assetId)
      .map(item => [item.library!.assetId, item.updatedAt]))
    expect(libraryBefore.size).toBe(NOVEL_PROMPT_LIBRARY_SEEDS.length)

    await new Promise(resolve => setTimeout(resolve, 5))
    usePromptStore.setState({ libraryLoaded: false })
    await usePromptStore.getState().ensureLibraryLoaded()

    const second = await db.promptTemplates.toArray()
    for (const item of second.filter(row => row.library?.assetId)) {
      expect(item.updatedAt, item.library!.assetId).toBe(libraryBefore.get(item.library!.assetId))
    }
  })
})
