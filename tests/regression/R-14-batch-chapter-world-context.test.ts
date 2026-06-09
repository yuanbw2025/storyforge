/**
 * R-14: batch chapter generation must resolve world context per chapter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockState = vi.hoisted(() => ({
  prompts: [] as string[],
}))

vi.mock('../../src/lib/ai/client', () => ({
  chat: vi.fn(async (messages: { content: string }[]) => {
    mockState.prompts.push(messages.map(message => message.content).join('\n\n'))
    return '这是一段足够长的章节正文。'.repeat(10)
  }),
}))

describe('R-14: batch chapter worldContextResolver', () => {
  beforeEach(() => {
    mockState.prompts = []
  })

  it('uses each chapter resolver context instead of the fallback world context', async () => {
    const { batchGenerateChapters } = await import('../../src/lib/ai/batch-detail-runner')
    const saved: number[] = []

    const result = await batchGenerateChapters({
      chapters: [
        { id: 1, title: '镜城章', summary: '镜城冲突', content: '' },
        { id: 2, title: '雾都章', summary: '雾都冲突', content: '' },
      ],
      minWordThreshold: 10,
      worldContext: 'DEFAULT_WORLD_CONTEXT_SHOULD_NOT_APPEAR',
      worldContextResolver: async chapterId => chapterId === 1 ? 'WORLD_CONTEXT_A' : 'WORLD_CONTEXT_B',
      characterContext: 'CHARACTER_CONTEXT',
      onSave: async chapterId => { saved.push(chapterId) },
    })

    expect(result.generated).toBe(2)
    expect(saved).toEqual([1, 2])
    expect(mockState.prompts).toHaveLength(2)
    expect(mockState.prompts[0]).toContain('WORLD_CONTEXT_A')
    expect(mockState.prompts[0]).not.toContain('DEFAULT_WORLD_CONTEXT_SHOULD_NOT_APPEAR')
    expect(mockState.prompts[1]).toContain('WORLD_CONTEXT_B')
    expect(mockState.prompts[1]).not.toContain('DEFAULT_WORLD_CONTEXT_SHOULD_NOT_APPEAR')
  })
})

