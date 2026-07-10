import { describe, expect, it } from 'vitest'
import {
  findNextCanonicalChapter,
  findPreviousCanonicalChapter,
} from '../../src/lib/ai/chapter-memory/canonical-chapter-sequence'
import { normalizeParsedScenes } from '../../src/lib/ai/adapters/detail-scene-adapter'
import type { Chapter, OutlineNode } from '../../src/lib/types'

const now = Date.now()

function outline(id: number, parentId: number | null, order: number, type: OutlineNode['type'] = 'chapter'): OutlineNode {
  return {
    id, projectId: 1, parentId, type, title: `N${id}`, summary: '', order,
    createdAt: now, updatedAt: now,
  }
}

function chapter(id: number, outlineNodeId: number, order: number): Chapter {
  return {
    id, projectId: 1, outlineNodeId, title: `C${id}`, content: `正文${id}`,
    summary: `摘要${id}`, wordCount: 3, status: 'draft', order, notes: '',
    createdAt: now, updatedAt: now,
  }
}

describe('PR-24 triage · canonical chapter neighbors and scene parsing', () => {
  it('finds previous/next chapters by canonical outline order instead of Chapter.order', () => {
    const volume = outline(1, null, 0, 'volume')
    const firstNode = outline(2, 1, 0)
    const secondNode = outline(3, 1, 1)
    const thirdNode = outline(4, 1, 2)

    const second = chapter(20, 3, 0)
    const first = chapter(10, 2, 99)
    const third = chapter(30, 4, 1)
    const chapters = [second, third, first]

    expect(findPreviousCanonicalChapter([volume, firstNode, secondNode, thirdNode], chapters, second)?.id)
      .toBe(10)
    expect(findNextCanonicalChapter([volume, firstNode, secondNode, thirdNode], chapters, second)?.id)
      .toBe(30)
  })

  it('normalizes parsed scene JSON into editable DetailedScene rows instead of notes blobs', () => {
    const scenes = normalizeParsedScenes([
      {
        title: '暗巷追击',
        summary: '主角发现线索后被追杀',
        location: '西市暗巷',
        conflict: '身份暴露',
        pace: 'climax',
        characterIds: [1, 1, 404],
        estimatedWords: 1234.6,
      },
    ], ids => ids.filter(id => id !== 404))

    expect(scenes).toHaveLength(1)
    expect(scenes[0]).toMatchObject({
      title: '暗巷追击',
      summary: '主角发现线索后被追杀',
      location: '西市暗巷',
      conflict: '身份暴露',
      pace: 'climax',
      characterIds: [1, 1],
      estimatedWords: 1235,
      notes: '',
    })
    expect(scenes[0].sceneId).toBeTruthy()
  })
})
